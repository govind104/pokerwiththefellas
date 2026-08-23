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

**Two follow-up UI plans landed after Plan 4**, not part of the original 6-plan
numbering but worth knowing about since they touched the same frontend code Plan 5/6
will build on:
- **Saloon redesign** (PR #6, merge commit `9d575da`): RDR2-inspired visual restyle —
  wood/felt table, card frames, chip styling, Framer Motion animations. 7 tasks + one
  final-review fix round.
- **Table layout redesign** (PR #7, merge commit `6891af5`): replaced the seat-ring
  layout with a decoupled rail/felt-slot architecture (`GameTable` exposes `railSlot`/
  `bottomCenterSlot` content slots instead of owning seat positioning), fixing a real
  hole-card overflow bug as an architectural side effect. 4 tasks, a whole-branch
  review + fix round, then a live manual verification pass (with the user watching)
  that caught one more real overlap bug the review missed, plus two live product
  decisions: the table is now capped at **6 seats** for both game modes (was 8,
  `packages/server/src/index.ts`), and the table shell width changed from a fixed
  864px cap to 96% of the viewport so 6 players never need to scroll.

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

304/304 tests passing (68 frontend, 115 game-engine, 121 server), typecheck clean
across all 3 workspaces.

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
`GAME_MODE`/`PORT`/etc. env vars it reads; `GAME_MODE=blackjack` switches from the
default Hold'em table), then in a second terminal start the frontend
(`npm run dev --workspace=@poker-blackjack/frontend`, Vite on port 5173, defaults to
talking to `http://localhost:3000` unless `VITE_SERVER_URL` is set). Open multiple
browser tabs/windows against `http://localhost:5173` to play as different seats — the
table seats **6 players max** (both game modes).

## How this was built

Each plan starts with a design spec (`docs/superpowers/specs/`) and an implementation
plan (`docs/superpowers/plans/`) written via Claude Code's `superpowers:brainstorming`
and `superpowers:writing-plans` skills, then executed task-by-task via
`superpowers:subagent-driven-development` — a fresh implementer subagent per task, a
task-scoped code review after each, and a broad whole-branch review (this is what found
Plan 3's 3 Critical bugs, and later the saloon redesign's and table layout redesign's
own review-round findings) before merging. If continuing this project with Claude Code,
that same process is the established pattern for Plans 5-6 — see Plan 3's or Plan 4's
progress ledger (`docs/superpowers/plans/*-progress-ledger.md`) for exactly how it
played out in practice, including the judgment calls (which review findings got fixed
immediately vs. deferred, and why). The saloon redesign and table layout redesign
followed the same process but their per-task ledgers were git-ignored scratch, not
committed — their equivalent detail lives in their commit messages instead (`git log
9d575da..6891af5` for the full trail, or `git log f4db446..6891af5` for just the table
layout redesign). The table layout redesign is a good example of the value of the
process's closing **live manual verification** step: it caught a real overlap bug that
survived the implementer, task review, AND two rounds of whole-branch review, because
all of them reasoned about the CSS theoretically rather than measuring it in a real
browser.

The original full-app vision (all 6 plans, architecture, security, cost controls) is in
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md`.
