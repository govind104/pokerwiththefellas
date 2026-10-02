// Where every seat, hand, bet and board card sits on the felt (3D readability spec §A1). Pure
// geometry with no WebGL, so it is unit-tested directly.
//
// The felt is an ellipse with half-axes TABLE_A (x) and TABLE_B (z) at height TABLE_Y; the far
// side is -z and the camera looks from +z. Seats are placed by distance along a smaller "hand"
// ellipse, not by angle: equal angles on an ellipse give unequal gaps.

export const TABLE_A = 1.2;
export const TABLE_B = 0.85;
export const TABLE_Y = 0.76;
export const CARD_W = 0.15;
export const CARD_H = 0.21;
// The chip mesh in engine/chips.ts uses this too.
export const CHIP_R = 0.024;

export type TableKind = 'blackjack' | 'holdem';

// Settled at Gate 1. The prototype's 0.8 put Hold'em hands at the far-right seats under the
// top-right HUD zone and pushed long Blackjack fans off the felt.
export const HAND_FACTOR: Record<TableKind, number> = { holdem: 0.76, blackjack: 0.72 };
export const BET_FACTOR = 0.56;
export const PLATE_FACTOR = 1.05;
export const CARD_STEP: Record<TableKind, number> = { holdem: 0.2, blackjack: 0.155 };
// A crowded seat closes its fan down to this step, which still shows each covered card's corner index.
export const CARD_STEP_MIN = 0.06;
const STEP_SHRINK = 0.01;
// Space between the two hands of a split: 0.14 at full step puts their centres ~0.45 apart (spec §A1).
const SPLIT_GAP = 0.14;
const SPLIT_GAP_MIN = 0.04;
// Blackjack seats spread up to this far round from the bottom centre (ellipse-parameter degrees),
// at most BJ_STEP_MAX_DEG apart. The spec's ~100 degrees left no room for a split at six seats.
const BJ_ARC_END_DEG = 120;
const BJ_STEP_MAX_DEG = 45;
// Kept between different seats' cards, so the per-card jitter in the scene models can't make them touch.
const SEAT_CLEARANCE = 0.012;
// Cards turn partly toward their owner, but only partly, so every hand stays legible from the camera.
const FACING = 0.35;

export const BOARD_STEP = 0.19;
export const BOARD_Z = 0;
export const POT_SPOT = { x: 0, z: -0.25 } as const;
// Where Hold'em cards wait before their turn to be dealt (SceneRoot spawns them here, on the felt).
// Off-axis on the dealer side so it is clear of the pot, the board, every bet spot (the far-centre
// seat's bet spot is on the z axis at 2, 4 and 6 players) and every hole card for 2 to 6 players.
export const DECK_SPOT = { x: 0.25, z: -0.32 } as const;
export const DEALER_STEP = 0.155;
export const DEALER_Z = -TABLE_B * 0.62;

export interface Ellipse {
  a: number;
  b: number;
  perimeter: number;
  theta: Float64Array;
  arc: Float64Array;
}

const SAMPLES = 1440;
const ellipses = new Map<number, Ellipse>();

// The ellipse at `factor` of the felt, sampled by arc length. Arc is measured from the bottom
// centre (nearest the camera, parameter theta = PI) and grows clockwise seen from above with the
// camera at the bottom: the left side first, then the far side, then the right.
export function ellipse(factor: number): Ellipse {
  const hit = ellipses.get(factor);
  if (hit) return hit;
  const a = TABLE_A * factor;
  const b = TABLE_B * factor;
  const theta = new Float64Array(SAMPLES + 1);
  const arc = new Float64Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    theta[i] = Math.PI + (i / SAMPLES) * 2 * Math.PI;
    if (i > 0) {
      arc[i] =
        arc[i - 1] +
        Math.hypot(a * (Math.sin(theta[i]) - Math.sin(theta[i - 1])), b * (Math.cos(theta[i]) - Math.cos(theta[i - 1])));
    }
  }
  const e = { a, b, perimeter: arc[SAMPLES], theta, arc };
  ellipses.set(factor, e);
  return e;
}

export interface TablePoint {
  x: number;
  z: number;
  // The yaw that turns a card here partly toward its owner.
  facing: number;
}

