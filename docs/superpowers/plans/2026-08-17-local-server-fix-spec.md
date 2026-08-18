# Plan 3 (local-server) — Final review fix specification

**Status as of hand-off (2026-08-18): NOT YET APPLIED.** The final whole-branch review
(full text: `2026-08-17-local-server-final-review.md` in this folder) found 3 Critical
and 8 Important bugs. This document is the exact, ready-to-implement fix for all of
them, designed by the controller and dispatched to an implementer subagent three times
— all three attempts failed on Anthropic-side `529 Overloaded` server errors before any
code was touched (zero files changed, HEAD still at `76d6dee`, working tree clean).
**Nothing below has been applied to the code yet.** This is the literal next step for
Plan 3.

Read the full review first for *why* each fix matters — this document is deliberately
just the *what*, matching what was handed to the implementer. Read the current state of
the 4 files below before making any change; don't assume the line numbers in the review
still match exactly — re-locate each piece by its content.

---

## Fix Group 1 — Hand-eligibility + lifecycle safety (closes C1, C2, I1, I6, plus one additional Blackjack-settlement fix in the same spirit)

**File:** `packages/server/src/table.ts`

### 1a. Add an eligibility filter, and use it everywhere a hand can start

Add a new private method:

```typescript
  private eligibleSeatsForHand(): Seat[] {
    return this.seats.filter((s): s is Seat => {
      if (s === null || !s.connected) {
        return false;
      }
      return this.config.gameMode === 'holdem' ? s.balance > 0 : s.balance >= this.config.blackjackDefaultBet;
    });
  }
```

Change `startHandIfEveryoneReady` from using
`this.seats.filter((s): s is Seat => s !== null && s.connected)` to use
`this.eligibleSeatsForHand()` instead — same shape, just swap the source of
`connectedSeats` (rename the local variable to `eligibleSeats` for clarity) so seats
that can't afford to play are excluded from both the "at least 2" count and the
"everyone ready" check, and are excluded from the list passed into `startHand`. A seat
failing this check stays visibly connected and seated (not kicked) — it just can't be
dealt in or block other players from starting a hand without it, matching the design
spec's "effectively out for the session" framing for a busted player.

### 1b. Add `reconnect()` to the set of methods that re-check the ready gate (closes I1)

`leave()`, `disconnect()`, and `setReady()` all call
`this.startHandIfEveryoneReady().catch(...)` (or await it) after changing seat state.
`reconnect()` currently does not, which means a player who was `ready: true` before
disconnecting arrives back with a stale `ready: true` and nothing re-evaluates whether
the table can now start — a reachable deadlock (both seats show connected+ready, no
hand starts, no client message updates that).

Add the same fire-and-forget call to `reconnect()`, right before its
`return seat.seatIndex;` line:

```typescript
    this.startHandIfEveryoneReady().catch((err) => {
      console.error(`Table: error starting hand after seat ${seat.seatIndex} reconnected:`, err);
    });
```

(Match the exact `console.error` message style already used in `leave()`/`disconnect()`
for consistency — substitute "reconnected" for "left"/"disconnected".)

### 1c. Wrap `startHand`'s risky section in try/catch (closes C1's residual risk beyond 1a, defense in depth)

