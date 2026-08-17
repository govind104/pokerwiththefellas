# Local Real-Time Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Socket.IO server (`packages/server`) that drives one live table of either Blackjack or Texas Hold'em using `@poker-blackjack/game-engine` unchanged, with local chip-balance persistence and crash-recoverable in-progress-hand state.

**Architecture:** One `Table` class holds all live state for a single hardcoded table and orchestrates seats, turns, and settlement. For Hold'em it drives one shared `HoldemHand` instance; for Blackjack — whose engine is inherently single-player — it drives one independent `BlackjackRound` per seated player. Two local storage adapters sit behind interfaces (`PlayerStore` for balances, `HandLog` for crash recovery) so the persistence layer can be swapped without touching `Table` or the engines. A thin Socket.IO layer (`socketServer.ts`) translates client events into `Table` calls and broadcasts a per-recipient-filtered state snapshot after every change.

**Tech Stack:** Node.js, TypeScript (strict, ESM), Socket.IO server + client, Vitest, `@poker-blackjack/game-engine` (workspace dependency).

## Global Constraints

- New workspace member `packages/server`, package name `@poker-blackjack/server`, matching `packages/game-engine`'s `package.json`/`tsconfig.json` conventions exactly: `"type": "module"`, `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`.
- Dependency on the engine: `"@poker-blackjack/game-engine": "*"` (npm workspace local link).
- Runtime dependency: `"socket.io": "^4.8.0"`. Dev dependencies: `"socket.io-client": "^4.8.0"`, `"vitest": "^3.0.0"`, `"typescript": "^5.7.0"` (matching `game-engine`'s floors).
- Seat capacity is 8, uniform for both games (no separate Blackjack limit).
- The reconnect grace window is a configured duration, not a hardcoded constant — every test that exercises it must pass a short value (tens of milliseconds), never the real ~2-minute production value, and must use a real `setTimeout` (no fake-timer mocking) so async code around the timer behaves normally in tests.
- A connecting player's display name is their sole identity: it is the `PlayerStore` key and, for Hold'em, is passed directly as `HoldemHand`'s `playerId`.
- `PlayerStore` and `HandLog` methods are all `Promise`-returning, even where the local implementation could be synchronous — `PlayerStore`'s eventual DynamoDB implementation (Plan 6) is inherently network-bound.
- `BlackjackRound`'s constructor takes a single `initialBet: number` and has no multiplayer concept — a multi-seat Blackjack table is N independent `BlackjackRound` instances, one per seated player, each with its own shoe and dealer outcome. `Table` owns turn order across seats itself; the engine has no cross-player concept to defer to.
- `Table` builds its own 6-deck Blackjack shoe via `shuffle([...Array(6)].flatMap(() => createDeck()), random)` rather than the package-internal `createShoe` (not part of the public API) — this also means the exact shoe is available to log for crash recovery.
- Every exported function/class from `@poker-blackjack/game-engine` used in this plan is used exactly as declared in `packages/game-engine/src/index.ts`; do not assume any method, field, or export not listed there exists.
- No manual or UI client of any kind. All behavior is proven via scripted `socket.io-client` connections in Vitest.
- Never use `git add -A` or `git add .` when committing — stage the exact files listed in each step.

---

### Task 1: Workspace scaffold + `PlayerStore`

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/playerStore.ts`
- Test: `packages/server/src/playerStore.test.ts`

**Interfaces:**
- Produces: `interface PlayerStore { getBalance(displayName: string): Promise<number>; setBalance(displayName: string, balance: number): Promise<void>; }`, `class JsonPlayerStore implements PlayerStore` with `constructor(filePath: string, defaultStartingBalance: number)`.

- [ ] **Step 1: Create the package scaffold**

`packages/server/package.json`:

```json
{
  "name": "@poker-blackjack/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@poker-blackjack/game-engine": "*",
    "socket.io": "^4.8.0"
  },
  "devDependencies": {
    "socket.io-client": "^4.8.0",
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/server/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

Run: `npm install` (from the repo root, so the new workspace member and its dependencies are linked/installed)
Expected: completes with no errors; `node_modules/@poker-blackjack/server` and `node_modules/socket.io` exist.

- [ ] **Step 2: Write the failing tests for `JsonPlayerStore`**

`packages/server/src/playerStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonPlayerStore } from './playerStore';

describe('JsonPlayerStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'player-store-test-'));
    filePath = join(dir, 'balances.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the default starting balance for a name with no prior entry', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('alice')).resolves.toBe(1000);
  });

  it('round-trips a balance written with setBalance', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 1250);
    await expect(store.getBalance('alice')).resolves.toBe(1250);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const storeA = new JsonPlayerStore(filePath, 1000);
    await storeA.setBalance('bob', 750);

    const storeB = new JsonPlayerStore(filePath, 1000);
    await expect(storeB.getBalance('bob')).resolves.toBe(750);
  });

  it('keeps balances for different names independent', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 500);
    await store.setBalance('bob', 2000);
    await expect(store.getBalance('alice')).resolves.toBe(500);
    await expect(store.getBalance('bob')).resolves.toBe(2000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `playerStore.ts` does not exist / `JsonPlayerStore` is not defined.

- [ ] **Step 4: Implement `PlayerStore` and `JsonPlayerStore`**

`packages/server/src/playerStore.ts`:

```typescript
import { readFile, writeFile } from 'node:fs/promises';

export interface PlayerStore {
  getBalance(displayName: string): Promise<number>;
  setBalance(displayName: string, balance: number): Promise<void>;
}

type BalanceMap = Record<string, number>;

export class JsonPlayerStore implements PlayerStore {
  constructor(
    private readonly filePath: string,
    private readonly defaultStartingBalance: number
  ) {}

  private async readAll(): Promise<BalanceMap> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as BalanceMap;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
  }

  private async writeAll(data: BalanceMap): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getBalance(displayName: string): Promise<number> {
    const data = await this.readAll();
    return data[displayName] ?? this.defaultStartingBalance;
  }

  async setBalance(displayName: string, balance: number): Promise<void> {
    const data = await this.readAll();
    data[displayName] = balance;
    await this.writeAll(data);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — all 4 tests in `playerStore.test.ts` (the only test file so far)

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/package.json packages/server/tsconfig.json packages/server/vitest.config.ts packages/server/src/playerStore.ts packages/server/src/playerStore.test.ts
git commit -m "feat(server): scaffold packages/server; add JsonPlayerStore"
```

---

### Task 2: `HandLog` (generic append-only log)

`HandLog` is deliberately game-agnostic: it stores and returns opaque `{type, data}` entries and knows nothing about `Table`, `HoldemHand`, or `BlackjackRound`. All game-specific interpretation of log entries (Task 3) lives in `Table`, which is the only reader that knows what the `data` shapes mean. Keeping `HandLog` generic keeps this task low-risk and independently testable.

**Files:**
- Create: `packages/server/src/handLog.ts`
- Test: `packages/server/src/handLog.test.ts`

**Interfaces:**
- Produces: `interface HandLogEntry { type: string; data: unknown; }`, `interface HandLog { append(entry: HandLogEntry): Promise<void>; readAll(): Promise<HandLogEntry[]>; clear(): Promise<void>; }`, `class JsonlHandLog implements HandLog` with `constructor(filePath: string)`.

- [ ] **Step 1: Write the failing tests**

`packages/server/src/handLog.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlHandLog, type HandLogEntry } from './handLog';

describe('JsonlHandLog', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hand-log-test-'));
    filePath = join(dir, 'hand.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty array when the log file does not exist yet', async () => {
    const log = new JsonlHandLog(filePath);
    await expect(log.readAll()).resolves.toEqual([]);
  });

  it('round-trips a single appended entry', async () => {
    const log = new JsonlHandLog(filePath);
    const entry: HandLogEntry = { type: 'hand_started', data: { foo: 'bar' } };
    await log.append(entry);
    await expect(log.readAll()).resolves.toEqual([entry]);
  });

  it('preserves append order across multiple entries', async () => {
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'a', data: 1 });
    await log.append({ type: 'b', data: 2 });
    await log.append({ type: 'c', data: 3 });
    await expect(log.readAll()).resolves.toEqual([
      { type: 'a', data: 1 },
      { type: 'b', data: 2 },
      { type: 'c', data: 3 },
    ]);
  });

  it('round-trips nested array/object data untouched', async () => {
    const log = new JsonlHandLog(filePath);
    const entry: HandLogEntry = {
      type: 'hand_started',
      data: { deck: [{ suit: 'clubs', rank: 'A' }, { suit: 'hearts', rank: '10' }], config: { smallBlind: 5 } },
    };
    await log.append(entry);
    await expect(log.readAll()).resolves.toEqual([entry]);
  });

  it('clear empties the log', async () => {
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'a', data: null });
    await log.clear();
    await expect(log.readAll()).resolves.toEqual([]);
  });

  it('supports appending again after a clear', async () => {
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'a', data: null });
    await log.clear();
    await log.append({ type: 'b', data: null });
    await expect(log.readAll()).resolves.toEqual([{ type: 'b', data: null }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `handLog.ts` does not exist.

- [ ] **Step 3: Implement `HandLog` and `JsonlHandLog`**

`packages/server/src/handLog.ts`:

```typescript
import { readFile, writeFile, appendFile } from 'node:fs/promises';

export interface HandLogEntry {
  type: string;
  data: unknown;
}

export interface HandLog {
  append(entry: HandLogEntry): Promise<void>;
  readAll(): Promise<HandLogEntry[]>;
  clear(): Promise<void>;
}

export class JsonlHandLog implements HandLog {
  constructor(private readonly filePath: string) {}

  async append(entry: HandLogEntry): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }

  async readAll(): Promise<HandLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HandLogEntry);
  }

  async clear(): Promise<void> {
    await writeFile(this.filePath, '', 'utf-8');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far (Task 1's plus this file's 6), all green

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/handLog.ts packages/server/src/handLog.test.ts
git commit -m "feat(server): add generic JsonlHandLog append-only log"
```

---

### Task 3: `Table` — seats, ready-gating, hand construction/dealing

Covers seat join/leave and starting a hand for both games. Settlement, the
between-hands transition, and action routing are Task 4 — this task's hands are never
actually played to completion, only constructed and dealt, so multi-hand button
rotation cannot be exercised yet (there is no way back to a between-hands state within
this task's scope). A rotation-across-hands test is added in Task 4 once settlement
exists.

**Files:**
- Create: `packages/server/src/table.ts`
- Test: `packages/server/src/table.test.ts`

**Interfaces:**
- Consumes: `PlayerStore` (Task 1), `HandLog` (Task 2); `BlackjackRound`, `HoldemHand`, `createDeck`, `shuffle`, and types `HoldemPlayerInput`, `HoldemHandConfig` from `@poker-blackjack/game-engine`.
- Produces: `interface Seat { seatIndex: number; displayName: string; connected: boolean; ready: boolean; balance: number; }`, `interface TableConfig { gameMode: 'blackjack' | 'holdem'; seatCount: number; smallBlind: number; bigBlind: number; blackjackDefaultBet: number; defaultStartingBalance: number; reconnectGraceMs: number; random: () => number; }`, `interface TableDeps { playerStore: PlayerStore; handLog: HandLog; onStateChange: () => void; }`, `class Table` with `seats: (Seat | null)[]`, `handInProgress: boolean`, `holdemHand: HoldemHand | null`, `blackjackRounds: Map<number, BlackjackRound>`, `activeSeatIndex: number | null`, `join(displayName): Promise<number>`, `leave(seatIndex): void`, `setReady(seatIndex): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`packages/server/src/table.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Table, type TableConfig } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog, HandLogEntry } from './handLog';

class FakePlayerStore implements PlayerStore {
  private balances = new Map<string, number>();
  constructor(private readonly defaultBalance: number) {}
  async getBalance(displayName: string): Promise<number> {
    return this.balances.get(displayName) ?? this.defaultBalance;
  }
  async setBalance(displayName: string, balance: number): Promise<void> {
    this.balances.set(displayName, balance);
  }
}

class FakeHandLog implements HandLog {
  entries: HandLogEntry[] = [];
  async append(entry: HandLogEntry): Promise<void> {
    this.entries.push(entry);
  }
  async readAll(): Promise<HandLogEntry[]> {
    return this.entries;
  }
  async clear(): Promise<void> {
    this.entries = [];
  }
}

// Deterministic, reproducible default in place of Math.random: a real
// shuffle has a ~4.75% chance of dealing a natural blackjack to seat 0, which
// settles it instantly and advances play past it, flaking any test that
// expects seat 0 to still be active or playable. Seed 2 is verified (by
// direct simulation of Table's exact shuffle call sequence -- one
// buildShuffledDeck(6, random) call per seated player, in seat order) to
// deal neither of 2 seated players a natural. Tests that specifically need
// genuine per-run randomness (e.g. proving two shoes are independent) pass
// `random: Math.random` as an explicit override.
function makeDeterministicRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function makeTable(overrides: Partial<TableConfig> = {}) {
  const config: TableConfig = {
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
  const playerStore = new FakePlayerStore(config.defaultStartingBalance);
  const handLog = new FakeHandLog();
  let stateChangeCount = 0;
  const table = new Table(config, {
    playerStore,
    handLog,
    onStateChange: () => {
      stateChangeCount += 1;
    },
  });
  return { table, playerStore, handLog, getStateChangeCount: () => stateChangeCount };
}

describe('Table seats', () => {
  it('assigns increasing seat indices on join', async () => {
    const { table } = makeTable();
    await expect(table.join('alice')).resolves.toBe(0);
    await expect(table.join('bob')).resolves.toBe(1);
  });

  it('rejects a duplicate display name', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await expect(table.join('alice')).rejects.toThrow('already seated');
  });

  it('rejects joining once all 8 seats are full', async () => {
    const { table } = makeTable();
    for (let i = 0; i < 8; i++) {
      await table.join(`player-${i}`);
    }
    await expect(table.join('one-too-many')).rejects.toThrow('full');
  });

  it('loads the joining player balance from PlayerStore', async () => {
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('alice', 4242);
    await table.join('alice');
    expect(table.seats[0]?.balance).toBe(4242);
  });

  it('leave clears the seat', async () => {
    const { table } = makeTable();
    await table.join('alice');
    table.leave(0);
    expect(table.seats[0]).toBeNull();
  });

  it('leave throws on an already-empty seat', async () => {
    const { table } = makeTable();
    expect(() => table.leave(0)).toThrow('empty');
  });

  it('leave throws while a hand is in progress', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(() => table.leave(0)).toThrow('in progress');
  });

  it('calls onStateChange on join and leave', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    expect(getStateChangeCount()).toBe(1);
    table.leave(0);
    expect(getStateChangeCount()).toBe(2);
  });
});