export function pointAt(e: Ellipse, s: number): TablePoint {
  const p = e.perimeter;
  const at = ((s % p) + p) % p;
  let lo = 0;
  let hi = SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (e.arc[mid] <= at) lo = mid;
    else hi = mid;
  }
  const t = e.theta[lo] + ((at - e.arc[lo]) / (e.arc[hi] - e.arc[lo])) * (e.theta[hi] - e.theta[lo]);
  // How far round from the bottom centre, in (-PI, PI]: positive on the left, negative on the right.
  let rel = t - Math.PI;
  if (rel > Math.PI) rel -= 2 * Math.PI;
  return { x: e.a * Math.sin(t), z: -e.b * Math.cos(t), facing: -rel * FACING };
}

// Arc length from the bottom centre to `deg` degrees of the ellipse parameter.
export function arcToAngle(e: Ellipse, deg: number): number {
  return e.arc[Math.round((deg / 360) * SAMPLES)];
}

// Arc positions of the seat slots on the hand ellipse, in table order: slot 0 is the bottom centre
// (the local player), then the others in cyclic seat order after it.
export function slotArcs(kind: TableKind, n: number): number[] {
  const e = ellipse(HAND_FACTOR[kind]);
  if (kind === 'holdem') return Array.from({ length: n }, (_, k) => (k * e.perimeter) / n);
  // Blackjack keeps everyone on the near half, facing the dealer: alternate left and right of the
  // bottom centre, the extra player of an even count on the left. Left slots fill from the centre
  // outward, then right slots from the outermost inward, so seat order runs round the table.
  const left = Math.ceil((n - 1) / 2);
  const right = n - 1 - left;
  const step = Math.min(arcToAngle(e, BJ_ARC_END_DEG) / Math.max(left, 1), arcToAngle(e, BJ_STEP_MAX_DEG));
  const out = [0];
  for (let j = 1; j <= left; j++) out.push(j * step);
  for (let j = right; j >= 1; j--) out.push(-j * step);
  return out;
}

export interface CardPlacement {
  x: number;
  z: number;
  rotY: number;
}

export interface SeatLayoutInput {
  seatIndex: number;
  // Cards in each hand; [] for a seat with no cards (waiting, or folded).
  hands: number[];
}

export interface SeatLayout {
  seatIndex: number;
  anchor: TablePoint;
  // Where a single bet sits, and where Blackjack prints the seat's betting ring.
  betSpot: TablePoint;
  // On the rail, for the projected name plate.
  plate: TablePoint;
  step: number;
  hands: CardPlacement[][];
  bets: TablePoint[];
}

// A card lying flat with yaw rotY: u is its width axis and v its height axis, as (x, z).
function axes(rotY: number): [[number, number], [number, number]] {
  return [
    [Math.cos(rotY), -Math.sin(rotY)],
    [-Math.sin(rotY), -Math.cos(rotY)],
  ];
}

// Half the size of a card along the unit direction (dx, dz).
export function cardExtent(rotY: number, dx: number, dz: number): number {
  const [u, v] = axes(rotY);
  return (CARD_W / 2) * Math.abs(u[0] * dx + u[1] * dz) + (CARD_H / 2) * Math.abs(v[0] * dx + v[1] * dz);
}

// Separating-axis test on two cards' rectangles, each grown by `pad` on every side.
export function cardsOverlap(a: CardPlacement, b: CardPlacement, pad = 0): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ax, az] of [...axes(a.rotY), ...axes(b.rotY)]) {
    if (Math.abs(dx * ax + dz * az) >= cardExtent(a.rotY, ax, az) + cardExtent(b.rotY, ax, az) + 2 * pad) return false;
  }
  return true;
}

export function cardCorners(c: CardPlacement): [number, number][] {
  const [u, v] = axes(c.rotY);
  const out: [number, number][] = [];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      out.push([c.x + (su * u[0] * CARD_W + sv * v[0] * CARD_H) / 2, c.z + (su * u[1] * CARD_W + sv * v[1] * CARD_H) / 2]);
    }
  }
  return out;
}

export function chipTouchesCard(chip: { x: number; z: number }, c: CardPlacement): boolean {
  const [u, v] = axes(c.rotY);
  const dx = chip.x - c.x;
  const dz = chip.z - c.z;
  const pu = Math.max(-CARD_W / 2, Math.min(CARD_W / 2, dx * u[0] + dz * u[1]));
  const pv = Math.max(-CARD_H / 2, Math.min(CARD_H / 2, dx * v[0] + dz * v[1]));
  return Math.hypot(dx - pu * u[0] - pv * v[0], dz - pu * u[1] - pv * v[1]) < CHIP_R;
}

