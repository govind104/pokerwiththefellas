# Handoff

A browser-based Poker (Texas Hold'em) + Blackjack app for a friend group, built via a
6-plan roadmap. Start here if you're new to this repo.

## Where things stand

| Plan | What | Status |
|---|---|---|
| 1 | Blackjack engine (`packages/game-engine`) | Done, merged to `master` |
| 2 | Hold'em engine (`packages/game-engine`) | Done, merged to `master` |
| 3 | Local real-time server (`packages/server`) | Done, merged to `master` |
| 4 | Frontend (`packages/frontend`) | Done, merged to `master` |
| 5 | Accounts (Google OAuth) | Not started |
| 6 | AWS deployment (DynamoDB, EC2) | Not started |

**Plan 3** is fully merged to `master` (PR #3, merge commit `b1dfae1`), including a
2-round critical-bug-fix pass. 0 Critical, 0 Important findings remain. Full detail in
`docs/superpowers/plans/2026-08-17-local-server-progress-ledger.md` and the other
`2026-08-17-local-server-*.md` files in the same directory (fix spec, final review,
carried-forward findings) — kept for historical reference.

**Plan 4** is fully merged to `master` (PR #4, merge commit `a7afc82`). Implemented via
`superpowers:subagent-driven-development` across 9 tasks, each passing a task-scoped
review clean or after one fix round. The **final whole-branch review** (opus) found
0 Critical / 4 Important cross-task composition defects invisible to any single
task's review (silently discarded in-game server errors, a mid-hand Leave button the
server would reject, a test-teardown leak, and missing action-path test coverage) —
all fixed, and the same reviewer's re-review came back "Ready to merge: Yes". That
review also surfaced a design-spec gap the plan itself never specified (hand results
/ bust/blackjack/win-lose-push status / bet amounts never rendered); a **Task 10**
closed it, task-scoped review clean. Full detail, every task's disclosed deviations,
and the complete final-review/fix/re-review trail:
`docs/superpowers/plans/2026-08-21-plan4-progress-ledger.md`.

A separate, pre-existing issue (not a Plan 4 defect, tracked since Plans 1/2) blocked
`packages/server` from ever running as a standalone Node process — fixed in
**PR #5** (merge commit `0d24f29`). It was actually two compounding bugs: the
server's bundler-style `moduleResolution` had no compatible runner outside Vite/Vitest
(fixed with `tsx` + `dev`/`start` scripts), and `import { Hand } from 'pokersolver'`
is a genuine CJS/ESM interop failure under native Node (pokersolver assigns exports
dynamically, so Node's `cjs-module-lexer` can't statically detect the named export —
fixed with a default-import-then-destructure workaround). Verified via a real
two-browser-tab manual click-through against the live server, not just tests. The app
is now testable locally end to end.

291/291 tests passing, typecheck clean across all 3 workspaces.

## Running things

```bash
npm install
npm test              # full monorepo test suite
npm run typecheck      # both workspaces
```

Per-workspace: `npm run test --workspace=@poker-blackjack/game-engine` /
`--workspace=@poker-blackjack/server`.

**To run the app locally:** start the backend (`npm run dev --workspace=@poker-blackjack/server`,
listens on port 3000 by default — see `packages/server/src/index.ts` for the
`GAME_MODE`/`PORT`/etc. env vars it reads), then in a second terminal start the
frontend (`npm run dev --workspace=@poker-blackjack/frontend`, Vite on port 5173,
defaults to talking to `http://localhost:3000` unless `VITE_SERVER_URL` is set).
Open multiple browser tabs/windows against `http://localhost:5173` to play as
different seats.

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
