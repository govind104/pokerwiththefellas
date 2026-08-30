import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult, type StaticTableConfig } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';
import type { PlayerStore } from './playerStore';
import type { AppStateView } from './table';
import { ADMIN_PASSPHRASE, waitForEvent, waitForState, waitForSeated, waitForReady, startGameAsAdmin } from './testHelpers';

describe('socketServer', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];

  const staticConfig: StaticTableConfig = { seatCount: 8, reconnectGraceMs: 50, random: Math.random };
  const configDefaults: GameConfigValues = {
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'socket-server-test-'));
    const playerStore = new JsonPlayerStore(join(dir, 'balances.json'), configDefaults.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults);
    server = await createServer(staticConfig, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE);
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  it('emits state to a client showing its own seat after join', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    socket.emit('join', { displayName: 'alice' });
    const state = await waitForSeated(socket, 'alice');
    expect(state.table!.seats[0]?.displayName).toBe('alice');
  });

  it('broadcasts an updated seat list to an already-connected client when a second player joins', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');

    const bob = connect();
    const aliceUpdate = waitForState(alice, (s) => s.table?.seats[1]?.displayName === 'bob');
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');
    await aliceUpdate;
  });

  it('starts a hand once both seated clients send ready, and broadcasts it to both', async () => {
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
    const bobHandStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    const state = await bobHandStarted;
    expect(state.table!.holdem).not.toBeNull();
  });

  it('emits error only to the socket whose action was illegal, with no broadcast to others', async () => {
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
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    let aliceGotError = false;
    let bobGotError = false;
    alice.on('error', () => {
      aliceGotError = true;
    });
    bob.on('error', () => {
      bobGotError = true;
    });

    // Heads-up: alice (button) acts first preflop, so bob acting is out of turn.
    bob.emit('action', { action: 'fold' });
    await new Promise((r) => setTimeout(r, 50));

    expect(bobGotError).toBe(true);
    expect(aliceGotError).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a non-string value', 42],
    ['null', null],
    ['a name longer than the 32-character bound', 'x'.repeat(33)],
  ])('rejects a join whose displayName is %s without consuming a seat', async (_label, displayName) => {
    // Defense in depth at the network boundary: the design spec requires
    // malformed socket payloads to be rejected before reaching the engine at
    // all. Pre-fix, any value at all was passed straight through to
    // table.reconnect()/table.join() and became a seated player's identity.
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', { displayName } as never);
    const err = await errorPromise;
    expect(err.message).toBe('Invalid display name');
    // No seat was consumed -- the payload never reached the Table at all.
    expect(server.getTable()!.seats.every((s) => s === null)).toBe(true);
  });

  it('rejects a join before any admin has started a game -- the defining empty-lobby behaviour', async () => {
    // No startGameAsAdmin() call anywhere in this test on purpose: a freshly
    // created server has no Table at all, and the whole empty-lobby design
    // rests on `join` being refused until an admin picks a mode.
    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', { displayName: 'alice' });
    const err = await errorPromise;
    expect(err.message).toBe('No game is active yet');
    expect(server.getTable()).toBeNull();
  });

  it('the initial welcome state on a fresh lobby reports no mode, no table, and the current config values', async () => {
    const socket = connect();
    const state = await waitForEvent<AppStateView>(socket, 'state');
    expect(state.mode).toBeNull();
    expect(state.table).toBeNull();
    // The admin panel prefills its inputs from these, so they must be
    // present even before any game exists.
    expect(state.smallBlind).toBe(configDefaults.smallBlind);
    expect(state.bigBlind).toBe(configDefaults.bigBlind);
    expect(state.blackjackDefaultBet).toBe(configDefaults.blackjackDefaultBet);
    expect(state.defaultStartingBalance).toBe(configDefaults.defaultStartingBalance);
  });

  it('rejects a join with a missing payload instead of throwing in the handler', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', undefined as never);
    const err = await errorPromise;
    expect(err.message).toBe('Invalid display name');
  });

  it('adminLogin with an incorrect passphrase reports failure and is not added to the admin set', async () => {
    const socket = connect();
    const resultPromise = waitForEvent<{ success: boolean }>(socket, 'adminLoginResult');
    socket.emit('adminLogin', { passphrase: 'not-the-right-passphrase' });
    const result = await resultPromise;
    expect(result.success).toBe(false);

    // Confirm the failed login didn't sneak this socket into the admin set:
    // any subsequent admin action from it must still be rejected.
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('adminStartGame', { mode: 'holdem' });
    const err = await errorPromise;
    expect(err.message).toBe('Admin only');
  });

  it('rejects every admin action from a socket that has not logged in', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const intruder = connect();
    const errorPromise = waitForEvent<{ message: string }>(intruder, 'error');
    intruder.emit('adminAdjustBalance', { displayName: 'alice', balance: 5000 });
    const err = await errorPromise;
    expect(err.message).toBe('Admin only');
  });

  it("adminAdjustBalance updates a non-seated player's persisted balance and broadcasts it", async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');

    const update = waitForState(alice, (s) => s.table?.seats[0]?.balance === 5000);
    admin.emit('adminAdjustBalance', { displayName: 'alice', balance: 5000 });
    const state = await update;
    expect(state.table!.seats[0]?.balance).toBe(5000);
  });

  it('adminAdjustBalance is rejected while the named player is in an active hand', async () => {
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
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    await handStarted;

    const errorPromise = waitForEvent<{ message: string }>(admin, 'error');
    admin.emit('adminAdjustBalance', { displayName: 'alice', balance: 9999 });
    const err = await errorPromise;
    expect(err.message).toBe("Can't adjust -- alice is in an active hand");
  });

  it('adminSetBlinds applies to the next hand, not one already in progress', async () => {
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
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const firstHandState = await handStarted;
    // `holdem.pots` is only populated once a hand reaches 'settled' (see
    // holdemHand.ts) -- mid-hand, the pot total is the sum of what each
    // player has put in so far this street. Default blinds are 5/10, and
    // nobody has acted yet, so that's just the two blinds: 15.
    const streetPotTotal = (state: AppStateView) =>
      state.table!.holdem!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(streetPotTotal(firstHandState)).toBe(15);

    admin.emit('adminSetBlinds', { smallBlind: 50, bigBlind: 100 });
    await new Promise((r) => setTimeout(r, 20));
    // Still the same (unaffected) in-progress hand.
    const stillPotTotal = server
      .getTable()!
      .holdemHand!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(stillPotTotal).toBe(15);

    // Fold out the first hand via the normal action pathway (not a direct
    // engine call) so Table.submitAction's settlement runs and actually
    // clears handInProgress/ready -- a direct `holdemHand.act(...)` call
    // bypasses Table.settleHoldem entirely and leaves the table thinking a
    // hand is still in progress forever, which was hanging this test.
    const settled = waitForState(bob, (s) => s.table?.handInProgress === false);
    alice.emit('action', { action: 'fold' });
    await settled;

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const secondHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const secondHandState = await secondHandStarted;
    expect(streetPotTotal(secondHandState)).toBe(150);
  });

  it('adminSetStartingBalance changes the balance a never-before-seen player joins with', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    admin.emit('adminSetStartingBalance', { defaultStartingBalance: 7000 });
    await new Promise((r) => setTimeout(r, 20));

    const carol = connect();
    carol.emit('join', { displayName: 'carol' });
    const state = await waitForSeated(carol, 'carol');
    expect(state.table!.seats.find((s) => s.displayName === 'carol')?.balance).toBe(7000);
  });

  it('adminSwitchMode is rejected while a hand is in progress, and succeeds once idle', async () => {
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
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    await handStarted;

    const rejectPromise = waitForEvent<{ message: string }>(admin, 'error');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    const err = await rejectPromise;
    expect(err.message).toBe("Can't switch modes while a hand is in progress");

    // Fold via the normal action pathway (not a direct engine call) so
    // Table.submitAction's settlement actually runs and clears
    // handInProgress -- see the same note in the adminSetBlinds test above.
    const settled = waitForState(admin, (s) => s.table?.handInProgress === false);
    alice.emit('action', { action: 'fold' });
    await settled;

    const switched = waitForState(admin, (s) => s.mode === 'blackjack');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    const state = await switched;
    expect(state.table!.gameMode).toBe('blackjack');
    // Both previous players were unseated by the switch.
    expect(state.table!.seats.every((s) => s.displayName === null)).toBe(true);
  });

  it('broadcasts the updated config value after a successful admin config change', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const updated = waitForState(admin, (s) => s.bigBlind === 100);
    admin.emit('adminSetBlinds', { smallBlind: 50, bigBlind: 100 });
    const state = await updated;
    expect(state.smallBlind).toBe(50);
    expect(state.bigBlind).toBe(100);
  });

  it('every admin rejection is tagged scope: "admin" so the client can route it away from the join form', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const errorPromise = waitForEvent<{ message: string; scope?: string }>(admin, 'error');
    admin.emit('adminSetBlinds', { smallBlind: -5, bigBlind: 10 });
    const err = await errorPromise;
    expect(err.scope).toBe('admin');
  });

  describe('admin payload validation', () => {
    // Each of these used to be accepted and written straight through to a
    // file that survives a restart (game-config.json / balances.json), or --
    // for the missing-payload cases -- to throw an unhandled rejection
    // inside the async handler while reading `payload.x` off `undefined`.
    const invalidPayloadCases: { event: string; payload: unknown; expected: string }[] = [
      { event: 'adminSetBlinds', payload: { smallBlind: 0, bigBlind: 10 }, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetBlinds', payload: { smallBlind: 5, bigBlind: -10 }, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetBlinds', payload: { smallBlind: 5 }, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetBlinds', payload: undefined, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetDefaultBet', payload: { blackjackDefaultBet: 0 }, expected: 'Default bet must be a positive number' },
      { event: 'adminSetDefaultBet', payload: undefined, expected: 'Default bet must be a positive number' },
      {
        event: 'adminSetStartingBalance',
        payload: { defaultStartingBalance: 0 },
        expected: 'Starting balance must be a positive number',
      },
      { event: 'adminSetStartingBalance', payload: undefined, expected: 'Starting balance must be a positive number' },
      {
        event: 'adminAdjustBalance',
        payload: { displayName: 'alice', balance: -1 },
        expected: 'Balance must be a number of 0 or more',
      },
      { event: 'adminAdjustBalance', payload: { balance: 100 }, expected: 'Invalid display name' },
      { event: 'adminAdjustBalance', payload: undefined, expected: 'Invalid display name' },
      { event: 'adminStartGame', payload: { mode: 'roulette' }, expected: 'Invalid game mode' },
      { event: 'adminSwitchMode', payload: { mode: 'roulette' }, expected: 'Invalid game mode' },
      { event: 'adminSwitchMode', payload: undefined, expected: 'Invalid game mode' },
    ];

    for (const { event, payload, expected } of invalidPayloadCases) {
      it(`rejects ${event} with ${JSON.stringify(payload) ?? 'a missing payload'}`, async () => {
        const admin = connect();
        await startGameAsAdmin(admin, 'holdem');

        const errorPromise = waitForEvent<{ message: string; scope?: string }>(admin, 'error');
        admin.emit(event as never, payload as never);
        const err = await errorPromise;
        expect(err.message).toBe(expected);
        expect(err.scope).toBe('admin');
      });
    }

    it('leaves the persisted config untouched after a rejected adminSetBlinds', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');

      const errorPromise = waitForEvent<{ message: string }>(admin, 'error');
      admin.emit('adminSetBlinds', { smallBlind: Number.NaN, bigBlind: Number.NaN });
      await errorPromise;

      const stored = await new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults).getConfig();
      expect(stored.smallBlind).toBe(configDefaults.smallBlind);
      expect(stored.bigBlind).toBe(configDefaults.bigBlind);
    });

    it('accepts a balance of exactly 0 -- a busted player is a real state, unlike a 0 blind', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');

      const alice = connect();
      alice.emit('join', { displayName: 'alice' });
      await waitForSeated(alice, 'alice');

      const zeroed = waitForState(alice, (s) => s.table?.seats[0]?.balance === 0);
      admin.emit('adminAdjustBalance', { displayName: 'alice', balance: 0 });
      const state = await zeroed;
      expect(state.table!.seats[0]?.balance).toBe(0);
    });
  });
});

