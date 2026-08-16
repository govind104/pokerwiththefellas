# Texas Hold'em Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully working, unit-tested Texas Hold'em rules engine — hand evaluation, betting legality, side-pot math, and a `HoldemHand` orchestrator that plays one complete hand — added to the existing `@poker-blackjack/game-engine` package.

**Architecture:** Four new pure-logic modules (`holdemHandRank.ts`, `holdemBetting.ts`, `holdemPots.ts`, `holdemHand.ts`) composed the same way Plan 1 composed Blackjack's modules into `BlackjackRound`. Reuses `deck.ts`'s `Card`/`createDeck`/`shuffle` unchanged. First runtime dependency in this package: `pokersolver` for hand evaluation and tie detection, fully contained behind `holdemHandRank.ts`.

**Tech Stack:** TypeScript 5.x, Vitest, npm workspaces (all existing). New dependency: `pokersolver` (MIT).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-16-holdem-engine-design.md`. Every task's requirements implicitly include it.
- This plan produces **no server, no UI, no AWS, no persistence** — pure logic only, run entirely by its test suite, same as Plan 1.
- `HoldemHand` plays exactly **one hand** (deal → blinds → 4 betting streets → showdown → settle). Table/session/button-rotation across multiple hands is explicitly out of scope (Plan 3's job).
- No-Limit betting. Up to 8 players. Heads-up (2 players) uses the special rule: button posts small blind, acts first pre-flop, acts last on every later street.
- No burn cards — flop/turn/river deal directly from the shuffled deck.
- All-in and side pots are first-class, not a special case: the standard layered side-pot algorithm (spec Section 6).
- Split pots divide evenly with fractional chips allowed, no odd-chip-to-the-left rule (matches Plan 1's `payout.ts` fractional policy).
- Illegal actions throw a descriptive `Error` — same convention as `BlackjackRound.act()`. Never silently clamp or no-op.
- `pokersolver` is fully contained behind `holdemHandRank.ts` — no other file imports it or knows its card-string format.
- No placeholders, no `any` types, no unimplemented branches. `pokersolver` has no shipped TypeScript types, so Task 1 adds a minimal, honest local declaration (`pokersolver.d.ts`) covering only the members actually used — not a blanket `any`.
- Any function that reveals a player's hole cards or the full result set must be documented (doc comment) with when it's safe for a future server to expose it to which clients — apply this from the start rather than as a later fix (Plan 1's final review had to add this after the fact for `getDealerCards()`; don't repeat that gap here).
- `RoundResult`-style payout semantics from Plan 1 apply: a result's `payout` is the complete net change to apply (`balance += payout`), already netting out the wager.

---

### Task 1: Hand evaluation (`holdemHandRank.ts`)

**Files:**
- Create: `packages/game-engine/src/pokersolver.d.ts`
- Create: `packages/game-engine/src/holdemHandRank.ts`
- Test: `packages/game-engine/src/holdemHandRank.test.ts`
- Modify: `packages/game-engine/package.json` (add `pokersolver` to `dependencies`)

**Interfaces:**
- Consumes: `Card`, `Rank`, `Suit` from `./deck`.
- Produces: `determineWinners(players: { playerId: string; holeCards: [Card, Card] }[], communityCards: Card[]): string[]` and `describeHand(holeCards: [Card, Card], communityCards: Card[]): { name: string; description: string }` — used by Task 7 (showdown/settlement) and exported from the package's `index.ts` in Task 8.

- [ ] **Step 1: Add the `pokersolver` dependency**

Edit `packages/game-engine/package.json`, adding a `dependencies` field (this package currently has none — only `devDependencies`):

```json
  "dependencies": {
    "pokersolver": "^2.1.4"
  },
```

Place it directly above the existing `devDependencies` key. Then run `npm install` from the repo root.

- [ ] **Step 2: Add a minimal local type declaration for `pokersolver`**

`packages/game-engine/src/pokersolver.d.ts`:

```ts
declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    rank: number;
  }
}
```

This declares only the members this codebase actually uses — not a blanket `any` escape hatch.

- [ ] **Step 3: Write the failing tests**

`packages/game-engine/src/holdemHandRank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { determineWinners, describeHand } from './holdemHandRank';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('determineWinners', () => {
  it('picks the player with the better hand (flush beats a pair)', () => {
    const community = [
      card('2', 'hearts'),
      card('9', 'hearts'),
      card('K', 'hearts'),
      card('4', 'clubs'),
      card('7', 'diamonds'),
    ];
    const players = [
      { playerId: 'a', holeCards: [card('A', 'hearts'), card('3', 'hearts')] as [Card, Card] }, // flush
      { playerId: 'b', holeCards: [card('4', 'spades'), card('4', 'diamonds')] as [Card, Card] }, // trip 4s
    ];
    expect(determineWinners(players, community)).toEqual(['a']);
  });

  it('recognizes a wheel straight (A-2-3-4-5) as a valid straight', () => {
    const community = [
      card('2', 'clubs'),
      card('3', 'diamonds'),
      card('4', 'hearts'),
      card('9', 'spades'),
      card('K', 'clubs'),
    ];
    const players = [
      { playerId: 'wheel', holeCards: [card('A', 'spades'), card('5', 'clubs')] as [Card, Card] }, // A2345 straight
      { playerId: 'pair', holeCards: [card('K', 'hearts'), card('9', 'hearts')] as [Card, Card] }, // two pair K/9
    ];
    expect(determineWinners(players, community)).toEqual(['wheel']);
  });

  it('breaks a full-house tie by the trips rank, not the pair', () => {
    const community = [
      card('7', 'clubs'),
      card('7', 'diamonds'),
      card('7', 'hearts'),
      card('2', 'spades'),
      card('2', 'clubs'),
    ];
    const players = [
      // both players play the board's 7s-full-of-2s trip+pair, kicker doesn't apply to a full house
      { playerId: 'a', holeCards: [card('9', 'spades'), card('8', 'clubs')] as [Card, Card] },
      { playerId: 'b', holeCards: [card('3', 'hearts'), card('4', 'diamonds')] as [Card, Card] },
    ];
    // Both hands are exactly "777 22" using only the board -- a genuine split pot.
    expect(determineWinners(players, community).sort()).toEqual(['a', 'b']);
  });

  it('returns a single winner when hands differ by kicker only', () => {
    const community = [
      card('K', 'clubs'),
      card('K', 'diamonds'),
      card('5', 'hearts'),
      card('8', 'spades'),
      card('2', 'clubs'),
    ];
    const players = [
      { playerId: 'higher', holeCards: [card('A', 'hearts'), card('3', 'diamonds')] as [Card, Card] }, // pair of Ks, A kicker
      { playerId: 'lower', holeCards: [card('Q', 'hearts'), card('4', 'diamonds')] as [Card, Card] }, // pair of Ks, Q kicker
    ];
    expect(determineWinners(players, community)).toEqual(['higher']);
  });
});

