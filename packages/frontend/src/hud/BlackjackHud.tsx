import { useMemo } from 'react';
import type { BlackjackRoundView, SeatView } from '@poker-blackjack/server/src/table';
import type { PlayerAction } from '@poker-blackjack/game-engine';
import { blackjackAvailability } from '../components/blackjackActions';
import { buildBlackjackHud, canLeaveBlackjack } from './hudModel';
import { useCountdown } from './countdown';
import { TableHud, type HudLayout } from './TableHud';
import { TablePanel } from './TablePanel';
import { PlayerList } from './PlayerList';
import { BlackjackPrompts } from './ActionPrompts';

export interface BlackjackHudProps {
  layout: HudLayout;
  seats: SeatView[];
  mySeatIndex: number | null;
  activeSeatIndex: number | null;
  handInProgress: boolean;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  turnClockRemainingMs: number | null;
  // The table's actionSeq: restarts the countdown when a new turn carries the same ms. Optional so tests and the dev harness can omit it.
  actionSeq?: number;
  actionPending: boolean;
  onAction: (action: PlayerAction) => void;
  onReady: () => void;
  onLeave: () => void;
}

export function BlackjackHud(p: BlackjackHudProps) {
  const { layout, seats, mySeatIndex, activeSeatIndex, handInProgress, blackjackRounds } = p;
  const model = useMemo(
    () => buildBlackjackHud({ seats, mySeatIndex, activeSeatIndex, handInProgress, blackjackRounds }),
    [seats, mySeatIndex, activeSeatIndex, handInProgress, blackjackRounds],
  );
  const clock = useCountdown(p.turnClockRemainingMs, p.actionSeq ?? null);
  const mySeat = seats.find((s) => s.seatIndex === mySeatIndex) ?? null;
  const myRound = mySeatIndex !== null ? blackjackRounds?.[mySeatIndex] : undefined;
  return (
    <TableHud
      layout={layout}
      panel={model.panel && <TablePanel panel={model.panel} layout={layout} />}
      players={<PlayerList rows={model.rows} clockSeconds={clock} />}
      prompts={
        <BlackjackPrompts
          layout={layout}
          showActions={mySeatIndex !== null && mySeatIndex === activeSeatIndex}
          can={blackjackAvailability(myRound, mySeat?.balance ?? 0)}
          actionPending={p.actionPending}
          onAction={p.onAction}
          canReady={!!mySeat && !handInProgress && !mySeat.ready}
          onReady={p.onReady}
          canLeave={canLeaveBlackjack(handInProgress, mySeatIndex, blackjackRounds)}
          onLeave={p.onLeave}
        />
      }
    />
  );
}
