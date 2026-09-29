import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { Card, Outcome } from '@poker-blackjack/game-engine';

// Pure translation of a server snapshot into a declarative description of the
// 3D scene. Nothing here touches WebGL, so it is unit-testable and the
// animation reconciler in engine/SceneRoot can stay idempotent: the server
// only ever sends full snapshots (no "card dealt" events), so what happened is
// derived by diffing this model against the previous one, keyed by stable ids.

// Table is an ellipse: A = half-width (x), B = half-depth (z). The dealer sits
// at the far end (-z), the local player at the near end (+z, where the camera is).
export const TABLE_A = 1.2;
export const TABLE_B = 0.85;
export const TABLE_Y = 0.76;
export const CARD_W = 0.12;
export const CARD_H = 0.168;
export const CARD_STEP = 0.092;
export const HAND_GAP = 0.42;

// Angles in degrees, 0 = far (dealer), 90 = right, 180 = near (camera), 270 = left.
export const DEALER_SLOT = 0;
export const MY_SLOT = 180;
export const OTHER_SLOTS = [295, 65, 330, 30, 250];

const HAND_FACTOR = 0.55;
const RAIL_FACTOR = 1.02;
const BODY_FACTOR = 1.3;

export interface Vec2 {
  x: number;
  z: number;
}

export function slotPoint(angleDeg: number, factor: number): Vec2 {
  const r = (angleDeg * Math.PI) / 180;
  return { x: TABLE_A * factor * Math.sin(r), z: -TABLE_B * factor * Math.cos(r) };
}

// Direction along which cards in a hand fan out for a given slot.
function tangent(angleDeg: number): Vec2 {
  const r = (angleDeg * Math.PI) / 180;
  return { x: -Math.cos(r), z: -Math.sin(r) };
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
  angle: number;
  // Where the seated figure stands, and where its brass name plate sits.
  bodyX: number;
  bodyZ: number;
  plateX: number;
  plateZ: number;
}

export interface OutcomeLabel {
  key: string;
  seatIndex: number;
  text: string;
  polarity: 'win' | 'lose' | 'push';
  x: number;
  z: number;
}