describe('describeHand', () => {
  it('describes a flush', () => {
    const community = [
      card('2', 'hearts'),
      card('9', 'hearts'),
      card('K', 'hearts'),
      card('4', 'clubs'),
      card('7', 'diamonds'),
    ];
    const result = describeHand([card('A', 'hearts'), card('3', 'hearts')], community);
    expect(result.name).toBe('Flush');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `holdemHandRank.ts` does not exist yet.

- [ ] **Step 5: Implement**

`packages/game-engine/src/holdemHandRank.ts`:

```ts
import { Hand } from 'pokersolver';
import { Card, Rank, Suit } from './deck';

const SUIT_CODES: Record<Suit, string> = {
  clubs: 'c',
  diamonds: 'd',
  hearts: 'h',
  spades: 's',
};

function rankCode(rank: Rank): string {
  return rank === '10' ? 'T' : rank;
}

function toPokersolverCard(card: Card): string {
  return `${rankCode(card.rank)}${SUIT_CODES[card.suit]}`;
}

export function determineWinners(
  players: { playerId: string; holeCards: [Card, Card] }[],
  communityCards: Card[]
): string[] {
  const solved = players.map((p) => ({
    playerId: p.playerId,
    hand: Hand.solve([...p.holeCards, ...communityCards].map(toPokersolverCard)),
  }));
  const winningHands = Hand.winners(solved.map((s) => s.hand));
  return solved.filter((s) => winningHands.includes(s.hand)).map((s) => s.playerId);
}

export function describeHand(
  holeCards: [Card, Card],
  communityCards: Card[]
): { name: string; description: string } {
  const hand = Hand.solve([...holeCards, ...communityCards].map(toPokersolverCard));
  return { name: hand.name, description: hand.descr };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS. If `Hand.winners`'s reference-equality assumption (used in the `.includes(s.hand)` filter above) doesn't hold against the real `pokersolver` package — i.e. the split-pot test fails while the others pass — inspect what `Hand.winners` actually returns (log it) and adjust the matching logic (e.g. compare by `.rank`/`.cards` instead of object identity) until the split-pot test passes too. Do not weaken the test to make it pass.

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/package.json packages/game-engine/package-lock.json packages/game-engine/src/pokersolver.d.ts packages/game-engine/src/holdemHandRank.ts packages/game-engine/src/holdemHandRank.test.ts
git commit -m "feat: add pokersolver-backed hand evaluation and winner detection"
```

---

### Task 2: Betting legality (`holdemBetting.ts`)

**Files:**
- Create: `packages/game-engine/src/holdemBetting.ts`
- Test: `packages/game-engine/src/holdemBetting.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from other new modules).
- Produces: `HoldemAction` type (`'fold' | 'check' | 'call' | 'raise' | 'all-in'`), `BettingContext` interface, `computeBettingContext(currentBet: number, lastRaiseSize: number, playerStreetContributed: number, playerStack: number): BettingContext`, `validateAction(context: BettingContext, action: HoldemAction, amount?: number): void` (throws on illegal, returns void on legal — call this before applying an action), `chipsToCommit(context: BettingContext, action: HoldemAction, amount?: number): number` (only valid to call after `validateAction` passes for the same context/action/amount — used by Task 5). All three functions are used by Tasks 5 and 6.

**Design note for the implementer:** there is no separate `'bet'` action — a `'raise'` with `amount` set to the player's target *total contribution for this street* covers opening a bet too (when `currentBet` is 0, `minRaiseTo` degenerates to `0 + lastRaiseSize`, and the caller is expected to have seeded `lastRaiseSize` with the big blind at the start of a fresh betting round — Task 4 handles that seeding). `amount` is always a total-to-reach, never an incremental add-on.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/holdemBetting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeBettingContext, validateAction, chipsToCommit } from './holdemBetting';

describe('computeBettingContext', () => {
  it('computes toCall and minRaiseTo from current bet and last raise size', () => {
    // Facing a bet of 20 (e.g. the big blind), last raise size 20 (the BB itself), already put in 10 (small blind).
    const context = computeBettingContext(20, 20, 10, 980);
    expect(context).toEqual({ toCall: 10, minRaiseTo: 40, playerStack: 980, playerStreetContributed: 10 });
  });

  it('computes a zero toCall when the player has already matched the current bet', () => {
    const context = computeBettingContext(20, 20, 20, 980);
    expect(context.toCall).toBe(0);
  });
});

describe('validateAction', () => {
  it('always allows folding', () => {
    const context = computeBettingContext(20, 20, 0, 100);
    expect(() => validateAction(context, 'fold')).not.toThrow();
  });

  it('allows checking when there is nothing to call', () => {
    const context = computeBettingContext(0, 20, 0, 100);
    expect(() => validateAction(context, 'check')).not.toThrow();
  });

  it('rejects checking while facing a bet', () => {
    const context = computeBettingContext(20, 20, 0, 100);
    expect(() => validateAction(context, 'check')).toThrow('Cannot check while facing a bet');
  });

  it('rejects calling when there is nothing to call', () => {
    const context = computeBettingContext(0, 20, 0, 100);
    expect(() => validateAction(context, 'call')).toThrow('Cannot call when there is nothing to call');
  });

  it('allows calling when the player can afford it', () => {
    const context = computeBettingContext(20, 20, 0, 100);
    expect(() => validateAction(context, 'call')).not.toThrow();
  });

  it('rejects calling when the player cannot afford a full call', () => {
    const context = computeBettingContext(100, 20, 0, 30);
    expect(() => validateAction(context, 'call')).toThrow('Not enough chips to call in full — go all-in instead');
  });

  it('rejects a raise below the minimum', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise', 30)).toThrow('Raise must be to at least 40');
  });

  it('allows a raise at or above the minimum', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise', 40)).not.toThrow();
    expect(() => validateAction(context, 'raise', 100)).not.toThrow();
  });

  it('rejects a raise with no amount given', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise')).toThrow('Raise requires an amount');
  });

  it('rejects a raise the player cannot afford', () => {
    const context = computeBettingContext(20, 20, 0, 35);
    expect(() => validateAction(context, 'raise', 40)).toThrow('Not enough chips for that raise — go all-in instead');
  });

  it('allows going all-in with a positive stack', () => {
    const context = computeBettingContext(100, 20, 0, 30);
    expect(() => validateAction(context, 'all-in')).not.toThrow();
  });

  it('rejects going all-in with no chips left', () => {
    const context = computeBettingContext(20, 20, 20, 0);
    expect(() => validateAction(context, 'all-in')).toThrow('No chips left to go all-in with');
  });
});

describe('chipsToCommit', () => {
  it('commits nothing for fold or check', () => {
    const context = computeBettingContext(0, 20, 0, 100);
    expect(chipsToCommit(context, 'fold')).toBe(0);
    expect(chipsToCommit(context, 'check')).toBe(0);
  });

  it('commits exactly toCall for a call', () => {
    const context = computeBettingContext(20, 20, 5, 100);
    expect(chipsToCommit(context, 'call')).toBe(15);
  });

  it('commits amount minus what was already in for a raise', () => {
    const context = computeBettingContext(20, 20, 5, 100);
    expect(chipsToCommit(context, 'raise', 60)).toBe(55);
  });

  it('commits the entire remaining stack for all-in', () => {
    const context = computeBettingContext(20, 20, 5, 47);
    expect(chipsToCommit(context, 'all-in')).toBe(47);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `holdemBetting.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/holdemBetting.ts`:

```ts
export type HoldemAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface BettingContext {
  toCall: number;
  minRaiseTo: number;
  playerStack: number;
  playerStreetContributed: number;
}

export function computeBettingContext(
  currentBet: number,
  lastRaiseSize: number,
  playerStreetContributed: number,
  playerStack: number
): BettingContext {
  return {
    toCall: currentBet - playerStreetContributed,
    minRaiseTo: currentBet + lastRaiseSize,
    playerStack,
    playerStreetContributed,
  };
}

export function validateAction(context: BettingContext, action: HoldemAction, amount?: number): void {
  switch (action) {
    case 'fold':
      return;
    case 'check':
      if (context.toCall !== 0) {
        throw new Error('Cannot check while facing a bet');
      }
      return;
    case 'call':
      if (context.toCall === 0) {
        throw new Error('Cannot call when there is nothing to call');
      }
      if (context.playerStack < context.toCall) {
        throw new Error('Not enough chips to call in full — go all-in instead');
      }
      return;
    case 'raise': {
      if (amount === undefined) {
        throw new Error('Raise requires an amount');
      }
      if (amount < context.minRaiseTo) {
        throw new Error(`Raise must be to at least ${context.minRaiseTo}`);
      }
      const additionalChipsNeeded = amount - context.playerStreetContributed;
      if (additionalChipsNeeded > context.playerStack) {
        throw new Error('Not enough chips for that raise — go all-in instead');
      }
      return;
    }
    case 'all-in':
      if (context.playerStack <= 0) {
        throw new Error('No chips left to go all-in with');
      }
      return;
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${exhaustiveCheck}`);
    }
  }
}

export function chipsToCommit(context: BettingContext, action: HoldemAction, amount?: number): number {
  switch (action) {
    case 'fold':
    case 'check':
      return 0;
    case 'call':
      return context.toCall;
    case 'raise':
      return (amount as number) - context.playerStreetContributed;
    case 'all-in':
      return context.playerStack;
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${exhaustiveCheck}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/holdemBetting.ts packages/game-engine/src/holdemBetting.test.ts
git commit -m "feat: add betting action legality and chip-commitment math"
```

---

### Task 3: Side pots (`holdemPots.ts`)

**Files:**
- Create: `packages/game-engine/src/holdemPots.ts`
- Test: `packages/game-engine/src/holdemPots.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from other new modules).
- Produces: `PlayerContribution` interface (`{ playerId: string; amount: number; folded: boolean }`), `Pot` interface (`{ amount: number; eligiblePlayerIds: string[] }`), `computePots(contributions: PlayerContribution[]): Pot[]` — used by Task 7 (showdown/settlement).

**Design note for the implementer:** `amount` is each player's **total** chips contributed to the pot across the whole hand (all streets summed), not a single street's contribution — Task 7 passes final, whole-hand totals. A folded player's chips still count toward pot *size* at every layer they reached, but they're never in `eligiblePlayerIds`. Layers where every contributor at that level folded (no eligible winner) are omitted from the result — defensive handling for a caller that violates the "only call this with 2+ non-folded players" expectation; `holdemHand.ts` (Task 6) never lets it happen because a hand ends immediately once only one player remains, before side pots ever get computed.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/holdemPots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePots } from './holdemPots';

describe('computePots', () => {
  it('creates a single pot when everyone contributed equally', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 300, eligiblePlayerIds: ['a', 'b', 'c'] }]);
  });

  it('builds a main pot plus two side pots for three uneven all-ins', () => {
    // Reference scenario: main pot 1200 (4x300), side pot 600 (3x200), side pot 800 (2x400).
    const pots = computePots([
      { playerId: 'p1', amount: 300, folded: false },
      { playerId: 'p2', amount: 500, folded: false },
      { playerId: 'p3', amount: 900, folded: false },
      { playerId: 'p4', amount: 900, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 1200, eligiblePlayerIds: ['p1', 'p2', 'p3', 'p4'] },
      { amount: 600, eligiblePlayerIds: ['p2', 'p3', 'p4'] },
      { amount: 800, eligiblePlayerIds: ['p3', 'p4'] },
    ]);
  });

  it('excludes a folded player from eligibility while still counting their chips toward pot size', () => {
    // P1 posts 100 then folds; P2 stays in for 100; P3 is all-in for 50.
    const pots = computePots([
      { playerId: 'p1', amount: 100, folded: true },
      { playerId: 'p2', amount: 100, folded: false },
      { playerId: 'p3', amount: 50, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligiblePlayerIds: ['p2', 'p3'] }, // layer 0-50, all 3 contributed, p1 excluded (folded)
      { amount: 100, eligiblePlayerIds: ['p2'] }, // layer 50-100, only p1 and p2 contributed, p1 excluded (folded)
    ]);
  });

  it('handles a four-way uneven all-in with one fold mixed in', () => {
    // p1 all-in 50 and stays; p2 contributes 200 then folds; p3 all-in 150 and stays; p4 contributes 200 and stays.
    const pots = computePots([
      { playerId: 'p1', amount: 50, folded: false },
      { playerId: 'p2', amount: 200, folded: true },
      { playerId: 'p3', amount: 150, folded: false },
      { playerId: 'p4', amount: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligiblePlayerIds: ['p1', 'p3', 'p4'] }, // layer 0-50, 4 contributors, p2 excluded
      { amount: 300, eligiblePlayerIds: ['p3', 'p4'] }, // layer 50-150, p1 drops out (only contributed 50), p2 excluded
      { amount: 100, eligiblePlayerIds: ['p4'] }, // layer 150-200, p3 drops out, p2 excluded
    ]);
  });

  it('ignores players who contributed nothing', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 0, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 200, eligiblePlayerIds: ['a', 'b'] }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `holdemPots.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/holdemPots.ts`:

```ts
export interface PlayerContribution {
  playerId: string;
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export function computePots(contributions: PlayerContribution[]): Pot[] {
  const levels = Array.from(new Set(contributions.map((c) => c.amount).filter((a) => a > 0))).sort(
    (a, b) => a - b
  );

  const pots: Pot[] = [];
  let previousLevel = 0;

  for (const level of levels) {
    const contributingPlayers = contributions.filter((c) => c.amount >= level);
    const eligiblePlayerIds = contributingPlayers.filter((c) => !c.folded).map((c) => c.playerId);

    if (eligiblePlayerIds.length > 0) {
      const amount = (level - previousLevel) * contributingPlayers.length;
      pots.push({ amount, eligiblePlayerIds });
    }

    previousLevel = level;
  }

  return pots;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/holdemPots.ts packages/game-engine/src/holdemPots.test.ts
git commit -m "feat: add layered side-pot calculation"
```

---

### Task 4: Hand setup — blinds and dealing (`holdemHand.ts`, part 1)

**Files:**
- Create: `packages/game-engine/src/holdemHand.ts`
- Test: `packages/game-engine/src/holdemHand.test.ts`

**Interfaces:**
- Consumes: `Card`, `RandomFn`, `createDeck`, `shuffle` from `./deck`.
- Produces: `HoldemPlayerInput` (`{ playerId: string; stack: number }`), `HoldemPlayerState` (`{ playerId: string; holeCards: [Card, Card]; stack: number; contributed: number; streetContributed: number; folded: boolean; isAllIn: boolean }`), `HoldemHandConfig` (`{ smallBlind: number; bigBlind: number; buttonIndex: number; random?: RandomFn; deck?: Card[] }`), `HoldemStreet` type (`'preflop' | 'flop' | 'turn' | 'river' | 'settled'`), and class `HoldemHand` with public fields `players: HoldemPlayerState[]`, `street: HoldemStreet`, `communityCards: Card[]`, `actingPlayerId: string | null`. Tasks 5, 6, and 7 build on this same class and these same field names — do not rename anything here.

**Design note for the implementer:** declare one more private field this task's constructor must set that isn't in the produces list above because later tasks — not this one — read it: `private bigBlindAmount: number` (set from `config.bigBlind`). Task 5 needs the original big blind value to reset the minimum-raise size at the start of each new betting street.

`HoldemHand.players[i].holeCards` holds the true hole cards for every player at all times — the engine always knows everything. **This is deliberate, matching Plan 1's pattern for `BlackjackRound`:** the engine holds ground truth; a future server decides what to reveal to which connected client. Add this exact doc comment above the `players` field:
```ts
/**
 * Ground truth for every player, including hole cards. A future server
 * must only reveal player[i].holeCards to that player individually until
 * `street === 'settled'`, at which point only players who did NOT fold
 * (i.e. reached showdown) may have their hole cards revealed to everyone.
 */
```

This task covers only construction: dealing hole cards, posting blinds (including the heads-up special case and the short-stack-posts-all-in-for-less case), and determining who acts first preflop. Betting (`act()`), street progression, and showdown are Tasks 5 and 6 — do not implement them yet, but do declare the private fields they'll need (`buttonIndex`, `currentBet`, `lastRaiseSize`, `actingIndex`, `playersToAct`) since this task's constructor sets their initial values.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/holdemHand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HoldemHand } from './holdemHand';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

// 8 cards is enough for 3 players' hole cards (6) plus 2 spare, ordered so
// dealing (2 cards per player, in player order) is easy to trace by hand.
function threeHandedDeck(): Card[] {
  return [
    card('2', 'clubs'), card('3', 'clubs'), // player 0's hole cards
    card('4', 'clubs'), card('5', 'clubs'), // player 1's hole cards
    card('6', 'clubs'), card('7', 'clubs'), // player 2's hole cards
    card('8', 'clubs'), card('9', 'clubs'),
  ];
}

describe('HoldemHand construction — 3+ handed', () => {
  it('deals two hole cards to each player in seat order', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[0].holeCards).toEqual([card('2', 'clubs'), card('3', 'clubs')]);
    expect(hand.players[1].holeCards).toEqual([card('4', 'clubs'), card('5', 'clubs')]);
    expect(hand.players[2].holeCards).toEqual([card('6', 'clubs'), card('7', 'clubs')]);
  });

  it('posts small blind at button+1 and big blind at button+2', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[0]).toMatchObject({ stack: 1000, streetContributed: 0, contributed: 0 });
    expect(hand.players[1]).toMatchObject({ stack: 990, streetContributed: 10, contributed: 10 });
    expect(hand.players[2]).toMatchObject({ stack: 980, streetContributed: 20, contributed: 20 });
  });

  it('sets first-to-act preflop to the player after the big blind (the button, in 3-handed)', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    // n=3, button=0, sb=1, bb=2, first-to-act = (bb+1)%3 = 0 = the button itself,
    // since there's nobody else left between BB and the button in 3-handed play.
    expect(hand.actingPlayerId).toBe('a');
  });

  it('lets a short-stacked player post a blind all-in for less', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 5 }, // posts small blind (10) but only has 5
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[1]).toMatchObject({ stack: 0, streetContributed: 5, contributed: 5, isAllIn: true });
  });

  it('rejects fewer than 2 or more than 8 players', () => {
    expect(
      () =>
        new HoldemHand([{ playerId: 'solo', stack: 1000 }], {
          smallBlind: 10,
          bigBlind: 20,
          buttonIndex: 0,
        })
    ).toThrow("Hold'em requires between 2 and 8 players");
  });

  it('rejects a buttonIndex out of range', () => {
    expect(
      () =>
        new HoldemHand(
          [
            { playerId: 'a', stack: 1000 },
            { playerId: 'b', stack: 1000 },
          ],
          { smallBlind: 10, bigBlind: 20, buttonIndex: 5 }
        )
    ).toThrow('buttonIndex out of range');
  });
});

describe('HoldemHand construction — heads-up', () => {
  function headsUpDeck(): Card[] {
    return [card('A', 'spades'), card('K', 'spades'), card('2', 'hearts'), card('3', 'hearts')];
  }

  it('makes the button post the small blind and the other player post the big blind', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 1000 },
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: headsUpDeck() }
    );
    expect(hand.players[0]).toMatchObject({ streetContributed: 10, contributed: 10 });
    expect(hand.players[1]).toMatchObject({ streetContributed: 20, contributed: 20 });
  });

  it('makes the button act first preflop', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 1000 },
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: headsUpDeck() }
    );
    expect(hand.actingPlayerId).toBe('button');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `holdemHand.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/holdemHand.ts`:

```ts
import { Card, RandomFn, createDeck, shuffle } from './deck';

export interface HoldemPlayerInput {
  playerId: string;
  stack: number;
}

export interface HoldemPlayerState {
  playerId: string;
  holeCards: [Card, Card];
  stack: number;
  contributed: number;
  streetContributed: number;
  folded: boolean;
  isAllIn: boolean;
}

export interface HoldemHandConfig {
  smallBlind: number;
  bigBlind: number;
  buttonIndex: number;
  random?: RandomFn;
  deck?: Card[];
}

export type HoldemStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'settled';

export class HoldemHand {
  /**
   * Ground truth for every player, including hole cards. A future server
   * must only reveal player[i].holeCards to that player individually until
   * `street === 'settled'`, at which point only players who did NOT fold
   * (i.e. reached showdown) may have their hole cards revealed to everyone.
   */
  players: HoldemPlayerState[];
  street: HoldemStreet = 'preflop';
  communityCards: Card[] = [];
  actingPlayerId: string | null = null;

  private deck: Card[];
  private buttonIndex: number;
  private bigBlindAmount: number;
  private currentBet = 0;
  private lastRaiseSize = 0;
  private actingIndex = 0;
  private playersToAct = new Set<number>();

  constructor(playersInput: HoldemPlayerInput[], config: HoldemHandConfig) {
    if (playersInput.length < 2 || playersInput.length > 8) {
      throw new Error("Hold'em requires between 2 and 8 players");
    }
    if (config.buttonIndex < 0 || config.buttonIndex >= playersInput.length) {
      throw new Error('buttonIndex out of range');
    }

    this.buttonIndex = config.buttonIndex;
    this.deck = config.deck ? [...config.deck] : shuffle(createDeck(), config.random ?? Math.random);

    this.players = playersInput.map((p) => ({
      playerId: p.playerId,
      holeCards: [this.draw(), this.draw()] as [Card, Card],
      stack: p.stack,
      contributed: 0,
      streetContributed: 0,
      folded: false,
      isAllIn: false,
    }));

    const headsUp = this.players.length === 2;
    const n = this.players.length;
    const smallBlindIndex = headsUp ? this.buttonIndex : (this.buttonIndex + 1) % n;
    const bigBlindIndex = headsUp ? (this.buttonIndex + 1) % 2 : (this.buttonIndex + 2) % n;

    this.postBlind(smallBlindIndex, config.smallBlind);
    this.postBlind(bigBlindIndex, config.bigBlind);

    this.bigBlindAmount = config.bigBlind;
    this.currentBet = config.bigBlind;
    this.lastRaiseSize = config.bigBlind;

    const firstToActIndex = headsUp ? this.buttonIndex : (bigBlindIndex + 1) % n;
    this.actingIndex = firstToActIndex;
    this.actingPlayerId = this.players[firstToActIndex].playerId;
    this.playersToAct = new Set(
      this.players.map((_, i) => i).filter((i) => !this.players[i].folded && !this.players[i].isAllIn)
    );
  }

  private draw(): Card {
    const drawn = this.deck.shift();
    if (!drawn) {
      throw new Error('Deck is empty');
    }
    return drawn;
  }

  private postBlind(index: number, amount: number): void {
    const player = this.players[index];
    const posted = Math.min(amount, player.stack);
    player.stack -= posted;
    player.streetContributed += posted;
    player.contributed += posted;
    if (posted < amount) {
      player.isAllIn = true;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/holdemHand.ts packages/game-engine/src/holdemHand.test.ts
git commit -m "feat: add HoldemHand construction, blinds, and dealing"
```

---

### Task 5: Betting, street progression, and settlement (`holdemHand.ts`, part 2)

**This is the highest-complexity task in this plan** — it implements the entire betting engine for `HoldemHand`: applying actions, detecting when a betting round closes, dealing the next street (or skipping straight to showdown when everyone left is all-in), detecting an uncontested fold-out win, and full showdown settlement via `holdemPots` and `holdemHandRank`. Give this task's self-review extra care (see Step 6).

**Files:**
- Modify: `packages/game-engine/src/holdemHand.ts` (adds `act()` and all its private helpers, plus `settleUncontested`/`settleShowdown`, plus two new public fields)
- Modify: `packages/game-engine/src/holdemHand.test.ts` (adds this task's tests to the existing file)

**Interfaces:**
- Consumes: `HoldemAction`, `computeBettingContext`, `validateAction`, `chipsToCommit` from `./holdemBetting`; `PlayerContribution`, `Pot`, `computePots` from `./holdemPots`; `determineWinners` from `./holdemHandRank`.
- Produces (added to the `HoldemHand` class from Task 4): two new public fields `pots: Pot[]` and `results: HoldemResult[]` (new exported interface `HoldemResult`: `{ playerId: string; payout: number }` — same net-change semantics as Plan 1's `RoundResult.payout`: `balance += payout`, already netting out the wager); `act(playerId: string, action: HoldemAction, amount?: number): void`. Used by Task 6's integration tests and, later, by the server (Plan 3).

**Design note for the implementer — read this before writing code, it resolves several things that would otherwise be ambiguous:**

1. **A betting round closes when `playersToAct` (a private `Set<number>` of player indices, from Task 4) becomes empty.** After applying an action: remove the acting player's index from the set. If the action caused `player.streetContributed` to exceed `this.currentBet` (a bet or raise — this covers `'raise'` and any `'all-in'` that ends up larger than the current bet, uniformly, without needing to branch on which action it was), that's a valid raise: update `currentBet`/`lastRaiseSize`, and **reopen** the round by resetting `playersToAct` to every other player who is still active (not folded, not all-in) — even if the raise was an all-in for less than a full minimum raise. Real tournament poker has a narrower "incomplete raise doesn't fully reopen action" rule; this MVP deliberately simplifies to "any raise reopens action for everyone still able to act," documented here as a conscious choice, same spirit as skipping burn cards.
2. **Check fold-out (only one non-folded player left) before checking whether the betting round closed.** A fold can trigger either or both; fold-out takes priority — if only one player remains, the hand ends immediately via `settleUncontested()`, regardless of `playersToAct`.
3. **When a street's betting round closes, deal the next street automatically** (`advanceStreet()` → `dealStreet()`): reset every player's `streetContributed` to 0, reset `currentBet` to 0, reset `lastRaiseSize` to `this.bigBlindAmount` (the postflop minimum-bet size), and start a fresh `playersToAct` from whoever is still active and not all-in. First-to-act postflop is `firstActiveAfter(this.buttonIndex)` — this formula is correct for **both** heads-up and 3+-handed without branching (trace it: in heads-up it always resolves to the non-button player; in 3+-handed it resolves to the first active player after the button, typically the small blind seat).
4. **If, after dealing a new street, fewer than 2 active players are not all-in, no betting is possible on this or any later street** — recursively call `advanceStreet()` again to deal straight through to the river and then showdown, rather than offering a betting round nobody can meaningfully act in.
5. **`settleUncontested(winnerPlayerId)`** (fold-out path, no hand comparison needed): the sole remaining player gets `totalPot - theirOwnContribution` as `payout`; every other player's `payout` is `-theirOwnContribution`. Populate `this.pots` too, as a single pot for API consistency: `[{ amount: totalPot, eligiblePlayerIds: [winnerPlayerId] }]`.
6. **`settleShowdown()`** (reached the river with 2+ players): build `PlayerContribution[]` from every player's total `contributed` and `folded` status, pass to `computePots()`, then for each returned pot call `determineWinners()` with just that pot's eligible players' hole cards plus `this.communityCards`, split the pot amount evenly among the returned winner(s), and accumulate into each player's net `payout` (starting every player's running total at `-contributed`, since `computePots`'s pot amounts sum to exactly the total contributed — the accumulation nets out to a correct zero-sum result the same way Task 6 of Plan 1's Blackjack payout math did).

- [ ] **Step 1: Write the failing tests**

Add to `packages/game-engine/src/holdemHand.test.ts` (same `card()` helper already defined there; add these as new top-level `describe` blocks in the same file):

```ts
describe('HoldemHand.act — betting rounds', () => {
  function threeHandedDeckWithFlop(): Card[] {
    return [
      card('2', 'clubs'), card('3', 'clubs'),
      card('4', 'clubs'), card('5', 'clubs'),
      card('6', 'clubs'), card('7', 'clubs'),
      card('8', 'clubs'), card('9', 'clubs'), card('10', 'clubs'), // flop
    ];
  }

  it('advances to the flop once everyone calls the big blind', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'call'); // button calls the BB
    hand.act('b', 'call'); // SB completes
    hand.act('c', 'check'); // BB checks, closing the round

    expect(hand.street).toBe('flop');
    expect(hand.communityCards).toEqual([card('8', 'clubs'), card('9', 'clubs'), card('10', 'clubs')]);
    expect(hand.actingPlayerId).toBe('b'); // first active player after the button, postflop
    for (const p of hand.players) {
      expect(p.streetContributed).toBe(0);
      expect(p.contributed).toBe(20);
    }
  });

  it('reopens action for players who already acted when a later player raises', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'raise', 60);
    hand.act('b', 'fold');
    hand.act('c', 'call');

    expect(hand.street).toBe('flop');
    expect(hand.players[0]).toMatchObject({ contributed: 60, streetContributed: 0 });
    expect(hand.players[1]).toMatchObject({ contributed: 10, folded: true });
    expect(hand.players[2]).toMatchObject({ contributed: 60, streetContributed: 0 });
  });

  it('ends the hand immediately when only one player remains, without dealing the flop', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'raise', 60);
    hand.act('b', 'fold');
    hand.act('c', 'fold');

    expect(hand.street).toBe('settled');
    expect(hand.communityCards).toEqual([]);
    expect(hand.actingPlayerId).toBeNull();
    expect(hand.results).toEqual([
      { playerId: 'a', payout: 30 }, // wins the 90-chip pot, having put in 60 of it
      { playerId: 'b', payout: -10 },
      { playerId: 'c', payout: -20 },
    ]);
    expect(hand.pots).toEqual([{ amount: 90, eligiblePlayerIds: ['a'] }]);
  });

  it('rejects an action from a player who is not up', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    expect(() => hand.act('b', 'call')).toThrow("It is not b's turn to act");
  });

  it('rejects checking while facing a bet, and raising below the minimum', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    expect(() => hand.act('a', 'check')).toThrow('Cannot check while facing a bet');
    expect(() => hand.act('a', 'raise', 30)).toThrow('Raise must be to at least 40');
  });

  it('rejects acting after the hand has settled', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'raise', 60);
    hand.act('b', 'fold');
    hand.act('c', 'fold');
    expect(() => hand.act('a', 'check')).toThrow('Cannot act after the hand has settled');
  });
});

describe('HoldemHand.act — all-in runout', () => {
  it('deals every remaining street with no further betting once both players are all-in, and conserves chips', () => {
    // Enough cards for 2 hole-card pairs + 5 community cards.
    const deck: Card[] = [
      card('2', 'clubs'), card('3', 'clubs'),
      card('9', 'hearts'), card('9', 'spades'),
      card('4', 'diamonds'), card('5', 'diamonds'), card('6', 'diamonds'), // flop
      card('7', 'diamonds'), // turn
      card('8', 'diamonds'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 100 }, // button/SB, short stack
        { playerId: 'b', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );
    hand.act('a', 'all-in'); // shoves the rest of their stack (90 more, on top of the 10 SB)
    hand.act('b', 'call');

    expect(hand.street).toBe('settled');
    expect(hand.communityCards).toHaveLength(5);
    expect(hand.results).toHaveLength(2);
    const totalPayout = hand.results.reduce((sum, r) => sum + r.payout, 0);
    expect(totalPayout).toBe(0); // chips are conserved -- nothing created or destroyed
    expect(hand.players[0].stack).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `act()` does not exist yet.

- [ ] **Step 3: Implement**

Add these imports to the top of `packages/game-engine/src/holdemHand.ts` (alongside the existing `deck.ts` import):

```ts
import {
  HoldemAction,
  computeBettingContext,
  validateAction,
  chipsToCommit,
} from './holdemBetting';
import { PlayerContribution, Pot, computePots } from './holdemPots';
import { determineWinners } from './holdemHandRank';
```

Add this new exported interface near the top of the file, alongside the existing ones:

```ts
export interface HoldemResult {
  playerId: string;
  payout: number;
}
```

Add two new public fields to the `HoldemHand` class, alongside the existing ones (`players`, `street`, `communityCards`, `actingPlayerId`):

```ts
  pots: Pot[] = [];
  results: HoldemResult[] = [];
```

Add these methods to the `HoldemHand` class (after the constructor and the existing private `draw`/`postBlind` methods):

```ts
  act(playerId: string, action: HoldemAction, amount?: number): void {
    if (this.street === 'settled') {
      throw new Error('Cannot act after the hand has settled');
    }
    if (this.actingPlayerId !== playerId) {
      throw new Error(`It is not ${playerId}'s turn to act`);
    }

    const index = this.actingIndex;
    const player = this.players[index];

    const context = computeBettingContext(
      this.currentBet,
      this.lastRaiseSize,
      player.streetContributed,
      player.stack
    );
    validateAction(context, action, amount);
    const chips = chipsToCommit(context, action, amount);

    player.stack -= chips;
    player.streetContributed += chips;
    player.contributed += chips;

    if (action === 'fold') {
      player.folded = true;
    }
    if (action === 'all-in') {
      player.isAllIn = true;
    }

    this.playersToAct.delete(index);

    if (player.streetContributed > this.currentBet) {
      this.lastRaiseSize = player.streetContributed - this.currentBet;
      this.currentBet = player.streetContributed;
      this.playersToAct = new Set(
        this.players
          .map((_, i) => i)
          .filter((i) => i !== index && !this.players[i].folded && !this.players[i].isAllIn)
      );
    }

    const remainingPlayers = this.players.filter((p) => !p.folded);
    if (remainingPlayers.length === 1) {
      this.settleUncontested(remainingPlayers[0].playerId);
      return;
    }

    if (this.playersToAct.size === 0) {
      this.advanceStreet();
      return;
    }

    this.actingIndex = this.nextActingIndex(index);
    this.actingPlayerId = this.players[this.actingIndex].playerId;
  }

  private nextActingIndex(fromIndex: number): number {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const candidate = (fromIndex + step) % n;
      if (this.playersToAct.has(candidate)) {
        return candidate;
      }
    }
    throw new Error('No players left to act');
  }

  private firstActiveAfter(index: number): number {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const candidate = (index + step) % n;
      if (!this.players[candidate].folded) {
        return candidate;
      }
    }
    throw new Error('No active players remain');
  }

  private advanceStreet(): void {
    if (this.street === 'preflop') {
      this.dealStreet('flop', 3);
    } else if (this.street === 'flop') {
      this.dealStreet('turn', 1);
    } else if (this.street === 'turn') {
      this.dealStreet('river', 1);
    } else if (this.street === 'river') {
      this.settleShowdown();
    }
  }

  private dealStreet(next: HoldemStreet, cardCount: number): void {
    this.street = next;
    for (let i = 0; i < cardCount; i++) {
      this.communityCards.push(this.draw());
    }

    for (const p of this.players) {
      p.streetContributed = 0;
    }
    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlindAmount;

    const activeNonAllIn = this.players
      .map((_, i) => i)
      .filter((i) => !this.players[i].folded && !this.players[i].isAllIn);

    if (activeNonAllIn.length <= 1) {
      this.advanceStreet();
      return;
    }

    this.playersToAct = new Set(activeNonAllIn);
    this.actingIndex = this.firstActiveAfter(this.buttonIndex);
    this.actingPlayerId = this.players[this.actingIndex].playerId;
  }

  private settleUncontested(winnerPlayerId: string): void {
    this.street = 'settled';
    this.actingPlayerId = null;

    const totalPot = this.players.reduce((sum, p) => sum + p.contributed, 0);
    this.results = this.players.map((p) => ({
      playerId: p.playerId,
      payout: p.playerId === winnerPlayerId ? totalPot - p.contributed : -p.contributed,
    }));
    this.pots = [{ amount: totalPot, eligiblePlayerIds: [winnerPlayerId] }];
  }

  private settleShowdown(): void {
    this.street = 'settled';
    this.actingPlayerId = null;

    const contributions: PlayerContribution[] = this.players.map((p) => ({
      playerId: p.playerId,
      amount: p.contributed,
      folded: p.folded,
    }));
    this.pots = computePots(contributions);

    const netChange = new Map<string, number>(this.players.map((p) => [p.playerId, -p.contributed]));

    for (const pot of this.pots) {
      const eligiblePlayers = this.players.filter((p) => pot.eligiblePlayerIds.includes(p.playerId));
      const winnerIds = determineWinners(
        eligiblePlayers.map((p) => ({ playerId: p.playerId, holeCards: p.holeCards })),
        this.communityCards
      );
      const share = pot.amount / winnerIds.length;
      for (const winnerId of winnerIds) {
        netChange.set(winnerId, (netChange.get(winnerId) ?? 0) + share);
      }
    }

    this.results = this.players.map((p) => ({ playerId: p.playerId, payout: netChange.get(p.playerId) ?? 0 }));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/holdemHand.ts packages/game-engine/src/holdemHand.test.ts
git commit -m "feat: add betting, street progression, and settlement to HoldemHand"
```

- [ ] **Step 6: Extra self-review for this task specifically**

Before reporting this task done, trace at least these two things by hand against your own code (not just "the tests passed"):
1. The reopen-action scenario: after a raise, confirm `playersToAct` contains exactly the players who now owe a response, and does NOT contain the raiser themselves or anyone folded/all-in.
2. The all-in runout: confirm `dealStreet` really does recurse all the way to the river without ever setting `actingPlayerId` to a stale value along the way (it should end up `null`, set by whichever `settleUncontested`/`settleShowdown` call actually terminates the recursion).

---

### Task 6: Public API and full-hand integration test

**Files:**
- Modify: `packages/game-engine/src/index.ts`
- Modify: `packages/game-engine/src/holdemHand.test.ts` (adds this task's test to the existing file)

**Interfaces:**
- Consumes: everything produced by Tasks 1–5.
- Produces: nothing new — this task only wires existing pieces into the package's public export surface and proves the whole engine works together end-to-end.

**Design note for the implementer:** the spec's testing strategy calls for four end-to-end scenarios: a full showdown, an everyone-folds-preflop early win, an all-in-preflop runout, and heads-up action-order verification. Tasks 4 and 5's tests already cover the fold-out win (Task 5, "ends the hand immediately when only one player remains") and the all-in runout (Task 5, "deals every remaining street with no further betting"). This task adds the one still missing — a genuine showdown reached by normal check/call action through all four streets — and folds heads-up action-order verification into the same test by asserting `actingPlayerId` at each street transition, rather than writing a second, redundant test.

- [ ] **Step 1: Write the failing test**

Add to `packages/game-engine/src/holdemHand.test.ts`:

```ts
describe('HoldemHand — full showdown (heads-up)', () => {
  it('checks through every street to a showdown and pays the better hand, verifying button acts first preflop but last postflop', () => {
    const deck: Card[] = [
      card('A', 'spades'), card('2', 'clubs'), // player 0 (button/SB) hole cards
      card('K', 'hearts'), card('3', 'diamonds'), // player 1 (BB) hole cards
      card('A', 'clubs'), card('K', 'clubs'), card('7', 'hearts'), // flop
      card('8', 'spades'), // turn
      card('9', 'diamonds'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 1000 },
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );

    expect(hand.actingPlayerId).toBe('button'); // preflop: button acts first
    hand.act('button', 'call');
    hand.act('other', 'check');

    expect(hand.street).toBe('flop');
    expect(hand.actingPlayerId).toBe('other'); // postflop: button acts last
    hand.act('other', 'check');
    hand.act('button', 'check');

    expect(hand.street).toBe('turn');
    expect(hand.actingPlayerId).toBe('other');
    hand.act('other', 'check');
    hand.act('button', 'check');

    expect(hand.street).toBe('river');
    expect(hand.actingPlayerId).toBe('other');
    hand.act('other', 'check');
    hand.act('button', 'check');

    // Board: A K 7 8 9. Button plays A-A (pair of aces, K-9-8 kickers) using
    // hole A + board A. Other plays K-K (pair of kings, A-9-8 kickers) using
    // hole K + board K. Pair of aces beats pair of kings outright.
    expect(hand.street).toBe('settled');
    expect(hand.results).toEqual([
      { playerId: 'button', payout: 20 },
      { playerId: 'other', payout: -20 },
    ]);
    expect(hand.pots).toEqual([{ amount: 40, eligiblePlayerIds: ['button', 'other'] }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `index.ts` doesn't yet export `HoldemHand`, or (if the test is written to import directly from `./holdemHand` instead) the test itself may already pass since Task 5 finished the class. Either way, run it now to confirm the actual failure mode before moving on — don't assume.

- [ ] **Step 3: Implement**

Add to `packages/game-engine/src/index.ts` (keep every existing export — this only adds to the file):

```ts
export { HoldemHand } from './holdemHand';
export type {
  HoldemPlayerInput,
  HoldemPlayerState,
  HoldemHandConfig,
  HoldemStreet,
  HoldemResult,
} from './holdemHand';
export type { HoldemAction } from './holdemBetting';
export type { Pot, PlayerContribution } from './holdemPots';
export { determineWinners, describeHand } from './holdemHandRank';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — the full suite passes, including every test from Tasks 1–6.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck --workspace=packages/game-engine` (this script was added in Plan 1's final review — if it's missing, add `"typecheck": "tsc --noEmit"` to `packages/game-engine/package.json`'s scripts first).
Expected: clean, zero errors. Fix any type errors found before proceeding — don't silence them with `any`.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/index.ts packages/game-engine/src/holdemHand.test.ts
git commit -m "feat: export Hold'em public API and add full-showdown integration test"
```

---

## What's next (not part of this plan)

Per the project's 6-plan roadmap (see the Blackjack engine plan's own "What's next" section), this is Plan 2 of 6. After this plan merges:

3. **Local real-time server** — Socket.IO server wiring both `BlackjackRound` and `HoldemHand` to WebSocket clients, plus a local persistence adapter.
4. **Frontend** — React lobby + table UI for both games.
5. **Accounts & blacklisting** — Google OAuth, allowlist, admin/blacklist enforcement.
6. **AWS deployment** — only once 1–5 work end-to-end locally.
