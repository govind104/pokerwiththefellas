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

export interface PokerInput {
  seats: SeatView[];
  mySeatIndex: number | null;
  holdem: HoldemView | null;
}

// What the acting player must add to stay in: the biggest bet this street minus their own, capped at their stack.
export function amountToCall(holdem: HoldemView, me: HoldemView['players'][number]): number {
  const highest = Math.max(0, ...holdem.players.filter((p) => !p.folded).map((p) => p.streetContributed));
  return Math.max(0, Math.min(highest - me.streetContributed, me.stack));
}

export function actingSeatIndex(seats: SeatView[], holdem: HoldemView | null): number | null {
  return holdem ? (seats.find((s) => s.displayName === holdem.actingPlayerId)?.seatIndex ?? null) : null;
}

// The server only fills `holdem.pots` at settlement, and seat balances are not
// debited until then either. Mid-hand, what a player has put in is their seat
// balance (pre-hand) minus their live in-hand stack, so the running pot is the
// sum of that across everyone dealt in.
export function livePot(seats: SeatView[], holdem: HoldemView): number {
  if (holdem.street === 'settled') {
    // `pots` also holds any uncalled part of a big bet as its own single-player pot;
    // that money just goes back, so the pot that was actually played for excludes it.
    const contested = holdem.pots.filter((p) => p.eligiblePlayerIds.length > 1);
    const pool = contested.length > 0 ? contested : holdem.pots;
    return pool.reduce((sum, p) => sum + p.amount, 0);
  }
  let total = 0;
  for (const p of holdem.players) {
    const seat = seats.find((s) => s.displayName === p.playerId);
    if (seat) total += Math.max(0, seat.balance - p.stack);
  }
  return total;
}

function resultLabel(payout: number): { text: string; polarity: 'win' | 'lose' | 'push' } {
  if (payout > 0) return { text: `Won ${payout}`, polarity: 'win' };
  if (payout < 0) return { text: `Lost ${Math.abs(payout)}`, polarity: 'lose' };
  return { text: 'Push', polarity: 'push' };
}

// Same wording as the 2D PokerTable's rail so both views tell the same story.
function statusFor(
  seat: SeatView,
  holdem: HoldemView | null,
  player: HoldemView['players'][number] | null,
  isActive: boolean,
  isMe: boolean,
  result: { text: string } | null,
): string {
  if (!holdem) return seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
  if (player?.folded) return 'Folded';
  if (result) return result.text;
  if (!seat.connected) return 'Disconnected';
  if (isActive) return isMe ? 'Your turn' : 'Thinking…';
  return 'Waiting';
}

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
