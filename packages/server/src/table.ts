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
  type PlayerHand,
} from '@poker-blackjack/game-engine';
import type { RoundPhase, RoundResult, HoldemStreet, HoldemResult, Pot } from '@poker-blackjack/game-engine';
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

export interface SeatView {
  seatIndex: number;
  displayName: string | null;
  balance: number;
  connected: boolean;
  ready: boolean;
}

export interface BlackjackRoundView {
  phase: RoundPhase;
  playerHands: PlayerHand[];
  dealerUpcard: Card;
  dealerCards: Card[] | null;
  results: RoundResult[] | null;
}

export interface HoldemPlayerView {
  playerId: string;
  stack: number;
  streetContributed: number;
  folded: boolean;
  isAllIn: boolean;
  holeCards: [Card, Card] | null;
}

export interface HoldemView {
  street: HoldemStreet;
  communityCards: Card[];
  actingPlayerId: string | null;
  pots: Pot[];
  results: HoldemResult[] | null;
  players: HoldemPlayerView[];
}

export interface TableStateView {
  gameMode: GameMode;
  handInProgress: boolean;
  seats: SeatView[];
  activeSeatIndex: number | null;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  holdem: HoldemView | null;
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
  private lastSettledHoldemHand: HoldemHand | null = null;
  private lastSettledBlackjackRounds: Map<number, BlackjackRound> | null = null;

  constructor(
    private readonly config: TableConfig,
    private readonly deps: TableDeps
  ) {
    this.seats = new Array(config.seatCount).fill(null);
  }

  async join(displayName: string): Promise<number> {
    // Fast-path rejection before paying for the getBalance I/O below -- not
    // load-bearing for correctness on its own (see the post-await check).
    if (this.seats.some((s) => s?.displayName === displayName)) {
      throw new Error(`"${displayName}" is already seated`);
    }
    const balance = await this.deps.playerStore.getBalance(displayName);
    // Re-check after the only await: two join() calls can both pass the
    // check above and both reach here before either has written to
    // `this.seats` (same-name double-join), or -- more seriously -- both
    // compute the same seatIndex and the second write silently clobbers the
    // first player's seat (different-name race for the same open seat). By
    // re-deriving both the duplicate check and the seat index after the
    // await, and writing immediately with no further await in between, the
    // whole read-check-write sequence runs atomically per JS's
    // single-threaded microtask semantics: whichever call's continuation
    // resumes first completes its full check-and-write before the next
    // call's continuation runs, so the next one always sees up-to-date seats.
    if (this.seats.some((s) => s?.displayName === displayName)) {
      throw new Error(`"${displayName}" is already seated`);
    }
    const seatIndex = this.seats.findIndex((s) => s === null);
    if (seatIndex === -1) {
      throw new Error('Table is full');
    }
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

  // A seat that cannot afford to be dealt in is excluded from the hand
  // entirely: it is not counted toward the "at least 2 players" threshold, it
  // does not have to be `ready` for a hand to start, and it is not passed to
  // startHand. It stays visibly connected and seated rather than being kicked
  // -- "effectively out for the session", per the design spec. Without this,
  // a 0-stack Hold'em player made HoldemHand's constructor throw on every
  // start attempt, permanently bricking the table, and Blackjack had no
  // affordability check at all.
  private eligibleSeatsForHand(): Seat[] {
    return this.seats.filter((s): s is Seat => {
      if (s === null || !s.connected) {
        return false;
      }
      return this.config.gameMode === 'holdem' ? s.balance > 0 : s.balance >= this.config.blackjackDefaultBet;
    });
  }

  private async startHandIfEveryoneReady(): Promise<void> {
    const eligibleSeats = this.eligibleSeatsForHand();
    const allReady = eligibleSeats.length >= 2 && eligibleSeats.every((s) => s.ready);
    if (allReady && !this.handInProgress) {
      await this.startHand(eligibleSeats);
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

    // A seat that was already `ready` before it dropped comes back still
    // `ready`, so reconnecting can be the event that completes the ready gate.
    // Without re-checking here, both seats can show connected+ready with no
    // hand in progress and nothing left to trigger one -- a real deadlock.
    this.startHandIfEveryoneReady().catch((err) => {
      console.error(`Table: error starting hand after seat ${seat.seatIndex} reconnected:`, err);
    });

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
    this.lastSettledHoldemHand = null;
    this.lastSettledBlackjackRounds = null;

    // Independent safety net, on top of eligibleSeatsForHand() already
    // removing the one known cause of a throw here: any failure to construct
    // or log a hand must not leave `handInProgress` stuck true, which would
    // make every subsequent submitAction/leave throw forever.
    try {
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
    } catch (err) {
      console.error('Table: failed to start hand, reverting to no hand in progress:', err);
      this.handInProgress = false;
      this.holdemHand = null;
      this.blackjackRounds = new Map();
      this.activeSeatIndex = null;
      try {
        await this.deps.handLog.clear();
      } catch (clearErr) {
        console.error('Table: failed to clear hand log after a failed hand start:', clearErr);
      }
      // No broadcast: nothing observable changed from any connected client's
      // perspective, and no broadcast happened during the failed attempt either.
      return;
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
    // The in-memory balance is always updated; only the durable write is
    // best-effort per player (self-correcting on the next successful write).
    // A rejection here used to propagate out of settleHoldem with
    // `holdemSettled` already true but `handInProgress` still true and the
    // hand settled-but-non-null -- bricking every later submitAction/leave.
    // The `finally` guarantees the state transition regardless, and the
    // per-player catch keeps one failed write from skipping the others.
    try {
      for (const result of hand.results) {
        const seat = this.seats.find((s) => s?.displayName === result.playerId);
        if (seat) {
          seat.balance += result.payout;
          try {
            await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
          } catch (err) {
            console.error(
              `Table: failed to persist balance for ${seat.displayName} after Hold'em settlement (will retry on next successful write):`,
              err
            );
          }
        }
      }
    } finally {
      this.handInProgress = false;
      this.lastSettledHoldemHand = hand;
      this.holdemHand = null;
      for (const seat of this.seats) {
        if (seat) seat.ready = false;
      }
      this.timedOutSeats.clear();
    }
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
    // Write-ahead marker BEFORE the balance write: a crash between the two
    // durable writes must leave a recoverable "lost payout", never a
    // re-payable "double payout". Do not reorder these.
    await this.deps.handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex } });
    // Best-effort durable write, same rationale as settleHoldem: a rejection
    // here used to propagate out through advancePastSettledBlackjackRounds,
    // leaving activeSeatIndex pinned to an already-'settled' round and
    // handInProgress stuck true forever.
    try {
      await this.deps.playerStore.setBalance(seat.displayName, seat.balance);
    } catch (err) {
      console.error(
        `Table: failed to persist balance for seat ${seatIndex} after Blackjack settlement (will retry on next successful write):`,
        err
      );
    }
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
    this.lastSettledBlackjackRounds = this.blackjackRounds;
    this.blackjackRounds = new Map();
    this.blackjackSettledSeats = new Set();
    for (const seat of this.seats) {
      if (seat) seat.ready = false;
    }
    this.timedOutSeats.clear();
    await this.deps.handLog.clear();
  }

