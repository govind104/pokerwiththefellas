import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult, type StaticTableConfig } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';
import { waitForEvent, waitForState, waitForSeated, waitForReady, startGameAsAdmin } from './testHelpers';

// Deterministic in place of Math.random: the Blackjack test below waits for
// activeSeatIndex to reach seat 1 after alice's action, which never happens
// (the test hangs) if alice's shoe happens to deal her a natural blackjack
// and skip her turn entirely. Seed 2 is the same one verified safe in
// table.test.ts for a 2-seat Blackjack deal.
function makeDeterministicRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('integration: happy path', () => {
  let dir: string;
  let balancesPath: string;
  let handLogPath: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];

  function staticConfig(): StaticTableConfig {
    return { seatCount: 8, reconnectGraceMs: 50, random: makeDeterministicRandom(2) };
  }

  function configDefaults(overrides: Partial<GameConfigValues> = {}): GameConfigValues {
    return { smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25, defaultStartingBalance: 1000, ...overrides };
  }

  async function startServer(overrides: Partial<GameConfigValues> = {}) {
    const playerStore = new JsonPlayerStore(balancesPath, configDefaults(overrides).defaultStartingBalance);
    const handLog = new JsonlHandLog(handLogPath);
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults(overrides));
    server = await createServer(staticConfig(), gameConfigStore, playerStore, handLog, 'test-passphrase');
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
  }

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'integration-test-'));
    balancesPath = join(dir, 'balances.json');
    handLogPath = join(dir, 'hand.jsonl');
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('plays a full Hold\'em hand to showdown via an all-in confrontation and commits balances', async () => {
    await startServer();
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    // Capture the hand-started state on BOTH sockets: every `state` event is
    // computed per-socket from that socket's own mapped seat index, so this
    // is the only place the per-viewer hole-card filtering can be observed
    // end-to-end over the real Socket.IO wire rather than by calling
    // getStateForSeat directly.
    const aliceHandStarted = waitForState(alice, (s) => !!s.table?.handInProgress && s.table.holdem !== null);
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    const aliceView = (await aliceHandStarted).table!;
    const bobView = (await handStarted).table!;

    // Each player sees their own hole cards and not their opponent's, while
    // the hand is still live (pre-showdown).
    expect(aliceView.holdem!.street).not.toBe('settled');
    expect(bobView.holdem!.street).not.toBe('settled');
    const aliceOwn = aliceView.holdem!.players.find((p) => p.playerId === 'alice')!;
    const bobFromAlice = aliceView.holdem!.players.find((p) => p.playerId === 'bob')!;
    expect(aliceOwn.holeCards).not.toBeNull();
    expect(aliceOwn.holeCards).toHaveLength(2);
    expect(bobFromAlice.holeCards).toBeNull();

    const bobOwn = bobView.holdem!.players.find((p) => p.playerId === 'bob')!;
    const aliceFromBob = bobView.holdem!.players.find((p) => p.playerId === 'alice')!;
    expect(bobOwn.holeCards).not.toBeNull();
    expect(bobOwn.holeCards).toHaveLength(2);
    expect(aliceFromBob.holeCards).toBeNull();

    // Neither player was simply shown the other's cards under a different
    // label: the two sockets genuinely received different card data.
    expect(aliceOwn.holeCards).not.toEqual(bobOwn.holeCards);

    const bobTurn = waitForState(bob, (s) => s.table?.holdem?.actingPlayerId === 'bob');
    alice.emit('action', { action: 'all-in' });
    await bobTurn;

    const settled = waitForState(alice, (s) => s.table?.handInProgress === false);
    bob.emit('action', { action: 'all-in' });
    const settledView = (await settled).table!;

    // The complement of the filtering above: once the hand reaches showdown,
    // every non-folded player's cards are revealed to everyone -- proving the
    // opponent's null above is a live-hand access control, not a field that
    // is simply never populated for anyone but the viewer.
    for (const p of settledView.holdem!.players) {
      expect(p.folded).toBe(false);
      expect(p.holeCards).not.toBeNull();
    }

    const freshStore = new JsonPlayerStore(balancesPath, 1000);
    const aliceBalance = await freshStore.getBalance('alice');
    const bobBalance = await freshStore.getBalance('bob');
    expect(aliceBalance + bobBalance).toBe(2000); // total chips conserved
    expect([0, 1000, 2000]).toContain(aliceBalance);
  });

  it('plays a full Blackjack hand to settlement for two players and commits balances', async () => {
    await startServer({ blackjackDefaultBet: 25 });
    const admin = connect();
    await startGameAsAdmin(admin, 'blackjack');
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobTurn = waitForState(bob, (s) => s.table?.activeSeatIndex === 1);
    alice.emit('action', { action: 'stand' });
    await bobTurn;

    const handOver = waitForState(alice, (s) => s.table?.handInProgress === false);
    bob.emit('action', { action: 'stand' });
    await handOver;

    const freshStore = new JsonPlayerStore(balancesPath, 1000);
    const aliceBalance = await freshStore.getBalance('alice');
    const bobBalance = await freshStore.getBalance('bob');
    // Each player's round is independent (own shoe, own dealer outcome), so their
    // payouts aren't linked the way Hold'em's are -- just check both landed in the
    // set of legal outcomes for a 25-chip bet.
    expect([975, 1000, 1025, 1037.5]).toContain(aliceBalance);
    expect([975, 1000, 1025, 1037.5]).toContain(bobBalance);
  });

  it('rejects a 9th join once the table is full', async () => {
    await startServer();
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    for (let i = 0; i < 8; i++) {
      const c = connect();
      c.emit('join', { displayName: `player-${i}` });
      await waitForSeated(c, `player-${i}`);
    }
    const overflow = connect();
    const errorPromise = waitForEvent<{ message: string }>(overflow, 'error');
    overflow.emit('join', { displayName: 'one-too-many' });
    const err = await errorPromise;
    expect(err.message).toMatch(/full/);
  });

  it('rejects a duplicate display name', async () => {
    await startServer();
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice1 = connect();
    alice1.emit('join', { displayName: 'alice' });
    await waitForSeated(alice1, 'alice');

    const alice2 = connect();
    const errorPromise = waitForEvent<{ message: string }>(alice2, 'error');
    alice2.emit('join', { displayName: 'alice' });
    const err = await errorPromise;
    expect(err.message).toMatch(/already seated/);
  });

  it('admin starts a game, players join, admin changes blinds mid-session, and only the next hand uses them', async () => {
    await startServer();

    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const firstHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const firstHandState = await firstHandStarted;
    // `holdem.pots` is only populated once the hand reaches `street ===
    // 'settled'` (see @poker-blackjack/game-engine's holdemHand.ts) -- mid-hand,
    // right after blinds are posted, it's still `[]`. Sum each player's
    // streetContributed instead to check the live pot total.
    const firstHandPot = firstHandState.table!.holdem!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(firstHandPot).toBe(15); // default 5/10 blinds

    // A bare `waitForEvent(admin, 'state')` is safe here (unlike after
    // join/ready): the adminSetBlinds handler broadcasts exactly once, with
    // no internal pre-broadcast from Table racing ahead of it.
    admin.emit('adminSetBlinds', { smallBlind: 25, bigBlind: 50 });
    await waitForEvent(admin, 'state');

    // The already-in-progress hand is unaffected by the config change --
    // Table.updateConfig only takes effect starting with the next startHand().
    const table = server.getTable()!;
    const midHandPot = table.holdemHand!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(midHandPot).toBe(15);

    // End the in-progress hand through the real socket action path (routes
    // through Table.submitAction, which does the settlement bookkeeping) --
    // calling holdemHand.act(...) directly would bypass Table and leave
    // handInProgress stuck true, hanging every later waitForState predicate.
    const actingPlayerId = table.holdemHand!.actingPlayerId!;
    const actingSocket = actingPlayerId === 'alice' ? alice : bob;
    const otherSocket = actingPlayerId === 'alice' ? bob : alice;
    const firstHandOver = waitForState(otherSocket, (s) => s.table?.handInProgress === false);
    actingSocket.emit('action', { action: 'fold' });
    await firstHandOver;

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const secondHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const secondHandState = await secondHandStarted;
    const secondHandPot = secondHandState.table!.holdem!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(secondHandPot).toBe(75); // 25 + 50, the new blinds
  });
});
