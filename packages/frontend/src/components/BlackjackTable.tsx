import type { ReactNode } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Outcome } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { Chip } from './Chip';
import { GameTable } from './GameTable';

const OUTCOME_LABELS: Record<Outcome, string> = {
  blackjack: 'Blackjack!',
  bust: 'Bust',
  win: 'Win',
  lose: 'Lose',
  push: 'Push',
};

const OUTCOME_POLARITY: Record<Outcome, 'win' | 'lose' | 'push'> = {
  blackjack: 'win',
  win: 'win',
  bust: 'lose',
  lose: 'lose',
  push: 'push',
};

const OUTCOME_COLOR: Record<'win' | 'lose' | 'push', string> = {
  win: 'text-win-bright',
  lose: 'text-ember-text',
  push: 'text-parchment-dim',
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
          {round.playerHands.map((hand, i) => {
            const outcome = round.phase === 'settled' && round.results ? round.results[i].outcome : null;
            const polarity = outcome ? OUTCOME_POLARITY[outcome] : null;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="flex gap-1">
                  {hand.cards.map((card, j) => (
                    <Card key={j} card={card} />
                  ))}
                </div>
                <div
                  data-testid={`hand-bet-${seatIndex}-${i}`}
                  className="rounded-md border border-wood-grain bg-surface px-2 py-0.5"
                >
                  <Chip value={hand.bet} />
                </div>
                {outcome && polarity && (
                  <div
                    className={`rounded-md border border-wood-grain bg-surface px-2 py-0.5 font-body text-xs font-semibold ${OUTCOME_COLOR[polarity]}`}
                    data-testid={`hand-result-${seatIndex}-${i}`}
                    data-outcome={polarity}
                  >
                    {OUTCOME_LABELS[outcome]}
                  </div>
                )}
              </div>
            );
          })}
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
          <p className="rounded-md border border-wood-grain bg-surface px-3 py-1 font-utility text-xs uppercase tracking-wide text-brass-bright">
            Dealer
          </p>
          <div className="flex gap-1">
            {dealerRound?.dealerCards
              ? dealerRound.dealerCards.map((card, i) => <Card key={i} card={card} />)
              : dealerRound && <Card card={dealerRound.dealerUpcard} />}
          </div>
          {isMyTurn && (
            <div className="flex gap-2">
              <button
                onClick={() => onAction('hit')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Hit
              </button>
              <button
                onClick={() => onAction('stand')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Stand
              </button>
              <button
                onClick={() => onAction('double')}
                className="rounded-md border border-brass-bright bg-brass px-3 py-1 text-ink hover:bg-brass-bright"
              >
                Double
              </button>
              <button
                onClick={() => onAction('split')}
                className="rounded-md border border-ember-bright bg-surface px-3 py-1 text-ember-text hover:bg-surface-raised"
              >
                Split
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg-dim">Waiting for hand to start…</div>
      )}
    </GameTable>
  );
}
