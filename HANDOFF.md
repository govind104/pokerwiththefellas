# Handoff

A browser-based Poker (Texas Hold'em) + Blackjack app for a friend group, built via a
6-plan roadmap. Start here if you're new to this repo.

## Where things stand

| Plan | What | Status |
|---|---|---|
| 1 | Blackjack engine (`packages/game-engine`) | Done, merged to `master` |
| 2 | Hold'em engine (`packages/game-engine`) | Done, merged to `master` |
| 3 | Local real-time server (`packages/server`) | **Implemented, blocked on a fix — see below** |
| 4 | Frontend | Not started |
| 5 | Accounts (Google OAuth) | Not started |
| 6 | AWS deployment (DynamoDB, EC2) | Not started |

**Branch `local-server`** has all of Plan 3's code (10 tasks, 24 commits) and passes
199/199 tests — but a final whole-branch review found 3 Critical bugs (money-integrity
and service-availability issues, none caught by any earlier task-level review since
each only becomes reachable once the whole system is wired together). **A complete,
ready-to-implement fix already exists but has not been applied yet** — three attempts
to apply it all failed on transient Anthropic-side infrastructure errors before any
code was touched. This is the literal next thing to do before this branch can merge.

**Full detail, in `docs/superpowers/plans/`:**
- `2026-08-17-local-server-STATUS.md` — start here for Plan 3: what's done, what's
  blocking, exact next steps, and what Plans 4-6 involve.
- `2026-08-17-local-server-fix-spec.md` — the exact fix (code + tests) for the 3
  Critical + 8 Important bugs. Not yet applied.
- `2026-08-17-local-server-final-review.md` — the full review that found them, including
  how each was empirically proven.
- `2026-08-17-local-server-carried-forward-findings.md` — 31 additional lower-priority
  items surfaced across the plan, independently triaged, none merge-blocking.
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
