import { useEffect, useState, type ReactNode } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';

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
          <Card card={player.holeCards?.[0]} faceDown={player.holeCards === null} />
          <Card card={player.holeCards?.[1]} faceDown={player.holeCards === null} />
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
            className="flex items-center gap-1.5 rounded-md border border-wood-grain bg-surface px-3 py-1 font-utility text-sm text-brass-bright"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <circle cx="10" cy="10" r="9" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1" />
              <circle cx="10" cy="10" r="5.5" fill="none" stroke="var(--ink)" strokeWidth="0.75" strokeDasharray="1.5 2" />
            </svg>
            Pot: {holdem.pots.reduce((sum, pot) => sum + pot.amount, 0)}
          </div>
          {holdem.street === 'settled' && holdem.results && (
            <div className="flex flex-col items-center gap-1" data-testid="holdem-results">
              {holdem.results.map((result) => (
                <div
                  key={result.playerId}
                  data-testid={`holdem-result-${result.playerId}`}
                  className={`rounded-md border border-wood-grain bg-surface px-3 py-1 font-body text-sm ${
                    result.payout > 0
                      ? 'text-win-bright'
                      : result.payout < 0
                        ? 'text-ember-text'
                        : 'text-parchment-dim'
                  }`}
                >
                  {result.payout > 0
                    ? `${result.playerId} won ${result.payout}`
                    : result.payout < 0
                      ? `${result.playerId} lost ${Math.abs(result.payout)}`
                      : `${result.playerId} split even`}
                </div>
              ))}
            </div>
          )}
          {isMyTurn && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onAction('fold')}
                className="rounded-md border border-ember bg-surface px-3 py-1 text-ember-text hover:bg-surface-raised"
              >
                Fold
              </button>
              <button
                onClick={() => onAction('check')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Check
              </button>
              <button
                onClick={() => onAction('call')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Call
              </button>
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
              <button
                onClick={() => onAction('raise', raiseAmount)}
                className="rounded-md border border-brass-bright bg-brass px-3 py-1 text-ink hover:bg-brass-bright"
              >
                Raise
              </button>
              <button
                onClick={() => onAction('all-in')}
                className="rounded-md border border-ember-bright bg-surface px-3 py-1 text-ember-text hover:bg-surface-raised"
              >
                All In
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
