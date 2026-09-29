import { useEffect, useMemo, useState } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction, Card } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from '../components/Button';
import { buildPokerModel, amountToCall } from './pokerModel';
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
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the 2D table.
  onUnsupported: () => void;
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
  onSwitchTo2D,
  onUnsupported,
}: Poker3DProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);
  const model = useMemo(() => buildPokerModel({ seats, mySeatIndex, holdem }), [seats, mySeatIndex, holdem]);

  const myName = seats.find((s) => s.seatIndex === mySeatIndex)?.displayName;
  const me = holdem?.players.find((p) => p.playerId === myName) ?? null;
  const showActions = model.myTurn && !!me?.holeCards;
  const toCall = holdem && me ? amountToCall(holdem, me) : 0;

  // A value typed into the raise field on one street/turn must not leak into
  // the next: reset whenever the street or the acting player changes.
  useEffect(() => {
    setRaiseAmount(0);
  }, [holdem?.street, holdem?.actingPlayerId]);

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
    >
      {showActions && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-2">
          <Button variant="danger" size="md" onClick={() => onAction('fold')}>
            Fold
          </Button>
          <Button
            variant="neutral"
            size="md"
            disabled={toCall > 0}
            title={toCall > 0 ? 'You are facing a bet' : undefined}
            onClick={() => onAction('check')}
          >
            Check
          </Button>
          <Button
            variant="neutral"
            size="md"
            disabled={toCall === 0}
            title={toCall === 0 ? 'Nothing to call' : undefined}
            onClick={() => onAction('call')}
          >
            {toCall > 0 ? `Call ${toCall}` : 'Call'}
          </Button>
          <input
            type="number"
            value={raiseAmount}
            // Whole, non-negative chips only.
            onChange={(event) => setRaiseAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
            aria-label="Raise amount"
            min={1}
            step={1}
            max={me ? me.stack : undefined}
            className="w-20 rounded-md border border-wood-grain bg-surface px-2 py-2 text-fg"
          />
          <Button variant="primary" size="md" onClick={() => onAction('raise', raiseAmount)}>
            Raise
          </Button>
          <Button variant="danger" size="md" onClick={() => onAction('all-in')}>
            All In
          </Button>
        </div>
      )}
    </TableStage>
  );
}

export default Poker3D;
