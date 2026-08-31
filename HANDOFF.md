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
| 5 | Lobby & Admin Controls (`packages/server`, `packages/frontend`) | Done, merged to `master` |
| 6 | Local hosting over Tailscale (re-scoped from AWS deployment) | Done, merged to `master` |

**Two follow-up UI plans landed after Plan 4**, not part of the original 6-plan
numbering but worth knowing about since they touched the same frontend code Plan 5
built on (and Plan 6 will too):
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

**Plan 5 ("Lobby & Admin Controls")** is fully merged to `master` (PR #8, fast-forward
merge at commit `4acb538`). Originally scoped as "Accounts (Google OAuth) & Blacklisting"
in the master spec, it was re-scoped during brainstorming to something much better suited
to a closed friend-group app: no OAuth, no accounts, no blacklisting — instead a runtime
lobby (one server process now switches between Poker/Blackjack without restarting) plus
an admin toolkit (correct a player's balance, adjust blinds/default bet, adjust the
starting balance for new joiners), all gated behind a single shared passphrase
(`ADMIN_PASSPHRASE` env var) rather than real accounts. The server no longer constructs a
table at startup — it starts in an empty lobby until an admin picks a mode (with automatic
recovery of an in-progress hand's mode on restart, via a hand-log peek), and admin-adjusted
blinds/bet/starting-balance persist across restarts in a new `game-config.json`
(`gameMode` itself is deliberately never persisted). Implemented via
`superpowers:subagent-driven-development` across the plan's 10 tasks plus 2 standalone
fixes discovered mid-execution (a stale `createServer` call signature in the frontend's
integration-test fixture; a missing regression test for admin-action error display), each
individually task-reviewed clean or after a fix round. The **final whole-branch review**
(opus, 2 rounds) found 2 Critical cross-task integration defects invisible to any single
task's review — `adminSwitchMode` was unreachable dead code because `App.tsx`'s mount
condition and `Lobby.tsx`'s render condition for the mode-switch UI were mutually
exclusive, and a rejected admin action tore down the admin's entire session whenever they
weren't currently seated at a table — plus 5 Important and several Minor findings (empty
numeric admin inputs silently coercing to `0`, admin-action errors reusing the join-error
UI channel, no visibility into current config values, a missing `ADMIN_PASSPHRASE`
silently producing an unusable server, and more). All fixed and re-reviewed clean, with
one further small regression from the fix round itself (a failed auto-rejoin leaving the
client silently stuck on a fake "Connecting…" screen) caught and closed in a final commit.
A small, fully unrelated bug fix landed in the same session before this plan's work began:
split-hand Blackjack was paying 3:2 like a natural blackjack instead of the correct
1:1/push (commit `849b408`). Per-task ledger detail lives in the branch's commit messages
(`git log 849b408..4acb538`), not a committed ledger file — same pattern as the saloon and
table-layout redesigns.

