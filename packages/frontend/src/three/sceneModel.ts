import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { Card, Outcome } from '@poker-blackjack/game-engine';
import { TABLE_Y, dealerCards, layoutSeats, type CardPlacement } from './layout';

// Pure translation of a server snapshot into a declarative description of the
// 3D scene. Nothing here touches WebGL, so it is unit-testable and the
// animation reconciler in engine/SceneRoot can stay idempotent: the server
// only ever sends full snapshots (no "card dealt" events), so what happened is
// derived by diffing this model against the previous one, keyed by stable ids.
// Where things sit on the felt comes from layout.ts.

export { TABLE_A, TABLE_B, TABLE_Y, CARD_W, CARD_H } from './layout';

export interface Vec2 {
  x: number;
  z: number;
}

// Small deterministic wobble so dealt cards don't look machine-aligned.
export function jitter(key: string, scale: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 2000) / 1000 - 1) * scale;
}

export interface CardSlot {
  key: string;
  card: Card | null; // null = face down
  x: number;
  y: number;
  z: number;
  rotY: number;
  order: number;
}

export interface ChipStackModel {
  key: string;
  amount: number;
  x: number;
  z: number;
}

export interface SeatModel {
  seatIndex: number;
  name: string;
  balance: number;
  isMe: boolean;
  isActive: boolean;
  connected: boolean;
  status: string;
  // Where the projected name plate sits on the rail. Null for a player who sat down mid-hand:
  // seats are laid out only between hands, so they get a place at the next deal.
  plate: Vec2 | null;
}

export interface OutcomeLabel {
  key: string;
  seatIndex: number;
  text: string;
  polarity: 'win' | 'lose' | 'push';
  x: number;
  z: number;
}

export interface PotModel {
  amount: number;
  x: number;
  z: number;
}

// What is printed on the felt (spec §A5). It changes only when the seat layout does, which is
// between hands.
export interface FeltPrint {
  kind: 'blackjack' | 'holdem';
  rings: Vec2[];
}

export function feltPrintKey(p: FeltPrint): string {
  return `${p.kind}|${p.rings.map((r) => `${r.x.toFixed(3)},${r.z.toFixed(3)}`).join(';')}`;
}

export interface SceneModel {
  kind: 'blackjack' | 'holdem';
  pot: PotModel | null;
  cards: CardSlot[];
  chips: ChipStackModel[];
  seats: SeatModel[];
  outcomes: OutcomeLabel[];
  hasRound: boolean;
  myTurn: boolean;
  // Where the turn light points (spec §A6): the acting player's cards, or the dealer's while the
  // dealer plays. Null when nobody is acting.
  turnLight: Vec2 | null;
  felt: FeltPrint;
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  blackjack: 'Blackjack!',
  bust: 'Bust',
  win: 'Win',
  lose: 'Lose',
  push: 'Push',
};

const OUTCOME_POLARITY: Record<Outcome, 'win' | 'lose' | 'push'> = {
  blackjack: 'win',
  win: 'win',
  bust: 'lose',
  lose: 'lose',
  push: 'push',
};

const DENOMS = [500, 100, 25, 5, 1] as const;
const MAX_CHIPS = 14;

// Greedy chip breakdown, capped so an absurd bet still renders as one stack.
export function chipsFor(amount: number): number[] {
  const out: number[] = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of DENOMS) {
    while (rest >= d && out.length < MAX_CHIPS) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

export function centreOf(points: readonly { x: number; z: number }[]): Vec2 | null {
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
  };
}

export interface SceneInput {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
}

// Every seat is dealt from one shoe against one dealer hand, so any round can
// supply the dealer; prefer the local player's, falling back to the first seat's
// (spectators).
export function pickDealerRound(
  rounds: Record<number, BlackjackRoundView> | null,
  mySeatIndex: number | null,
): BlackjackRoundView | undefined {
  if (!rounds) return undefined;
  return (mySeatIndex !== null ? rounds[mySeatIndex] : undefined) ?? Object.values(rounds)[0];
}

function seatStatus(seat: SeatView, round: BlackjackRoundView | undefined, isActive: boolean, isMe: boolean): string {
  // Same wording as the 2D BlackjackTable so both views tell the same story.
  if (!round) return seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
  if (!seat.connected) return 'Disconnected';
  if (round.phase === 'settled' && round.results) return round.results.map((r) => OUTCOME_LABELS[r.outcome]).join(' / ');
  const totalBet = round.playerHands.reduce((sum, hand) => sum + hand.bet, 0);
  return isActive ? (isMe ? 'Your turn' : 'Thinking…') : `Bet ${totalBet}`;
}

// Order players clockwise starting after the local player, so the table looks
// the same from every chair.
export function orderSeated<T extends { seatIndex: number }>(seated: T[], mySeatIndex: number | null, n: number): T[] {
  const rel = (s: T) => (mySeatIndex === null ? s.seatIndex : (s.seatIndex - mySeatIndex + n) % n);
  return [...seated].sort((a, b) => rel(a) - rel(b));
}

