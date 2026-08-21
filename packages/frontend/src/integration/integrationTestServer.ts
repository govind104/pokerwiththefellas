import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { createServer } from '@poker-blackjack/server/src/socketServer';
import { JsonPlayerStore } from '@poker-blackjack/server/src/playerStore';
import { JsonlHandLog } from '@poker-blackjack/server/src/handLog';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import type { Socket } from 'socket.io-client';
import type AppComponent from '../App';

// Shared beforeEach/afterEach setup for the real-server integration tests
// (poker.integration.test.tsx, blackjack.integration.test.tsx). Both files
// need a real socketServer instance on a dynamically-assigned port, and a
// dynamically-imported App (see the comment above the `await import('../App')`
// call below for why). Extracted here so the two files don't duplicate ~70
// lines of setup verbatim (final-review Finding: bobSocket leak + duplicated
// setup).
export interface IntegrationTestContext {
  /**
   * The opponent's real socket.io-client connection, for tests that create
   * one. Assign it here (`ctx.bobSocket = createClient(...)`) rather than
   * keeping it as a test-body-local `let` -- afterEach below disconnects it
   * (if set) BEFORE closing httpServer, exactly mirroring the explicit
   * cleanup() + httpServer.close() ordering this fixture already needs for
   * the primary App/alice socket. A locally-scoped bobSocket that only gets
   * disconnected on a test's last line leaks (and can hang the afterEach's
   * httpServer.close()) the moment an earlier assertion throws.
   */
  bobSocket: Socket | null;
  readonly serverUrl: string;
  readonly App: typeof AppComponent;
}

export function setupIntegrationServer(
  configFactory: () => TableConfig,
  tmpDirPrefix: string
): IntegrationTestContext {
  let tmpDir: string;
  let httpServer: import('node:http').Server;
  let serverUrl = '';
  let originalServerUrl: string | undefined;
  let App: typeof AppComponent;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const ctx: IntegrationTestContext = {
    bobSocket: null,
    get serverUrl() {
      return serverUrl;
    },
    get App() {
      return App;
    },
  };

  beforeEach(async () => {
    ctx.bobSocket = null;
    // A prior test in this same file may have joined successfully and left
    // its display name in sessionStorage (SocketContext.tsx writes it on
    // every 'state' event). SocketProvider's mount effect reads that key and
    // auto-connect()s with it -- without clearing it here, a second test's
    // fresh <App /> render would silently skip the entering-name/JoinScreen
    // step and resume the previous test's identity instead.
    sessionStorage.clear();

    // Alice's socket receives real, independent server broadcasts (her own
    // join response, and later bob's join/ready) that update SocketProvider's
    // React state from genuine async network I/O, not from any userEvent call
    // a test makes -- there is no synchronous trigger to wrap in act(...) for
    // those specific updates, so React's dev-mode warns about them even
    // though nothing is wrong. This is expected noise inherent to testing a
    // real socket against real React state (SocketContext.tsx's own
    // implementation is correct), not a bug -- filter only that exact
    // message so any other console.error still surfaces and fails visibly.
    const realConsoleError = console.error.bind(console);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) {
        return;
      }
      realConsoleError(...args);
    });

    // Re-invoked per test rather than reusing a module-scoped TableConfig:
    // a config whose `random` is a stateful seeded-RNG closure (see
    // blackjack.integration.test.tsx) must get a freshly-seeded generator
    // each test, or a documented single-hand-determinism invariant silently
    // stops holding from the second test onward in a file that shares this
    // fixture (final-review Minor: RNG-sharing trap).
    const config = configFactory();
    tmpDir = mkdtempSync(join(tmpdir(), tmpDirPrefix));
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
    //
    // vi.resetModules() is required here (not just the dynamic import) once a
    // test file has more than one test: without it, the second test's
    // `await import('../App')` resolves from Vitest's module cache and
    // returns the SAME module instance the first test already evaluated --
    // frozen to the first test's now-closed server port -- rather than
    // re-evaluating App.tsx against this test's freshly-set env var.
    vi.resetModules();
    ({ default: App } = await import('../App'));
  });

  afterEach(async () => {
    // Disconnect bob's socket (if a test assigned one) before anything else.
    // If assigned and left connected -- e.g. because an earlier expect() in
    // the test threw before the test's own cleanup line ran -- it would keep
    // an open connection that http.Server#close's callback waits on forever.
    ctx.bobSocket?.disconnect();
    ctx.bobSocket = null;

    // Testing-library's own auto-cleanup afterEach unmounts the rendered App,
    // but it's not guaranteed to run before this hook. Unmount explicitly and
    // first: App's SocketProvider disconnects its socket on unmount, and
    // http.Server#close's callback only fires once every open connection has
    // closed -- leaving App's socket connected here would hang this hook the
    // same way a still-connected bobSocket would.
    cleanup();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
    (import.meta.env as Record<string, string | undefined>).VITE_SERVER_URL = originalServerUrl;
    consoleErrorSpy.mockRestore();
  });

  return ctx;
}