describe('Table ready-gating and hand start (Hold\'em)', () => {
  it('does not start a hand with only one seated player ready', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.setReady(0);
    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
  });

  it('starts a hand once all seated players (>= 2) are ready', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    expect(table.handInProgress).toBe(false);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand).not.toBeNull();
  });

  it('constructs the HoldemHand with each seated player\'s display name and balance', async () => {
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('alice', 800);
    await playerStore.setBalance('bob', 600);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const hand = table.holdemHand!;
    expect(hand.players.map((p) => p.playerId).sort()).toEqual(['alice', 'bob']);
    expect(hand.players.find((p) => p.playerId === 'alice')?.stack).toBeLessThanOrEqual(800);
    expect(hand.players.find((p) => p.playerId === 'bob')?.stack).toBeLessThanOrEqual(600);
  });

  it('the first hand ever played seats the button at the lowest occupied seat index', async () => {
    const { table } = makeTable();
    await table.join('alice'); // seat 0
    await table.join('bob'); // seat 1
    await table.setReady(0);
    await table.setReady(1);

    // Heads-up: button posts the small blind and acts first preflop, so the
    // acting player at hand start is whoever is on the button.
    expect(table.holdemHand!.actingPlayerId).toBe('alice');
  });

  it('logs a holdem_hand_started entry', async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(handLog.entries).toHaveLength(1);
    expect(handLog.entries[0].type).toBe('holdem_hand_started');
  });
});

