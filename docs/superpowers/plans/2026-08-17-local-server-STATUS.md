# Plan 3 (local-server) — Status

**Last updated:** 2026-08-18
**Branch:** `local-server` (not merged to `master`)
**HEAD:** `76d6dee` — "test(server): add resilience integration tests (reconnect, timeout, restart, crash recovery)"

## One-line summary

All 10 planned tasks are implemented, tested, and individually reviewed. The final
whole-branch review found 3 Critical + 8 Important bugs (a well-specified fix exists —
see below — but has not yet been applied to the code). **The branch is not mergeable
as-is.** The immediate next step is: apply the fix, verify, re-review, then open the PR.

## What's done

`packages/server` (a Socket.IO server wiring the already-merged `@poker-blackjack/game-engine`
to real network connections, with local JSON-file persistence and crash recovery) is
fully built across 10 tasks:

1. `PlayerStore` (balance persistence)
2. `HandLog` (append-only crash-recovery log)
3. `Table` seats/dealing (both games)
4. `Table` actions/settlement
5. Disconnect/reconnect with a grace window
6. Crash recovery (`Table.recoverFromLog`)
7. `Table.getStateForSeat` (per-viewer state projection, hole-card/dealer-card access control)
8. Socket.IO wiring (`socketServer.ts`, `protocol.ts`, `index.ts`)
9. Integration tests, happy path (both games, real socket.io-client connections)
10. Integration tests, resilience (reconnect, disconnect-timeout, restart, crash recovery)

Every task went through at least one task-scoped review (spec compliance + code
quality); several needed opus-tier review and multiple fix rounds because they touch
timing/concurrency/crash-recovery logic. Full history — including three genuinely
subtle bugs the team found and fixed mid-plan (a Blackjack double-payment gap, a
Socket.IO join-handler seat-orphan race that could deadlock the whole table, and an
unserialized hand-log write race) — is in
`2026-08-17-local-server-progress-ledger.md` in this folder. That file is the complete,
chronological record of every task, every review round, and every design decision;
treat it as the definitive "why was it built this way" reference.

Test baseline at HEAD: monorepo 199/199 (115 `game-engine` + 84 `server`), typecheck
clean in both workspaces.

## What's blocking merge

The final whole-branch review (full text: `2026-08-17-local-server-final-review.md`)
found 3 Critical bugs, none of which any of the 19 task-level review rounds caught,
because each only becomes reachable once multiple tasks compose together:

- **A 0-chip player permanently bricks the Hold'em table.** Normal outcome of an
  all-in hand (the branch's own integration test proves it happens); nothing resets
  `handInProgress` when `HoldemHand`'s constructor rejects a busted player, and every
  recovery path then throws. Only a server restart clears it.
- **Blackjack has no affordability check at all** — balances go unbounded negative,
  silently, with no error.
- **An unvalidated display name hits the JavaScript prototype chain** (`"constructor"`,
  `"__proto__"`, etc. as a display name) and bricks the table the same way — reachable
  from any unauthenticated browser tab given the server's open CORS policy, not just a
  deliberately malicious client.

Plus 8 Important findings (durability gaps that can silently disable crash recovery or
leave the table permanently stuck via a rejected disk write, and zero integration-level
proof that hole-card access control actually holds over the real network). Full detail,
including the exact empirical reproductions the reviewer used to prove each one, is in
the final-review document.

**The fix for all of this is fully designed and ready to implement** —
`2026-08-17-local-server-fix-spec.md` in this folder has the exact code for every
change, grouped by shared root cause, plus the specific regression tests each one
needs. It was dispatched to an implementer three times and failed all three times on
Anthropic-side `529 Overloaded` infrastructure errors before any code was touched — so
**nothing in the fix spec has been applied yet.** This is the literal next thing to do.

Also worth reading before finishing this plan: `2026-08-17-local-server-carried-forward-findings.md`
lists 31 additional Minor/deferred items the reviewers found across all 10 tasks and the
final review — none block a merge, all were independently triaged, but they're worth a
skim before or shortly after merging (a few, like the missing `Table` teardown API and
a Hold'em/Blackjack seat-index inconsistency in recovery, are more architecturally
significant than "Minor" implies and are flagged as such in that document).

## Exact next steps to get this merged

1. Implement `2026-08-17-local-server-fix-spec.md`'s 5 fix groups exactly as specified,
   including all listed regression tests.
2. Run the full verification checklist at the end of that document (server suite, full
   monorepo, typecheck).
3. Generate a review package for just the fix commit and get it reviewed — ideally
   opus-tier, given the money-integrity/availability stakes. If continuing via Claude
   Code with the `superpowers:subagent-driven-development` skill, the pattern used for
   every one of this plan's fix rounds is in the progress ledger; it generalizes
   directly.
4. Once that review is clean (or only Minor findings remain), use
   `superpowers:finishing-a-development-branch` (or just open a PR manually) —
   `local-server` → `master`. Review the PR thoroughly before merging; this is a
   sizeable branch (24 commits, ~all of `packages/server`) even before the fix commit
   lands on top.
5. After merge: Plans 1-3 are then all complete and merged. See "What's next after
   Plan 3" below.

## What's next after Plan 3 (for whoever picks this up)

This project has a 6-plan roadmap (see
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md` for the
original full-app vision spec that all 6 plans implement pieces of):

- **Plan 1 — Blackjack engine** (`packages/game-engine`): done, merged to `master`.
- **Plan 2 — Hold'em engine** (`packages/game-engine`): done, merged to `master`.
- **Plan 3 — Local real-time server** (`packages/server`, this plan): implemented,
  blocked on the fix above.
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