With 1a in place, `HoldemHand`'s constructor should no longer see a `stack <= 0`
player — but the review specifically asked for an independent safety net so *any*
hand-construction failure (not just this one root cause) can't leave `handInProgress`
stuck. Wrap everything currently inside `startHand`'s
`if (this.config.gameMode === 'holdem') { ... } else { ... }` block in a try/catch. On
catch: log the error, reset `handInProgress = false`, `holdemHand = null`,
`blackjackRounds = new Map()`, `activeSeatIndex = null`, then clear the hand log (in its
own nested try/catch, matching the pattern already used in `recoverFromLog`'s catch
block — a failure to clear shouldn't throw past this), and `return` (skip the trailing
`this.deps.onStateChange()`, since nothing observable should have changed from any
connected client's perspective — no broadcast happened during the attempt either).

The resulting method shape:

```typescript
  private async startHand(seatedSeats: Seat[]): Promise<void> {
    this.handInProgress = true;
    this.lastSettledHoldemHand = null;
    this.lastSettledBlackjackRounds = null;

    try {
      if (this.config.gameMode === 'holdem') {
        // ...unchanged existing Hold'em branch body...
      } else {
        // ...unchanged existing Blackjack branch body...
      }
    } catch (err) {
      console.error('Table: failed to start hand, reverting to no hand in progress:', err);
      this.handInProgress = false;
      this.holdemHand = null;
      this.blackjackRounds = new Map();
      this.activeSeatIndex = null;
      try {
        await this.deps.handLog.clear();
      } catch (clearErr) {
        console.error('Table: failed to clear hand log after a failed hand start:', clearErr);
      }
      return;
    }

    this.deps.onStateChange();
  }
```

Do not change the Hold'em/Blackjack branch bodies themselves — just wrap them.

### 1d. `settleHoldem` — make individual payout failures non-fatal to the table (closes I6)

Currently, if `playerStore.setBalance` rejects mid-loop, the exception propagates out of
`settleHoldem` entirely, leaving `holdemSettled = true` but `handInProgress` still
`true` and `holdemHand` non-null-but-settled — every subsequent
`submitAction`/`leave()` throws forever (the same brick class as C1, reached via the
money path).

Change the loop so a rejected `setBalance` for one player doesn't prevent the others
from being attempted, and wrap the state-transition lines in a `finally` so they run
regardless:

```typescript
  private async settleHoldem(hand: HoldemHand): Promise<void> {
    if (this.holdemSettled) {
      return;
    }
    this.holdemSettled = true;
    try {
      for (const result of hand.results) {
        const seat = this.seats.find((s) => s?.displayName === result.playerId);
        if (seat) {
          seat.balance += result.payout;
          try {
            await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
          } catch (err) {
            console.error(
              `Table: failed to persist balance for ${seat.displayName} after Hold'em settlement (will retry on next successful write):`,
              err
            );
          }
        }
      }
    } finally {
      this.handInProgress = false;
      this.lastSettledHoldemHand = hand;
      this.holdemHand = null;
      for (const seat of this.seats) {
        if (seat) seat.ready = false;
      }
      this.timedOutSeats.clear();
    }
    await this.deps.handLog.clear();
  }
```

The in-memory `seat.balance` is always updated regardless of whether the persist
succeeds (matches the existing accepted "self-correcting on next successful write"
divergence class already noted elsewhere in this codebase) — only the *durable* write
is best-effort per player now, and no player's failed write blocks another player's
write from being attempted, and the table is never left stuck.

### 1e. `settleBlackjackSeatIfNeeded` — same resilience, adapted to Blackjack's per-seat settlement shape

This isn't explicitly named in the review, but it's the identical bug class as I6 in
the parallel Blackjack code path: if `playerStore.setBalance` rejects here, the
exception propagates out of `advancePastSettledBlackjackRounds`'s while-loop, which
never advances `activeSeatIndex` past the failed seat and never calls
`finishBlackjackHandIfComplete` — leaving `activeSeatIndex` stuck pointing at a seat
whose round is already `'settled'` (so any further action on it throws "Cannot act
while round is in phase 'settled'"), and `handInProgress` stuck `true` forever.

```typescript
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
    await this.deps.handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex } });
    try {
      await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
    } catch (err) {
      console.error(
        `Table: failed to persist balance for seat ${seatIndex} after Blackjack settlement (will retry on next successful write):`,
        err
      );
    }
  }
