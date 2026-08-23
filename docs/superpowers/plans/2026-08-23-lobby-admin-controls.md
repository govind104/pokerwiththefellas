# Lobby & Admin Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-at-startup `GAME_MODE` env var with a runtime lobby (admin picks/switches Poker vs. Blackjack without restarting the server) plus admin controls (correct a player's balance, adjust blinds/default bet, adjust the starting balance for new joiners), gated behind a single shared passphrase.

**Architecture:** The server no longer constructs a `Table` at startup unconditionally — it peeks the hand log to auto-resume an interrupted hand's mode if one exists, otherwise starts in an empty lobby state (`mode: null`) until an admin-authenticated socket calls `adminStartGame`. A new `GameConfigStore` persists admin-adjusted blinds/bet/starting-balance to a small JSON file (mirroring the existing `PlayerStore` pattern) so they survive the server restarts that happen most game nights. The frontend gains a lobby screen and a persistent admin-login entry point; the `state` socket event now carries a wrapper (`AppStateView`) around the existing `TableStateView` so `mode: null` (lobby) is representable.

**Tech Stack:** No new dependencies. TypeScript, Socket.IO, React — same as the rest of the project.

## Global Constraints

- No Google OAuth, no blacklisting, no live seat-count changes — see the spec's Non-goals (`docs/superpowers/specs/2026-08-23-lobby-admin-controls-design.md` Section 1).
- Admin auth is a single passphrase (`ADMIN_PASSPHRASE` env var), checked server-side on every admin action, never trusted from the client alone.
- Admin status lives only on the socket connection (in-memory, `Set<socketId>`) — never persisted, lost on disconnect/refresh.
- Blind/default-bet changes apply starting the **next** hand, never retroactively to one in progress.
- A player's balance can only be corrected while they are **not** currently seated in a hand that's in progress (`table.handInProgress` at the time of the request) — this is a deliberate simplification (see Task 5) that blocks slightly more than strictly necessary for Blackjack (a seat whose own round has already settled but whose table-wide hand is still running is still blocked) in exchange for never risking corrupting settlement math. Do not attempt the more precise per-seat-settled check — it is unnecessary complexity for this app.
- `gameMode` itself is never persisted to the config file — every server start with no unfinished hand in the log begins in the empty lobby, admin actively picks.

---

### Task 1: `gameConfigStore.ts`

**Files:**
- Create: `packages/server/src/gameConfigStore.ts`
- Test: `packages/server/src/gameConfigStore.test.ts`

**Interfaces:**
- Produces: `GameConfigValues` (`{ smallBlind: number; bigBlind: number; blackjackDefaultBet: number; defaultStartingBalance: number }`), `GameConfigStore` interface (`getConfig(): Promise<GameConfigValues>`, `setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues>`), `JsonGameConfigStore` class implementing it. Later tasks import all three from `./gameConfigStore`.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/gameConfigStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';

