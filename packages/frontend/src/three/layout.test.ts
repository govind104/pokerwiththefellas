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
