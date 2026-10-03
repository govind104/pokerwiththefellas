# Audit item 7: crash-safe Hold'em settlement (I3) and the admin-write lock races (MIN-1, MIN-2)

Branch `audit/item7-settlement-locks` (from `master` at `dac22ed`, after PR #17). Sources: audit report
`docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md` §3 I3 and §8 item 7; MIN-1/MIN-2 in
`.playtest-data/audit/review-8d7eacd.md`.

**Test commands:** `npm test -w packages/server` (vitest) and `npm run typecheck -w packages/server`.
Full suite before the PR: `npm test` and `npm run typecheck` from the root.

**Loop:** small item (three server changes), so built inline with TDD by the controller, one commit per
task after its tests pass, then one Sonnet reviewer on the whole branch diff (escalate to Opus if a second
round is needed). No browser check: nothing here is visible in the client.

## Where things stand (checked 2026-10-03)

- **I3 is open.** `settleHoldem` (`table.ts` ~826) writes each winner's balance with its own `setBalance`
  and clears the hand log only after all of them. `recoverFromLog` (~1012) replays the log, and if the
  hand reaches `settled` it just clears the log. So a crash between writes leaves some players paid and
  some not, and a crash after the last action is logged but before any write voids the hand.
- **MIN-1 is closed by item 6.** Its scenario needs a leave and rejoin while `adminSetBalance` awaits its
  write. Item 6 moved `leave` and admin remove inside the table lock, and nothing else frees a seat
  (disconnect timers keep the seat). The leave now queues behind the admin write. Only a regression test
  is needed, so moving `leave` back out of the lock fails loudly.
- **MIN-2 is open.** `adminSwitchMode` calls `oldTable.retire()` and creates the new table at once. An
  admin balance write already running on the old table's lock can land after a player has rejoined the
  new table, so the new table caches the old balance and its next settlement overwrites the correction.

## Task 1: I3, settle a replayed Hold'em hand from the log

**Fix.** In `recoverFromLog`, when the replayed hand reaches `settled`, write each player's absolute
balance `stack + payout` (stack from `holdem_hand_started.players`, payout from `hand.results`) to the
player store, then clear the log. This is idempotent: re-running it after a partial or complete live
settlement writes the same numbers. Each write is best-effort, like `settleHoldem`: a failure is logged
with the exact balance to set by hand, and the log is still cleared. (Changed while building: keeping the
log was the first idea, but `startHand` appends without clearing, so the next hand's entries would follow
this hand's start and the next recovery would replay a mix.) No seats are created: the table starts empty.

**Same principle for an unfinished hand (decision for the user, included by default):** recovery of a
hand still in progress currently seeds each seat with `playerStore.getBalance`. Use the logged `stack`
instead. The hand was dealt from those stacks, and a Hold'em seat's balance does not change mid-hand, so
the logged stack is the live balance at the crash. The store can differ only if an earlier best-effort
write failed, and then the store is the wrong one.

**Tests (table.test.ts, `Table.recoverFromLog` block), each failing first:**
1. Crash after the first of two settlement writes: a store whose second `setBalance` never resolves;
   recover on a fresh Table over the same log and store. Both balances equal `stack + payout`, the sum is
   conserved, the log is empty. (Audit B repro: before the fix, 2010 chips instead of 2000.)
2. Crash after the deciding action is logged but before any write: build the log by hand (start entry
   plus a fold). Recovery pays the winner and the log is empty.
3. Idempotent: recovering the same settled log twice (log re-seeded) gives the same balances.
4. A write failure during recovery still writes the other player, logs the balance to set by hand, and
   clears the log.
5. Unfinished hand: a store whose balance for a player differs from the logged stack; the recovered
   seat has the logged stack.

## Task 2: MIN-1 regression test

**Test only (table.test.ts):** hold `setBalance`; start `adminSetBalance('alice', 5)`; while it is held
call `leave(alice's seat)` and then `join('alice')`; release. The store and the live seat both read 5.
It passes on current code; check it fails when `leave` is temporarily taken out of `runExclusive`, then
restore.

## Task 3: MIN-2, a retired table finishes or refuses its admin writes before the new table exists

**Fix.**
- `Table.adminSetBalance`: inside the lock, refuse on a retired table
  (`'The table was replaced; try again'`), so a write queued behind the switch never runs.
- `Table.retire()` returns `Promise<void>` that resolves when the lock queue present at retire time has
  drained (`this.exclusiveTail.then(() => {})`). Existing callers that ignore it are unaffected.
- `socketServer` `adminSwitchMode`: `await oldTable.retire()` **before** `seatBySocketId.clear()` and
  `createTable`. A join that lands on the old table during the drain has its mapping wiped by the clear,
  and the client auto-rejoins on the mode broadcast, as it does today. `modeChangeInFlight` stays true
  through the drain.

**Tests, each failing first:**
1. table.test.ts: with `setBalance` held, `adminSetBalance` in flight, `retire()`'s promise does not
   resolve until the write is released, and then the store holds the new value.
2. table.test.ts: an `adminSetBalance` called after `retire()` rejects and writes nothing.
3. socketServer.test.ts, if the injected player store can be wrapped to hold writes: adjust balance,
   switch mode at once, release the write; the player's balance on the new table equals the correction.
   If the store cannot be wrapped there without new test scaffolding, the two Table tests cover it and
   the plan notes that.

## Task 4: docs

Tick this plan; update HANDOFF "Next steps" (item 3 → I3/MIN-1/MIN-2 done, next is short stacks) and the
audit progress table; record the MIN-1 finding (closed by item 6).

## Checklist

- [x] Task 1 committed
- [ ] Task 2 committed
- [ ] Task 3 committed
- [ ] Branch review (Sonnet) clean
- [ ] Task 4 committed; PR opened (user gate before push/PR)
