import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BlackjackRoundView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card, PlayerHand } from '@poker-blackjack/game-engine';
import { Blackjack3D } from './Blackjack3D';
import '../index.css';

// Dev-only harness (open /dev3d.html under `npm run dev`): drives the 3D table
// through a scripted hand with fixture snapshots, so the scene can be checked
// without a server or admin login. Not part of the production build.

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const hand = (cards: Card[], bet: number, done = false): PlayerHand => ({ cards, bet, doubled: false, done });

const NAMES = ['you', 'bob', 'cara', 'dan', 'edna'];

function seats(count: number): SeatView[] {
  return Array.from({ length: 6 }, (_, i) => ({
    seatIndex: i,
    displayName: i < count ? NAMES[i] : null,
    balance: 1000 - i * 75,
    connected: true,
    ready: true,
  }));
}

interface Step {
  label: string;
  count: number;
  inProgress: boolean;
  active: number | null;
  rounds: Record<number, BlackjackRoundView> | null;
}

function round(
  phase: BlackjackRoundView['phase'],
  hands: PlayerHand[],
  dealerCards: Card[] | null,
  results: BlackjackRoundView['results'] = null,
): BlackjackRoundView {
  return { phase, playerHands: hands, dealerUpcard: c('K', 'spades'), dealerCards, results };
}

function allRounds(
  n: number,
  mine: PlayerHand[],
  phase: BlackjackRoundView['phase'],
  dealerCards: Card[] | null,
  results?: (i: number) => BlackjackRoundView['results'],
): Record<number, BlackjackRoundView> {
  const others: PlayerHand[][] = [
    [hand([c('9', 'hearts'), c('8', 'clubs')], 50, true)],
    [hand([c('A', 'spades'), c('6', 'diamonds')], 25)],
    [hand([c('10', 'diamonds'), c('J', 'clubs')], 100)],
    [hand([c('5', 'hearts'), c('5', 'spades')], 25)],
  ];
  const out: Record<number, BlackjackRoundView> = {};
  for (let i = 0; i < n; i++) out[i] = round(phase, i === 0 ? mine : others[i - 1], dealerCards, results?.(i) ?? null);
  return out;
}

const MINE = [hand([c('7', 'diamonds'), c('4', 'clubs')], 25)];
const MINE_HIT = [hand([c('7', 'diamonds'), c('4', 'clubs'), c('9', 'spades')], 25)];
const win = (n: number) => ({ outcome: 'win' as const, payout: n });

const STEPS: Step[] = [
  { label: 'Waiting', count: 4, inProgress: false, active: null, rounds: null },
  { label: 'Deal', count: 4, inProgress: true, active: 0, rounds: allRounds(4, MINE, 'playing', null) },
  { label: 'You hit', count: 4, inProgress: true, active: 0, rounds: allRounds(4, MINE_HIT, 'playing', null) },
  { label: 'You stand', count: 4, inProgress: true, active: 1, rounds: allRounds(4, MINE_HIT, 'playing', null) },
  { label: 'Cara plays', count: 4, inProgress: true, active: 2, rounds: allRounds(4, MINE_HIT, 'playing', null) },
  {
    label: 'Dealer reveals',
    count: 4,
    inProgress: true,
    active: null,
    rounds: allRounds(4, MINE_HIT, 'dealer', [c('K', 'spades'), c('7', 'hearts')]),
  },
  {
    label: 'Settled',
    count: 4,
    inProgress: true,
    active: null,
    rounds: allRounds(4, MINE_HIT, 'settled', [c('K', 'spades'), c('7', 'hearts')], (i) => [
      i === 0 ? win(25) : i === 2 ? { outcome: 'push', payout: 0 } : { outcome: 'lose', payout: -25 },
    ]),
  },
  { label: 'Next hand', count: 4, inProgress: false, active: null, rounds: null },
  { label: 'Six seats', count: 6, inProgress: true, active: 0, rounds: null },
];

function Harness() {
  const [i, setI] = useState(() => Number(new URLSearchParams(location.search).get('step') ?? 0));
  const [mode, setMode] = useState(() => new URLSearchParams(location.search).get('quality'));
  const step = STEPS[Math.min(i, STEPS.length - 1)];
  if (mode) window.localStorage.setItem('bj3d.quality', mode);
  return (
    <>
      <Blackjack3D
        seats={seats(step.count)}
        activeSeatIndex={step.active}
        mySeatIndex={0}
        connectionStatus="at-table"
        handInProgress={step.inProgress}
        blackjackRounds={step.rounds}
        onReady={() => undefined}
        onLeave={() => undefined}
        onAction={() => setI((n) => Math.min(n + 1, STEPS.length - 1))}
        onSwitchTo2D={() => setMode(null)}
        onUnsupported={() => undefined}
      />
      <div className="fixed bottom-2 right-2 z-50 flex gap-2 text-xs">
        <button data-testid="prev" className="rounded bg-black/70 px-2 py-1 text-white" onClick={() => setI((n) => Math.max(0, n - 1))}>
          ◀
        </button>
        <span className="rounded bg-black/70 px-2 py-1 text-white">
          {i}: {step.label}
        </span>
        <button
          data-testid="next"
          className="rounded bg-black/70 px-2 py-1 text-white"
          onClick={() => setI((n) => (n + 1) % STEPS.length)}
        >
          ▶
        </button>
      </div>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
