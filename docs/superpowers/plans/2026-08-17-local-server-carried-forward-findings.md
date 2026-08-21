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

3. ~~**`recoverFromLog` doesn't cross-check the log's entry type against
   `this.config.gameMode`.**~~ **RESOLVED** by the 2026-08-21 fix round's Group 2c
   (`table.ts`'s `recoverFromLog` now cross-checks `this.config.gameMode` on both
   branches and clears+warns on any unrecognized-or-mismatched entry). See section H.

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
9. ~~**`JsonlHandLog.clear()` doesn't participate in the write-serialization queue**~~
   **RESOLVED** by the 2026-08-21 fix round's Group 2a (`clear()` now routes through the
   same synchronous `writeQueue` chain as `append()`). See section H.
10. ~~**An unrecognized first log-entry `type`**~~ **RESOLVED** by the same Group 2c fix
    as item 3 above (the new `else` branch warns and clears on any unrecognized entry).
11. ~~**A rejected hand-start** ... permanently bricks the table~~ **RESOLVED** — this
    was Critical C1 in the 2026-08-17 final whole-branch review, closed by the
    2026-08-21 fix round's Group 1 (`eligibleSeatsForHand()` plus `startHand`'s
    try/catch safety net). See section H.

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
19. ~~**No integration-level test anywhere in the suite exercises Task 7's per-seat
    targeted state emit or hole-card filtering.**~~ **RESOLVED** by the 2026-08-21 fix
    round's Group 4 (new assertions in `integration.test.ts` proving each player's own
    `holeCards` are populated and their opponent's are `null`, over the real socket
    wire). See section H.
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

## H. 2026-08-21 fix round — outcome and new findings

The 3 Critical + 8 Important bugs from the 2026-08-17 final whole-branch review were
fixed on branch `fix/plan3-critical-bugs` (base `master`/`3f8e7f2`), in two rounds, each
independently re-reviewed opus-tier:

- **Round 1** (commits `e1de4d1`..`2cfc2f1`, 5 commits, one per fix group): implemented
  the fix spec's 5 groups. Re-review found the transcription itself was faithful (both
  hard invariants — write-ahead marker ordering, synchronous `writeQueue`
  reassignment — verified intact, `recoverFromLog`'s branch bodies byte-identical) but
  surfaced **2 new Critical + 2 new Important bugs that the fix itself introduced or
  left open**, all empirically reproduced against the round-1 code.
- **Round 2** (commits `f973cae`, `784d8a6`, `10cdc49`): fixed all 4. Re-review verified
  each closed by reproducing it against extracted round-1 source and confirming it no
  longer reproduces on round-2 (concrete before/after counts in
  `.superpowers/sdd/progress.md`). **Approved** — 0 Critical, 0 Important remaining.

**Reconciliation, important for anyone reading the review history:** round-1's "2 new
Criticals" were reported as `blackjackSettledSeats` leaking on a hand-start failure
(silent skipped payout on a later hand) and unbounded negative Blackjack balances via
double/split. The implementer's round-2 report raised a good-faith doubt that the first
one was ever independently live. The round-2 reviewer adjudicated this directly (see
`.superpowers/sdd/progress.md` for the full trace) and found: **it was one Critical, not
two** — an uncaught throw escaping `settleBlackjackSeatIfNeeded` inside
`advancePastSettledBlackjackRounds`, which bricked the table when reached via
`submitAction` (the "Important 3" framing) and silently skipped a later hand's payout
when reached via `startHand` (the "Critical 1" framing). Both symptoms shared one root
cause and one fix (catching at the `advancePastSettledBlackjackRounds` loop level,
`table.ts:539-546`). Record this as one Critical closed, not two.

**New Minor findings from the two re-reviews** (none merge-blocking, none fixed except
where noted — carried forward for future attention):

32. `BlackjackRound`'s new server-side affordability check (`assertCanAffordBlackjackAction`,
    `table.ts:428-453`) derives the active hand via `playerHands.find(h => !h.done)`
    since `activeHandIndex` is private on the engine class. Verified correct as
    implemented (round-2 reviewer traced the monotonicity proof), but it's an unpinned
    cross-module assumption — a public `activeHandIndex` or `exposure` getter on
    `BlackjackRound` would remove the coupling and let an engine refactor fail loudly
    instead of silently guarding the wrong hand.
33. The new `.corrupt-${Date.now()}` rename in `playerStore.ts` shares the same
    theoretical filename-collision shape as the pre-existing `.tmp` Minor (item 34
    below) — lower risk (needs two corruption events in the same millisecond vs. two
    concurrent writes) but the same fix (a unique-suffix helper) would close both.
34. `writeAll`'s fixed `.tmp` filename converts concurrent `setBalance` calls'
    previously-benign last-writer-wins into a hard `ENOENT` rejection on the loser's
    `rename`. Latent — `Table` serializes every `setBalance` call site today.
35. A conditional test assertion (`table.test.ts:247-249`, guarding a compounding-bet
    assertion behind `activeSeatIndex === 0 && phase === 'playing'`) could silently
    degrade to a no-op under a seed or engine change. It is genuinely exercised today
    (verified), but should assert the precondition directly rather than branch on it.
36. A stale comment in `playerStore.test.ts`'s corrupted-file test still describes a
    spy-timing mechanism (`setBalance` reading the still-corrupted file) that the
    2026-08-21 fix made untrue (the file is now renamed aside on the first read, so
    `setBalance` sees ENOENT). Comment-only, no behavior implication.
37. `recoverFromLog`'s replay path (`table.ts:616`) calls `round.act()` directly,
    bypassing the new affordability check — correct by design (replay reproduces
    already-validated history), but a hand log written by pre-2026-08-21 code
    containing an unaffordable double would replay into a negative balance on recovery.
    Migration-only edge; worth one sentence in the code comment.
38. `reconnect()`'s new fire-and-forget `startHandIfEveryoneReady()` call (Group 1b)
    creates a new async edge at the socket join-handler seam. Verified safe as
    implemented (no `await` exists between seat-mapping registration and the emit that
    would need it), but worth a two-line comment at the call site rather than relying
    on the ordering being re-derived correctly by a future reader.
39. `startHand`'s failure-path catch (Group 1c) doesn't restore `buttonSeatIndex`, so a
    failed hand start burns a button rotation. Cosmetic.
40. `settleHoldem`'s trailing `handLog.clear()` (after its `finally` block) is still
    skippable if `hand.results` itself throws — the stale `holdem_hand_started` entry
    then survives on disk, mode-appropriate so Group 2c's cross-check doesn't rescue it,
    and a later `recoverFromLog` replays the wrong (already-settled) hand before
    discarding the real one. Same failure family as the now-resolved item 10, narrower
    trigger (an engine getter throwing).
41. `handLog.ts`'s torn-trailing-line tolerance (Group 2b) never repairs the file on
    disk — if the torn line was the *only* line, `readAll` returns `[]` and
    `recoverFromLog` sees zero entries without clearing, so the garbage line persists
    and poisons the next hand's recovery the same way item 10 (now resolved) did for a
    different reason.
42. `isValidDisplayName` (Group 3) trims to test emptiness but seats the untrimmed
    value, so `"alice"` and `"  alice"` are distinct player identities. Free fix:
    normalize (`.trim()`) before passing to `Table`.
43. No type validation on parsed balance values in `playerStore.ts` — a hand-edited
    `balances.json` containing `{"alice": "500"}` (a string, not a number) still returns
    a non-number from `getBalance` today. Same bug *class* as the now-resolved
    prototype-pollution Critical, reached via the file rather than the prototype chain
    (not socket-reachable, hence Minor).
