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
