import { useMemo } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Card } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from '../components/Button';
import { blackjackAvailability } from '../components/blackjackActions';
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
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the 2D table.
  onUnsupported: () => void;
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
  onSwitchTo2D,
  onUnsupported,
}: Blackjack3DProps) {
  const model = useMemo(
    () => buildSceneModel({ seats, activeSeatIndex, mySeatIndex, blackjackRounds }),
    [seats, activeSeatIndex, mySeatIndex, blackjackRounds],
  );
  const dealerRound = pickDealerRound(blackjackRounds, mySeatIndex);
  const myBalance = seats.find((s) => s.seatIndex === mySeatIndex)?.balance ?? 0;
  const can = blackjackAvailability(mySeatIndex !== null ? blackjackRounds?.[mySeatIndex] : undefined, myBalance);
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
    >
      {model.myTurn && (
        <div className="flex flex-wrap justify-center gap-2 px-2">
          <Button variant="neutral" size="md" onClick={() => onAction('hit')}>
            Hit
          </Button>
          <Button variant="neutral" size="md" onClick={() => onAction('stand')}>
            Stand
          </Button>
          <Button variant="primary" size="md" disabled={!can.double} title={can.double ? undefined : 'Only on your first two cards'} onClick={() => onAction('double')}>
            Double
          </Button>
          <Button variant="danger" size="md" disabled={!can.split} title={can.split ? undefined : 'Only a pair, once per round'} onClick={() => onAction('split')}>
            Split
          </Button>
        </div>
      )}
    </TableStage>
  );
}

export default Blackjack3D;