describe('Table ready-gating and hand start (Blackjack)', () => {
  it('constructs one independent BlackjackRound per seated player', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.blackjackRounds.size).toBe(2);
    expect(table.blackjackRounds.get(0)).toBeDefined();
    expect(table.blackjackRounds.get(1)).toBeDefined();
  });

  it('deals each round with the configured default bet', async () => {
    const { table } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.blackjackRounds.get(0)!.playerHands[0].bet).toBe(25);
    expect(table.blackjackRounds.get(1)!.playerHands[0].bet).toBe(25);
  });

  it('gives each round an independent shoe (different card sequences)', async () => {
    // With a real random function, two independently shuffled 6-deck shoes
    // dealing the same first card to both players would be astronomically
    // unlikely -- a cheap, reliable signal they are not sharing one shoe.
    const { table } = makeTable({ gameMode: 'blackjack', random: Math.random });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const aliceFirstCard = table.blackjackRounds.get(0)!.playerHands[0].cards[0];
    const bobFirstCard = table.blackjackRounds.get(1)!.playerHands[0].cards[0];
    expect(aliceFirstCard).not.toEqual(bobFirstCard);
  });

  it('sets activeSeatIndex to the lowest seated index', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.activeSeatIndex).toBe(0);
  });

  it('logs a blackjack_hand_started entry', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(handLog.entries).toHaveLength(1);
    expect(handLog.entries[0].type).toBe('blackjack_hand_started');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `table.ts` does not exist.

- [ ] **Step 3: Implement `Table` through hand construction/dealing**

`packages/server/src/table.ts`:

```typescript
import {
  BlackjackRound,
  HoldemHand,
  createDeck,
  shuffle,
  type HoldemPlayerInput,
  type HoldemHandConfig,
  type Card,
} from '@poker-blackjack/game-engine';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';

export type GameMode = 'blackjack' | 'holdem';

export interface Seat {
  seatIndex: number;
  displayName: string;
  connected: boolean;
  ready: boolean;
  balance: number;
}

export interface TableConfig {
  gameMode: GameMode;
  seatCount: number;
  smallBlind: number;
  bigBlind: number;
  blackjackDefaultBet: number;
  defaultStartingBalance: number;
  reconnectGraceMs: number;
  random: () => number;
}

export interface TableDeps {
  playerStore: PlayerStore;
  handLog: HandLog;
  onStateChange: () => void;
}

export class Table {
  seats: (Seat | null)[];
  handInProgress = false;
  holdemHand: HoldemHand | null = null;
  blackjackRounds: Map<number, BlackjackRound> = new Map();
  activeSeatIndex: number | null = null;

  private buttonSeatIndex: number | null = null;

  constructor(
    private readonly config: TableConfig,
    private readonly deps: TableDeps
  ) {
    this.seats = new Array(config.seatCount).fill(null);
  }

  async join(displayName: string): Promise<number> {
    if (this.seats.some((s) => s?.displayName === displayName)) {
      throw new Error(`"${displayName}" is already seated`);
    }
    const seatIndex = this.seats.findIndex((s) => s === null);
    if (seatIndex === -1) {
      throw new Error('Table is full');
    }
    const balance = await this.deps.playerStore.getBalance(displayName);
    this.seats[seatIndex] = { seatIndex, displayName, connected: true, ready: false, balance };
    this.deps.onStateChange();
    return seatIndex;
  }

  leave(seatIndex: number): void {
    if (this.handInProgress) {
      throw new Error('Cannot leave while a hand is in progress');
    }
    if (!this.seats[seatIndex]) {
      throw new Error('Seat is empty');
    }
    this.seats[seatIndex] = null;
    this.deps.onStateChange();
  }

  async setReady(seatIndex: number): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    seat.ready = true;
    this.deps.onStateChange();

    const seatedSeats = this.seats.filter((s): s is Seat => s !== null);
    const allReady = seatedSeats.length >= 2 && seatedSeats.every((s) => s.ready);
    if (allReady && !this.handInProgress) {
      await this.startHand(seatedSeats);
    }
  }

  private buildShuffledDeck(deckCount: number): Card[] {
    const cards = Array.from({ length: deckCount }, () => createDeck()).flat();
    return shuffle(cards, this.config.random);
  }

  private nextButtonSeatIndex(seatedSeats: Seat[]): number {
    const occupied = seatedSeats.map((s) => s.seatIndex).sort((a, b) => a - b);
    if (this.buttonSeatIndex === null) {
      return occupied[0];
    }
    const currentPos = occupied.indexOf(this.buttonSeatIndex);
    if (currentPos === -1) {
      return occupied.find((i) => i > this.buttonSeatIndex!) ?? occupied[0];
    }
    return occupied[(currentPos + 1) % occupied.length];
  }

  private async startHand(seatedSeats: Seat[]): Promise<void> {
    this.handInProgress = true;

    if (this.config.gameMode === 'holdem') {
      this.buttonSeatIndex = this.nextButtonSeatIndex(seatedSeats);
      const buttonIndex = seatedSeats.findIndex((s) => s.seatIndex === this.buttonSeatIndex);

      const players: HoldemPlayerInput[] = seatedSeats.map((s) => ({
        playerId: s.displayName,
        stack: s.balance,
      }));
      const holdemConfig: HoldemHandConfig = {
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        buttonIndex,
        deck: this.buildShuffledDeck(1),
      };

      await this.deps.handLog.append({
        type: 'holdem_hand_started',
        data: { players, config: holdemConfig },
      });
      this.holdemHand = new HoldemHand(players, holdemConfig);
    } else {
      const rounds = seatedSeats.map((s) => ({
        seatIndex: s.seatIndex,
        displayName: s.displayName,
        initialBet: this.config.blackjackDefaultBet,
        shoe: this.buildShuffledDeck(6),
      }));

      await this.deps.handLog.append({ type: 'blackjack_hand_started', data: { rounds } });
      this.blackjackRounds = new Map(
        rounds.map((r) => [r.seatIndex, new BlackjackRound(r.initialBet, { shoe: r.shoe })])
      );
      this.activeSeatIndex = rounds[0].seatIndex;
    }

    this.deps.onStateChange();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's new `table.test.ts` tests, all green

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts
git commit -m "feat(server): add Table seat management and dual-game hand construction"
```

---

### Task 4: `Table` — action routing, settlement, between-hands

Adds `submitAction` and the settlement/between-hands logic to the `Table` class from
Task 3. Also covers a real edge case in the existing engine: `BlackjackRound`'s
constructor calls its internal `advanceIfNeeded()`, so a two-card-21 (natural
blackjack) can leave `phase === 'settled'` immediately at deal time, before any
`.act()` call — `Table` must be able to settle and skip past a round that was never
actually played.

**Files:**
- Modify: `packages/server/src/table.ts`
- Modify: `packages/server/src/table.test.ts`

**Interfaces:**
- Consumes: `Table` from Task 3; `PlayerAction`, `HoldemAction` types from `@poker-blackjack/game-engine`.
- Produces: `Table.submitAction(seatIndex: number, action: PlayerAction | HoldemAction, amount?: number): Promise<void>` — throws (rejects) on an empty seat, no hand in progress, wrong turn, or an illegal action per the engine's own validation. Never mutates state or calls `onStateChange` when it throws.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/table.test.ts` (append after the existing `describe` blocks):

```typescript
describe('Table submitAction (Hold\'em)', () => {
  it('rejects an action from a seat when it is not that seat\'s turn', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    // Heads-up: alice (button) acts first preflop, so seat 1 (bob) is out of turn.
    await expect(table.submitAction(1, 'fold')).rejects.toThrow();
  });

  it('rejects an illegal action and leaves state unchanged', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const countBefore = getStateChangeCount();
    // Heads-up preflop: alice (SB) faces a bet from the BB, so check is illegal.
    await expect(table.submitAction(0, 'check')).rejects.toThrow();
    expect(getStateChangeCount()).toBe(countBefore);
    expect(table.handInProgress).toBe(true);
  });

  it('settling an uncontested hand commits payouts via PlayerStore and returns to between-hands', async () => {
    const { table, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    // Heads-up, alice on the button/SB acts first preflop -- folding here
    // immediately ends the hand uncontested in bob's favor.
    await table.submitAction(0, 'fold');

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    await expect(playerStore.getBalance('alice')).resolves.toBe(995); // lost the 5-chip small blind
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005); // won alice's small blind
    expect(table.seats[0]?.ready).toBe(false);
    expect(table.seats[1]?.ready).toBe(false);
  });

  it('clears the HandLog once a hand settles', async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'fold');
    await expect(handLog.readAll()).resolves.toEqual([]);
  });

  it('rotates the button to the next seated player on the next hand', async () => {
    const { table } = makeTable();
    await table.join('alice'); // seat 0
    await table.join('bob'); // seat 1
    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // button = seat 0 on the first hand

    await table.submitAction(0, 'fold'); // settles hand 1, resets ready flags

    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('bob'); // button rotated to seat 1
  });
});

describe('Table submitAction (Blackjack)', () => {
  it('rejects an action from a seat that is not currently active', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.activeSeatIndex).toBe(0);
    await expect(table.submitAction(1, 'stand')).rejects.toThrow();
  });

  it('advances to the next seat once the active seat\'s round settles', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'stand');
    expect(table.blackjackRounds.get(0)!.phase).toBe('settled');
    expect(table.activeSeatIndex).toBe(1);
    expect(table.handInProgress).toBe(true);
  });

  it('finishes the table hand and commits balances once every seat\'s round settles', async () => {
    const { table, playerStore } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'stand');
    await table.submitAction(1, 'stand');

    expect(table.handInProgress).toBe(false);
    expect(table.blackjackRounds.size).toBe(0);
    expect(table.activeSeatIndex).toBeNull();
    const aliceBalance = await playerStore.getBalance('alice');
    const bobBalance = await playerStore.getBalance('bob');
    // Both started at 1000 with a 25-chip bet; win/push/lose all land within [975, 1037.5].
    expect(aliceBalance).toBeGreaterThanOrEqual(975);
    expect(aliceBalance).toBeLessThanOrEqual(1037.5);
    expect(bobBalance).toBeGreaterThanOrEqual(975);
    expect(bobBalance).toBeLessThanOrEqual(1037.5);
  });

  it('rejects an illegal Blackjack action and leaves state unchanged', async () => {
    const { table, getStateChangeCount } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'hit');
    const countBefore = getStateChangeCount();
    // A hand with 3+ cards can no longer double.
    await expect(table.submitAction(0, 'double')).rejects.toThrow('first two cards');
    expect(getStateChangeCount()).toBe(countBefore);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `table.submitAction` is not a function.

- [ ] **Step 3: Implement `submitAction` and settlement**

Add the following inside the `Table` class in `packages/server/src/table.ts`, and add
`blackjackSettledSeats: Set<number> = new Set();` as a new field alongside the
existing `activeSeatIndex` field:

```typescript
  async submitAction(
    seatIndex: number,
    action: PlayerAction | HoldemAction,
    amount?: number
  ): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    if (!this.handInProgress) {
      throw new Error('No hand in progress');
    }

    if (this.config.gameMode === 'holdem') {
      const hand = this.holdemHand!;
      if (hand.actingPlayerId !== seat.displayName) {
        throw new Error(`It is not ${seat.displayName}'s turn`);
      }
      hand.act(seat.displayName, action as HoldemAction, amount);
      await this.deps.handLog.append({
        type: 'holdem_action',
        data: { playerId: seat.displayName, action, amount },
      });
      if (hand.street === 'settled') {
        await this.settleHoldem(hand);
      }
    } else {
      if (this.activeSeatIndex !== seatIndex) {
        throw new Error(`It is not seat ${seatIndex}'s turn`);
      }
      const round = this.blackjackRounds.get(seatIndex)!;
      round.act(action as PlayerAction);
      await this.deps.handLog.append({ type: 'blackjack_action', data: { seatIndex, action } });
      const seatedIndices = this.seats
        .filter((s): s is Seat => s !== null)
        .map((s) => s.seatIndex);
      await this.advancePastSettledBlackjackRounds(seatedIndices);
    }

    this.deps.onStateChange();
  }

  private async settleHoldem(hand: HoldemHand): Promise<void> {
    for (const result of hand.results) {
      const seat = this.seats.find((s) => s?.displayName === result.playerId);
      if (seat) {
        seat.balance += result.payout;
        await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
      }
    }
    this.handInProgress = false;
    this.holdemHand = null;
    for (const seat of this.seats) {
      if (seat) seat.ready = false;
    }
    await this.deps.handLog.clear();
  }

  private async settleBlackjackSeatIfNeeded(seatIndex: number): Promise<void> {
    if (this.blackjackSettledSeats.has(seatIndex)) {
      return;
    }
    const round = this.blackjackRounds.get(seatIndex)!;
    if (round.phase !== 'settled') {
      return;
    }
    this.blackjackSettledSeats.add(seatIndex);
    const seat = this.seats[seatIndex]!;
    const totalPayout = round.results.reduce((sum, r) => sum + r.payout, 0);
    seat.balance += totalPayout;
    await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
  }

  private async advancePastSettledBlackjackRounds(seatedIndices: number[]): Promise<void> {
    while (this.activeSeatIndex !== null) {
      const round = this.blackjackRounds.get(this.activeSeatIndex)!;
      if (round.phase !== 'settled') {
        return;
      }
      await this.settleBlackjackSeatIfNeeded(this.activeSeatIndex);
      const pos = seatedIndices.indexOf(this.activeSeatIndex);
      this.activeSeatIndex = seatedIndices[pos + 1] ?? null;
    }
    await this.finishBlackjackHandIfComplete();
  }

  private async finishBlackjackHandIfComplete(): Promise<void> {
    this.handInProgress = false;
    this.blackjackRounds = new Map();
    this.blackjackSettledSeats = new Set();
    for (const seat of this.seats) {
      if (seat) seat.ready = false;
    }
    await this.deps.handLog.clear();
  }