```

Only the final `await this.deps.playerStore.setBalance(...)` line changes — wrap it in
try/catch as shown. **The write-ahead marker ordering (append before setBalance) is
unchanged and must stay unchanged** — that's Task 6's already-hardened double-payment
protection; do not reorder it.

### Tests for Group 1 (add to `packages/server/src/table.test.ts`)

1. A regression test proving a 0-balance Hold'em seat is excluded from a hand and does
   not brick the table: 3 connected+ready seats where one has `balance: 0` — assert the
   hand starts with only the other two. A second test with exactly 2 seats where one is
   at 0 balance should show the hand simply never starts (not enough eligible players)
   rather than throwing/bricking.
2. A regression test proving a Blackjack seat below `blackjackDefaultBet` is excluded
   the same way, and that dealt seats' balances never go negative from a hand they
   weren't dealt into.
3. A regression test for I1: seat 0 readies, seat 1 disconnects then reconnects while
   already marked `ready` from before — assert a hand starts automatically on reconnect
   without a further `setReady` call.
4. A regression test for I6/1e: using the existing `ControllablePlayerStore`/an
   equivalent fake whose `setBalance` can be made to reject, settle a hand where one
   player's `setBalance` rejects — assert `handInProgress` still ends up `false`,
   `holdemHand`/round data still clears, and the *other* player's balance still gets
   updated and persisted. Cover both Hold'em and Blackjack if practical.
5. A test proving the try/catch in `startHand` (1c) actually resets state on a thrown
   error — may need a scenario that forces the constructor to throw for a reason
   *other* than the now-filtered 0-balance case, or a test double / monkey-patch.

---

## Fix Group 2 — Durability path (closes I2, I3, I4, I5, I7)

### 2a. `JsonlHandLog.clear()` — route through the write queue (closes I2)

**File:** `packages/server/src/handLog.ts`

`append()` already serializes writes via `this.writeQueue`, reassigned *synchronously*
(no `await`) so concurrent calls queue correctly. `clear()` currently bypasses this
entirely, so a `clear()` call racing an `append()` call for the *next* hand (started
right after `settleHoldem` sets `handInProgress = false` but before its own
`await this.deps.handLog.clear()` resolves) can silently wipe the new hand's
`hand_started` entry.

Change `clear()` to the exact same shape as `append()` — critically, it must NOT be
declared `async` and must NOT do `await this.writeQueue` (that would reopen the
identical race `append()`'s comment already explains):

```typescript
  clear(): Promise<void> {
    const write = this.writeQueue.then(() => writeFile(this.filePath, '', 'utf-8'));
    this.writeQueue = write.catch(() => {});
    return write;
  }
```

### 2b. `readAll()` — tolerate a single unparseable trailing line (closes I7)

Still in `handLog.ts`. Currently `readAll()` maps `JSON.parse` over every line, so one
truncated final line (the canonical artifact of a crash mid-`appendFile`) throws and
discards the *entire* hand on recovery — contradicting the design spec's stated
guarantee that a crash "loses at most that single in-flight action." Change it to drop
only a trailing unparseable line, while still throwing on a malformed *interior* line:

```typescript
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
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    const entries: HandLogEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]) as HandLogEntry);
      } catch (err) {
        if (i !== lines.length - 1) {
          throw err;
        }
        console.warn(
          `JsonlHandLog: dropping unparseable trailing line in ${this.filePath} (likely a torn crash-time write):`,
          err
        );
      }
    }
    return entries;
  }
```

### 2c. `recoverFromLog` — cross-check game mode, and handle an unrecognized entry type (closes I3, I4)

**File:** `packages/server/src/table.ts`, inside `recoverFromLog`.

Currently:
`if (started.type === 'holdem_hand_started') { ... } else if (started.type === 'blackjack_hand_started') { ... }`
with no `else` — an unrecognized type (or a type that doesn't match
`this.config.gameMode`, e.g. a Hold'em log recovered by a Blackjack-configured `Table`
after a reconfigured restart) silently falls through, replays nothing, and — critically
— never clears the log, so the same stale/mismatched entry poisons every future boot
permanently (this one survives a restart, unlike other failure modes here).

Add the game-mode check to both conditions and add an `else` branch:

```typescript
      if (started.type === 'holdem_hand_started' && this.config.gameMode === 'holdem') {
        // ...unchanged existing Hold'em branch...
      } else if (started.type === 'blackjack_hand_started' && this.config.gameMode === 'blackjack') {
        // ...unchanged existing Blackjack branch...
      } else {
        console.warn(
          `Table: hand log's first entry (type "${started.type}") is not a recognized, mode-appropriate ` +
          `hand start for gameMode "${this.config.gameMode}" -- discarding it.`
        );
        await this.deps.handLog.clear();
        return;
      }
