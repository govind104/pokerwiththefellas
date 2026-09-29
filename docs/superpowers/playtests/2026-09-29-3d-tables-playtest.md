# 3D tables -- AI playtest findings (2026-09-29)

Method: isolated server on :3100 (scratch data, throwaway admin passphrase, real `dist` build),
three Sonnet subagents per game in separate browser tabs (alice, bob, and cara as the visual
reviewer), 3-4 hands each. Blackjack and Hold'em. Console was clean in every run.

## Blackjack dealers were per seat -- FIXED (shared shoe + dealer)

`packages/server/src/table.ts` used to deal every seat its own shuffled 6-deck shoe and its own dealer hand, and
settled each seat the moment that player finished. Testers saw results that never matched the dealer on screen,
results arriving before the last player acted, and the dealer's cards appearing "early".

Fix: `SharedDealer` (game-engine) owns ONE shoe and ONE dealer hand per table hand. Each seat's `BlackjackRound` is
built with `{ dealer }`, stops when its own hands are done (`playingComplete`), and the server plays the dealer once
after the last seat and settles everyone together (`Table.advanceBlackjackTurn`). Hand-log format changed
(`blackjack_hand_started` now `{ players, shoe }`); an old-format log left on disk is discarded on boot with a warning.
Verified live: 5 bot players over 15 hands, a spectator re-derived every outcome from the cards and checked that all
seats see the same dealer, the dealer is revealed only when everyone settles together, and no seat is paid early.

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

## Also resolved in the follow-up
- Double/Split are now disabled unless legal (two cards; a pair and only once per round; balance covers the extra stake) in both the 2D and 3D tables (`components/blackjackActions.ts`).
- 3D Blackjack plates show the balance net of the live bet (the server only debits at settlement).
- The seated table-error banner auto-dismisses after 6 s (any state broadcast already cleared it; this covers a quiet table).
- Settled Hold'em "Pot" excluded nothing before: `pots` includes an uncalled bet as its own single-player pot, so the label overstated it (200 vs a 160 pot). It now shows only the contested pots.
- Sound: the audio graph starts (`AudioContext` running, piano loop scheduled, SFX calls don't throw) and toggles cleanly. Whether it *sounds* right can't be checked by an AI.
- Performance on this machine (GTX 1650 Ti, 1280x720, dpr 1): about 1.6 / 2.2 / 2.6 ms per frame at Low / Medium / High. Integrated GPUs and high-DPI phones will be slower; the quality toggle exists for that.
- Six seats: laid out and checked in the harness (`/dev3d.html?step=8`).

## Known / left alone
- Test artefacts, not bugs: quality preference flips between tabs (shared localStorage), background tabs
  throttle rAF so animations only advance when drawn, ref clicks fail in background tabs.

## Not yet verified
Whether the sound is pleasant (needs ears), animation feel at 60 fps on a real display, and behaviour on weak
integrated GPUs and real phones.
