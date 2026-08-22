# Table layout redesign — HUD arrangement

**Status:** Approved, ready for implementation planning
**Depends on:** Saloon redesign v1 (frontend, PR #6, merged) — this plan uses that plan's
tokens and card/chip components unchanged. It's a rearrangement, not a re-theme.
**Relationship to the roadmap:** standalone follow-up, triggered by two things found
during the saloon redesign's live manual verification pass: (1) a real layout bug
(hole cards overflowing their seat container, worst on the rightmost seat, caused by
absolutely-positioned auto-width boxes computing shrink-to-fit width from their
untransformed `left%` position); (2) the user's own reaction that the seat-ring
arrangement "still feels very wonky" compared to RDR2 and a reference Discord poker
bot, even once the bug above is fixed. This plan explicitly reopens what the saloon
redesign spec deliberately left alone (Section 4 of that spec: "this plan restyles
that structure, it doesn't redesign its arrangement logic").

## 1. Scope

Replace the seat-ring arrangement (per-seat absolutely-positioned boxes around an oval,
each mixing player identity, balance, and cards together) with a decoupled layout:
player identity/status lives in one place, cards live in another, sized and positioned
independently. The two games diverge here, because they have different information-
hiding rules:

- **Poker** hides opponents' hole cards during play; only the viewing player's own
  hand is visible (community cards are the only cards legitimately shown on the felt
  during a hand). Identity/status therefore moves fully off the felt into a fixed
  panel, since the felt has nothing card-shaped to anchor it to for opponents.
- **Blackjack** shows every seated player's hand openly (only the dealer's hole card
  is hidden pre-reveal) — the existing game already renders every hand face-up on the
  felt. Identity/status stays anchored to each hand, just consolidated into one compact
  box per player instead of the old scattered seat-ring text, since there's no
  hidden-hand problem forcing separation the way poker has one.

**In scope:**
- `GameTable` — the shared shell. The seat-ring layout (`(i/seats.length)*2*Math.PI`
  angle math) is removed entirely; replaced by whatever positioning each game's new
  layout needs (see Sections 3–4). `GameTable`'s existing responsibilities that aren't
  about seat positioning — connection/error banners, Ready/Leave buttons, the wood-rail/
  felt shell itself — are unchanged.
- `PokerTable` — new player-info rail (bottom-left), the felt keeps only pot and
  community cards, the viewing player's hand moves to a dedicated bottom-center zone,
  showdown reveals render as inline thumbnails in the rail.
- `BlackjackTable` — dealer's hand top-center on the felt, players' hands in an evenly
  spaced row across the felt, each hand's info (name, balance, bet, turn/action status)
  in one box directly beneath that hand — no separate rail.
- Sizing pass on cards and HUD text: the saloon redesign's card component
  (`h-24 w-16`, i.e. 64×96px) is kept as the standard size; a larger size is introduced
  specifically for the poker player's own hand; HUD text sizes are set explicitly
  (Section 5) rather than left at the small values used in the plan's own comparison
  mockups.

**Explicitly not touched:**
- `Card`, `Chip` — the components themselves (card frame, back pattern, chip visual)
  are unchanged. Only where and how large they're rendered changes.
- Design tokens (`--brass`, `--felt`, etc.), fonts, motion timings — all from saloon
  redesign v1, unchanged.
- `packages/server` — per an explicit decision made while designing this: Blackjack's
  "dealer + 4 players" is a display target the new layout is designed to look good at,
  not a server-enforced seat cap. `seatCount` stays whatever it's configured to
  (default 8) for both games. See Section 4 for how the layout handles a Blackjack
  table seated with more than 4 players — it degrades, it doesn't break.
- `JoinScreen`, connection/error banners, sound, mobile-first layout — still out of
  scope, same as v1.

## 2. Visual reference

Three real reference points drove this, in order of influence:
1. **RDR2's own poker and blackjack HUDs** (user-supplied screenshots): opponent
   identity/balance/last-action as small stacked rows on one side of the screen, the
   viewing player's own cards held prominently near the bottom of the frame, pot
   displayed near the table center.
2. **A Discord poker bot's table view** (user-supplied screenshot): a cleaner, more
   modern take on the same idea — avatar + name + balance + blind badge as a compact
   unit, positioned near (but visually distinct from) that seat's cards.
3. **This plan's own mockups**, iterated twice with the user and approved: a
   comparison pass across three screens (Poker/turn, Poker/showdown, Blackjack), then
   a Blackjack-specific revision moving from a bottom-left rail to per-player info
   boxes anchored under each hand, then validated at true 1920×1080 scale to confirm
   real card and text sizes read correctly (not just the shrunk comparison-page
   versions). The full-scale pass is also where the viewport-height finding in
   Section 6 came from.

## 3. Poker layout

**Felt:** pot (existing chip-icon pill, unchanged design) and community cards only.
Nothing else renders on the felt during a hand. No seat markers, no per-seat
positioning.

**Player info rail:** fixed position, bottom-left of the table shell (not felt-relative
— it sits over the wood rail / background, same fixed corner regardless of table size
or seat count). One row per opponent, each row: a small avatar (a circle showing the
player's first initial, `--wood` fill with a `--brass` border and `--parchment` text —
the same fixed token treatment for every player, not a per-player color scheme; no
avatar image system exists or is in scope), name, balance, and a status line showing
whichever of {blind badge (small/big), dealer badge, folded badge, "Called"/"Checked"/
"Raised to N"/"Thinking…"} applies. Rows are ordered by ascending `seatIndex` — the
same deterministic order the old seat-ring iterated in, just linearized into a list
instead of positioned radially. The viewing player does **not** get a row in this rail
— their own status (ready, balance) is redundant with their own hand being visible at
the bottom-center, and their in-hand actions are the action bar itself, not a status
string to read.

At showdown (`holdem.street === 'settled'`), each opponent's row gains a second element:
two small card thumbnails showing their revealed hand, plus a win/lose badge (reusing
the `--win-bright`/`--ember-text` semantic colors already established, mirroring the
`data-outcome` pattern from Blackjack's Task 6 rather than a bare className check —
this pattern carries forward from the saloon redesign's own fix round, not reinvented
here).

**My hand:** fixed position, bottom-center. Two cards, rendered at the larger size
defined in Section 5, with a slight opposing rotation on each (matching the existing
card deal-in motion's rotation direction, `Card.tsx`'s `initial={{rotate: ±4}}` —
this layout change doesn't touch that animation, just where the cards land). The
action bar (Fold/Check/Call/Raise + raise input/All In) sits directly above the hand
when it's the viewing player's turn.

**Community cards and pot:** unchanged in concept from v1 — still centered on the felt,
still using the existing pot chip-icon pill — only their vertical position shifts
slightly to sit clearly above the (now-larger, still felt-external) my-hand zone rather
than floating in the felt's exact center, so nothing visually collides.

## 4. Blackjack layout

**Felt:** dealer's hand top-center (existing "Dealer" label pill, unchanged design),
then every seated player's hand in one evenly spaced row beneath it, left to right in
ascending `seatIndex` order (same deterministic ordering as the poker rail, Section 3).
"Evenly spaced" generalizes the same way the old seat-ring's angle math did — it
divides available felt width by the actual number of seated players, not a hard-coded
4. Four is the count the mockups were designed and visually validated against
(matching the stated "1 dealer + 4 players" target), not an enforced ceiling: a 5th,
6th, etc. player seated (since `seatCount` isn't capped per Section 1) still gets a
hand in the row, proportionally narrower per-hand as the row divides among more
players, the same graceful-degradation property the original seat-ring math already
had. No wrap-to-second-row behavior — one row, however many players are in it.

**Per-player info box:** directly beneath each hand (not in a separate rail). One box:
name, balance, and a status line (bet amount normally, "Your turn" when it's that
player's turn — mirroring the poker rail's status-line pattern but colocated with the
hand instead of separated from it). The active player's box gets the same brass glow
treatment the old active-seat pill used (`seat-active-glow`, unchanged CSS from v1 —
only what element it's applied to changes).

**Why Blackjack diverges from Poker's rail:** stated plainly to avoid it reading as an
inconsistency later — Poker's rail exists specifically to keep hidden-hand identity off
the felt; Blackjack has no hidden-hand problem (only the dealer's hole card is hidden,
and the dealer isn't a seated player with a balance/rail entry), so there's no reason
to separate identity from cards, and keeping them together is simpler and reads more
clearly than an artificial split would.

## 5. Sizing

Validated at true 1920×1080 scale (not the shrunk comparison-mockup values from the
first draft, which were legibility-adequate for comparing three layouts side by side
but not meant to ship):

| Element | Size |
|---|---|
| Standard card (community cards, Blackjack hands, showdown thumbnails' full-size equivalent) | 64×96px (`h-24 w-16`) — unchanged from v1's `Card` component, reused as-is |
| Poker "my hand" cards | 130×190px — deliberately larger than the standard size, matching the RDR2 reference's treatment of the viewing player's own cards as the most prominent element on screen |
| Showdown reveal thumbnails (in the poker rail) | ~40×58px — small, legible, clearly secondary to the my-hand cards |
| Poker rail-row avatar | 44×44px circle — Blackjack's per-player info box has no avatar (name + balance + status only), matching the approved mockup |
| Player/opponent name | 17px |
| Balance / status line / bet | 14px |
| Badges (blind, dealer, folded, win/lose) | 12px |
| Action bar buttons | 16px label |

These are the validated targets for the implementation plan to use verbatim — not
starting points for further eyeballing.

## 6. Responsiveness

Carries forward v1's desktop-first bar ("not visibly broken down to ~1024px width")
and adds an equivalent height consideration, found directly during this plan's own
full-scale mockup validation: a literal 1920×1080 canvas is *not* what a real browser
window gives you at that screen resolution — taskbar, browser chrome, and the address/
tab bar consume real vertical space, leaving meaningfully less than 1080px of actual
usable height. The implementation must size the table shell (oval height, my-hand
vertical offset, rail vertical extent) using relative units anchored to the actual
viewport (`vh`-based or flex/grid-based sizing that fills available space), not fixed
pixel heights that assume the full nominal screen resolution is available. This wasn't
a concern for v1's felt/rail restyle (which didn't change the shell's overall
dimensions), but this plan changes vertical layout enough (a taller my-hand zone, a
bottom-left rail with its own height) that it needs stating explicitly.

## 7. Relationship to the seat-overlap bug

The bug found during v1's manual verification (hole cards rendering at ~33px instead
of 64px width, overlapping the pot/action-button area, worst on the seat closest to
the felt's right edge) is **not being patched on the old structure** — it's resolved
architecturally by this redesign. The root cause (an absolutely-positioned,
auto-width seat box computing shrink-to-fit width from its untransformed `left%`
position, before the centering `transform: translate(-50%,-50%)` is applied) only
exists because seat boxes mixed variable-width text content with fixed-size card
content in one shrink-wrapped container positioned by percentage. Once cards no longer
live inside that kind of container — poker's cards move to fixed-position zones,
blackjack's cards move to an explicitly-divided row, not a per-seat percentage
position — the failure mode has no surface to occur on. No task in the implementation
plan should need to "fix" the old bug directly; it should simply not be reachable in
the new code.

## 8. Accessibility and testing

Unlike v1 (a pure visual restyle where nearly every `data-testid` and DOM shape stayed
identical), this is a structural rearrangement: seat-indexed testids like
`seat-${seatIndex}` and `hole-cards-${seatIndex}` don't map cleanly onto a rail-based
or evenly-spaced-row layout where position is no longer "this player's seat index" in
the same sense. **The existing frontend test suite for `GameTable`, `PokerTable`, and
`BlackjackTable` should be expected to need substantial rewriting, not incremental
edits** — this is stated here explicitly so the implementation plan doesn't try to
preserve testids that no longer correspond to anything real. New testids should be
designed fresh for the new structure (e.g. a rail row keyed by player id rather than
seat index, since the rail's ordering isn't seat-position-derived).

ARIA roles on the connection/error banners are unaffected (that code isn't touched).
New interactive elements (action bar buttons, any rail-row semantics) should meet the
same WCAG AA bar v1 established — contrast ratios computed against actual rendered
backgrounds before code is written, not eyeballed, matching v1's own practice.

## 9. Out of scope

- Backend `seatCount` changes — explicitly decided against in Section 1; Blackjack's
  4-player target is a frontend display design, not a server-enforced rule.
- `JoinScreen`, connection/error banners, sound, mobile-first layout — same exclusions
  as v1, unchanged.
- v2 "Deep Saloon + Painterly" (grain/vignette texture, painterly card art) — still not
  scheduled, unaffected by this plan.
- Avatar images / a real avatar system — the info rail's per-player avatar is a letter
  badge, not a photo/image system; building one is a separate, unscoped idea.
