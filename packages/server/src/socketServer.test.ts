import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult, type StaticTableConfig } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';
import type { PlayerStore } from './playerStore';
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

  it('rejects a join with a missing payload instead of throwing in the handler', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', undefined as never);
    const err = await errorPromise;
    expect(err.message).toBe('Invalid display name');
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
