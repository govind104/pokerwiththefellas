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

  /** Safe to show clients at any time, including while phase is 'playing'. */
  getDealerUpcard(): Card {
    return this.dealerCards[0];
  }

  /**
   * The full dealer hand, including the hole card. Callers must only reveal
   * this to clients once `phase` is 'dealer' or 'settled' — revealing it
   * during 'playing' leaks the dealer's hole card early.
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