// Test-local fake used only by the seat-orphan regression tests below. Same
// pattern as table.test.ts's ControllablePlayerStore: `getBalance` can be
// held open on command so a `join` event's server-side handling can be
// paused mid-flight (right at the real fs round-trip a JsonPlayerStore would
// yield to the event loop on), letting a test drive the socket into a
// disconnect (or a second join) while the first join is still in progress.
class ControllablePlayerStore implements PlayerStore {
  private balances = new Map<string, number>();
  holdGetBalance = false;
  private pendingResolvers: Array<() => void> = [];
  constructor(private defaultBalance: number) {}
  async getBalance(displayName: string): Promise<number> {
    if (this.holdGetBalance) {
      await new Promise<void>((resolve) => {
        this.pendingResolvers.push(resolve);
      });
    }
    return this.balances.get(displayName) ?? this.defaultBalance;
  }
  async setBalance(displayName: string, balance: number): Promise<void> {
    this.balances.set(displayName, balance);
  }
  setDefaultStartingBalance(balance: number): void {
    this.defaultBalance = balance;
  }
  get pendingCount(): number {
    return this.pendingResolvers.length;
  }
  releaseNextGetBalance(): void {
    const resolve = this.pendingResolvers.shift();
    if (!resolve) {
      throw new Error('ControllablePlayerStore: no pending getBalance to release');
    }
    resolve();
  }
}