describe('JsonGameConfigStore', () => {
  let dir: string;
  let filePath: string;
  const defaults: GameConfigValues = {
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'game-config-store-test-'));
    filePath = join(dir, 'game-config.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the constructor defaults when no file exists yet', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    await expect(store.getConfig()).resolves.toEqual(defaults);
  });

  it('round-trips a partial update, leaving other fields at their defaults', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    const result = await store.setConfig({ smallBlind: 50, bigBlind: 100 });
    expect(result).toEqual({ ...defaults, smallBlind: 50, bigBlind: 100 });
    await expect(store.getConfig()).resolves.toEqual({ ...defaults, smallBlind: 50, bigBlind: 100 });
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const storeA = new JsonGameConfigStore(filePath, defaults);
    await storeA.setConfig({ defaultStartingBalance: 2000 });

    const storeB = new JsonGameConfigStore(filePath, defaults);
    await expect(storeB.getConfig()).resolves.toEqual({ ...defaults, defaultStartingBalance: 2000 });
  });

  it('accumulates successive partial updates', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    await store.setConfig({ smallBlind: 50 });
    await store.setConfig({ bigBlind: 100 });
    await expect(store.getConfig()).resolves.toEqual({ ...defaults, smallBlind: 50, bigBlind: 100 });
  });

  it('falls back to defaults on a corrupted file instead of rejecting forever', async () => {
    await writeFile(filePath, '{"smallBlind": 5', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = new JsonGameConfigStore(filePath, defaults);
    await expect(store.getConfig()).resolves.toEqual(defaults);
    expect(errorSpy).toHaveBeenCalled();

    await store.setConfig({ smallBlind: 20 });
    errorSpy.mockRestore();
    await expect(new JsonGameConfigStore(filePath, defaults).getConfig()).resolves.toEqual({
      ...defaults,
      smallBlind: 20,
    });
  });

  it('preserves the corrupt file instead of letting the next write destroy it', async () => {
    await writeFile(filePath, '{"smallBlind": 5, "bigBlind": 1', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = new JsonGameConfigStore(filePath, defaults);
    await store.getConfig();
    await store.setConfig({ smallBlind: 15 });
    errorSpy.mockRestore();

    const files = (await readdir(dir)).sort();
    const corrupt = files.filter((f) => f.startsWith('game-config.json.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(files).toContain('game-config.json');
  });

  it('leaves no temp file behind after a write', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    await store.setConfig({ smallBlind: 15 });
    const files = await readdir(dir);
    expect(files).toEqual(['game-config.json']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server -- gameConfigStore`
Expected: FAIL — `Cannot find module './gameConfigStore'`.

- [ ] **Step 3: Implement `gameConfigStore.ts`**

Create `packages/server/src/gameConfigStore.ts`:

```ts
import { readFile, writeFile, rename } from 'node:fs/promises';

export interface GameConfigValues {
  smallBlind: number;
  bigBlind: number;
  blackjackDefaultBet: number;
  defaultStartingBalance: number;
}

export interface GameConfigStore {
  getConfig(): Promise<GameConfigValues>;
  setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues>;
}

export class JsonGameConfigStore implements GameConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly defaults: GameConfigValues
  ) {}

  private async readStored(): Promise<Partial<GameConfigValues>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
    try {
      return JSON.parse(raw) as Partial<GameConfigValues>;
    } catch (err) {
      // Same rationale as JsonPlayerStore: this file is durable admin state,
      // not a cache. A parse failure that rejected forever would brick every
      // admin config read; degrading to defaults keeps the app usable, and
      // moving the corrupt bytes aside (not deleting them) means the next
      // write can't silently destroy the only copy of whatever was there.
      console.error(`GameConfigStore: config file at ${this.filePath} is corrupted, treating as empty:`, err);
      try {
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch (renameErr) {
        console.error(
          `GameConfigStore: failed to move the corrupted config file at ${this.filePath} aside; it may be overwritten by the next write:`,
          renameErr
        );
      }
      return {};
    }
  }

  async getConfig(): Promise<GameConfigValues> {
    const stored = await this.readStored();
    return { ...this.defaults, ...stored };
  }

  async setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues> {
    const current = await this.getConfig();
    const next = { ...current, ...update };
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    await rename(tmpPath, this.filePath);
    return next;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server -- gameConfigStore`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/gameConfigStore.ts packages/server/src/gameConfigStore.test.ts
git commit -m "feat(server): add JsonGameConfigStore for persisted admin-adjustable config"
```

---

### Task 2: `AppStateView`, `Table.updateConfig`, `PlayerStore.setDefaultStartingBalance`

**Files:**
- Modify: `packages/server/src/table.ts`
- Modify: `packages/server/src/table.test.ts`
- Modify: `packages/server/src/playerStore.ts`
- Modify: `packages/server/src/playerStore.test.ts`

**Interfaces:**
- Consumes: `TableConfig`, `TableStateView`, `GameMode` (already in `table.ts`); `PlayerStore` (already in `playerStore.ts`).
- Produces: `AppStateView` (`table.ts`) — `{ mode: GameMode | null; isAdmin: boolean; table: TableStateView | null }`, used by Task 4's `socketServer.ts` as the new `state` event payload shape and by Task 6's frontend. `Table.updateConfig(update: Partial<Pick<TableConfig, 'smallBlind' | 'bigBlind' | 'blackjackDefaultBet' | 'defaultStartingBalance'>>): void`, used by Task 5's admin handlers. `PlayerStore.setDefaultStartingBalance(balance: number): void`, used by Task 5's `adminSetStartingBalance` handler.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/table.test.ts` (find the top-level `describe('Table', ...)` block — or the nearest matching one — and add a new nested `describe` alongside the existing ones):

```ts
describe('updateConfig', () => {
  it('changes smallBlind/bigBlind used by the next hand without touching an in-progress one', async () => {
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
    const playerStore = new InMemoryPlayerStore(1000);
    const handLog = new InMemoryHandLog();
    const table = new Table(config, { playerStore, handLog, onStateChange: () => {} });

    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);

    table.updateConfig({ smallBlind: 50, bigBlind: 100 });

    // The in-progress hand's blinds were posted at start and must not change.
    const potBeforeChange = table.holdemHand!.pots[0]?.amount;
    expect(potBeforeChange).toBe(15); // 5 + 10, unaffected by the live update

    // Finish the hand (both check/fold to settlement isn't needed here --
    // this test only asserts the *next* hand picks up the new blinds, so
    // fold it out immediately).
    table.holdemHand!.act('alice', 'fold');
    expect(table.handInProgress).toBe(false);

    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.pots[0]?.amount).toBe(150); // 50 + 100
  });
});
```

Check the top of `table.test.ts` for the existing in-memory `PlayerStore`/`HandLog` test doubles (they are already used by the file's other tests — reuse whatever names/classes are already defined there, e.g. `InMemoryPlayerStore`/`InMemoryHandLog`, adjusting the snippet above to match their actual constructor signatures if they differ from what's shown; do not introduce a second set of doubles).

Add to `packages/server/src/playerStore.test.ts` (inside the existing `describe('JsonPlayerStore', ...)` block):

```ts
it('setDefaultStartingBalance changes the value returned for names with no prior entry', async () => {
  const store = new JsonPlayerStore(filePath, 1000);
  await expect(store.getBalance('alice')).resolves.toBe(1000);
  store.setDefaultStartingBalance(2000);
  await expect(store.getBalance('alice')).resolves.toBe(2000);
  // A name that already has a stored balance is unaffected.
  await store.setBalance('bob', 500);
  await expect(store.getBalance('bob')).resolves.toBe(500);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server -- table.test.ts playerStore.test.ts`
Expected: FAIL — `table.updateConfig is not a function`, `store.setDefaultStartingBalance is not a function`.

- [ ] **Step 3: Implement the changes**

In `packages/server/src/table.ts`, add after the existing `TableStateView` interface (around line 78-86):

```ts
export interface AppStateView {
  mode: GameMode | null;
  isAdmin: boolean;
  table: TableStateView | null;
}
```

In the `Table` class, add a new public method. Place it directly after the constructor (around line 108):

```ts
  // Object.assign onto `this.config` mutates the config object in place
  // rather than reassigning `this.config` itself, so `readonly` on the
  // constructor parameter property still holds -- this is not a loophole,
  // it's the same distinction TypeScript's `readonly` always draws between
  // rebinding a reference and mutating what it points to. Every read site in
  // this class (startHand, eligibleSeatsForHand, etc.) reads `this.config`
  // fresh each time rather than caching a value, so an update here is picked
  // up starting with whatever the next read happens to be -- for blinds and
  // the default bet, that's the next startHand() call, never a hand already
  // in progress (which already captured its blinds into the HoldemHandConfig
  // it was constructed with).
  updateConfig(
    update: Partial<Pick<TableConfig, 'smallBlind' | 'bigBlind' | 'blackjackDefaultBet' | 'defaultStartingBalance'>>
  ): void {
    Object.assign(this.config, update);
  }
```

In `packages/server/src/playerStore.ts`, modify the `PlayerStore` interface (lines 3-6):

```ts
export interface PlayerStore {
  getBalance(displayName: string): Promise<number>;
  setBalance(displayName: string, balance: number): Promise<void>;
  setDefaultStartingBalance(balance: number): void;
}
```

Modify the `JsonPlayerStore` constructor (lines 11-14) to drop `readonly` from `defaultStartingBalance`, and add the new method after `setBalance` (after line 82):

```ts
export class JsonPlayerStore implements PlayerStore {
  constructor(
    private readonly filePath: string,
    private defaultStartingBalance: number
  ) {}
```

```ts
  setDefaultStartingBalance(balance: number): void {
    this.defaultStartingBalance = balance;
  }
```

- [ ] **Step 4: Update any other `PlayerStore` implementations**

`packages/server/src/socketServer.test.ts` defines a test-local `ControllablePlayerStore implements PlayerStore` (around line 168). Add to it:

```ts
  setDefaultStartingBalance(balance: number): void {
    this.defaultBalance = balance;
  }
```

This requires `defaultBalance` (currently `private readonly defaultBalance: number` in the constructor, around line 172) to become mutable — drop `readonly` there too, matching the `JsonPlayerStore` change above. Search the codebase for any other class implementing `PlayerStore` (`grep -rn "implements PlayerStore" packages/server/src`) and apply the same addition if any are found beyond this one and `JsonPlayerStore`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server -- table.test.ts playerStore.test.ts socketServer.test.ts`
Expected: PASS. (`socketServer.test.ts` should still pass unchanged at this point — this step only confirms the interface addition didn't break its compile.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts packages/server/src/playerStore.ts packages/server/src/playerStore.test.ts packages/server/src/socketServer.test.ts
git commit -m "feat(server): add AppStateView, Table.updateConfig, and PlayerStore.setDefaultStartingBalance"
```

---

### Task 3: `protocol.ts` — admin event types

**Files:**
- Modify: `packages/server/src/protocol.ts`

**Interfaces:**
- Consumes: `GameMode`, `AppStateView` from `./table` (Task 2).
- Produces: `AdminLoginPayload`, `StartGamePayload`, `AdjustBalancePayload`, `SetBlindsPayload`, `SetDefaultBetPayload`, `SetStartingBalancePayload`, `AdminLoginResultPayload`, and the updated `ClientToServerEvents`/`ServerToClientEvents`. Task 4's `socketServer.ts` and Task 6's frontend both import these.

This task has no independent test of its own — it's a pure type-level change with no runtime behavior. It's verified by the workspace typecheck and by Task 4/6 compiling against it.

- [ ] **Step 1: Replace the file contents**

Replace all of `packages/server/src/protocol.ts` with:

```ts
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import type { AppStateView, GameMode } from './table';

export interface JoinPayload {
  displayName: string;
}

export interface ActionPayload {
  action: PlayerAction | HoldemAction;
  amount?: number;
}

export interface ErrorPayload {
  message: string;
}

export interface AdminLoginPayload {
  passphrase: string;
}

export interface AdminLoginResultPayload {
  success: boolean;
}

export interface StartGamePayload {
  mode: GameMode;
}

export interface AdjustBalancePayload {
  displayName: string;
  balance: number;
}

export interface SetBlindsPayload {
  smallBlind: number;
  bigBlind: number;
}

export interface SetDefaultBetPayload {
  blackjackDefaultBet: number;
}

export interface SetStartingBalancePayload {
  defaultStartingBalance: number;
}

export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  ready: () => void;
  action: (payload: ActionPayload) => void;
  leave: () => void;
  adminLogin: (payload: AdminLoginPayload) => void;
  adminStartGame: (payload: StartGamePayload) => void;
  adminSwitchMode: (payload: StartGamePayload) => void;
  adminAdjustBalance: (payload: AdjustBalancePayload) => void;
  adminSetBlinds: (payload: SetBlindsPayload) => void;
  adminSetDefaultBet: (payload: SetDefaultBetPayload) => void;
  adminSetStartingBalance: (payload: SetStartingBalancePayload) => void;
}

export interface ServerToClientEvents {
  state: (state: AppStateView) => void;
  error: (payload: ErrorPayload) => void;
  adminLoginResult: (payload: AdminLoginResultPayload) => void;
}
```

- [ ] **Step 2: Verify the workspace still typechecks**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: FAIL — `socketServer.ts` still emits `TableStateView` where `AppStateView` is now expected, and `socketServer.test.ts`/`integration.test.ts`/`integration-resilience.test.ts` still type their `waitForState`/`waitForEvent` calls against `TableStateView`. This is expected; Task 4 fixes it. Confirm the failures are exactly in those files and nowhere else (e.g. not in `packages/frontend`, which Task 6 handles separately) before moving on.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/protocol.ts
git commit -m "feat(server): add admin socket event types to the protocol"
```

Note in the commit message or PR description that this intentionally leaves the workspace red until Task 4 lands — both tasks are part of one coherent change and should be reviewed together if the reviewer runs the full suite between them.

---

### Task 4: Lobby & mode lifecycle in `socketServer.ts`

This is the largest task: it changes `createServer`'s signature, makes `Table` optional until an admin starts a game, adds admin login, and adds `adminStartGame`/`adminSwitchMode`. It also fixes the three existing test files whose setup assumed a `Table` exists immediately, and rewires `index.ts`.

**Files:**
- Modify: `packages/server/src/socketServer.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/socketServer.test.ts`
- Modify: `packages/server/src/integration.test.ts`
- Modify: `packages/server/src/integration-resilience.test.ts`

**Interfaces:**
- Consumes: `GameConfigStore` (Task 1), `AppStateView`/`GameMode`/`Table.updateConfig` (Task 2), all `protocol.ts` types (Task 3).
- Produces: new `createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase)` signature and `CreateServerResult` shape (`{ httpServer, io, getTable: () => Table | null }`), used by Task 5 (same file) and by every test file's setup going forward.

- [ ] **Step 1: Replace `packages/server/src/socketServer.ts`**

```ts
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { Table, type TableConfig, type GameMode, type AppStateView } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';
import type { GameConfigStore } from './gameConfigStore';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  JoinPayload,
  ActionPayload,
  AdminLoginPayload,
  StartGamePayload,
} from './protocol';

export interface StaticTableConfig {
  seatCount: number;
  reconnectGraceMs: number;
  random: () => number;
}

export interface CreateServerResult {
  httpServer: HttpServer;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  getTable: () => Table | null;
}

// Defense in depth alongside JsonPlayerStore's null-prototype balance map:
// the design spec requires malformed or unexpected socket payloads to be
// rejected before reaching the engine at all, and a display name arriving off
// the wire is entirely attacker-controlled. The 32-character bound is a
// judgment call, not a spec requirement.
function isValidDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 32;
}

export async function createServer(
  staticConfig: StaticTableConfig,
  gameConfigStore: GameConfigStore,
  playerStore: PlayerStore,
  handLog: HandLog,
  adminPassphrase: string | undefined
): Promise<CreateServerResult> {
  const httpServer = createHttpServer();
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  const seatBySocketId = new Map<string, number>();
  const adminSocketIds = new Set<string>();
  let table: Table | null = null;
  let currentMode: GameMode | null = null;

  async function buildTableConfig(mode: GameMode): Promise<TableConfig> {
    const values = await gameConfigStore.getConfig();
    return {
      gameMode: mode,
      seatCount: staticConfig.seatCount,
      smallBlind: values.smallBlind,
      bigBlind: values.bigBlind,
      blackjackDefaultBet: values.blackjackDefaultBet,
      defaultStartingBalance: values.defaultStartingBalance,
      reconnectGraceMs: staticConfig.reconnectGraceMs,
      random: staticConfig.random,
    };
  }

  const broadcast = () => {
    for (const [socketId, socket] of io.sockets.sockets) {
      const seatIndex = seatBySocketId.get(socketId) ?? null;
      const view: AppStateView = {
        mode: currentMode,
        isAdmin: adminSocketIds.has(socketId),
        table: table ? table.getStateForSeat(seatIndex) : null,
      };
      socket.emit('state', view);
    }
  };

  function createTable(config: TableConfig): Table {
    return new Table(config, { playerStore, handLog, onStateChange: broadcast });
  }

  // Startup recovery: an unfinished hand from before a restart must resume
  // into its own mode automatically -- there is no choice to offer the admin
  // here, the mode is simply whatever was already being played. Peeking the
  // hand log's first entry (the same discriminant Table.recoverFromLog uses
  // internally) lets this decision happen before any Table exists, which the
  // empty-lobby-until-admin-picks design requires. An empty or unrecognized
  // log leaves currentMode/table both null -- a genuine fresh lobby.
  const startupEntries = await handLog.readAll();
  const startupMode: GameMode | null =
    startupEntries[0]?.type === 'holdem_hand_started'
      ? 'holdem'
      : startupEntries[0]?.type === 'blackjack_hand_started'
        ? 'blackjack'
        : null;

  if (startupMode) {
    currentMode = startupMode;
    table = createTable(await buildTableConfig(startupMode));
    // recoverFromLog() must complete before the connection handler below is
    // registered, and before any caller of createServer() calls
    // httpServer.listen(). This is more than a documented startup-ordering
    // nicety: Table.recoverFromLog's own catch block (on a corrupted log)
    // does a wholesale reset of every seat to null, which is only safe
    // because no socket-to-seat mapping can exist yet at that point.
    await table.recoverFromLog();
  }

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    // A fresh connection needs to see the current lobby/table state
    // immediately, before it does anything -- otherwise the frontend has no
    // way to know whether to show the lobby, a join screen, or a table.
    socket.emit('state', {
      mode: currentMode,
      isAdmin: false,
      table: table ? table.getStateForSeat(null) : null,
    });

    socket.on('join', async (payload: JoinPayload) => {
      if (!table) {
        socket.emit('error', { message: 'No game is active yet' });
        return;
      }
      if (!isValidDisplayName(payload?.displayName)) {
        socket.emit('error', { message: 'Invalid display name' });
        return;
      }
      try {
        const existingSeatIndex = table.reconnect(payload.displayName);
        const seatIndex = existingSeatIndex ?? (await table.join(payload.displayName));
        const previousSeatIndex = seatBySocketId.get(socket.id);
        if (previousSeatIndex !== undefined && previousSeatIndex !== seatIndex) {
          // This socket already held a different seat -- e.g. it sent an
          // earlier `join` that resolved after this one started. Release the
          // stale seat properly instead of silently orphaning it.
          table.disconnect(previousSeatIndex);
        }
        if (!socket.connected) {
          // The socket disconnected while this join's await was in flight --
          // don't register a mapping nothing will ever clean up; instead mark
          // the seat disconnected immediately so it follows the normal
          // reconnect/grace-window/timeout path instead of becoming a
          // permanent connected:true orphan that can never be reached again.
          table.disconnect(seatIndex);
          return;
        }
        seatBySocketId.set(socket.id, seatIndex);
        broadcast();
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('ready', async () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        await table.setReady(seatIndex);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('action', async (payload: ActionPayload) => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        await table.submitAction(seatIndex, payload.action, payload.amount);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('leave', () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        table.leave(seatIndex);
        seatBySocketId.delete(socket.id);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('adminLogin', (payload: AdminLoginPayload) => {
      const success = !!adminPassphrase && payload?.passphrase === adminPassphrase;
      if (success) {
        adminSocketIds.add(socket.id);
      }
      socket.emit('adminLoginResult', { success });
      if (success) {
        broadcast();
      }
    });

    socket.on('adminStartGame', async (payload: StartGamePayload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      if (table) {
        socket.emit('error', { message: 'A game is already active -- use switch instead' });
        return;
      }
      currentMode = payload.mode;
      table = createTable(await buildTableConfig(payload.mode));
      broadcast();
    });

    socket.on('adminSwitchMode', async (payload: StartGamePayload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      if (!table) {
        socket.emit('error', { message: 'No game active -- use start instead' });
        return;
      }
      if (table.handInProgress) {
        socket.emit('error', { message: "Can't switch modes while a hand is in progress" });
        return;
      }
      // Seat semantics differ between Poker and Blackjack, so nothing
      // meaningful carries over -- everyone (including players who were
      // already seated) rejoins the new table fresh. A returning player with
      // a remembered display name auto-rejoins via the frontend's own logic
      // (Task 6) the moment this broadcast reports the new mode; nobody
      // needs to retype anything they'd already typed once tonight.
      seatBySocketId.clear();
      currentMode = payload.mode;
      table = createTable(await buildTableConfig(payload.mode));
      broadcast();
    });

    socket.on('adminAdjustBalance', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      const seat = table?.seats.find((s) => s?.displayName === payload.displayName);
      if (seat && table!.handInProgress) {
        socket.emit('error', { message: `Can't adjust -- ${payload.displayName} is in an active hand` });
        return;
      }
      await playerStore.setBalance(payload.displayName, payload.balance);
      if (seat) {
        seat.balance = payload.balance;
      }
      broadcast();
    });

    socket.on('adminSetBlinds', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      await gameConfigStore.setConfig({ smallBlind: payload.smallBlind, bigBlind: payload.bigBlind });
      table?.updateConfig({ smallBlind: payload.smallBlind, bigBlind: payload.bigBlind });
      broadcast();
    });

    socket.on('adminSetDefaultBet', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      await gameConfigStore.setConfig({ blackjackDefaultBet: payload.blackjackDefaultBet });
      table?.updateConfig({ blackjackDefaultBet: payload.blackjackDefaultBet });
      broadcast();
    });

    socket.on('adminSetStartingBalance', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      await gameConfigStore.setConfig({ defaultStartingBalance: payload.defaultStartingBalance });
      playerStore.setDefaultStartingBalance(payload.defaultStartingBalance);
      broadcast();
    });

    socket.on('disconnect', () => {
      adminSocketIds.delete(socket.id);
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex !== undefined && table) {
        table.disconnect(seatIndex);
        seatBySocketId.delete(socket.id);
      }
    });
  });

  return {
    httpServer,
    io,
    getTable: () => table,
  };
}
```

Note: `adminAdjustBalance`/`adminSetBlinds`/`adminSetDefaultBet`/`adminSetStartingBalance` handlers above are written inline with their payload types inferred from `ClientToServerEvents` (already typed in `protocol.ts` from Task 3) rather than imported and annotated explicitly — this matches how `join`/`ready`/`action` are already handled in this file (Socket.IO infers the handler parameter type from the typed `Socket<ClientToServerEvents, ...>`). If your editor/tsc requires explicit annotations here, import `AdjustBalancePayload`, `SetBlindsPayload`, `SetDefaultBetPayload`, `SetStartingBalancePayload` from `./protocol` alongside the other payload imports at the top of the file and annotate each `payload` parameter explicitly — behavior is identical either way.

- [ ] **Step 2: Replace `packages/server/src/index.ts`**

```ts
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

