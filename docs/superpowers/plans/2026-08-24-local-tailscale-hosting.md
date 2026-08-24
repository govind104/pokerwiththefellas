# Local Hosting Over Tailscale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app run as a single local process that the host's Tailscale-connected friends can reach in a browser, with zero cloud infrastructure and zero ongoing cost.

**Architecture:** The backend (`packages/server`) gains optional static-file serving so it can serve the frontend's built assets on the same port it already serves Socket.IO on. The frontend's backend-URL resolution becomes same-origin-aware. A root-level script chains "build the frontend" and "start the server with static serving on" into one command. Connectivity between the host and friends is Tailscale (external tool, no code) — this plan only makes the app itself reachable once a tailnet already exists.

**Tech Stack:** Existing stack unchanged (Node/TypeScript, Socket.IO, Vite/React, Vitest). New dependencies: `sirv` (static file serving), `dotenv` (`.env` loading), `cross-env` (cross-platform env var passing in the root launch script).

## Global Constraints

(From `docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md`)

- Starting a session must be a single command (Section 1, Section 4).
- One process, one port — the backend serves both the built frontend and Socket.IO/API traffic on the same `http.createServer` instance (Section 2, Section 3).
- No database migration — `PlayerStore`/`GameConfigStore`/`HandLog` keep writing to local JSON/JSONL files unchanged (Section 2).
- No TLS/reverse-proxy layer — Tailscale's own encryption covers this (Section 2, Section 8).
- Existing two-port local dev workflow (`npm run dev` on both `packages/frontend` and `packages/server`) must keep working unchanged — this plan adds a second, single-process mode, it does not replace the dev one.
- `.env` file support is required so the launch command doesn't need env vars re-exported by hand every session (Section 3 gap-fill).
- The runbook must state the Node/npm + repo-clone prerequisite and the first-run firewall-prompt gotcha, and must call out that balances/config/hand-log live on whichever machine hosts and do not follow a rotating host (Section 4/6 gap-fill).

---

### Task 1: Server — optional static-file serving in `createServer`

**Files:**
- Modify: `packages/server/src/socketServer.ts`
- Modify: `packages/server/package.json`
- Test: `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Produces: `createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase, staticDir?)` — a new optional 6th parameter, `staticDir?: string`. When provided, the returned `httpServer` serves the files at that path (falling back to `index.html` for any unmatched path) in addition to its existing Socket.IO behavior. When omitted, behavior is byte-for-byte unchanged from today (this is what every existing test relies on, so it must not regress).

- [ ] **Step 1: Add the `sirv` dependency**

Edit `packages/server/package.json`, adding `sirv` to `dependencies` (alongside the existing `@poker-blackjack/game-engine` and `socket.io` entries):

```json
  "dependencies": {
    "@poker-blackjack/game-engine": "*",
    "socket.io": "^4.8.0",
    "sirv": "^3.0.0"
  },
```

Run: `npm install --workspace=@poker-blackjack/server`
Expected: installs cleanly, `packages/server/node_modules/sirv` exists, root `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

