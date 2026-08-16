import { Card, RandomFn, createDeck, shuffle } from './deck';
import {
  HoldemAction,
  computeBettingContext,
  validateAction,
  chipsToCommit,
} from './holdemBetting';
import { PlayerContribution, Pot, computePots } from './holdemPots';
import { determineWinners } from './holdemHandRank';

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

export interface HoldemResult {
  playerId: string;
  payout: number;
}

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
  pots: Pot[] = [];
  results: HoldemResult[] = [];

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
    if (config.smallBlind <= 0) {
      throw new Error('smallBlind must be greater than 0');
    }
    if (config.bigBlind < config.smallBlind) {
      throw new Error('bigBlind must be greater than or equal to smallBlind');
    }
    for (const p of playersInput) {
      if (p.stack <= 0) {
        throw new Error(`Player ${p.playerId} must start with a positive stack`);
      }
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

    this.resolveActingPlayer();
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
    if (player.stack === 0) {
      player.isAllIn = true;
    }
  }

  private resolveActingPlayer(): void {
    if (this.playersToAct.size === 0) {
      // Nobody can act preflop -- e.g. every active player is already
      // all-in from posting blinds. Skip straight to dealing out the rest
      // of the board and settling, the same cascade dealStreet already
      // uses mid-hand when everyone left is all-in.
      this.advanceStreet();
      return;
    }
    if (!this.playersToAct.has(this.actingIndex)) {
      // The naively-computed first-to-act player turned out to be all-in
      // (e.g. a short-stacked heads-up button whose blind exhausted them)
      // -- find the next player who can actually act.
      this.actingIndex = this.nextActingIndex(this.actingIndex);
      this.actingPlayerId = this.players[this.actingIndex].playerId;
    }
  }

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
    if (player.stack === 0) {
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
    } else {
      throw new Error(`Cannot advance from street "${this.street}"`);
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
    this.resolveActingPlayer();
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
}
