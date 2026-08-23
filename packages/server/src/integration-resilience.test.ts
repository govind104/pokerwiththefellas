import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult, type StaticTableConfig } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';
import { waitForState, waitForSeated, waitForReady, waitForConnected, startGameAsAdmin } from './testHelpers';

describe('integration: resilience', () => {
  let dir: string;
  let balancesPath: string;
  let handLogPath: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];

  function staticConfig(overrides: Partial<StaticTableConfig> = {}): StaticTableConfig {
    return { seatCount: 8, reconnectGraceMs: 300, random: Math.random, ...overrides };
  }

  function configDefaults(): GameConfigValues {
    return { smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25, defaultStartingBalance: 1000 };
  }

  async function startServer(staticOverrides: Partial<StaticTableConfig> = {}) {
    const playerStore = new JsonPlayerStore(balancesPath, configDefaults().defaultStartingBalance);
    const handLog = new JsonlHandLog(handLogPath);
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults());
    server = await createServer(staticConfig(staticOverrides), gameConfigStore, playerStore, handLog, 'test-passphrase');
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
    await startServer({ reconnectGraceMs: 300 });
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
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobSeesDisconnect = waitForState(bob, (s) => s.table?.seats[0]?.connected === false);
    alice.disconnect();
    await bobSeesDisconnect;

    const aliceReconnect = connect();
    const reconnected = waitForConnected(aliceReconnect, 'alice');
    aliceReconnect.emit('join', { displayName: 'alice' });
    const state = await reconnected;
    expect(state.table!.seats[0]?.displayName).toBe('alice');
    expect(state.table!.seats[0]?.connected).toBe(true);
    expect(state.table!.handInProgress).toBe(true); // never auto-folded
  });

  it('disconnecting past the grace window auto-resolves the turn and the hand continues', async () => {
    await startServer({ reconnectGraceMs: 30 });
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
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    const handOver = waitForState(bob, (s) => s.table?.handInProgress === false);
    alice.disconnect(); // it is alice's turn -- button acts first preflop, heads-up
    await handOver;
  });

  it('persists balances across a simulated server restart', async () => {
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
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    const handOver = waitForState(bob, (s) => s.table?.handInProgress === false);
    alice.emit('action', { action: 'fold' }); // uncontested, settles immediately
    await handOver;

    const preRestartStore = new JsonPlayerStore(balancesPath, 1000);
    const aliceBalanceBeforeRestart = await preRestartStore.getBalance('alice');

    alice.disconnect();
    bob.disconnect();
    await stopServer();
    await startServer();
    const admin2 = connect();
    await startGameAsAdmin(admin2, 'holdem');

    const aliceReconnect = connect();
    const seated = waitForSeated(aliceReconnect, 'alice');
    aliceReconnect.emit('join', { displayName: 'alice' });
    const state = await seated;
    expect(state.table!.seats.find((s) => s.displayName === 'alice')?.balance).toBe(aliceBalanceBeforeRestart);
  });

  it('recovers an in-progress hand after a simulated crash and lets a player resume it', async () => {
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
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    const bobTurn = waitForState(bob, (s) => s.table?.holdem?.actingPlayerId === 'bob');
    alice.emit('action', { action: 'call' });
    await bobTurn;

    // Simulate a crash: tear down the transport with no graceful settlement. The
    // HandLog on disk still has the hand_started + one action entry from alice's call.
    alice.disconnect();
    bob.disconnect();
    await stopServer();

    await startServer(); // new createServer() calls table.recoverFromLog()

    expect(server.getTable()!.handInProgress).toBe(true);
    expect(server.getTable()!.holdemHand!.actingPlayerId).toBe('bob');

    const bobReconnect = connect();
    const reconnected = waitForConnected(bobReconnect, 'bob');
    bobReconnect.emit('join', { displayName: 'bob' });
    const state = await reconnected;
    expect(state.table!.holdem!.actingPlayerId).toBe('bob');

    const settled = waitForState(bobReconnect, (s) => s.table?.handInProgress === false);
    bobReconnect.emit('action', { action: 'fold' });
    await settled;
  });
});