Add this new `describe` block to `packages/server/src/socketServer.test.ts`, after the existing `describe('socketServer', ...)` block closes (same file, so it reuses the existing imports at the top — no new imports needed except `writeFile` from `node:fs/promises`, which the file doesn't currently import). Add `writeFile` to the existing `import { mkdtemp, rm } from 'node:fs/promises';` line so it reads `import { mkdtemp, rm, writeFile } from 'node:fs/promises';`.

```ts
describe('static file serving', () => {
  let staticDir: string;
  let dataDir: string;
  let server: CreateServerResult;
  let port: number;

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
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    await waitForEvent(socket, 'state');
    socket.disconnect();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/server -- socketServer`
Expected: FAIL — `createServer` currently ignores any 6th argument and never serves static files, so the root-path `fetch` gets a connection with no response handler (times out or errors) rather than a 200.

- [ ] **Step 4: Implement static-file serving**

In `packages/server/src/socketServer.ts`, add the import at the top of the file (alongside the existing `node:http` import):

```ts
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import sirv from 'sirv';
```

Change the `createServer` function signature and its first line:

```ts
export async function createServer(
  staticConfig: StaticTableConfig,
  gameConfigStore: GameConfigStore,
  playerStore: PlayerStore,
  handLog: HandLog,
  adminPassphrase: string | undefined,
  staticDir?: string
): Promise<CreateServerResult> {
  const httpServer = staticDir ? createHttpServer(sirv(staticDir, { single: true })) : createHttpServer();
```

Everything else in the function (the `SocketIOServer` construction and all handler wiring below it) is unchanged — `new SocketIOServer<...>(httpServer, { cors: { origin: '*' } })` still runs immediately after and continues to own the `/socket.io/*` path correctly regardless of the static handler being present, the same way Socket.IO is normally combined with an Express app passed to `createServer()`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/server -- socketServer`
Expected: PASS, including both new tests and every pre-existing test in the file (staticDir is optional and omitted by all of them, so their behavior must be unchanged).

If the second new test ("still accepts socket.io connections...") fails or hangs while the first passes: that means static-file serving is intercepting `/socket.io/*` requests before Socket.IO gets to handle them. Fix by attaching the static handler *after* Socket.IO instead of passing it to `createHttpServer` directly — construct `const httpServer = createHttpServer();` as before, construct `new SocketIOServer(httpServer, ...)` immediately after, and only then, if `staticDir` is set, call `httpServer.on('request', sirv(staticDir, { single: true }));`. Re-run the tests after this change.

- [ ] **Step 6: Run the full server test suite and typecheck**

Run: `npm run test --workspace=@poker-blackjack/server && npm run typecheck --workspace=@poker-blackjack/server`
Expected: all tests pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json package-lock.json packages/server/src/socketServer.ts packages/server/src/socketServer.test.ts
git commit -m "feat(server): add optional static-file serving to createServer"
```

---

### Task 2: Server — `.env` file support and `STATIC_DIR` wiring

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`
- Create: `packages/server/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `createServer(..., staticDir?)` from Task 1.
- Produces: the server process now loads `packages/server/.env` automatically on startup (via `dotenv/config`, a side-effecting import), and reads a new optional `STATIC_DIR` env var, resolved to an absolute path and passed through to `createServer`.

- [ ] **Step 1: Add the `dotenv` dependency**

Edit `packages/server/package.json`, adding `dotenv` to `dependencies`:

```json
  "dependencies": {
    "@poker-blackjack/game-engine": "*",
    "socket.io": "^4.8.0",
    "sirv": "^3.0.0",
    "dotenv": "^16.4.5"
  },
```

Run: `npm install --workspace=@poker-blackjack/server`
Expected: installs cleanly.

- [ ] **Step 2: Ignore `.env` files**

Edit `.gitignore` at the repo root, adding a line:

```
.env
```

(Full resulting file: `node_modules/`, `dist/`, `skill-observations/`, `*.tsbuildinfo`, `.env`.)

- [ ] **Step 3: Add `.env.example`**

Create `packages/server/.env.example`:

```
# Copy this file to .env in this same directory and fill in your own
# values. ADMIN_PASSPHRASE is required -- the server refuses to start
# without it. See docs/HOSTING.md for the full walkthrough of running a
# session with friends over Tailscale.

ADMIN_PASSPHRASE=change-me

# Optional -- override any of these to change the server's defaults.
# PORT=3000
# SMALL_BLIND=5
# BIG_BLIND=10
# BLACKJACK_DEFAULT_BET=25
# DEFAULT_STARTING_BALANCE=1000
# RECONNECT_GRACE_MS=120000

# Set automatically by the root "npm run play" script -- only needed here
# if you're starting the server standalone and want it to also serve the
# built frontend.
# STATIC_DIR=../frontend/dist
```

- [ ] **Step 4: Wire `.env` loading and `STATIC_DIR` into `index.ts`**

Replace the full contents of `packages/server/src/index.ts` with:

```ts
import 'dotenv/config';
import { resolve } from 'node:path';
import { createServer } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore } from './gameConfigStore';
import type { StaticTableConfig } from './socketServer';
import type { GameConfigValues } from './gameConfigStore';

const staticConfig: StaticTableConfig = {
  // Friend-group-sized table: 6 seats for both game modes.
  seatCount: 6,
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 120_000),
  random: Math.random,
};

const configDefaults: GameConfigValues = {
  smallBlind: Number(process.env.SMALL_BLIND ?? 5),
  bigBlind: Number(process.env.BIG_BLIND ?? 10),
  blackjackDefaultBet: Number(process.env.BLACKJACK_DEFAULT_BET ?? 25),
  defaultStartingBalance: Number(process.env.DEFAULT_STARTING_BALANCE ?? 1000),
};

const gameConfigStore = new JsonGameConfigStore(process.env.GAME_CONFIG_PATH ?? './game-config.json', configDefaults);

// Fail fast rather than warn-and-continue. Under the empty-lobby design
// nothing can start without a successful admin login, so a server booted
// without a passphrase is not "degraded" -- it is unusable: it accepts
// connections and shows every client a permanent "waiting for a game to
// start", with the only diagnosis being a console line already scrolled off.
const adminPassphrase = process.env.ADMIN_PASSPHRASE;
if (!adminPassphrase) {
  console.error(
    'ADMIN_PASSPHRASE is not set. No game can ever be started without it, so refusing to start a server ' +
      'that would only ever show clients an empty lobby. Set ADMIN_PASSPHRASE and try again.'
  );
  process.exit(1);
}

async function main() {
  const currentConfig = await gameConfigStore.getConfig();
  const playerStore = new JsonPlayerStore(
    process.env.PLAYER_STORE_PATH ?? './balances.json',
    currentConfig.defaultStartingBalance
  );
  const handLog = new JsonlHandLog(process.env.HAND_LOG_PATH ?? './hand.jsonl');
  const port = Number(process.env.PORT ?? 3000);
  const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;

  const { httpServer } = await createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase, staticDir);
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}${staticDir ? ` (serving frontend from ${staticDir})` : ''}`);
  });
}

// Without this, any rejection inside main() -- a non-ENOENT read failure in
// gameConfigStore.getConfig(), a listen/bind failure -- surfaces only as a
// bare unhandled-rejection stack trace with no indication that startup was
// what failed.
main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
```

(The only changes from the current file: the new `import 'dotenv/config';` as the very first line — it must run before the top-level `process.env.ADMIN_PASSPHRASE` read below it — the new `import { resolve } from 'node:path';`, the new `staticDir` line inside `main()`, and passing `staticDir` as the 6th argument to `createServer`.)

- [ ] **Step 5: Manually verify**

`index.ts` has no existing test file (`packages/server/src/index.test.ts` does not exist) and this task doesn't add one, consistent with that — it's process-entrypoint wiring, not a unit under test elsewhere in this codebase. Verify manually instead:

```bash
cp packages/server/.env.example packages/server/.env
```

Edit `packages/server/.env` and set `ADMIN_PASSPHRASE=test123`. Then:

Run: `npm run start --workspace=@poker-blackjack/server`
Expected: `Server listening on port 3000` (no `(serving frontend from ...)` suffix, since `STATIC_DIR` isn't set) — confirms `.env` loaded correctly without needing `ADMIN_PASSPHRASE` exported in the shell. Stop the server (Ctrl+C).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json package-lock.json packages/server/src/index.ts packages/server/.env.example .gitignore
git commit -m "feat(server): load config from .env, wire STATIC_DIR through to createServer"
```

---

### Task 3: Frontend — same-origin `SERVER_URL` default

**Files:**
- Create: `packages/frontend/src/serverUrl.ts`
- Test: `packages/frontend/src/serverUrl.test.ts`
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Produces: `resolveServerUrl(envServerUrl: string | undefined, pageOrigin: string): string` — pure function, `envServerUrl` wins when set, otherwise returns `pageOrigin` unchanged.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/serverUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './serverUrl';

describe('resolveServerUrl', () => {
  it('uses the explicit server URL when set, ignoring the page origin', () => {
    expect(resolveServerUrl('http://localhost:3000', 'http://100.64.1.2:5173')).toBe('http://localhost:3000');
  });

  it('falls back to the page origin when no explicit server URL is set', () => {
    expect(resolveServerUrl(undefined, 'http://100.64.1.2:8080')).toBe('http://100.64.1.2:8080');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- serverUrl`
Expected: FAIL — `./serverUrl` does not exist yet.

- [ ] **Step 3: Implement `resolveServerUrl`**

Create `packages/frontend/src/serverUrl.ts`:

```ts
// Resolves the backend's base URL. An explicit VITE_SERVER_URL always wins
// -- used for local dev, where the frontend and backend run as two
// separate processes on different ports. Otherwise falls back to the
// page's own origin, which is correct for the single-process deployment
// (docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md,
// Section 2/3): the backend serves the built frontend itself, so both are
// reached through the same host:port and no explicit URL is needed.
export function resolveServerUrl(envServerUrl: string | undefined, pageOrigin: string): string {
  return envServerUrl ?? pageOrigin;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- serverUrl`
Expected: PASS.

- [ ] **Step 5: Use it in `App.tsx`**

In `packages/frontend/src/App.tsx`, add the import alongside the existing ones and change the `SERVER_URL` line:

```ts
import { resolveServerUrl } from './serverUrl';
```

```ts
const SERVER_URL = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location.origin);
```

(This replaces the current `const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';` — behaviorally identical whenever `VITE_SERVER_URL` is explicitly set, which is the only case `packages/frontend/src/integration/integrationTestServer.ts` and existing tests rely on, so nothing else should need to change.)

- [ ] **Step 6: Run the full frontend test suite and typecheck**

Run: `npm run test --workspace=@poker-blackjack/frontend && npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: all tests pass (including the existing `App.test.tsx` and the integration tests that set `VITE_SERVER_URL` explicitly), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/serverUrl.ts packages/frontend/src/serverUrl.test.ts packages/frontend/src/App.tsx
git commit -m "feat(frontend): default SERVER_URL to the page origin instead of localhost:3000"
```

---

### Task 4: Root — single-command launch script

**Files:**
- Modify: `package.json` (repo root)

**Interfaces:**
- Consumes: `packages/frontend`'s existing `build` script (unchanged), `packages/server`'s `start` script + `STATIC_DIR` env var (Task 2).
- Produces: `npm run play` from the repo root — builds the frontend, then starts the server with `STATIC_DIR` pointed at the build output, so a full session starts with one command.

- [ ] **Step 1: Add `cross-env` as a root dev dependency**

Edit the repo root `package.json`, adding a `devDependencies` field (none currently exists at the root):

```json
{
  "name": "poker-blackjack-friends-app",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "play": "npm run build --workspace=@poker-blackjack/frontend && cross-env STATIC_DIR=../frontend/dist npm run start --workspace=@poker-blackjack/server"
  },
  "devDependencies": {
    "cross-env": "^7.0.3"
  }
}
```

`cross-env` is needed (rather than plain `STATIC_DIR=../frontend/dist npm run start ...`) because that inline-assignment syntax is bash-only and silently fails to set the variable under Windows' `cmd.exe`, which is what npm scripts run through by default on Windows — `cross-env` normalizes this across platforms.

Run: `npm install`
Expected: installs cleanly, `node_modules/cross-env` exists at the root.

- [ ] **Step 2: Manually verify the full launch path**

Ensure `packages/server/.env` exists with `ADMIN_PASSPHRASE` set (from Task 2, Step 5). From the repo root:

Run: `npm run play`
Expected console output, in order: the frontend build's Vite output ending in something like `✓ built in ...`, then `Server listening on port 3000 (serving frontend from <absolute path>\packages\frontend\dist)`.

With the server still running, open `http://localhost:3000/` in a browser.
Expected: the app loads (lobby/join screen), not a blank page or a raw JSON/API response — confirms the built frontend is actually being served, not just that the server started.

Stop the server (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add npm run play to build the frontend and start a single-process session"
```

---

### Task 5: Documentation — hosting runbook and HANDOFF update

**Files:**
- Create: `docs/HOSTING.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: `npm run play` (Task 4), `packages/server/.env.example` (Task 2).
- Produces: a runbook a friend (not just the primary maintainer) can follow to host a session, and an updated `HANDOFF.md` reflecting Plan 6's actual (re-scoped) status.

- [ ] **Step 1: Write the runbook**

Create `docs/HOSTING.md`:

```markdown
# Hosting a Session

The app runs on one person's machine during a session ("the host") and the
rest of the group connects to it over [Tailscale](https://tailscale.com), a
free private-network tool. No cloud hosting, no ongoing cost. See
`docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md` for
the full design rationale.

## One-time setup (host)

1. Install [Node.js](https://nodejs.org) (LTS) and clone this repo, if you
   haven't already. This is the one step that's obvious to a developer but
   worth spelling out for a friend who ends up hosting and isn't one.
2. Run `npm install` at the repo root.
3. Copy `packages/server/.env.example` to `packages/server/.env` and set
   `ADMIN_PASSPHRASE` to a passphrase you'll share with the group in-app
   (this is separate from Tailscale — it just gates the admin controls
   once you're already connected).
4. Install [Tailscale](https://tailscale.com/download) and sign in. This
   creates your "tailnet."

## One-time setup (each friend)

1. Install Tailscale and accept the host's invite to join their tailnet
   (the host sends this from the Tailscale admin console — "Invite
   external device" / "Share" — up to 5 friends fit in the free plan's
   6-user limit alongside the host).
2. That's it — no account needed in the app itself beyond what already
   exists (a display name, and the shared admin passphrase if you're
   running the game).

## Starting a session (host)

1. Make sure Tailscale is connected (check the Tailscale app/tray icon).
2. From the repo root, run:

   ```bash
   npm run play
   ```

   This builds the frontend and starts the server as a single process.
3. **First time only:** your OS will likely prompt to allow the app
   through the firewall. Accept it for Private/home networks — otherwise
   friends won't be able to reach the port at all.
4. Find your Tailscale hostname: run `tailscale status` and look for your
   own device's `<name>.<tailnet>.ts.net` entry, or check the
   [Tailscale admin console](https://login.tailscale.com/admin/machines).
   Prefer this hostname over the raw Tailscale IP — it's stable and
   doesn't need rechecking each session.
5. Share `http://<your-hostname>:3000` in the group chat.

## Playing

Friends open the link in a browser — no install beyond the one-time
Tailscale setup above. From there it's the normal app flow: enter a
display name, an admin opens the "Admin" button and enters the passphrase
to pick Poker or Blackjack and start the game, everyone else takes a seat.

## Ending a session

Stop the server with Ctrl+C. Balances, blind/bet settings, and hand
history are already saved to local files on the host's machine
(`packages/server/balances.json`, `game-config.json`, `hand.jsonl` by
default) — nothing else to do.

## Troubleshooting

- **Port already in use:** `npm run play` defaults to port 3000. Set
  `PORT=<some other port>` in `packages/server/.env` to change it, and
  share `http://<your-hostname>:<that port>` instead.

## One thing to decide up front: who hosts

Balances and settings live on whichever machine last ran the server —
they do **not** follow the game if a different person hosts next time.
For continuity, pick one person's machine as the regular host. If hosting
genuinely needs to rotate, the outgoing host would need to manually copy
`balances.json`, `game-config.json`, and `hand.jsonl` from
`packages/server/` to the next host's machine before their session — this
isn't automated.
```

- [ ] **Step 2: Update `HANDOFF.md`**

In `HANDOFF.md`, change the roadmap table row for Plan 6 (currently `| 6 | AWS deployment (DynamoDB, EC2) | Not started |`) to:

```markdown
| 6 | Local hosting over Tailscale (re-scoped from AWS deployment) | Not started |
```

Then, after the existing Plan 5 paragraph (the one ending `...git log 849b408..4acb538 for Plan 5`) and before the `390/390 tests passing...` line, insert a new paragraph:

```markdown
**Plan 6 was re-scoped during its own brainstorming**, from the original
"AWS deployment (DynamoDB, EC2)" to local hosting over
[Tailscale](https://tailscale.com) instead — the group plays occasionally
(roughly weekly or less), so an always-on cloud deployment is unnecessary
cost and complexity, AWS's free tier no longer covers what the original
spec assumed (it changed structurally in July 2025), and Tailscale
sidesteps the connectivity problems (no fixed home IP, CGNAT) that made
plain port-forwarding a non-option. Full rationale in
`docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md`;
implementation plan in
`docs/superpowers/plans/2026-08-24-local-tailscale-hosting.md`. See
`docs/HOSTING.md` for how to actually run a session once this plan lands.
```

Finally, in the "Running things" section, after the existing paragraph describing the two-terminal dev workflow (ending `...the table seats **6 players max** (both game modes).`), add:

```markdown
**To host an actual session with friends** (rather than local development),
see `docs/HOSTING.md` — it covers Tailscale setup and `npm run play`, which
builds the frontend and starts a single process serving both the app and
the game server together.
```

- [ ] **Step 3: Commit**

```bash
git add docs/HOSTING.md HANDOFF.md
git commit -m "docs: add hosting runbook, update HANDOFF for re-scoped Plan 6"
```