export function insideFelt(x: number, z: number, factor: number): boolean {
  return (x / (TABLE_A * factor)) ** 2 + (z / (TABLE_B * factor)) ** 2 <= 1;
}

function placeHands(
  kind: TableKind,
  e: Ellipse,
  arc: number,
  hands: readonly number[],
  step: number,
): { cards: CardPlacement[][]; centres: number[] } {
  // Half a card's size along the fan. On the sides, where cards are turned toward their owner,
  // that is more than CARD_W / 2.
  const p = pointAt(e, arc);
  const q = pointAt(e, arc + 0.01);
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const half = cardExtent(p.facing, (q.x - p.x) / len, (q.z - p.z) / len);
  const widths = hands.map((k) => Math.max(0, k - 1) * step + 2 * half);
  const gap = Math.max(SPLIT_GAP_MIN, SPLIT_GAP * (step / CARD_STEP[kind]));
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, hands.length - 1);
  const centres: number[] = [];
  let cursor = -total / 2;
  for (const w of widths) {
    centres.push(cursor + w / 2);
    cursor += w + gap;
  }
  // Arc grows toward the camera's left at the bottom seat, so a card further along the fan is at a
  // smaller arc: hands and cards read left to right for the seat's owner.
  const cards = hands.map((k, h) =>
    Array.from({ length: k }, (_, i) => {
      const c = pointAt(e, arc - (centres[h] + (i - (k - 1) / 2) * step));
      return { x: c.x, z: c.z, rotY: c.facing };
    }),
  );
  return { cards, centres };
}

function crowdedSeats(placed: CardPlacement[][][]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const mine = placed[i].flat();
      const theirs = placed[j].flat();
      if (mine.some((a) => theirs.some((b) => cardsOverlap(a, b, SEAT_CLEARANCE)))) {
        out.add(i);
        out.add(j);
      }
    }
  }
  return out;
}

// Seats in slot order (slot 0 is the bottom centre). Slots depend only on how many seats there
// are; the card step also depends on the hands, so a fan can close up as a neighbour's hand grows.
export function layoutSeats(kind: TableKind, seats: readonly SeatLayoutInput[]): SeatLayout[] {
  const hand = ellipse(HAND_FACTOR[kind]);
  const arcs = slotArcs(kind, seats.length);
  const steps = seats.map(() => CARD_STEP[kind]);
  const place = (i: number) => placeHands(kind, hand, arcs[i], seats[i].hands, steps[i]);
  const placed = seats.map((_, i) => place(i));
  // Close up the crowded seats' fans a little at a time until no two seats' cards touch, or every
  // crowded seat is already at the minimum step.
  for (;;) {
    let changed = false;
    for (const i of crowdedSeats(placed.map((p) => p.cards))) {
      if (steps[i] <= CARD_STEP_MIN) continue;
      steps[i] = Math.max(CARD_STEP_MIN, steps[i] - STEP_SHRINK);
      placed[i] = place(i);
      changed = true;
    }
    if (!changed) break;
  }
  const bet = ellipse(BET_FACTOR);
  const plate = ellipse(PLATE_FACTOR);
  // The hand, bet and plate ellipses are scaled copies, so the same fraction of the way round is
  // the same direction from the centre.
  const on = (e: Ellipse, handArc: number) => pointAt(e, (handArc / hand.perimeter) * e.perimeter);
  return seats.map((s, i) => ({
    seatIndex: s.seatIndex,
    anchor: pointAt(hand, arcs[i]),
    betSpot: on(bet, arcs[i]),
    plate: on(plate, arcs[i]),
    step: steps[i],
    hands: placed[i].cards,
    bets: placed[i].centres.map((c) => on(bet, arcs[i] - c)),
  }));
}

// Community cards keep their slot as the board grows: the flop fills the left three.
export function boardCards(count: number): CardPlacement[] {
  return Array.from({ length: count }, (_, i) => ({ x: (i - 2) * BOARD_STEP, z: BOARD_Z, rotY: 0 }));
}

export function dealerCards(count: number): CardPlacement[] {
  return Array.from({ length: count }, (_, i) => ({ x: (i - (count - 1) / 2) * DEALER_STEP, z: DEALER_Z, rotY: 0 }));
}
