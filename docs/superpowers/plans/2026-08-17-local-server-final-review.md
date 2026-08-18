# Plan 3 (local-server) — Final whole-branch review

Reviewer: opus, agent a313b0f9bc03cef6c. Range: 0420651..76d6dee (24 commits).
Verdict: **Ready to merge? No — with fixes.**

Full verbatim reviewer output preserved here as the durable record for the fix round and any future reference.

---

### Strengths

These are real, not politeness — several are better than what I'd expect from a first pass.

- **`table.ts:109-137` — the `join()` concurrency fix.** The post-await re-check is correct *and* the comment explains precisely why it's correct (single-threaded microtask semantics make the check-and-write atomic because there is no further `await` between them). That reasoning is what makes the fix reviewable rather than cargo-culted. Backed by genuine regression tests at `table.test.ts:212-291` covering both the same-name and different-name-racing-for-one-seat cases.
- **`table.ts:385-399` + `table.test.ts:1149-1203` — write-ahead settlement marker.** The marker is appended *before* the balance write, deliberately biasing a crash toward a lost payout rather than a double payout. The test that pins this is unusually well built: it compares `invocationCallOrder` across two separate spies, so it proves *relative* ordering rather than mere occurrence, and the comment states outright that nothing else in the suite would catch a swap. This is the single best-defended invariant on the branch.
- **`handLog.ts:28-38` — write serialization.** Two subtleties both handled: `this.writeQueue` is reassigned *synchronously* (assigning via `await` would let a second caller race the reassignment and defeat the whole mechanism), and failures are tracked on a separate `.catch(() => {})` chain so one rejected write can't permanently wedge every subsequent append while callers still observe their own write's real outcome.
- **`socketServer.ts:41-56` — the seat-orphan fix.** Covers both halves: a socket that already held a different seat, and a socket that died while its `join` await was in flight. The second case routes the seat into the normal grace-window path rather than leaving a permanent `connected: true` orphan — the right call. Tested at `socketServer.test.ts:168-311`.
- **`table.ts:401-413` — deriving Blackjack advancement from `blackjackRounds.keys()`** rather than live seats. Correct, because the dealt set and the seated set genuinely diverge mid-hand.
- **`table.ts:522-578` — `getStateForSeat`** faithfully implements the engines' own doc-comment contracts (`holdemHand.ts:43-48`, `blackjackRound.ts:71-75`). This is the first place in the codebase where those contracts are enforced rather than merely documented.
- **Global Constraints compliance is exact.** Package name, `"type": "module"`, `target: ES2022` / `module: ESNext` / `moduleResolution: Bundler` / `strict`, all four dependency floors, `seatCount: 8` uniform, `displayName` as both `PlayerStore` key and Hold'em `playerId`, all-Promise storage interfaces, `Table`-built 6-deck shoe via public `createDeck`/`shuffle`, no manual client. The grace window is configured everywhere and every test that exercises it uses real `setTimeout` at 30-300 ms — no fake timers anywhere. Checked each of these individually rather than spot-checking.
- **Tests verify behavior, not mocks.** `FakePlayerStore`/`FakeHandLog` are real in-memory implementations of the real interfaces; no engine is ever mocked; `ControllableHandLog`/`ControllablePlayerStore` gate on real promises to construct real interleavings. `a1b679a` even round-trips the fakes through JSON so they can't diverge from the JSONL implementations' semantics.
- **`createServer` ordering is right:** `recoverFromLog()` completes (line 34) before `io.on('connection')` is wired (line 36) and before the caller ever calls `listen()`. That honors the spec's Section 5 step 7 requirement exactly, and it is load-bearing for more than it appears (see the invariant note under the carried-findings triage below).

---

### Issues

#### Critical (Must Fix)

**C1. A busted (0-chip) player permanently bricks the Hold'em table.**
`table.ts:269-293` (no affordability guard anywhere in `startHand`)

`startHand` sets `handInProgress = true` (line 270), appends `holdem_hand_started` (line 289), then constructs `new HoldemHand(players, holdemConfig)` (line 293). `HoldemHand`'s constructor throws on any player with `stack <= 0` (`holdemHand.ts:89-91`). Nothing resets `handInProgress` on that path.

Reproduced against the real `Table`: `setReady` throws "Player alice must start with a positive stack"; `handInProgress` stays `true`, `holdemHand` stays `null`; `handLog` holds a stale `holdem_hand_started` entry; `leave()` throws "Cannot leave while a hand is in progress"; `submitAction` throws (dereferences null); topping the player back up and re-readying does NOT help — still bricked.