```

Also update the Blackjack branch at the end of `startHand` to call
`advancePastSettledBlackjackRounds` immediately after dealing, so an instant natural
blackjack at seat 0 is settled and skipped before the table ever reports it as active:

```typescript
      this.blackjackRounds = new Map(
        rounds.map((r) => [r.seatIndex, new BlackjackRound(r.initialBet, { shoe: r.shoe })])
      );
      this.activeSeatIndex = rounds[0].seatIndex;
      await this.advancePastSettledBlackjackRounds(rounds.map((r) => r.seatIndex));
```

(this replaces the two lines that previously set `this.blackjackRounds` and
`this.activeSeatIndex` at the end of the Blackjack branch in `startHand`)

Finally, add `PlayerAction` and `HoldemAction` to the existing import from
`@poker-blackjack/game-engine` at the top of the file:

```typescript
import {
  BlackjackRound,
  HoldemHand,
  createDeck,
  shuffle,
  type HoldemPlayerInput,
  type HoldemHandConfig,
  type PlayerAction,
  type HoldemAction,
  type Card,
} from '@poker-blackjack/game-engine';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's additions to `table.test.ts`, all green

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts
git commit -m "feat(server): add Table action routing, settlement, and between-hands reset"
```

---

### Task 5: `Table` — disconnect/reconnect + grace-window timeout

This is the highest-risk task in this plan — the equivalent turn-order/edge-case task
in the Hold'em engine plan found two Critical bugs that per-task tests missed, so this
task's tests are deliberately thorough. It also closes a deadlock this plan would
otherwise have: since `setReady`/`startHand` (Tasks 3-4) require *every seated player*
ready before dealing, a player who disconnects between hands and never reconnects
would permanently block the table. The fix: only *connected* seats participate in
ready-gating and get dealt into a hand — a disconnected seat simply sits out of hands
that start while they're away, and rejoins on reconnect (their balance and seat
identity are preserved throughout; only participation in *upcoming* hands is gated on
being connected).

**Files:**
- Modify: `packages/server/src/table.ts`
- Modify: `packages/server/src/table.test.ts`

**Interfaces:**
- Consumes: `Table` from Tasks 3-4.
- Produces: `Table.disconnect(seatIndex: number): void`, `Table.reconnect(displayName: string): number | null` (returns the seat index on success, `null` if no disconnected seat matches).

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/table.test.ts`:

