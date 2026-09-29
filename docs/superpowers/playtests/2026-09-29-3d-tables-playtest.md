# 3D tables -- AI playtest findings (2026-09-29)

Method (reproducible; the throwaway scripts were not committed):
- An isolated server on :3100 running the real `dist` build, with scratch data files
  (`PLAYER_STORE_PATH` / `GAME_CONFIG_PATH` / `HAND_LOG_PATH`) and a throwaway `ADMIN_PASSPHRASE`, so real balances and
  `.env` are never touched. A small socket.io-client "conductor" script did the admin login and mode switch.
- Three Sonnet subagents per game, each in its own browser tab (alice, bob, and cara as the visual reviewer), 3-4 hands
  each, with per-agent disruption tests (reload mid-hand, illegal actions, leave/rejoin, all-in, 2D/3D switch). Only the
  visual reviewer used the foreground tab and screenshots; the others read the sr-only status text and clicked via JS.
- Afterwards: bot players (socket.io-client) played 15 Blackjack hands while a spectator script re-derived every outcome
  from the cards and asserted one dealer for all seats, reveal only after the last player, and nobody paid early.
- Gotchas: stale tabs from a previous run silently rejoin a restarted server (close them first); tabs share
  `localStorage`; background tabs throttle requestAnimationFrame; the in-app browser cannot click refs in background tabs.

Console was clean in every run.

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

## Final whole-branch review and hardening
An Opus reviewer read the combined diff: 0 Critical, 1 Important, 5 Minor, and no findings in the shared-dealer change
(deal order/replay, marker-before-balance, crash mid-settlement, double settlement, all naturals/all bust, disconnect
auto-stand, hole-card leak). Resolved:
- Important: card keys repeat between hands, so a previous hand's revealed hole/showdown card stayed face-up. The
  reconciler now retires and re-deals a slot whose card changed or went face-down.
- 3D failures (lazy chunk or scene throwing) fall back to 2D via an error boundary; audio `enable()` no longer races
  `dispose()`; cards mid-sweep are disposed on teardown.
- Actions are logged before they are applied (both games), so a failed log write rejects the action; recovery skips
  actions the engine rejected live. An exhausted shoe rejects hit/double/split with no partial change, and a dealer that
  cannot play voids the hand with no balance changes (`Table.voidBlackjackHand`).
- New tests: recovery reproduces live play card-for-card after a split and hit; log-write failure in both games; voided
  hand leaves the table usable; engine shoe-exhaustion cases.

## Not yet verified
Whether the sound is pleasant (needs ears), animation feel at 60 fps on a real display, and behaviour on weak
integrated GPUs and real phones.