const adminPassphrase = process.env.ADMIN_PASSPHRASE;
if (!adminPassphrase) {
  console.warn('ADMIN_PASSPHRASE is not set -- admin controls are unreachable until it is.');
}

async function main() {
  const currentConfig = await gameConfigStore.getConfig();
  const playerStore = new JsonPlayerStore(
    process.env.PLAYER_STORE_PATH ?? './balances.json',
    currentConfig.defaultStartingBalance
  );
  const handLog = new JsonlHandLog(process.env.HAND_LOG_PATH ?? './hand.jsonl');
  const port = Number(process.env.PORT ?? 3000);

  const { httpServer } = await createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase);
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main();
```

- [ ] **Step 3: Update `socketServer.test.ts`'s setup and every `TableConfig`/`server.table` reference**

Replace lines 1-53 of `packages/server/src/socketServer.test.ts` (imports through the end of the first `beforeEach`) with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult, type StaticTableConfig } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';
import type { AppStateView, GameMode } from './table';
import type { PlayerStore } from './playerStore';

const ADMIN_PASSPHRASE = 'test-passphrase';

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function waitForState(socket: ClientSocket, predicate: (state: AppStateView) => boolean): Promise<AppStateView> {
  return new Promise((resolve) => {
    const handler = (state: AppStateView) => {
      if (predicate(state)) {
        socket.off('state', handler);
        resolve(state);
      }
    };
    socket.on('state', handler);
  });
}

// Logs in as admin and starts a game on a fresh (lobby-state) server, then
// waits for that client to see the resulting active table -- the equivalent
// of what every test in this file could previously assume createServer()
// already gave them for free. Returns nothing; callers already have `server`
// and use `server.getTable()!` to inspect the resulting Table directly.
async function startGameAsAdmin(socket: ClientSocket, mode: GameMode): Promise<void> {
  socket.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
  await waitForEvent(socket, 'adminLoginResult');
  const started = waitForState(socket, (s) => s.mode === mode);
  socket.emit('adminStartGame', { mode });
  await started;
}

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
```

Leave `afterEach` and `connect()` exactly as they are (lines 55-65 of the original) — they don't reference `TableConfig` or `.table`.

Now every test in this `describe('socketServer', ...)` block needs a game started before it does anything else, and every `waitForEvent<TableStateView>(socket, 'state')` / `waitForState(socket, (s) => ...)` needs to read through `.table` instead of treating the event payload as the table state directly. Apply this transformation to each of the 6 tests currently in the block (`emits state to a client showing its own seat after join` through `rejects a join with a missing payload instead of throwing in the handler`):