  async recoverFromLog(): Promise<void> {
    try {
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
    } catch (err) {
      console.error('Table: failed to recover from hand log, discarding it and starting fresh:', err);
      this.seats = new Array(this.config.seatCount).fill(null);
      this.handInProgress = false;
      this.holdemHand = null;
      this.blackjackRounds = new Map();
      this.blackjackSettledSeats = new Set();
      this.activeSeatIndex = null;
      try {
        await this.deps.handLog.clear();
      } catch (clearErr) {
        console.error('Table: failed to clear corrupted hand log after recovery failure:', clearErr);
      }
    }
  }

  getStateForSeat(viewerSeatIndex: number | null): TableStateView {
    const seats: SeatView[] = this.seats.map((s, i) =>
      s
        ? { seatIndex: i, displayName: s.displayName, balance: s.balance, connected: s.connected, ready: s.ready }
        : { seatIndex: i, displayName: null, balance: 0, connected: false, ready: false }
    );

    let blackjackRounds: Record<number, BlackjackRoundView> | null = null;
    const roundsSource = this.blackjackRounds.size > 0 ? this.blackjackRounds : this.lastSettledBlackjackRounds;
    if (this.config.gameMode === 'blackjack' && roundsSource) {
      blackjackRounds = {};
      for (const [seatIndex, round] of roundsSource.entries()) {
        blackjackRounds[seatIndex] = {
          phase: round.phase,
          playerHands: round.playerHands,
          dealerUpcard: round.getDealerUpcard(),
          dealerCards: round.phase === 'settled' ? round.getDealerCards() : null,
          results: round.phase === 'settled' ? round.results : null,
        };
      }
    }

    let holdem: HoldemView | null = null;
    const holdemSource = this.holdemHand ?? this.lastSettledHoldemHand;
    if (this.config.gameMode === 'holdem' && holdemSource) {
      const hand = holdemSource;
      const viewerDisplayName =
        viewerSeatIndex !== null ? (this.seats[viewerSeatIndex]?.displayName ?? null) : null;
      holdem = {
        street: hand.street,
        communityCards: hand.communityCards,
        actingPlayerId: hand.actingPlayerId,
        pots: hand.pots,
        results: hand.street === 'settled' ? hand.results : null,
        players: hand.players.map((p) => ({
          playerId: p.playerId,
          stack: p.stack,
          streetContributed: p.streetContributed,
          folded: p.folded,
          isAllIn: p.isAllIn,
          holeCards:
            p.playerId === viewerDisplayName || (hand.street === 'settled' && !p.folded)
              ? p.holeCards
              : null,
        })),
      };
    }

    return {
      gameMode: this.config.gameMode,
      handInProgress: this.handInProgress,
      seats,
      activeSeatIndex: this.activeSeatIndex,
      blackjackRounds,
      holdem,
    };
  }
}
