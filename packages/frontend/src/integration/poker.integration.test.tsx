import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { createServer } from '@poker-blackjack/server/src/socketServer';
import { JsonPlayerStore } from '@poker-blackjack/server/src/playerStore';
import { JsonlHandLog } from '@poker-blackjack/server/src/handLog';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import type AppComponent from '../App';

// Mirrors packages/server/src/integration.test.ts's own setup pattern --
// see that file for the established conventions this follows.
let tmpDir: string;
let httpServer: import('node:http').Server;
let serverUrl: string;
let originalServerUrl: string | undefined;
let App: typeof AppComponent;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // Alice's socket receives real, independent server broadcasts (her own
  // join response, and later bob's join/ready) that update SocketProvider's
  // React state from genuine async network I/O, not from any userEvent call
  // this test makes -- there is no synchronous trigger in this test to wrap
  // in act(...) for those specific updates, so React's dev-mode warns about
  // them even though nothing is wrong. This is expected noise inherent to
  // testing a real socket against real React state (SocketContext.tsx's own
  // implementation is correct), not a bug -- filter only that exact message
  // so any other console.error still surfaces and fails visibly.
  const realConsoleError = console.error.bind(console);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) {
      return;
    }
    realConsoleError(...args);
  });

  tmpDir = mkdtempSync(join(tmpdir(), 'frontend-poker-integration-'));
  const config: TableConfig = {
    gameMode: 'holdem',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 120_000,
    random: Math.random,
  };
  const playerStore = new JsonPlayerStore(join(tmpDir, 'balances.json'), config.defaultStartingBalance);
  const handLog = new JsonlHandLog(join(tmpDir, 'hand.jsonl'));
  const result = await createServer(config, playerStore, handLog);
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  serverUrl = `http://localhost:${port}`;
  originalServerUrl = import.meta.env.VITE_SERVER_URL;
  (import.meta.env as Record<string, string>).VITE_SERVER_URL = serverUrl;
  // App.tsx reads import.meta.env.VITE_SERVER_URL into a module-level const
  // at import time. A static top-of-file `import App from '../App'` would
  // therefore freeze SERVER_URL at whatever value existed before this hook
  // ever ran (undefined -> the 'http://localhost:3000' fallback), and every
  // socket the rendered App creates would try to reach a server that isn't
  // this test's dynamically-ported one -- the join form would hang forever
  // on "Joining...". Importing dynamically, after the env var above is set,
  // is what makes App.tsx pick up the real per-test server URL.
  ({ default: App } = await import('../App'));
});

afterEach(async () => {
  // Testing-library's own auto-cleanup afterEach unmounts the rendered App,
  // but it's not guaranteed to run before this file's afterEach. Unmount
  // explicitly and first: App's SocketProvider disconnects its socket on
  // unmount, and http.Server#close's callback only fires once every open
  // connection has closed -- leaving App's socket connected here would hang
  // this hook the same way the still-connected bobSocket would if left
  // undisconnected.
  cleanup();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
  (import.meta.env as Record<string, string | undefined>).VITE_SERVER_URL = originalServerUrl;
  consoleErrorSpy.mockRestore();
});

describe('Poker end-to-end via App', () => {
  it('two players join, ready up, and see the hand start with correct hole-card visibility', async () => {
    // Player 1: drives the real App component through the DOM.
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    // Player 2: a second real socket.io-client connection (not through React --
    // this is the same "opponent" role packages/server's own tests use).
    const bobSocket: Socket = createClient(serverUrl);
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    // Wait for alice's real App instance to reflect bob's join before moving
    // on: the server broadcasts a fresh `state` to alice's socket the moment
    // bob's side of the wire progresses, and this findBy* query (like
    // userEvent's own clicks) is act-wrapped by testing-library, so it settles
    // that state update instead of leaving it to land as an unwrapped one
    // later.
    await within(screen.getByTestId('seat-1')).findByText('bob');

    bobSocket.emit('ready');
    await within(screen.getByTestId('seat-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('hole-cards-0').querySelectorAll('img')).toHaveLength(2);
    });
    // Own hole cards are real card images; the opponent's are face-down.
    expect(screen.getAllByRole('img', { name: /face-down/i }).length).toBeGreaterThan(0);

    bobSocket.disconnect();
  });
});
