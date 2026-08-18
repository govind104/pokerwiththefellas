# Plan 3 (local-server) — Consolidated carried-forward findings

Every Minor finding and explicitly-deferred item from all 10 tasks' reviews, compiled
from `.superpowers/sdd/progress.md` for the final whole-branch review to triage. Nothing
in this list blocked its originating task — each was judged Minor or explicitly deferred
with reasoning at the time. Grouped by theme, not chronology. Task reviewers' own
severity language is preserved; the final review should form its own independent
verdict on what's must-fix-before-merge vs. acceptable follow-up.

---

## A. Architectural / production-readiness (highest signal — give these real attention)

1. **`Table` has no teardown/dispose API.** `clearTimeout` only exists inside `leave()`,
   `disconnect()`, and `reconnect()` — nothing external can cancel a `Table` instance's
   pending `disconnectTimers`. Surfaced concretely by Task 10: an abandoned pre-crash
   `Table`'s grace timer can still fire and write to a hand-log path a *successor*
   `Table` is actively reading/using after a restart. `index.ts` currently has no
   SIGTERM/SIGINT handling at all, so this isn't purely theoretical — a real graceful
   restart today has no way to quiesce the old `Table` first. (Task 10 review)

2. **Hold'em recovery and Blackjack recovery disagree on seat-index fidelity.**
   `recoverFromLog`'s Hold'em branch rebuilds seats by *array position*
   (`this.seats[i] = ...`, keyed on the `players` array's index), while the Blackjack
   branch preserves the original `r.seatIndex` explicitly. Works fine for contiguous
   seats (e.g. 0 and 1, all this plan's tests use) but would diverge for non-contiguous
   seating (e.g. originally seats 0 and 3). Flagged independently by two different
   reviewers (Task 6 and Task 10) from two different angles — worth resolving, not just
   re-deferring a third time. (Task 6 + Task 10 reviews)

3. **`recoverFromLog` doesn't cross-check the log's entry type against
   `this.config.gameMode`.** A restart with a reconfigured game mode (e.g. server
   redeployed with `GAME_MODE=blackjack` env var changed) would attempt to misreplay a
   Hold'em log against a Blackjack-configured table or vice versa. (Task 6 review)

4. **`'blackjack_seat_settled'` is a bare string literal**, duplicated across the
   writer, reader, and tests with no shared `const` or `HandLogEntry['type']` union — a
   typo in any one location would silently disable the settlement-idempotence guard
   with no compiler signal. (Task 6 review)

## B. Latent invariant-dependent items (share one root cause, nil reachability today)

All of the following depend on the same currently-true invariant: *nothing nulls a seat
outside `leave()`'s own synchronous mapping-delete block.* Two independent opus reviews
(Task 8 rounds 1 and 2) confirmed this invariant holds today and each of these is
therefore not a live bug — but all three would go live simultaneously the moment any
future change (e.g. a seat-reaping feature on grace-window expiry, or the teardown API
in item A1 above) nulls a seat from a different code path.

5. `socketServer.ts`'s `disconnect` handler has no try/catch around `table.disconnect()`,
   which can throw `"Seat is empty"` if the seat is already null. (Task 8 round 1 Minor 3)
6. In the join handler's stale-seat cleanup, `table.disconnect(previousSeatIndex)` could
   itself throw under the same condition; if it did, the *new* seat (already created by
   `table.join()`) would end up unregistered in `seatBySocketId` — a narrower recurrence
   of the same orphan-seat class Task 8's Critical fix closed. (Task 8 round 2, both the
   implementer's self-flag and the controller's/reviewer's independent tracing)
7. `recoverFromLog`'s catch-block reset (the corrupted-log recovery path) resets
   `seats`/`handInProgress`/`holdemHand`/`blackjackRounds`/`blackjackSettledSeats`/
   `activeSeatIndex` to fresh defaults but does NOT clear the two Task-7 snapshot fields
   (`lastSettledHoldemHand`/`lastSettledBlackjackRounds`) the way `startHand`'s parallel
   reset does. Only reachable if `recoverFromLog` ever runs on a non-fresh `Table`
   instance, which the Task 6 hard requirement (called exactly once at startup, before
   any hand is played) already forbids today. (Task 7 review)

**If item A1 (a teardown API) is added, re-examine items 5-7 above — they may become
live at that point rather than staying deferred.**

## C. Other money/durability-adjacent deferred items

8. **Live-play (not recovery) divergence**: if `handLog.append` rejects but the process
   survives, in-memory state (`blackjackSettledSeats`, seat balances) can briefly run
   ahead of what's actually persisted to disk. Self-correcting on the seat's next
   `setBalance` call; no error boundary exists on live-play paths generally (same
   deferred class as Task 5's disclosed I1: no error boundary on the fire-and-forget
   auto-act timer chain). (Task 5 + Task 6 reviews)
9. **`JsonlHandLog.clear()` doesn't participate in the write-serialization queue** added
   in Task 8's fix (`append()` does, `clear()` still calls `writeFile` directly). No live
   race today — every reachable `clear()` call site runs only after its own settling
   call's `append()` has already resolved — but it's an asymmetry worth recording as an
   explicit invariant given Tasks 9-10 build crash-recovery correctness on this file.
   (Task 8 round 2 review)
10. **An unrecognized first log-entry `type`** (well-formed JSON, but neither
    `holdem_hand_started` nor `blackjack_hand_started`) falls through both
    `recoverFromLog` branches silently without clearing the log — doesn't throw, so the
    corrupted-log catch/reset added in Task 6 doesn't cover this specific sub-case.
    (Task 6 review)
11. **A rejected hand-start** (e.g. `HoldemHand`'s constructor throwing on a player with
    `stack <= 0`, a normal/expected outcome, not a bug) permanently bricks the table,
    since `handInProgress` is never reset on failure. Reviewer explicitly called this
    "worth a separate ticket," not blocking. (Task 5 review)

## D. Code structure / maintainability

12. `recoverFromLog` is a long method (79+ lines) with two inline game-specific
    branches — extracting per-game helpers plus a shared seat-construction helper was
    suggested twice across Task 6's three review rounds. (Task 6 review)
13. `table.ts` is now ~580 lines / many methods. Every reviewer across every task that
    touched it has called it "still cohesive" at the time, but it has grown across
    Tasks 3-10 continuously — worth a fresh look now that it's done growing.
14. Duplicated between-hands reset logic in `settleHoldem` vs
    `finishBlackjackHandIfComplete` — present since Task 4, verbatim brief code both
    times, never consolidated. (Task 4 review)
15. `ControllablePlayerStore` (the test double proving the Task 8 join()-race fix) is
    now duplicated verbatim between `table.test.ts` and `socketServer.test.ts` — a third
    copy would be the real pain point. (Task 8 round 2 review)
16. `startHand` may be worth splitting into per-game helpers now that Tasks 4-7 have
    added substantial per-game branching to the same function. (Task 3 review)

## E. Test coverage gaps (not proof gaps — the properties that ARE tested are genuinely proven)

17. `Table.join()`'s concurrency regression tests (Task 8) stop at 2 concurrent callers
    — capacity-boundary-under-concurrency (e.g. 3 concurrent joins with `seatCount: 2`)
    is untested. Breadth, not a correctness gap in what's already proven.
18. `handLog.test.ts`'s new ordering test (Task 8 fix round) checks that each trial's
    'a' entry precedes its 'b' entry, which would catch a dropped write but not a
    *duplicated* one (uses `findIndex`, which finds the first match either way).
19. **No integration-level test anywhere in the suite exercises Task 7's per-seat
    targeted state emit or hole-card filtering.** Every `waitForState`/`waitForEvent` in
    both `integration.test.ts` and `integration-resilience.test.ts` happens to resolve
    on a broadcast (`getStateForSeat(null)`, spectator-equivalent) emission rather than
    the join handler's own per-seat targeted emit, and every assertion used is
    viewer-independent — valid for what each test asserts, but it means the actual
    hole-card access-control boundary (the whole point of Task 7) has zero
    integration-level coverage, only Task 7's own unit tests. (Task 10 review)
20. No non-contiguous-seating test exists for the button-index translation logic.
    (Task 3 review)

## F. Accepted-design items, surfaced once for final-review awareness (not defects)

21. **`displayName` is the sole reconnect credential.** Any socket that knows a
    disconnected player's display name can reconnect as them (balance, hole cards, act
    rights included). This is the plan's own accepted design (no auth system exists),
    verified safe against *stealing an active seat* (a live player's seat cannot be
    taken), but Task 8 is what first makes it reachable over the wire rather than only
    in-process. Not a defect — surfaced so the final review makes an informed call
    rather than an implicit one. (Task 8 round 1 review)

## G. Cosmetic / documentation only (no behavior implication)

22. `package-lock.json` committed alongside Task 1's commit — expected/correct
    (`npm install` for the new workspace member updates it), just a literal deviation
    from Task 1's brief's Step-6 file list.
23. `task-2-report.md` has a cosmetic line-count discrepancy (84 vs actual 68) — report
    text only, not a code defect.
24. An unused `beforeEach` import in an early test file (Task 3).
25. `makeDeterministicRandom`'s doc comment in `table.test.ts` is stale in one spot —
    still describes the `Math.random`-override pattern a Task 3 fix removed.
26. One Task 5 test's inline comment describes a technically-wrong mechanism; the
    assertion itself is still valid (arguably stronger than the comment claims).
27. `disconnect()`/`leave()` can return with `handInProgress=true` and `holdemHand=null`
    for one synchronous tick — only observable if a caller reads state synchronously in
    that exact tick. (Task 5 review, flagged for Task 8's then-future awareness)
28. `integration.test.ts`'s seed-safety comment (Task 9) only documents the alice-side
    natural-blackjack risk seed 2 protects against, not the symmetric bob-side risk it
    also happens to protect against — a future maintainer re-deriving "why is seed 2
    safe" from the comment alone would only see half the justification.
29. Task 10's second test is titled "...the hand continues" but an auto-fold heads-up
    necessarily *ends* the hand — the brief's own wording, not an implementer deviation.
30. Minor test-hygiene items in `integration-resilience.test.ts` (Task 10 review): its
    `afterEach` doesn't await server close before removing the temp dir (confirmed as
    the actual mechanism behind this suite's known-benign stderr noise class);
    `stopServer()`'s second close stage (`httpServer.close()`) is redundant since
    `io.close()` already closes the attached httpServer in socket.io v4; `afterEach`
    would throw on `server` being `undefined` if `startServer` ever failed first
    (unreachable today).
31. Grace-window-timer-outliving-test-cleanup stderr noise appears in several test
    files across Tasks 8-10 (`socketServer.test.ts`, `integration.test.ts`,
    `integration-resilience.test.ts`) — traced multiple times, consistently harmless,
    never the cause of a flake, never touched production code.
