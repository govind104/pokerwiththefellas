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

## Status: ALL 9 TASKS COMPLETE. Final whole-branch review not yet run.

Every task landed with either a clean review or one fix-and-re-review round;
no task needed more than one fix round. Every disclosed implementer
deviation from the brief's literal code was independently verified by a task
reviewer, not just trusted — including two genuine, correctly-diagnosed
architectural findings (Task 1's tsconfig contradiction, Task 9's
module-load-time env var timing) and one real flaky-test risk (Task 9's
unseeded RNG) that was fixed and then independently re-derived by the
reviewer from scratch, not just re-checked.

**NEXT STEP:** dispatch the final whole-branch code review (most capable
model available, e.g. opus) via `superpowers:requesting-code-review`'s
`code-reviewer.md` template. Generate the package first:

```bash
cd /path/to/PokerorBlackjack
git merge-base master feature/plan4-frontend   # should print b4fdce0
"$(claude plugin cache path)/superpowers-dev/superpowers/6.1.1/skills/subagent-driven-development/scripts/review-package" b4fdce0 HEAD
```

(Adjust the skill script path if the plugin cache version has changed.) Pass
the printed diff-package path, this ledger, the plan file, and the design
spec to the final reviewer as context. If the review comes back clean or
Minor-only, proceed to `superpowers:finishing-a-development-branch` — open a
PR `feature/plan4-frontend` → `master`. **Do NOT auto-merge** — this
project's established pattern (Plan 2/3) is to always ask before merging,
regardless of how clean the review comes back.

Known, separately-tracked, non-blocking items:
- `task_50961db9` (background task, already queued): `packages/server`
  cannot currently run as a standalone Node process — a pre-existing
  `pokersolver` CJS/ESM interop issue from Plans 1/2, not introduced by
  Plan 4. This blocks a real manual browser click-through of the finished
  frontend (Task 9's real-server *automated* integration tests are
  unaffected, since they run through Vitest's own module loader). The
  plan's own Final Verification section documents this explicitly — report
  it, don't silently treat the automated tests as sufficient for a full
  manual pass.
- The Minor findings listed per-task above, none merge-blocking, worth a
  triage pass during the final whole-branch review same as Plan 3's pattern.
