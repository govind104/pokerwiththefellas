import { useMemo } from 'react';
import type { HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { HoldemAction } from '@poker-blackjack/game-engine';
import { actingSeatIndex, amountToCall } from '../three/pokerModel';
import { buildHoldemHud, canLeaveHoldem, type BlindSeats } from './hudModel';
import { useCountdown } from './countdown';
import { TableHud, type HudLayout } from './TableHud';
import { TablePanel } from './TablePanel';
import { PlayerList } from './PlayerList';
import { HoldemPrompts } from './ActionPrompts';

export interface HoldemHudProps {
  layout: HudLayout;
  seats: SeatView[];
  mySeatIndex: number | null;
  handInProgress: boolean;
  holdem: HoldemView | null;
  blinds: BlindSeats;
  turnClockRemainingMs: number | null;
  actionPending: boolean;
  onAction: (action: HoldemAction, amount?: number) => void;
  onReady: () => void;
  onLeave: () => void;
}

export function HoldemHud(p: HoldemHudProps) {
  const { layout, seats, mySeatIndex, handInProgress, holdem, blinds } = p;
  const model = useMemo(() => buildHoldemHud({ seats, mySeatIndex, holdem, blinds }), [seats, mySeatIndex, holdem, blinds]);
  const clock = useCountdown(p.turnClockRemainingMs);
  const mySeat = seats.find((s) => s.seatIndex === mySeatIndex) ?? null;
  const me = holdem?.players.find((pl) => pl.playerId === mySeat?.displayName) ?? null;
  const myTurn = mySeatIndex !== null && actingSeatIndex(seats, holdem) === mySeatIndex;
  return (
    <TableHud
      layout={layout}
      panel={model.panel && <TablePanel panel={model.panel} layout={layout} />}
      players={<PlayerList rows={model.rows} clockSeconds={clock} />}
      prompts={
        <HoldemPrompts
          layout={layout}
          showActions={myTurn && !!me?.holeCards}
          toCall={holdem && me ? amountToCall(holdem, me) : 0}
          maxRaise={me ? me.stack : null}
          resetKey={`${holdem?.street ?? ''}|${holdem?.actingPlayerId ?? ''}`}
          actionPending={p.actionPending}
          onAction={p.onAction}
          canReady={!!mySeat && !handInProgress && !mySeat.ready}
          onReady={p.onReady}
          canLeave={canLeaveHoldem(handInProgress, seats, mySeatIndex, holdem)}
          onLeave={p.onLeave}
        />
      }
    />
  );
}
