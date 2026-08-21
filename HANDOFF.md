# Handoff

A browser-based Poker (Texas Hold'em) + Blackjack app for a friend group, built via a
6-plan roadmap. Start here if you're new to this repo.

## Where things stand

| Plan | What | Status |
|---|---|---|
| 1 | Blackjack engine (`packages/game-engine`) | Done, merged to `master` |
| 2 | Hold'em engine (`packages/game-engine`) | Done, merged to `master` |
| 3 | Local real-time server (`packages/server`) | **Fix approved — pending PR/merge, see below** |
| 4 | Frontend | Not started |
| 5 | Accounts (Google OAuth) | Not started |
| 6 | AWS deployment (DynamoDB, EC2) | Not started |

**Branch `fix/plan3-critical-bugs`** (based on `master`) has all of Plan 3's code plus
the fix for the 3 Critical + 8 Important bugs a final whole-branch review found after
Plan 3 was merged with those bugs live (a deliberate, documented decision at the time,
to unblock a handoff). The fix went through two review-and-fix rounds — round 1
introduced 2 new Critical + 2 new Important bugs of its own, which round 2 closed — and
is now **Approved**: 0 Critical, 0 Important findings remain, 236/236 tests passing,
typecheck clean. The literal next thing to do is open the PR and merge it.

**Full detail, in `docs/superpowers/plans/`:**
- `2026-08-17-local-server-STATUS.md` — start here for Plan 3: what's done, the fix
  round's outcome, exact next steps, and what Plans 4-6 involve.
- `2026-08-17-local-server-fix-spec.md` — the fix specification that was applied
  (kept for historical reference; the applied code may differ slightly where the
  fix round's own re-review found and closed gaps in the original spec).
- `2026-08-17-local-server-final-review.md` — the original review that found the 3
  Critical + 8 Important bugs, including how each was empirically proven.
- `2026-08-17-local-server-carried-forward-findings.md` — 43 lower-priority items
  (31 from the original 10 tasks + 12 from the fix round), independently triaged,
  none merge-blocking.
- `2026-08-17-local-server-progress-ledger.md` — the complete build history: every
  task, every review round, every design decision, chronologically.

## Running things

```bash
npm install
npm test              # full monorepo test suite
npm run typecheck      # both workspaces
```

Per-workspace: `npm run test --workspace=@poker-blackjack/game-engine` /
`--workspace=@poker-blackjack/server`.

## How this was built

Each plan starts with a design spec (`docs/superpowers/specs/`) and an implementation
plan (`docs/superpowers/plans/`) written via Claude Code's `superpowers:brainstorming`
and `superpowers:writing-plans` skills, then executed task-by-task via
`superpowers:subagent-driven-development` — a fresh implementer subagent per task, a
task-scoped code review after each, and a broad whole-branch review (this is what found
Plan 3's 3 Critical bugs) before merging. If continuing this project with Claude Code,
that same process is the established pattern for Plans 4-6 — see any of the 3 completed
plans' progress ledgers for exactly how it played out in practice, including the
judgment calls (which review findings got fixed immediately vs. deferred, and why).

The original full-app vision (all 6 plans, architecture, security, cost controls) is in
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md`.