```typescript
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Table disconnect/reconnect', () => {
  it('marks a seat disconnected and fires onStateChange', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    const before = getStateChangeCount();
    table.disconnect(0);
    expect(table.seats[0]?.connected).toBe(false);
    expect(getStateChangeCount()).toBe(before + 1);
  });

  it('reconnect within the grace window rebinds the seat and returns its index', async () => {
    const { table } = makeTable({ reconnectGraceMs: 200 });
    await table.join('alice');
    table.disconnect(0);
    const seatIndex = table.reconnect('alice');
    expect(seatIndex).toBe(0);
    expect(table.seats[0]?.connected).toBe(true);
  });

  it('reconnect returns null for a name that is not currently disconnected', async () => {
    const { table } = makeTable();
    await table.join('alice');
    expect(table.reconnect('alice')).toBeNull(); // never disconnected
    expect(table.reconnect('nobody')).toBeNull(); // not seated at all
  });

  it('a between-hands disconnect excludes that seat from the next hand instead of blocking it', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');
    table.disconnect(2); // carol disconnects before anyone is ready

    await table.setReady(0);
    await table.setReady(1);
    // Only alice and bob are connected; the hand should start without carol.
    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand!.players.map((p) => p.playerId).sort()).toEqual(['alice', 'bob']);
  });

  it('disconnecting the seat whose turn it is auto-folds/checks once the grace window elapses (heads-up)', async () => {
    const { table } = makeTable({ reconnectGraceMs: 30, smallBlind: 5, bigBlind: 10 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // button acts first, heads-up

    table.disconnect(0);
    await wait(100);

    // Alice was facing a bet (SB posted 5, BB posted 10) so the safe default is fold,
    // which ends the hand uncontested in bob's favor.
    expect(table.handInProgress).toBe(false);
  });

  it('a reconnect before the grace window elapses prevents the auto-action', async () => {
    const { table } = makeTable({ reconnectGraceMs: 200 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    table.disconnect(0);
    await wait(20);
    table.reconnect('alice');
    await wait(250); // past where the original timer would have fired

    expect(table.handInProgress).toBe(true); // never auto-folded
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // still alice's turn
  });

  it('disconnecting a seat that is not currently acting only auto-acts once it becomes their turn', async () => {
    const { table } = makeTable({ reconnectGraceMs: 30 });
    await table.join('alice'); // seat 0 -- button, first to act in a 3-handed hand
    await table.join('bob'); // seat 1 -- small blind
    await table.join('carol'); // seat 2 -- big blind
    await table.setReady(0);
    await table.setReady(1);
    await table.setReady(2);
    expect(table.holdemHand!.actingPlayerId).toBe('alice');

    table.disconnect(1); // bob disconnects while it is alice's turn, not his
    await wait(100); // past the grace window

    // Still alice's turn -- bob's disconnect hasn't reached his turn yet, so nothing
    // should have been auto-submitted on his behalf.
    expect(table.holdemHand!.actingPlayerId).toBe('alice');
    expect(table.handInProgress).toBe(true);

    // Alice calls, advancing the turn to bob -- who is already past his grace window,
    // so his action should be auto-submitted immediately with no further waiting.
    await table.submitAction(0, 'call');

    expect(table.holdemHand!.actingPlayerId).not.toBe('bob'); // bob's turn was auto-resolved
  });

  it('auto-acts with stand in Blackjack once the active seat times out', async () => {
    const { table } = makeTable({ gameMode: 'blackjack', reconnectGraceMs: 30 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.activeSeatIndex).toBe(0);

    table.disconnect(0);
    await wait(100);

    expect(table.blackjackRounds.get(0)?.phase).toBe('settled');
    expect(table.activeSeatIndex).toBe(1); // advanced to the next seat
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `table.disconnect`/`table.reconnect` are not functions.

- [ ] **Step 3: Implement disconnect/reconnect and the timeout auto-action**

Add two new fields to the `Table` class, alongside the existing `activeSeatIndex` and
`blackjackSettledSeats` fields:

```typescript
  private disconnectTimers: Map<number, NodeJS.Timeout> = new Map();
  private timedOutSeats: Set<number> = new Set();
```

Add these methods to the `Table` class:

```typescript
  disconnect(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    seat.connected = false;
    this.deps.onStateChange();

    const timer = setTimeout(() => {
      void this.onGraceWindowElapsed(seatIndex);
    }, this.config.reconnectGraceMs);
    this.disconnectTimers.set(seatIndex, timer);
  }

  reconnect(displayName: string): number | null {
    const seat = this.seats.find((s) => s?.displayName === displayName && !s.connected);
    if (!seat) {
      return null;
    }
    const timer = this.disconnectTimers.get(seat.seatIndex);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(seat.seatIndex);
    }
    this.timedOutSeats.delete(seat.seatIndex);
    seat.connected = true;
    this.deps.onStateChange();
    return seat.seatIndex;
  }

  private async onGraceWindowElapsed(seatIndex: number): Promise<void> {
    this.disconnectTimers.delete(seatIndex);
    const seat = this.seats[seatIndex];
    if (!seat || seat.connected) {
      return;
    }
    this.timedOutSeats.add(seatIndex);
    await this.autoActIfSeatIsUpAndTimedOut(seatIndex);
  }

  private async autoActIfSeatIsUpAndTimedOut(seatIndex: number): Promise<void> {
    if (!this.handInProgress || !this.timedOutSeats.has(seatIndex)) {
      return;
    }
    const seat = this.seats[seatIndex];
    if (!seat) {
      return;
    }

    if (this.config.gameMode === 'holdem') {
      if (this.holdemHand?.actingPlayerId !== seat.displayName) {
        return;
      }
      const context = this.holdemHand.getBettingContext();
      const action: HoldemAction = context && context.toCall === 0 ? 'check' : 'fold';
      await this.submitAction(seatIndex, action);
    } else {
      if (this.activeSeatIndex !== seatIndex) {
        return;
      }
      await this.submitAction(seatIndex, 'stand');
    }
  }
```

Modify `setReady` to gate on *connected* seats only (change `seatedSeats` to
`connectedSeats`, filtering on `s.connected` as well as non-null):

```typescript
  async setReady(seatIndex: number): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    seat.ready = true;
    this.deps.onStateChange();

    const connectedSeats = this.seats.filter((s): s is Seat => s !== null && s.connected);
    const allReady = connectedSeats.length >= 2 && connectedSeats.every((s) => s.ready);
    if (allReady && !this.handInProgress) {
      await this.startHand(connectedSeats);
    }
  }
