import { useMemo, type ReactNode } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction, Card } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { HoldemHud } from '../hud/HoldemHud';
import { NO_BLINDS, type BlindSeats } from '../hud/hudModel';
import { buildPokerModel } from './pokerModel';
import { TableStage } from './TableStage';

export interface Poker3DProps {
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  holdem: HoldemView | null;
  onAction: (action: HoldemAction, amount?: number) => void;
  // True while a sent action awaits the server's response: the action buttons stay disabled.
  actionPending?: boolean;
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the flat view.
  onUnsupported: () => void;
  // From the table view (Plan B spec §5.1); optional so the dev harness and tests can omit them.
  blinds?: BlindSeats;
  turnClockRemainingMs?: number | null;
  // The table's actionSeq, to restart the countdown on every new turn.
  actionSeq?: number;
  // Extra controls for the top-left cluster (Admin).
  controls?: ReactNode;
}

function describeCard(c: Card | null): string {
  return c ? `${c.rank} of ${c.suit}` : 'face-down card';
}

export function Poker3D({
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  holdem,
  onAction,
  actionPending = false,
  onSwitchTo2D,
  onUnsupported,
  blinds = NO_BLINDS,
  turnClockRemainingMs = null,
  actionSeq,
  controls,
}: Poker3DProps) {
  const model = useMemo(() => buildPokerModel({ seats, mySeatIndex, holdem }), [seats, mySeatIndex, holdem]);

  const summary = (
    <>
      <p data-testid="community-cards">
        Community cards: {holdem?.communityCards.length ? holdem.communityCards.map(describeCard).join(', ') : 'none'}
      </p>
      <p>Pot: {model.pot?.amount ?? 0}</p>
      {model.seats.map((s) => {
        const player = holdem?.players.find((p) => p.playerId === s.name);
        return (
          <p key={s.seatIndex} data-testid={`player-info-${s.seatIndex}`} data-active={s.isActive ? 'true' : 'false'}>
            {s.name}, balance {s.balance}, {s.status}.
            {player && !player.folded && ` Hole cards: ${(player.holeCards ?? [null, null]).map(describeCard).join(', ')}.`}
          </p>
        );
      })}
    </>
  );

  return (
    <TableStage
      model={model}
      seats={seats}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
      onSwitchTo2D={onSwitchTo2D}
      onUnsupported={onUnsupported}
      summary={summary}
      controls={controls}
      hud={
        <HoldemHud
          layout="overlay"
          seats={seats}
          mySeatIndex={mySeatIndex}
          handInProgress={handInProgress}
          holdem={holdem}
          blinds={blinds}
          turnClockRemainingMs={turnClockRemainingMs}
          actionSeq={actionSeq}
          actionPending={actionPending}
          onAction={onAction}
          onReady={onReady}
          onLeave={onLeave}
        />
      }
    />
  );
}

export default Poker3D;
