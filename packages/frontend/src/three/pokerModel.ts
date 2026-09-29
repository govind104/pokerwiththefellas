import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import {
  BODY_FACTOR,
  CARD_STEP,
  HAND_FACTOR,
  MY_SLOT,
  RAIL_FACTOR,
  TABLE_Y,
  assignSlots,
  jitter,
  orderSeated,
  slotPoint,
  tangent,
  type CardSlot,
  type ChipStackModel,
  type OutcomeLabel,
  type SceneModel,
  type SeatModel,
} from './sceneModel';

// Hold'em has no dealer figure, so the far-centre chair is a real seat (0deg).
export const POKER_OTHER_SLOTS = [295, 65, 330, 30, 0];

const COMMUNITY_STEP = 0.14;
const COMMUNITY_Z = -0.14;
const POT_Z = 0.14;

export interface PokerInput {
  seats: SeatView[];
  mySeatIndex: number | null;
  holdem: HoldemView | null;
}

export function actingSeatIndex(seats: SeatView[], holdem: HoldemView | null): number | null {
  return holdem ? (seats.find((s) => s.displayName === holdem.actingPlayerId)?.seatIndex ?? null) : null;
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
  const ordered = orderSeated(seated, mySeatIndex, n);
  const slotOf = assignSlots(ordered, mySeatIndex, POKER_OTHER_SLOTS);
  const active = actingSeatIndex(seats, holdem);
  const settled = holdem?.street === 'settled';

  const cards: CardSlot[] = [];
  const chips: ChipStackModel[] = [];
  const outcomes: OutcomeLabel[] = [];
  const seatModels: SeatModel[] = [];

  holdem?.communityCards.forEach((card, i) => {
    const key = `cc:${i}`;
    cards.push({
      key,
      card,
      x: (i - 2) * COMMUNITY_STEP,
      y: TABLE_Y + 0.004,
      z: COMMUNITY_Z,
      rotY: jitter(key, 0.04),
      order: i,
    });
  });

  for (const seat of seated) {
    const angle = slotOf.get(seat.seatIndex) ?? MY_SLOT;
    const isMe = seat.seatIndex === mySeatIndex;
    const isActive = seat.seatIndex === active;
    const player = holdem?.players.find((p) => p.playerId === seat.displayName) ?? null;
    const raw = settled ? (holdem?.results?.find((r) => r.playerId === seat.displayName) ?? null) : null;
    const result = raw ? resultLabel(raw.payout) : null;

    const body = slotPoint(angle, BODY_FACTOR);
    const plate = slotPoint(angle, RAIL_FACTOR + 0.03);
    seatModels.push({
      seatIndex: seat.seatIndex,
      name: seat.displayName as string,
      balance: seat.balance,
      isMe,
      isActive,
      connected: seat.connected,
      status: statusFor(seat, holdem, player, isActive, isMe, result),
      angle,
      bodyX: body.x,
      bodyZ: body.z,
      plateX: plate.x,
      plateZ: plate.z,
    });

    if (!holdem || !player) continue;
    const centre = slotPoint(angle, HAND_FACTOR);
    const t = tangent(angle);
    const rad = (angle * Math.PI) / 180;
    const facing = (((180 - angle) * Math.PI) / 180) * 0.35;

    if (!player.folded) {
      // Everyone else's hole cards stay face-down (null) until the server reveals them at showdown.
      const hole = player.holeCards ?? [null, null];
      hole.forEach((card, i) => {
        const key = `h:${seat.seatIndex}:${i}`;
        const off = (i - 0.5) * CARD_STEP * 1.05;
        cards.push({
          key,
          card,
          x: centre.x + t.x * off,
          y: TABLE_Y + 0.004 + i * 0.002,
          z: centre.z + t.z * off,
          rotY: facing + (i === 0 ? -0.08 : 0.08) + jitter(key, 0.04),
          order: i,
        });
      });
    }

    if (player.streetContributed > 0) {
      // Bet stack sits between the hand and the middle of the table.
      chips.push({
        key: `bet:${seat.seatIndex}`,
        amount: player.streetContributed,
        x: centre.x - Math.sin(rad) * 0.32,
        z: centre.z + Math.cos(rad) * 0.32,
      });
    }

    // Opponents' results already show on their name plate (and their cards are
    // turned over), so the big floating label is only for the local player.
    if (result && isMe) {
      outcomes.push({
        key: `res:${seat.seatIndex}`,
        seatIndex: seat.seatIndex,
        text: result.text,
        polarity: result.polarity,
        x: centre.x,
        z: centre.z,
      });
    }
  }

  const potTotal = holdem ? holdem.pots.reduce((sum, p) => sum + p.amount, 0) : 0;
  if (potTotal > 0) chips.push({ key: 'pot', amount: potTotal, x: 0, z: POT_Z });

  return {
    kind: 'holdem',
    dealerFigure: false,
    pot: potTotal > 0 ? { amount: potTotal, x: 0, z: POT_Z } : null,
    cards,
    chips,
    seats: seatModels,
    outcomes,
    hasRound: !!holdem,
    myTurn: mySeatIndex !== null && mySeatIndex === active,
    dealerActive: false,
  };
}