Every exit is closed: `submitAction` dereferences `this.holdemHand!` and TypeErrors, `leave()` throws, `setReady()` no-ops because `startHandIfEveryoneReady` gates on `!this.handInProgress`. Only a process restart recovers.

**Why this matters:** the trigger is an ordinary game outcome, not an edge case — and this branch's own integration test asserts it. `integration.test.ts:117` reads `expect([0, 1000, 2000]).toContain(aliceBalance)`, i.e. the suite explicitly accepts a player finishing an all-in confrontation with exactly 0 chips. The very next hand that table tries to start is dead, for everyone, permanently. The spec (Section 6) says a 0-balance player "is effectively out for the session" — the implementation instead takes the whole table out.

**Fix:** exclude seats with `balance <= 0` (Hold'em) from the dealt set in `startHandIfEveryoneReady`/`startHand`, the same way disconnected seats are already excluded, and re-check the `>= 2` minimum after filtering. Independently, wrap the `handInProgress = true` … engine-construction window in try/catch so *any* construction failure resets `handInProgress`, `holdemHand`, and clears the log entry it just wrote.

This is carried-forward item 11, which Task 5's reviewer called "worth a separate ticket, not blocking." At task scope that was defensible; at branch scope, with settlement now implemented and proven to produce zero balances, it is a must-fix.

---

**C2. Blackjack has no affordability check at all — balances go unbounded negative.**
`table.ts:296-301`

The Blackjack branch of `startHand` deals every connected seat a round at `this.config.blackjackDefaultBet` with no reference to `s.balance`. `BlackjackRound` has no stack concept to reject it. Settlement then does `seat.balance += totalPayout` (`table.ts:396`) with no floor.

Reproduced: two 0-balance players → hand starts (`handInProgress=true`, 2 rounds) → post-settle balances: alice = -25, bob = -25. There is no bound — players can keep readying up and keep going more negative. This directly contradicts spec Section 6 ("A player whose balance reaches 0 can't … place a bet"). Hold'em at least *fails loudly* (C1); Blackjack silently manufactures chips that don't exist.

Invisible from existing tests because every Blackjack test starts players at 1000 and plays one hand.

**Fix:** in the Blackjack branch, exclude seats whose `balance < blackjackDefaultBet` from the dealt rounds (or clamp the bet to the balance for short stacks). Same `>= 2` re-check after filtering.

---

**C3. An unvalidated `displayName` returns a prototype member as the player's balance, brickable from any unauthenticated socket.**
`playerStore.ts:34` (`data[displayName] ?? this.defaultStartingBalance`), reached from `socketServer.ts:37-40` with no validation.

`JsonPlayerStore.readAll()` returns a `JSON.parse` result — a plain object with `Object.prototype` on its chain. Indexing it with an inherited key returns the inherited member, which is never nullish, so `??` never fires: `getBalance("__proto__")` → an object; `getBalance("constructor")` → a function; `getBalance("toString")` → a function; `getBalance("hasOwnProperty")` → a function. `getBalance("")` → 1000 (empty string accepted as a valid, distinct identity).

End-to-end through `Table`: `join { displayName: "constructor" }` → seat balance becomes a function → `setReady` throws "Player constructor must have a finite stack" → same permanent brick as C1. `cors: { origin: '*' }` (`socketServer.ts:21`) means any web page the operator's browser visits can drive this — not just a client they ran deliberately.

The design spec's Section 6 states the requirement this misses verbatim: "**Malformed or unexpected socket payloads are rejected before reaching the engine at all** — never let unvalidated input reach `.act()`." No such validation layer exists; `payload.action`/`payload.amount` are passed straight through with bare `as` casts. For *actions* the engine's own `validateAction` is a genuinely solid backstop (throwing `default` case, `Number.isFinite` checks, stack-sufficiency checks) — rated Minor. The `displayName` path has no backstop at all.

**Fix (two independent, both cheap):** in `playerStore.ts`, build the map with `Object.create(null)` or use `Object.hasOwn(data, displayName) ? data[displayName] : this.defaultStartingBalance`. In `socketServer.ts`'s `join` handler, validate `displayName` is a non-empty string within a sane length before it reaches `Table`.

---

#### Important (Should Fix)

**I1. `reconnect()` is the one seat-state-changing method that doesn't re-run the ready gate — between-hands reconnect deadlocks the table.**
`table.ts:202-216`

`leave()`, `disconnect()`, and `setReady()` all call `startHandIfEveryoneReady()`. `reconnect()` does not. A player who readies up, drops briefly, and reconnects arrives with `ready: true` (disconnect doesn't touch `ready`) — and nothing re-evaluates the gate. Reproduced: both seats end up connected+ready with no hand started — deadlock, only escaped by a redundant `setReady` a UI showing "you are ready" has no reason to send. Same bug class as Task 5's C1, missed on the reconnect side.

**Fix:** add the same fire-and-forget `startHandIfEveryoneReady().catch(...)` to `reconnect()`.

---

**I2. `JsonlHandLog.clear()` bypasses the write queue, and the next hand's `hand_started` can be silently wiped.**
`handLog.ts:56-58` vs. `28-38`

Carried item 9 judged this safe reasoning only about appends *preceding* the clear — it didn't consider the *following* one. `settleHoldem` sets `handInProgress = false` and clears every `ready` flag, **then** awaits `clear()`. During that in-flight `writeFile`, the table is publicly between-hands, so two incoming `ready` events can start the next hand and `append('holdem_hand_started')` — landing on an already-drained `writeQueue`, racing the un-queued truncate. `finishBlackjackHandIfComplete` has the identical shape.

Measured over 200 trials: `hand_started` survived 196, wiped by the racing clear in 4 (2%). That leaves a hand in progress with an empty log — crash recovery silently disabled for that hand.

**Fix:** route `clear()` through `writeQueue` exactly as `append()` does. One line.

---

**I3. An unrecognized first log entry is a silent no-op that never clears the log — permanently poisoning crash recovery.**
`table.ts:435-499` (no `else` branch)

Confirmed with the downstream consequence carried item 10 didn't trace: the stale first line survives every boot, every subsequent hand appends behind it, and `recoverFromLog` reads that stale line as `started` forever — crash recovery is dead for the lifetime of the file, no symptom until someone actually crashes. Composed with I2 (which can *produce* exactly this state), a 2% transient race becomes a permanent, silent loss of the branch's headline feature.

**Fix:** add `else { console.warn(...); await this.deps.handLog.clear(); return; }`.

---

**I4. `recoverFromLog` doesn't cross-check the log against `config.gameMode` — and the resulting brick survives restarts.**
`table.ts:427-499`

Carried item 3, but worse than its framing. Reproduced: a Blackjack-configured `Table` recovering a Hold'em log ends with `handInProgress: true` and *no game data at all* visible to clients; every action and `leave` throw; the log is never cleared, so **restarting reproduces the identical bricked state** — unlike C1, a restart does not fix this. Only manually deleting `hand.jsonl` does.

The spec makes cross-process mode switching the *supported* way to change games, so "restart with `GAME_MODE` flipped" is a sanctioned workflow that can permanently brick the server if a hand happens to be in flight.

**Fix:** compare the entry type against `this.config.gameMode`; on mismatch, log and clear rather than replay. Folds naturally into I3's `else`.

---

**I5. `JsonPlayerStore` has no atomic write and no corrupt-file handling — the one file holding the money.**
`playerStore.ts:16-30`

`writeAll` is a bare `writeFile` (no temp-and-rename, no fsync), runs on every settlement. `readAll` catches only `ENOENT`. Reproduced: `getBalance` on an empty `balances.json` throws `SyntaxError`. A crash in the truncate-to-write window leaves a zero-length/partial file, after which **every** `getBalance` rejects forever — no one can join, every balance is gone, no recovery path. Contrast: the transient hand log got a corrupted-file catch (Task 6); the *durable* money file got neither.

**Fix:** write to `${filePath}.tmp` and `rename` (atomic on both NTFS and POSIX); handle a parse failure explicitly.

Also flagged (not currently live, documented for Plan 6's benefit): `setBalance` is a read-modify-write across an `await` — two concurrent calls would lose an update. `Table` happens to serialize every call site today, so this is latent, but undocumented, and the interface is explicitly designed to be reimplemented (DynamoDB).

---

**I6. No error boundary around settlement — a rejected `PlayerStore` write leaves the table permanently unplayable.**
`table.ts:363-383`

`settleHoldem` sets `holdemSettled = true` and *then* performs the balance writes, only afterwards transitioning `handInProgress`/`holdemHand`/`ready`/log-clear. If any `setBalance` rejects mid-loop, the method exits with `holdemSettled = true`, `handInProgress = true`, `holdemHand` non-null but settled — every subsequent `submitAction`/`leave()` throws forever, and the double-settle guard prevents the hand from ever completing. Same brick class as C1, reached via the money path instead of the deal path. This is the concrete consequence of carried item 8.

**Fix:** perform the state transition in a `finally`, or move the `handInProgress = false`/`holdemHand = null` transition ahead of the balance writes so a storage failure degrades to "a payout didn't land" rather than "the table is dead."

---

**I7. A torn JSONL line discards the whole hand, not just the last action — contradicting the spec's stated guarantee.**
`handLog.ts:50-53`

Reproduced: `readAll` on a torn log throws `SyntaxError` (unterminated string) — `JSON.parse` mapped over every line, so one truncated final line (the canonical crash-mid-`appendFile` artifact) throws, and `recoverFromLog`'s catch discards the *entire hand* and clears the log. Spec Section 6 advertises the opposite: a crash mid-write "loses at most that single in-flight action on recovery."

Existing coverage doesn't reach this: the corrupted-log test uses an in-memory `FakeHandLog` seeded with a structurally-invalid entry, never through `JsonlHandLog`'s actual parse failure. Behavior is safe (fail-closed, no double payment) — just delivers less than the spec promises.

**Fix:** tolerate a single unparseable *trailing* line in `readAll` (drop it — exactly the torn-write case), while still throwing on a malformed interior line.

---

**I8. The hole-card access-control boundary has zero integration-level coverage.**
Carried item 19, escalated from "breadth gap" to Important.

Every `waitForState`/`waitForEvent` in both integration suites resolves on a broadcast emission (`getStateForSeat(null)`) with viewer-independent assertions — nothing proves the *per-seat targeted emit* in `socketServer.ts:58` carries a correctly-filtered view over the wire. This is the branch's only security boundary and Task 8 is what first exposes it to the network. One test (alice sees her own `holeCards`, bob's are `null` in her view and vice versa) would be disproportionately valuable and is cheap to add.

---

#### Minor (Nice to Have)

- `table.ts:455-464` — Hold'em recovery loses seat indices (rebuilds by array position since `holdem_hand_started` only records `{playerId, stack}`); harmless today since identity/reconnect/balances are all display-name-keyed. Related: `buttonSeatIndex` isn't restored by recovery at all (`table.ts:95` stays `null`), silently resetting the button after any crash.
- `'blackjack_seat_settled'` (`table.ts:397, 479`) — bare duplicated string literal, no shared const/union. Now more valuable to fix given I2/I3 also key on entry-type strings.
- Seats are never reaped — a disconnected player holds their seat and reserves their display name indefinitely; `onGraceWindowElapsed` only auto-acts, never vacates. Not required by spec, worth an explicit decision.
- `index.ts:24-28` — no error handling on the bootstrap promise (unhandled rejection → hard crash), no `httpServer.on('error')` (port-in-use → raw stack crash), no SIGTERM/SIGINT handling, no numeric env-var validation (`SMALL_BLIND=abc` → NaN → NaN balances silently written, then silently reset to default on next read).
- `socketServer.ts:21` — `cors: { origin: '*' }` combined with display-name-only identity means any web page the operator's browser visits can connect and join/act/trigger C3. Defensible for a local server but should be a recorded decision; binding to `127.0.0.1` costs nothing.
- `table.ts:562-565` — an uncontested winner's hole cards are revealed (poker convention is to muck). Faithfully implements the engine's own doc comment and Task 7's own test asserts it — a design-level wart, not an implementation deviation.
- `table.ts:530-541, 556-566` — `getStateForSeat` hands out live internal references (`round.playerHands`, `hand.communityCards`, `hand.pots`, `p.holeCards`). Safe today since every consumer serializes immediately, but `lastSettledBlackjackRounds` retains them past the hand.
- `table.ts:415` — `finishBlackjackHandIfComplete` doesn't check anything itself; the "IfComplete" condition lives in its caller's loop. Naming/structure nit.
- `table.ts:139-158` / `socketServer.ts:96-101` — `leave()` broadcasts before the caller deletes the socket mapping, so the leaving socket receives one state computed against its now-empty seat index. Harmless, ordering wart worth a comment.
- Carried cosmetics 22-31 all confirmed as described; see triage below.

---

### Carried-Forward Findings Triage

**A. Architectural**

| # | Verdict | Reasoning |
|---|---|---|
| 1 (no teardown API) | Follow-up, bundle with SIGTERM | Production restart kills the process, so orphaned timers die with it; cross-`Table` log write only reachable in-process. Real but not urgent — add `Table.dispose()` + SIGTERM together, which also removes item 31's test noise at its source. |
| 2 (seat-index fidelity) | Follow-up, with a caveat | Benign today — display name is the identity everywhere, a re-indexed seat still resumes correctly. Caveat: the log *cannot* carry seat indices today, so this is a persisted-format change — do it before anything else consumes the format. `buttonSeatIndex` not being restored at all is the more player-visible half, and wasn't mentioned by either prior reviewer. |
| 3 (gameMode cross-check) | **Should block** — escalated to Important (I4) | Rated Minor originally. Produces a restart-surviving permanent brick with clients seeing `handInProgress: true` and zero game data, and cross-process mode switching is the spec's sanctioned way to change games. |
| 4 (bare string literal) | Follow-up | Agree Minor, but value rose — I2/I3's fixes also key on entry-type strings, so one exported union now pays for itself. |

**B. The shared invariant — re-verified across the whole branch, and the stated version is already false**

The carried doc states: *"nothing nulls a seat outside `leave()`'s own synchronous mapping-delete block."* **Not true at HEAD.** `table.ts:508`, inside `recoverFromLog`'s catch block (added by Task 6's fix rounds, *after* the Task 8 reviews that certified the invariant), does `this.seats = new Array(this.config.seatCount).fill(null)` — a wholesale null of every seat from a completely different code path.

Items 5-7 nevertheless remain non-live, but for a different, more fragile reason than recorded. What actually holds is the weaker property: *no seat is nulled while any socket mapping exists.* Guaranteed solely by `createServer`'s ordering (`recoverFromLog()` completes before `io.on('connection')` is registered and before the caller ever calls `listen()`). Nothing in the code states this. A future refactor that reorders connection-handler registration or calls `recoverFromLog` lazily silently activates items 5, 6, **and** C3's blast radius at once, with no test failing.

| # | Verdict | Reasoning |
|---|---|---|
| 5 (disconnect handler no try/catch) | Follow-up | Add the try/catch anyway — three lines, and the invariant protecting it is demonstrably not what anyone thought it was. |
| 6 (previousSeatIndex-disconnect-throws) | Follow-up | Same — cheap insurance against a narrower recurrence of a Critical Task 8 already fixed once. |
| 7 (recoverFromLog catch doesn't clear Task-7 snapshot fields) | Follow-up, and the list is incomplete | The catch block also fails to reset `holdemSettled`, `timedOutSeats`, `disconnectTimers`, `buttonSeatIndex` — not just the two fields originally named. All unreachable for the same reason, but if fixing it, fix all six. |

**Recommended regardless:** document the real invariant as a comment on `createServer` — the ordering that makes three deferred items safe is entirely implicit right now.

**C. Money/durability**

| # | Verdict | Reasoning |
|---|---|---|
| 8 (live-play divergence, no error boundary) | **Should fix** — escalated (I6) | Has a concrete, table-killing instance: a rejected `setBalance` mid-`settleHoldem` leaves a permanent brick, same class as C1. |
| 9 (clear() outside writeQueue) | **Should block** — escalated (I2) | "No live race today" reasoning was incomplete — didn't consider the *next* hand's append racing the in-flight clear. Measured 4/200. One-line fix. |
| 10 (unrecognized entry type falls through silently) | **Should block** — escalated (I3) | Makes any transient stray entry permanent; composed with item 9, silently kills crash recovery for the file's lifetime. |
| 11 (rejected hand-start bricks table) | **Must block** — escalated to Critical (C1) | "Worth a separate ticket" was reasonable before settlement existed. At branch scope, with `integration.test.ts:117` proving 0 balance is a normal outcome, this is the single most important finding on the branch. |

**D. Code structure** — items 12-16: all acceptable follow-ups. `table.ts` at 579 lines with clear method-level cohesion isn't a merge blocker; splitting now would churn code that just stabilized. Notes: extract `recoverFromLog` helpers (12) *after* the I3/I4 fixes, not combined with them; `ControllablePlayerStore` duplication (15) confirmed at `table.test.ts:84`/`socketServer.test.ts:140` — the fixes above will want a third copy, reinforcing a shared test-helper module is the right call.

**E. Test coverage**

| # | Verdict | Reasoning |
|---|---|---|
| 17 (join concurrency stops at 2) | Follow-up | Agree — breadth, not a proof gap. |
| 18 (handLog ordering test misses duplicates) | Follow-up | Agree minor; the more valuable missing test is `clear()`-vs-`append()` ordering (add with I2's fix). |
| 19 (no hole-card integration coverage) | **Should fix** — escalated (I8) | Only security boundary on the branch, zero coverage at the layer that exposes it. |
| 20 (no non-contiguous-seating test) | Follow-up | Agree, pair with item 2 — same root gap. |

**F. Accepted design**

| # | Verdict | Reasoning |
|---|---|---|
| 21 (displayName as sole credential) | Accept as designed, with one composition worth recording | Correctly verified safe against stealing a *live* seat. Unstated composition: `cors: '*'` means the credential-free `join` is reachable from any web page the operator visits, not just a deliberately-run client. Not blocking for local-only, but bind to `127.0.0.1` and record the decision explicitly. |

**G. Cosmetics** — items 22-31: all acceptable follow-ups, all confirmed as described. Two remarks: item 27 ("handInProgress=true/holdemHand=null for one tick") understates its own case — that's exactly the state C1 makes *permanent*; fixing C1 removes the transient version too. Item 30's un-awaited `afterEach` close is the confirmed mechanism behind item 31's stderr noise across three files, and a `Table.dispose()` (item 1) would let tests close it properly instead of tolerating it.

---

### Recommendations

1. **Fix the three Criticals as one commit with one shared root cause.** C1, C2, C3 are all "an unaffordable or nonsensical stake reaches the engine." A single `eligibleSeatsForHand()`-style helper — connected, occupied, able to cover the stake — plus a try/catch that resets `handInProgress` on any hand-construction failure, closes all three.
2. **Make the durability path a unit.** I2 (queue `clear()`), I3 (`else` → clear), I4 (game-mode check), I5 (atomic `PlayerStore` write) are ~15 lines total and together turn "crash recovery works in the tested cases" into "crash recovery can't be silently disabled." Add the `clear()`-vs-`append()` ordering test alongside, in the style of the existing `invocationCallOrder` test.
3. **Write down the invariant that three deferred items depend on** — a comment on `createServer` stating why `recoverFromLog` must precede connection-handler registration.
4. **Meta-recommendation for process:** every Critical here came from standing the real classes up and driving boundary values through them, not from reading. Nineteen task-level review rounds read this code very carefully and none found C1, because C1 needs the *value* 0, which only becomes reachable once settlement (Task 4) and the all-in integration test (Task 9) both exist. A short "probe the composed system" pass — boundary values (0, negative, empty string, `__proto__`/`constructor`), adversarial payloads at any network boundary, repeated trials of any non-deterministic interleaving — should be a standing step of final reviews specifically, since task-level review can't see cross-task composition by construction.
5. **Re-derive carried-forward severity at integration, not by inheritance.** Four items here (3, 9, 10, 11) were correctly Minor/deferred at task scope and are genuinely blocking at branch scope, because other tasks made their triggers reachable. "It was Minor when found" carries no weight in final triage.
6. **Forward-looking for Plan 6:** document `PlayerStore.setBalance`'s read-modify-write as a caller-serialized contract, or change the interface to `adjustBalance(name, delta)`. DynamoDB's natural implementation is a conditional/atomic update; the current shape invites a lost-update bug the local implementation is accidentally protected from.

---

### Assessment

**Ready to merge?** **No — with fixes.**

**Reasoning:** The architecture is sound, the Global Constraints are honored exactly, the concurrency and write-ahead-durability work is genuinely well-built and well-tested, and the disclosed deviations compose cleanly — but three Criticals sit on paths reachable in ordinary play: a 0-chip player (a normal outcome the branch's own test asserts) permanently bricks the Hold'em table, Blackjack has no affordability check at all and drives balances unbounded negative, and an unvalidated display name lets any unauthenticated socket brick the table via a prototype-chain lookup. None of these are deep — the fixes are contained and mostly share one root cause — but each is a total loss of service or a money-integrity violation against the spec's own stated rules, and none is currently covered by a test.
