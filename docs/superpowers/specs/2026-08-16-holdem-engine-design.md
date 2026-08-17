# Texas Hold'em Engine — Design Spec

**Date:** 2026-08-16
**Status:** Approved for implementation planning
**Audience:** Whoever builds this (spec + the follow-up implementation plan are the handoff)
**Relationship to prior docs:** Implements the Texas Hold'em portion of
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md`
Section 3, following the same local-first, engine-only scoping as
`docs/superpowers/plans/2026-08-15-blackjack-engine.md` (Plan 1 of the
project's 6-plan roadmap). This is Plan 2.

## 1. Overview & Goals

A pure-logic, unit-tested Texas Hold'em rules engine, added to the existing
`@poker-blackjack/game-engine` package alongside the Blackjack engine from
Plan 1. No networking, no UI, no AWS — same constraint as Plan 1, and for
the same reason: build and prove correctness locally before any of that
exists.

**Goals:**
- A `HoldemHand` class that plays exactly **one hand** of No-Limit Texas
  Hold'em start to finish: blinds, hole cards, four betting streets,
  showdown, settlement — given a set of players, their stacks, and blind
  amounts.
- Correct side-pot handling for multiple players going all-in at different
  stack sizes — the single hardest requirement in this plan.
- Correct heads-up (2-player) dealer/blind/action-order rules.
- An engine a future server (Plan 3) can drive one hand at a time, the same
  way it will drive `BlackjackRound`.

**Non-goals (explicitly out of scope for this plan):**
- Table/session management: button rotation across multiple hands, players
  joining or leaving between hands, tracking a running session. This plan's
  unit is one hand; a table/session concept belongs to Plan 3 (the server),
  which can construct a new `HoldemHand` per hand dealt — the same split
  Plan 1 used for `BlackjackRound`.
- Any variant other than No-Limit Texas Hold'em (no Omaha, no Limit/Pot-Limit).
- Turn timers/clocks, disconnect handling, or anything involving real time
  — those are server/networking concerns (Plan 3).
- Real-time equity/odds calculation or AI opponents. See Section 9.

## 2. Architecture

New files in `packages/game-engine/src/`, alongside the existing Blackjack
files, all prefixed `holdem` to stay unambiguous in a package that now has
two games:

| File | Responsibility |
|---|---|
| `holdemHandRank.ts` | Wraps the `pokersolver` dependency (Section 5). Converts our `Card[]` to/from its format. Exposes `determineWinners()` and `describeHand()` — nothing outside this file ever imports `pokersolver` directly. |
| `holdemBetting.ts` | Pure functions for action legality: minimum legal raise, whether a given action is legal in the current betting state, resulting chip movement. No class state — takes state, returns a decision. |
| `holdemPots.ts` | The standard layered side-pot algorithm (Section 6): player contributions in, an ordered list of `{amount, eligiblePlayerIds}` pots out. |
| `holdemHand.ts` | Orchestrator class `HoldemHand`, playing one full hand by composing the three modules above plus `deck.ts`'s `createDeck`/`shuffle`. Mirrors `BlackjackRound`'s role and public-API shape (a `phase`, an `act()`-style entry point, a `results` field once settled). |

Reused unchanged from Plan 1: `Card`, `Suit`, `Rank`, `RandomFn`,
`createDeck`, `shuffle` from `deck.ts`. Hold'em deals from one shuffled
52-card deck per hand — it does not use `shoe.ts` (`createShoe`'s 6-deck
combination is Blackjack-specific).

**Dependency:** `pokersolver` (MIT license) is added to
`packages/game-engine/package.json`'s `dependencies` — this package's first
runtime dependency; everything in Plan 1 had zero.

## 3. Game Rules (MVP defaults)

Per the original spec (Section 3) plus decisions made during this plan's
design:

- **No-Limit betting**, standard blind structure — small/big blind amounts
  are inputs to `HoldemHand`, not hardcoded.
- **Up to 8 players, one table**, matching the original spec.
- **Single-hand scope:** `HoldemHand` plays one hand given players, stacks,
  blinds, and button position as constructor input. Button rotation and
  multi-hand session state are a server concern (Plan 3), not this engine's.
- **Heads-up (2 players) is fully supported** with correct special-case
  rules: the button posts the small blind, acts first pre-flop, and acts
  last on every subsequent street.
- **No burn cards.** Real casinos burn a card before each street to defend
  against a marked deck — meaningless for a digital shuffled deck, so this
  engine deals the flop/turn/river directly from the shuffled deck with no
  burned cards. A deliberate simplification, stated explicitly so it reads
  as a choice, not a gap.
- **All-in and side pots are fully supported**, not a special case bolted
  on: any player can move all-in for less than a full call, and the pot is
  split into main + side pots with the correct eligible-player subset for
  each (Section 6).
- **Split pots divide evenly, including fractional chips, with no special
  odd-chip-to-the-dealer's-left rule.** Consistent with the fractional-chip
  policy Plan 1 already established for Blackjack (`payout.ts`) — chips
  have no cash value, so an exact-integer distribution isn't a real
  requirement, and skipping the odd-chip rule avoids a new edge-case class.
- **Illegal actions throw**, same convention as `BlackjackRound.act()`:
  acting out of turn, betting below the minimum raise, checking while
  facing a bet, etc. all throw a descriptive `Error` rather than silently
  clamping or no-op'ing.

## 4. Hand Evaluation

Uses `pokersolver` (MIT) rather than a hand-rolled evaluator. Researched
alternatives:

- **`phe`** (MIT, ports the actively-maintained Apache-2.0
  `HenryRLee/PokerHandEvaluator` C library): faster (hash-lookup, ~144KB
  table) but returns only a numeric strength value — no "which cards form
  the hand" or human-readable description, and gameplay speed is not a
  bottleneck for a turn-based game evaluating one showdown per hand.
- **`pokersolver`** (MIT, stable since 2020, widely used in the JS poker
  community): returns hand name, description, the specific cards forming
  the hand, and — critically — a built-in `Hand.winners()` that correctly
  handles ties. That last part is directly reusable for split-pot
  settlement, which a bare strength number is not.

**Decision: `pokersolver`.** Output richness matters more than raw
evaluation speed here, and `Hand.winners()` removes an entire class of
tie-detection bugs from this codebase's surface area.

`holdemHandRank.ts` is the *only* file that imports `pokersolver` or knows
its card-string format (e.g. `'Ah'`, `'Td'`). It exposes:
- `determineWinners(players: {playerId: string; holeCards: [Card, Card]}[], communityCards: Card[]): string[]` — the winning playerId(s) among the given subset (a pot's eligible players), for `holdemHand.ts` to call once per pot.
- `describeHand(holeCards: [Card, Card], communityCards: Card[]): { name: string; description: string }` — for a future UI's "you have a Flush" display; not required by any test in this plan but cheap to expose since `pokersolver` already returns it.

No other module ever imports `pokersolver` directly, or needs to change if
it's ever swapped for a different evaluator later.

## 5. Side Pots

The standard layered algorithm: given each player's total chip contribution
for the hand (0 for a player who folded before contributing further) and
their folded/active status,

1. Collect the distinct contribution levels among non-folded players who
   contributed anything, sorted ascending.
2. For each layer between consecutive levels, create one pot sized
   `(level_i − level_{i-1}) × (number of players who contributed ≥ level_i)`.
3. A pot's eligible players are exactly those who contributed at least that
   layer's level **and** did not fold.
4. Folded players' contributions still count toward pot *sizes* (their
   chips are in the pot) but they are never eligible to win any pot.

`holdemPots.ts` exposes `computePots(contributions: {playerId: string; amount: number; folded: boolean}[]): { amount: number; eligiblePlayerIds: string[] }[]`,
pure and independently testable with no dependency on `holdemHandRank.ts`
or `holdemHand.ts`.

## 6. Data Flow (one hand, happy path)

1. `HoldemHand` constructed with players (id, stack), small/big blind
   amounts, and button position.
2. Deck shuffled (`shuffle(createDeck(), random)`); 2 hole cards dealt to
   each player.
3. Blinds posted (heads-up: button posts small blind).
4. Pre-flop betting round. Action order and legality validated by
   `holdemBetting.ts` on every action.
5. If only one player remains unfolded at any point, the hand ends
   immediately — that player wins the entire pot, uncontested, with no
   cards revealed. This can happen after any street, including pre-flop.
6. Otherwise: flop dealt (3 community cards, no burn) → betting round →
   turn (1 card) → betting round → river (1 card) → betting round.
7. Showdown: `holdemPots.computePots()` builds the pot list from final
   contributions; for each pot, `holdemHandRank.determineWinners()` finds
   the winner(s) among that pot's eligible players; the pot splits evenly
   among them (Section 3's fractional-split rule) and is added to each
   winner's settlement.
8. `HoldemHand.results` is populated: net chip change per player, mirroring
   `RoundResult`'s `payout` semantics from Plan 1 (`balance += payout`; the
   value already nets out what that player put into the pot).

## 7. Error Handling & Known Limitations

- **Out-of-turn or illegal actions throw**, matching `BlackjackRound`'s
  convention (Section 3).
- **No mid-hand persistence** — this plan doesn't touch storage at all
  (that's Plan 3's job, same split as Blackjack). A crash mid-hand loses
  that hand's in-progress state; no different from Blackjack's already
  accepted limitation.
- **No turn timers.** A player who never acts blocks the hand forever, by
  design — timeout/disconnect handling is explicitly a server concern
  (Plan 3), not this engine's.
- **Evaluator is swappable, not swapped.** `pokersolver` is fully contained
  behind `holdemHandRank.ts` (Section 4). If a future feature needs a
  faster evaluator (a real-time equity display, a bot doing heavy
  simulation), it can be swapped there without touching betting, pots, or
  orchestration code — but that swap is not part of this plan, and
  shouldn't be built speculatively ahead of an actual need.

## 8. Testing Strategy

- **`holdemHandRank.ts`:** known tricky hands — a wheel straight (A-2-3-4-5),
  flush vs. straight, full-house kicker ties, a genuine split pot (identical
  hand strength between two players) — verifying `determineWinners()`
  returns the correct player(s).
- **`holdemBetting.ts`:** minimum-raise math, legal vs. illegal action
  detection (acting out of turn, under-raising, checking into a bet),
  correct handling of an all-in for less than a full call.
- **`holdemPots.ts`:** the multi-way, uneven-all-in scenarios the original
  spec explicitly calls out as the trickiest case — at least one 3-player
  and one 4-player all-in-at-different-amounts scenario, each verified
  against hand-computed expected pot amounts and eligible-player sets.
- **`holdemHand.ts` (orchestration):** a full showdown hand, an
  everyone-folds-preflop early win, an all-in-preflop hand that runs the
  board out with no further betting, and a heads-up hand verifying the
  button acts first pre-flop but last post-flop.

## 9. Future Scaling Considerations

Consistent with Section 9 of the original friends-app spec — not part of
this plan's build, kept in mind so a later pivot isn't a rewrite:

- If a real-time equity/odds calculator or bot opponent is ever built, it
  would call the evaluator far more often than "once per showdown," and
  *that* would be the actual profiling-backed reason to swap
  `holdemHandRank.ts`'s internals for a lookup-table evaluator like `phe`
  — not a reason to build one now (Section 4).
- Multi-hand table/session management (button rotation, seated players
  across many hands) is Plan 3's responsibility, not a gap in this plan.
