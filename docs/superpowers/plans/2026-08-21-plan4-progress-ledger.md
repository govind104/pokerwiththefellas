# Plan 4 (Frontend) — SDD Progress Ledger

Plan: `docs/superpowers/plans/2026-08-21-plan4-frontend.md`
Design spec: `docs/superpowers/specs/2026-08-21-plan4-frontend-design.md`
Branch: `feature/plan4-frontend` (off `master` @ `b4fdce0`)

This is a committed copy of the gitignored SDD scratch ledger
(`.superpowers/sdd/progress.md`), preserved here so it survives regardless of
local scratch-directory state and is visible to anyone cloning the repo. See
`STATUS.md` (same directory naming pattern as Plan 3) for the short version;
this file has the full task-by-task detail.

Pre-flight plan scan: clean, no conflicts found. Proceeded without comment per
the `subagent-driven-development` skill.

## Task 1: complete (commits `b4fdce0..4276632`, review clean after 1 fix round)

Disclosed deviations from brief, both independently verified correct by
reviewer: vite bumped `^5.4.10`→`^7.0.0` (vite@7.3.6 was already hoisted at
workspace root via server's vitest; declaring `^5.4.10` would nest a
conflicting second install — reviewer notes the implementer's stated reason
"vitest requires vite^7" was imprecise but the fix itself was correct);
tsconfig.json's `references` field dropped (brief's tsconfig.node.json
specified `noEmit: true`, which is incompatible with the `composite: true`
that project references require — a genuine contradiction in the brief's own
spec; typecheck script doesn't use `tsc -b` so nothing regresses. Reviewer
flagged as unverified-by-this-task whether a future `npm run build` using
`tsc -b` still works correctly — worth checking whenever a task first
exercises the build script).

1 Important finding (fixed, re-reviewed clean): `tsconfig.node.tsbuildinfo`
(generated cache file) got swept into the commit by `git add
packages/frontend`. Fixed via `git rm --cached` + `*.tsbuildinfo` added to
root `.gitignore`, commit `4276632`.

237/237 tests, typecheck clean across all 3 workspaces.

## Task 2: complete (commit `4276632..d58c246`, review clean, no fix round)

