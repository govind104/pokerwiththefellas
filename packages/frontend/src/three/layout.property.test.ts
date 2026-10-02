import { cameraFor, fitCamera, projectToScreen } from './cameraFit';
import { hudZoneAt } from './hudZones';
import {
  DECK_SPOT,
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

// SceneRoot spawns every dealt card at the deck point with rotY 0.6 and parks it there until its turn.
const WAITING_ROT = 0.6;

function problems(kind: TableKind, hands: number[][], dealerHand = 3): string[] {
  const seats = layoutSeats(kind, hands.map((h, seatIndex) => ({ seatIndex, hands: h })));
  const groups: { id: string; cards: CardPlacement[] }[] = seats.flatMap((s) =>
    s.hands.map((cards, h) => ({ id: `seat ${s.seatIndex} hand ${h}`, cards })),
  );
  if (kind === 'holdem') {
    boardCards(5).forEach((c, i) => groups.push({ id: `board ${i}`, cards: [c] }));
    groups.push({ id: 'waiting card at the deck point', cards: [{ x: DECK_SPOT.x, z: DECK_SPOT.z, rotY: WAITING_ROT }] });
  } else groups.push({ id: 'dealer', cards: dealerCards(dealerHand) });
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
const cases: [string, TableKind, number[][], number?][] = [];
for (let n = 2; n <= 6; n++) {
  cases.push([`Hold'em, ${n} players`, 'holdem', same(n, [2])]);
  for (const k of [2, 3, 4, 5]) cases.push([`Blackjack, ${n} players, ${k}-card hands`, 'blackjack', same(n, [k])]);
}
// A long dealer hand (draws to 17 can reach 5 or 6 cards) fans out toward the outer 120-degree seats.
for (let n = 2; n <= 6; n++) {
  for (const d of [5, 6]) {
    for (const k of [2, 5]) cases.push([`Blackjack, ${n} players, ${k}-card hands, ${d}-card dealer hand`, 'blackjack', same(n, [k]), d]);
  }
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
  it.each(cases)('%s', (_, kind, hands, dealerHand) => {
    expect(problems(kind, hands, dealerHand)).toEqual([]);
  });
});
