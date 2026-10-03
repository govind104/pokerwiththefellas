import { useMemo, type ReactNode } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Card } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { BlackjackHud } from '../hud/BlackjackHud';
import { buildSceneModel, pickDealerRound } from './sceneModel';
import { TableStage } from './TableStage';

export interface Blackjack3DProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  onAction: (action: PlayerAction) => void;
  // True while a sent action awaits the server's response: the action buttons stay disabled.
  actionPending?: boolean;
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the 2D table.
  onUnsupported: () => void;
  // From the table view (Plan B spec §3 item 3); optional so the dev harness and tests can omit it.
  turnClockRemainingMs?: number | null;
  // Extra controls for the top-left cluster (Admin).
  controls?: ReactNode;
}

function describeCard(c: Card | null): string {
  return c ? `${c.rank} of ${c.suit}` : 'face-down card';
}

export function Blackjack3D({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  blackjackRounds,
  onAction,
  actionPending = false,
  onSwitchTo2D,
  onUnsupported,
  turnClockRemainingMs = null,
  controls,
}: Blackjack3DProps) {
  const model = useMemo(
    () => buildSceneModel({ seats, activeSeatIndex, mySeatIndex, blackjackRounds }),
    [seats, activeSeatIndex, mySeatIndex, blackjackRounds],
  );
  const dealerRound = pickDealerRound(blackjackRounds, mySeatIndex);
  const dealerText = dealerRound
    ? (dealerRound.dealerCards ?? [dealerRound.dealerUpcard, null]).map(describeCard).join(', ')
    : 'no hand in progress';

  const summary = (
    <>
      <p data-testid="dealer-hand">Dealer: {dealerText}</p>
      {model.seats.map((s) => {
        const round = blackjackRounds?.[s.seatIndex];
        return (
          <p key={s.seatIndex} data-testid={`player-${s.seatIndex}`} data-active={s.isActive ? 'true' : 'false'}>
            {s.name}, balance {s.balance}, {s.status}.
            {round?.playerHands.map((h, i) => (
              <span key={i}>
                {' '}
                Hand {i + 1}: {h.cards.map(describeCard).join(', ')}; bet {h.bet}.
              </span>
            ))}
          </p>
        );
      })}
      {model.outcomes.map((o) => (
        <p key={o.key} data-testid={`hand-result-${o.seatIndex}`} data-outcome={o.polarity}>
          {o.text}
        </p>
      ))}
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
        <BlackjackHud
          layout="overlay"
          seats={seats}
          mySeatIndex={mySeatIndex}
          activeSeatIndex={activeSeatIndex}
          handInProgress={handInProgress}
          blackjackRounds={blackjackRounds}
          turnClockRemainingMs={turnClockRemainingMs}
          actionPending={actionPending}
          onAction={onAction}
          onReady={onReady}
          onLeave={onLeave}
        />
      }
    />
  );
}

export default Blackjack3D;