1. Immediately after `const socket = connect();` (or the first `connect()` call in a test), insert a call to start the game before any `join` is emitted:
   ```ts
   const admin = connect();
   await startGameAsAdmin(admin, 'holdem');
   ```
   (`admin` does not need to be a seated player — it's a separate connection purely to authenticate and start the game, matching how a real admin's browser tab would behave. It does not need to be added to any assertions unless a test specifically wants to check admin behavior.)
2. Replace every `waitForEvent<TableStateView>(socket, 'state')` with `waitForEvent<AppStateView>(socket, 'state')`, and wherever the resolved value's `.seats`/`.handInProgress`/`.holdem` etc. was read directly, read it off `.table` instead (e.g. `state.seats[0]` becomes `state.table!.seats[0]`).
3. Replace every `waitForState(socket, (s) => s.seats[1]?.displayName === 'bob')`-style predicate with one that reads through `.table` (e.g. `(s) => s.table?.seats[1]?.displayName === 'bob'`), and the resolved value the same way.
4. Replace every `server.table.seats` with `server.getTable()!.seats`.

Worked example — the first test, in full, after transformation:

```ts
  it('emits state to a client showing its own seat after join', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    socket.emit('join', { displayName: 'alice' });
    const state = await waitForEvent<AppStateView>(socket, 'state');
    expect(state.table!.seats[0]?.displayName).toBe('alice');
  });
```

Apply the same four-step transformation to the remaining 5 tests in the block, and to the two tests in `describe('socketServer join-handler seat-orphan race', ...)` (lines 196-338 of the original), whose `beforeEach` (lines 203-221) needs the identical setup rewrite shown above, substituting `ControllablePlayerStore` for `JsonPlayerStore` (unchanged from the original otherwise) and adding a `startGameAsAdmin(admin, 'holdem')` call at the start of each of those two tests as well. Every `server.table.seats.some(...)` / `server.table.seats.find(...)` in that describe block becomes `server.getTable()!.seats.some(...)` / `.find(...)`.

- [ ] **Step 4: Update `integration.test.ts` and `integration-resilience.test.ts`**

Both files share the same `baseConfig()` + `startServer(config)` helper shape, and both have every call site already identified below (found via `grep -n "startServer(baseConfig(" packages/server/src` — there are no other call sites in either file). Apply the same transformation pattern as Step 3 to each:

1. Add a `startGameAsAdmin` helper identical to the one added in `socketServer.test.ts` Step 3 (or, to avoid duplicating it three times, extract it — and `waitForEvent`/`waitForState`'s new `AppStateView`-typed versions — into a small shared test-utility module, e.g. `packages/server/src/testHelpers.ts`, imported by all three files. Prefer this if the duplication across three files feels excessive; either approach is acceptable, but do not silently duplicate the exact same triplet of helper functions three times without at least considering the extraction).

2. In **`integration.test.ts`**, replace `baseConfig()` (lines 49-61) and `startServer(config)` (lines 63-69) with:
   ```ts
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
   ```
   Add `import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';` and `import type { StaticTableConfig } from './socketServer';` to the top of the file, alongside the existing `createServer` import.

   Then update each of the file's 4 `startServer(baseConfig(...))` call sites exactly as follows:
   - Line 91: `await startServer(baseConfig());` → `await startServer(); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 157: `await startServer(baseConfig({ gameMode: 'blackjack', blackjackDefaultBet: 25 }));` → `await startServer({ blackjackDefaultBet: 25 }); const admin = connect(); await startGameAsAdmin(admin, 'blackjack');`
   - Line 190: `await startServer(baseConfig());` → `await startServer(); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 204: `await startServer(baseConfig());` → `await startServer(); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`

   (`admin` doesn't need to be referenced again after this in most of these tests — it exists purely to start the game, matching the `socketServer.test.ts` pattern from Step 3.)

3. In **`integration-resilience.test.ts`**, replace `baseConfig()` (lines 36-48) and `startServer(config)` (lines 50-56) the same way:
   ```ts
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
   ```
   (This file's `startServer` takes `StaticTableConfig` overrides directly, unlike `integration.test.ts`'s `GameConfigValues` overrides above, because every override this file actually uses — `reconnectGraceMs` — is a static field. Same imports to add as `integration.test.ts` above.)

   Then update each of the file's 6 call sites:
   - Line 84: `await startServer(baseConfig({ reconnectGraceMs: 300 }));` → `await startServer({ reconnectGraceMs: 300 }); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 112: `await startServer(baseConfig({ reconnectGraceMs: 30 }));` → `await startServer({ reconnectGraceMs: 30 }); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 131: `await startServer(baseConfig());` → `await startServer(); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 154: `await startServer(baseConfig());` → `await startServer(); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 165: `await startServer(baseConfig());` → `await startServer(); const admin = connect(); await startGameAsAdmin(admin, 'holdem');`
   - Line 188 (`await startServer(baseConfig()); // new createServer() calls table.recoverFromLog()`): → `await startServer();` **only** — do NOT add a `startGameAsAdmin` call here. Read this test's surrounding code first: it restarts the server after a crash mid-hand specifically to exercise automatic recovery, which (per this task's Step 1 changes to `socketServer.ts`) now happens inside `createServer` itself by peeking the hand log, with no admin action involved. Adding `startGameAsAdmin` here would try to start a second, unrelated game on top of the one already recovered and get rejected with `'A game is already active'`.

4. Apply the `AppStateView`/`.table` and `server.table` → `server.getTable()!` substitutions from Step 3 everywhere they appear in both files (every `waitForEvent<TableStateView>`, every `waitForState` predicate reading `s.foo` instead of `s.table?.foo`, and every direct `server.table.*` access, including the recovery assertions at the original lines 190-191 of `integration-resilience.test.ts`, which become `server.getTable()!.handInProgress` / `server.getTable()!.holdemHand!.actingPlayerId`).

- [ ] **Step 5: Run the full server test suite**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS, all tests green. If any test hangs, check that `startGameAsAdmin`'s `waitForState` predicate matches the mode actually being started, and that the admin connection (`admin` in the worked example) is created before it's used.

- [ ] **Step 6: Run the full workspace typecheck**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/socketServer.ts packages/server/src/index.ts packages/server/src/socketServer.test.ts packages/server/src/integration.test.ts packages/server/src/integration-resilience.test.ts
git commit -m "feat(server): lobby state machine, admin login, and admin start/switch-mode"
```

---

### Task 5: Remaining admin actions — balance correction, blinds, default bet, starting balance

Task 4 already implemented and wired the `adminAdjustBalance`/`adminSetBlinds`/`adminSetDefaultBet`/`adminSetStartingBalance` handlers (they were part of the single `socketServer.ts` replacement, since splitting the file mid-edit was riskier than writing it once correctly). This task adds the test coverage those handlers still need, which Task 4 did not include.

**Files:**
- Modify: `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Consumes: `startGameAsAdmin` helper, `AppStateView`, `createServer` — all already present in this file from Task 4.

- [ ] **Step 1: Add the following tests to the `describe('socketServer', ...)` block**

```ts
  it('rejects every admin action from a socket that has not logged in', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const intruder = connect();
    const errorPromise = waitForEvent<{ message: string }>(intruder, 'error');
    intruder.emit('adminAdjustBalance', { displayName: 'alice', balance: 5000 });
    const err = await errorPromise;
    expect(err.message).toBe('Admin only');
  });

  it('adminAdjustBalance updates a non-seated player\'s persisted balance and broadcasts it', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');

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
    await waitForEvent(alice, 'state');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
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
    await waitForEvent(alice, 'state');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const firstHandState = await handStarted;
    // Default blinds are 5/10 -- pot starts at 15.
    expect(firstHandState.table!.holdem!.pots[0]?.amount).toBe(15);

    admin.emit('adminSetBlinds', { smallBlind: 50, bigBlind: 100 });
    await new Promise((r) => setTimeout(r, 20));
    // Still the same (unaffected) in-progress hand.
    expect(server.getTable()!.holdemHand!.pots[0]?.amount).toBe(15);

    // Fold out the first hand, then start a second one and check its blinds.
    server.getTable()!.holdemHand!.act('alice', 'fold');
    await new Promise((r) => setTimeout(r, 20));
    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const secondHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const secondHandState = await secondHandStarted;
    expect(secondHandState.table!.holdem!.pots[0]?.amount).toBe(150);
  });

  it('adminSetStartingBalance changes the balance a never-before-seen player joins with', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    admin.emit('adminSetStartingBalance', { defaultStartingBalance: 7000 });
    await new Promise((r) => setTimeout(r, 20));

    const carol = connect();
    carol.emit('join', { displayName: 'carol' });
    const state = await waitForEvent<AppStateView>(carol, 'state');
    expect(state.table!.seats.find((s) => s.displayName === 'carol')?.balance).toBe(7000);
  });

  it('adminSwitchMode is rejected while a hand is in progress, and succeeds once idle', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    await handStarted;

    const rejectPromise = waitForEvent<{ message: string }>(admin, 'error');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    const err = await rejectPromise;
    expect(err.message).toBe("Can't switch modes while a hand is in progress");

    server.getTable()!.holdemHand!.act('alice', 'fold');
    await new Promise((r) => setTimeout(r, 20));

    const switched = waitForState(admin, (s) => s.mode === 'blackjack');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    const state = await switched;
    expect(state.table!.gameMode).toBe('blackjack');
    // Both previous players were unseated by the switch.
    expect(state.table!.seats.every((s) => s.displayName === null)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests**

Run: `npm run test --workspace=@poker-blackjack/server -- socketServer.test.ts`
Expected: PASS, all tests including the 6 new ones.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/socketServer.test.ts
git commit -m "test(server): cover admin balance/blinds/starting-balance/switch-mode actions"
```

---

### Task 6: Frontend `SocketContext.tsx` — lobby-aware connection lifecycle

**Files:**
- Modify: `packages/frontend/src/socket/SocketContext.tsx`
- Modify: `packages/frontend/src/socket/SocketContext.test.tsx`
- Modify: `packages/frontend/src/fixtures/tableStateFixtures.ts`
- Modify: `packages/frontend/src/components/JoinScreen.tsx`

**Interfaces:**
- Consumes: `AppStateView`, `GameMode` from `@poker-blackjack/server/src/table`; all `protocol.ts` admin event names/payloads.
- Produces: updated `SocketContextValue` (`status` gains `'lobby'` and drops `'entering-name'`-as-initial-default in favor of it appearing only once a mode is active; `state: AppStateView | null`; `isAdmin: boolean`; `joinWithName` replacing `connect`; six new `admin*` functions), consumed by Task 7-9's new components and by the existing `PokerTable`/`BlackjackTable` (unchanged — they still receive the same shared props shape, just sourced from `state.table` instead of `state` directly, which Task 7's `App.tsx` change handles).

