import {
  BlackjackRound,
  HoldemHand,
  createDeck,
  shuffle,
  type HoldemPlayerInput,
  type HoldemHandConfig,
  type PlayerAction,
  type HoldemAction,
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
  blackjackSettledSeats: Set<number> = new Set();

  private buttonSeatIndex: number | null = null;
  private disconnectTimers: Map<number, NodeJS.Timeout> = new Map();
  private timedOutSeats: Set<number> = new Set();
  private holdemSettled = false;

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
    const timer = this.disconnectTimers.get(seatIndex);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(seatIndex);
    }
    this.timedOutSeats.delete(seatIndex);
    this.seats[seatIndex] = null;
    this.deps.onStateChange();

    this.startHandIfEveryoneReady().catch((err) => {
      console.error(`Table: error starting hand after seat ${seatIndex} left:`, err);
    });
  }

  async setReady(seatIndex: number): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    seat.ready = true;
    this.deps.onStateChange();
    await this.startHandIfEveryoneReady();
  }

  private async startHandIfEveryoneReady(): Promise<void> {
    const connectedSeats = this.seats.filter((s): s is Seat => s !== null && s.connected);
    const allReady = connectedSeats.length >= 2 && connectedSeats.every((s) => s.ready);
    if (allReady && !this.handInProgress) {
      await this.startHand(connectedSeats);
    }
  }

  disconnect(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    const existingTimer = this.disconnectTimers.get(seatIndex);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    seat.connected = false;
    this.deps.onStateChange();

    const timer = setTimeout(() => {
      this.onGraceWindowElapsed(seatIndex).catch((err) => {
        console.error(`Table: error handling grace window elapse for seat ${seatIndex}:`, err);
      });
    }, this.config.reconnectGraceMs);
    this.disconnectTimers.set(seatIndex, timer);

    this.startHandIfEveryoneReady().catch((err) => {
      console.error(`Table: error starting hand after seat ${seatIndex} disconnected:`, err);
    });
  }

  reconnect(displayName: string): number | null {
    const seat = this.seats.find((s) => s?.displayName === displayName && !s.connected);
    if (!seat) {
      return null;
    }
    const timer = this.disconnectTimers.get(seat.seatIndex);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(seat.seatIndex);
    }
    this.timedOutSeats.delete(seat.seatIndex);
    seat.connected = true;
    this.deps.onStateChange();
    return seat.seatIndex;
  }

  private async onGraceWindowElapsed(seatIndex: number): Promise<void> {
    this.disconnectTimers.delete(seatIndex);
    const seat = this.seats[seatIndex];
    if (!seat || seat.connected) {
      return;
    }
    this.timedOutSeats.add(seatIndex);
    await this.autoActIfSeatIsUpAndTimedOut(seatIndex);
  }

  private async autoActIfSeatIsUpAndTimedOut(seatIndex: number): Promise<void> {
    if (!this.handInProgress || !this.timedOutSeats.has(seatIndex)) {
      return;
    }
    const seat = this.seats[seatIndex];
    if (!seat) {
      return;
    }

    if (this.config.gameMode === 'holdem') {
      if (this.holdemHand?.actingPlayerId !== seat.displayName) {
        return;
      }
      const context = this.holdemHand.getBettingContext();
      const action: HoldemAction = context && context.toCall === 0 ? 'check' : 'fold';
      await this.submitAction(seatIndex, action);
    } else {
      if (this.activeSeatIndex !== seatIndex) {
        return;
      }
      await this.submitAction(seatIndex, 'stand');
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
      this.holdemSettled = false;
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
      await this.advancePastSettledBlackjackRounds();
    }

    this.deps.onStateChange();
  }

  async submitAction(
    seatIndex: number,
    action: PlayerAction | HoldemAction,
    amount?: number
  ): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error('Seat is empty');
    }
    if (!this.handInProgress) {
      throw new Error('No hand in progress');
    }

    if (this.config.gameMode === 'holdem') {
      const hand = this.holdemHand!;
      if (hand.actingPlayerId !== seat.displayName) {
        throw new Error(`It is not ${seat.displayName}'s turn`);
      }
      hand.act(seat.displayName, action as HoldemAction, amount);
      await this.deps.handLog.append({
        type: 'holdem_action',
        data: { playerId: seat.displayName, action, amount },
      });
      if (hand.street === 'settled') {
        await this.settleHoldem(hand);
      }
    } else {
      if (this.activeSeatIndex !== seatIndex) {
        throw new Error(`It is not seat ${seatIndex}'s turn`);
      }
      const round = this.blackjackRounds.get(seatIndex)!;
      round.act(action as PlayerAction);
      await this.deps.handLog.append({ type: 'blackjack_action', data: { seatIndex, action } });
      await this.advancePastSettledBlackjackRounds();
    }

    this.deps.onStateChange();

    if (this.handInProgress) {
      const nextSeatIndex =
        this.config.gameMode === 'holdem'
          ? this.seats.find((s) => s?.displayName === this.holdemHand?.actingPlayerId)?.seatIndex
          : this.activeSeatIndex;
      if (nextSeatIndex !== undefined && nextSeatIndex !== null) {
        await this.autoActIfSeatIsUpAndTimedOut(nextSeatIndex);
      }
    }
  }

  private async settleHoldem(hand: HoldemHand): Promise<void> {
    if (this.holdemSettled) {
      return;
    }
    this.holdemSettled = true;
    for (const result of hand.results) {
      const seat = this.seats.find((s) => s?.displayName === result.playerId);
      if (seat) {
        seat.balance += result.payout;
        await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
      }
    }
    this.handInProgress = false;
    this.holdemHand = null;
    for (const seat of this.seats) {
      if (seat) seat.ready = false;
    }
    this.timedOutSeats.clear();
    await this.deps.handLog.clear();
  }

  private async settleBlackjackSeatIfNeeded(seatIndex: number): Promise<void> {
    if (this.blackjackSettledSeats.has(seatIndex)) {
      return;
    }
    const round = this.blackjackRounds.get(seatIndex)!;
    if (round.phase !== 'settled') {
      return;
    }
    this.blackjackSettledSeats.add(seatIndex);
    const seat = this.seats[seatIndex]!;
    const totalPayout = round.results.reduce((sum, r) => sum + r.payout, 0);
    seat.balance += totalPayout;
    await this.deps.handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex } });
    await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
  }

  private async advancePastSettledBlackjackRounds(): Promise<void> {
    const dealtSeatIndices = Array.from(this.blackjackRounds.keys()).sort((a, b) => a - b);
    while (this.activeSeatIndex !== null) {
      const round = this.blackjackRounds.get(this.activeSeatIndex)!;
      if (round.phase !== 'settled') {
        return;
      }
      await this.settleBlackjackSeatIfNeeded(this.activeSeatIndex);
      const pos = dealtSeatIndices.indexOf(this.activeSeatIndex);
      this.activeSeatIndex = dealtSeatIndices[pos + 1] ?? null;
    }
    await this.finishBlackjackHandIfComplete();
  }

  private async finishBlackjackHandIfComplete(): Promise<void> {
    this.handInProgress = false;
    this.blackjackRounds = new Map();
    this.blackjackSettledSeats = new Set();
    for (const seat of this.seats) {
      if (seat) seat.ready = false;
    }
    this.timedOutSeats.clear();
    await this.deps.handLog.clear();
  }

  async recoverFromLog(): Promise<void> {
    const entries = await this.deps.handLog.readAll();
    if (entries.length === 0) {
      return;
    }
    const [started, ...rest] = entries;

    if (started.type === 'holdem_hand_started') {
      const { players, config } = started.data as {
        players: HoldemPlayerInput[];
        config: HoldemHandConfig;
      };
      const hand = new HoldemHand(players, config);
      for (const entry of rest) {
        if (entry.type === 'holdem_action') {
          const { playerId, action, amount } = entry.data as {
            playerId: string;
            action: HoldemAction;
            amount?: number;
          };
          hand.act(playerId, action, amount);
        }
      }
      if (hand.street === 'settled') {
        await this.deps.handLog.clear();
        return;
      }
      for (let i = 0; i < players.length; i++) {
        const balance = await this.deps.playerStore.getBalance(players[i].playerId);
        this.seats[i] = {
          seatIndex: i,
          displayName: players[i].playerId,
          connected: false,
          ready: false,
          balance,
        };
      }
      this.holdemHand = hand;
      this.handInProgress = true;
    } else if (started.type === 'blackjack_hand_started') {
      const { rounds } = started.data as {
        rounds: { seatIndex: number; displayName: string; initialBet: number; shoe: Card[] }[];
      };
      const reconstructed = new Map(
        rounds.map((r) => [r.seatIndex, new BlackjackRound(r.initialBet, { shoe: r.shoe })])
      );
      const alreadySettledSeats = new Set<number>();
      for (const entry of rest) {
        if (entry.type === 'blackjack_action') {
          const { seatIndex, action } = entry.data as { seatIndex: number; action: PlayerAction };
          reconstructed.get(seatIndex)!.act(action);
        } else if (entry.type === 'blackjack_seat_settled') {
          const { seatIndex } = entry.data as { seatIndex: number };
          alreadySettledSeats.add(seatIndex);
        }
      }
      for (const r of rounds) {
        const balance = await this.deps.playerStore.getBalance(r.displayName);
        this.seats[r.seatIndex] = {
          seatIndex: r.seatIndex,
          displayName: r.displayName,
          connected: false,
          ready: false,
          balance,
        };
      }
      this.blackjackRounds = reconstructed;
      this.blackjackSettledSeats = alreadySettledSeats;
      this.activeSeatIndex = rounds[0].seatIndex;
      this.handInProgress = true;
      await this.advancePastSettledBlackjackRounds();
    }

    for (const seat of this.seats) {
      if (seat) {
        this.disconnect(seat.seatIndex);
      }
    }
  }
}
