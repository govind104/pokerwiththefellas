# Blackjack Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully working, unit-tested Blackjack rules engine (deck/shoe, hand values, dealer logic, betting outcomes, and a round orchestrator) as a standalone TypeScript package with zero networking or UI — playable via tests today, and the exact dependency the future server plan wires up to real players.

**Architecture:** A pure-logic npm workspace package (`@poker-blackjack/game-engine`). Every function is a plain, synchronous, side-effect-free transformation of data (except the top-level `BlackjackRound` class, which holds in-memory round state and is the package's public API). No I/O, no framework — this is what makes it unit-testable without a server and reusable unchanged by both the local dev server and the eventual AWS-hosted server.

**Tech Stack:** TypeScript 5.x, Vitest (test runner), npm workspaces. Node.js 20+.

## Global Constraints

- This is Plan 1 of a multi-plan sequence for the friends Poker/Blackjack app (see spec: `docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md`). Per that spec's direction to build locally before deploying to AWS, this plan produces **no server, no UI, no AWS dependency of any kind** — just the engine, run entirely by its test suite.
- Blackjack rules per spec Section 3: 6-deck shoe reshuffled every hand; dealer stands on all 17s (hard and soft); blackjack pays 3:2; double-down allowed on any first two cards; split allowed once per hand with double-after-split allowed; no insurance or other side bets.
- All randomness (shuffling) must be injectable, not hardcoded to `Math.random`, so tests are deterministic.
- No placeholders, no `any` types, no unimplemented branches — every function must be complete and correct for the MVP rule set.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json` (repo root)
- Create: `packages/game-engine/package.json`
- Create: `packages/game-engine/tsconfig.json`
- Create: `packages/game-engine/vitest.config.ts`
- Create: `packages/game-engine/src/index.ts`
- Test: `packages/game-engine/src/index.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working `npm test` command in `packages/game-engine`, and the `@poker-blackjack/game-engine` package that later tasks add code to.

- [ ] **Step 1: Create the root workspace `package.json`**

```json
{
  "name": "poker-blackjack-friends-app",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create the `game-engine` package files**

`packages/game-engine/package.json`:

```json
{
  "name": "@poker-blackjack/game-engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/game-engine/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/game-engine/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

`packages/game-engine/src/index.ts`:

```ts
export {};
```

- [ ] **Step 3: Install dependencies**

Run: `npm install` (from the repo root)
Expected: installs successfully, creates `node_modules` and `package-lock.json` at the root.

- [ ] **Step 4: Write a smoke test**

`packages/game-engine/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain smoke test', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test to confirm the toolchain works**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/game-engine
git commit -m "chore: scaffold game-engine workspace with vitest"
```

---

### Task 2: Card and deck primitives

**Files:**
- Create: `packages/game-engine/src/deck.ts`
- Test: `packages/game-engine/src/deck.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Suit`, `Rank`, `Card` types; `RandomFn` type; `createDeck(): Card[]`; `shuffle(cards: Card[], random?: RandomFn): Card[]` — used by every later task in this plan.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/deck.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDeck, shuffle } from './deck';

describe('createDeck', () => {
  it('creates 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map((c) => `${c.rank}-${c.suit}`));
    expect(unique.size).toBe(52);
  });
});