- [ ] **Step 1: Add the `makeAppState` fixture helper**

Add to the end of `packages/frontend/src/fixtures/tableStateFixtures.ts`:

```ts
import type { AppStateView } from '@poker-blackjack/server/src/table';

export function makeAppState(table: TableStateView, overrides: Partial<Omit<AppStateView, 'table'>> = {}): AppStateView {
  return {
    mode: table.gameMode,
    isAdmin: false,
    ...overrides,
    table,
  };
}

export function makeLobbyState(overrides: Partial<Omit<AppStateView, 'table'>> = {}): AppStateView {
  return {
    mode: null,
    isAdmin: false,
    table: null,
    ...overrides,
  };
}
```

(Add the `AppStateView` import to the existing import block at the top of the file rather than as a second `import` statement if your editor/linter flags duplicate imports from the same module — combine it with the existing `@poker-blackjack/server/src/table` import line.)

- [ ] **Step 2: Rewrite `SocketContext.test.tsx` for the new lifecycle**

Replace the whole file:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket, SocketProvider, DISPLAY_NAME_STORAGE_KEY } from './SocketContext';
import { makeAppState, makeLobbyState, makeWaitingState, makeHoldemPreflopState } from '../fixtures/tableStateFixtures';

// A minimal fake socket.io-client: enough surface for SocketContext to drive
// (emit/on/disconnect, plus the nested `.io` manager used for the 'reconnect' event)
// without a real network connection. Tests trigger server pushes by calling the
// captured handlers directly.
const handlers = new Map<string, (...args: unknown[]) => void>();
const ioManagerHandlers = new Map<string, (...args: unknown[]) => void>();
const emitted: { event: string; payload: unknown }[] = [];
let disconnectCalls = 0;

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
    io: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        ioManagerHandlers.set(event, handler);
      },
    },
  };
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket()),
}));

function TestConsumer() {
  const { status, state, errorMessage, displayName, isAdmin, joinWithName, leave, adminLogin } = useSocket();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="mode">{state?.mode ?? 'none'}</p>
      <p data-testid="error">{errorMessage ?? 'none'}</p>
      <p data-testid="name">{displayName ?? 'none'}</p>
      <p data-testid="isAdmin">{String(isAdmin)}</p>
      <button onClick={() => joinWithName('alice')}>join</button>
      <button onClick={() => leave()}>leave</button>
      <button onClick={() => adminLogin('secret')}>admin-login</button>
    </div>
  );
}

describe('SocketProvider', () => {
  beforeEach(() => {
    handlers.clear();
    ioManagerHandlers.clear();
    emitted.length = 0;
    disconnectCalls = 0;
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connects immediately on mount and starts in connecting', () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');
  });

  it('moves to lobby when the initial state reports no active mode', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeLobbyState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('lobby'));
  });

  it('moves to entering-name when a mode is active but no name is known yet', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
    expect(emitted.find((e) => e.event === 'join')).toBeUndefined();
  });

  it('joinWithName emits join and reaching at-table on a state event that seats us', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));

    act(() => {
      screen.getByText('join').click();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState())); // seats[0] is 'alice' per the fixture
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(screen.getByTestId('mode')).toHaveTextContent('holdem');
    expect(screen.getByTestId('name')).toHaveTextContent('alice');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });

  it('auto-rejoins with a remembered name once a mode becomes active, without a manual joinWithName call', async () => {
    sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, 'alice');
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('name')).toHaveTextContent('alice');

    act(() => {
      handlers.get('state')?.(makeLobbyState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('lobby'));

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] }))); // mode active, not yet seated
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
  });

  it('adminLogin emits adminLogin, and isAdmin reflects a successful state broadcast', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('admin-login').click();
    });
    expect(emitted).toContainEqual({ event: 'adminLogin', payload: { passphrase: 'secret' } });

    act(() => {
      handlers.get('state')?.(makeLobbyState({ isAdmin: true }));
    });
    await waitFor(() => expect(screen.getByTestId('isAdmin')).toHaveTextContent('true'));
  });

  it('a failed adminLoginResult surfaces an error message', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('adminLoginResult')?.({ success: false });
    });
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Incorrect admin passphrase'));
  });

  it('an error while at-table stays at-table and does not disconnect', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");
    expect(disconnectCalls).toBe(0);
  });

  it('disconnect while at-table moves to reconnecting, and the manager reconnect event re-joins', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('disconnect')?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');

    emitted.length = 0;
    act(() => {
      ioManagerHandlers.get('reconnect')?.();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
  });

  it('a fresh state event clears a previously-shown in-game error', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('leave() while no hand is in progress emits leave and clears the session', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toContainEqual({ event: 'leave', payload: undefined });
    expect(disconnectCalls).toBe(0); // the socket itself stays connected -- we're still in the lobby, not gone
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('name')).toHaveTextContent('none');
  });

  it('leave() while a hand is in progress is a no-op, preserving the session (defense in depth alongside the UI gate)', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState())); // handInProgress: true
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toEqual([]);
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });
});
```

- [ ] **Step 3: Rewrite `SocketContext.tsx`**

Replace the whole file:

```tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ErrorPayload,
  AdminLoginResultPayload,
} from '@poker-blackjack/server/src/protocol';
import type { AppStateView, GameMode } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';

export type ConnectionStatus = 'connecting' | 'lobby' | 'entering-name' | 'at-table' | 'reconnecting' | 'error';

export const DISPLAY_NAME_STORAGE_KEY = 'poker-blackjack:displayName';

export interface SocketContextValue {
  status: ConnectionStatus;
  state: AppStateView | null;
  errorMessage: string | null;
  displayName: string | null;
  isAdmin: boolean;
  joinWithName: (displayName: string) => void;
  sendReady: () => void;
  sendAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  leave: () => void;
  adminLogin: (passphrase: string) => void;
  adminStartGame: (mode: GameMode) => void;
  adminSwitchMode: (mode: GameMode) => void;
  adminAdjustBalance: (displayName: string, balance: number) => void;
  adminSetBlinds: (smallBlind: number, bigBlind: number) => void;
  adminSetDefaultBet: (blackjackDefaultBet: number) => void;
  adminSetStartingBalance: (defaultStartingBalance: number) => void;
}

export const SocketContext = createContext<SocketContextValue | null>(null);

export function useSocket(): SocketContextValue {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return value;
}

