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

describe('integration: resilience', () => {
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
      reconnectGraceMs: 300,
      random: Math.random,
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

  async function stopServer() {
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'integration-resilience-test-'));
    balancesPath = join(dir, 'balances.json');
    handLogPath = join(dir, 'hand.jsonl');
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    server.httpServer.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('reconnecting within the grace window resumes the same seat mid-hand', async () => {
    await startServer(baseConfig({ reconnectGraceMs: 300 }));
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');
    alice.emit('ready');
    await waitForState(alice, (s) => s.seats[0]?.ready === true);
    const handStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobSeesDisconnect = waitForState(bob, (s) => s.seats[0]?.connected === false);
    alice.disconnect();
    await bobSeesDisconnect;

    const aliceReconnect = connect();
    const state = await new Promise<TableStateView>((resolve) => {
      aliceReconnect.once('state', resolve);
      aliceReconnect.emit('join', { displayName: 'alice' });
    });
    expect(state.seats[0]?.displayName).toBe('alice');
    expect(state.seats[0]?.connected).toBe(true);
    expect(state.handInProgress).toBe(true); // never auto-folded
  });

  it('disconnecting past the grace window auto-resolves the turn and the hand continues', async () => {
    await startServer(baseConfig({ reconnectGraceMs: 30 }));
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');
    alice.emit('ready');
    await waitForState(alice, (s) => s.seats[0]?.ready === true);
    const handStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    await handStarted;

    const handOver = waitForState(bob, (s) => s.handInProgress === false);
    alice.disconnect(); // it is alice's turn -- button acts first preflop, heads-up
    await handOver;
  });

  it('persists balances across a simulated server restart', async () => {
    await startServer(baseConfig());
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');
    alice.emit('ready');
    await waitForState(alice, (s) => s.seats[0]?.ready === true);
    const handStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    await handStarted;

    const handOver = waitForState(bob, (s) => s.handInProgress === false);
    alice.emit('action', { action: 'fold' }); // uncontested, settles immediately
    await handOver;

    const preRestartStore = new JsonPlayerStore(balancesPath, 1000);
    const aliceBalanceBeforeRestart = await preRestartStore.getBalance('alice');

    alice.disconnect();
    bob.disconnect();
    await stopServer();
    await startServer(baseConfig());

    const aliceReconnect = connect();
    const state = await new Promise<TableStateView>((resolve) => {
      aliceReconnect.once('state', resolve);
      aliceReconnect.emit('join', { displayName: 'alice' });
    });
    expect(state.seats.find((s) => s.displayName === 'alice')?.balance).toBe(aliceBalanceBeforeRestart);
  });

  it('recovers an in-progress hand after a simulated crash and lets a player resume it', async () => {
    await startServer(baseConfig());
    const alice = connect();
    const bob = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');
    alice.emit('ready');
    await waitForState(alice, (s) => s.seats[0]?.ready === true);
    const handStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobTurn = waitForState(bob, (s) => s.holdem?.actingPlayerId === 'bob');
    alice.emit('action', { action: 'call' });
    await bobTurn;

    // Simulate a crash: tear down the transport with no graceful settlement. The
    // HandLog on disk still has the hand_started + one action entry from alice's call.
    alice.disconnect();
    bob.disconnect();
    await stopServer();

    await startServer(baseConfig()); // new createServer() calls table.recoverFromLog()

    expect(server.table.handInProgress).toBe(true);
    expect(server.table.holdemHand!.actingPlayerId).toBe('bob');

    const bobReconnect = connect();
    const state = await new Promise<TableStateView>((resolve) => {
      bobReconnect.once('state', resolve);
      bobReconnect.emit('join', { displayName: 'bob' });
    });
    expect(state.holdem!.actingPlayerId).toBe('bob');

    const settled = waitForState(bobReconnect, (s) => s.handInProgress === false);
    bobReconnect.emit('action', { action: 'fold' });
    await settled;
  });
});
