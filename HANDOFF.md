# Handoff

A browser-based Poker (Texas Hold'em) + Blackjack app for a friend group, built via a
6-plan roadmap and since extended with first-person 3D tables and a shared Blackjack dealer
(see "After Plan 6" below). Start here if you're new to this repo; `docs/README.md` says
which docs are kept current and which are historical records.

## Current work: fixing the 2026-10-01 audit findings (in progress)

**Branch** `audit/2026-10-01-full-audit` (off `master`; items 1-5 pushed and opened as a PR to `master` on 2026-10-01). **Findings:**
`docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md` (5 Critical, 15 Important,
30 Minor). Its section 8 is the agreed fix order. Raw audit inputs and repros are in
`.playtest-data/audit/` (git-ignored, not recoverable: never run `rm -rf .playtest-data`, which
`scripts/playtest/README.md:15` still says to do).

Done (each test-first; 530 tests green after the I4/I5/M5 commit, 625 after item 5's final-review fixes: frontend 214, game-engine 133, server 278; `npm run typecheck` clean):

| Commit | Findings | What changed |
|---|---|---|
| `33087ef` | docs | Report added; the six §7 doc fixes |
| `84837e2` | C1, C2 | `startHand` settles a Hold'em hand already settled when dealt (both all-in from blinds). `HoldemHand.wentToShowdown`; hole cards are revealed only after a real showdown, not on a fold-out |
| `8d7eacd` | C3, I1, I2 | `Table.runExclusive` per-table lock (actions, auto-acts, hand starts, admin balance). `actionSeq` in every view, client sends it back as `seq`, stale ones rejected; frontend `actionPending` disables action buttons. `Table.adminSetBalance` replaces `setSeatBalance`. `Table.retire()` on mode switch. A join that resolves after a switch is dropped. I1 was incomplete; finished by the IMP-1 commit |
| (C4 commit) | C4 | `adminHandler()` wraps every async admin handler in `socketServer.ts`: a rejection (e.g. EBUSY on a locked config file) becomes `rejectAdmin(message)` plus a server log. `processSafetyNet.ts` logs any other unhandled rejection and keeps the server running (called first in `index.ts`). EPERM/EBUSY `rename` retry not done |
| (IMP-1 commit) | I1 (review IMP-1, MIN-5) | `SocketContext` keeps `actionPending` true for at least `MIN_ACTION_LOCKOUT_MS` (600 ms) after a click, as well as until a new `actionSeq` arrives, so a double-click whose second click lands after the server reply is still one action. Tests added for a hand start queued on the lock before `retire()` and for the `adminSwitchMode` hand-in-progress re-check |
| (I4/I5/M5 commit) | I4, I5, M5 | `adminSetBlinds` rejects non-whole blinds and small > big. `JsonGameConfigStore` drops a non-whole stored blind and returns the default blinds if the stored pair is small > big (checked only on returned values, so blinds can still be set one at a time). New `envConfig.ts` reads PORT, RECONNECT_GRACE_MS and the four config defaults strictly; `index.ts` refuses to start on a bad one. `updateConfig` and `adminSetBalance` re-run the ready check. A failed `startHand` restores the dealer button, sets `handStartError` in the table view (cleared when a hand starts) and broadcasts; the frontend shows it in the existing table error slot. AdminPanel has no client-side check for small > big; the server's admin error is shown instead |
| `d441e73`, `4d7e0a0`, `9b5ed95`, `26722a7`, `2ce54f2`, `3743b85`, `ab7c244`, `ad2d938`, `be44565` | C5, I7, I9, M8, M11 (item 5) | **A name now belongs to one browser.** Names are normalised (`names.ts`: case-insensitive, at most 32 characters, invisible characters removed). `balances.json` is a v2 file (old one copied to `balances.json.v1-backup`): per name a balance plus `sha256(token)`. The first join under a tokenless name is issued a 32-byte token (`identity` event); the client keeps it in localStorage (`poker-blackjack:identity`) and sends it with every `join`. `playerStore.checkToken` runs before any seating, so a wrong token gets `code: 'name-claimed'`. The server sends `mySeatIndex` in each socket's state and the client trusts it instead of matching names (I9). A join with the right token takes over a seat still held by another socket (old one gets `code: 'replaced'` and shows "Play here instead"). The admin's **Release a name** forgets the token and keeps the balance. Admin login: 5 wrong passphrases → 60 s lockout per address; the admin session token is memory-only on the server and in sessionStorage (`poker-blackjack:adminToken`), so admin rights survive a reconnect (M11). The server binds `HOST` (default `127.0.0.1`), checks `Origin` against Host / X-Forwarded-Host / `ALLOWED_ORIGINS` (a missing Origin is allowed), and refuses a passphrase that is unset, `change-me` or under 8 characters (I7). `docs/HOSTING.md` now documents Tailscale Serve; the playtest bots keep their token. Final-review fixes (`be44565`): a browser that blocks storage keeps its token in memory for the tab's life; a socket that drops mid-join no longer kicks the tab holding the seat; the v1 migration and the client's token lookup both use the normalised name |

Decisions worth knowing:
- `recoverFromLog` still **voids** (does not pay) a hand that replays to `settled`. After the C1
  fix that only happens on a crash inside settlement, where balances may already be written, so
  paying again could double-pay. Making settlement idempotent is I3.
- `submitAction` is the locked public entry; `applyAction` is the body. Anything already holding
  the lock (the auto-act at the end of `applyAction`) must call `applyAction`, never
  `submitAction`, or it deadlocks.
- `seq` is optional on `action`: the playtest bots don't send it and are still accepted.
- An unhandled rejection is now logged and the server keeps running, rather than exiting. The
  table could be left half-updated, but that beats dropping every player.
- Item 5, decided with the user (2026-10-01; full list in the plan's "Global Constraints"): tokens
  in localStorage as a name→token map; a name with a balance but no token (every existing player
  on first run, any name after an admin release) is claimed by the first join; tokens never
  expire; a valid token takes over a seat still held by another socket; `HOST` defaults to
  `127.0.0.1` behind Tailscale Serve.
- Item 5, chosen without the user (they may override): admin token in sessionStorage and memory-only
  server side (a restart logs every admin out); 5 wrong passphrases → 60 s lockout; passphrase at
  least 8 characters; names at most 32 characters and case-insensitive, a v1 case collision keeps
  the larger balance; a missing Origin is allowed; markup-like names still accepted (escaping was
  verified safe).
- Item 5 known limitations, deferred by the final review with the user's agreement (2026-10-01):
  - **DNS rebinding** passes the Host-matching Origin check. Low risk: the server binds 127.0.0.1,
    so only a browser on the host machine can reach it, and a rebound page gets no token or admin
    session. Fix later with a Host allowlist (localhost, `*.ts.net`, `ALLOWED_ORIGINS`).
  - **Any error while a join is in flight counts as a rejected join** (`SocketContext.tsx`): at
    worst the join screen flashes and recovers. Real fix: the server tags join errors
    `scope: 'join'`.
  - Admin **Release a name** does not unseat a holder who is still connected; a new join under
    that name gets "already seated" until the old tab closes. Intended, and stated in
    `docs/HOSTING.md` ("Names and balances").
  - The other deferred item-5 Minors (each with a reason) are in the triage table of
    `.superpowers/sdd/item5-final-review.md` (git-ignored). The ones worth a later look:
    `loginLimiter` and `adminTokens` are never pruned (a restart clears both); malformed v2
    `balances.json` entries are dropped without a log line; `issueToken` can bind a token to a
    socket that disconnected during the write (admin release recovers it).
- Browser pass (Task 9 step 5, 2026-10-01, `.playtest-data/audit/browser-pass-item5.md`): item 5's
  checklist 11/11 PASS on an isolated server (port 3100), console clean, listens on 127.0.0.1 only.
  Items 1-4 were covered only by one blackjack hand played to settlement. Not yet investigated:
  after "Leave table" with the admin panel open, the table stayed on screen until a reload.
- One Opus review of `8d7eacd` ran (findings: `.playtest-data/audit/review-8d7eacd.md`). It found
  no deadlock path and no wrongly-stale action, but:
  - IMP-1 (Important, **fixed**): on a LAN the server's reply landed between the two clicks of a
    double-click, so the second click went out with a valid seq. Now a 600 ms minimum lockout. The
    lockout is a fixed time, not tied to the 3D deal animation (0.35-0.7 s per card move).
  - MIN-1: leave + rejoin during an admin balance write leaves the seat with the old balance
    (`leave`/`join` don't take the lock). MIN-2: a balance write queued on a retired table can land
    after a rejoin. Both belong with I3 / C5.
  - MIN-3: a reconnecting client whose join was dropped by a switch can sit on "Reconnecting…".
  - MIN-4: the table lock has no timeout; one stuck file write freezes the table. Low priority.
  - MIN-5 (**fixed**): the two missing tests are added; each was checked to fail with the code it
    guards removed.

**Next step:** item 5 (§8, identity and exposure) is done: Tasks 1-9 step 5 committed
(`be44565` holds the final-review fixes; Opus final review `.superpowers/sdd/item5-final-review.md`,
fix re-review approved). Remaining:
1. **Finish the live Tailscale test** (Task 9 step 6, guide `docs/TAILSCALE-LIVE-TEST.md`).
   Done 2026-10-01 on the real host (`pokerblackjack.<tailnet>.ts.net`, Windows): `tailscale serve
   --bg http://127.0.0.1:3000` works, and `tailscale serve --https=443 off` is the off command it
   prints. **Serve sends both `Host` and `X-Forwarded-Host` = the ts.net name** (plus
   `X-Forwarded-Proto: https`, `X-Forwarded-For` and `Tailscale-User-Login/Name/Profile-Pic`, which
   the server ignores), so the Origin check passes with no `ALLOWED_ORIGINS`. A phone on the tailnet
   joined over the `https://` link and played a full Hold'em hand against the host. Still to do:
   steps 16-17 (share the machine with a friend; tests the "share, don't invite" advice), then
   remove the "Not yet tested" note in `docs/HOSTING.md`, check its free-plan user-limit claim,
   and tick step 6 in the plan.
2. **Next session (user's choice, 2026-10-01): the 3D camera is too low.** The eye sits 0.29 m above the felt
   (`BASE_CAM` y 1.05 vs `TABLE_Y` 0.76 in `packages/frontend/src/three/engine/SceneRoot.ts:67`
   and `sceneModel.ts:14`; `LEAN_CAM` is lower still, 0.16 m). Your own cards are hard to read in
   both games, the river is hard to see in Hold'em, and opponents' revealed cards can't be read at
   showdown (fine for Blackjack, not for Poker). The user's first idea: a normal seated head
   height, roughly double the current height above the table; other solutions are open. Needs a
   design pass (`superpowers:brainstorming`) comparing heights and options with screenshots
   before any code. Gameplay over Tailscale was smooth.
3. **Then §8 item 6, "unsticking tables" (I6, I11, I10):** I6 admin kick and force-act plus an
   optional turn clock (an idle connected player stalls the table forever); I11 leave racing a hand
   start (the client drops its identity before the server confirms, so the server keeps the seat);
   I10 `joinInFlightRef` surviving a disconnect (two quick drops leave the player on
   "Reconnecting…"). Write its plan first (`superpowers:writing-plans`); line numbers in the audit
   predate item 5's `SocketContext` changes. Look at the "Leave table with the admin panel open"
   observation above while in that area (likely I11).

- How this session ran the loop (keep it for item 6): implementers are told **not** to
  `git add`/commit; the controller builds the review package from the working tree with
  `bash .superpowers/sdd/wt-package.sh .superpowers/sdd/item5-review-task-N.diff` (marks new
  files intent-to-add), reviews, then **asks the user before each commit** and commits code plus
  the ticked plan together. Task briefs are pre-extracted at `.superpowers/sdd/item5-task-N-brief.md`,
  reports go to `item5-task-N-report.md`, the reviewers' constraints block is
  `.superpowers/sdd/item5-global-constraints.md`. Per-task results and every Minor finding for the
  final review are in `.superpowers/sdd/progress.md` under "Item 5" (git-ignored).
- Models: Opus for the final whole-branch review; Sonnet elsewhere, escalating to Opus at a 2nd review
  round. Always set the model explicitly. Tell reviewers "no findings" is a valid result.
- Gotcha: tool inputs decode `\uXXXX` sequences into the real characters, so an agent cannot type
  a literal escape with Edit/Bash. Build the backslash with `String.fromCharCode(92)` in a script
  and check bytes with `od -c`, not by reading the file back.

Still open after item 5: MIN-1 to MIN-4 above, and the item-5 known limitations above. Ask before committing; don't push or merge without asking.

## Where things stand

| Plan | What | Status |
|---|---|---|
| 1 | Blackjack engine (`packages/game-engine`) | Done, merged to `master` |
| 2 | Hold'em engine (`packages/game-engine`) | Done, merged to `master` |
| 3 | Local real-time server (`packages/server`) | Done, merged to `master` |
| 4 | Frontend (`packages/frontend`) | Done, merged to `master` |
| 5 | Lobby & Admin Controls (`packages/server`, `packages/frontend`) | Done, merged to `master` |
| 6 | Local hosting over Tailscale (re-scoped from AWS deployment) | Done, merged to `master` |
| after 6 | First-person 3D tables, shared Blackjack dealer, write-ahead hand log | Done, merged to `master` (see "After Plan 6") |

**Two follow-up UI plans landed after Plan 4**, not part of the original 6-plan
numbering but worth knowing about since they touched the same frontend code Plans 5
and 6 later built on:
- **Saloon redesign** (PR #6, merge commit `9d575da`): RDR2-inspired visual restyle —
  wood/felt table, card frames, chip styling, Framer Motion animations. 7 tasks + one
  final-review fix round.
- **Table layout redesign** (PR #7, fast-forwarded; last commit `6891af5`): replaced the seat-ring
  layout with a decoupled rail/felt-slot architecture (`GameTable` exposes `railSlot`/
  `bottomCenterSlot` content slots instead of owning seat positioning), fixing a real
  hole-card overflow bug as an architectural side effect. 4 tasks, a whole-branch
  review + fix round, then a live manual verification pass (with the user watching)
  that caught one more real overlap bug the review missed, plus two live product
  decisions: the table is now capped at **6 seats** for both game modes (was 8,
  `packages/server/src/index.ts`), and the table shell width changed from a fixed
  864px cap to 96% of the viewport so 6 players never need to scroll.

### Plan-by-plan detail

**Plans 1 and 2** (the engines) are merged: Plan 1 was committed directly to `master`,
Plan 2 via PR #1 (merge commit `c2e1348`). The standalone `BlackjackRound` from Plan 1
still works on its own (own shoe and dealer); the table now always plays it against a
`SharedDealer` (see "After Plan 6").

**Plan 3** is fully merged to `master` (PR #2, merge commit `3f8e7f2`, then the fix PR #3,
merge commit `b1dfae1`), including a 2-round critical-bug-fix pass. 0 Critical, 0 Important
findings remain. Full detail in
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

### Post-Plan-6 hardening

**PR #10 → PR #11 → direct-to-master fix rounds (merge/commits
`f75808f`..`076fbaa`)**: after Plan 6 landed, a full
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

**A follow-up closed the one deliberately-lower-rigor gap from that
pass**: Blackjack's payout math (natural blackjack, a split hand landing
on 21, bust, push) hadn't been forced through the live server the way
Hold'em's had. Fixed with a genuinely deterministic re-verification —
an offline seed search using the actual engine code with a seeded PRNG
reproduced table.ts's exact shoe-construction sequence (then one shoe per
seat; the shared dealer since changed it), so two real
hands' entire deals were known in advance and driven through a real
running server via real `socket.io-client`, comparing the exact
predicted payout against both the live broadcast and the on-disk
`balances.json`. All four scenarios matched exactly, 3/3 clean repeated
runs — the historical split-hand-pays-3:2 bug (fixed pre-Plan-5, commit
`849b408`) stays fixed all the way through the live server path, not
just at the engine level.

That debugging session surfaced two real, more serious bugs along the
way — not what was being tested for, found only because the test kept
being pushed past "looks fine" to find out *why* a result looked wrong.
Both `JsonPlayerStore.setBalance()` and `JsonGameConfigStore.setConfig()`
had an unserialized read-modify-write through a file each call shared
one `${filePath}.tmp` path for: two concurrent calls (an admin's
`adminAdjustBalance` racing a hand's own settlement for a different
player; or just firing `adminSetBlinds` and `adminSetDefaultBet` back to
back, ordinary admin-panel usage) could silently lose one write, or in
the worse case corrupt the file into unparseable JSON. Both confirmed
directly with isolated repros against the classes alone (10 concurrent
runs each; 5/10 and 10/10 failures respectively before the fix), both
fixed with the same `queue`/`enqueue<T>` serialization pattern
`JsonlHandLog` already used from day one (the original precedent both
copied), both now covered by permanent regression tests. Commits
`8990ce3` (playerStore) and `24e1fd5` (gameConfigStore).

### After Plan 6: 3D tables, a shared Blackjack dealer, hardening

All of this is merged to `master` (PR #12 `b35f738`, PR #13 `347fcc9`, then direct-to-master
commit `b0acd11`). Plan/decisions: `docs/superpowers/plans/2026-09-29-3d-blackjack.md`.
Playtest write-up: `docs/superpowers/playtests/2026-09-29-3d-tables-playtest.md`.

**1. First-person 3D tables (Blackjack + Hold'em)** — Three.js, RDR2-*inspired* but original art
(minimal hat/hands silhouettes lit from below, lamp-lit saloon, film grade). Everything is
procedural or synthesised: no downloaded assets, card faces are the vendored MIT SVGs, audio is
WebAudio (off until the player clicks "Sound"). All in `packages/frontend/src/three/`:
- `sceneModel.ts` (Blackjack) and `pokerModel.ts` (Hold'em) are PURE, unit-tested translations of a
  server snapshot into a declarative scene (cards with stable keys, chip stacks, seats, labels).
  Hold'em has no dealer figure (the far-centre chair is a real seat), a pot stack + label, per-street
  bet stacks, and hole cards that stay face-down until the server reveals them.
- `engine/SceneRoot.ts` reconciles a model into deal / flip / sweep animations by key. The server
  only sends full snapshots, never events, so this diffing is the only way to know what happened.
  A slot that now holds a different (or face-down) card retires the old card and deals a new one,
  because keys repeat from hand to hand. `advance(seconds)` steps the simulation deterministically.
- `TableStage.tsx` is the shared React shell (canvas lifecycle, projected name plates, quality/sound
  controls, banners, Ready/Leave). `Blackjack3D.tsx` / `Poker3D.tsx` only supply model, sr-only
  summary and their action buttons. `View3DBoundary.tsx` drops to 2D if the lazy chunk or scene throws.
- `App.tsx` lazy-loads the 3D views behind a toggle persisted in `localStorage` (`table.view`, default 3D
  at >= 900px wide), and falls back to 2D if WebGL cannot start. Quality is `bj3d.quality`, sound `bj3d.sound`.
- Dev harness (not in the production build): `npm run dev --workspace=@poker-blackjack/frontend`, then
  `/dev3d.html?step=0..8&quality=low|medium|high` (add `game=poker`, steps 0..5). It drives a scripted hand with
  no server/admin. In dev, `window.__bj3d` exposes the scene (`advance(s)`, `debugCards()`, `getStats()`);
  the in-app browser pane throttles requestAnimationFrame, so animations only progress when you call `advance`.
- Tuning knobs: camera/FOV in `SceneRoot.ts` (landscape 84 deg horizontal, portrait tighter), light values in
  `room.ts`, card and slot geometry constants at the top of `sceneModel.ts`.

**2. Blackjack is now ONE shoe and ONE dealer hand per table hand.** Before, `table.ts` dealt every seat its
own shuffled shoe and dealer hand and settled each seat as it finished, so results never matched the dealer on
screen and arrived before the last player acted (found by the AI playtest). Now `SharedDealer`
(`game-engine/src/blackjackRound.ts`) owns the shoe and dealer cards; each seat's `BlackjackRound({ dealer })`
stops at `playingComplete`; `Table.advanceBlackjackTurn` moves the turn, plays the dealer once after the last seat
and settles everyone together (write-ahead marker per seat, unchanged). The hand-log entry is now
`blackjack_hand_started { players, shoe }`; an old-format log on disk is discarded with a warning at boot.
The per-seat `blackjackRounds` view shape is unchanged (every seat just carries the same dealer).

**3. Hand-log write-ahead and failure handling.** Game actions (both games) are appended to the hand log BEFORE
the engine applies them, so a failed write rejects the action and changes nothing (previously the hand moved on
with no record; with a shared shoe that would make recovery deal every seat different cards). The log can
therefore contain an action the engine then rejected; `recoverFromLog` skips exactly those (they throw
identically on replay). An exhausted shoe rejects hit/double/split without changing the hand (`assertCanDraw`;
double/split used to mutate before drawing), and if the dealer cannot play, `Table.voidBlackjackHand` cancels the
hand with no balance changes instead of leaving the table stuck. 6 decks at 6 seats cannot exhaust in normal
play; this is defence in depth.

**4. UX fixes from the playtest.** Live Hold'em pot and stacks (the server only fills `pots` and debits balances at
settlement, so `pokerModel.livePot` derives them from seat balance minus in-hand stack; the settled label counts only
contested pots, since an uncalled bet appears as its own one-player pot), "Call N" with Check/Call disabled when
illegal, Double/Split disabled unless legal in both 2D and 3D (`components/blackjackActions.ts`), the 3D plates show
balance net of the live Blackjack bet, sanitised raise input, table-error banner auto-dismiss after 6 s while seated
(`SocketContext`).

**5. How it was verified.** Six Sonnet subagents (alice/bob/cara x Blackjack/Hold'em, cara being the visual reviewer in each game) played
3-4 hands each in separate browser tabs against an isolated server; scripted socket.io bot players then ran 15 Blackjack
hands while a spectator script re-derived every outcome from the cards and asserted one dealer for all seats, reveal only
after the last player, and nobody paid early. A whole-branch Opus review found 0 Critical / 1 Important (stale face-up
cards across hands, fixed) / 5 Minor. The scripts (admin conductor, bot players, rule-checking spectator) are now in `scripts/playtest/` with a README; the method
is described in the playtest doc. Performance on a GTX 1650 Ti at 1280x720: about 1.6 / 2.2 / 2.6 ms per frame at Low / Medium /
High.

**Still not done:** a real session with friends over Tailscale; whether the sound actually sounds good (only the audio
graph was checked); behaviour on weak integrated GPUs and real phones. Pre-existing noise, harmless: server tests print
`ENOENT ... hand.jsonl` from a reconnect-grace timer firing after a test's temp dir is removed.

479/479 tests passing (174 frontend, 131 game-engine, 174 server), typecheck clean
across all 3 workspaces.

## Running things

```bash
npm install
npm test              # full monorepo test suite
npm run typecheck      # all three workspaces
```

Per-workspace: `npm run test --workspace=@poker-blackjack/game-engine` /
`--workspace=@poker-blackjack/server` / `--workspace=@poker-blackjack/frontend`.

**To run the app locally:**
1. Set `ADMIN_PASSPHRASE` (required — without it the server refuses to start, since no
   game could ever be started), either in the shell or in `packages/server/.env` (copy
   `packages/server/.env.example`, which lists every variable).
2. Start the backend: `npm run dev --workspace=@poker-blackjack/server` (port 3000 by
   default). `packages/server/src/index.ts` is the authority on the env vars it reads:
   `PORT`, `HOST` (default `127.0.0.1`), `ALLOWED_ORIGINS`, `ADMIN_PASSPHRASE` (at least 8 characters, not `change-me`), `SMALL_BLIND`/`BIG_BLIND`/`BLACKJACK_DEFAULT_BET`/
   `DEFAULT_STARTING_BALANCE` (one-time defaults until an admin change writes
   `game-config.json`), `RECONNECT_GRACE_MS`, `STATIC_DIR`, and the
   `PLAYER_STORE_PATH`/`GAME_CONFIG_PATH`/`HAND_LOG_PATH` overrides for where its
   JSON/JSONL state files live. The old `GAME_MODE` env var is gone — the server starts in
   an empty lobby and an admin picks Poker or Blackjack at runtime.
3. In a second terminal start the frontend: `npm run dev --workspace=@poker-blackjack/frontend`
   (Vite on port 5173). The frontend talks to the backend over the page's own origin in
   both dev and production (`packages/frontend/src/serverUrl.ts`); in dev,
   `vite.config.ts`'s `server.proxy` forwards `/socket.io` to `http://localhost:<PORT>`
   (same `PORT` env var and default of 3000 that `index.ts` reads; set `PORT` in the shell
   before starting both dev processes if you need to change it), so no separate env var or
   override file is needed.
4. Open `http://localhost:5173` in several tabs/windows to play as different seats — the
   table seats **6 players max** (both game modes). Click "Admin" in the top corner and
   enter the passphrase to unlock the lobby's mode picker and the in-game admin panel
   (balance correction, blinds/bet, starting balance, mode switching).

Tables open in the 3D view at >= 900px wide (`table.view` in `localStorage`; the
"2D view"/"3D view" button switches); see "After Plan 6" for the 3D dev harness
(`/dev3d.html`, needs only the frontend dev server).

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
established pattern for any new work (it was used for everything through Plan 6) — see Plan 3's or Plan 4's progress ledger
(`docs/superpowers/plans/*-progress-ledger.md`) for exactly how it played out in
practice, including the judgment calls (which review findings got fixed immediately vs.
deferred, and why). The saloon redesign, table layout redesign, and Plan 5 all followed
the same process but their per-task ledgers were git-ignored scratch, not committed —
their equivalent detail lives in their commit messages instead (`git log
9d575da^..9d575da` for the saloon redesign, `git log f4db446..6891af5` for the table
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