describe('shuffle', () => {
  it('preserves all cards, only reorders them', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, () => 0.5);
    expect(shuffled).toHaveLength(52);
    const originalKeys = deck.map((c) => `${c.rank}-${c.suit}`).sort();
    const shuffledKeys = shuffled.map((c) => `${c.rank}-${c.suit}`).sort();
    expect(shuffledKeys).toEqual(originalKeys);
  });

  it('is deterministic given a fixed random function', () => {
    const deck = createDeck();
    let seed = 0;
    const fixedRandom = () => {
      seed = (seed + 0.137) % 1;
      return seed;
    };
    seed = 0;
    const shuffledA = shuffle(deck, fixedRandom);
    seed = 0;
    const shuffledB = shuffle(deck, fixedRandom);
    expect(shuffledA).toEqual(shuffledB);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `deck.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/deck.ts`:

```ts
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
}

const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

// Injectable so tests are deterministic and so a future provably-fair
// shuffle (see spec Section 9) can swap in a seeded generator later
// without touching any calling code.
export type RandomFn = () => number;

export function shuffle(cards: Card[], random: RandomFn = Math.random): Card[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/deck.ts packages/game-engine/src/deck.test.ts
git commit -m "feat: add card/deck primitives with injectable shuffle"
```

---

### Task 3: Multi-deck shoe

**Files:**
- Create: `packages/game-engine/src/shoe.ts`
- Test: `packages/game-engine/src/shoe.test.ts`

**Interfaces:**
- Consumes: `Card`, `RandomFn`, `createDeck`, `shuffle` from `./deck`.
- Produces: `createShoe(deckCount: number, random?: RandomFn): Card[]` — used by Task 8's `BlackjackRound`.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/shoe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createShoe } from './shoe';

describe('createShoe', () => {
  it('creates a shoe with deckCount * 52 cards', () => {
    const shoe = createShoe(6, () => 0.5);
    expect(shoe).toHaveLength(6 * 52);
  });

  it('contains exactly deckCount copies of each card', () => {
    const shoe = createShoe(6, () => 0.42);
    const counts = new Map<string, number>();
    for (const card of shoe) {
      const key = `${card.rank}-${card.suit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    for (const count of counts.values()) {
      expect(count).toBe(6);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `shoe.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/shoe.ts`:

```ts
import { Card, RandomFn, createDeck, shuffle } from './deck';

export function createShoe(deckCount: number, random: RandomFn = Math.random): Card[] {
  let cards: Card[] = [];
  for (let i = 0; i < deckCount; i++) {
    cards = cards.concat(createDeck());
  }
  return shuffle(cards, random);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/shoe.ts packages/game-engine/src/shoe.test.ts
git commit -m "feat: add multi-deck shoe"
```

---

### Task 4: Hand value calculation

**Files:**
- Create: `packages/game-engine/src/handValue.ts`
- Test: `packages/game-engine/src/handValue.test.ts`

**Interfaces:**
- Consumes: `Card`, `Rank` from `./deck`.
- Produces: `cardValue(rank: Rank): number`, `handValue(cards: Card[]): { total: number; isSoft: boolean }`, `isBlackjack(cards: Card[]): boolean`, `isBust(cards: Card[]): boolean` — used by Tasks 5, 6, 7, 8.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/handValue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handValue, isBlackjack, isBust } from './handValue';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('handValue', () => {
  it('sums a hard hand with no aces', () => {
    expect(handValue([card('10'), card('7')])).toEqual({ total: 17, isSoft: false });
  });

  it('treats a single ace as 11 when it fits', () => {
    expect(handValue([card('A'), card('6')])).toEqual({ total: 17, isSoft: true });
  });

  it('drops an ace to 1 when 11 would bust the hand', () => {
    expect(handValue([card('A'), card('6'), card('9')])).toEqual({ total: 16, isSoft: false });
  });

  it('handles two aces correctly', () => {
    expect(handValue([card('A'), card('A'), card('9')])).toEqual({ total: 21, isSoft: true });
  });
});

describe('isBlackjack', () => {
  it('is true for an ace + ten-value card as the starting two cards', () => {
    expect(isBlackjack([card('A'), card('K')])).toBe(true);
  });

  it('is false for 21 made with more than two cards', () => {
    expect(isBlackjack([card('7'), card('7'), card('7')])).toBe(false);
  });
});

describe('isBust', () => {
  it('is true when total exceeds 21', () => {
    expect(isBust([card('K'), card('Q'), card('5')])).toBe(true);
  });

  it('is false at 21 or under', () => {
    expect(isBust([card('K'), card('Q')])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `handValue.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/handValue.ts`:

```ts
import { Card, Rank } from './deck';

export interface HandValue {
  total: number;
  isSoft: boolean;
}

export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export function handValue(cards: Card[]): HandValue {
  let total = cards.reduce((sum, c) => sum + cardValue(c.rank), 0);
  let aceCount = cards.filter((c) => c.rank === 'A').length;

  let isSoft = aceCount > 0;
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }
  if (aceCount === 0) {
    isSoft = false;
  }

  return { total, isSoft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/handValue.ts packages/game-engine/src/handValue.test.ts
git commit -m "feat: add hand value, blackjack, and bust calculations"
```

---

### Task 5: Dealer play logic

**Files:**
- Create: `packages/game-engine/src/dealer.ts`
- Test: `packages/game-engine/src/dealer.test.ts`

**Interfaces:**
- Consumes: `Card` from `./deck`; `handValue` from `./handValue`.
- Produces: `dealerShouldHit(dealerCards: Card[]): boolean` — used by Task 8.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/dealer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dealerShouldHit } from './dealer';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('dealerShouldHit', () => {
  it('hits below 17', () => {
    expect(dealerShouldHit([card('9'), card('6')])).toBe(true);
  });

  it('stands on a hard 17', () => {
    expect(dealerShouldHit([card('10'), card('7')])).toBe(false);
  });

  it('stands on a soft 17', () => {
    expect(dealerShouldHit([card('A'), card('6')])).toBe(false);
  });

  it('stands above 17', () => {
    expect(dealerShouldHit([card('10'), card('9')])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `dealer.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/dealer.ts`:

```ts
import { Card } from './deck';
import { handValue } from './handValue';

// Spec Section 3: dealer stands on all 17s, hard and soft — calling this
// out explicitly because a soft-17-hits ruleset is common elsewhere and
// changes the house edge; this MVP always stands.
export function dealerShouldHit(dealerCards: Card[]): boolean {
  return handValue(dealerCards).total < 17;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/dealer.ts packages/game-engine/src/dealer.test.ts
git commit -m "feat: add dealer stand/hit logic"
```

---

### Task 6: Round payout resolution

**Files:**
- Create: `packages/game-engine/src/payout.ts`
- Test: `packages/game-engine/src/payout.test.ts`

**Interfaces:**
- Consumes: `Card` from `./deck`; `handValue`, `isBlackjack`, `isBust` from `./handValue`.
- Produces: `Outcome` type, `RoundResult` interface, `resolveHand(playerCards: Card[], dealerCards: Card[], bet: number): RoundResult` — used by Task 8. `payout` is the net chip change (not counting the returned original bet): positive on a win, negative on a loss, `0` on a push.

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/payout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveHand } from './payout';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('resolveHand', () => {
  it('pays 3:2 for a player blackjack against a non-blackjack dealer', () => {
    expect(resolveHand([card('A'), card('K')], [card('9'), card('8')], 100)).toEqual({
      outcome: 'blackjack',
      payout: 150,
    });
  });

  it('pushes when both player and dealer have blackjack', () => {
    expect(resolveHand([card('A'), card('K')], [card('A'), card('Q')], 100)).toEqual({
      outcome: 'push',
      payout: 0,
    });
  });

  it('player loses to a dealer blackjack', () => {
    expect(resolveHand([card('9'), card('8')], [card('A'), card('Q')], 100)).toEqual({
      outcome: 'lose',
      payout: -100,
    });
  });

  it('player busts regardless of dealer hand', () => {
    expect(resolveHand([card('K'), card('Q'), card('5')], [card('9'), card('8')], 100)).toEqual({
      outcome: 'bust',
      payout: -100,
    });
  });

  it('player wins when dealer busts and player did not', () => {
    expect(resolveHand([card('9'), card('8')], [card('K'), card('Q'), card('5')], 100)).toEqual({
      outcome: 'win',
      payout: 100,
    });
  });

  it('player wins with a higher total than the dealer', () => {
    expect(resolveHand([card('10'), card('9')], [card('10'), card('7')], 100)).toEqual({
      outcome: 'win',
      payout: 100,
    });
  });

  it('player loses with a lower total than the dealer', () => {
    expect(resolveHand([card('10'), card('7')], [card('10'), card('9')], 100)).toEqual({
      outcome: 'lose',
      payout: -100,
    });
  });

  it('pushes on equal totals', () => {
    expect(resolveHand([card('10'), card('8')], [card('9'), card('9')], 100)).toEqual({
      outcome: 'push',
      payout: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `payout.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/payout.ts`:

```ts
import { Card } from './deck';
import { handValue, isBlackjack, isBust } from './handValue';

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface RoundResult {
  outcome: Outcome;
  payout: number;
}

export function resolveHand(playerCards: Card[], dealerCards: Card[], bet: number): RoundResult {
  if (isBust(playerCards)) {
    return { outcome: 'bust', payout: -bet };
  }

  const playerBlackjack = isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);

  if (playerBlackjack && dealerBlackjack) {
    return { outcome: 'push', payout: 0 };
  }
  if (playerBlackjack) {
    return { outcome: 'blackjack', payout: bet * 1.5 };
  }
  if (dealerBlackjack) {
    return { outcome: 'lose', payout: -bet };
  }
  if (isBust(dealerCards)) {
    return { outcome: 'win', payout: bet };
  }

  const playerTotal = handValue(playerCards).total;
  const dealerTotal = handValue(dealerCards).total;

  if (playerTotal > dealerTotal) {
    return { outcome: 'win', payout: bet };
  }
  if (playerTotal < dealerTotal) {
    return { outcome: 'lose', payout: -bet };
  }
  return { outcome: 'push', payout: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/payout.ts packages/game-engine/src/payout.test.ts
git commit -m "feat: add round payout resolution"
```

---

### Task 7: Split eligibility

**Files:**
- Create: `packages/game-engine/src/split.ts`
- Test: `packages/game-engine/src/split.test.ts`

**Interfaces:**
- Consumes: `Card` from `./deck`; `cardValue` from `./handValue`.
- Produces: `canSplit(cards: Card[]): boolean` — used by Task 8. Two cards are splittable if they're exactly two cards of equal blackjack value (so e.g. K + 10 is splittable, matching common casino rules — not exact-rank-only).

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/split.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canSplit } from './split';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('canSplit', () => {
  it('allows splitting a matching pair', () => {
    expect(canSplit([card('8'), card('8', 'hearts')])).toBe(true);
  });

  it('allows splitting two different ten-value cards', () => {
    expect(canSplit([card('K'), card('10', 'hearts')])).toBe(true);
  });

  it('rejects a non-matching hand', () => {
    expect(canSplit([card('8'), card('9')])).toBe(false);
  });

  it('rejects hands that already have more than two cards', () => {
    expect(canSplit([card('8'), card('8', 'hearts'), card('2')])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `split.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/split.ts`:

```ts
import { Card } from './deck';
import { cardValue } from './handValue';

export function canSplit(cards: Card[]): boolean {
  return cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/split.ts packages/game-engine/src/split.test.ts
git commit -m "feat: add split eligibility check"
```

---

### Task 8: Round orchestration (`BlackjackRound`)

**Files:**
- Create: `packages/game-engine/src/blackjackRound.ts`
- Test: `packages/game-engine/src/blackjackRound.test.ts`
- Modify: `packages/game-engine/src/index.ts`

**Interfaces:**
- Consumes: `Card`, `RandomFn` from `./deck`; `createShoe` from `./shoe`; `handValue`, `isBust` from `./handValue`; `canSplit` from `./split`; `resolveHand`, `RoundResult` from `./payout`; `dealerShouldHit` from `./dealer`.
- Produces (the package's public API — this is what the future server task will import):
  - `class BlackjackRound` with constructor `(initialBet: number, options?: { deckCount?: number; random?: RandomFn; shoe?: Card[] })`
  - `round.playerHands: PlayerHand[]` (each `{ cards: Card[]; bet: number; doubled: boolean; done: boolean }`)
  - `round.phase: 'playing' | 'dealer' | 'settled'`
  - `round.act(action: 'hit' | 'stand' | 'double' | 'split'): void` — acts on the current active hand; throws if the round isn't in `'playing'` phase or the action isn't legal right now.
  - `round.getDealerUpcard(): Card` — safe to show clients at any time.
  - `round.getDealerCards(): Card[]` — the full dealer hand; **callers must only reveal this to clients once `phase` is `'dealer'` or `'settled'`**, otherwise they leak the hole card early.
  - `round.results: RoundResult[]` — populated once `phase === 'settled'`, one entry per final hand (more than one if a split occurred).

- [ ] **Step 1: Write the failing tests**

`packages/game-engine/src/blackjackRound.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BlackjackRound } from './blackjackRound';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('BlackjackRound', () => {
  it('deals two cards to the player and two to the dealer', () => {
    const shoe = [card('7'), card('8'), card('2'), card('3'), card('9')];
    const round = new BlackjackRound(100, { shoe });
    expect(round.playerHands).toHaveLength(1);
    expect(round.playerHands[0].cards).toEqual([card('7'), card('8')]);
    expect(round.getDealerUpcard()).toEqual(card('2'));
    expect(round.phase).toBe('playing');
  });

  it('immediately settles a natural player blackjack without further action', () => {
    // Player: A, K (blackjack). Dealer: 9, 8 (17, stands).
    const shoe = [card('A'), card('K'), card('9'), card('8')];
    const round = new BlackjackRound(100, { shoe });
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'blackjack', payout: 150 }]);
  });

  it('lets the player hit, then settles once they stand', () => {
    // Player: 5, 4 (9) -> hits 6 (15) -> stands. Dealer: 10, 9 (19, stands).
    const shoe = [card('5'), card('4'), card('10'), card('9'), card('6')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(round.playerHands[0].cards).toEqual([card('5'), card('4'), card('6')]);
    expect(round.phase).toBe('playing');
    round.act('stand');
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'lose', payout: -100 }]);
  });

  it('busts the player on a hit that exceeds 21 and settles immediately without playing the dealer out', () => {
    // Player: 10, 9 (19) -> hits K -> busts. Dealer: 7, 6 — only 5 cards
    // in the shoe, so if the dealer tried to draw further this would throw.
    const shoe = [card('10'), card('9'), card('7'), card('6'), card('K')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'bust', payout: -100 }]);
    expect(round.getDealerCards()).toEqual([card('7'), card('6')]);
  });

  it('doubles the bet, draws exactly one card, and auto-stands', () => {
    // Player: 6, 5 (11) -> doubles, draws 10 -> 21. Dealer: 9, 8 (17, stands).
    const shoe = [card('6'), card('5'), card('9'), card('8'), card('10')];
    const round = new BlackjackRound(100, { shoe });
    round.act('double');
    expect(round.playerHands[0]).toMatchObject({ bet: 200, doubled: true, done: true });
    expect(round.playerHands[0].cards).toHaveLength(3);
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'win', payout: 200 }]);
  });

  it('rejects doubling once a hand has more than two cards', () => {
    const shoe = [card('5'), card('4'), card('9'), card('8'), card('2'), card('3')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(() => round.act('double')).toThrow('Can only double on the first two cards');
  });

  it('splits a pair into two independently-played hands and settles both', () => {
    // Player: 8, 8 -> split. New hand (index 1) draws first: 8,3 (11).
    // Original hand (index 0) draws next: 8,4 (12). Dealer: 9,6 (15) -> hits 5 -> 20.
    const shoe = [
      card('8'), card('8'), card('9'), card('6'), // initial deal
      card('3'), // new (split-off) hand's second card
      card('4'), // original hand's second card
      card('5'), // dealer hits to 20
    ];
    const round = new BlackjackRound(100, { shoe });
    round.act('split');
    expect(round.playerHands).toHaveLength(2);
    expect(round.playerHands[0].cards).toEqual([card('8'), card('4')]);
    expect(round.playerHands[1].cards).toEqual([card('8'), card('3')]);

    round.act('stand'); // stands hand 0 (12)
    expect(round.phase).toBe('playing'); // hand 1 is still active
    round.act('stand'); // stands hand 1 (11)

    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([
      { outcome: 'lose', payout: -100 },
      { outcome: 'lose', payout: -100 },
    ]);
  });

  it('rejects splitting more than once per round', () => {
    const shoe = [card('8'), card('8'), card('9'), card('6'), card('3'), card('4')];
    const round = new BlackjackRound(100, { shoe });
    round.act('split');
    expect(() => round.act('split')).toThrow('Split already used this round');
  });

  it('rejects acting once the round has settled', () => {
    const shoe = [card('A'), card('K'), card('9'), card('8')];
    const round = new BlackjackRound(100, { shoe });
    expect(round.phase).toBe('settled');
    expect(() => round.act('stand')).toThrow('Cannot act while round is in phase "settled"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/game-engine`
Expected: FAIL — `blackjackRound.ts` does not exist yet.

- [ ] **Step 3: Implement**

`packages/game-engine/src/blackjackRound.ts`:

```ts
import { Card, RandomFn } from './deck';
import { createShoe } from './shoe';
import { handValue, isBust } from './handValue';
import { canSplit } from './split';
import { resolveHand, RoundResult } from './payout';
import { dealerShouldHit } from './dealer';

export type PlayerAction = 'hit' | 'stand' | 'double' | 'split';
export type RoundPhase = 'playing' | 'dealer' | 'settled';

export interface PlayerHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
}

export interface BlackjackRoundOptions {
  deckCount?: number;
  random?: RandomFn;
  /** Pre-built card sequence, drawn from the front. Primarily for tests. */
  shoe?: Card[];
}

export class BlackjackRound {
  private shoe: Card[];
  private dealerCards: Card[];
  private splitUsed = false;
  private activeHandIndex = 0;

  playerHands: PlayerHand[];
  phase: RoundPhase = 'playing';
  results: RoundResult[] = [];

  constructor(initialBet: number, options: BlackjackRoundOptions = {}) {
    this.shoe = options.shoe
      ? [...options.shoe]
      : createShoe(options.deckCount ?? 6, options.random ?? Math.random);

    const initialCards = [this.draw(), this.draw()];
    this.playerHands = [
      {
        cards: initialCards,
        bet: initialBet,
        doubled: false,
        done: handValue(initialCards).total === 21,
      },
    ];
    this.dealerCards = [this.draw(), this.draw()];

    this.advanceIfNeeded();
  }

  private draw(): Card {
    const drawn = this.shoe.shift();
    if (!drawn) {
      throw new Error('Shoe is empty');
    }
    return drawn;
  }

  getDealerUpcard(): Card {
    return this.dealerCards[0];
  }

  getDealerCards(): Card[] {
    return this.dealerCards;
  }

  act(action: PlayerAction): void {
    if (this.phase !== 'playing') {
      throw new Error(`Cannot act while round is in phase "${this.phase}"`);
    }
    const hand = this.playerHands[this.activeHandIndex];
    if (!hand || hand.done) {
      throw new Error('No active hand to act on');
    }

    switch (action) {
      case 'hit': {
        hand.cards.push(this.draw());
        if (isBust(hand.cards)) {
          hand.done = true;
        }
        break;
      }
      case 'stand': {
        hand.done = true;
        break;
      }
      case 'double': {
        if (hand.cards.length !== 2) {
          throw new Error('Can only double on the first two cards');
        }
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(this.draw());
        hand.done = true;
        break;
      }
      case 'split': {
        if (this.splitUsed) {
          throw new Error('Split already used this round');
        }
        if (!canSplit(hand.cards)) {
          throw new Error('Hand is not eligible to split');
        }
        this.splitUsed = true;
        const [first, second] = hand.cards;

        const newHandCards = [second, this.draw()];
        const newHand: PlayerHand = {
          cards: newHandCards,
          bet: hand.bet,
          doubled: false,
          // Note (spec Section 3 simplification): a split hand that reaches
          // 21 on two cards pays via resolveHand's normal blackjack check
          // (3:2), same as a natural. Real casinos usually pay split 21s as
          // a plain win instead — acceptable simplification for chip-only
          // play among friends; revisit if it ever matters.
          done: handValue(newHandCards).total === 21,
        };

        const firstHandCards = [first, this.draw()];
        hand.cards = firstHandCards;
        hand.done = handValue(firstHandCards).total === 21;

        this.playerHands.splice(this.activeHandIndex + 1, 0, newHand);
        break;
      }
    }

    this.advanceIfNeeded();
  }

  private advanceIfNeeded(): void {
    while (
      this.activeHandIndex < this.playerHands.length &&
      this.playerHands[this.activeHandIndex].done
    ) {
      this.activeHandIndex += 1;
    }
    if (this.activeHandIndex >= this.playerHands.length) {
      this.playDealerAndSettle();
    }
  }

  private playDealerAndSettle(): void {
    this.phase = 'dealer';

    const anyHandStillLive = this.playerHands.some((h) => !isBust(h.cards));
    if (anyHandStillLive) {
      while (dealerShouldHit(this.dealerCards)) {
        this.dealerCards.push(this.draw());
      }
    }

    this.results = this.playerHands.map((h) => resolveHand(h.cards, this.dealerCards, h.bet));
    this.phase = 'settled';
  }
}
```

- [ ] **Step 4: Update the package's public exports**

`packages/game-engine/src/index.ts`:

```ts
export { BlackjackRound } from './blackjackRound';
export type {
  PlayerAction,
  PlayerHand,
  RoundPhase,
  BlackjackRoundOptions,
} from './blackjackRound';
export type { Card, Suit, Rank, RandomFn } from './deck';
export type { RoundResult, Outcome } from './payout';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=packages/game-engine`
Expected: PASS — all tests pass, including every scenario in Step 1.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/blackjackRound.ts packages/game-engine/src/blackjackRound.test.ts packages/game-engine/src/index.ts
git commit -m "feat: add BlackjackRound orchestration and public API"
```

---

## What's next (not part of this plan)

This plan delivers a complete, tested Blackjack engine — nothing else. Per
the spec's local-first direction, the rest of the build is staged as
separate plans, written and executed one at a time so each lands as
working, committed software:

1. **Blackjack engine** (this plan)
2. **Texas Hold'em engine** — same pure-logic style: hand evaluation, betting rounds, all-in/side-pot handling (flagged in the spec as the trickiest part).
3. **Local real-time server** — Socket.IO server wiring both engines to WebSocket clients, plus a local persistence adapter (no AWS yet) behind a small storage interface so DynamoDB can be swapped in later without touching game logic.
4. **Frontend** — React lobby + table UI talking to the local server.
5. **Accounts & blacklisting** — Google OAuth (works fine against `localhost` redirect URIs, no AWS needed to build this), allowlist, admin/blacklist enforcement, wired to the storage interface from Plan 3.
6. **AWS deployment** — only once 1–5 work end-to-end locally: swap the storage adapter to DynamoDB, and add the EC2/Lambda/security-group/budget-alarm setup from spec Sections 2, 4, and 5.
