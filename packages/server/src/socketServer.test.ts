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

describe('socketServer', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'socket-server-test-'));
    const config: TableConfig = {
      gameMode: 'holdem',
      seatCount: 8,
      smallBlind: 5,
      bigBlind: 10,
      blackjackDefaultBet: 25,
      defaultStartingBalance: 1000,
      reconnectGraceMs: 50,
      random: Math.random,
    };
    const playerStore = new JsonPlayerStore(join(dir, 'balances.json'), config.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    server = await createServer(config, playerStore, handLog);
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
    const socket = connect();
    socket.emit('join', { displayName: 'alice' });
    const state = await waitForEvent<TableStateView>(socket, 'state');
    expect(state.seats[0]?.displayName).toBe('alice');
  });

  it('broadcasts an updated seat list to an already-connected client when a second player joins', async () => {
    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');

    const bob = connect();
    const aliceUpdate = waitForState(alice, (s) => s.seats[1]?.displayName === 'bob');
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');
    await aliceUpdate;
  });

  it('starts a hand once both seated clients send ready, and broadcasts it to both', async () => {
    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const bobHandStarted = waitForState(bob, (s) => s.handInProgress);
    bob.emit('ready');
    const state = await bobHandStarted;
    expect(state.holdem).not.toBeNull();
  });

  it('emits error only to the socket whose action was illegal, with no broadcast to others', async () => {
    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const handStarted = waitForState(bob, (s) => s.handInProgress);
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
});
