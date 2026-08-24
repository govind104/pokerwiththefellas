import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Outcome } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { Chip } from './Chip';
import { GameTable } from './GameTable';
import { Button } from './Button';
import { PANEL_CLASS, PANEL_CLASS_SM } from './panelStyles';

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

  const players = seats.filter((s) => s.displayName).sort((a, b) => a.seatIndex - b.seatIndex);

  return (
    <GameTable
      seats={seats}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
    >
      <div className="flex h-full flex-col items-center justify-between gap-2 py-2">
        {blackjackRounds ? (
          <div className="flex flex-col items-center gap-1" data-testid="dealer-hand">
            <p className={`${PANEL_CLASS} font-utility text-xs uppercase tracking-wide text-brass-bright`}>Dealer</p>
            <div className="flex gap-1">
              {dealerRound?.dealerCards
                ? dealerRound.dealerCards.map((card, i) => <Card key={i} card={card} />)
                : dealerRound && <Card card={dealerRound.dealerUpcard} />}
            </div>
          </div>
        ) : (
          <div className={`${PANEL_CLASS} text-fg-dim`}>Waiting for hand to start…</div>
        )}

        <div className="flex flex-1 items-center justify-center gap-3 overflow-x-auto">
          {players.map((seat) => {
            const round = blackjackRounds?.[seat.seatIndex];
            const isActive = seat.seatIndex === activeSeatIndex;
            const isMe = seat.seatIndex === mySeatIndex;
            const totalBet = round ? round.playerHands.reduce((sum, hand) => sum + hand.bet, 0) : 0;

            let status: string;
            if (!round) {
              status = seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
            } else if (!seat.connected) {
              // Mid-round, the seat's own turn (if it comes up) is still
              // resolved by the server's grace-window timeout regardless of
              // this label -- it exists so the table doesn't silently sit on
              // "Bet X"/"Thinking…" while the player's socket is actually
              // gone, which otherwise looks identical to them just playing normally.
              //
              // Unlike PokerTable's rail (which explicitly excludes
              // mySeatIndex), `players` here includes our own seat, so this
              // branch is reachable for isMe too in principle. In practice it
              // never renders for ourselves: a disconnected local socket
              // can't receive the broadcast that would report its own
              // seat as connected:false, so `state` stays frozen on the last
              // known-good snapshot until we reconnect.
              status = 'Disconnected';
            } else {
              status = isActive ? (isMe ? 'Your turn' : 'Thinking…') : `Bet ${totalBet}`;
            }

            return (
              <div
                key={seat.seatIndex}
                data-testid={`player-${seat.seatIndex}`}
                data-active={isActive ? 'true' : 'false'}
                className="flex shrink-0 flex-col items-center gap-1.5"
              >
                {round && (
                  <div className="flex gap-3">
                    {round.playerHands.map((hand, i) => {
                      const outcome = round.phase === 'settled' && round.results ? round.results[i].outcome : null;
                      const polarity = outcome ? OUTCOME_POLARITY[outcome] : null;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div className="flex gap-1">
                            {hand.cards.map((card, j) => (
                              <Card key={`${card.rank}-${card.suit}-${j}`} card={card} />
                            ))}
                          </div>
                          <div
                            data-testid={`hand-bet-${seat.seatIndex}-${i}`}
                            aria-label={`Bet: ${hand.bet}`}
                            className={PANEL_CLASS_SM}
                          >
                            <Chip
                              key={`${hand.bet}-${hand.cards.map((c) => `${c.rank}${c.suit}`).join('')}`}
                              value={hand.bet}
                            />
                          </div>
                          {outcome && polarity && (
                            <div
                              className={`${PANEL_CLASS_SM} font-body text-xs font-semibold ${OUTCOME_COLOR[polarity]}`}
                              data-testid={`hand-result-${seat.seatIndex}-${i}`}
                              data-outcome={polarity}
                            >
                              {OUTCOME_LABELS[outcome]}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div
                  className={`flex flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 ${
                    isActive ? 'border-brass-bright bg-surface-raised seat-active-glow' : 'border-wood-grain bg-surface'
                  }`}
                >
                  <span className="text-sm font-semibold text-parchment">
                    {seat.displayName} &middot; {seat.balance}
                  </span>
                  <span
                    className={`text-xs ${!seat.connected ? 'text-ember-text' : isActive ? 'text-brass-bright' : 'text-fg-dim'}`}
                  >
                    {status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {isMyTurn && (
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => onAction('hit')}>
              Hit
            </Button>
            <Button variant="neutral" onClick={() => onAction('stand')}>
              Stand
            </Button>
            <Button variant="primary" onClick={() => onAction('double')}>
              Double
            </Button>
            <Button variant="danger" onClick={() => onAction('split')}>
              Split
            </Button>
          </div>
        )}
      </div>
    </GameTable>
  );
}
