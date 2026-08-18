import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import type { TableConfig } from './table';
import type { TableStateView } from './table';

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function waitForState(socket: ClientSocket, predicate: (state: TableStateView) => boolean): Promise<TableStateView> {
  return new Promise((resolve) => {
    const handler = (state: TableStateView) => {
      if (predicate(state)) {
        socket.off('state', handler);
        resolve(state);
      }
    };
    socket.on('state', handler);
  });
}

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

  function baseConfig(overrides: Partial<TableConfig> = {}): TableConfig {
    return {
      gameMode: 'holdem',
      seatCount: 8,
      smallBlind: 5,
      bigBlind: 10,
      blackjackDefaultBet: 25,
      defaultStartingBalance: 1000,
      reconnectGraceMs: 50,
      random: makeDeterministicRandom(2),
      ...overrides,
    };
  }

  async function startServer(config: TableConfig) {
    const playerStore = new JsonPlayerStore(balancesPath, config.defaultStartingBalance);
    const handLog = new JsonlHandLog(handLogPath);
    server = await createServer(config, playerStore, handLog);
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
    await startServer(baseConfig());
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const handStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobTurn = waitForState(bob, (s) => s.holdem?.actingPlayerId === 'bob');
    alice.emit('action', { action: 'all-in' });
    await bobTurn;

    const settled = waitForState(alice, (s) => s.handInProgress === false);
    bob.emit('action', { action: 'all-in' });
    await settled;

    const freshStore = new JsonPlayerStore(balancesPath, 1000);
    const aliceBalance = await freshStore.getBalance('alice');
    const bobBalance = await freshStore.getBalance('bob');
    expect(aliceBalance + bobBalance).toBe(2000); // total chips conserved
    expect([0, 1000, 2000]).toContain(aliceBalance);
  });

  it('plays a full Blackjack hand to settlement for two players and commits balances', async () => {
    await startServer(baseConfig({ gameMode: 'blackjack', blackjackDefaultBet: 25 }));
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const handStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobTurn = waitForState(bob, (s) => s.activeSeatIndex === 1);
    alice.emit('action', { action: 'stand' });
    await bobTurn;

    const handOver = waitForState(alice, (s) => s.handInProgress === false);
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
    await startServer(baseConfig());
    for (let i = 0; i < 8; i++) {
      const c = connect();
      c.emit('join', { displayName: `player-${i}` });
      await waitForEvent(c, 'state');
    }
    const overflow = connect();
    const errorPromise = waitForEvent<{ message: string }>(overflow, 'error');
    overflow.emit('join', { displayName: 'one-too-many' });
    const err = await errorPromise;
    expect(err.message).toMatch(/full/);
  });

  it('rejects a duplicate display name', async () => {
    await startServer(baseConfig());
    const alice1 = connect();
    alice1.emit('join', { displayName: 'alice' });
    await waitForEvent(alice1, 'state');

    const alice2 = connect();
    const errorPromise = waitForEvent<{ message: string }>(alice2, 'error');
    alice2.emit('join', { displayName: 'alice' });
    const err = await errorPromise;
    expect(err.message).toMatch(/already seated/);
  });
});