Disclosed out-of-brief change, verified by reviewer against real precedent:
`packages/frontend/tsconfig.json`'s `include` extended to `["src",
"../game-engine/src/**/*.d.ts"]`, mirroring an identical pre-existing pattern
in `packages/server/tsconfig.json` (reviewer read that file directly and
confirmed byte-identical). Needed because `SocketContext.tsx` is frontend's
first file touching server/game-engine types, transitively hitting the same
untyped-`pokersolver`-import problem server already worked around. Only
affects tsc's `.d.ts` visibility, not the bundle — doesn't compromise the
type-only server dependency constraint.

Stale-closure fix (`statusRef.current` pattern in `error`/`disconnect`
handlers) verified transcribed correctly, not simplified away.

243/243 tests (7 frontend), typecheck clean across all 3 workspaces.

## Task 3: complete (commit `d58c246..621f617`, review clean, no fix round)

52 card SVGs vendored from `Webisso/playing-cards` (MIT), real repo had 67
(52 standard + 13 alt-art `*2.svg` + 2 jokers), filtered down to exactly the
52 canonical files. Brief's assumed `<rank>_of_<suit>.svg` naming matched
reality exactly, no `RANK_FILE` adaptation needed. Reviewer full-diff-grepped
for `htdebeer`/`SVG-cards`/LGPL contamination: zero matches. One Minor noted
(not actioned): vendored SVGs' own embedded metadata traces to an older
"vector-playing-cards" project one hop before Webisso — not a license
problem, just a provenance-chain note for a future auditor.

247/247 tests, typecheck clean across all 3 workspaces.

## Task 4: complete (commit `621f617..fc03f11`, review clean, no fix round)

Verbatim transcription of brief, cross-checked by reviewer against real
`SocketContext` interface. 2 Minor notes (not actioned): missing explicit
`JSX.Element` return annotation (cosmetic, TS infers it fine); no
`aria-describedby` linking error text to input (`role="alert"` alone is
sufficient for AT announcement).

251/251 tests (15 frontend), typecheck clean across all 3 workspaces.

## Task 5: complete (commit `fc03f11..35862c0`, review clean, no fix round)

Critical architectural constraint (`GameTable` has zero runtime dependency on
`useSocket`/`SocketContext`/`HoldemView`/`BlackjackRoundView`) independently
verified by reviewer via direct import inspection, not just trusted.
Seat-ring polar positioning confirmed to generalize correctly (not
hard-coded to any seat count). 1 Minor noted (not actioned): angle calc
divides by `seats.length`, would `NaN` on an empty seats array — not
currently reachable/tested, flagged as a non-goal note for later tasks.

257/257 tests, typecheck clean across all 3 workspaces.

## Task 6: complete (commit `35862c0..4bfa77d`, review clean, no fix round)

Disclosed brief inconsistency, verified by reviewer: brief's own Step 2 test
passes JSX children to `<PokerTable>`, but brief's own Step 4
`PokerTableProps` interface doesn't declare `children` — passed under
Vitest but failed `tsc --noEmit`. Fixed by adding optional unused
`children?: ReactNode` to the interface. Implementer logged this as
skill-observations Observation #17.

Hold'em/Blackjack turn-tracking asymmetry verified correct: `PokerTable`
derives `activeSeatIndex` from `holdem.actingPlayerId`→`seats` lookup
(matches server's own `table.ts:408-409` pattern), never reads a Hold'em-side
`activeSeatIndex` (`HoldemView` has none) or `TableStateView.activeSeatIndex`
(not even in `PokerTableProps`).

1 Minor carried to final review (not actioned): the added `children?:
ReactNode` is genuinely dead/unused and mildly misleading (`PokerTable`
builds its own JSX and forwards *that* to `GameTable`'s children slot,
ignoring its own `children` prop entirely). Reviewer's suggested cleaner fix:
edit the test's 6 call sites to drop `{null}` instead of widening the
production interface. Worth a follow-up cleanup.

262/262 tests (26 frontend), typecheck clean across all 3 workspaces.

## Task 7: complete (commit `4bfa77d..628456a`, review clean, no fix round)

Implementer proactively avoided Task 6's `children`-prop pitfall (rewrote
test JSX as self-closing tags instead of passing `{null}` children) —
reviewer verified this is a behavior-preserving no-op, no assertions lost,
`BlackjackTableProps` correctly has no `children` field. Cleaner resolution
than Task 6's, noted as a positive pattern.

Hold'em/Blackjack asymmetry verified correct the other direction from Task
6: `activeSeatIndex` taken as a direct prop with zero derivation logic
(server populates it natively for Blackjack).

1 pre-existing (not implementer-introduced) design note carried to final
review, not actioned: `dealerRound = Object.values(blackjackRounds)[0]`
picks an arbitrary first entry, assumes all seats share one dealer state —
copied verbatim from brief, may need revisiting for true multi-seat
concurrent play.

267/267 tests, typecheck clean across all 3 workspaces.

## Task 8: complete (commit `628456a..396a324`, review clean, no fix round, zero findings)

Disclosed test-only deviation, verified: brief's raw
`input.value`+`dispatchEvent('input')` sequence is a no-op under React's
controlled-input tracking, swapped for `userEvent.type`/`click` matching
`JoinScreen.test.tsx`'s existing pattern — no production code changed.

`useSocket()` single-caller constraint independently verified via grep: only
`App.tsx` and `JoinScreen.tsx` call it (`JoinScreen` legitimately, by
original Task 4 design — reads directly from context, no props), nothing
else.

`mySeatIndex` derivation and `gameMode` branch (`PokerTable` for `holdem`,
`BlackjackTable` otherwise) verified exact match to brief. Reconnecting
status intentionally omitted from `JoinScreen` fallback — confirmed correct
existing design (`GameTable` shows its own reconnecting banner over
last-known state), not a gap.

App test verified to genuinely exercise real join→state→render flow end to
end through mocked socket, not stubbed pieces.

Full suite/typecheck clean (32/32 frontend tests per implementer report).

## Task 9: complete (commits `396a324..b6a7777`, review clean after 1 fix round)

**LAST TASK OF PLAN.** Real `socket.io-client` + real `packages/server`
instance, no mocking, mirrors `packages/server/src/integration.test.ts`'s
setup pattern (verified by reviewer against that file directly).

Genuine architectural finding, correctly diagnosed and test-scoped (`App.tsx`
left untouched, correct as-is): `App.tsx` reads
`import.meta.env.VITE_SERVER_URL` into a module-level const evaluated once
at import time (correct for production, where Vite statically replaces it at
build time) — incompatible with a test needing a dynamically-assigned
per-test port. Fixed via dynamic `await import('../App')` after setting the
env var in `beforeEach`; reviewer independently confirmed this is safe under
Vitest's default module isolation (not a stale-cache risk). Also:
`.ts`→`.tsx` rename (JSX), explicit `cleanup()` before `httpServer.close()`
in `afterEach` (necessary, not cosmetic — socket must disconnect before
server close resolves).

1 Important finding (fixed, re-reviewed clean): unseeded `Math.random()` in
the Blackjack test risked ~1-in-20 flakiness from natural-blackjack
auto-settle (`packages/game-engine/src/blackjackRound.ts`) changing
`dealer-hand`'s rendered card count — same failure mode
`packages/server/src/integration.test.ts` already guards against with a
seeded RNG. Fixed with `makeDeterministicRandom(2)` (reimplemented locally,
byte-identical LCG to the reference file). Both implementer AND reviewer
independently wrote standalone replay scripts of `Table.startHand`'s exact
shuffle/deal sequence and got the SAME result (alice 14, bob 19, neither
natural) — this is about as rigorously verified as a test fixture choice
gets.

1 Minor carried to final review (not actioned): `poker.integration.test.tsx`
and `blackjack.integration.test.tsx` duplicate ~70 lines of
`beforeEach`/`afterEach` setup verbatim — a shared fixture helper would
reduce drift risk, but both files independently reflect the brief's own
literal duplicated code.

Full suite: frontend 34/34, game-engine 115/115, server 121/121 = **270/270**.
typecheck clean across all 3 workspaces.

## Final whole-branch review: complete (commits `a12dfbe..9905cec`)

Dispatched on opus per plan. Both architectural invariants (`GameTable`
purity, Hold'em/Blackjack `activeSeatIndex` asymmetry) independently
re-verified intact end-to-end, not just re-trusted from task reviews. All 5
carried-forward Minor findings triaged individually (2 fixed, 3 deferred with
reasoning). The reviewer also ran `npm run build` for the first time in the
whole plan (no task ever had), closing a gap Task 1 had explicitly flagged as
unverified — it succeeds.

0 Critical. 4 Important, all genuine cross-task composition defects invisible
to any single task's isolated review:
1. `errorMessage` was produced by `SocketContext` and consumed by
   `JoinScreen` only — every at-table server rejection (illegal action, etc.)
   was silently discarded, and action controls did zero legality filtering,
   so a rejected click looked like a frozen app.
2. `GameTable`'s Leave button was unconditionally visible; the server throws
   on a mid-hand leave. `SocketContext.leave()` was fully optimistic
   (disconnects, clears `sessionStorage`, resets state) before any server
   response, so a mid-hand click destroyed the session-resume path while the
   server never actually processed the leave.
3. Integration tests' `bobSocket` leaked on any assertion failure (only
   disconnected on the happy path), risking a hung `afterEach`.
4. Zero end-to-end coverage existed for `sendAction`'s wire payload or
   `leave` — the exact protocol surface the integration suite's own stated
   purpose (§4 of the design spec) is to catch mismatches on.

Plus one plan-level (not implementation) gap: neither table ever renders
hand results, per-hand bust/blackjack/stand status, or bet amounts — design
spec §3.2 asked for these but no task's brief ever specified them. **User
decision: add a Task 10 to close this before merge** (see below), rather
than deferring as a follow-up.

**Fix round (commits `a07d803`, `aea8c38`, sonnet):** all 4 Important + 2 of
the 5 Minor triage items (dead `children` prop, `aria-describedby`) + 3 new
cheap Minors found alongside (raiseAmount hygiene, `App.tsx` null-guard,
`leavingRef` ordering guard) fixed in one bundled dispatch, not one fixer per
finding. Notably surfaced and fixed two dormant test-infrastructure bugs
invisible with only one test per file (Vitest module-cache staleness needing
`vi.resetModules()`; jsdom's shared `sessionStorage` needing an explicit
`.clear()`) — found only because Finding 4's new tests pushed
`poker.integration.test.tsx` from 1 test to 3.

**Re-review (same reviewer agent, resumed via SendMessage, not
fresh-dispatched):** all 4 Important findings confirmed genuinely closed at
the root-cause level — re-verified against `packages/server` source, not the
fix report's narrative (e.g. confirmed the new clear-on-state rule for
`errorMessage` cannot wipe a banner it just raised, by reading
`table.ts`'s throw-before-broadcast ordering). 1 new Minor found: the fix
round's own test-fixture consolidation introduced a latent RNG-sharing trap
(blackjack integration config's seeded `random` closure was hoisted to
module scope, so multiple tests in that file would share one generator's
state instead of each getting a fresh seed-2 generator) — ironic given the
same fix round had just correctly fixed two other instances of this exact
shared-state class. **Verdict: Ready to merge — Yes**, with this one Minor
recommended-but-not-blocking.

**Trivial one-line fix applied directly (commit `9905cec`, no subagent
needed):** `setupIntegrationServer` now takes a config factory invoked fresh
in each `beforeEach` instead of a module-scoped `TableConfig`, closing the
RNG-sharing trap. 49/49 frontend tests, typecheck clean, re-verified
directly rather than via another review round (mechanical, matched the
reviewer's exact prescribed fix).

Full suite after all of the above: frontend 49/49 (up from 34 — Finding 4's 2
new tests + this fix round's various test additions), game-engine 115/115,
server 121/121.

## Task 10: complete (commit `e9c135c..bdeb136`, task-scoped review clean, no fix round)

Added showdown results to `PokerTable` (`holdem.results`, keyed by
`playerId` rather than array index — a better choice than index correlation
given `HoldemResult` already carries its own `playerId`) and bet
amounts + settlement-outcome badges to `BlackjackTable`
(`results[i]` ↔ `playerHands[i]`, verified structurally guaranteed by
reading `blackjackRound.ts`'s own `this.results = this.playerHands.map(...)`
construction, not just assumed).

The `Outcome`-has-no-`'stand'` judgment call (design spec's literal wording
is "bust/blackjack/stand indicators", but the type is `'blackjack' | 'win' |
'push' | 'lose' | 'bust'`) was independently re-verified by the task
reviewer against `payout.ts` and `blackjackRound.ts` rather than accepted
from the implementer's report — confirmed no dedicated "stood" signal
exists in the data model (`PlayerHand.done` is shared by stand/bust/double/
split-derived-natural, not stand-specific), so satisfying the spec's intent
via the settled outcome badge (rather than fabricating a signal that isn't
there) is the correct call, not a shortcut.

New fixtures (`makeHoldemSettledState`, `makeBlackjackSettledState`) with
genuine positive AND negative test coverage (`queryByTestId(...).not.toBe
InTheDocument()` proving results/badges don't render pre-settlement, not
just asserted). Both integration test files confirmed byte-for-byte
unmodified via `git diff --stat` and still passing. 2 Minor, cosmetic-only,
not actioned: "split even" wording for a `payout === 0` case is slightly
presumptuous (a fold-then-break-even reads as a literal split, which it may
not be — "even"/"tied" would be more neutral); one negative test's name
implies it covers the `results` half of a compound guard but actually
re-exercises the same `street` half as another test.

Full suite: frontend 55/55 (was 49), game-engine 115/115, server 121/121 =
**291/291**. typecheck clean across all 3 workspaces.

Explicitly deferred, not part of Task 10's scope (flagged by the whole-branch
reviewer, not bundled in without separate sign-off): `PokerTable`'s raise
control is a bare number input; design spec §3.2 asked for "a slider plus
preset amount buttons." Worth a follow-up.

## Status: ALL WORK COMPLETE (9 plan tasks + final whole-branch review +
fix/re-review + Task 10 + Task 10's own clean review). Ready for
`superpowers:finishing-a-development-branch` — open PR
`feature/plan4-frontend` → `master`, do not auto-merge.

Known, separately-tracked, non-blocking items:
- `task_50961db9` (background task, already queued): `packages/server`
  cannot currently run as a standalone Node process — a pre-existing
  `pokersolver` CJS/ESM interop issue from Plans 1/2, not introduced by
  Plan 4. This blocks a real manual browser click-through of the finished
  frontend (all automated tests, including Task 9's real-server integration
  tests, are unaffected — they run through Vitest's own module loader). The
  final reviewer flagged this again independently: the new error banner and
  the disappearing Leave button are both visual behaviors currently proven
  only by DOM assertions, never seen rendered. Report this, don't silently
  treat the automated tests as sufficient for a full manual pass.
- 3 of the original 5 carried-forward Minor findings, deferred with
  reasoning during the final review (SVG metadata provenance note, seat-ring
  `NaN` on an unreachable empty-seats case, `dealerRound` "arbitrary" seat
  pick — actually deterministic, ledger note only needed correcting).
- New Minors found during the final review + re-review, not yet actioned:
  raise input's `min`/`step`/`max` don't stop a 0-amount submit (button
  isn't disabled, no `<form>` validation runs — now merely ugly rather than
  invisible, thanks to the error banner fix); Leave button is hidden rather
  than disabled mid-hand (no explanation shown to the user); error banner
  has no minimum display time (a fast-arriving next `state` event can wipe
  it before it's read).
