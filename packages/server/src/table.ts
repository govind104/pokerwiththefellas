import {
  BlackjackRound,
  HoldemHand,
  createDeck,
  shuffle,
  type HoldemPlayerInput,
  type HoldemHandConfig,
  type Card,
} from '@poker-blackjack/game-engine';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';

export type GameMode = 'blackjack' | 'holdem';

export interface Seat {
  seatIndex: number;
  displayName: string;
  connected: boolean;
  ready: boolean;
  balance: number;
}

export interface TableConfig {
  gameMode: GameMode;
  seatCount: number;
  smallBlind: number;
  bigBlind: number;
  blackjackDefaultBet: number;
  defaultStartingBalance: number;
  reconnectGraceMs: number;
  random: () => number;
}

export interface TableDeps {
  playerStore: PlayerStore;
  handLog: HandLog;
  onStateChange: () => void;
}

export class Table {
  seats: (Seat | null)[];
  handInProgress = false;
  holdemHand: HoldemHand | null = null;
  blackjackRounds: Map<number, BlackjackRound> = new Map();
  activeSeatIndex: number | null = null;

  private buttonSeatIndex: number | null = null;

  constructor(
    private readonly config: TableConfig,
    private readonly deps: TableDeps
  ) {
    this.seats = new Array(config.seatCount).fill(null);
  }

  async join(displayName: string): Promise<number> {
    if (this.seats.some((s) => s?.displayName === displayName)) {
      throw new Error(`"${displayName}" is already seated`);
    }
    const seatIndex = this.seats.findIndex((s) => s === null);
    if (seatIndex === -1) {
      throw new Error('Table is full');
    }
    const balance = await this.deps.playerStore.getBalance(displayName);
    this.seats[seatIndex] = { seatIndex, displayName, connected: true, ready: false, balance };
    this.deps.onStateChange();
    return seatIndex;
  }

  leave(seatIndex: number): void {
    if (this.handInProgress) {
      throw new Error('Cannot leave while a hand is in progress');
    }
    if (!this.seats[seatIndex]) {
      throw new Error('Seat is empty');
    }
    this.seats[seatIndex] = null;
    this.deps.onStateChange();
  }

  async setReady(seatIndex: number): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    seat.ready = true;
    this.deps.onStateChange();

    const seatedSeats = this.seats.filter((s): s is Seat => s !== null);
    const allReady = seatedSeats.length >= 2 && seatedSeats.every((s) => s.ready);
    if (allReady && !this.handInProgress) {
      await this.startHand(seatedSeats);
    }
  }

  private buildShuffledDeck(deckCount: number): Card[] {
    const cards = Array.from({ length: deckCount }, () => createDeck()).flat();
    return shuffle(cards, this.config.random);
  }

  private nextButtonSeatIndex(seatedSeats: Seat[]): number {
    const occupied = seatedSeats.map((s) => s.seatIndex).sort((a, b) => a - b);
    if (this.buttonSeatIndex === null) {
      return occupied[0];
    }
    const currentPos = occupied.indexOf(this.buttonSeatIndex);
    if (currentPos === -1) {
      return occupied.find((i) => i > this.buttonSeatIndex!) ?? occupied[0];
    }
    return occupied[(currentPos + 1) % occupied.length];
  }

  private async startHand(seatedSeats: Seat[]): Promise<void> {
    this.handInProgress = true;

    if (this.config.gameMode === 'holdem') {
      this.buttonSeatIndex = this.nextButtonSeatIndex(seatedSeats);
      const buttonIndex = seatedSeats.findIndex((s) => s.seatIndex === this.buttonSeatIndex);

      const players: HoldemPlayerInput[] = seatedSeats.map((s) => ({
        playerId: s.displayName,
        stack: s.balance,
      }));
      const holdemConfig: HoldemHandConfig = {
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        buttonIndex,
        deck: this.buildShuffledDeck(1),
      };

      await this.deps.handLog.append({
        type: 'holdem_hand_started',
        data: { players, config: holdemConfig },
      });
      this.holdemHand = new HoldemHand(players, holdemConfig);
    } else {
      const rounds = seatedSeats.map((s) => ({
        seatIndex: s.seatIndex,
        displayName: s.displayName,
        initialBet: this.config.blackjackDefaultBet,
        shoe: this.buildShuffledDeck(6),
      }));

      await this.deps.handLog.append({ type: 'blackjack_hand_started', data: { rounds } });
      this.blackjackRounds = new Map(
        rounds.map((r) => [r.seatIndex, new BlackjackRound(r.initialBet, { shoe: r.shoe })])
      );
      this.activeSeatIndex = rounds[0].seatIndex;
    }

    this.deps.onStateChange();
  }
}
