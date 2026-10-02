# 3D Table Readability, Plan A (the 3D scene) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3D Blackjack and Hold'em tables readable: a fixed three-quarter camera with computed framing, no figures or props, seats spread by rail distance, a centred board, big-index card faces, printed felt and a turn light.

**Architecture:** All table geometry moves into a pure, unit-tested `three/layout.ts` (seat slots by arc length, card fans, bets, board, dealer) plus `three/cameraFit.ts` (pure camera framing) and `three/hudZones.ts` (screen rectangles Plan B's HUD will use). `sceneModel.ts` / `pokerModel.ts` turn snapshots into placements through `layout.ts`; `engine/SceneRoot.ts` and `engine/room.ts` lose the figures, props, lamp meshes and camera motion, and gain a static fitted camera, a printed felt texture and a turn spotlight. Canvas drawing (faces, felt) is split into pure painters tested against a recording 2D context.

**Tech Stack:** TypeScript, React 18, three.js 0.180, Vitest + jsdom + Testing Library. Run from the repo root.

**Spec:** `docs/superpowers/specs/2026-10-02-3d-table-readability-design.md` (sections §5 A1–A6, §7 gates 1–2). Reference prototype: `docs/superpowers/specs/2026-10-02-3d-table-readability/prototype-runtime-patch.js`.

## Global Constraints

- Geometry is in metres. Felt ellipse half-axes `TABLE_A` 1.2 (x), `TABLE_B` 0.85 (z), at `TABLE_Y` 0.76. The far side is −z; the camera looks from +z.
- Camera: fixed, 50° down, 35° vertical FOV, 0.05 frame margin. At 16:9 the fit is position (0, 2.59, 1.808), look (0, 0.76, 0.272). No lean, no pointer parallax, no idle sway.
- HUD-safe zones (fractions of the viewport from its top-left, 16:9 reference): players bottom-left 25% wide × 32% tall; table panel top-right 26% × 20%; actions bottom-right 15% × 26%.
- Card faces: parchment `#e4d5ad` plus the existing `age()` pass; red `#a3221b`, black `#1b1410`; rank in bold Georgia; symbol font stack `"Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Symbols", serif`; a missing glyph falls back to the letter. Faces are drawn synchronously (no SVG load).
- Felt print: 2048×1451 canvas, `repeat (1/2.4, 1/1.7)`, `offset (0.5, 0.5)`, clamped; canvas pixel for world (x, z) is `((x + 1.2) / 2.4 · W, (z + 0.85) / 1.7 · H)`. Ink `rgba(232, 205, 140, 0.5)`, Georgia.
- Unchanged: the 2D view (`components/Card.tsx` keeps its SVGs), card backs, the room shell. (The shoe and tray were removed after Gate 1: deviation 8.) The projected 3D name plates, pot label and outcome labels stay until Plan B.
- Out of scope: the room, the 2D view, phones (the 3D view only opens at ≥ 900 px wide), the HUD and showdown highlight (Plan B).
- Every task is test-first where a test is possible. When a new test passes at once (coverage for code that already works), temporarily remove the code it guards, watch it fail, then restore it. WebGL code (`SceneRoot`, `room`) has no unit tests: it is checked by typecheck, the full suite, and the gates.
- Commands (repo root): all tests `npm test`; frontend only `npm test --workspace=@poker-blackjack/frontend`; one file `npx vitest run <path relative to packages/frontend> --root packages/frontend`; typecheck `npm run typecheck`. Both must be green at every commit.
- Implementers do **not** `git add` or commit. The controller reviews, then **asks the user before every commit** and commits code plus the ticked plan together. Never push.
- Code comments: match the surrounding files (they explain *why*). Cite the spec section (e.g. "spec §A1") where a number comes from the spec.
- Tool inputs decode `\uXXXX` escapes into real characters. Never write `\u` escapes in code: write the real character (♥ ♦ ♣ ♠ ♞ ♛ ♚) or use `String.fromCodePoint(0x...)`.

## Deviations from the spec (decided while planning, with numbers from a prototype run)

The spec says its tuned values are "starting points, settled at Gate 1". A numeric run of the layout and camera fit (scratch prototype, all cases in Task 2's property test) changed these:

1. **Hand ellipse 0.76 (Hold'em) and 0.72 (Blackjack), not ~0.8.** At 0.8, Hold'em hands at the far-right seats (3 and 6 players) fall under the top-right HUD zone, and long Blackjack fans leave the felt.
2. **Blackjack seats spread up to 120° round from the bottom (spec ~100°), still at most 45° apart.** This only changes 6 players (40° steps instead of 34°) and gives a split room.
3. **Fans follow the hand ellipse** instead of a straight tangent line (long hands stay on the felt), and **a crowded seat closes its fan** (card step down to 0.06 m, which still shows each covered card's corner index) until no two seats' cards touch.
4. **Split hands sit 0.14 m apart at full step** (centres ≈ 0.45 m apart, as in the spec), the gap shrinking with the step.
5. **Property test scope.** A split with 4-card hands is tested at 2–5 players; at 6 players the split is tested with 2-card hands. At 6 players a split into 3+-card hands cannot fit (0.15 m cards, ~0.55 m between seats): those cards may touch a neighbour's. Rare; noted in HANDOFF.
6. **Hold'em betting line at 0.61 of the felt (spec ~0.68).** At 0.68 it would run under the hole cards now that hands sit at 0.76.
7. **Turn light glide is exponential** (time constant 0.12 s, 95% there in ≈ 0.36 s) rather than a fixed 0.4 s tween, so a retarget mid-glide never jumps.
8. **No dealing shoe or discard tray** (user decision at Gate 1, 2026-10-02): the two Blackjack boxes were clutter. Cards are still dealt from and swept to the same points beside the dealer, with nothing drawn there (Task 5b).

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/frontend/src/three/layout.ts` | create | Table constants; ellipse arc sampling; seat slots; card fans with crowd compression; bets, plates, board, dealer, pot spots; rectangle-overlap helpers |
| `packages/frontend/src/three/layout.test.ts` | create | Unit tests for the above |
| `packages/frontend/src/three/cameraFit.ts` | create | `fitCamera(aspect)`, `cameraFor`, `projectToScreen`, the framing outline |
| `packages/frontend/src/three/hudZones.ts` | create | `HUD_ZONES`, `hudZoneAt` |
| `packages/frontend/src/three/cameraFit.test.ts` | create | Fit at 16:9, 4:3, 21:9; HUD zone lookup |
| `packages/frontend/src/three/layout.property.test.ts` | create | Spec A1 no-overlap / on-felt / HUD-clear property test |
| `packages/frontend/src/three/engine/chips.ts` | modify | Import `CHIP_R` from `layout.ts` |
| `packages/frontend/src/three/engine/SceneRoot.ts` | modify | Static fitted camera; no figures or motion (Task 3); felt print (Task 6); turn light (Task 7) |
| `packages/frontend/src/three/engine/room.ts` | modify | Remove props, lamp meshes, smoke; `setFeltPrint` (Task 6) |
| `packages/frontend/src/three/engine/silhouette.ts` | delete | Figures are gone |
| `packages/frontend/src/three/engine/textures.ts` | modify | Drop `smokeTexture` and the SVG face loader; synchronous faces; `printedFeltTexture` |
| `packages/frontend/src/three/sceneModel.ts` / `pokerModel.ts` | modify | Use `layout.ts`; `plate`, `turnLight`, `felt` fields; drop angles/bodies/figure fields |
| `packages/frontend/src/three/sceneModel.test.ts` / `pokerModel.test.ts` / `Poker3D.test.tsx` | modify | Follow the model changes |
| `packages/frontend/src/three/TableStage.tsx` | modify | Plates only for seats with a `plate` |
| `packages/frontend/src/three/devHarness.tsx` | modify | Steps for 2/3/6 players, splits, acting seats, the dealer |
| `packages/frontend/src/three/testCanvas.ts` | create | Recording 2D context for painter tests |
| `packages/frontend/src/three/engine/cardFace.ts` (+ `.test.ts`) | create | Big-index face painter and glyph check |
| `packages/frontend/src/three/engine/cards.ts` | modify | `setCard(card)` without the load callback |
| `packages/frontend/src/three/engine/feltPrint.ts` (+ `.test.ts`) | create | Felt pixel mapping and painter |
| `packages/frontend/src/three/engine/turnLight.ts` (+ `.test.ts`) | create | Pure glide/fade step for the turn light |

---

### Task 1: Table layout module

**Files:**
- Create: `packages/frontend/src/three/layout.ts`
- Create: `packages/frontend/src/three/layout.test.ts`
- Modify: `packages/frontend/src/three/engine/chips.ts:6` (use the shared `CHIP_R`)

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - constants `TABLE_A`, `TABLE_B`, `TABLE_Y`, `CARD_W`, `CARD_H`, `CHIP_R`, `HAND_FACTOR: Record<TableKind, number>`, `BET_FACTOR`, `PLATE_FACTOR`, `CARD_STEP: Record<TableKind, number>`, `CARD_STEP_MIN`, `BOARD_STEP`, `BOARD_Z`, `POT_SPOT: { x: number; z: number }`, `DEALER_STEP`, `DEALER_Z`
  - `type TableKind = 'blackjack' | 'holdem'`
  - `interface Ellipse { a: number; b: number; perimeter: number; theta: Float64Array; arc: Float64Array }`, `ellipse(factor: number): Ellipse`
  - `interface TablePoint { x: number; z: number; facing: number }`, `pointAt(e: Ellipse, s: number): TablePoint`, `arcToAngle(e: Ellipse, deg: number): number`
  - `slotArcs(kind: TableKind, n: number): number[]`
  - `interface CardPlacement { x: number; z: number; rotY: number }`
  - `interface SeatLayoutInput { seatIndex: number; hands: number[] }` (card count per hand; `[]` = seated, no cards)
  - `interface SeatLayout { seatIndex: number; anchor: TablePoint; betSpot: TablePoint; plate: TablePoint; step: number; hands: CardPlacement[][]; bets: TablePoint[] }`
  - `layoutSeats(kind: TableKind, seats: readonly SeatLayoutInput[]): SeatLayout[]` (input in slot order: slot 0 = bottom centre)
  - `boardCards(count: number): CardPlacement[]`, `dealerCards(count: number): CardPlacement[]`
  - `cardExtent(rotY, dx, dz): number`, `cardsOverlap(a, b, pad = 0): boolean`, `cardCorners(c): [number, number][]`, `chipTouchesCard(chip: { x: number; z: number }, c): boolean`, `insideFelt(x, z, factor): boolean`

- [x] **Step 1: Write the failing tests**

Create `packages/frontend/src/three/layout.test.ts`:

```ts
import {
  CARD_STEP,
  CARD_STEP_MIN,
  HAND_FACTOR,
  TABLE_A,
  TABLE_B,
  arcToAngle,
  boardCards,
  cardsOverlap,
  dealerCards,
  ellipse,
  insideFelt,
  layoutSeats,
  pointAt,
  slotArcs,
} from './layout';

const seats = (hands: number[][]) => hands.map((h, seatIndex) => ({ seatIndex, hands: h }));

describe('ellipse sampling', () => {
  it('measures the felt perimeter (Ramanujan approximation)', () => {
    const a = TABLE_A;
    const b = TABLE_B;
    const ramanujan = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    expect(ellipse(1).perimeter).toBeCloseTo(ramanujan, 3);
  });

  it('starts at the bottom centre and runs left, far, right', () => {
    const e = ellipse(1);
    const bottom = pointAt(e, 0);
    expect(bottom.x).toBeCloseTo(0, 6);
    expect(bottom.z).toBeCloseTo(TABLE_B, 6);
    expect(bottom.facing).toBeCloseTo(0, 6);
    const left = pointAt(e, e.perimeter / 4);
    expect(left.x).toBeCloseTo(-TABLE_A, 3);
    expect(left.z).toBeCloseTo(0, 3);
    // Cards turn partly (35%) toward their owner: a quarter turn round is -0.35 * 90 degrees.
    expect(left.facing).toBeCloseTo(-0.35 * (Math.PI / 2), 3);
    const far = pointAt(e, e.perimeter / 2);
    expect(far.z).toBeCloseTo(-TABLE_B, 3);
    const right = pointAt(e, -e.perimeter / 4);
    expect(right.x).toBeCloseTo(TABLE_A, 3);
    expect(right.facing).toBeCloseTo(0.35 * (Math.PI / 2), 3);
  });

  it('converts parameter-angle degrees to arc length', () => {
    const e = ellipse(1);
    expect(arcToAngle(e, 0)).toBe(0);
    expect(arcToAngle(e, 90)).toBeCloseTo(e.perimeter / 4, 3);
    expect(arcToAngle(e, 360)).toBeCloseTo(e.perimeter, 6);
  });
});

describe('slotArcs', () => {
  it("spaces Hold'em seats at equal arc length round the whole table", () => {
    const arcs = slotArcs('holdem', 6);
    const p = ellipse(HAND_FACTOR.holdem).perimeter;
    expect(arcs).toHaveLength(6);
    arcs.forEach((s, k) => expect(s).toBeCloseTo((k * p) / 6, 9));
  });

  it('puts the extra Blackjack player on the left with an even count, at equal steps', () => {
    const e = ellipse(HAND_FACTOR.blackjack);
    const six = slotArcs('blackjack', 6);
    const step = arcToAngle(e, 120) / 3; // 40 degrees of arc, under the 45 degree cap
    expect(six).toHaveLength(6);
    [0, step, 2 * step, 3 * step, -2 * step, -step].forEach((s, i) => expect(six[i]).toBeCloseTo(s, 9));
    expect(six.filter((s) => s > 0)).toHaveLength(3);
    expect(six.filter((s) => s < 0)).toHaveLength(2);
  });

  it("caps the Blackjack step so two or three players aren't flung to the ends", () => {
    const cap = arcToAngle(ellipse(HAND_FACTOR.blackjack), 45);
    expect(slotArcs('blackjack', 2)).toEqual([0, cap]);
    expect(slotArcs('blackjack', 3)).toEqual([0, cap, -cap]);
    expect(slotArcs('blackjack', 1)).toEqual([0]);
  });
});

describe('layoutSeats', () => {
  it('reads a hand left to right from the camera at the bottom seat, at the full step', () => {
    const [me] = layoutSeats('blackjack', seats([[3]]));
    expect(me.anchor.x).toBeCloseTo(0, 6);
    expect(me.anchor.z).toBeGreaterThan(0);
    const [c0, c1, c2] = me.hands[0];
    expect(c0.x).toBeLessThan(c1.x);
    expect(c1.x).toBeLessThan(c2.x);
    expect(me.step).toBe(CARD_STEP.blackjack);
    expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeCloseTo(CARD_STEP.blackjack, 2);
  });

  it('puts the second slot on the left and the last on the right', () => {
    const out = layoutSeats('holdem', seats([[2], [2], [2], [2]]));
    expect(out[1].anchor.x).toBeLessThan(0);
    expect(out[2].anchor.z).toBeLessThan(0);
    expect(out[3].anchor.x).toBeGreaterThan(0);
    expect(out.map((s) => s.seatIndex)).toEqual([0, 1, 2, 3]);
  });

  it('lays a split side by side, the first hand on the left, with one bet per hand', () => {
    const [me] = layoutSeats('blackjack', seats([[2, 2]]));
    const centre = (cards: { x: number }[]) => cards.reduce((s, c) => s + c.x, 0) / cards.length;
    expect(me.hands).toHaveLength(2);
    expect(centre(me.hands[0])).toBeLessThan(centre(me.hands[1]));
    expect(centre(me.hands[1]) - centre(me.hands[0])).toBeCloseTo(0.45, 1);
    expect(me.bets).toHaveLength(2);
    expect(me.bets[0].x).toBeLessThan(me.bets[1].x);
    expect(cardsOverlap(me.hands[0][1], me.hands[1][0])).toBe(false);
  });

  it('closes up crowded fans until no two seats touch, never below the minimum step', () => {
    const out = layoutSeats('blackjack', seats([[5], [5], [5], [5], [5], [5]]));
    expect(Math.min(...out.map((s) => s.step))).toBeLessThan(CARD_STEP.blackjack);
    out.forEach((s) => expect(s.step).toBeGreaterThanOrEqual(CARD_STEP_MIN));
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        for (const a of out[i].hands.flat()) for (const b of out[j].hands.flat()) expect(cardsOverlap(a, b)).toBe(false);
  });

  it('gives a seat with no cards no hands and no bets, but still a bet spot and a plate on the rail', () => {
    const [s] = layoutSeats('holdem', seats([[]]));
    expect(s.hands).toEqual([]);
    expect(s.bets).toEqual([]);
    expect(insideFelt(s.betSpot.x, s.betSpot.z, 1)).toBe(true);
    expect(insideFelt(s.plate.x, s.plate.z, 1)).toBe(false);
  });
});

describe('fixed spots', () => {
  it('keeps board slots fixed as the board grows, centred on the table', () => {
    expect(boardCards(3).map((c) => c.x)).toEqual(boardCards(5).slice(0, 3).map((c) => c.x));
    expect(boardCards(5)[2]).toEqual({ x: 0, z: 0, rotY: 0 });
  });

  it("centres the dealer's cards toward the far rail", () => {
    const d = dealerCards(2);
    expect(d[0].x).toBeCloseTo(-d[1].x, 9);
    expect(d[0].z).toBeCloseTo(-TABLE_B * 0.62, 9);
  });
});

describe('cardsOverlap', () => {
  it('uses the real rectangles, with optional padding', () => {
    const a = { x: 0, z: 0, rotY: 0 };
    expect(cardsOverlap(a, { x: 0.149, z: 0, rotY: 0 })).toBe(true);
    expect(cardsOverlap(a, { x: 0.151, z: 0, rotY: 0 })).toBe(false);
    expect(cardsOverlap(a, { x: 0.16, z: 0, rotY: 0 }, 0.006)).toBe(true);
    // Turned a quarter, a card is 0.21 wide along x.
    expect(cardsOverlap(a, { x: 0.17, z: 0, rotY: Math.PI / 2 })).toBe(true);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/three/layout.test.ts --root packages/frontend`
Expected: FAIL, "Failed to resolve import './layout'".

- [x] **Step 3: Write the implementation**

Create `packages/frontend/src/three/layout.ts`:

```ts
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
```

In `packages/frontend/src/three/engine/chips.ts`, replace

```ts
import { TABLE_Y, chipsFor } from '../sceneModel';
```
with
```ts
import { CHIP_R } from '../layout';
import { TABLE_Y, chipsFor } from '../sceneModel';
```
and delete the line `const CHIP_R = 0.024;`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/three/layout.test.ts --root packages/frontend`
Expected: PASS (all tests). Then `npm run typecheck`: clean.

- [x] **Step 5: Commit (controller, after the user says yes)**

```bash
git add packages/frontend/src/three/layout.ts packages/frontend/src/three/layout.test.ts packages/frontend/src/three/engine/chips.ts docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): table layout by rail distance (spec A1)"
```

---

### Task 2: Camera fit, HUD zones and the layout property test

**Files:**
- Create: `packages/frontend/src/three/cameraFit.ts`
- Create: `packages/frontend/src/three/hudZones.ts`
- Create: `packages/frontend/src/three/cameraFit.test.ts`
- Create: `packages/frontend/src/three/layout.property.test.ts`

**Interfaces:**
- Consumes: from Task 1 `TABLE_Y`, `layoutSeats`, `boardCards`, `dealerCards`, `POT_SPOT`, `cardsOverlap`, `cardCorners`, `chipTouchesCard`, `insideFelt`, `TableKind`.
- Produces:
  - `CAMERA_PITCH_DEG = 50`, `CAMERA_FOV_DEG = 35`, `FRAME_MARGIN = 0.05`
  - `interface CameraFit { fov: number; position: THREE.Vector3; look: THREE.Vector3 }`
  - `fitCamera(aspect: number): CameraFit`
  - `frameOutline(): readonly THREE.Vector3[]`
  - `cameraFor(fit: CameraFit, aspect: number): THREE.PerspectiveCamera`
  - `projectToScreen(cam: THREE.PerspectiveCamera, x: number, y: number, z: number): { sx: number; sy: number }` (0..1 from the top-left)
  - `interface HudZone { name: 'players' | 'table' | 'actions'; x: number; y: number; w: number; h: number }`, `HUD_ZONES: readonly HudZone[]`, `hudZoneAt(sx: number, sy: number): HudZone | null`

- [x] **Step 1: Write the failing tests**

Create `packages/frontend/src/three/cameraFit.test.ts`:

```ts
import { CAMERA_FOV_DEG, cameraFor, fitCamera, frameOutline, projectToScreen } from './cameraFit';
import { hudZoneAt } from './hudZones';

describe('fitCamera', () => {
  it('converges to the prototype framing at 16:9', () => {
    const fit = fitCamera(16 / 9);
    expect(fit.fov).toBe(CAMERA_FOV_DEG);
    expect(fit.position.x).toBeCloseTo(0, 6);
    expect(fit.position.y).toBeCloseTo(2.59, 2);
    expect(fit.position.z).toBeCloseTo(1.808, 2);
    expect(fit.look.y).toBeCloseTo(0.76, 6);
    expect(fit.look.z).toBeCloseTo(0.272, 2);
  });

  it('looks 50 degrees down', () => {
    const { position, look } = fitCamera(16 / 9);
    const pitch = Math.atan2(position.y - look.y, position.z - look.z);
    expect((pitch * 180) / Math.PI).toBeCloseTo(50, 6);
  });

  it.each([
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
  ])('fills a %s frame symmetrically with a 5%% margin', (_, aspect) => {
    const cam = cameraFor(fitCamera(aspect), aspect);
    let xMin = 1;
    let xMax = -1;
    let yMin = 1;
    let yMax = -1;
    for (const p of frameOutline()) {
      const q = p.clone().project(cam);
      xMin = Math.min(xMin, q.x);
      xMax = Math.max(xMax, q.x);
      yMin = Math.min(yMin, q.y);
      yMax = Math.max(yMax, q.y);
    }
    expect(Math.max(xMax, -xMin, (yMax - yMin) / 2)).toBeCloseTo(0.95, 2);
    expect((yMax + yMin) / 2).toBeCloseTo(0, 2);
    expect(xMax + xMin).toBeCloseTo(0, 3);
  });

  it('projects the table centre near the middle of the screen', () => {
    const cam = cameraFor(fitCamera(16 / 9), 16 / 9);
    const { sx, sy } = projectToScreen(cam, 0, 0.76, 0);
    expect(sx).toBeCloseTo(0.5, 3);
    expect(sy).toBeGreaterThan(0.3);
    expect(sy).toBeLessThan(0.7);
  });
});

describe('hudZoneAt', () => {
  it('finds the three HUD rectangles and nothing in the middle', () => {
    expect(hudZoneAt(0.1, 0.9)?.name).toBe('players');
    expect(hudZoneAt(0.9, 0.1)?.name).toBe('table');
    expect(hudZoneAt(0.9, 0.9)?.name).toBe('actions');
    expect(hudZoneAt(0.5, 0.5)).toBeNull();
    expect(hudZoneAt(0.3, 0.9)).toBeNull();
  });
});
```

Create `packages/frontend/src/three/layout.property.test.ts`:

```ts
import { cameraFor, fitCamera, projectToScreen } from './cameraFit';
import { hudZoneAt } from './hudZones';
import {
  POT_SPOT,
  TABLE_Y,
  boardCards,
  cardCorners,
  cardsOverlap,
  chipTouchesCard,
  dealerCards,
  insideFelt,
  layoutSeats,
  type CardPlacement,
  type TableKind,
} from './layout';

// Spec §A1 "No-overlap test": for every table size, no two hands' cards overlap, no chip stack
// touches a card, every card stays inside 0.95 of the felt, and with the fitted camera at 16:9
// (1280x720) no card corner falls inside a HUD-safe zone.

const cam = cameraFor(fitCamera(16 / 9), 16 / 9);

function problems(kind: TableKind, hands: number[][]): string[] {
  const seats = layoutSeats(kind, hands.map((h, seatIndex) => ({ seatIndex, hands: h })));
  const groups: { id: string; cards: CardPlacement[] }[] = seats.flatMap((s) =>
    s.hands.map((cards, h) => ({ id: `seat ${s.seatIndex} hand ${h}`, cards })),
  );
  if (kind === 'holdem') boardCards(5).forEach((c, i) => groups.push({ id: `board ${i}`, cards: [c] }));
  else groups.push({ id: 'dealer', cards: dealerCards(3) });
  const chips = [...seats.flatMap((s) => s.bets), ...(kind === 'holdem' ? [POT_SPOT] : [])];

  const out: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (groups[i].cards.some((a) => groups[j].cards.some((b) => cardsOverlap(a, b)))) {
        out.push(`${groups[i].id} overlaps ${groups[j].id}`);
      }
    }
  }
  const all = groups.flatMap((g) => g.cards.map((c) => ({ id: g.id, c })));
  for (const chip of chips) {
    for (const { id, c } of all) if (chipTouchesCard(chip, c)) out.push(`a chip at ${chip.x.toFixed(2)},${chip.z.toFixed(2)} touches ${id}`);
  }
  for (const { id, c } of all) {
    for (const [x, z] of cardCorners(c)) {
      if (!insideFelt(x, z, 0.95)) out.push(`${id} leaves the felt`);
      const { sx, sy } = projectToScreen(cam, x, TABLE_Y, z);
      const zone = hudZoneAt(sx, sy);
      if (zone) out.push(`${id} is under the ${zone.name} HUD zone`);
    }
  }
  return [...new Set(out)];
}

const same = (n: number, hand: number[]) => Array.from({ length: n }, () => hand);
const cases: [string, TableKind, number[][]][] = [];
for (let n = 2; n <= 6; n++) {
  cases.push([`Hold'em, ${n} players`, 'holdem', same(n, [2])]);
  for (const k of [2, 3, 4, 5]) cases.push([`Blackjack, ${n} players, ${k}-card hands`, 'blackjack', same(n, [k])]);
}
// A split with 4-card hands fits at up to five players. At six, seats are ~0.55 m apart and only a
// 2-card split fits (plan deviation 5).
for (let n = 2; n <= 6; n++) {
  const k = n <= 5 ? 4 : 2;
  for (let seat = 0; seat < n; seat++) {
    cases.push([
      `Blackjack, ${n} players, seat ${seat} splits into ${k}-card hands`,
      'blackjack',
      same(n, [2]).map((h, i) => (i === seat ? [k, k] : h)),
    ]);
  }
}

describe('table layout property (spec §A1)', () => {
  it.each(cases)('%s', (_, kind, hands) => {
    expect(problems(kind, hands)).toEqual([]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/three/cameraFit.test.ts src/three/layout.property.test.ts --root packages/frontend`
Expected: FAIL, "Failed to resolve import './cameraFit'".

- [x] **Step 3: Write the implementation**

Create `packages/frontend/src/three/hudZones.ts`:

```ts
// Screen rectangles Plan B's HUD will cover, as fractions of the viewport from its top-left, at a
// 16:9 reference (spec §A1). The table layout keeps every card out of them; Plan B sizes the HUD
// to fit inside them.

export interface HudZone {
  name: 'players' | 'table' | 'actions';
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HUD_ZONES: readonly HudZone[] = [
  { name: 'players', x: 0, y: 1 - 0.32, w: 0.25, h: 0.32 },
  { name: 'table', x: 1 - 0.26, y: 0, w: 0.26, h: 0.2 },
  { name: 'actions', x: 1 - 0.15, y: 1 - 0.26, w: 0.15, h: 0.26 },
];

export function hudZoneAt(sx: number, sy: number): HudZone | null {
  return HUD_ZONES.find((z) => sx > z.x && sx < z.x + z.w && sy > z.y && sy < z.y + z.h) ?? null;
}
```

Create `packages/frontend/src/three/cameraFit.ts`:

```ts
import * as THREE from 'three';
import { TABLE_Y } from './layout';

// A fixed three-quarter view (spec §A2): 50 degrees down through a long lens, framed so the rail
// and skirt fill the frame with an even margin. Pure three.js maths, no renderer, so it is
// unit-tested and recomputed on every resize.

export const CAMERA_PITCH_DEG = 50;
export const CAMERA_FOV_DEG = 35;
export const FRAME_MARGIN = 0.05;

export interface CameraFit {
  fov: number;
  position: THREE.Vector3;
  look: THREE.Vector3;
}

let outline: THREE.Vector3[] | null = null;

// What must be in frame: the outer rail (about 1.28 x 0.93 at y 0.79) and the skirt below it
// (about 1.3 x 0.95 at y 0.6).
export function frameOutline(): readonly THREE.Vector3[] {
  if (!outline) {
    outline = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      outline.push(
        new THREE.Vector3(1.28 * Math.cos(a), 0.79, 0.93 * Math.sin(a)),
        new THREE.Vector3(1.3 * Math.cos(a), 0.6, 0.95 * Math.sin(a)),
      );
    }
  }
  return outline;
}

export function cameraFor(fit: CameraFit, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fit.fov, aspect, 0.05, 30);
  cam.position.copy(fit.position);
  cam.lookAt(fit.look);
  cam.updateMatrixWorld();
  return cam;
}

// Iterates the look point's z (to centre the outline vertically) and the distance along the view
// direction (so the larger of the horizontal and vertical extents fills 1 - FRAME_MARGIN).
export function fitCamera(aspect: number): CameraFit {
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 0.05, 30);
  const q = new THREE.Vector3();
  const look = new THREE.Vector3(0, TABLE_Y, 0);
  let d = 3;
  for (let it = 0; it < 80; it++) {
    cam.position.copy(look).addScaledVector(dir, -d);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    let xMax = 0;
    let yMax = -Infinity;
    let yMin = Infinity;
    for (const p of frameOutline()) {
      q.copy(p).project(cam);
      xMax = Math.max(xMax, Math.abs(q.x));
      yMax = Math.max(yMax, q.y);
      yMin = Math.min(yMin, q.y);
    }
    look.z -= ((yMax + yMin) / 2) * d * 0.25;
    d *= Math.max(xMax, (yMax - yMin) / 2) / (1 - FRAME_MARGIN);
  }
  return { fov: CAMERA_FOV_DEG, position: look.clone().addScaledVector(dir, -d), look };
}

// Screen position as fractions of the viewport from its top-left.
export function projectToScreen(cam: THREE.PerspectiveCamera, x: number, y: number, z: number): { sx: number; sy: number } {
  const q = new THREE.Vector3(x, y, z).project(cam);
  return { sx: (q.x + 1) / 2, sy: (1 - q.y) / 2 };
}
```

Note: the last loop iteration moves `look` and `d` after measuring; the returned position uses the updated values, which is what the prototype did (it converges well inside 80 iterations, so the difference is below the test tolerance).

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/three/cameraFit.test.ts src/three/layout.property.test.ts --root packages/frontend`
Expected: PASS (7 camera/HUD tests; 45 property cases). If a property case fails, do not loosen the test: report the case and the problems list to the controller (the values in `layout.ts` came from a prototype run that passed all 45).

Then `npm run typecheck`: clean.

- [x] **Step 5: Commit (controller, after the user says yes)**

```bash
git add packages/frontend/src/three/cameraFit.ts packages/frontend/src/three/hudZones.ts packages/frontend/src/three/cameraFit.test.ts packages/frontend/src/three/layout.property.test.ts docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): fitted camera, HUD-safe zones and the layout property test (spec A1, A2)"
```

---

### Task 3: Static camera; remove figures, props, lamp meshes and camera motion

**Files:**
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts`
- Modify: `packages/frontend/src/three/engine/room.ts`
- Modify: `packages/frontend/src/three/engine/textures.ts` (delete `smokeTexture`)
- Delete: `packages/frontend/src/three/engine/silhouette.ts`

**Interfaces:**
- Consumes: `fitCamera(aspect): CameraFit` from Task 2.
- Produces: `SceneRoot.getStats(): { cards: number; chips: number }` (no `figures`). `SceneRoot` no longer reads `SeatModel.bodyX/bodyZ`, `SceneModel.dealerFigure`, `dealerActive` or `myTurn` (Task 4 removes the first three from the model).

There is no unit test for this task: `SceneRoot` and `Room` need WebGL, and the component tests mock `SceneRoot`. It is checked by typecheck, the full suite, the greps in Step 4, and Gate 1.

- [x] **Step 1: SceneRoot: imports and constants**

In `packages/frontend/src/three/engine/SceneRoot.ts`:

Replace
```ts
import { TABLE_Y, slotPoint, type SceneModel } from '../sceneModel';
```
with
```ts
import { TABLE_Y, type SceneModel } from '../sceneModel';
import { fitCamera } from '../cameraFit';
```

Delete the line `import { Silhouette, silhouetteFor } from './silhouette';`.

Delete these four constants:
```ts
const BASE_CAM = new THREE.Vector3(0, 1.05, 1.3);
const BASE_LOOK = new THREE.Vector3(0, 0.52, -0.2);
const LEAN_CAM = new THREE.Vector3(0, 0.92, 1.02);
const LEAN_LOOK = new THREE.Vector3(0, 0.6, 0.18);
```

- [x] **Step 2: SceneRoot: fields, constructor, setSize, apply, tick, dispose**

Delete the fields `figures`, `lean`, `leanTarget`, `pointer`, `pointerSmooth` (keep `tmp`, which `project` uses).

In the constructor delete `this.camera.position.copy(BASE_CAM);` and `opts.canvas.addEventListener('pointermove', this.onPointer);`. Delete the whole `onPointer` arrow-function field. The `canvas` field was only used by the pointer listener: delete it and its `this.canvas = opts.canvas;` assignment.

Replace `setSize` with:
```ts
  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const aspect = this.width / this.height;
    // A fixed three-quarter view framed to fill the screen evenly (spec §A2). The camera never
    // moves after this: no lean, sway or pointer parallax.
    const fit = fitCamera(aspect);
    this.camera.fov = fit.fov;
    this.camera.aspect = aspect;
    this.camera.position.copy(fit.position);
    this.camera.lookAt(fit.look);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
  }
```

Replace `getStats` with:
```ts
  getStats(): { cards: number; chips: number } {
    return { cards: this.cards.size, chips: this.chips.size };
  }
```

In `apply`, delete `this.leanTarget = model.myTurn ? 1 : 0;` and the whole block from the comment `// Seated figures (never the local player: that's the camera).` down to and including the loop that removes figures no longer wanted (the block ends just before `// Cards.`).

In `tick`, delete `for (const f of this.figures.values()) f.update(t, dt, still);` and everything from `this.lean += ...` through `this.camera.lookAt(this.tmp);`. `tick` now reads:
```ts
  private tick(dt: number, draw: boolean): void {
    this.time += dt;
    const t = this.time;
    const still = this.reducedMotion;

    this.tweens.update(dt);
    this.room.update(t, still);

    if (!draw) return;
    if (this.grade) this.grade.uniforms.time.value = t;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.onFrame?.(this.project);
  }
```

In `dispose`, delete `this.canvas.removeEventListener('pointermove', this.onPointer);` and `for (const f of this.figures.values()) f.dispose();`.

- [x] **Step 3: Room and textures: remove the props, lamp meshes and smoke**

In `packages/frontend/src/three/engine/room.ts`:

- Change the textures import to `import { feltTexture, plankTexture, rng, softDotTexture, woodTexture } from './textures';` (no `smokeTexture`).
- Delete the fields `bulb`, `halo`, `smoke`, `ember`.
- Replace the uplight comment with:
  ```ts
    // Low warm bounce off the felt. It was tuned to light the seated figures' faces, which are gone;
    // Gate 2 retunes it with the turn light on screen (spec §A3, §A6).
  ```
- Delete the whole `// Whiskey glass and a cigar in a saucer, near the local player's hand.` block (glass, whiskey, saucer, cigar, ember) up to and including `g.add(saucer, cigar, this.ember);`.
- Delete the whole `// --- Hanging lamp ---` block (cord, shade, bulb, halo) up to and including `g.add(cord, shade, this.bulb, this.halo);`. Keep `LAMP_POS`: the spotlight still uses it. The lamp's `SpotLight` and its flicker stay (spec §A3).
- Delete the smoke sprites (`const smokeTex = smokeTexture();` and its loop).
- In `setQuality`, delete `this.smoke.forEach((s) => (s.visible = q !== 'low'));`.
- In `update`, delete the halo opacity line, the ember scale line, and the `for (const s of this.smoke)` loop. `update` keeps the spot/fill flicker and the dust.

In `packages/frontend/src/three/engine/textures.ts` delete `smokeTexture` (its only caller was the room).

Delete `packages/frontend/src/three/engine/silhouette.ts`.

- [x] **Step 4: Verify**

Run: `npm run typecheck` → clean.
Run: `npm test --workspace=@poker-blackjack/frontend` → all pass.
Run: `git grep -n -E "silhouette|Silhouette|this\.figures|LEAN_|onPointer|pointermove|smokeTexture|this\.ember|this\.halo|this\.bulb|this\.smoke" -- packages/frontend/src` → no matches.

- [x] **Step 5: Commit (controller, after the user says yes)**

```bash
git add -A packages/frontend/src/three/engine docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): fixed fitted camera; remove figures, props, lamp meshes and camera motion (spec A2, A3)"
```

---

### Task 4: Scene models use the layout; dev harness steps

**Files:**
- Modify: `packages/frontend/src/three/sceneModel.ts`
- Modify: `packages/frontend/src/three/pokerModel.ts`
- Modify: `packages/frontend/src/three/sceneModel.test.ts`
- Modify: `packages/frontend/src/three/pokerModel.test.ts`
- Modify: `packages/frontend/src/three/Poker3D.test.tsx:86`
- Modify: `packages/frontend/src/three/TableStage.tsx:101`
- Modify: `packages/frontend/src/three/devHarness.tsx`

**Interfaces:**
- Consumes: from Task 1 `layoutSeats`, `dealerCards`, `boardCards`, `POT_SPOT`, `TABLE_Y`, `CardPlacement`, and the table constants.
- Produces (Tasks 6 and 7 rely on these):
  - `sceneModel.ts` re-exports `TABLE_A`, `TABLE_B`, `TABLE_Y`, `CARD_W`, `CARD_H` from `layout.ts` (existing importers keep working).
  - `interface Vec2 { x: number; z: number }`
  - `SeatModel.plate: Vec2 | null` (replaces `angle`, `bodyX`, `bodyZ`, `plateX`, `plateZ`)
  - `interface FeltPrint { kind: 'blackjack' | 'holdem'; rings: Vec2[] }`, `feltPrintKey(p: FeltPrint): string`
  - `SceneModel.turnLight: Vec2 | null`, `SceneModel.felt: FeltPrint`. Removed: `dealerFigure`, `dealerActive`. Kept: `myTurn` (the action buttons use it).
  - `centreOf(points: readonly { x: number; z: number }[]): Vec2 | null`
  - Removed exports: `DEALER_SLOT`, `MY_SLOT`, `OTHER_SLOTS`, `HAND_FACTOR`, `RAIL_FACTOR`, `BODY_FACTOR`, `CARD_STEP`, `HAND_GAP`, `slotPoint`, `tangent`, `assignSlots`, `POKER_OTHER_SLOTS`.

- [x] **Step 1: Write the failing tests**

In `packages/frontend/src/three/sceneModel.test.ts`, change the import line to:
```ts
import { buildSceneModel, chipsFor, feltPrintKey, pickDealerRound } from './sceneModel';
```
Replace the first two tests of `describe('buildSceneModel', ...)` (the "near slot" and "spectator" tests) with:
```ts
  it('puts the local player at the bottom centre and the rest in seat order, left first', () => {
    const model = buildSceneModel({
      seats: seats(['a', 'b', 'c', 'd']),
      activeSeatIndex: null,
      mySeatIndex: 2,
      blackjackRounds: null,
    });
    const plate = (name: string) => model.seats.find((s) => s.name === name)?.plate;
    expect(plate('c')?.x).toBeCloseTo(0, 6);
    expect(plate('c')?.z).toBeGreaterThan(0);
    // Order from seat 2 is d(3), a(0), b(1): two slots on the left (centre outward), one on the right.
    expect(plate('d')?.x).toBeLessThan(0);
    expect(plate('a')?.x).toBeLessThan(0);
    expect(plate('a')?.z).toBeLessThan(plate('d')?.z ?? 0);
    expect(plate('b')?.x).toBeGreaterThan(0);
  });

  it('gives a spectator no seat of their own but puts the first player at the bottom centre', () => {
    const model = buildSceneModel({
      seats: seats(['a', 'b']),
      activeSeatIndex: null,
      mySeatIndex: null,
      blackjackRounds: null,
    });
    expect(model.seats.map((s) => s.isMe)).toEqual([false, false]);
    expect(model.seats[0].plate?.x).toBeCloseTo(0, 6);
    expect(model.seats[1].plate?.x).toBeLessThan(0);
  });

  it('lays out only the seats dealt into a hand: a mid-hand joiner has no place until the next deal', () => {
    const rounds = { 0: round(), 1: round() };
    const mid = buildSceneModel({ seats: seats(['a', 'b', 'c']), activeSeatIndex: 0, mySeatIndex: 0, blackjackRounds: rounds });
    const two = buildSceneModel({ seats: seats(['a', 'b']), activeSeatIndex: 0, mySeatIndex: 0, blackjackRounds: rounds });
    expect(mid.seats[2].plate).toBeNull();
    expect(mid.cards.some((k) => k.key.startsWith('s2:'))).toBe(false);
    expect(mid.seats[1].plate).toEqual(two.seats[1].plate);
    const between = buildSceneModel({ seats: seats(['a', 'b', 'c']), activeSeatIndex: null, mySeatIndex: 0, blackjackRounds: null });
    expect(between.seats[2].plate).not.toBeNull();
  });

  it("points the turn light at the acting hand, at the dealer's cards while the dealer plays, else nowhere", () => {
    const rounds = { 0: round(), 1: round() };
    const acting = buildSceneModel({ seats: seats(['a', 'b']), activeSeatIndex: 1, mySeatIndex: 0, blackjackRounds: rounds });
    const theirs = acting.cards.filter((k) => k.key.startsWith('s1:'));
    expect(acting.turnLight?.x).toBeCloseTo((theirs[0].x + theirs[1].x) / 2, 6);
    expect(acting.turnLight?.z).toBeCloseTo((theirs[0].z + theirs[1].z) / 2, 6);

    const dealer = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: null,
      mySeatIndex: 0,
      blackjackRounds: { 0: round({ phase: 'dealer', dealerCards: [c('K', 'spades'), c('7', 'hearts')] }) },
    });
    const d = dealer.cards.filter((k) => k.key.startsWith('d:'));
    expect(dealer.turnLight?.x).toBeCloseTo((d[0].x + d[1].x) / 2, 6);
    expect(dealer.turnLight?.z).toBeCloseTo(d[0].z, 6);

    const idle = buildSceneModel({ seats: seats(['a']), activeSeatIndex: null, mySeatIndex: 0, blackjackRounds: null });
    expect(idle.turnLight).toBeNull();
  });

  it('prints one betting ring per placed seat, unchanged as cards are dealt', () => {
    const base = { seats: seats(['a', 'b', 'c']), activeSeatIndex: 0, mySeatIndex: 0 };
    const deal = buildSceneModel({ ...base, blackjackRounds: { 0: round(), 1: round(), 2: round() } });
    const hit = buildSceneModel({
      ...base,
      blackjackRounds: { 0: round({ playerHands: [hand([c('7', 'diamonds'), c('4', 'clubs'), c('9', 'spades')])] }), 1: round(), 2: round() },
    });
    expect(deal.felt.kind).toBe('blackjack');
    expect(deal.felt.rings).toHaveLength(3);
    expect(feltPrintKey(hit.felt)).toBe(feltPrintKey(deal.felt));
  });
```

In `packages/frontend/src/three/pokerModel.test.ts`:
- Change the imports to:
  ```ts
  import { actingSeatIndex, amountToCall, buildPokerModel, livePot } from './pokerModel';
  ```
  (delete the `MY_SLOT` import line).
- In the first test, replace `expect(m.dealerFigure).toBe(false);` with `expect(m.felt).toEqual({ kind: 'holdem', rings: [] });` and rename the test to `'has no felt rings and no pot before a hand starts'`.
- Replace the test `'seats the far-centre chair for a fifth opponent since there is no dealer there'` with:
  ```ts
  it('spreads seats evenly round the whole table: me at the bottom, then left, far, right', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c', 'd']), mySeatIndex: 0, holdem: null });
    const [me, left, far, right] = m.seats.map((s) => s.plate);
    expect(me?.x).toBeCloseTo(0, 6);
    expect(me?.z).toBeGreaterThan(0);
    expect(left?.x).toBeLessThan(0);
    expect(left?.z).toBeCloseTo(0, 2);
    expect(far?.x).toBeCloseTo(0, 2);
    expect(far?.z).toBeLessThan(0);
    expect(right?.x).toBeGreaterThan(0);
  });

  it('places the board in the centre and the pot just beyond it', () => {
    const h = hand({ street: 'flop', communityCards: [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts')] });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    const cc = m.cards.filter((k) => k.key.startsWith('cc:'));
    expect(cc.map((k) => k.z)).toEqual([0, 0, 0]);
    expect(cc[2].x).toBeCloseTo(0, 6);
    expect(m.pot?.z).toBeLessThan(0);
  });

  it('gives a player who sat down mid-hand no place, and points the turn light at the acting hand', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c', 'late']), mySeatIndex: 0, holdem: hand({ actingPlayerId: 'b' }) });
    expect(m.seats[3].plate).toBeNull();
    const b = m.cards.filter((k) => k.key.startsWith('h:1:'));
    expect(m.turnLight?.x).toBeCloseTo((b[0].x + b[1].x) / 2, 6);
    expect(buildPokerModel({ seats: seats(['a']), mySeatIndex: 0, holdem: null }).turnLight).toBeNull();
  });
  ```

In `packages/frontend/src/three/Poker3D.test.tsx` replace `expect(model.dealerFigure).toBe(false);` with `expect(model.felt).toEqual({ kind: 'holdem', rings: [] });`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/three/sceneModel.test.ts src/three/pokerModel.test.ts src/three/Poker3D.test.tsx --root packages/frontend`
Expected: FAIL (`feltPrintKey` is not exported; `plate`, `felt` and `turnLight` are undefined).

- [x] **Step 3: Rewrite `sceneModel.ts`**

Replace the whole of `packages/frontend/src/three/sceneModel.ts` with:

```ts
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
```

Note `turnLight` starts from `centreOf(cards)` while only the dealer's cards are in `cards`.

- [x] **Step 4: Rewrite `buildPokerModel` and its imports in `pokerModel.ts`**

Replace the import block and the `POKER_OTHER_SLOTS` / `COMMUNITY_STEP` / `COMMUNITY_Z` / `POT_Z` constants at the top of `packages/frontend/src/three/pokerModel.ts` with:

```ts
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import { POT_SPOT, TABLE_Y, boardCards, layoutSeats } from './layout';
import {
  centreOf,
  jitter,
  orderSeated,
  type CardSlot,
  type ChipStackModel,
  type OutcomeLabel,
  type SceneModel,
  type SeatModel,
  type Vec2,
} from './sceneModel';
```

Keep `PokerInput`, `amountToCall`, `actingSeatIndex`, `livePot`, `resultLabel` and `statusFor` unchanged. Replace `buildPokerModel` with:

```ts
export function buildPokerModel({ seats, mySeatIndex, holdem }: PokerInput): SceneModel {
  const seated = seats.filter((s) => s.displayName).sort((a, b) => a.seatIndex - b.seatIndex);
  const n = Math.max(seats.length, 1);
  const active = actingSeatIndex(seats, holdem);
  const settled = holdem?.street === 'settled';
  const playerOf = (s: SeatView) => holdem?.players.find((p) => p.playerId === s.displayName) ?? null;

  // Laid out from the players dealt into the hand (everyone seated between hands), evenly round
  // the whole table: see buildSceneModel.
  const dealtIn = holdem ? seated.filter((s) => playerOf(s)) : seated;
  const layout = layoutSeats(
    'holdem',
    orderSeated(dealtIn, mySeatIndex, n).map((s) => {
      const p = playerOf(s);
      return { seatIndex: s.seatIndex, hands: p && !p.folded ? [2] : [] };
    }),
  );
  const placeOf = new Map(layout.map((l) => [l.seatIndex, l]));

  const cards: CardSlot[] = [];
  const chips: ChipStackModel[] = [];
  const outcomes: OutcomeLabel[] = [];
  const seatModels: SeatModel[] = [];
  let turnLight: Vec2 | null = null;

  if (holdem) {
    boardCards(holdem.communityCards.length).forEach((p, i) => {
      const key = `cc:${i}`;
      cards.push({ key, card: holdem.communityCards[i], x: p.x, y: TABLE_Y + 0.004, z: p.z, rotY: jitter(key, 0.04), order: i });
    });
  }

  for (const seat of seated) {
    const place = placeOf.get(seat.seatIndex);
    const isMe = seat.seatIndex === mySeatIndex;
    const isActive = seat.seatIndex === active;
    const player = playerOf(seat);
    const raw = settled ? (holdem?.results?.find((r) => r.playerId === seat.displayName) ?? null) : null;
    const result = raw ? resultLabel(raw.payout) : null;

    seatModels.push({
      seatIndex: seat.seatIndex,
      name: seat.displayName as string,
      // Mid-hand the in-hand stack is the live number; the seat balance only updates at settlement.
      balance: holdem && !settled && player ? player.stack : seat.balance,
      isMe,
      isActive,
      connected: seat.connected,
      status: statusFor(seat, holdem, player, isActive, isMe, result),
      plate: place ? { x: place.plate.x, z: place.plate.z } : null,
    });

    if (!holdem || !player || !place) continue;
    if (!player.folded) {
      // Everyone else's hole cards stay face-down (null) until the server reveals them at showdown.
      const hole = player.holeCards ?? [null, null];
      hole.forEach((card, i) => {
        const key = `h:${seat.seatIndex}:${i}`;
        const p = place.hands[0][i];
        cards.push({ key, card, x: p.x, y: TABLE_Y + 0.004 + i * 0.002, z: p.z, rotY: p.rotY + jitter(key, 0.04), order: i });
      });
    }

    if (player.streetContributed > 0) {
      // Inside the betting line, between the hand and the middle of the table.
      chips.push({ key: `bet:${seat.seatIndex}`, amount: player.streetContributed, x: place.betSpot.x, z: place.betSpot.z });
    }

    const handCentre = centreOf(place.hands[0] ?? []) ?? { x: place.anchor.x, z: place.anchor.z };
    // Opponents' results already show on their name plate (and their cards are
    // turned over), so the big floating label is only for the local player.
    if (result && isMe) {
      outcomes.push({ key: `res:${seat.seatIndex}`, seatIndex: seat.seatIndex, text: result.text, polarity: result.polarity, x: handCentre.x, z: handCentre.z });
    }
    if (isActive) turnLight = handCentre;
  }

  const potTotal = holdem ? livePot(seats, holdem) : 0;
  // The centre stack holds money from earlier streets; this street's bets are still out in front of players.
  const inFront = holdem && !settled ? holdem.players.reduce((sum, p) => sum + p.streetContributed, 0) : 0;
  const collected = potTotal - inFront;
  if (collected > 0) chips.push({ key: 'pot', amount: collected, x: POT_SPOT.x, z: POT_SPOT.z });

  return {
    kind: 'holdem',
    pot: potTotal > 0 ? { amount: potTotal, x: POT_SPOT.x, z: POT_SPOT.z } : null,
    cards,
    chips,
    seats: seatModels,
    outcomes,
    hasRound: !!holdem,
    myTurn: mySeatIndex !== null && mySeatIndex === active,
    turnLight,
    felt: { kind: 'holdem', rings: [] },
  };
}
```

- [x] **Step 5: TableStage plates**

In `packages/frontend/src/three/TableStage.tsx` replace
```ts
    for (const s of model.seats) if (!s.isMe) a.set(`plate:${s.seatIndex}`, { x: s.plateX, y: TABLE_Y + 0.07, z: s.plateZ });
```
with
```ts
    // A player who sat down mid-hand has no place on the table until the next deal.
    for (const s of model.seats) if (!s.isMe && s.plate) a.set(`plate:${s.seatIndex}`, { x: s.plate.x, y: TABLE_Y + 0.07, z: s.plate.z });
```
(A plate element without an anchor stays `visibility: hidden`, which the projection loop already handles.)

- [x] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/three --root packages/frontend`
Expected: PASS. Then `npm run typecheck`: clean (any leftover use of a removed export is a compile error: fix the caller, don't re-add the export).

- [x] **Step 7: Dev harness steps**

In `packages/frontend/src/three/devHarness.tsx`:

Change `const NAMES = ['you', 'bob', 'cara', 'dan', 'edna'];` to:
```ts
const NAMES = ['you', 'bob', 'cara', 'dan', 'edna', 'fay'];
```

After `const win = ...` add:
```ts
const SPLIT = [hand([c('8', 'hearts'), c('3', 'clubs')], 25), hand([c('8', 'spades'), c('5', 'clubs')], 25)];
const SPLIT_LONG = [
  hand([c('8', 'hearts'), c('3', 'clubs'), c('2', 'diamonds'), c('5', 'spades')], 25),
  hand([c('8', 'spades'), c('5', 'clubs'), c('A', 'diamonds'), c('2', 'clubs')], 25),
];
```

Append to the end of the `STEPS` array (after `'Six seats'`):
```ts
  // Layout, framing and turn-light steps for the readability gates (plan A, Gates 1 and 2).
  { label: '2 players, bob acts', count: 2, inProgress: true, active: 1, rounds: allRounds(2, MINE, 'playing', null) },
  { label: '3 players, cara acts', count: 3, inProgress: true, active: 2, rounds: allRounds(3, MINE, 'playing', null) },
  { label: '6 players, edna acts', count: 6, inProgress: true, active: 4, rounds: allRounds(6, MINE, 'playing', null) },
  { label: 'Split, your turn', count: 4, inProgress: true, active: 0, rounds: allRounds(4, SPLIT, 'playing', null) },
  { label: 'Split, 4-card hands', count: 4, inProgress: true, active: 0, rounds: allRounds(4, SPLIT_LONG, 'playing', null) },
  {
    label: '6 players, dealer plays',
    count: 6,
    inProgress: true,
    active: null,
    rounds: allRounds(6, MINE_HIT, 'dealer', [c('K', 'spades'), c('7', 'hearts')]),
  },
```

Replace `pokerPlayers` with (one player per bet, so a step can seat fewer than five):
```ts
function pokerPlayers(bets: number[], opts: { folded?: string[]; reveal?: boolean } = {}): P[] {
  const holes: P['holeCards'][] = [
    MY_HOLE,
    [c('Q', 'clubs'), c('Q', 'diamonds')],
    [c('9', 'hearts'), c('8', 'hearts')],
    [c('K', 'clubs'), c('3', 'spades')],
    [c('5', 'diamonds'), c('5', 'clubs')],
    [c('J', 'diamonds'), c('10', 'clubs')],
  ];
  return bets.map((bet, i) =>
    pl(NAMES[i], 1000 - bet, bet, i === 0 || opts.reveal ? holes[i] : null, { folded: opts.folded?.includes(NAMES[i]) ?? false }),
  );
}
```

Append to the end of `POKER_STEPS` (after `'Showdown'`):
```ts
  { label: '2 players, bob acts', count: 2, inProgress: true, holdem: holdem('preflop', [], 'bob', pokerPlayers([10, 5]), 15) },
  { label: '3 players, cara acts', count: 3, inProgress: true, holdem: holdem('flop', FLOP, 'cara', pokerPlayers([0, 20, 0]), 50) },
  {
    label: '6 players, fay acts',
    count: 6,
    inProgress: true,
    holdem: holdem('turn', TURN, 'fay', pokerPlayers([40, 40, 0, 40, 0, 0], { folded: ['dan'] }), 240),
  },
```

Resulting step indices (used by the gates): Blackjack 0 Waiting · 1 Deal (4 players, your turn) · 2 You hit · 3 You stand (bob acts) · 4 Cara plays · 5 Dealer reveals · 6 Settled · 7 Next hand · 8 Six seats (your turn) · 9 2 players, bob acts · 10 3 players, cara acts · 11 6 players, edna acts · 12 Split, your turn · 13 Split, 4-card hands · 14 6 players, dealer plays. Hold'em (`?game=poker`) 0 Waiting · 1 Preflop · 2 Flop (5 players, you act) · 3 Turn (bob acts) · 4 River · 5 Showdown · 6 2 players, bob acts · 7 3 players, cara acts · 8 6 players, fay acts.

Run `npm run typecheck`: clean.

- [x] **Step 8: Full suite**

Run: `npm test` and `npm run typecheck` → both green.

- [x] **Step 9: Commit (controller, after the user says yes)**

```bash
git add packages/frontend/src/three docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): scene models use the rail-distance layout; harness steps for the gates (spec A1)"
```

---

### Gate 1: layout and framing (controller + render subagent; the user approves)

Spec §7 gate 1, after A1–A3. Not an implementer task.

- [x] **Step 1: Dispatch the render subagent** (model: sonnet) with this brief:

  > Render Gate 1 screenshots of the 3D tables. Do not edit repo files.
  > 1. Start the save server in the background: `node scripts/render/save-server.cjs .playtest-data/plan-a-gates/gate1` (port 3199).
  > 2. Start the dev server with the in-app browser's `preview_start` `{ name: "frontend" }` (Vite on 5173). Set the viewport with `resize_window` to 1280×720.
  > 3. For each shot below, navigate to `http://localhost:5173/dev3d.html?step=N` (Hold'em: `?game=poker&step=N`), wait 4.5 s, then run in the page:
  >    ```js
  >    const s = window.__bj3d; for (let i = 0; i < 14; i++) s.advance(0.5); s.advance(0.05);
  >    const src = s.renderer.domElement; const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  >    const g = c.getContext('2d'); g.drawImage(src, 0, 0); g.setLineDash([10, 8]); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.7)';
  >    for (const z of [{x:0,y:0.68,w:0.25,h:0.32},{x:0.74,y:0,w:0.26,h:0.2},{x:0.85,y:0.74,w:0.15,h:0.26}]) g.strokeRect(z.x*c.width, z.y*c.height, z.w*c.width, z.h*c.height);
  >    const r = await fetch('http://127.0.0.1:3199/save?name=NAME.png', { method: 'POST', body: c.toDataURL('image/png') }); await r.text();
  >    ```
  >    Reload between shots (patches don't stack). Shots: `bj-2` (step 9), `bj-4` (step 1), `bj-6` (step 8), `bj-split` (step 12), `bj-split-long` (step 13), `he-2` (poker step 6), `he-5` (poker step 2), `he-6` (poker step 8).
  > 4. For each shot also record `s.debugCards()` and any console errors.
  > 5. Write `.playtest-data/plan-a-gates/gate1/findings.md`: per shot, whether gaps between neighbouring hands look equal, whether the table is framed symmetrically (equal side margins, rail fully in frame), whether any card or chip is inside a dashed HUD rectangle, whether the 3D name plates still show, and anything that looks wrong. Return a 10-line summary; no image data in your reply.

- [x] **Step 2: Show the user** the PNGs (`SendUserFile`, `display: render`) and the findings summary. Ask for approval.
- [x] **Step 3: If the user asks for changes,** turn them into a follow-up task on the constants in `layout.ts` (re-run Task 2's property test) and re-render the affected shots. Record the settled values in this plan's "Deviations" list.

---

### Task 5: Big-index card faces

**Files:**
- Create: `packages/frontend/src/three/testCanvas.ts`
- Create: `packages/frontend/src/three/engine/cardFace.ts`
- Create: `packages/frontend/src/three/engine/cardFace.test.ts`
- Modify: `packages/frontend/src/three/engine/textures.ts` (`cardFaceTexture`)
- Modify: `packages/frontend/src/three/engine/cards.ts` (`setCard`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `testCanvas.ts`: `interface CanvasCall { name: string; args: unknown[]; fillStyle: unknown; font: string }`, `recordingContext(): { ctx: CanvasRenderingContext2D; calls: CanvasCall[] }` (Task 6 uses it)
  - `cardFace.ts`: `FACE_PAPER`, `FACE_RED`, `FACE_BLACK`, `SYMBOL_FONT`, `type GlyphCheck = (glyph: string) => boolean`, `drawCardFace(ctx, card, hasGlyph): void` (draws ink on a 256×358 card), `glyphSupported(glyph): boolean`
  - `cardFaceTexture(card: Card): THREE.CanvasTexture` (synchronous, no callback); `CardObject.setCard(card: Card | null): void`

- [x] **Step 1: Write the test helper and the failing tests**

Create `packages/frontend/src/three/testCanvas.ts`:

```ts
// Test helper: a stand-in 2D canvas context (jsdom has none) that records every drawing call with
// the fill style and font in force when it was made. measureText reports 20 px per character and
// createPattern returns null.

export interface CanvasCall {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  font: string;
}

export function recordingContext(): { ctx: CanvasRenderingContext2D; calls: CanvasCall[] } {
  const calls: CanvasCall[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    globalAlpha: 1,
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      const name = String(prop);
      if (name in target) return target[name];
      if (name === 'measureText') return (text: string) => ({ width: text.length * 20 });
      if (name === 'createPattern') return () => null;
      return (...args: unknown[]) => {
        calls.push({ name, args, fillStyle: target.fillStyle, font: String(target.font) });
      };
    },
    set(target, prop, value) {
      target[String(prop)] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
```

Create `packages/frontend/src/three/engine/cardFace.test.ts`:

```ts
import type { Card } from '@poker-blackjack/game-engine';
import { recordingContext } from '../testCanvas';
import { FACE_BLACK, FACE_RED, drawCardFace } from './cardFace';

const draw = (card: Card, hasGlyph = (_: string) => true) => {
  const { ctx, calls } = recordingContext();
  drawCardFace(ctx, card, hasGlyph);
  return { texts: calls.filter((k) => k.name === 'fillText'), calls };
};

describe('drawCardFace', () => {
  it('draws a court card as two big corner indices and a framed glyph, in red for hearts', () => {
    const { texts, calls } = draw({ rank: 'Q', suit: 'hearts' });
    expect(texts.map((k) => k.args[0])).toEqual(['Q', '♥', 'Q', '♥', '♛']);
    expect(texts.every((k) => k.fillStyle === FACE_RED)).toBe(true);
    expect(texts[0].font).toMatch(/^bold \d+px Georgia/);
    expect(calls.filter((k) => k.name === 'strokeRect')).toHaveLength(1);
  });

  it('draws a pip card with one large centre suit, in black for spades, and condenses the 10', () => {
    const { texts, calls } = draw({ rank: '10', suit: 'spades' });
    expect(texts.map((k) => k.args[0])).toEqual(['10', '♠', '10', '♠', '♠']);
    expect(texts.every((k) => k.fillStyle === FACE_BLACK)).toBe(true);
    expect(calls.some((k) => k.name === 'scale' && (k.args[0] as number) < 1)).toBe(true);
    expect(calls.filter((k) => k.name === 'strokeRect')).toHaveLength(0);
  });

  it('falls back to letters when the font has no glyph', () => {
    const { texts } = draw({ rank: 'K', suit: 'clubs' }, () => false);
    expect(texts.map((k) => k.args[0])).toEqual(['K', 'C', 'K', 'C', 'K']);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/three/engine/cardFace.test.ts --root packages/frontend`
Expected: FAIL, "Failed to resolve import './cardFace'".

- [x] **Step 3: Write the painter**

Create `packages/frontend/src/three/engine/cardFace.ts`:

```ts
import type { Card, Rank, Suit } from '@poker-blackjack/game-engine';

// Big-index card faces (spec §A4), drawn straight onto the card canvas with no SVG load, so a face
// is ready the moment its card is dealt. Coordinates are for the 256 x 358 card texture.

export const FACE_PAPER = '#e4d5ad';
export const FACE_RED = '#a3221b';
export const FACE_BLACK = '#1b1410';
export const SYMBOL_FONT = '"Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Symbols", serif';

const W = 256;
const H = 358;

const SUIT_GLYPH: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_LETTER: Record<Suit, string> = { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' };
const COURT_GLYPH: Partial<Record<Rank, string>> = { J: '♞', Q: '♛', K: '♚' };

export type GlyphCheck = (glyph: string) => boolean;

export function drawCardFace(ctx: CanvasRenderingContext2D, card: Card, hasGlyph: GlyphCheck): void {
  const suit = hasGlyph(SUIT_GLYPH[card.suit]) ? SUIT_GLYPH[card.suit] : SUIT_LETTER[card.suit];
  const ink = card.suit === 'hearts' || card.suit === 'diamonds' ? FACE_RED : FACE_BLACK;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // The rank at about 0.4 of the card width with the suit under it; "10" is condensed to fit.
  const index = () => {
    ctx.save();
    if (card.rank === '10') {
      ctx.translate(54, 100);
      ctx.scale(0.72, 1);
      ctx.font = 'bold 100px Georgia, serif';
      ctx.fillText('10', 0, 0);
    } else {
      ctx.font = 'bold 104px Georgia, serif';
      ctx.fillText(card.rank, 52, 100);
    }
    ctx.restore();
    ctx.font = `76px ${SYMBOL_FONT}`;
    ctx.fillText(suit, 52, 172);
  };
  index();
  // The same index mirrored in the opposite corner.
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  index();
  ctx.restore();

  ctx.textBaseline = 'middle';
  const court = COURT_GLYPH[card.rank];
  if (court) {
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.75;
    ctx.strokeRect(W * 0.3, H * 0.3, W * 0.4, H * 0.4);
    ctx.font = `86px ${SYMBOL_FONT}`;
    ctx.fillText(hasGlyph(court) ? court : card.rank, W / 2, H / 2 + 4);
  } else {
    ctx.globalAlpha = 0.9;
    ctx.font = `150px ${SYMBOL_FONT}`;
    ctx.fillText(suit, W / 2, H * 0.52);
  }
  ctx.restore();
}

const glyphs = new Map<string, boolean>();

// Glyph coverage differs by OS (spec §8). A font stack with no glyph for a character draws nothing,
// or the same "missing" box it draws for a private-use code point, so compare the two renderings.
export function glyphSupported(glyph: string): boolean {
  const known = glyphs.get(glyph);
  if (known !== undefined) return known;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true;
  const alpha = (ch: string) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.font = `48px ${SYMBOL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 32, 32);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const out: number[] = [];
    for (let i = 3; i < data.length; i += 4) out.push(data[i]);
    return out;
  };
  const drawn = alpha(glyph);
  const missing = alpha(String.fromCodePoint(0x10fffd));
  const ok = drawn.some((a) => a > 0) && drawn.some((a, i) => a !== missing[i]);
  glyphs.set(glyph, ok);
  return ok;
}
```

- [x] **Step 4: Use it in `textures.ts` and `cards.ts`**

In `packages/frontend/src/three/engine/textures.ts`:
- Change the type import to `import type { Card } from '@poker-blackjack/game-engine';` (no `Rank`).
- Add `import { FACE_PAPER, drawCardFace, glyphSupported } from './cardFace';`.
- Update the file's header comment to: `// Every texture is generated on a canvas at startup (seeded, so it looks the same every run). No image downloads.`
- Delete `RANK_FILE` and `faceUrl`.
- Replace `faceCache` and `cardFaceTexture` with:

```ts
const faceCache = new Map<string, THREE.CanvasTexture>();

// Big-index face on aged parchment (spec §A4). Drawn synchronously, so there is no blank-face
// moment while an image loads.
export function cardFaceTexture(card: Card): THREE.CanvasTexture {
  const id = `${card.rank}-${card.suit}`;
  const cached = faceCache.get(id);
  if (cached) return cached;
  const [c, ctx] = canvas(CARD_TEX_W, CARD_TEX_H);
  const seed = id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  ctx.save();
  roundRectPath(ctx, CARD_TEX_W, CARD_TEX_H, 14);
  ctx.clip();
  ctx.fillStyle = FACE_PAPER;
  ctx.fillRect(0, 0, CARD_TEX_W, CARD_TEX_H);
  drawCardFace(ctx, card, glyphSupported);
  age(ctx, CARD_TEX_W, CARD_TEX_H, rng(seed));
  ctx.restore();
  const t = tex(c);
  faceCache.set(id, t);
  return t;
}
```

In `packages/frontend/src/three/engine/cards.ts` replace `setCard` with:
```ts
  setCard(card: Card | null): void {
    this.card = card;
    if (card) {
      this.frontMat.map = cardFaceTexture(card);
      this.frontMat.needsUpdate = true;
    }
  }
```

The 2D view (`components/Card.tsx`) and `src/assets/cards` are untouched.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/three/engine/cardFace.test.ts --root packages/frontend` → PASS.
Run: `npm test` and `npm run typecheck` → green.
Run: `git grep -n "onTextureLoaded\|faceUrl\|RANK_FILE" -- packages/frontend/src/three` → no matches.

- [x] **Step 6: Commit (controller, after the user says yes)**

```bash
git add packages/frontend/src/three/testCanvas.ts packages/frontend/src/three/engine/cardFace.ts packages/frontend/src/three/engine/cardFace.test.ts packages/frontend/src/three/engine/textures.ts packages/frontend/src/three/engine/cards.ts docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): big-index card faces drawn on the card canvas (spec A4)"
```

---

### Task 5b: Remove the dealing shoe and discard tray (user decision at Gate 1)

Added 2026-10-02 after Gate 1: the user judged the two Blackjack boxes clutter (deviation 8). Small, controller-implemented; no unit test (WebGL), checked by typecheck, the suite, the grep below and Gate 2.

**Files:**
- Modify: `packages/frontend/src/three/engine/room.ts` (delete the shoe and tray meshes, `dealerProps`, `setMode`, `SHOE_POS`, `TRAY_POS`)
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts` (Blackjack deal and discard points move here as `BJ_DEAL_POS` / `BJ_DISCARD_POS`, same coordinates; drop the `setMode` call)

- [x] **Step 1:** In `room.ts` delete `SHOE_POS`, `TRAY_POS`, the `dealerProps` field, the `// Dealing shoe and discard tray.` block and the `setMode` method with its comment.
- [x] **Step 2:** In `SceneRoot.ts` import only `Room` from `./room`; next to `DECK_POS`/`MUCK_POS` add `BJ_DEAL_POS = (0.62, TABLE_Y + 0.03, -0.55)` and `BJ_DISCARD_POS = (-0.62, TABLE_Y + 0.01, -0.55)` with a comment that no shoe or tray is drawn (deviation 8); delete `this.room.setMode(model.kind);` and use the new names for `origin` / `sweepTo`.
- [x] **Step 3: Verify.** `npm run typecheck` clean; `npm test --workspace=@poker-blackjack/frontend` green; `git grep -n -E "SHOE_POS|TRAY_POS|dealerProps|setMode\(model" -- packages/frontend/src` no matches.
- [x] **Step 4: Commit** `feat(3d): remove the dealing shoe and discard tray (Gate 1 decision)`.

Task 6 Step 5's anchor changes accordingly: add the felt-print block in `apply` right after the `const sweepTo = ...` line (the `setMode` call it used to follow is gone).

---

### Task 6: Printed felt

**Files:**
- Create: `packages/frontend/src/three/engine/feltPrint.ts`
- Create: `packages/frontend/src/three/engine/feltPrint.test.ts`
- Modify: `packages/frontend/src/three/engine/textures.ts` (add `printedFeltTexture`)
- Modify: `packages/frontend/src/three/engine/room.ts` (keep the felt material and base texture; `setFeltPrint`)
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts` (regenerate when `feltPrintKey` changes)

**Interfaces:**
- Consumes: `FeltPrint`, `feltPrintKey` (Task 4); `recordingContext` (Task 5); `TABLE_A`, `TABLE_B`, `BOARD_STEP`, `BOARD_Z` (Task 1).
- Produces: `FELT_TEX_W`, `FELT_TEX_H`, `FELT_INK`, `BET_RING_R`, `BETTING_LINE_FACTOR`, `BLACKJACK_LINES`, `feltPx(x, z): [number, number]`, `interface FeltBase { image: CanvasImageSource; width: number; height: number; repeat: [number, number] }`, `paintFelt(ctx, base, print): void`; `printedFeltTexture(base: THREE.CanvasTexture, print: FeltPrint): THREE.CanvasTexture`; `Room.setFeltPrint(print: FeltPrint): void`.

- [x] **Step 1: Write the failing tests**

Create `packages/frontend/src/three/engine/feltPrint.test.ts`:

```ts
import { recordingContext } from '../testCanvas';
import { BETTING_LINE_FACTOR, BET_RING_R, BLACKJACK_LINES, FELT_TEX_H, FELT_TEX_W, feltPx, paintFelt } from './feltPrint';

const base = { image: {} as CanvasImageSource, width: 512, height: 512, repeat: [3, 2] as [number, number] };
const pxPerM = FELT_TEX_W / 2.4;

describe('feltPx', () => {
  it('maps the felt bounding box onto the whole canvas, far side at the top', () => {
    expect(feltPx(-1.2, -0.85)).toEqual([0, 0]);
    const [x, y] = feltPx(1.2, 0.85);
    expect(x).toBeCloseTo(FELT_TEX_W, 9);
    expect(y).toBeCloseTo(FELT_TEX_H, 9);
    const [cx, cy] = feltPx(0, 0);
    expect(cx).toBeCloseTo(FELT_TEX_W / 2, 9);
    expect(cy).toBeCloseTo(FELT_TEX_H / 2, 9);
  });

  it('keeps pixels square', () => {
    expect(FELT_TEX_H / 1.7).toBeCloseTo(FELT_TEX_W / 2.4, 0);
  });
});

describe('paintFelt', () => {
  it('prints both Blackjack rule lines and one ring per seat at its bet spot', () => {
    const { ctx, calls } = recordingContext();
    const rings = [
      { x: 0, z: 0.48 },
      { x: -0.5, z: 0.3 },
    ];
    paintFelt(ctx, base, { kind: 'blackjack', rings });
    const letters = BLACKJACK_LINES.reduce((n, l) => n + [...l.text].length, 0);
    expect(calls.filter((k) => k.name === 'fillText')).toHaveLength(letters);
    const arcs = calls.filter((k) => k.name === 'arc');
    expect(arcs).toHaveLength(2);
    arcs.forEach((k, i) => {
      const [px, py] = feltPx(rings[i].x, rings[i].z);
      expect(k.args[0]).toBeCloseTo(px, 6);
      expect(k.args[1]).toBeCloseTo(py, 6);
      expect(k.args[2]).toBeCloseTo(BET_RING_R * pxPerM, 6);
    });
  });

  it("prints a Hold'em betting line and a box round the board, with no text", () => {
    const { ctx, calls } = recordingContext();
    paintFelt(ctx, base, { kind: 'holdem', rings: [] });
    expect(calls.filter((k) => k.name === 'fillText')).toHaveLength(0);
    const line = calls.filter((k) => k.name === 'ellipse');
    expect(line).toHaveLength(1);
    expect(line[0].args[2]).toBeCloseTo(BETTING_LINE_FACTOR * 1.2 * pxPerM, 6);
    expect(calls.filter((k) => k.name === 'roundRect')).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/three/engine/feltPrint.test.ts --root packages/frontend`
Expected: FAIL, "Failed to resolve import './feltPrint'".

- [x] **Step 3: Write the painter**

Create `packages/frontend/src/three/engine/feltPrint.ts`:

```ts
import type { FeltPrint } from '../sceneModel';
import { BOARD_STEP, BOARD_Z, TABLE_A, TABLE_B } from '../layout';

// The printed felt (spec §A5): one canvas covering the felt ellipse's bounding box. The felt's
// ShapeGeometry UVs are its position in metres, so with repeat (1/2.4, 1/1.7) and offset (0.5, 0.5)
// the canvas pixel for world (x, z) is feltPx(x, z). 2048 x 1451 keeps pixels square.

export const FELT_TEX_W = 2048;
export const FELT_TEX_H = 1451;
const PX_PER_M = FELT_TEX_W / (2 * TABLE_A);

export const FELT_INK = 'rgba(232, 205, 140, 0.5)';
export const BET_RING_R = 0.09;
// Between the bets (0.56 of the felt) and the hole cards' inner edges (hands at 0.76): the spec's
// 0.68 would run under the cards (plan deviation 6).
export const BETTING_LINE_FACTOR = 0.61;

interface ArcLine {
  text: string;
  font: string;
  spacing: number;
  // Top of the arc, in metres; the circle's centre is `radius` nearer the players.
  z: number;
  radius: number;
}

// Between the dealer's cards and the players' cards.
export const BLACKJACK_LINES: readonly ArcLine[] = [
  { text: 'BLACKJACK PAYS 3 TO 2', font: 'bold 46px Georgia, serif', spacing: 8, z: -0.28, radius: 1.1 },
  { text: 'Dealer must stand on 17 and draw to 16', font: 'italic 30px Georgia, serif', spacing: 3, z: -0.17, radius: 1.1 },
];

export function feltPx(x: number, z: number): [number, number] {
  return [((x + TABLE_A) / (2 * TABLE_A)) * FELT_TEX_W, ((z + TABLE_B) / (2 * TABLE_B)) * FELT_TEX_H];
}

export interface FeltBase {
  image: CanvasImageSource;
  width: number;
  height: number;
  // How often the base texture repeated per metre when tiled straight onto the felt.
  repeat: [number, number];
}

export function paintFelt(ctx: CanvasRenderingContext2D, base: FeltBase, print: FeltPrint): void {
  // Today's felt as a repeating pattern, at the same scale it had on the mesh.
  const pattern = ctx.createPattern(base.image, 'repeat');
  if (pattern) {
    pattern.setTransform(new DOMMatrix().scale(PX_PER_M / base.repeat[0] / base.width, PX_PER_M / base.repeat[1] / base.height));
    ctx.fillStyle = pattern;
  } else {
    ctx.fillStyle = '#1b3b2c';
  }
  ctx.fillRect(0, 0, FELT_TEX_W, FELT_TEX_H);

  ctx.save();
  ctx.strokeStyle = FELT_INK;
  ctx.fillStyle = FELT_INK;
  ctx.lineWidth = 2.5;
  ctx.textAlign = 'center';
  if (print.kind === 'blackjack') {
    for (const line of BLACKJACK_LINES) arcText(ctx, line);
    for (const r of print.rings) {
      const [px, py] = feltPx(r.x, r.z);
      ctx.beginPath();
      ctx.arc(px, py, BET_RING_R * PX_PER_M, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const [cx, cy] = feltPx(0, 0);
    ctx.beginPath();
    ctx.ellipse(cx, cy, BETTING_LINE_FACTOR * TABLE_A * PX_PER_M, BETTING_LINE_FACTOR * TABLE_B * PX_PER_M, 0, 0, Math.PI * 2);
    ctx.stroke();
    // A box round the five board positions.
    const [x0, y0] = feltPx(-2 * BOARD_STEP - 0.1, BOARD_Z - 0.12);
    const [x1, y1] = feltPx(2 * BOARD_STEP + 0.1, BOARD_Z + 0.12);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 28);
    ctx.stroke();
  }
  ctx.restore();
}

// Text set letter by letter along the top of a circle, reading left to right from the players' side.
function arcText(ctx: CanvasRenderingContext2D, line: ArcLine): void {
  const r = line.radius * PX_PER_M;
  ctx.save();
  ctx.font = line.font;
  const chars = [...line.text];
  const widths = chars.map((ch) => ctx.measureText(ch).width + line.spacing);
  const total = widths.reduce((a, b) => a + b, 0) - line.spacing;
  const [cx, top] = feltPx(0, line.z);
  const cy = top + r;
  let angle = -total / r / 2;
  chars.forEach((ch, i) => {
    const a = angle + (widths[i] - line.spacing) / r / 2;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.rotate(a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += widths[i] / r;
  });
  ctx.restore();
}
```

- [x] **Step 4: Run the painter tests**

Run: `npx vitest run src/three/engine/feltPrint.test.ts --root packages/frontend` → PASS.

- [x] **Step 5: Texture, room and scene wiring**

In `packages/frontend/src/three/engine/textures.ts` add the imports
```ts
import type { FeltPrint } from '../sceneModel';
import { FELT_TEX_H, FELT_TEX_W, paintFelt } from './feltPrint';
```
and add after `feltTexture`:
```ts
// The printed felt for one seat layout, mapped across the felt ellipse with UV = metres and clamped.
export function printedFeltTexture(base: THREE.CanvasTexture, print: FeltPrint): THREE.CanvasTexture {
  const [c, ctx] = canvas(FELT_TEX_W, FELT_TEX_H);
  const image = base.image as HTMLCanvasElement;
  paintFelt(ctx, { image, width: image.width, height: image.height, repeat: [base.repeat.x, base.repeat.y] }, print);
  const t = tex(c);
  t.repeat.set(1 / 2.4, 1 / 1.7);
  t.offset.set(0.5, 0.5);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
```

In `packages/frontend/src/three/engine/room.ts`:
- Import `printedFeltTexture` from `./textures` and `type FeltPrint` from `../sceneModel`.
- Add fields:
  ```ts
  private feltBase = feltTexture();
  private feltMat = new THREE.MeshStandardMaterial({ map: this.feltBase, roughness: 0.96 });
  private printedFelt: THREE.CanvasTexture | null = null;
  ```
- In the constructor replace `const feltMat = new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.96 });` by nothing, and build the felt mesh with `this.feltMat` (`const felt = new THREE.Mesh(feltGeo, this.feltMat);`).
- Add the method:
  ```ts
  // Called only when the seat layout changes, i.e. between hands (spec §A5).
  setFeltPrint(print: FeltPrint): void {
    const next = printedFeltTexture(this.feltBase, print);
    this.feltMat.map = next;
    this.feltMat.needsUpdate = true;
    this.printedFelt?.dispose();
    this.printedFelt = next;
  }
  ```

In `packages/frontend/src/three/engine/SceneRoot.ts`:
- Change the model import to `import { TABLE_Y, feltPrintKey, type SceneModel } from '../sceneModel';`.
- Add a field `private feltKey = '';`.
- In `apply`, right after the `const sweepTo = ...` line, add (the `setMode` call it used to follow was removed in Task 5b):
  ```ts
    const feltKey = feltPrintKey(model.felt);
    if (feltKey !== this.feltKey) {
      this.room.setFeltPrint(model.felt);
      this.feltKey = feltKey;
    }
  ```

- [x] **Step 6: Verify**

Run: `npm test` and `npm run typecheck` → green.

- [x] **Step 7: Commit (controller, after the user says yes)**

```bash
git add packages/frontend/src/three/engine/feltPrint.ts packages/frontend/src/three/engine/feltPrint.test.ts packages/frontend/src/three/engine/textures.ts packages/frontend/src/three/engine/room.ts packages/frontend/src/three/engine/SceneRoot.ts docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): printed felt per game and seat layout (spec A5)"
```

---

### Task 7: Turn light

**Files:**
- Create: `packages/frontend/src/three/engine/turnLight.ts`
- Create: `packages/frontend/src/three/engine/turnLight.test.ts`
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts`

**Interfaces:**
- Consumes: `SceneModel.turnLight: Vec2 | null` (Task 4).
- Produces: `interface TurnLightState { x: number; z: number; level: number }`, `TURN_LIGHT_TAU`, `stepTurnLight(s, goal, dt, instant): TurnLightState`; `TURN_LIGHT_INTENSITY`; `SceneRoot.turnLightLevel` (public, dev-tunable through `window.__bj3d` at Gate 2).

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/src/three/engine/turnLight.test.ts`:

```ts
import { TURN_LIGHT_TAU, stepTurnLight } from './turnLight';

const off = { x: 0, z: 0, level: 0 };

describe('stepTurnLight', () => {
  it('appears on the first acting seat instead of sliding in from the last one', () => {
    const s = stepTurnLight({ x: -0.5, z: 0.2, level: 0 }, { x: 0.4, z: 0.3 }, 1 / 30, false);
    expect([s.x, s.z]).toEqual([0.4, 0.3]);
    expect(s.level).toBeGreaterThan(0);
  });

  it('glides between seats and reaches 95% within about 0.4 s', () => {
    let s = { x: 0, z: 0.5, level: 1 };
    let t = 0;
    while (Math.abs(0.6 - s.x) > 0.05 * 0.6 && t < 2) {
      s = stepTurnLight(s, { x: 0.6, z: 0.5 }, 1 / 60, false);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.42);
    expect(TURN_LIGHT_TAU).toBeCloseTo(0.12, 6);
  });

  it('fades out in place when nobody is acting', () => {
    let s = { x: 0.3, z: 0.2, level: 1 };
    for (let i = 0; i < 30; i++) s = stepTurnLight(s, null, 1 / 30, false);
    expect(s.level).toBeLessThan(0.01);
    expect([s.x, s.z]).toEqual([0.3, 0.2]);
  });

  it('jumps straight there under reduced motion', () => {
    expect(stepTurnLight({ x: 0, z: 0, level: 1 }, { x: 0.5, z: -0.2 }, 1 / 30, true)).toEqual({ x: 0.5, z: -0.2, level: 1 });
    expect(stepTurnLight(off, null, 1 / 30, true).level).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/three/engine/turnLight.test.ts --root packages/frontend`
Expected: FAIL, "Failed to resolve import './turnLight'".

- [ ] **Step 3: Write the stepper**

Create `packages/frontend/src/three/engine/turnLight.ts`:

```ts
import type { Vec2 } from '../sceneModel';

// The turn light's motion (spec §A6): it glides from seat to seat and fades out when nobody is
// acting. Exponential, so a new target mid-glide just bends the path instead of jumping.

export interface TurnLightState {
  x: number;
  z: number;
  // 0 = off, 1 = full strength.
  level: number;
}

// 95% of the way in about 0.36 s (spec: "about 0.4 s").
export const TURN_LIGHT_TAU = 0.12;

export function stepTurnLight(s: TurnLightState, goal: Vec2 | null, dt: number, instant: boolean): TurnLightState {
  const k = instant ? 1 : 1 - Math.exp(-dt / TURN_LIGHT_TAU);
  if (!goal) return { x: s.x, z: s.z, level: s.level + (0 - s.level) * k };
  // A light that is off (or nearly) appears on the new seat rather than sliding in from the old one.
  if (s.level < 0.05) return { x: goal.x, z: goal.z, level: s.level + (1 - s.level) * k };
  return { x: s.x + (goal.x - s.x) * k, z: s.z + (goal.z - s.z) * k, level: s.level + (1 - s.level) * k };
}
```

Run: `npx vitest run src/three/engine/turnLight.test.ts --root packages/frontend` → PASS.

- [ ] **Step 4: The light in `SceneRoot`**

In `packages/frontend/src/three/engine/SceneRoot.ts`:
- Import: `import { stepTurnLight, type TurnLightState } from './turnLight';` and change the model import to `import { TABLE_Y, feltPrintKey, type SceneModel, type Vec2 } from '../sceneModel';`.
- Add after the `MUCK_POS` constant:
  ```ts
  // One shadowless spot on the acting seat, including your own (spec §A6), replacing the camera lean.
  // 5x the lamp (room.ts baseSpot 22) from the prototype's Hold'em frame; Gate 2 settles it.
  export const TURN_LIGHT_INTENSITY = 110;
  const TURN_LIGHT_HEIGHT = 2.0;
  ```
- Add fields:
  ```ts
  private turnLight = new THREE.SpotLight(0xffa552, 0, 4, 0.22, 0.7, 1.6);
  private turnGoal: Vec2 | null = null;
  private turnState: TurnLightState = { x: 0, z: 0, level: 0 };
  // Full strength of the turn light. Public so Gate 2 can tune it live through window.__bj3d.
  turnLightLevel = TURN_LIGHT_INTENSITY;
  ```
- In the constructor, after `this.scene.add(this.room.group);`:
  ```ts
    // Added once, at zero intensity, so turning it on later doesn't change the light count and
    // recompile every material.
    this.turnLight.castShadow = false;
    this.scene.add(this.turnLight, this.turnLight.target);
  ```
- In `apply`, after the felt-print block: `this.turnGoal = model.turnLight;`
- In `tick`, after `this.room.update(t, still);`:
  ```ts
    this.turnState = stepTurnLight(this.turnState, this.turnGoal, dt, still);
    const { x, z, level } = this.turnState;
    // Nearly straight above the target, so the pool doesn't spill onto the rail or floor.
    this.turnLight.position.set(x * 0.85, TURN_LIGHT_HEIGHT, z * 0.85);
    this.turnLight.target.position.set(x, TABLE_Y, z);
    this.turnLight.target.updateMatrixWorld();
    this.turnLight.intensity = this.turnLightLevel * level;
  ```

- [ ] **Step 5: Verify**

Run: `npm test` and `npm run typecheck` → green.

- [ ] **Step 6: Commit (controller, after the user says yes)**

```bash
git add packages/frontend/src/three/engine/turnLight.ts packages/frontend/src/three/engine/turnLight.test.ts packages/frontend/src/three/engine/SceneRoot.ts docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "feat(3d): turn light glides to the acting seat (spec A6)"
```

---

### Gate 2: faces, felt, turn light and contrast (controller + render subagent; the user approves)

Spec §7 gate 2, after A4–A6.

- [ ] **Step 1: Dispatch the render subagent** (model: sonnet) with the Gate 1 brief's steps 1–4 (output folder `.playtest-data/plan-a-gates/gate2`, no HUD rectangles drawn), and these shots: `bj-turn-opponent` (step 4), `bj-turn-you` (step 1), `bj-turn-dealer` (step 5), `bj-6-dealer` (step 14), `he-turn-you` (poker step 2), `he-turn-opponent` (poker step 3), `he-6` (poker step 8), plus a close-up `faces` (step 2, then crop the canvas copy to the region around the local player's cards before saving). For each turn-light shot, measure contrast in the page before saving:
  ```js
  // Pool = felt pixels within 0.1 m of the turn target; surround = felt pixels 0.35-0.5 m away.
  // Felt pixels are green-dominant (g >= r && g >= b), which excludes cards and chips.
  const t = s.turnGoal, k = src.width / src.clientWidth, P = (x, z) => { const p = s.project(x, 0.76, z); return [p.x * k, p.y * k]; };
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const ring = (r0, r1) => { let sum = 0, n = 0; for (let a = 0; a < 360; a += 3) for (let r = r0; r <= r1; r += 0.01) {
    const [px, py] = P(t.x + r * Math.cos(a * Math.PI / 180), t.z + r * Math.sin(a * Math.PI / 180));
    const i = (Math.round(py) * c.width + Math.round(px)) * 4; if (data[i + 1] >= data[i] && data[i + 1] >= data[i + 2]) { sum += lum(i); n++; } }
    return n ? sum / n : NaN; };
  const contrast = ring(0, 0.1) / ring(0.35, 0.5);
  ```
  Spec rule: contrast ≥ about 1.6 in every turn-light shot. If any is below, try (in this order, live, re-measuring each time) `s.turnLightLevel` up to 2× its value, then `s.renderer.toneMappingExposure` down by 0.05 steps (no lower than 0.85), then `s.room.uplight.intensity` down to half; record the values that pass in every shot. Also report whether any glyph rendered as a box or a letter (Windows coverage, spec §8) and whether the felt print is legible and clear of the cards.
- [ ] **Step 2:** If tuning was needed, an implementer task sets the settled values (`TURN_LIGHT_INTENSITY` in `SceneRoot.ts`, `toneMappingExposure` in the `SceneRoot` constructor, the uplight intensity in `room.ts`) with a comment citing Gate 2. Re-render the turn-light shots.
- [ ] **Step 3: Show the user** the PNGs and the contrast table; ask for approval.

---

### Task 8: Docs and the final review

**Files:**
- Modify: `HANDOFF.md`
- Modify: this plan (tick the boxes; settled values in "Deviations")

- [ ] **Step 1:** Update `HANDOFF.md` "Next step" item 2: Plan A done (commit range, gate results, settled values, the 6-player split limitation from deviation 5); next is Plan B (HUD and showdown), which sizes its HUD to `three/hudZones.ts` and removes the projected plates, pot and outcome labels.
- [ ] **Step 2:** Final whole-branch review (model: opus) of `master..feat/3d-table-readability` against the spec §5 and this plan, with "no findings" stated as a valid result. Fix what it finds (sonnet implementer, opus re-review).
- [ ] **Step 3: Commit (controller, after the user says yes)**

```bash
git add HANDOFF.md docs/superpowers/plans/2026-10-02-3d-table-readability-plan-a.md
git commit -m "docs(handoff): 3D readability Plan A done; Plan B next"
```