describe('socketServer join-handler seat-orphan race', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];
  let playerStore: ControllablePlayerStore;

  const staticConfig: StaticTableConfig = { seatCount: 8, reconnectGraceMs: 50, random: Math.random };
  const configDefaults: GameConfigValues = {
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'socket-server-orphan-test-'));
    playerStore = new ControllablePlayerStore(configDefaults.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults);
    server = await createServer(staticConfig, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE);
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  it('a client disconnecting while its join() is still in flight does not orphan the seat or deadlock the table', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    playerStore.holdGetBalance = true;

    // Independent, test-owned signal that the SERVER has actually processed
    // alice's disconnect -- not inferred from internal map/state timing.
    let disconnectedOnServer = false;
    server.io.on('connection', (socket) => {
      socket.on('disconnect', () => {
        disconnectedOnServer = true;
      });
    });

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });

    // Confirm the server is genuinely suspended mid-join (at the real
    // getBalance await), not just that the emit was sent.
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(1);
    });

    alice.disconnect();
    await vi.waitFor(() => {
      expect(disconnectedOnServer).toBe(true);
    });

    // Now let the suspended join() resolve, with the socket already gone.
    playerStore.releaseNextGetBalance();
    // Subsequent joins (bob, carol below) must resolve normally instead of
    // also suspending on getBalance -- only alice's join needed to be held.
    playerStore.holdGetBalance = false;
    await new Promise((r) => setTimeout(r, 20));

    // No seat should be left connected:true with nothing able to reach it --
    // that is exactly the orphaned state the pre-fix handler produces here.
    const orphaned = server.getTable()!.seats.some((s) => s?.connected === true);
    expect(orphaned).toBe(false);

    // And the table itself must not be deadlocked: a fresh pair can still
    // join and start a hand. Pre-fix, alice's phantom connected:true,
    // never-ready seat would block startHandIfEveryoneReady forever, so this
    // would hang instead of resolving.
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');
    const carol = connect();
    carol.emit('join', { displayName: 'carol' });
    await waitForSeated(carol, 'carol');

    bob.emit('ready');
    await waitForReady(bob, 'bob');
    const carolHandStarted = waitForState(carol, (s) => !!s.table?.handInProgress);
    carol.emit('ready');
    const state = await carolHandStarted;
    expect(state.table!.holdem).not.toBeNull();
  });

  it('a second join from the same still-connected socket disconnects the first seat instead of orphaning it', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    playerStore.holdGetBalance = true;

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(1);
    });

    // Second join from the SAME socket, before the first has resolved.
    alice.emit('join', { displayName: 'bob' });
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(2);
    });

    // Release in a controlled order: the first join ('alice') resolves
    // first, then the second ('bob'), synchronously back-to-back.
    playerStore.releaseNextGetBalance();
    playerStore.releaseNextGetBalance();
    // Subsequent joins (carol, dave below) must resolve normally instead of
    // also suspending on getBalance.
    playerStore.holdGetBalance = false;
    await new Promise((r) => setTimeout(r, 20));

    // The first seat must not be a permanent orphan -- it should have been
    // released via the normal disconnect/grace-window path, not left
    // connected:true with no socket mapped to it anymore.
    const aliceSeat = server.getTable()!.seats.find((s) => s?.displayName === 'alice');
    expect(aliceSeat?.connected).toBe(false);
    const bobSeat = server.getTable()!.seats.find((s) => s?.displayName === 'bob');
    expect(bobSeat?.connected).toBe(true);

    // Table not deadlocked either: `alice`'s client socket is now bound to
    // bob's (connected) seat, so bob's own seat plus one more connected,
    // ready player is enough to start a hand -- no separate "bob" client is
    // needed, and alice's disconnected seat 0 must NOT block the ready-gate.
    const carol = connect();
    carol.emit('join', { displayName: 'carol' });
    await waitForSeated(carol, 'carol');

    alice.emit('ready'); // this socket is bob's seat now
    await waitForReady(alice, 'bob');
    const carolHandStarted = waitForState(carol, (s) => !!s.table?.handInProgress);
    carol.emit('ready');
    const state = await carolHandStarted;
    expect(state.table!.holdem).not.toBeNull();
  });
});

