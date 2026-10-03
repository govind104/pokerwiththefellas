# To-do ledger

One running list of known issues and follow-ups that are **not being worked on right now**. It exists so
that nothing found once has to be found again: check here before auditing, reviewing or fixing, and add
to it instead of starting a fix round.

## How to use it

- **Before fixing anything:** check here first. If it's listed, pick it up from here; don't rediscover it.
- **New finding** (review, playtest, audit) that isn't fixed on the spot: add a row with the next `T-`
  number, an importance and an effort, and where it came from.
- **Regressions are the exception:** a bug that the current branch itself introduced is fixed on the
  spot, in that branch, and never parked here.
- **Done:** move the row to "Done" with the date and the commit or PR. Don't delete rows.
- **Importance:** High (most nights, or money/freeze/exposure) · Medium (noticeable, not blocking) ·
  Low (cosmetic, edge case, needs a double fault). **Effort** is relative to audit item 7 (PR #18) = 1x.
- **Status:** OPEN · CHECK (may already be fixed by later work; verify before fixing) · IN PROGRESS.
- Audit IDs (I*, M*, MIN-*) refer to `docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md`
  and `.playtest-data/audit/review-8d7eacd.md`; open those for the detail.

## In progress

| ID | Item | Importance | Effort | Status | Source |
|---|---|---|---|---|---|
| I8 | Short stack offered "Call N", server rejects it (`holdemBetting.ts:37`). Fix: a short call becomes all-in for the stack; HUD label "Call N (all in)" | High | 0.3x | IN PROGRESS on `fix/i8-short-call` | Audit I8 |

## Gameplay and money

| ID | Item | Importance | Effort | Status | Source |
|---|---|---|---|---|---|
| M24 | No main/side-pot breakdown; an all-in player shows "Waiting", not "All in" | Medium | 0.5x | OPEN | Audit |
| M1 | Fractional chips: 3:2 on odd bets (37.5), split pots (91.5), decimal raises. Needs a rounding rule from the user (odd chip, 3:2) | Medium | 0.7x | OPEN | Audit |
| M3 | Heads-up short big blind: button must call the full BB or fold; disconnect auto-act folds | Low | 0.3x | OPEN | Audit |
| M2 | A short all-in "raise" lowers the minimum raise and reopens betting | Low | 0.3x | OPEN | Audit |
| M28 | Blackjack "self-corrects on next write" payout lost if the seat leaves or the mode switches first | Low (money, needs a failed write) | 0.3x | OPEN | Audit |
| M27 | Blackjack rules not stated anywhere (no dealer peek, split aces hit/double, no resplit): document or add a peek | Low | 0.2x | OPEN | Audit |
| M21 | Mid-hand joiner / 0-balance / under-bet player gets no reason for not being dealt in; no rebuy | Medium-low | 0.2x | OPEN | Audit |
| M6 | No dead-button or new-player-must-post rule | Low (fine for a casual table) | 0.3x | OPEN | Audit |
| M7 | Uncalled-bet refund appears as a separate one-player pot | Low | 0.2x | OPEN | Audit |
| M12 | After settlement, a folded player's cards visible to whoever later sits under that name | Low | 0.2x | OPEN | Audit |
| T-1 | `startHand` appends to the hand log without clearing it; a failed final clear leaves the old hand in front of the next (recovery now discards such a log). Clearing before the start entry removes the case | Low | 0.2x | OPEN | Item 7 review |

## 3D view

| ID | Item | Importance | Effort | Status | Source |
|---|---|---|---|---|---|
| I15 | Hidden-tab deal backlog (up to ~20 s) plus a burst of sounds on return. The HUD shows cards and actions at once, so this is the 3D table catching up. Cheap partial fix: mute deal sounds during a backlog | Medium-low | 0.5x (render gate) | OPEN | Audit |
| I14 | A card moved while a deal tween is queued ends half a step off for the rest of the hand. Same root as Plan B's "showdown lift during an all-in runout" overlap: cancel the earlier tween in `moveTo` | Medium | 0.5x | OPEN | Audit, Plan B |
| M16 | Synthesised piano may leave a delay feedback loop per note (check node count over 30 min) | Low | 0.2x | OPEN | Audit |
| M17 | Bloom render targets not disposed on a quality change; `applyQuality` runs twice on mount | Low | 0.2x | OPEN | Audit |
| M18 | No `webglcontextlost` handling; rAF-loop errors bypass View3DBoundary | Low | 0.3x | OPEN | Audit |
| M25 | 3D nits: busted hands show "Bet 25" until settlement; seats shift sides; own plate detached; centre "Lost 10" vs "Folded" | Low | 0.3x | CHECK (Plan A/B removed plates and labels) | Audit |
| M26 | Split re-deals the split card from the shoe; opponents' hidden cards keep their object across hands; `dealerActive` never true | Low | 0.3x | CHECK (Plan A) | Audit |
| M20 | 3D Blackjack plate shows balance minus bets | Low | 0.1x | CHECK (Plan B removed plates) | Audit |
| T-2 | HUD mini-card ranks about 7 px at 1200 px wide: consider enlarging the HUD's smallest text | Low | 0.2x | OPEN | Plan B Gate 3 |
| T-3 | Off-table "Admin panel" button not flush right on the join screen | Low | 0.1x | OPEN | Plan B Gate 3 |
| T-4 | Plan B cleanup: unused `TableStageProps` fields; sceneModel `outcomes` and seat `plate` unused (sceneModel is protected); banner markup duplicated in `table/Banners.tsx` and `three/TableStage.tsx`; 3D sr-only summary repeats the HUD (also M15); "2D" comments at `three/pokerModel.ts:61`, `three/sceneModel.ts:161`; `noThree.test.ts` sees only single-quoted static imports; dust `Points` geometry not disposed | Low | 0.4x | OPEN | Plan B final review |
| T-5 | Plan A follow-ups: `cameraFit.ts` `frameOutline` hands out mutable cached Vector3s; Hold'em dev-harness steps need real pots; Blackjack discard sweep briefly touches the outer-left 6-seat cards; harness "Dealer reveals" step and one model test use `phase: 'dealer'`, which the server never sends | Low | 0.3x | OPEN | Plan A |

## Server, admin and security

| ID | Item | Importance | Effort | Status | Source |
|---|---|---|---|---|---|
| MIN-3 | A client whose join drops during a mode switch while reconnecting can stay on "Reconnecting…" | Low | 0.2x | OPEN | Review 8d7eacd |
| MIN-4 | One stuck I/O promise freezes the whole table (the lock never releases) | Low | 0.3x | OPEN | Review 8d7eacd |
| T-6 | DNS rebinding passes the Host-matching Origin check. Fix: Host allowlist (localhost, `*.ts.net`, `ALLOWED_ORIGINS`) | Low (binds 127.0.0.1) | 0.3x | OPEN | Item 5 review |
| T-7 | Any error during an in-flight join counts as a rejected join; server should tag join errors `scope: 'join'` | Low | 0.2x | OPEN | Item 5 review |
| T-8 | `loginLimiter`/`adminTokens` never pruned; malformed v2 `balances.json` entries dropped without a log line; `issueToken` can bind a token to a socket that dropped during the write | Low | 0.3x | OPEN | Item 5 review |
| T-9 | Item 6 Minors: a removal racing a mode switch reports success but does nothing; a lost leave ack lets the reconnect rejoin; a failed clock default action leaves that turn unclocked; thin real-timer test margins; untested branches (Blackjack "Act for" name, AdminPanel between-hands guard); turn clock field has no 10-600 hint and loses the typed value on refusal | Low | 0.5x | OPEN | Item 6 review |
| M9 | Raw internal error text (absolute paths, `Cannot read properties of null`) reaches clients | Low | 0.2x | OPEN | Audit |
| M10 | Hand-edited `balances.json` not type-checked; NaN written as null | Low | 0.1x | OPEN | Audit |
| M13 | No security headers; no per-socket event or connection rate limit | Low | 0.3x | OPEN | Audit |
| M4 | Recovery renumbers seats 0..n-1, drops undealt seated players, resets the button | Low | 0.3x | OPEN | Audit |
| M29 | `recoverFromLog` writes seats without a bounds check against `seatCount`; junk actions logged before the engine rejects them | Low | 0.2x | OPEN | Audit |

## Client and admin UI

| ID | Item | Importance | Effort | Status | Source |
|---|---|---|---|---|---|
| M22 | Successful admin saves show no confirmation | Medium-low | 0.1x | OPEN | Audit |
| M14 | Join-form errors wiped by any broadcast | Low | 0.1x | OPEN | Audit |
| M19 | AdminPanel keeps a departed player as `targetName` | Low | 0.1x | OPEN | Audit |
| M23 | Wording: "Switch to Poker" vs "Hold'em"; two "not your turn" texts; sr text "Blackjack!." | Low | 0.1x | OPEN | Audit |
| M15 | Accessibility: 3D live region re-reads the table; banner contrast 2.45:1 and 3.72:1; failed admin unlock not `role=alert` | Low | 0.3x | CHECK (Plan B HUD) | Audit |

## Not yet verified live

| ID | Item | Importance | Effort | Status | Source |
|---|---|---|---|---|---|
| T-10 | Plan B mid-hand Leave and the live turn countdown, against a real server in a browser | Medium | Next game night | OPEN | Plan B final review |
| T-11 | Tailscale live test steps 16-17, then drop the `docs/HOSTING.md` "Not yet tested" note and check its free-plan claim | High before remote play | Small, needs a second device | OPEN | HANDOFF |

## Done

| ID | Item | Done | Where |
|---|---|---|---|
| C1-C5, I1-I7, I9-I11, M5, M8, M11, M30 | Audit items 1-6 | 2026-10-01 to 2026-10-02 | PRs #14, #16 |
| I3, MIN-1, MIN-2 | Audit item 7: crash-safe Hold'em settlement, admin-write lock races | 2026-10-03 | PR #18 |
| I12, I13 | 2D-only findings | 2026-10-03 | Dropped: the 2D view was retired (Plan B, PR #17) |
