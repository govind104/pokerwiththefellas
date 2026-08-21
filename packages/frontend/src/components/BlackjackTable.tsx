import type { ReactNode } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Outcome } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';

const OUTCOME_LABELS: Record<Outcome, string> = {
  blackjack: 'Blackjack!',
  bust: 'Bust',
  win: 'Win',
  lose: 'Lose',
  push: 'Push',
};

export interface BlackjackTableProps {
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
}

export function BlackjackTable({
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
}: BlackjackTableProps) {
  const isMyTurn = mySeatIndex !== null && mySeatIndex === activeSeatIndex;
  const dealerRound = blackjackRounds ? Object.values(blackjackRounds)[0] : undefined;

  const seatContent: Partial<Record<number, ReactNode>> = {};
  if (blackjackRounds) {
    for (const [seatIndexStr, round] of Object.entries(blackjackRounds)) {
      const seatIndex = Number(seatIndexStr);
      seatContent[seatIndex] = (
        <div className="flex flex-col gap-1" data-testid={`hands-${seatIndex}`}>
          {round.playerHands.map((hand, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                {hand.cards.map((card, j) => (
                  <Card key={j} card={card} />
                ))}
              </div>
              <p className="text-xs text-slate-400" data-testid={`hand-bet-${seatIndex}-${i}`}>
                Bet: {hand.bet}
              </p>
              {round.phase === 'settled' && round.results && (
                <p className="text-xs font-semibold" data-testid={`hand-result-${seatIndex}-${i}`}>
                  {OUTCOME_LABELS[round.results[i].outcome]}
                </p>
              )}
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <GameTable
      seats={seats}
      activeSeatIndex={activeSeatIndex}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
      seatContent={seatContent}
    >
      {blackjackRounds ? (
        <div className="flex flex-col items-center gap-2" data-testid="dealer-hand">
          <p>Dealer</p>
          <div className="flex gap-1">
            {dealerRound?.dealerCards
              ? dealerRound.dealerCards.map((card, i) => <Card key={i} card={card} />)
              : dealerRound && <Card card={dealerRound.dealerUpcard} />}
          </div>
          {isMyTurn && (
            <div className="flex gap-2">
              <button onClick={() => onAction('hit')} className="rounded-md bg-slate-600 px-3 py-1">
                Hit
              </button>
              <button onClick={() => onAction('stand')} className="rounded-md bg-slate-600 px-3 py-1">
                Stand
              </button>
              <button onClick={() => onAction('double')} className="rounded-md bg-emerald-600 px-3 py-1">
                Double
              </button>
              <button onClick={() => onAction('split')} className="rounded-md bg-amber-600 px-3 py-1">
                Split
              </button>
            </div>
          )}
        </div>
      ) : (
        <p>Waiting for hand to start…</p>
      )}
    </GameTable>
  );
}
