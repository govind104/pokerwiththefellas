import type { BlackjackRoundView, HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card, Outcome, PlayerHand } from '@poker-blackjack/game-engine';
import { actingSeatIndex, livePot } from '../three/pokerModel';
import { pickDealerRound } from '../three/sceneModel';

// The HUD's view of the table (Plan B spec §3, base spec §B1): one row per seated player and a
// board or dealer panel. Pure, so both layouts and the tests share it.

export interface BlindSeats {
  buttonSeatIndex: number | null;
  smallBlindSeatIndex: number | null;
  bigBlindSeatIndex: number | null;
}
export const NO_BLINDS: BlindSeats = { buttonSeatIndex: null, smallBlindSeatIndex: null, bigBlindSeatIndex: null };

export type Badge = 'D' | 'SB' | 'BB';
export type StatusTone = 'plain' | 'turn' | 'win' | 'lose' | 'push' | 'alert';

export interface HudCardGroup {
  cards: (Card | null)[];
  total: string | null;
}

export interface HudRow {
  seatIndex: number;
  name: string;
  balance: number;
  isMe: boolean;
  isActive: boolean;
  dimmed: boolean;
  won: boolean;
  bet: number | null;
  badges: Badge[];
  status: string;
  tone: StatusTone;
  handName: string | null;
  groups: HudCardGroup[];
}

export interface HoldemPanelModel {
  kind: 'holdem';
  board: (Card | null)[];
  street: string;
  pot: number;
}
export interface DealerPanelModel {
  kind: 'blackjack';
  cards: (Card | null)[];
  total: string;
}
export type PanelModel = HoldemPanelModel | DealerPanelModel;
export interface HudModel {
  rows: HudRow[];
  panel: PanelModel | null;
}

type Status = { status: string; tone: StatusTone };

// Others clockwise from the local player, then the local player last, at the bottom (base spec §B1).
export function tableOrder<T extends { seatIndex: number }>(seated: T[], mySeatIndex: number | null, n: number): T[] {
  const rel = (s: T) => (mySeatIndex === null ? s.seatIndex : (s.seatIndex - mySeatIndex + n) % n || n);
  return [...seated].sort((a, b) => rel(a) - rel(b));
}

function readiness(seat: SeatView): Status {
  if (!seat.connected) return { status: 'Disconnected', tone: 'alert' };
  return { status: seat.ready ? 'Ready' : 'Not ready', tone: 'plain' };
}

function toneOf(payout: number): StatusTone {
  return payout > 0 ? 'win' : payout < 0 ? 'lose' : 'push';
}

const STREET_LABEL: Record<HoldemView['street'], string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  settled: 'Hand over',
};

export interface HoldemHudInput {
  seats: SeatView[];
  mySeatIndex: number | null;
  holdem: HoldemView | null;
  blinds: BlindSeats;
}

export function buildHoldemHud({ seats, mySeatIndex, holdem, blinds }: HoldemHudInput): HudModel {
  const seated = seats.filter((s) => s.displayName);
  const active = actingSeatIndex(seats, holdem);
  const settled = holdem?.street === 'settled';

  const rows = tableOrder(seated, mySeatIndex, Math.max(seats.length, 1)).map((seat): HudRow => {
    const name = seat.displayName as string;
    const isMe = seat.seatIndex === mySeatIndex;
    const isActive = seat.seatIndex === active;
    const player = holdem?.players.find((p) => p.playerId === name) ?? null;
    const result = settled ? (holdem?.results?.find((r) => r.playerId === name) ?? null) : null;

    let s: Status;
    if (!holdem || (settled && !player)) s = readiness(seat);
    else if (!player) s = { status: 'Not in this hand', tone: 'plain' };
    else if (player.folded) s = { status: 'Folded', tone: 'plain' };
    else if (result) {
      const p = result.payout;
      s = { status: p > 0 ? `Won ${p}` : p < 0 ? `Lost ${Math.abs(p)}` : 'Push', tone: toneOf(p) };
    } else if (!seat.connected) s = { status: 'Disconnected', tone: 'alert' };
    else if (isActive) s = { status: isMe ? 'Your turn' : 'Thinking…', tone: 'turn' };
    else if (player.isAllIn) s = { status: 'All-in', tone: 'plain' };
    else s = { status: 'Waiting', tone: 'plain' };

    // Badges come from the server, which knows where startHand posted the blinds (base spec §B1).
    const badges: Badge[] = [];
    if (holdem) {
      if (blinds.buttonSeatIndex === seat.seatIndex) badges.push('D');
      if (blinds.smallBlindSeatIndex === seat.seatIndex) badges.push('SB');
      if (blinds.bigBlindSeatIndex === seat.seatIndex) badges.push('BB');
    }

    return {
      seatIndex: seat.seatIndex,
      name,
      // Mid-hand the in-hand stack is the live number; the seat balance only updates at settlement.
      balance: holdem && !settled && player ? player.stack : seat.balance,
      isMe,
      isActive,
      dimmed: !!player?.folded,
      won: !!result && !player?.folded && result.payout > 0,
      bet: holdem && !settled && player && player.streetContributed > 0 ? player.streetContributed : null,
      badges,
      status: s.status,
      tone: s.tone,
      handName: result?.handName ?? null,
      // Opponents' cards only arrive once the server reveals them (showdown); face-down ones are not listed.
      groups: player && !player.folded && player.holeCards ? [{ cards: player.holeCards, total: null }] : [],
    };
  });

  const panel: HoldemPanelModel | null = holdem
    ? {
        kind: 'holdem',
        board: Array.from({ length: 5 }, (_, i) => holdem.communityCards[i] ?? null),
        street: settled && holdem.results?.some((r) => r.handName) ? 'Showdown' : STREET_LABEL[holdem.street],
        pot: livePot(seats, holdem),
      }
    : null;
  return { rows, panel };
}