export interface SceneModel {
  cards: CardSlot[];
  chips: ChipStackModel[];
  seats: SeatModel[];
  outcomes: OutcomeLabel[];
  hasRound: boolean;
  myTurn: boolean;
  dealerActive: boolean;
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

export interface SceneInput {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
}

function seatStatus(seat: SeatView, round: BlackjackRoundView | undefined, isActive: boolean, isMe: boolean): string {
  // Same wording as the 2D BlackjackTable so both views tell the same story.
  if (!round) return seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
  if (!seat.connected) return 'Disconnected';
  const totalBet = round.playerHands.reduce((sum, hand) => sum + hand.bet, 0);
  return isActive ? (isMe ? 'Your turn' : 'Thinking…') : `Bet ${totalBet}`;
}

export function buildSceneModel(input: SceneInput): SceneModel {
  const { seats, activeSeatIndex, mySeatIndex, blackjackRounds } = input;
  const seated = seats.filter((s) => s.displayName).sort((a, b) => a.seatIndex - b.seatIndex);
  const n = Math.max(seats.length, 1);

  // Local player is always the near slot; the rest are placed in seat order
  // relative to them so the table looks the same from every chair.
  const rel = (s: SeatView) => (mySeatIndex === null ? s.seatIndex : (s.seatIndex - mySeatIndex + n) % n);
  const ordered = [...seated].sort((a, b) => rel(a) - rel(b));
  const slotOf = new Map<number, number>();
  // A spectator has no chair of their own, so the near slot is free for the first player.
  const free = mySeatIndex === null ? [MY_SLOT, ...OTHER_SLOTS] : [...OTHER_SLOTS];
  for (const s of ordered) {
    if (s.seatIndex === mySeatIndex) slotOf.set(s.seatIndex, MY_SLOT);
    else slotOf.set(s.seatIndex, free.shift() ?? MY_SLOT);
  }

  const cards: CardSlot[] = [];
  const chips: ChipStackModel[] = [];
  const outcomes: OutcomeLabel[] = [];
  const seatModels: SeatModel[] = [];

  const firstRound = blackjackRounds ? Object.values(blackjackRounds)[0] : undefined;

  if (firstRound) {
    // Dealer: upcard + face-down hole card until the dealer's full hand is revealed.
    const dealerCards: (Card | null)[] = firstRound.dealerCards ?? [firstRound.dealerUpcard, null];
    const c = slotPoint(DEALER_SLOT, 0.52);
    dealerCards.forEach((card, i) => {
      const key = `d:${i}`;
      cards.push({
        key,
        card,
        x: c.x + (i - (dealerCards.length - 1) / 2) * CARD_STEP,
        y: TABLE_Y + 0.004 + i * 0.002,
        z: c.z,
        rotY: jitter(key, 0.05),
        order: i,
      });
    });
  }

  for (const seat of seated) {
    const angle = slotOf.get(seat.seatIndex) ?? MY_SLOT;
    const isMe = seat.seatIndex === mySeatIndex;
    const isActive = seat.seatIndex === activeSeatIndex;
    const round = blackjackRounds?.[seat.seatIndex];

    const body = slotPoint(angle, BODY_FACTOR);
    const plate = slotPoint(angle, RAIL_FACTOR + 0.03);
    seatModels.push({
      seatIndex: seat.seatIndex,
      name: seat.displayName as string,
      balance: seat.balance,
      isMe,
      isActive,
      connected: seat.connected,
      status: seatStatus(seat, round, isActive, isMe),
      angle,
      bodyX: body.x,
      bodyZ: body.z,
      plateX: plate.x,
      plateZ: plate.z,
    });

    if (!round) continue;
    const centre = slotPoint(angle, HAND_FACTOR);
    const t = tangent(angle);
    const toOwner = { x: Math.sin((angle * Math.PI) / 180), z: -Math.cos((angle * Math.PI) / 180) };
    const handCount = round.playerHands.length;
    // Cards are turned partly toward their owner, but only partly, so every
    // hand stays legible from the camera.
    const facing = ((180 - angle) * Math.PI) / 180 * 0.35;

    round.playerHands.forEach((hand, h) => {
      const handOff = (h - (handCount - 1) / 2) * (HAND_GAP + hand.cards.length * 0.02);
      const hx = centre.x + t.x * handOff;
      const hz = centre.z + t.z * handOff;
      hand.cards.forEach((card, i) => {
        const key = `s${seat.seatIndex}:h${h}:c${i}`;
        const off = (i - (hand.cards.length - 1) / 2) * CARD_STEP;
        cards.push({
          key,
          card,
          x: hx + t.x * off,
          y: TABLE_Y + 0.004 + i * 0.002,
          z: hz + t.z * off,
          rotY: facing + jitter(key, 0.06),
          order: i,
        });
      });
      // Bet stack sits between the hand and its owner, a little to one side.
      chips.push({
        key: `bet:${seat.seatIndex}:h${h}`,
        amount: hand.bet,
        x: hx + toOwner.x * 0.2 - t.x * 0.14,
        z: hz + toOwner.z * 0.2 - t.z * 0.14,
      });
      if (round.phase === 'settled' && round.results?.[h]) {
        const outcome = round.results[h].outcome;
        outcomes.push({
          key: `res:${seat.seatIndex}:h${h}`,
          seatIndex: seat.seatIndex,
          text: OUTCOME_LABELS[outcome],
          polarity: OUTCOME_POLARITY[outcome],
          x: hx,
          z: hz,
        });
      }
    });
  }

  return {
    cards,
    chips,
    seats: seatModels,
    outcomes,
    hasRound: !!firstRound,
    myTurn: mySeatIndex !== null && mySeatIndex === activeSeatIndex,
    dealerActive: firstRound?.phase === 'dealer',
  };
}