**Plan 6 was re-scoped during its own brainstorming**, from the original
"AWS deployment (DynamoDB, EC2)" to local hosting over
[Tailscale](https://tailscale.com) instead — the group plays occasionally
(roughly weekly or less), so an always-on cloud deployment is unnecessary
cost and complexity, AWS's free tier no longer covers what the original
spec assumed (it changed structurally in July 2025), and Tailscale
sidesteps the connectivity problems (no fixed home IP, CGNAT) that made
plain port-forwarding a non-option. Full rationale in
`docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md`;
implementation plan in
`docs/superpowers/plans/2026-08-24-local-tailscale-hosting.md`. See
`docs/HOSTING.md` for how to actually run a session.

**Post-Plan-6 hardening (PR #10 → PR #11 → direct-to-master fix rounds,
merge/commits `f75808f`..`076fbaa`)**: after Plan 6 landed, a full
8-angle code review (`superpowers:code-review`, high effort) ran against
the branch and found 6 non-blocking findings — fixed on
`fix/plan6-review-findings` (PR #11), notably replacing a fragile
`.env.development` override with a proper Vite dev-server proxy
(`packages/frontend/vite.config.ts`) and hardening the `STATIC_DIR`
startup guard (`statSync` instead of `existsSync`, so a permission error
surfaces as itself instead of being misreported as "missing"). PR #11's
*own* post-merge review then found 5 more findings (2 confirmed, 3
plausible) — all fixed directly on `master` (commit `37872ca`), including
moving `staticDir` out of the otherwise-pure `StaticTableConfig` into its
own `CreateServerOptions` parameter, and making the Vite proxy's target
port follow the same `PORT` env var `index.ts` reads instead of a
hardcoded `3000`.

That was followed by a **practical end-to-end hardening pass** — not a
code review, but real socket.io traffic driven against real running
server instances across 8 scenario groups run mostly in parallel via
background subagents: full Hold'em and Blackjack play-throughs,
disconnect/reconnect resilience, concurrency races (concurrent admin
actions, concurrent joins, out-of-turn actions), admin edge cases,
corrupted/missing state files on startup, table-capacity extremes, and
the real `npm run play` single-process path. No crashes, data corruption,
or broken core gameplay turned up anywhere — the four real findings (a
wrong-shape-but-valid-JSON `game-config.json` silently breaking hand-start
with zero client-visible error; `adminAdjustBalance` silently creating an
orphaned balance entry for a never-seated display name; a raw `EISDIR`
instead of a friendly message when a config/data path pointed at a
directory; `io.close()` undocumentedly cascading into closing the
`httpServer` it was handed back alongside) were fixed directly on
`master` (commit `076fbaa`), each verified live against a real running
server, not just by unit tests. One candidate finding — seats staying
reclaimable by display name indefinitely past the reconnect grace window,
rather than being evicted — was investigated and confirmed **intentional**
for a casual friend-group app (nobody wants to be permanently kicked over
a bad wifi moment). Full findings ledger, including the two lower-rigor
groups run on a cheaper model tier and the one claim that was directly
re-verified and refuted: `.superpowers/sdd/e2e-hardening-findings.md`
(git-ignored scratch, not committed — same pattern as other plans'
per-task ledgers).

406/406 tests passing (123 frontend, 118 game-engine, 165 server), typecheck clean
across all 3 workspaces.

## Running things

```bash
npm install
npm test              # full monorepo test suite
npm run typecheck      # both workspaces
```

Per-workspace: `npm run test --workspace=@poker-blackjack/game-engine` /
`--workspace=@poker-blackjack/server`.

**To run the app locally:** set `ADMIN_PASSPHRASE` (required — without it the server
warns and refuses every admin action, so no game can ever start) and start the backend
(`npm run dev --workspace=@poker-blackjack/server`, listens on port 3000 by default — see
`packages/server/src/index.ts` for the full list of env vars it reads: `PORT`,
`ADMIN_PASSPHRASE`, `SMALL_BLIND`/`BIG_BLIND`/`BLACKJACK_DEFAULT_BET`/
`DEFAULT_STARTING_BALANCE` as one-time defaults for a fresh `game-config.json`,
`RECONNECT_GRACE_MS`, and the `*_PATH` overrides for where its JSON/JSONL state files
live). The old `GAME_MODE` env var is gone — the server now starts in an empty lobby and
an admin picks Poker or Blackjack at runtime (see below). Then in a second terminal start
the frontend (`npm run dev --workspace=@poker-blackjack/frontend`, Vite on port 5173).
The frontend talks to the backend over the page's own origin in both dev and production
(`packages/frontend/src/serverUrl.ts`) -- in dev, `vite.config.ts`'s `server.proxy` forwards
`/socket.io` requests to `http://localhost:<PORT>` (same `PORT` env var and default of 3000
`index.ts` reads; set `PORT` before starting both dev processes if you need to change it), so
no separate env var or override file is needed. Open the
"Admin" button in the top corner and enter the passphrase to unlock the lobby's mode
picker and the in-game admin panel (balance correction, blinds/bet, starting balance,
mode switching). Open multiple browser tabs/windows against `http://localhost:5173` to
play as different seats — the table seats **6 players max** (both game modes).

**To host an actual session with friends** (rather than local development),
see `docs/HOSTING.md` — it covers Tailscale setup and `npm run play`, which
builds the frontend and starts a single process serving both the app and
the game server together.

## How this was built

Each plan starts with a design spec (`docs/superpowers/specs/`) and an implementation
plan (`docs/superpowers/plans/`) written via Claude Code's `superpowers:brainstorming`
and `superpowers:writing-plans` skills, then executed task-by-task via
`superpowers:subagent-driven-development` — a fresh implementer subagent per task, a
task-scoped code review after each, and a broad whole-branch review (this is what found
Plan 3's 3 Critical bugs, later the saloon redesign's and table layout redesign's own
review-round findings, and Plan 5's 2 Critical cross-task integration bugs) before
merging. If continuing this project with Claude Code, that same process is the
established pattern for Plan 6 — see Plan 3's or Plan 4's progress ledger
(`docs/superpowers/plans/*-progress-ledger.md`) for exactly how it played out in
practice, including the judgment calls (which review findings got fixed immediately vs.
deferred, and why). The saloon redesign, table layout redesign, and Plan 5 all followed
the same process but their per-task ledgers were git-ignored scratch, not committed —
their equivalent detail lives in their commit messages instead (`git log
9d575da..6891af5` for the saloon redesign, `git log f4db446..6891af5` for the table
layout redesign, `git log 849b408..4acb538` for Plan 5). The table layout redesign is a
good example of the value of the process's closing **live manual verification** step: it
caught a real overlap bug that survived the implementer, task review, AND two rounds of
whole-branch review, because all of them reasoned about the CSS theoretically rather than
measuring it in a real browser. Plan 5 is a good example of the value of the **whole-branch
review** step specifically: every one of its 10 tasks passed its own task-scoped review
clean, yet the two most severe bugs in the entire plan (a dead-code admin feature, and a
rejected admin action nuking the whole session) only existed in the seams *between* tasks
— invisible to any review scoped to a single task's diff.

The original full-app vision (all 6 plans, architecture, security, cost controls) is in
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md`.