export function buildSceneModel(input: SceneInput): SceneModel {
  const { seats, activeSeatIndex, mySeatIndex, blackjackRounds } = input;
  const seated = seats.filter((s) => s.displayName).sort((a, b) => a.seatIndex - b.seatIndex);
  const n = Math.max(seats.length, 1);

  // Seats are laid out from the players dealt into the current hand (everyone seated between
  // hands), so the table never reshuffles mid-hand (spec §A1). The local player takes the
  // bottom-centre slot and the rest follow in seat order relative to them, so the table looks the
  // same from every chair; a spectator's first player takes the bottom centre.
  const dealtIn = blackjackRounds ? seated.filter((s) => blackjackRounds[s.seatIndex]) : seated;
  const layout = layoutSeats(
    'blackjack',
    orderSeated(dealtIn, mySeatIndex, n).map((s) => ({
      seatIndex: s.seatIndex,
      hands: blackjackRounds?.[s.seatIndex]?.playerHands.map((h) => h.cards.length) ?? [],
    })),
  );
  const placeOf = new Map(layout.map((l) => [l.seatIndex, l]));

  const cards: CardSlot[] = [];
  const chips: ChipStackModel[] = [];
  const outcomes: OutcomeLabel[] = [];
  const seatModels: SeatModel[] = [];

  const firstRound = pickDealerRound(blackjackRounds, mySeatIndex);

  if (firstRound) {
    // Dealer: upcard + face-down hole card until the dealer's full hand is revealed.
    const dealerHand: (Card | null)[] = firstRound.dealerCards ?? [firstRound.dealerUpcard, null];
    dealerCards(dealerHand.length).forEach((p, i) => {
      const key = `d:${i}`;
      cards.push({ key, card: dealerHand[i], x: p.x, y: TABLE_Y + 0.004 + i * 0.002, z: p.z, rotY: jitter(key, 0.05), order: i });
    });
  }
  let turnLight = firstRound?.phase === 'dealer' ? centreOf(cards) : null;

  for (const seat of seated) {
    const place = placeOf.get(seat.seatIndex);
    const isMe = seat.seatIndex === mySeatIndex;
    const round = blackjackRounds?.[seat.seatIndex];
    // A seat whose round has settled is done, even if the server still names it as active.
    const isActive = seat.seatIndex === activeSeatIndex && round?.phase !== 'settled';

    seatModels.push({
      seatIndex: seat.seatIndex,
      name: seat.displayName as string,
      // The server only debits a bet at settlement; while a hand is live show what is not at risk.
      balance: round && round.phase !== 'settled' ? seat.balance - round.playerHands.reduce((sum, h) => sum + h.bet, 0) : seat.balance,
      isMe,
      isActive,
      connected: seat.connected,
      status: seatStatus(seat, round, isActive, isMe),
      plate: place ? { x: place.plate.x, z: place.plate.z } : null,
    });

    if (!round || !place) continue;
    const seatCards: CardPlacement[] = [];
    round.playerHands.forEach((hand, h) => {
      const spots = place.hands[h];
      hand.cards.forEach((card, i) => {
        const key = `s${seat.seatIndex}:h${h}:c${i}`;
        const p = spots[i];
        seatCards.push(p);
        cards.push({ key, card, x: p.x, y: TABLE_Y + 0.004 + i * 0.002, z: p.z, rotY: p.rotY + jitter(key, 0.06), order: i });
      });
      const bet = place.bets[h];
      chips.push({ key: `bet:${seat.seatIndex}:h${h}`, amount: hand.bet, x: bet.x, z: bet.z });
      if (round.phase === 'settled' && round.results?.[h]) {
        const outcome = round.results[h].outcome;
        const at = centreOf(spots) ?? place.anchor;
        outcomes.push({
          key: `res:${seat.seatIndex}:h${h}`,
          seatIndex: seat.seatIndex,
          text: OUTCOME_LABELS[outcome],
          polarity: OUTCOME_POLARITY[outcome],
          x: at.x,
          z: at.z,
        });
      }
    });
    if (isActive) turnLight = centreOf(seatCards) ?? { x: place.anchor.x, z: place.anchor.z };
  }

  return {
    kind: 'blackjack',
    pot: null,
    cards,
    chips,
    seats: seatModels,
    outcomes,
    hasRound: !!firstRound,
    myTurn: mySeatIndex !== null && mySeatIndex === activeSeatIndex && blackjackRounds?.[mySeatIndex]?.phase !== 'settled',
    turnLight,
    felt: { kind: 'blackjack', rings: layout.map((l) => ({ x: l.betSpot.x, z: l.betSpot.z })) },
  };
}
