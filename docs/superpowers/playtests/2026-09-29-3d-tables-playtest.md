# 3D tables -- AI playtest findings (2026-09-29)

Method: isolated server on :3100 (scratch data, throwaway admin passphrase, real `dist` build),
three Sonnet subagents per game in separate browser tabs (alice, bob, and cara as the visual
reviewer), 3-4 hands each. Blackjack and Hold'em. Console was clean in every run.

## Needs a product decision (NOT fixed)

**Blackjack dealers are per seat.** `packages/server/src/table.ts` (~L389-398) deals every seat its own
shuffled 6-deck shoe and its own dealer hand; each seat's round settles the moment that player
finishes. Consequences seen by all three testers: the dealer on screen never matches other
players' results, results arrive before the last player has acted, and the dealer's cards appear
"early". Mitigation shipped: both tables now show the *local player's own* dealer hand (their
result matches what they see). Proper fix = one shared shoe + dealer per hand, settle after the
last player -- an engine/server change.

## Fixed in this branch

| Finding | Fix |
|---|---|
| Hold'em pot always 0, balances frozen until showdown (server fills `pots`/debits balances only at settlement) | Live pot = sum(seat balance - in-hand stack); plates show live stacks; bets in front, centre stack = earlier streets |
| No call amount; Check/Call always enabled | "Call N" label, Check disabled when facing a bet, Call disabled when nothing owed, disabled styling on `Button` |
| Raise box accepted negatives/decimals | Sanitised to whole non-negative chips |
| Large black rectangle mid card flip (Blackjack) | It was a flying card's shadow; cards no longer cast shadows |
| Cards small / ranks unreadable | Cards ~25% bigger, stronger lean-in on your turn, tighter FOV on portrait phones |
| "Thinking..." lingered after a seat settled | Settled seats are inactive and show their result |
| Own plate covered Hit on phones; action bars overflowed | Plate moved above the bar on narrow screens; bars wrap |
| Won/Lost label sat on pot/community cards | Anchored toward the owner |
| Lamp bloom washed out a flop card; constant camera sway | Lower bloom and card brightness; sway halved |
| Visible vertical seam on the felt | Felt stains now tile seamlessly |

## Confirmed working
Reload mid-hand re-seats with cards intact (~4 s); 2D<->3D switch mid-hand keeps state; leave and
rejoin keeps seat and balance; fold, all-in with side pots and showdown reveals behave; opponents'
hole cards stay hidden (never shown for folded players); balances always summed to 3000.

## Known / left alone
- Stale error banner persists across streets until the next valid action (SocketContext, both UIs).
- Double/Split are clickable when illegal (server rejects with an alert; turn preserved).
- Blackjack balances are not debited until settlement (server behaviour).
- Settled Hold'em `pots` sum looked larger than net payouts in one bot hand (200 vs +/-80); not yet
  root-caused -- check `HoldemHand` pot bookkeeping before trusting the settled "Pot" label.
- Test artefacts, not bugs: quality preference flips between tabs (shared localStorage), background tabs
  throttle rAF so animations only advance when drawn, ref clicks fail in background tabs.

## Not yet verified
Sound (audible), animation feel in a foreground tab at 60 fps, performance on weak GPUs and phones,
a full 5-6 player table.
