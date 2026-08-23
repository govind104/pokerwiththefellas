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

function isTwoCardTwentyOne(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export class BlackjackRound {
  private shoe: Card[];
  private dealerCards: Card[];
  private splitUsed = false;
  private activeHandIndex = 0;
  // Tracked by object identity rather than a field on PlayerHand itself, so
  // this stays purely internal instead of adding a field every consumer of
  // the public PlayerHand shape (server state views, frontend fixtures) has
  // to know about. Both hands resulting from a split go in here -- neither
  // is more "original" than the other once the pair has been broken apart.
  private blackjackIneligibleHands = new Set<PlayerHand>();

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
        done: isTwoCardTwentyOne(initialCards),
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

  /** Safe to show clients at any time, including while phase is 'playing'. */
  getDealerUpcard(): Card {
    return this.dealerCards[0];
  }

  /**
   * The full dealer hand, including the hole card. Callers must only reveal
   * this to clients once `phase` is 'settled' — revealing it during
   * 'playing' leaks the dealer's hole card early.
   */
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
          done: isTwoCardTwentyOne(newHandCards),
        };

        const firstHandCards = [first, this.draw()];
        hand.cards = firstHandCards;
        hand.done = isTwoCardTwentyOne(firstHandCards);

        // Neither resulting hand can be a "natural" blackjack -- only the
        // player's original first two cards qualify. A two-card 21 on either
        // hand from here on is resolved as a plain 21 by resolveHand's
        // total-value comparison, not the 3:2 blackjack payout.
        this.blackjackIneligibleHands.add(hand);
        this.blackjackIneligibleHands.add(newHand);

        this.playerHands.splice(this.activeHandIndex + 1, 0, newHand);
        break;
      }
      default: {
        throw new Error(`Unknown action: ${action}`);
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

    this.results = this.playerHands.map((h) =>
      resolveHand(h.cards, this.dealerCards, h.bet, !this.blackjackIneligibleHands.has(h))
    );
    this.phase = 'settled';
  }
}