export function SocketProvider({ serverUrl, children }: { serverUrl: string; children: ReactNode }) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const displayNameRef = useRef<string | null>(null);
  const statusRef = useRef<ConnectionStatus>('connecting');
  const joinedRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [state, setState] = useState<AppStateView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const storedName = sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
    if (storedName) {
      displayNameRef.current = storedName;
      setDisplayName(storedName);
    }

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl);
    socketRef.current = socket;

    socket.on('state', (nextState: AppStateView) => {
      setState(nextState);
      setErrorMessage(null);

      const mySeated = nextState.table?.seats.some((s) => s.displayName === displayNameRef.current) ?? false;
      if (mySeated) {
        joinedRef.current = true;
        setStatus('at-table');
        if (displayNameRef.current) {
          sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayNameRef.current);
        }
      } else if (nextState.mode === null) {
        joinedRef.current = false;
        setStatus('lobby');
      } else if (displayNameRef.current && !joinedRef.current) {
        // A mode just became active (server start already resumed one, a
        // fresh admin start, or an admin switch) and we already know our
        // name from a prior session -- rejoin automatically instead of
        // making a returning player retype it.
        joinedRef.current = true;
        socket.emit('join', { displayName: displayNameRef.current });
      } else {
        joinedRef.current = false;
        setStatus('entering-name');
      }
    });

    socket.on('adminLoginResult', ({ success }: AdminLoginResultPayload) => {
      if (!success) {
        setErrorMessage('Incorrect admin passphrase');
      }
    });

    socket.on('error', (payload: ErrorPayload) => {
      setErrorMessage(payload.message);
      // statusRef (not the closed-over `status`) is read here deliberately --
      // this handler is registered once per mount and would otherwise always
      // see the status from that moment, never any status reached afterward
      // (e.g. at-table), incorrectly kicking a connected player into the
      // error screen on any later in-game rejection.
      if (statusRef.current !== 'at-table') {
        setStatus('error');
        socket.disconnect();
        socketRef.current = null;
      }
    });

    socket.on('disconnect', () => {
      if (statusRef.current === 'at-table') {
        setStatus('reconnecting');
      }
    });

    socket.io.on('reconnect', () => {
      joinedRef.current = false;
      const name = displayNameRef.current;
      if (name) {
        socket.emit('join', { displayName: name });
      }
    });

    return () => {
      socket.disconnect();
    };
    // Runs once on mount: opens the connection immediately (so lobby/table
    // state can be observed before a display name is known) and tears the
    // socket down on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinWithName(name: string) {
    displayNameRef.current = name;
    setDisplayName(name);
    setErrorMessage(null);
    joinedRef.current = true;
    socketRef.current?.emit('join', { displayName: name });
  }

  function sendReady() {
    socketRef.current?.emit('ready');
  }

  function sendAction(action: PlayerAction | HoldemAction, amount?: number) {
    socketRef.current?.emit('action', { action, amount });
  }

  function leave() {
    // Defense in depth alongside GameTable's own !handInProgress button gate:
    // the server rejects `leave` mid-hand and this function has no way to
    // await that rejection (no ack protocol) before it has already cleared
    // local session state -- so refuse locally whenever we already know a
    // hand is in progress.
    if (state?.table?.handInProgress) {
      return;
    }
    socketRef.current?.emit('leave');
    sessionStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    displayNameRef.current = null;
    joinedRef.current = false;
    setDisplayName(null);
    setErrorMessage(null);
    // The socket itself stays connected -- leaving a table returns to the
    // lobby/join screen, it does not disconnect from the server. The next
    // 'state' broadcast (triggered by the server's own leave handling) sets
    // status to 'lobby' or 'entering-name' as appropriate.
  }

  function adminLogin(passphrase: string) {
    socketRef.current?.emit('adminLogin', { passphrase });
  }

  function adminStartGame(mode: GameMode) {
    socketRef.current?.emit('adminStartGame', { mode });
  }

  function adminSwitchMode(mode: GameMode) {
    socketRef.current?.emit('adminSwitchMode', { mode });
  }

  function adminAdjustBalance(name: string, balance: number) {
    socketRef.current?.emit('adminAdjustBalance', { displayName: name, balance });
  }

  function adminSetBlinds(smallBlind: number, bigBlind: number) {
    socketRef.current?.emit('adminSetBlinds', { smallBlind, bigBlind });
  }

  function adminSetDefaultBet(blackjackDefaultBet: number) {
    socketRef.current?.emit('adminSetDefaultBet', { blackjackDefaultBet });
  }

  function adminSetStartingBalance(defaultStartingBalance: number) {
    socketRef.current?.emit('adminSetStartingBalance', { defaultStartingBalance });
  }

  const value: SocketContextValue = {
    status,
    state,
    errorMessage,
    displayName,
    isAdmin: state?.isAdmin ?? false,
    joinWithName,
    sendReady,
    sendAction,
    leave,
    adminLogin,
    adminStartGame,
    adminSwitchMode,
    adminAdjustBalance,
    adminSetBlinds,
    adminSetDefaultBet,
    adminSetStartingBalance,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
```

- [ ] **Step 4: Update `JoinScreen.tsx` to call `joinWithName` instead of `connect`**

In `packages/frontend/src/components/JoinScreen.tsx`, change line 5 (`const { status, errorMessage, connect } = useSocket();`) to:

```tsx
  const { status, errorMessage, joinWithName } = useSocket();
```

And change line 14 (`connect(trimmed);`) to:

```tsx
    joinWithName(trimmed);
```

`status === 'connecting'` no longer applies inside `JoinScreen` (that status is now handled one level up, before `JoinScreen` ever renders — see Task 7), so the `connecting` variable at line 17 (`const connecting = status === 'connecting';`) is now always `false` while this component is mounted. Leave the variable and its usages (`disabled={connecting}` etc.) in place rather than removing them — they're harmless dead weight for one component and removing them isn't load-bearing for this task; Task 7 is a better place to reconsider `JoinScreen`'s props/status coupling if it comes up during that task's own review.

- [ ] **Step 5: Run the frontend test suite**

Run: `npm run test --workspace=@poker-blackjack/frontend -- SocketContext`
Expected: PASS.

- [ ] **Step 6: Run the full frontend suite and typecheck**

Run: `npm run test --workspace=@poker-blackjack/frontend` and `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: The full suite will NOT pass yet — `App.test.tsx`, `GameTable`/`PokerTable`/`BlackjackTable` tests that render through `<App />` (if any do; most likely just `App.test.tsx`) will fail because `App.tsx` still calls the old `useSocket()` shape. Confirm failures are isolated to `App.test.tsx` and that `SocketContext.test.tsx`, `JoinScreen.test.tsx`, `GameTable.test.tsx`, `PokerTable.test.tsx`, `BlackjackTable.test.tsx` are all green (the latter three render their components directly with props, not through `SocketContext`, so they're unaffected). Task 7 fixes `App.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/socket/SocketContext.tsx packages/frontend/src/socket/SocketContext.test.tsx packages/frontend/src/fixtures/tableStateFixtures.ts packages/frontend/src/components/JoinScreen.tsx
git commit -m "feat(frontend): rework SocketContext for lobby-aware AppStateView"
```

---

### Task 7: `App.tsx` routing + `AdminEntry.tsx`

**Files:**
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/App.test.tsx`
- Create: `packages/frontend/src/components/AdminEntry.tsx`
- Create: `packages/frontend/src/components/AdminEntry.test.tsx`

**Interfaces:**
- Consumes: `SocketContextValue` (Task 6) — `status`, `state`, `isAdmin`, `adminLogin`, `errorMessage`, `displayName`, `sendReady`, `sendAction`, `leave`.
- Produces: `AdminEntry` component, rendered persistently across every screen; used again unchanged by Tasks 8-9 (they don't need to import it, just be aware it's always present).

- [ ] **Step 1: Write `AdminEntry.test.tsx`**

Create `packages/frontend/src/components/AdminEntry.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminEntry } from './AdminEntry';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value: SocketContextValue = {
    status: 'lobby',
    state: null,
    errorMessage: null,
    displayName: null,
    isAdmin: false,
    joinWithName: vi.fn(),
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    adminLogin: vi.fn(),
    adminStartGame: vi.fn(),
    adminSwitchMode: vi.fn(),
    adminAdjustBalance: vi.fn(),
    adminSetBlinds: vi.fn(),
    adminSetDefaultBet: vi.fn(),
    adminSetStartingBalance: vi.fn(),
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <AdminEntry />
    </SocketContext.Provider>
  );
  return value;
}

describe('AdminEntry', () => {
  it('shows an Admin button and no form initially', () => {
    renderWithSocket();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Admin passphrase')).not.toBeInTheDocument();
  });

  it('clicking Admin reveals the passphrase form, and submitting calls adminLogin', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const input = screen.getByLabelText('Admin passphrase');
    fireEvent.change(input, { target: { value: 'let-me-in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(value.adminLogin).toHaveBeenCalledWith('let-me-in');
  });

  it('renders an unlocked indicator instead of the login form once isAdmin is true', () => {
    renderWithSocket({ isAdmin: true });
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows an error message from context after a failed login attempt', () => {
    renderWithSocket({ errorMessage: 'Incorrect admin passphrase' });
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.getByText('Incorrect admin passphrase')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- AdminEntry`
Expected: FAIL — `Cannot find module './AdminEntry'`.

- [ ] **Step 3: Implement `AdminEntry.tsx`**

Create `packages/frontend/src/components/AdminEntry.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';

export function AdminEntry() {
  const { isAdmin, adminLogin, errorMessage } = useSocket();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (passphrase.trim().length === 0) {
      return;
    }
    adminLogin(passphrase.trim());
    setPassphrase('');
  }

  if (isAdmin) {
    return <p className="fixed right-2 top-2 z-50 text-xs font-medium text-emerald-400">Admin</p>;
  }

  return (
    <div className="fixed right-2 top-2 z-50 text-sm text-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium"
      >
        Admin
      </button>
      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-1 flex flex-col gap-1 rounded-md border border-slate-600 bg-slate-800 p-2"
        >
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase"
            aria-label="Admin passphrase"
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
          />
          <button type="submit" className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium">
            Unlock
          </button>
          {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- AdminEntry`
Expected: PASS, 4/4.

- [ ] **Step 5: Rewrite `App.tsx`**

Replace the whole file:

```tsx
import { MotionConfig } from 'framer-motion';
import { SocketProvider, useSocket, type ConnectionStatus } from './socket/SocketContext';
import type { TableStateView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import { AdminEntry } from './components/AdminEntry';
import { JoinScreen } from './components/JoinScreen';
import { PokerTable } from './components/PokerTable';
import { BlackjackTable } from './components/BlackjackTable';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

function TableView({
  table,
  displayName,
  connectionStatus,
  errorMessage,
  onReady,
  onAction,
  onLeave,
}: {
  table: TableStateView;
  displayName: string | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  onReady: () => void;
  onAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  onLeave: () => void;
}) {
  const mySeatIndex =
    table.seats.find((s) => s.displayName !== null && s.displayName === displayName)?.seatIndex ?? null;
  const sharedProps = {
    seats: table.seats,
    mySeatIndex,
    connectionStatus,
    handInProgress: table.handInProgress,
    errorMessage,
    onReady,
    onLeave,
  };

  return table.gameMode === 'holdem' ? (
    <PokerTable {...sharedProps} holdem={table.holdem} onAction={onAction} />
  ) : (
    <BlackjackTable
      {...sharedProps}
      activeSeatIndex={table.activeSeatIndex}
      blackjackRounds={table.blackjackRounds}
      onAction={onAction}
    />
  );
}

function AppContent() {
  const { status, state, errorMessage, displayName, sendReady, sendAction, leave } = useSocket();

  if (status === 'connecting' || status === 'error' || !state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <p>Connecting&hellip;</p>
      </main>
    );
  }

  return (
    <>
      <AdminEntry />
      {status === 'lobby' && <Lobby />}
      {status === 'entering-name' && <JoinScreen />}
      {(status === 'at-table' || status === 'reconnecting') && state.table && (
        <TableView
          table={state.table}
          displayName={displayName}
          connectionStatus={status}
          errorMessage={errorMessage}
          onReady={sendReady}
          onAction={sendAction}
          onLeave={leave}
        />
      )}
    </>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SocketProvider serverUrl={SERVER_URL}>
        <AppContent />
      </SocketProvider>
    </MotionConfig>
  );
}

export default App;
```

Note: `App.tsx` above references `<Lobby />` but does not yet import it (Task 8 creates `Lobby.tsx` and adds that import). Until Task 8 lands, this file will not compile — that is expected and consistent with how Task 3/4 were split; the two tasks are meant to be reviewed together if a reviewer runs the full typecheck between them, exactly as noted for Task 3. Do not add a placeholder `Lobby` component here to make it compile early — Task 8's job is to build the real one, and a throwaway stand-in would just be code Task 8 immediately deletes.

- [ ] **Step 6: Rewrite `App.test.tsx` for the new routing**

Read the existing `packages/frontend/src/App.test.tsx` first to see its current mocking approach (it almost certainly mocks `useSocket` from `./socket/SocketContext`, similar in spirit to `AdminEntry.test.tsx`'s `SocketContext.Provider` approach above, or mocks the whole module with `vi.mock`). Rewrite it to cover the new branching in `AppContent`, using whichever mocking style the existing file already used (prefer minimal diff over introducing a second convention). At minimum, cover:

- `status: 'connecting'` renders the connecting message, not `Lobby`/`JoinScreen`/a table.
- `status: 'lobby'` renders `Lobby` is skipped here since `Lobby` doesn't exist until Task 8 — for this task, assert only that neither `JoinScreen` nor a table renders when `status === 'lobby'` (the `<Lobby />` element itself will throw/fail to render until Task 8's file exists, so this task's `App.test.tsx` update should NOT attempt to render through the `'lobby'` branch yet; skip/omit that specific case here and let Task 8 add it once `Lobby.tsx` exists).
- `status: 'entering-name'` renders `JoinScreen`.
- `status: 'at-table'` with a holdem `state.table` renders `PokerTable` (assert on some holdem-specific text/testid already used by the original test).
- `status: 'at-table'` with a blackjack `state.table` renders `BlackjackTable`.
- `AdminEntry` renders regardless of `status` (once past the connecting screen) — assert its "Admin" button/text is present alongside whichever other component rendered.

Since this task cannot fully verify the `'lobby'` branch without `Lobby.tsx` existing, mark that gap explicitly with a one-line code comment in the test file (e.g. `// 'lobby' status is covered once Lobby.tsx exists -- see Task 8`) so it isn't mistaken for an oversight, and add the actual lobby-rendering test case in Task 8 instead.

- [ ] **Step 7: Run the frontend suite**

Run: `npm run test --workspace=@poker-blackjack/frontend`
Expected: All tests pass except any that specifically exercise `status === 'lobby'` rendering through `<App />` (none should, per Step 6's scoping) — everything else, including `AdminEntry.test.tsx`, `SocketContext.test.tsx`, and the rewritten `App.test.tsx`, should be green. `npm run typecheck --workspace=@poker-blackjack/frontend` will still fail on the missing `Lobby` import — confirm that's the only failure before moving to Task 8.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx packages/frontend/src/components/AdminEntry.tsx packages/frontend/src/components/AdminEntry.test.tsx
git commit -m "feat(frontend): route App by lobby/entering-name/at-table status, add AdminEntry"
```

---

### Task 8: `Lobby.tsx`

**Files:**
- Create: `packages/frontend/src/components/Lobby.tsx`
- Create: `packages/frontend/src/components/Lobby.test.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `SocketContextValue` — `state`, `isAdmin`, `adminStartGame`, `adminSwitchMode`.

- [ ] **Step 1: Write `Lobby.test.tsx`**

Create `packages/frontend/src/components/Lobby.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Lobby } from './Lobby';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { makeLobbyState, makeAppState, makeWaitingState } from '../fixtures/tableStateFixtures';

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value: SocketContextValue = {
    status: 'lobby',
    state: makeLobbyState(),
    errorMessage: null,
    displayName: null,
    isAdmin: false,
    joinWithName: vi.fn(),
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    adminLogin: vi.fn(),
    adminStartGame: vi.fn(),
    adminSwitchMode: vi.fn(),
    adminAdjustBalance: vi.fn(),
    adminSetBlinds: vi.fn(),
    adminSetDefaultBet: vi.fn(),
    adminSetStartingBalance: vi.fn(),
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <Lobby />
    </SocketContext.Provider>
  );
  return value;
}

describe('Lobby', () => {
  it('shows a waiting message and no mode picker for a non-admin with no active mode', () => {
    renderWithSocket({ state: makeLobbyState() });
    expect(screen.getByText(/waiting for a game to start/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start poker night/i })).not.toBeInTheDocument();
  });

  it('shows the mode picker for an admin with no active mode', () => {
    const value = renderWithSocket({ isAdmin: true, state: makeLobbyState({ isAdmin: true }) });
    fireEvent.click(screen.getByRole('button', { name: /start poker night/i }));
    expect(value.adminStartGame).toHaveBeenCalledWith('holdem');
  });

  it('shows switch buttons (not start buttons) for an admin when a mode is already active', () => {
    const value = renderWithSocket({
      isAdmin: true,
      state: makeAppState(makeWaitingState(), { isAdmin: true }),
    });
    expect(screen.queryByRole('button', { name: /start blackjack night/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /switch to blackjack/i }));
    expect(value.adminSwitchMode).toHaveBeenCalledWith('blackjack');
  });

  it("disables the button for whichever mode is already active", () => {
    renderWithSocket({ isAdmin: true, state: makeAppState(makeWaitingState(), { isAdmin: true }) });
    expect(screen.getByRole('button', { name: /switch to poker/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- Lobby.test`
Expected: FAIL — `Cannot find module './Lobby'`.

- [ ] **Step 3: Implement `Lobby.tsx`**

Create `packages/frontend/src/components/Lobby.tsx`:

```tsx
import { useSocket } from '../socket/SocketContext';

export function Lobby() {
  const { state, isAdmin, adminStartGame, adminSwitchMode } = useSocket();
  const mode = state?.mode ?? null;

  function choose(target: 'holdem' | 'blackjack') {
    if (mode === null) {
      adminStartGame(target);
    } else {
      adminSwitchMode(target);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-white">
      <h1 className="text-2xl font-semibold">Poker &amp; Blackjack</h1>
      {mode === null ? (
        <p className="text-slate-300">Waiting for a game to start&hellip;</p>
      ) : (
        <p className="text-slate-300">
          A {mode === 'holdem' ? 'Poker' : 'Blackjack'} game is active &mdash; switch below if you'd like.
        </p>
      )}

      {isAdmin && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => choose('holdem')}
            disabled={mode === 'holdem'}
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium disabled:opacity-50"
          >
            {mode === null ? 'Start Poker Night' : 'Switch to Poker'}
          </button>
          <button
            type="button"
            onClick={() => choose('blackjack')}
            disabled={mode === 'blackjack'}
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium disabled:opacity-50"
          >
            {mode === null ? 'Start Blackjack Night' : 'Switch to Blackjack'}
          </button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- Lobby.test`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire `Lobby` into `App.tsx`**

In `packages/frontend/src/App.tsx`, add the import (alongside the other component imports):

```tsx
import { Lobby } from './components/Lobby';
```

- [ ] **Step 6: Add the deferred lobby-rendering case to `App.test.tsx`**

Add the test case Task 7 Step 6 explicitly deferred: with `status: 'lobby'`, `AppContent` renders `Lobby` (assert on the "waiting for a game to start" text or the mode-picker buttons for an admin), not `JoinScreen` or a table.

- [ ] **Step 7: Run the full frontend suite and typecheck**

Run: `npm run test --workspace=@poker-blackjack/frontend` and `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: PASS, both clean.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/Lobby.tsx packages/frontend/src/components/Lobby.test.tsx packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx
git commit -m "feat(frontend): add Lobby with admin mode picker"
```

---

### Task 9: `AdminPanel.tsx`

**Files:**
- Create: `packages/frontend/src/components/AdminPanel.tsx`
- Create: `packages/frontend/src/components/AdminPanel.test.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `SocketContextValue` — `state`, `isAdmin`, `adminAdjustBalance`, `adminSetBlinds`, `adminSetDefaultBet`, `adminSetStartingBalance`.

This is deliberately built as an independent fixed-position overlay rather than integrated into `GameTable`/`PokerTable`/`BlackjackTable`'s existing rail/felt-slot layout — that layout was carefully tuned across several review rounds in the table-layout-redesign work (see `HANDOFF.md`), and inserting a new element into it risks reopening CSS issues already hard-won there. A fixed corner panel achieves the same functional goal with zero risk to that layout.

- [ ] **Step 1: Write `AdminPanel.test.tsx`**

Create `packages/frontend/src/components/AdminPanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminPanel } from './AdminPanel';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { makeAppState, makeWaitingState, makeLobbyState } from '../fixtures/tableStateFixtures';

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value: SocketContextValue = {
    status: 'at-table',
    state: makeAppState(makeWaitingState(), { isAdmin: true }),
    errorMessage: null,
    displayName: 'alice',
    isAdmin: true,
    joinWithName: vi.fn(),
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    adminLogin: vi.fn(),
    adminStartGame: vi.fn(),
    adminSwitchMode: vi.fn(),
    adminAdjustBalance: vi.fn(),
    adminSetBlinds: vi.fn(),
    adminSetDefaultBet: vi.fn(),
    adminSetStartingBalance: vi.fn(),
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <AdminPanel />
    </SocketContext.Provider>
  );
  return value;
}

describe('AdminPanel', () => {
  it('renders nothing when not admin', () => {
    const { container } = render(
      <SocketContext.Provider
        value={{
          status: 'at-table',
          state: makeAppState(makeWaitingState()),
          errorMessage: null,
          displayName: 'alice',
          isAdmin: false,
          joinWithName: vi.fn(),
          sendReady: vi.fn(),
          sendAction: vi.fn(),
          leave: vi.fn(),
          adminLogin: vi.fn(),
          adminStartGame: vi.fn(),
          adminSwitchMode: vi.fn(),
          adminAdjustBalance: vi.fn(),
          adminSetBlinds: vi.fn(),
          adminSetDefaultBet: vi.fn(),
          adminSetStartingBalance: vi.fn(),
        }}
      >
        <AdminPanel />
      </SocketContext.Provider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when admin but no table is active', () => {
    const { container } = renderWithSocket({ state: makeLobbyState({ isAdmin: true }) });
    expect(container).toBeEmptyDOMElement();
  });

  it('toggles open, and submitting the balance form calls adminAdjustBalance with the selected player and entered value', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    fireEvent.change(screen.getByLabelText(/select player/i) ?? screen.getByRole('combobox'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('New balance'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /save balance/i }));
    expect(value.adminAdjustBalance).toHaveBeenCalledWith('alice', 5000);
  });

  it('shows blind fields for holdem and calls adminSetBlinds', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    fireEvent.change(screen.getByLabelText('Small blind'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Big blind'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /save blinds/i }));
    expect(value.adminSetBlinds).toHaveBeenCalledWith(50, 100);
    expect(screen.queryByLabelText('Default bet')).not.toBeInTheDocument();
  });

  it('shows the default-bet field for blackjack instead of blinds, and calls adminSetDefaultBet', () => {
    const value = renderWithSocket({
      state: makeAppState(makeWaitingState({ gameMode: 'blackjack' }), { isAdmin: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    expect(screen.queryByLabelText('Small blind')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Default bet'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /save default bet/i }));
    expect(value.adminSetDefaultBet).toHaveBeenCalledWith(40);
  });

  it('calls adminSetStartingBalance from its own form', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    fireEvent.change(screen.getByLabelText('Starting balance for new joiners'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: /save starting balance/i }));
    expect(value.adminSetStartingBalance).toHaveBeenCalledWith(2000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- AdminPanel.test`
Expected: FAIL — `Cannot find module './AdminPanel'`.

- [ ] **Step 3: Implement `AdminPanel.tsx`**

Create `packages/frontend/src/components/AdminPanel.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';

export function AdminPanel() {
  const { state, isAdmin, adminAdjustBalance, adminSetBlinds, adminSetDefaultBet, adminSetStartingBalance } =
    useSocket();
  const [open, setOpen] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [targetBalance, setTargetBalance] = useState('');
  const [smallBlind, setSmallBlind] = useState('');
  const [bigBlind, setBigBlind] = useState('');
  const [defaultBet, setDefaultBet] = useState('');
  const [startingBalance, setStartingBalance] = useState('');

  if (!isAdmin || !state?.table) {
    return null;
  }
  const table = state.table;
  const seatedNames = table.seats
    .map((s) => s.displayName)
    .filter((name): name is string => name !== null);

  function handleAdjustBalance(event: FormEvent) {
    event.preventDefault();
    const balance = Number(targetBalance);
    if (targetName.trim().length === 0 || Number.isNaN(balance)) {
      return;
    }
    adminAdjustBalance(targetName, balance);
    setTargetBalance('');
  }

  function handleSetBlinds(event: FormEvent) {
    event.preventDefault();
    const sb = Number(smallBlind);
    const bb = Number(bigBlind);
    if (Number.isNaN(sb) || Number.isNaN(bb)) {
      return;
    }
    adminSetBlinds(sb, bb);
    setSmallBlind('');
    setBigBlind('');
  }

  function handleSetDefaultBet(event: FormEvent) {
    event.preventDefault();
    const bet = Number(defaultBet);
    if (Number.isNaN(bet)) {
      return;
    }
    adminSetDefaultBet(bet);
    setDefaultBet('');
  }

  function handleSetStartingBalance(event: FormEvent) {
    event.preventDefault();
    const balance = Number(startingBalance);
    if (Number.isNaN(balance)) {
      return;
    }
    adminSetStartingBalance(balance);
    setStartingBalance('');
  }

  return (
    <div className="fixed bottom-2 right-2 z-50 text-sm text-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-slate-700 px-3 py-1.5 font-medium"
      >
        {open ? 'Close admin panel' : 'Admin panel'}
      </button>
      {open && (
        <div className="mt-2 flex w-64 flex-col gap-3 rounded-md border border-slate-600 bg-slate-800 p-3">
          <form onSubmit={handleAdjustBalance} className="flex flex-col gap-1">
            <label htmlFor="admin-balance-name" className="text-xs text-slate-400">
              Correct a player's balance
            </label>
            <select
              id="admin-balance-name"
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            >
              <option value="">Select player</option>
              {seatedNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={targetBalance}
              onChange={(event) => setTargetBalance(event.target.value)}
              placeholder="New balance"
              aria-label="New balance"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Save balance
            </button>
          </form>

          {table.gameMode === 'holdem' && (
            <form onSubmit={handleSetBlinds} className="flex flex-col gap-1">
              <p className="text-xs text-slate-400">Blinds (next hand)</p>
              <input
                type="number"
                value={smallBlind}
                onChange={(event) => setSmallBlind(event.target.value)}
                placeholder="Small blind"
                aria-label="Small blind"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <input
                type="number"
                value={bigBlind}
                onChange={(event) => setBigBlind(event.target.value)}
                placeholder="Big blind"
                aria-label="Big blind"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
                Save blinds
              </button>
            </form>
          )}

          {table.gameMode === 'blackjack' && (
            <form onSubmit={handleSetDefaultBet} className="flex flex-col gap-1">
              <label htmlFor="admin-default-bet" className="text-xs text-slate-400">
                Default bet (next hand)
              </label>
              <input
                id="admin-default-bet"
                type="number"
                value={defaultBet}
                onChange={(event) => setDefaultBet(event.target.value)}
                aria-label="Default bet"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
                Save default bet
              </button>
            </form>
          )}

          <form onSubmit={handleSetStartingBalance} className="flex flex-col gap-1">
            <label htmlFor="admin-starting-balance" className="text-xs text-slate-400">
              Starting balance for new joiners
            </label>
            <input
              id="admin-starting-balance"
              type="number"
              value={startingBalance}
              onChange={(event) => setStartingBalance(event.target.value)}
              aria-label="Starting balance for new joiners"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Save starting balance
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- AdminPanel.test`
Expected: PASS, 6/6.

- [ ] **Step 5: Wire `AdminPanel` into `App.tsx`**

In `packages/frontend/src/App.tsx`, add the import:

```tsx
import { AdminPanel } from './components/AdminPanel';
```

And render it inside `AppContent`'s returned fragment, after the `TableView` block:

```tsx
      {(status === 'at-table' || status === 'reconnecting') && state.table && (
        <TableView
          table={state.table}
          displayName={displayName}
          connectionStatus={status}
          errorMessage={errorMessage}
          onReady={sendReady}
          onAction={sendAction}
          onLeave={leave}
        />
      )}
      <AdminPanel />
```

(`AdminPanel` already returns `null` unless `isAdmin && state.table`, so rendering it unconditionally here is safe and matches the same pattern `AdminEntry` uses.)

- [ ] **Step 6: Add an `App.test.tsx` case for the admin panel appearing at-table**

Add a test asserting that when `status: 'at-table'` and the mocked `useSocket`/context reports `isAdmin: true`, the "Admin panel" button (from `AdminPanel`) is present alongside the table.

- [ ] **Step 7: Run the full frontend suite and typecheck**

Run: `npm run test --workspace=@poker-blackjack/frontend` and `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: PASS, both fully clean — this is the first point since Task 6 where the entire frontend workspace is green again.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/AdminPanel.tsx packages/frontend/src/components/AdminPanel.test.tsx packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx
git commit -m "feat(frontend): add AdminPanel for balance/blinds/bet/starting-balance controls"
```

---

### Task 10: End-to-end integration test

**Files:**
- Modify: `packages/server/src/integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5 (server-side only — this is a server integration test, matching the existing file's scope, which does not spin up the React frontend).

- [ ] **Step 1: Add the scripted scenario**

Add a new test to the existing `describe('integration: happy path', ...)` block in `packages/server/src/integration.test.ts` (reuse the file's existing `startServer`/`connect`/`waitForEvent`/`waitForState`/`startGameAsAdmin` helpers, already updated by Task 4):

```ts
  it('admin starts a game, players join, admin changes blinds mid-session, and only the next hand uses them', async () => {
    await startServer();

    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForEvent(alice, 'state');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForEvent(bob, 'state');

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const firstHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const firstHandState = await firstHandStarted;
    expect(firstHandState.table!.holdem!.pots[0]?.amount).toBe(15); // default 5/10 blinds

    admin.emit('adminSetBlinds', { smallBlind: 25, bigBlind: 50 });
    await new Promise((r) => setTimeout(r, 20));

    // The already-in-progress hand is unaffected -- fold it out.
    expect(server.getTable()!.holdemHand!.pots[0]?.amount).toBe(15);
    server.getTable()!.holdemHand!.act('alice', 'fold');
    await new Promise((r) => setTimeout(r, 20));

    alice.emit('ready');
    await waitForEvent(alice, 'state');
    const secondHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const secondHandState = await secondHandStarted;
    expect(secondHandState.table!.holdem!.pots[0]?.amount).toBe(75); // 25 + 50, the new blinds
  });
```

- [ ] **Step 2: Run the test**

Run: `npm run test --workspace=@poker-blackjack/server -- integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full monorepo suite and typecheck**

Run: `npm test` and `npm run typecheck` from the repo root.
Expected: PASS, fully clean across all three workspaces.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/integration.test.ts
git commit -m "test(server): end-to-end lobby/admin scenario -- start, join, mid-session blind change"
```
