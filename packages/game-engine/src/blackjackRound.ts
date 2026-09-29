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
  /**
   * Play this round against a dealer (and shoe) shared with other rounds. The
   * round then stops after its own hands are done and waits for
   * `SharedDealer.playAndSettle` -- the dealer plays once, after the last
   * player, and every round settles against that one hand.
   */
  dealer?: SharedDealer;
}

/**
 * One shoe and one dealer hand for a whole table. Rounds constructed with
 * `{ dealer }` draw from this shoe and are settled together, so every player
 * is paid against the same dealer hand and nobody settles before the last
 * player has acted.
 */
export class SharedDealer {
  private shoe: Card[];
  private cards: Card[];

  constructor(options: { deckCount?: number; random?: RandomFn; shoe?: Card[] } = {}) {
    this.shoe = options.shoe
      ? [...options.shoe]
      : createShoe(options.deckCount ?? 6, options.random ?? Math.random);
    // The dealer's two cards come off the top before any player is dealt in.
    this.cards = [this.draw(), this.draw()];
  }

  draw(): Card {
    const drawn = this.shoe.shift();
    if (!drawn) {
      throw new Error('Shoe is empty');
    }
    return drawn;
  }

  /** Cards left in the shoe. */
  remaining(): number {
    return this.shoe.length;
  }

  /** Safe to show clients at any time. */
  getUpcard(): Card {
    return this.cards[0];
  }

  /** Full hand including the hole card: only reveal once the rounds are settled. */
  getCards(): Card[] {
    return this.cards;
  }

  /**
   * Plays the dealer's hand (only if some player still has a live hand) and
   * settles every round against it. Every round must have finished its own hands.
   */
  playAndSettle(rounds: BlackjackRound[]): void {
    if (rounds.some((r) => !r.playingComplete)) {
      throw new Error('Cannot play the dealer while a player is still to act');
    }
    if (rounds.some((r) => r.hasLiveHand())) {
      while (dealerShouldHit(this.cards)) {
        this.cards.push(this.draw());
      }
    }
    for (const r of rounds) {
      r.settleAgainst(this.cards);
    }
  }
}

function isTwoCardTwentyOne(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export class BlackjackRound {
  private shoe: Card[];
  private ownDealerCards: Card[];
  private sharedDealer: SharedDealer | null;
  private playingDone = false;
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
    this.sharedDealer = options.dealer ?? null;
    this.shoe = this.sharedDealer
      ? []
      : options.shoe
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
    this.ownDealerCards = this.sharedDealer ? [] : [this.draw(), this.draw()];

    this.advanceIfNeeded();
  }

  private get dealerCards(): Card[] {
    return this.sharedDealer ? this.sharedDealer.getCards() : this.ownDealerCards;
  }

  // An action that needs cards must fail BEFORE it changes anything, so an exhausted shoe
  // rejects the action cleanly (the player can still stand) instead of leaving a half-applied hand.
  private assertCanDraw(count: number): void {
    const left = this.sharedDealer ? this.sharedDealer.remaining() : this.shoe.length;
    if (left < count) {
      throw new Error('Shoe is empty');
    }
  }

  private draw(): Card {
    if (this.sharedDealer) {
      return this.sharedDealer.draw();
    }
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

  /** True once every one of this player's hands is finished (the dealer may still be waiting on others). */
  get playingComplete(): boolean {
    return this.phase !== 'playing' || this.playingDone;
  }

  /** Whether any hand is still in the running (not bust): if none, the dealer needn't draw. */
  hasLiveHand(): boolean {
    return this.playerHands.some((h) => !isBust(h.cards));
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
        this.assertCanDraw(1);
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
        this.assertCanDraw(1);
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
        this.assertCanDraw(2);
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
      if (this.sharedDealer) {
        // Wait for the rest of the table; SharedDealer.playAndSettle finishes the round.
        this.playingDone = true;
      } else {
        this.playDealerAndSettle();
      }
    }
  }

  private playDealerAndSettle(): void {
    this.phase = 'dealer';

    if (this.hasLiveHand()) {
      while (dealerShouldHit(this.dealerCards)) {
        this.dealerCards.push(this.draw());
      }
    }

    this.settleAgainst(this.dealerCards);
  }

  /** Resolve every hand against a finished dealer hand. Called by SharedDealer.playAndSettle. */
  settleAgainst(dealerCards: Card[]): void {
    this.phase = 'dealer';
    this.results = this.playerHands.map((h) =>
      resolveHand(h.cards, dealerCards, h.bet, !this.blackjackIneligibleHands.has(h))
    );
    this.phase = 'settled';
  }
}
