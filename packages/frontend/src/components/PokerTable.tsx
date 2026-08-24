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

function polarityOf(payout: number): ResultPolarity {
  return payout > 0 ? 'win' : payout < 0 ? 'lose' : 'push';
}

function resultLabel(payout: number, wonPrefix: string, lostPrefix: string, pushLabel: string): string {
  return payout > 0 ? `${wonPrefix} ${payout}` : payout < 0 ? `${lostPrefix} ${Math.abs(payout)}` : pushLabel;
}

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
  const mySeatDisplayName = seats.find((s) => s.seatIndex === mySeatIndex)?.displayName;
  const myHoleCards = holdem
    ? (holdem.players.find((p) => p.playerId === mySeatDisplayName)?.holeCards ?? null)
    : null;

  // A value typed into the raise field on one street/turn must not leak into
  // the next -- reset whenever the street or the acting player changes (a new
  // street, a new turn, or a new hand entirely).
  useEffect(() => {
    setRaiseAmount(0);
  }, [holdem?.street, holdem?.actingPlayerId]);

  const opponents = seats
    .filter((s) => s.seatIndex !== mySeatIndex && s.displayName)
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const railSlot: ReactNode =
    opponents.length > 0 ? (
      <>
        {opponents.map((seat) => {
          const player = holdem?.players.find((p) => p.playerId === seat.displayName) ?? null;
          const isActive = holdem !== null && seat.seatIndex === activeSeatIndex;
          const result =
            holdem?.street === 'settled'
              ? (holdem.results?.find((r) => r.playerId === seat.displayName) ?? null)
              : null;
          const polarity = result ? polarityOf(result.payout) : null;

          let statusNode: ReactNode;
          if (!holdem) {
            statusNode = seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
          } else if (player?.folded) {
            statusNode = <span className="rounded border border-wood-grain px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-faint">Folded</span>;
          } else if (result && polarity) {
            statusNode = (
              <span
                className={`rounded border border-wood-grain bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${RESULT_COLOR[polarity]}`}
              >
                {resultLabel(result.payout, 'Won', 'Lost', 'Push')}
              </span>
            );
          } else if (!seat.connected) {
            // Mid-hand, an opponent's own turn is still resolved by the
            // server's grace-window timeout (auto-check/auto-fold) whether or
            // not this label appears -- this is purely so the table doesn't
            // silently sit on "Thinking…"/"Waiting" while someone's socket is
            // actually gone, which otherwise looks identical to them just
            // taking their time.
            statusNode = (
              <span className="rounded border border-wood-grain px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ember-text">
                Disconnected
              </span>
            );
          } else {
            statusNode = isActive ? 'Thinking…' : 'Waiting';
          }

          return (
            <div
              key={seat.seatIndex}
              data-testid={`player-info-${seat.seatIndex}`}
              data-active={isActive ? 'true' : 'false'}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                isActive ? 'border-brass-bright bg-surface-raised seat-active-glow' : 'border-wood-grain bg-surface'
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brass bg-wood text-sm font-bold text-parchment">
                {seat.displayName?.[0]?.toUpperCase()}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-parchment">
                  {seat.displayName} &middot; {seat.balance}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-fg-dim">{statusNode}</span>
              </div>
              {player?.holeCards && (
                <div data-testid={`player-cards-${seat.seatIndex}`} className="flex gap-1">
                  {player.holeCards.map((card, i) => (
                    <div key={i} className="h-[29px] w-[19px] overflow-hidden rounded-sm">
                      <div className="origin-top-left" style={{ transform: 'scale(0.3)' }}>
                        <Card card={card} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </>
    ) : undefined;

  const myResult = (() => {
    if (holdem?.street !== 'settled' || !holdem.results) return null;
    const result = holdem.results.find((r) => r.playerId === mySeatDisplayName);
    return result ?? null;
  })();

  const bottomCenterSlot: ReactNode =
    holdem && myHoleCards ? (
      <>
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
        {myResult && (
          <div data-testid="my-result" className={`${PANEL_CLASS} text-sm ${RESULT_COLOR[polarityOf(myResult.payout)]}`}>
            {resultLabel(myResult.payout, 'You won', 'You lost', 'You split even')}
          </div>
        )}
        <div data-testid="my-hand" className="flex items-end gap-1">
          <div className="flex h-[190px] w-[130px] items-center justify-center" style={{ transform: 'rotate(-6deg)' }}>
            <div style={{ transform: 'scale(2)' }}>
              <Card card={myHoleCards[0]} />
            </div>
          </div>
          <div className="flex h-[190px] w-[130px] items-center justify-center" style={{ transform: 'rotate(6deg)' }}>
            <div style={{ transform: 'scale(2)' }}>
              <Card card={myHoleCards[1]} />
            </div>
          </div>
        </div>
      </>
    ) : undefined;

  return (
    <GameTable
      seats={seats}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
      railSlot={railSlot}
      bottomCenterSlot={bottomCenterSlot}
    >
      {holdem ? (
        <div className="mb-auto mt-[6vh] flex flex-col items-center gap-2">
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
        </div>
      ) : (
        <div className={`${PANEL_CLASS} text-fg-dim`}>Waiting for hand to start…</div>
      )}
    </GameTable>
  );
}