export function blackjackTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces += 1;
      total += 11;
    } else {
      total += c.rank === 'J' || c.rank === 'Q' || c.rank === 'K' ? 10 : Number(c.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

function totalText(cards: Card[]): string {
  const v = blackjackTotal(cards);
  return v.soft ? `soft ${v.total}` : `${v.total}`;
}

const OUTCOME_TEXT: Record<Outcome, string> = { blackjack: 'Blackjack', win: 'Win', push: 'Push', lose: 'Lose', bust: 'Bust' };

function outcomeText(r: { outcome: Outcome; payout: number }): string {
  if (r.payout === 0) return OUTCOME_TEXT[r.outcome];
  return `${OUTCOME_TEXT[r.outcome]} ${r.payout > 0 ? '+' : '−'}${Math.abs(r.payout)}`;
}

function doneText(h: PlayerHand, handCount: number): string {
  const t = blackjackTotal(h.cards).total;
  if (t > 21) return 'Bust';
  // A 21 on a split hand's first two cards is not a natural.
  if (t === 21 && h.cards.length === 2 && handCount === 1) return 'Blackjack';
  return 'Stood';
}

export interface BlackjackHudInput {
  seats: SeatView[];
  mySeatIndex: number | null;
  activeSeatIndex: number | null;
  handInProgress: boolean;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
}

export function buildBlackjackHud({ seats, mySeatIndex, activeSeatIndex, handInProgress, blackjackRounds }: BlackjackHudInput): HudModel {
  const seated = seats.filter((s) => s.displayName);
  const rows = tableOrder(seated, mySeatIndex, Math.max(seats.length, 1)).map((seat): HudRow => {
    const round = blackjackRounds?.[seat.seatIndex];
    const isMe = seat.seatIndex === mySeatIndex;
    const isActive = seat.seatIndex === activeSeatIndex;

    let s: Status;
    if (!round) s = handInProgress ? { status: 'Not in this hand', tone: 'plain' } : readiness(seat);
    else if (!seat.connected) s = { status: 'Disconnected', tone: 'alert' };
    else if (round.phase === 'settled' && round.results) {
      const net = round.results.reduce((sum, r) => sum + r.payout, 0);
      s = { status: round.results.map(outcomeText).join(' / '), tone: toneOf(net) };
    } else if (isActive) s = { status: isMe ? 'Your turn' : 'Thinking…', tone: 'turn' };
    else if (round.playerHands.every((h) => h.done)) {
      s = { status: round.playerHands.map((h) => doneText(h, round.playerHands.length)).join(' / '), tone: 'plain' };
    } else s = { status: 'Waiting', tone: 'plain' };

    return {
      seatIndex: seat.seatIndex,
      name: seat.displayName as string,
      balance: seat.balance,
      isMe,
      isActive,
      dimmed: false,
      won: false,
      bet: round ? round.playerHands.reduce((sum, h) => sum + h.bet, 0) : null,
      badges: [],
      status: s.status,
      tone: s.tone,
      handName: null,
      groups: round ? round.playerHands.map((h) => ({ cards: h.cards, total: totalText(h.cards) })) : [],
    };
  });

  const dealer = pickDealerRound(blackjackRounds, mySeatIndex);
  const panel: DealerPanelModel | null = !dealer
    ? null
    : dealer.dealerCards
      ? { kind: 'blackjack', cards: dealer.dealerCards, total: totalText(dealer.dealerCards) }
      : // The hole card stays face-down until the reveal (base spec §B1: "10 + ?").
        { kind: 'blackjack', cards: [dealer.dealerUpcard, null], total: `${blackjackTotal([dealer.dealerUpcard]).total} + ?` };
  return { rows, panel };
}

// Mirror the server's Table.leave rule (isDealtIn) so the link only shows when a leave would be
// accepted; the server stays the authority (Plan B spec §3 item 4).
export function canLeaveHoldem(
  handInProgress: boolean,
  seats: SeatView[],
  mySeatIndex: number | null,
  holdem: HoldemView | null,
): boolean {
  if (mySeatIndex === null) return false;
  if (!handInProgress) return true;
  const name = seats.find((s) => s.seatIndex === mySeatIndex)?.displayName;
  return !holdem?.players.some((p) => p.playerId === name);
}

export function canLeaveBlackjack(
  handInProgress: boolean,
  mySeatIndex: number | null,
  rounds: Record<number, BlackjackRoundView> | null,
): boolean {
  if (mySeatIndex === null) return false;
  if (!handInProgress) return true;
  return !rounds?.[mySeatIndex];
}

// Scale that makes content of height `natural` fit `available` (never enlarges).
export function fitScale(natural: number, available: number): number {
  if (natural <= 0 || available <= 0 || natural <= available) return 1;
  return available / natural;
}