```

Do not change the internals of either existing branch — only their conditions, and the
new `else`.

### 2d. `JsonPlayerStore` — atomic writes and corruption tolerance (closes I5)

**File:** `packages/server/src/playerStore.ts`

Two independent problems: `writeAll` is a bare `writeFile` with no atomicity, so a
crash mid-write can leave a truncated/partial file; and `readAll` only catches
`ENOENT`, so any other read/parse failure (including that truncated file) rejects
forever, taking down `getBalance` for every player permanently — this is the *durable*
money file, and it currently has strictly weaker crash protection than the transient
hand log already has.

Rewrite the file as:

```typescript
import { readFile, writeFile, rename } from 'node:fs/promises';

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
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.create(null) as BalanceMap;
      }
      throw err;
    }
    try {
      const parsed = JSON.parse(raw) as BalanceMap;
      // Copy onto a null-prototype object: a plain {} would let a
      // displayName like "constructor"/"toString"/"__proto__" resolve to an
      // inherited Object.prototype member instead of `undefined`, so
      // `data[displayName] ?? default` would never fire and getBalance would
      // return a function, not a number -- silently bricking any table that
      // player joins. This closes that regardless of how the caller looks
      // the value up.
      return Object.assign(Object.create(null) as BalanceMap, parsed);
    } catch (err) {
      console.error(`PlayerStore: balances file at ${this.filePath} is corrupted, treating as empty:`, err);
      return Object.create(null) as BalanceMap;
    }
  }

  private async writeAll(data: BalanceMap): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, this.filePath);
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

`getBalance`/`setBalance`'s bodies are unchanged — only `readAll`/`writeAll`'s
internals and the import line change. The `rename` is what makes the write atomic
(standard temp-file-then-rename pattern, atomic on both NTFS and POSIX filesystems).

### Tests for Group 2

