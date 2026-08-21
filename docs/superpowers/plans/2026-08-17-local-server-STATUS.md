# Plan 3 (local-server) — Status

**Last updated:** 2026-08-21
**Branch:** `fix/plan3-critical-bugs` (based on `master` at `3f8e7f2`, not yet merged)
**HEAD:** `10cdc49` — "fix(server): correct misleading restart-recovery claim in settlement log"

## One-line summary

All 10 planned tasks are implemented and individually reviewed (merged to `master` on
2026-08-18 with 3 known Critical bugs, by explicit deliberate decision to unblock a
handoff). Those bugs are now fixed, in two review-and-fix rounds, both opus-tier
re-reviewed. **The fix is Approved — 0 Critical, 0 Important findings remain.** The
literal next step is opening the PR (`fix/plan3-critical-bugs` → `master`) and merging.

## What's done

`packages/server` (a Socket.IO server wiring the already-merged `@poker-blackjack/game-engine`
to real network connections, with local JSON-file persistence and crash recovery) is
fully built across 10 tasks — see `2026-08-17-local-server-progress-ledger.md` for that
history — and merged to `master`.

### The fix (this document's main update)

The 2026-08-17 final whole-branch review found 3 Critical + 8 Important bugs (full
detail: `2026-08-17-local-server-final-review.md`). The fix, designed in
`2026-08-17-local-server-fix-spec.md`, was applied on 2026-08-21 across two rounds:

- **Round 1** (5 commits, one per fix group): faithful transcription of all 5 groups —
  both hard invariants (write-ahead marker ordering, synchronous `writeQueue`
  reassignment) verified intact by the re-reviewer. But the re-review found **2 new
  Critical + 2 new Important bugs the fix itself introduced or left open**:
  `blackjackSettledSeats` leaking on a hand-start failure (silent skipped payout on a
  later hand), Blackjack balances still going negative through an ordinary
  double-down/split (the original C2 was only partially closed), an uncaught
  write-ahead marker write reproducing the original brick, and a corrupted
  `balances.json` being silently destroyed (not just tolerated) by the next write.
- **Round 2** (3 commits): fixed all 4. Re-review verified each closed by reproducing it
  against the round-1 code and confirming it no longer reproduces. **Approved.**

One nuance worth knowing before reading the review history: round-1's "2 new
Criticals" were actually one root cause (an uncaught throw escaping
`settleBlackjackSeatIfNeeded`) surfacing as two symptoms depending on which caller
reached it. See section H of `2026-08-17-local-server-carried-forward-findings.md` for
the full reconciliation and the 12 new Minor findings from this fix round (none
merge-blocking).

Test baseline at HEAD: monorepo 236/236 (115 `game-engine` + 121 `server`, up from 199 at
the original merge — +30 regression tests in round 1, +7 in round 2), typecheck clean in
both workspaces.

## What's blocking merge

Nothing outstanding from the review process. The literal next step is opening the PR
(`fix/plan3-critical-bugs` → `master`) via `superpowers:finishing-a-development-branch`,
and getting the user's explicit go-ahead to merge (never auto-merged, per standing
process).

Worth a skim before or shortly after merging:
`2026-08-17-local-server-carried-forward-findings.md` — now 43 items (31 from the
original 10 tasks + 12 new from this fix round), all independently triaged, none
merge-blocking. A few (the `Table` teardown API, the Hold'em/Blackjack seat-index
fidelity mismatch, the `activeHandIndex` cross-module coupling) are more
architecturally significant than "Minor" implies.

## Exact next steps

1. Open a PR: `fix/plan3-critical-bugs` → `master`.
2. Get explicit user go-ahead before merging (branch contains real behavioral changes
   to money-handling code — do not merge on implicit authorization).
3. After merge: Plans 1-3 are then all complete and merged. See "What's next after
   Plan 3" below (unchanged from the prior version of this document).

## What's next after Plan 3 (for whoever picks this up)

This project has a 6-plan roadmap (see
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md` for the
original full-app vision spec that all 6 plans implement pieces of):

- **Plan 1 — Blackjack engine** (`packages/game-engine`): done, merged to `master`.
- **Plan 2 — Hold'em engine** (`packages/game-engine`): done, merged to `master`.
- **Plan 3 — Local real-time server** (`packages/server`, this plan): implemented,
  fixed, approved — pending PR/merge.
- **Plan 4 — Frontend.** Not started. The first plan where a human actually clicks
  through a hand — everything so far is proven only by scripted `socket.io-client`
  tests. Will consume the Socket.IO protocol Plan 3 defines (`join`/`ready`/`action`/
  `leave` client events, `state`/`error` server events — see `protocol.ts`).
- **Plan 5 — Accounts.** Not started. Replaces Plan 3's plain-display-name identity
  with real Google-OAuth-backed accounts (`googleSub`-keyed), an allowlist gate, and an
  auth handshake before `join` is accepted. `PlayerStore`'s interface shape shouldn't
  need to change — only what gets passed as the key.
- **Plan 6 — AWS deployment.** Not started. Swaps `JsonPlayerStore` for a
  DynamoDB-backed implementation behind the same `PlayerStore` interface (the interface
  was deliberately designed Promise-returning throughout Plan 3 specifically so this
  swap wouldn't need to touch `Table` or the engines). Also EC2 hosting, the
  start/stop Lambda control plane, cost-control budget alarms, and the security-group/
  IAM setup described in the original design spec's Sections 2, 4, and 5.
  `HandLog`'s fate (keep it as local EC2 disk state, replace it, or drop it) is
  explicitly left as an open decision for Plan 6, not designed further in Plan 3.

Each of Plans 4-6 should get its own design spec (via `superpowers:brainstorming` +
writing a spec doc, matching how Plans 1-3 were each kicked off) and implementation
plan before starting — none of that discovery/design work exists yet for Plans 4-6.