describe('static file serving', () => {
  let staticDir: string;
  let dataDir: string;
  let server: CreateServerResult;
  let port: number;

  const staticConfig: StaticTableConfig = { seatCount: 8, reconnectGraceMs: 50, random: Math.random };
  const configDefaults: GameConfigValues = {
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
  };

  beforeEach(async () => {
    staticDir = await mkdtemp(join(tmpdir(), 'static-dir-test-'));
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Poker or Blackjack</title>');
    dataDir = await mkdtemp(join(tmpdir(), 'static-serving-data-'));
    const playerStore = new JsonPlayerStore(join(dataDir, 'balances.json'), configDefaults.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dataDir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dataDir, 'game-config.json'), configDefaults);
    server = await createServer(staticConfig, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE, staticDir);
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    server.io.close();
    await rm(staticDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('serves the built index.html at the root path when staticDir is provided', async () => {
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Poker or Blackjack');
  });

  it('still accepts socket.io connections when static serving is enabled', async () => {
    const socket = ioClient(`http://localhost:${port}`);
    await waitForEvent(socket, 'state');
    socket.disconnect();
  });

  it('falls back to index.html for unmatched paths (SPA fallback)', async () => {
    const response = await fetch(`http://localhost:${port}/nonexistent-route`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Poker or Blackjack');
  });
});