- `handLog.test.ts`: a regression test for 2a proving `clear()` and `append()`
  serialize correctly relative to each other — kick off a `clear()` and an `append()`
  without awaiting either first (in the order that represents the real race: a clear
  from one settling hand racing an append from the next), await both, and assert the
  final `readAll()` reflects the correct final state rather than a nondeterministic
  result. A test double controlling the underlying `writeFile` timing, or a
  repeated-trials real-fs approach (following whichever pattern this file or
  `table.test.ts`'s existing concurrency tests already use), are both acceptable.
- `handLog.test.ts`: a regression test for 2b — write a well-formed line followed by a
  manually-truncated/malformed trailing line directly to the file (bypassing
  `append()`), then assert `readAll()` returns just the well-formed entries rather than
  throwing. Also confirm an existing test still proves a malformed *interior* line
  still throws.
- `table.test.ts`: a regression test for 2c proving a Table configured for one game
  mode does NOT replay a log written by the other mode — assert the log gets cleared
  (not replayed) and the table ends up in a normal fresh (`handInProgress: false`)
  state, not bricked.
- `playerStore.test.ts`: a regression test for 2d proving `getBalance` on a corrupted
  (unparseable) file returns the default balance instead of rejecting; a regression
  test proving `getBalance("constructor")` (or `"__proto__"`, `"toString"`,
  `"hasOwnProperty"`) returns the configured default balance as a plain number, not a
  prototype member.

---

## Fix Group 3 — Input validation at the network boundary (closes C3's socket-layer half)

**File:** `packages/server/src/socketServer.ts`

Group 2d already closes the storage-layer half of C3 (a malicious `displayName` can no
longer corrupt a balance lookup no matter what value it is). This adds the
network-boundary validation the design spec explicitly requires ("malformed or
unexpected socket payloads are rejected before reaching the engine at all") as defense
in depth.

Add a small validation helper near the top of the file (after the imports, before
`createServer`):

```typescript
function isValidDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 32;
}
```

In the `join` handler, validate before doing anything else:

```typescript
    socket.on('join', async (payload: JoinPayload) => {
      if (!isValidDisplayName(payload?.displayName)) {
        socket.emit('error', { message: 'Invalid display name' });
        return;
      }
      try {
        const existingSeatIndex = table.reconnect(payload.displayName);
        // ...rest of the existing handler body, unchanged...
```

The 32-character bound is a judgment call, not a spec requirement.

### Test for Group 3

`socketServer.test.ts`: a test emitting `join` with a malformed `displayName` (empty
string, whitespace-only, and/or a non-string value) and asserting the socket receives
an `error` event rather than being seated, and that no seat gets consumed.

---

## Fix Group 4 — Hole-card access-control integration coverage (closes I8)

**File:** `packages/server/src/integration.test.ts` (or wherever fits best)

Every existing integration test happens to only assert viewer-*independent* fields —
nothing anywhere proves the per-viewer hole-card filtering is actually correct when
carried over the real Socket.IO wire.

Note: every `state` event any given socket receives is *already* computed per-socket
via that socket's own mapped seat index — no new mechanism needs inventing. Just add
the previously-missing assertion: after a Hold'em hand has started (both players dealt
in), check each player's own most-recently-received `state.holdem.players` array and
assert their own entry's `holeCards` is non-null, and their opponent's is null.

The simplest approach is likely extending the existing "plays a full Hold'em hand to
showdown" test to capture the hand-started state on *both* sockets and add these
assertions.

---

## Fix Group 5 — Document the invariant Group 2c/recovery depends on (small, no test needed)

**File:** `packages/server/src/socketServer.ts`, in `createServer`, immediately above
the existing `await table.recoverFromLog();` line.

```typescript
  // recoverFromLog() must complete before the connection handler below is
  // registered, and before any caller of createServer() calls httpServer.listen().
  // This is more than a documented startup-ordering nicety: Table.recoverFromLog's
  // own catch block (on a corrupted log) does a wholesale reset of every seat to
  // null, which is only safe because no socket-to-seat mapping can exist yet at
  // that point. Reordering registration ahead of recovery, or making recovery
  // lazy, would silently reopen the class of orphaned-seat bug this file's join
  // handler was specifically hardened to close.
  await table.recoverFromLog();
```

---

## After All Fixes: Verification Checklist

1. `npm run test --workspace=@poker-blackjack/server` — every test green, including all
   new regression tests.
2. `npm test` from the repo root — full monorepo green (game-engine 115 + everything in
   server).
3. `npm run typecheck` from the repo root — no errors in either workspace.
4. Re-read the diff once, end to end, before committing — specifically re-verify: the
   write-ahead marker-before-balance ordering in `settleBlackjackSeatIfNeeded` is
   unchanged; the `writeQueue` reassignment in `clear()` is synchronous with no `await`
   before it; the two `recoverFromLog` branch bodies are byte-identical to before
   except for their conditions.

## After Verification: Re-review, then PR

Per this plan's established process (see the progress ledger for the full pattern used
across all 10 tasks): generate a review package scoped to just this fix commit
(`scripts/review-package 76d6dee HEAD` from the `subagent-driven-development` skill,
once this fix is committed), and dispatch an opus-tier reviewer — ideally by resuming
the original final-review agent's context if that's still available, otherwise a fresh
one given the full final-review document above plus this fix spec as "what was
requested." Once that comes back clean (or with only Minor findings), proceed to
`superpowers:finishing-a-development-branch` and open the PR (`local-server` → `master`).
**Do not open the PR or merge without this fix landing and being re-reviewed first** —
the current `local-server` branch (HEAD `76d6dee`) has known Critical bugs and should
not be merged as-is.