```

(this replaces the previous `setReady` body from Task 3 — the only change is
`seatedSeats` → `connectedSeats` with the added `s.connected` filter)

Finally, modify the end of `submitAction` to check whether the new current turn
belongs to an already-timed-out seat, so a chain of disconnected players each get
auto-resolved immediately without waiting for a fresh timer per seat. Replace the
closing `this.deps.onStateChange();` line of `submitAction` with:

```typescript
    this.deps.onStateChange();

    if (this.handInProgress) {
      const nextSeatIndex =
        this.config.gameMode === 'holdem'
          ? this.seats.find((s) => s?.displayName === this.holdemHand?.actingPlayerId)?.seatIndex
          : this.activeSeatIndex;
      if (nextSeatIndex !== undefined && nextSeatIndex !== null) {
        await this.autoActIfSeatIsUpAndTimedOut(nextSeatIndex);
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's additions to `table.test.ts`, all green

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts
git commit -m "feat(server): add Table disconnect/reconnect with grace-window auto-action"
```

---

### Task 6: `Table` — crash recovery from `HandLog`

Adds `Table.recoverFromLog()`, called once at server startup (Task 8) before accepting
any connections. All game-specific interpretation of logged entries lives here, since
`Table` is the only place with full knowledge of both engines' constructors — `HandLog`
itself (Task 2) stays a generic opaque-entry store.

A genuine correctness risk this task must guard against: if the process crashes *during*
multi-seat settlement (which writes each affected player's balance to `PlayerStore` one
at a time before clearing the log), recovery cannot tell which players' balances were
already written. Replaying to a hand that comes out already-settled must never
re-apply payouts — doing so risks double-paying a player whose balance was already
committed before the crash. The safe rule: if replay produces an already-settled
hand/rounds, discard it and clear the log rather than re-settling. This narrows to "a
crash exactly during the settlement-commit window may lose that hand's payout," which
is the same class of already-accepted risk as the original spec's "crash mid-hand"
limitation — not a new one.

**Files:**
- Modify: `packages/server/src/table.ts`
- Modify: `packages/server/src/table.test.ts`

**Interfaces:**
- Consumes: `Table` from Tasks 3-5.
- Produces: `Table.recoverFromLog(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/table.test.ts`:

```typescript
describe('Table.recoverFromLog', () => {
  it('is a no-op when the log is empty', async () => {
    const { table } = makeTable();
    await table.recoverFromLog();
    expect(table.handInProgress).toBe(false);
    expect(table.seats.every((s) => s === null)).toBe(true);
  });

  it('reconstructs an in-progress Hold\'em hand and marks recovered seats disconnected', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    const { createDeck, shuffle } = await import('@poker-blackjack/game-engine');
    const config = { smallBlind: 5, bigBlind: 10, buttonIndex: 0, deck: shuffle(createDeck(), Math.random) };
    await handLog.append({
      type: 'holdem_hand_started',
      data: {
        players: [
          { playerId: 'alice', stack: 1000 },
          { playerId: 'bob', stack: 1000 },
        ],
        config,
      },
    });
    await handLog.append({
      type: 'holdem_action',
      data: { playerId: 'alice', action: 'call' },
    });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand).not.toBeNull();
    expect(table.holdemHand!.actingPlayerId).toBe('bob'); // alice called, action moved to bob
    expect(table.seats[0]?.displayName).toBe('alice');
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
    // Recovery starts the same grace-window mechanism as an ordinary disconnect --
    // reconnect() should succeed for a recovered seat.
    expect(table.reconnect('alice')).toBe(0);
  });

  it('discards an already-settled Hold\'em hand instead of re-settling it', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    const { createDeck, shuffle } = await import('@poker-blackjack/game-engine');
    const config = { smallBlind: 5, bigBlind: 10, buttonIndex: 0, deck: shuffle(createDeck(), Math.random) };
    await handLog.append({
      type: 'holdem_hand_started',
      data: {
        players: [
          { playerId: 'alice', stack: 1000 },
          { playerId: 'bob', stack: 1000 },
        ],
        config,
      },
    });
    await handLog.append({ type: 'holdem_action', data: { playerId: 'alice', action: 'fold' } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(table.seats.every((s) => s === null)).toBe(true);
    await expect(handLog.readAll()).resolves.toEqual([]);
    // No balance write should have been attempted for either player.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
  });

  it('reconstructs in-progress Blackjack rounds from hand-crafted shoes', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // Neither seat's first two cards are a natural blackjack.
    const aliceShoe = [card('5', 'clubs'), card('6', 'clubs'), card('7', 'hearts'), card('8', 'hearts'), card('2', 'spades')];
    const bobShoe = [card('4', 'diamonds'), card('5', 'diamonds'), card('9', 'hearts'), card('10', 'hearts'), card('3', 'spades')];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });
    await handLog.append({ type: 'blackjack_action', data: { seatIndex: 0, action: 'hit' } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(true);
    expect(table.blackjackRounds.get(0)!.playerHands[0].cards).toHaveLength(3); // 2 dealt + 1 hit
    expect(table.activeSeatIndex).toBe(0); // seat 0's round is still in progress
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
  });

  it('auto-settles a round that was already complete at deal time (natural blackjack) during recovery', async () => {
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // alice: natural blackjack (settles instantly at construction, no action needed).
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    const bobShoe = [card('5', 'diamonds'), card('6', 'diamonds'), card('9', 'hearts'), card('10', 'hearts'), card('3', 'spades')];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });

    await table.recoverFromLog();

    expect(table.activeSeatIndex).toBe(1); // seat 0 auto-settled and skipped
    await expect(playerStore.getBalance('alice')).resolves.toBe(1037.5); // 25 * 1.5 blackjack payout
  });

  it('discards already-fully-settled Blackjack rounds instead of re-settling them', async () => {
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    const bobShoe = [card('A', 'diamonds'), card('Q', 'diamonds'), card('9', 'hearts'), card('10', 'hearts')];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.seats.every((s) => s === null)).toBe(true);
    await expect(handLog.readAll()).resolves.toEqual([]);
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000); // untouched
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `table.recoverFromLog` is not a function.

- [ ] **Step 3: Implement `recoverFromLog`**

Add this method to the `Table` class in `packages/server/src/table.ts`:

```typescript
  async recoverFromLog(): Promise<void> {
    const entries = await this.deps.handLog.readAll();
    if (entries.length === 0) {
      return;
    }
    const [started, ...rest] = entries;

    if (started.type === 'holdem_hand_started') {
      const { players, config } = started.data as {
        players: HoldemPlayerInput[];
        config: HoldemHandConfig;
      };
      const hand = new HoldemHand(players, config);
      for (const entry of rest) {
        if (entry.type === 'holdem_action') {
          const { playerId, action, amount } = entry.data as {
            playerId: string;
            action: HoldemAction;
            amount?: number;
          };
          hand.act(playerId, action, amount);
        }
      }
      if (hand.street === 'settled') {
        await this.deps.handLog.clear();
        return;
      }
      for (let i = 0; i < players.length; i++) {
        const balance = await this.deps.playerStore.getBalance(players[i].playerId);
        this.seats[i] = {
          seatIndex: i,
          displayName: players[i].playerId,
          connected: false,
          ready: false,
          balance,
        };
      }
      this.holdemHand = hand;
      this.handInProgress = true;
    } else if (started.type === 'blackjack_hand_started') {
      const { rounds } = started.data as {
        rounds: { seatIndex: number; displayName: string; initialBet: number; shoe: Card[] }[];
      };
      const reconstructed = new Map(
        rounds.map((r) => [r.seatIndex, new BlackjackRound(r.initialBet, { shoe: r.shoe })])
      );
      for (const entry of rest) {
        if (entry.type === 'blackjack_action') {
          const { seatIndex, action } = entry.data as { seatIndex: number; action: PlayerAction };
          reconstructed.get(seatIndex)!.act(action);
        }
      }
      const allSettled = [...reconstructed.values()].every((r) => r.phase === 'settled');
      if (allSettled) {
        await this.deps.handLog.clear();
        return;
      }
      for (const r of rounds) {
        const balance = await this.deps.playerStore.getBalance(r.displayName);
        this.seats[r.seatIndex] = {
          seatIndex: r.seatIndex,
          displayName: r.displayName,
          connected: false,
          ready: false,
          balance,
        };
      }
      this.blackjackRounds = reconstructed;
      this.activeSeatIndex = rounds[0].seatIndex;
      this.handInProgress = true;
      await this.advancePastSettledBlackjackRounds(rounds.map((r) => r.seatIndex));
    }

    for (const seat of this.seats) {
      if (seat) {
        this.disconnect(seat.seatIndex);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's additions to `table.test.ts`, all green

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts
git commit -m "feat(server): add Table crash recovery from HandLog"
```

---

### Task 7: `Table.getStateForSeat` (per-recipient view filtering)

Adds the state-serialization method `socketServer.ts` (Task 8) broadcasts to clients.
This is the one place hole-card/dealer-card visibility is actually enforced — nothing
in `Table`'s internal state prevented over-sharing before this method exists.

**Files:**
- Modify: `packages/server/src/table.ts`
- Modify: `packages/server/src/table.test.ts`

**Interfaces:**
- Consumes: `Table` from Tasks 3-6.
- Produces: `interface SeatView { seatIndex: number; displayName: string | null; balance: number; connected: boolean; ready: boolean; }`, `interface BlackjackRoundView { phase: RoundPhase; playerHands: PlayerHand[]; dealerUpcard: Card; dealerCards: Card[] | null; results: RoundResult[] | null; }`, `interface HoldemPlayerView { playerId: string; stack: number; streetContributed: number; folded: boolean; isAllIn: boolean; holeCards: [Card, Card] | null; }`, `interface HoldemView { street: HoldemStreet; communityCards: Card[]; actingPlayerId: string | null; pots: Pot[]; results: HoldemResult[] | null; players: HoldemPlayerView[]; }`, `interface TableStateView { gameMode: GameMode; handInProgress: boolean; seats: SeatView[]; activeSeatIndex: number | null; blackjackRounds: Record<number, BlackjackRoundView> | null; holdem: HoldemView | null; }`, `Table.getStateForSeat(viewerSeatIndex: number | null): TableStateView`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/table.test.ts`:

```typescript
describe('Table.getStateForSeat', () => {
  it('hides the dealer hole card in Blackjack until settled', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const view = table.getStateForSeat(0);
    expect(view.blackjackRounds![0].dealerUpcard).toBeDefined();
    expect(view.blackjackRounds![0].dealerCards).toBeNull();
    expect(view.blackjackRounds![0].results).toBeNull();
  });

  it('reveals the full dealer hand and results once a round settles', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'stand');

    const view = table.getStateForSeat(0);
    expect(view.blackjackRounds![0].dealerCards).not.toBeNull();
    expect(view.blackjackRounds![0].results).not.toBeNull();
  });

  it('shows a Hold\'em player their own hole cards but not an opponent\'s', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const aliceView = table.getStateForSeat(0);
    const alice = aliceView.holdem!.players.find((p) => p.playerId === 'alice')!;
    const bobFromAliceView = aliceView.holdem!.players.find((p) => p.playerId === 'bob')!;
    expect(alice.holeCards).not.toBeNull();
    expect(bobFromAliceView.holeCards).toBeNull();
  });

  it('reveals hole cards for non-folded players to everyone once the street settles', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    // alice is dealt into a hand and immediately calls, but the simplest way
    // to reach settled is bob folding after alice acts.
    await table.submitAction(0, 'call');
    await table.submitAction(1, 'fold');

    const spectatorView = table.getStateForSeat(null);
    const alice = spectatorView.holdem!.players.find((p) => p.playerId === 'alice')!;
    expect(alice.holeCards).not.toBeNull(); // alice reached showdown uncontested-favorably, did not fold
  });

  it('an empty seat has a null displayName and no other identifying data', async () => {
    const { table } = makeTable();
    await table.join('alice');
    const view = table.getStateForSeat(0);
    expect(view.seats[1]).toEqual({ seatIndex: 1, displayName: null, balance: 0, connected: false, ready: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `table.getStateForSeat` is not a function.

- [ ] **Step 3: Implement `getStateForSeat`**

Add these type imports to the top of `packages/server/src/table.ts`, alongside the
existing import from `@poker-blackjack/game-engine`:

```typescript
import type { RoundPhase, RoundResult, HoldemStreet, HoldemResult, Pot } from '@poker-blackjack/game-engine';
```

Add these exported interfaces to `packages/server/src/table.ts`, alongside the
existing `Seat`/`TableConfig`/`TableDeps` interfaces:

```typescript
export interface SeatView {
  seatIndex: number;
  displayName: string | null;
  balance: number;
  connected: boolean;
  ready: boolean;
}

export interface BlackjackRoundView {
  phase: RoundPhase;
  playerHands: PlayerHand[];
  dealerUpcard: Card;
  dealerCards: Card[] | null;
  results: RoundResult[] | null;
}

export interface HoldemPlayerView {
  playerId: string;
  stack: number;
  streetContributed: number;
  folded: boolean;
  isAllIn: boolean;
  holeCards: [Card, Card] | null;
}

export interface HoldemView {
  street: HoldemStreet;
  communityCards: Card[];
  actingPlayerId: string | null;
  pots: Pot[];
  results: HoldemResult[] | null;
  players: HoldemPlayerView[];
}

export interface TableStateView {
  gameMode: GameMode;
  handInProgress: boolean;
  seats: SeatView[];
  activeSeatIndex: number | null;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  holdem: HoldemView | null;
}
```

`PlayerHand` must also be added to the existing `@poker-blackjack/game-engine` type
import at the top of the file (alongside `HoldemPlayerInput`, `HoldemHandConfig`, etc.).

Add this method to the `Table` class:

```typescript
  getStateForSeat(viewerSeatIndex: number | null): TableStateView {
    const seats: SeatView[] = this.seats.map((s, i) =>
      s
        ? { seatIndex: i, displayName: s.displayName, balance: s.balance, connected: s.connected, ready: s.ready }
        : { seatIndex: i, displayName: null, balance: 0, connected: false, ready: false }
    );

    let blackjackRounds: Record<number, BlackjackRoundView> | null = null;
    if (this.config.gameMode === 'blackjack' && this.blackjackRounds.size > 0) {
      blackjackRounds = {};
      for (const [seatIndex, round] of this.blackjackRounds.entries()) {
        blackjackRounds[seatIndex] = {
          phase: round.phase,
          playerHands: round.playerHands,
          dealerUpcard: round.getDealerUpcard(),
          dealerCards: round.phase === 'settled' ? round.getDealerCards() : null,
          results: round.phase === 'settled' ? round.results : null,
        };
      }
    }

    let holdem: HoldemView | null = null;
    if (this.config.gameMode === 'holdem' && this.holdemHand) {
      const hand = this.holdemHand;
      const viewerDisplayName =
        viewerSeatIndex !== null ? (this.seats[viewerSeatIndex]?.displayName ?? null) : null;
      holdem = {
        street: hand.street,
        communityCards: hand.communityCards,
        actingPlayerId: hand.actingPlayerId,
        pots: hand.pots,
        results: hand.street === 'settled' ? hand.results : null,
        players: hand.players.map((p) => ({
          playerId: p.playerId,
          stack: p.stack,
          streetContributed: p.streetContributed,
          folded: p.folded,
          isAllIn: p.isAllIn,
          holeCards:
            p.playerId === viewerDisplayName || (hand.street === 'settled' && !p.folded)
              ? p.holeCards
              : null,
        })),
      };
    }

    return {
      gameMode: this.config.gameMode,
      handInProgress: this.handInProgress,
      seats,
      activeSeatIndex: this.activeSeatIndex,
      blackjackRounds,
      holdem,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's additions to `table.test.ts`, all green

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts
git commit -m "feat(server): add Table.getStateForSeat with hole-card/dealer-card filtering"
```

---

### Task 8: `protocol.ts` + `socketServer.ts` + `index.ts`

Wires `Table` to real Socket.IO connections. Everything game/state-related is already
built and tested against `Table`'s own API (Tasks 3-7) — this task is a thin
translation layer plus a smoke-test of the wiring itself. The full multi-scenario
proof (reconnect, disconnect timeout, restart persistence, crash recovery) is Tasks
9-10, which exercise this layer through real `socket.io-client` connections.

**Files:**
- Create: `packages/server/src/protocol.ts`
- Create: `packages/server/src/socketServer.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Consumes: `Table`, `TableConfig`, `TableStateView` (Tasks 3-7); `PlayerStore` (Task 1); `HandLog` (Task 2); `PlayerAction`, `HoldemAction` from `@poker-blackjack/game-engine`.
- Produces: `createServer(config, playerStore, handLog): Promise<{ httpServer: HttpServer; io: SocketIOServer; table: Table }>`.

- [ ] **Step 1: Write `protocol.ts`**

`packages/server/src/protocol.ts`:

```typescript
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import type { TableStateView } from './table';

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

export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  ready: () => void;
  action: (payload: ActionPayload) => void;
  leave: () => void;
}

export interface ServerToClientEvents {
  state: (state: TableStateView) => void;
  error: (payload: ErrorPayload) => void;
}
```

- [ ] **Step 2: Write the failing tests for `socketServer`**

`packages/server/src/socketServer.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: FAIL — `socketServer.ts` does not exist.

- [ ] **Step 4: Implement `socketServer.ts` and `index.ts`**

`packages/server/src/socketServer.ts`:

```typescript
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { Table, type TableConfig } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';
import type { ClientToServerEvents, ServerToClientEvents, JoinPayload, ActionPayload } from './protocol';

export interface CreateServerResult {
  httpServer: HttpServer;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  table: Table;
}

export async function createServer(
  config: TableConfig,
  playerStore: PlayerStore,
  handLog: HandLog
): Promise<CreateServerResult> {
  const httpServer = createHttpServer();
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  const seatBySocketId = new Map<string, number>();

  const broadcast = () => {
    for (const [socketId, socket] of io.sockets.sockets) {
      const seatIndex = seatBySocketId.get(socketId) ?? null;
      socket.emit('state', table.getStateForSeat(seatIndex));
    }
  };

  const table = new Table(config, { playerStore, handLog, onStateChange: broadcast });
  await table.recoverFromLog();

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    socket.on('join', async (payload: JoinPayload) => {
      try {
        const existingSeatIndex = table.reconnect(payload.displayName);
        const seatIndex = existingSeatIndex ?? (await table.join(payload.displayName));
        seatBySocketId.set(socket.id, seatIndex);
        socket.emit('state', table.getStateForSeat(seatIndex));
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('ready', async () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined) {
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
      if (seatIndex === undefined) {
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
      if (seatIndex === undefined) {
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

    socket.on('disconnect', () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex !== undefined) {
        table.disconnect(seatIndex);
        seatBySocketId.delete(socket.id);
      }
    });
  });

  return { httpServer, io, table };
}
```

`packages/server/src/index.ts`:

```typescript
import { createServer } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import type { TableConfig } from './table';

const config: TableConfig = {
  gameMode: process.env.GAME_MODE === 'blackjack' ? 'blackjack' : 'holdem',
  seatCount: 8,
  smallBlind: Number(process.env.SMALL_BLIND ?? 5),
  bigBlind: Number(process.env.BIG_BLIND ?? 10),
  blackjackDefaultBet: Number(process.env.BLACKJACK_DEFAULT_BET ?? 25),
  defaultStartingBalance: Number(process.env.DEFAULT_STARTING_BALANCE ?? 1000),
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 120_000),
  random: Math.random,
};

const playerStore = new JsonPlayerStore(
  process.env.PLAYER_STORE_PATH ?? './balances.json',
  config.defaultStartingBalance
);
const handLog = new JsonlHandLog(process.env.HAND_LOG_PATH ?? './hand.jsonl');
const port = Number(process.env.PORT ?? 3000);

createServer(config, playerStore, handLog).then(({ httpServer }) => {
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's new `socketServer.test.ts`, all green

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/protocol.ts packages/server/src/socketServer.ts packages/server/src/index.ts packages/server/src/socketServer.test.ts
git commit -m "feat(server): wire Table to Socket.IO via createServer, add entry point"
```

---

### Task 9: Integration tests — happy path (both games, real sockets)

`socketServer.test.ts` (Task 8) already proves the wiring itself works. This task
proves a hand can be played to genuine completion end-to-end through real
`socket.io-client` connections for both games, with balances verified via a *fresh*
`PlayerStore` read (proving the commit went through the store, not just Table's
in-memory state).

For Hold'em, the fastest deterministic way to reach a genuine showdown (not just an
uncontested win, which is already well-covered by earlier tasks) is both players going
all-in preflop: once both are all-in, `HoldemHand` cascades straight through the
remaining streets to settlement in a single call, with no further actions needed.

**Files:**
- Create: `packages/server/src/integration.test.ts`

**Interfaces:**
- Consumes: `createServer` (Task 8), `JsonPlayerStore` (Task 1), `JsonlHandLog` (Task 2), `TableConfig` (Task 3).

- [ ] **Step 1: Write the tests**

`packages/server/src/integration.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace so far, including this task's 4 new
`integration.test.ts` tests, all green. If any fail, the failure is in the
wiring/game logic built in Tasks 1-8, not in this test file — debug against
`Table`'s own unit tests first before suspecting the integration test itself.

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/server`
Expected: no errors

```bash
git add packages/server/src/integration.test.ts
git commit -m "test(server): add happy-path integration tests for both games"
```

---

### Task 10: Integration tests — resilience (reconnect, disconnect-timeout, restart, crash recovery)

The scenarios this plan's design spec calls out as needing dedicated proof, not just
casual confidence: a real client reconnecting mid-hand, a real disconnect past the
grace window, balances surviving a real process boundary, and a hand recovering from a
simulated crash and continuing to play correctly afterward.

**Files:**
- Create: `packages/server/src/integration-resilience.test.ts`

**Interfaces:**
- Consumes: `createServer` (Task 8), `JsonPlayerStore` (Task 1), `JsonlHandLog` (Task 2), `TableConfig` (Task 3), `TableStateView` (Task 7).

- [ ] **Step 1: Write the tests**

`packages/server/src/integration-resilience.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test --workspace=@poker-blackjack/server`
Expected: PASS — every test in the workspace, including this task's 4 new
`integration-resilience.test.ts` tests, all green

- [ ] **Step 3: Run the full workspace test suite and typecheck**

Run: `npm test` (from the repo root)
Expected: PASS — every workspace green, including `@poker-blackjack/game-engine`'s
existing 115 tests and every test added across `packages/server` in Tasks 1-10.

Run: `npm run typecheck` (from the repo root)
Expected: no errors in any workspace.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/integration-resilience.test.ts
git commit -m "test(server): add resilience integration tests (reconnect, timeout, restart, crash recovery)"
```
