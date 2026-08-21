# Handoff

A browser-based Poker (Texas Hold'em) + Blackjack app for a friend group, built via a
6-plan roadmap. Start here if you're new to this repo.

## Where things stand

| Plan | What | Status |
|---|---|---|
| 1 | Blackjack engine (`packages/game-engine`) | Done, merged to `master` |
| 2 | Hold'em engine (`packages/game-engine`) | Done, merged to `master` |
| 3 | Local real-time server (`packages/server`) | Done, merged to `master` |
| 4 | Frontend (`packages/frontend`) | **All 9 tasks implemented — final whole-branch review pending, see below** |
| 5 | Accounts (Google OAuth) | Not started |
| 6 | AWS deployment (DynamoDB, EC2) | Not started |

**Plan 3** is fully merged to `master` (PR #3, merge commit `b1dfae1`), including a
2-round critical-bug-fix pass. 0 Critical, 0 Important findings remain. Full detail in
`docs/superpowers/plans/2026-08-17-local-server-progress-ledger.md` and the other
`2026-08-17-local-server-*.md` files in the same directory (fix spec, final review,
carried-forward findings) — kept for historical reference.

**Plan 4** has an approved design spec
(`docs/superpowers/specs/2026-08-21-plan4-frontend-design.md`) and a fully-specified
9-task implementation plan (`docs/superpowers/plans/2026-08-21-plan4-frontend.md`),
both committed to `master`. **Branch `feature/plan4-frontend`** (based on `master` @
`b4fdce0`) has all 9 tasks implemented via `superpowers:subagent-driven-development` —
every task passed a task-scoped review, either clean or after exactly one
fix-and-re-review round (never more). 270/270 tests passing, typecheck clean across
all 3 workspaces. **The final whole-branch review has not been run yet** — that's the
literal next step. Full detail, including every task's disclosed implementer
deviations and how each was independently verified, in
`docs/superpowers/plans/2026-08-21-plan4-progress-ledger.md` — read that file's
"Status" section at the bottom for the exact resume command.

Known non-blocking issue, tracked separately (not a Plan 4 defect): `packages/server`
has never been run as a standalone Node process — a pre-existing `pokersolver`
CJS/ESM interop issue from Plans 1/2 blocks that specific path (automated tests are
unaffected, since they run through Vitest's own module loader). This blocks a real
manual browser click-through of the finished Plan 4 frontend until fixed.

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
