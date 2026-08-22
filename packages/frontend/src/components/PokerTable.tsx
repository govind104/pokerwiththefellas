import { useEffect, useState, type ReactNode } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';
import { Button } from './Button';
import { PANEL_CLASS } from './panelStyles';

type ResultPolarity = 'win' | 'lose' | 'push';

const RESULT_COLOR: Record<ResultPolarity, string> = {
  win: 'text-win-bright',
  lose: 'text-ember-text',
  push: 'text-parchment-dim',
};

export interface PokerTableProps {
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  holdem: HoldemView | null;
  onAction: (action: HoldemAction, amount?: number) => void;
}

export function PokerTable({
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  holdem,
  onAction,
}: PokerTableProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);

  const activeSeatIndex = holdem
    ? (seats.find((s) => s.displayName === holdem.actingPlayerId)?.seatIndex ?? null)
    : null;
  const isMyTurn = mySeatIndex !== null && mySeatIndex === activeSeatIndex;
  const myPlayer = holdem ? (holdem.players.find((p) => p.playerId === holdem.actingPlayerId) ?? null) : null;

  // A value typed into the raise field on one street/turn must not leak into
  // the next -- reset whenever the street or the acting player changes (a new
  // street, a new turn, or a new hand entirely).
  useEffect(() => {
    setRaiseAmount(0);
  }, [holdem?.street, holdem?.actingPlayerId]);

  const seatContent: Partial<Record<number, ReactNode>> = {};
  if (holdem) {
    for (const player of holdem.players) {
      const seat = seats.find((s) => s.displayName === player.playerId);
      if (!seat) continue;
      seatContent[seat.seatIndex] = (
        <div className="flex gap-1" data-testid={`hole-cards-${seat.seatIndex}`}>
          <Card
            key={player.holeCards ? `${player.holeCards[0].rank}${player.holeCards[0].suit}` : 'hidden-0'}
            card={player.holeCards?.[0]}
            faceDown={player.holeCards === null}
          />
          <Card
            key={player.holeCards ? `${player.holeCards[1].rank}${player.holeCards[1].suit}` : 'hidden-1'}
            card={player.holeCards?.[1]}
            faceDown={player.holeCards === null}
          />
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
      {holdem ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-1" data-testid="community-cards">
            {holdem.communityCards.map((card, i) => (
              <Card key={i} card={card} />
            ))}
          </div>
          <div
            data-testid="pot"
            className={`${PANEL_CLASS} flex items-center gap-1.5 font-utility text-sm text-brass-bright`}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <circle cx="10" cy="10" r="9" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1" />
              <circle cx="10" cy="10" r="5.5" fill="none" stroke="var(--ink)" strokeWidth="0.75" strokeDasharray="1.5 2" />
            </svg>
            Pot: {holdem.pots.reduce((sum, pot) => sum + pot.amount, 0)}
          </div>
          {holdem.street === 'settled' && holdem.results && (
            <div className="flex flex-col items-center gap-1" data-testid="holdem-results">
              {holdem.results.map((result) => {
                const polarity: ResultPolarity =
                  result.payout > 0 ? 'win' : result.payout < 0 ? 'lose' : 'push';
                return (
                  <div
                    key={result.playerId}
                    data-testid={`holdem-result-${result.playerId}`}
                    data-outcome={polarity}
                    className={`${PANEL_CLASS} font-body text-sm ${RESULT_COLOR[polarity]}`}
                  >
                    {result.payout > 0
                      ? `${result.playerId} won ${result.payout}`
                      : result.payout < 0
                        ? `${result.playerId} lost ${Math.abs(result.payout)}`
                        : `${result.playerId} split even`}
                  </div>
                );
              })}
            </div>
          )}
          {isMyTurn && (
            <div className="flex items-center gap-2">
              <Button variant="danger" onClick={() => onAction('fold')}>
                Fold
              </Button>
              <Button variant="neutral" onClick={() => onAction('check')}>
                Check
              </Button>
              <Button variant="neutral" onClick={() => onAction('call')}>
                Call
              </Button>
              <input
                type="number"
                value={raiseAmount}
                onChange={(event) => setRaiseAmount(Number(event.target.value))}
                aria-label="Raise amount"
                min={1}
                step={1}
                max={myPlayer ? myPlayer.stack : undefined}
                className="w-20 rounded-md border border-wood-grain bg-surface px-2 py-1 text-fg"
              />
              <Button variant="primary" onClick={() => onAction('raise', raiseAmount)}>
                Raise
              </Button>
              <Button variant="danger" onClick={() => onAction('all-in')}>
                All In
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={`${PANEL_CLASS} text-fg-dim`}>Waiting for hand to start…</div>
      )}
    </GameTable>
  );
}
