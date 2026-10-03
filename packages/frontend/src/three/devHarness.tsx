import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BlackjackRoundView, HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card, PlayerHand } from '@poker-blackjack/game-engine';
import { Blackjack3D } from './Blackjack3D';
import { Poker3D } from './Poker3D';
import { FlatTable } from '../table/FlatTable';
import type { BlindSeats } from '../hud/hudModel';
import '../index.css';

// Dev-only harness (open /dev3d.html under `npm run dev`; add `?game=poker` for
// Hold'em): drives the 3D table through a scripted hand with fixture snapshots, so the scene can be checked
// without a server or admin login. Not part of the production build.

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const hand = (cards: Card[], bet: number, done = false): PlayerHand => ({ cards, bet, doubled: false, done });

const NAMES = ['you', 'bob', 'cara', 'dan', 'edna', 'fay'];

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
  clockMs?: number;
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
    [hand([c('K', 'hearts'), c('4', 'clubs')], 75)],
  ];
  const out: Record<number, BlackjackRoundView> = {};
  for (let i = 0; i < n; i++) out[i] = round(phase, i === 0 ? mine : others[i - 1], dealerCards, results?.(i) ?? null);
  return out;
}

const MINE = [hand([c('7', 'diamonds'), c('4', 'clubs')], 25)];
const MINE_HIT = [hand([c('7', 'diamonds'), c('4', 'clubs'), c('9', 'spades')], 25)];
const win = (n: number) => ({ outcome: 'win' as const, payout: n });
const SPLIT = [hand([c('8', 'hearts'), c('3', 'clubs')], 25), hand([c('8', 'spades'), c('5', 'clubs')], 25)];
const SPLIT_LONG = [
  hand([c('8', 'hearts'), c('3', 'clubs'), c('2', 'diamonds'), c('5', 'spades')], 25),
  hand([c('8', 'spades'), c('5', 'clubs'), c('A', 'diamonds'), c('2', 'clubs')], 25),
];

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
  { label: 'Six seats', count: 6, inProgress: true, active: 0, rounds: allRounds(6, MINE, 'playing', null) },
  // Layout, framing and turn-light steps for the readability gates (plan A, Gates 1 and 2).
  { label: '2 players, bob acts', count: 2, inProgress: true, active: 1, rounds: allRounds(2, MINE, 'playing', null) },
  { label: '3 players, cara acts', count: 3, inProgress: true, active: 2, rounds: allRounds(3, MINE, 'playing', null) },
  { label: '6 players, edna acts', count: 6, inProgress: true, active: 4, rounds: allRounds(6, MINE, 'playing', null) },
  { label: 'Split, your turn', count: 4, inProgress: true, active: 0, rounds: allRounds(4, SPLIT, 'playing', null) },
  { label: 'Split, 4-card hands', count: 4, inProgress: true, active: 0, rounds: allRounds(4, SPLIT_LONG, 'playing', null) },
];

// Gate 3 (Plan B): the opponent's-turn state with the turn clock running.
STEPS.push({ ...STEPS[4], label: 'Opponent acts, 41 s on the clock', clockMs: 41_000 });

type P = HoldemView['players'][number];
const pl = (playerId: string, stack: number, streetContributed: number, holeCards: P['holeCards'], extra: Partial<P> = {}): P => ({
  playerId,
  stack,
  streetContributed,
  folded: false,
  isAllIn: false,
  holeCards,
  ...extra,
});

const FLOP = [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts')];
const TURN = [...FLOP, c('J', 'spades')];
const RIVER = [...TURN, c('9', 'clubs')];

function holdem(
  street: HoldemView['street'],
  community: Card[],
  acting: string | null,
  players: P[],
  pot: number,
  results: HoldemView['results'] = null,
): HoldemView {
  return {
    street,
    communityCards: community,
    actingPlayerId: acting,
    pots: [{ amount: pot, eligiblePlayerIds: players.filter((p) => !p.folded).map((p) => p.playerId) }],
    results,
    players,
  };
}

const MY_HOLE: P['holeCards'] = [c('A', 'spades'), c('K', 'hearts')];

interface PokerStep {
  label: string;
  count: number;
  inProgress: boolean;
  holdem: HoldemView | null;
  blinds?: BlindSeats;
  clockMs?: number;
}

function pokerPlayers(bets: number[], opts: { folded?: string[]; reveal?: boolean } = {}): P[] {
  const holes: P['holeCards'][] = [
    MY_HOLE,
    [c('Q', 'clubs'), c('Q', 'diamonds')],
    [c('9', 'hearts'), c('8', 'hearts')],
    [c('K', 'clubs'), c('3', 'spades')],
    [c('5', 'diamonds'), c('5', 'clubs')],
    [c('J', 'diamonds'), c('10', 'clubs')],
  ];
  return bets.map((bet, i) =>
    pl(NAMES[i], 1000 - bet, bet, i === 0 || opts.reveal ? holes[i] : null, { folded: opts.folded?.includes(NAMES[i]) ?? false }),
  );
}

const POKER_STEPS: PokerStep[] = [
  { label: 'Waiting', count: 5, inProgress: false, holdem: null },
  { label: 'Preflop', count: 5, inProgress: true, holdem: holdem('preflop', [], 'you', pokerPlayers([10, 5, 10, 10, 10]), 45) },
  { label: 'Flop', count: 5, inProgress: true, holdem: holdem('flop', FLOP, 'you', pokerPlayers([0, 0, 40, 0, 0]), 85) },
  { label: 'Turn', count: 5, inProgress: true, holdem: holdem('turn', TURN, 'bob', pokerPlayers([50, 50, 0, 0, 0], { folded: ['dan'] }), 185) },
  { label: 'River', count: 5, inProgress: true, holdem: holdem('river', RIVER, 'you', pokerPlayers([0, 120, 0, 0, 0], { folded: ['dan', 'edna'] }), 305) },
  {
    label: 'Showdown',
    count: 5,
    inProgress: true,
    holdem: holdem('settled', RIVER, null, pokerPlayers([0, 0, 0, 0, 0], { folded: ['dan', 'edna'], reveal: true }), 305, [
      { playerId: 'you', payout: 150 },
      { playerId: 'bob', payout: -150 },
      { playerId: 'cara', payout: 0 },
    ]),
  },
  { label: '2 players, bob acts', count: 2, inProgress: true, holdem: holdem('preflop', [], 'bob', pokerPlayers([10, 5]), 15) },
  { label: '3 players, cara acts', count: 3, inProgress: true, holdem: holdem('flop', FLOP, 'cara', pokerPlayers([0, 20, 0]), 50) },
  {
    label: '6 players, fay acts',
    count: 6,
    inProgress: true,
    holdem: holdem('turn', TURN, 'fay', pokerPlayers([40, 40, 0, 40, 0, 0], { folded: ['dan'] }), 240),
  },
  {
    label: 'Your turn, 23 s on the clock',
    count: 5,
    inProgress: true,
    blinds: { buttonSeatIndex: 2, smallBlindSeatIndex: 3, bigBlindSeatIndex: 4 },
    clockMs: 23_000,
    holdem: holdem('flop', FLOP, 'you', pokerPlayers([0, 0, 40, 0, 0]), 85),
  },
  {
    label: '6 players, fay acts, 8 s left',
    count: 6,
    inProgress: true,
    blinds: { buttonSeatIndex: 3, smallBlindSeatIndex: 4, bigBlindSeatIndex: 5 },
    clockMs: 8_000,
    holdem: holdem('turn', TURN, 'fay', pokerPlayers([40, 40, 0, 40, 0, 0], { folded: ['dan'] }), 240),
  },
  {
    label: 'Showdown, split pot',
    count: 3,
    inProgress: false,
    holdem: holdem(
      'settled',
      [c('Q', 'hearts'), c('Q', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), c('2', 'clubs')],
      null,
      [
        pl('you', 1030, 0, [c('A', 'spades'), c('K', 'hearts')]),
        pl('bob', 940, 0, [c('9', 'hearts'), c('8', 'clubs')]),
        pl('cara', 1030, 0, [c('A', 'diamonds'), c('J', 'clubs')]),
      ],
      180,
      [
        { playerId: 'you', payout: 30, handName: "Two Pair, Q's & 7's", bestCards: [c('Q', 'hearts'), c('Q', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), c('A', 'spades')] },
        { playerId: 'bob', payout: -60, handName: "Two Pair, Q's & 7's", bestCards: [c('Q', 'hearts'), c('Q', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), c('9', 'hearts')] },
        { playerId: 'cara', payout: 30, handName: "Two Pair, Q's & 7's", bestCards: [c('Q', 'hearts'), c('Q', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), c('A', 'diamonds')] },
      ],
    ),
  },
];

function PokerHarness() {
  const [i, setI] = useState(() => Number(new URLSearchParams(location.search).get('step') ?? 0));
  const step = POKER_STEPS[Math.min(i, POKER_STEPS.length - 1)];
  return (
    <>
      {flatParam ? (
      <FlatTable
        table={{
          gameMode: 'holdem',
          handInProgress: step.inProgress,
          seats: seats(step.count),
          activeSeatIndex: null,
          actionSeq: 0,
          handStartError: null,
          blackjackRounds: null,
          holdem: step.holdem,
          buttonSeatIndex: null,
          smallBlindSeatIndex: null,
          bigBlindSeatIndex: null,
          turnClockRemainingMs: null,
        }}
        mySeatIndex={0}
        connectionStatus="at-table"
        actionPending={false}
        onReady={() => undefined}
        onAction={() => undefined}
        onLeave={() => undefined}
        controls={null}
      />
      ) : (
      <Poker3D
        seats={seats(step.count)}
        mySeatIndex={0}
        connectionStatus="at-table"
        handInProgress={step.inProgress}
        holdem={step.holdem}
        blinds={step.blinds}
        turnClockRemainingMs={step.clockMs ?? null}
        onReady={() => undefined}
        onLeave={() => undefined}
        onAction={() => setI((n) => Math.min(n + 1, POKER_STEPS.length - 1))}
        onSwitchTo2D={() => undefined}
        onUnsupported={() => undefined}
      />
      )}
      {showBar && (
      <div className="fixed left-1/2 top-12 z-50 flex -translate-x-1/2 gap-2 text-xs">
        <button data-testid="prev" className="rounded bg-black/70 px-2 py-1 text-white" onClick={() => setI((n) => Math.max(0, n - 1))}>
          ◀
        </button>
        <span className="rounded bg-black/70 px-2 py-1 text-white">
          {i}: {step.label}
        </span>
        <button data-testid="next" className="rounded bg-black/70 px-2 py-1 text-white" onClick={() => setI((n) => (n + 1) % POKER_STEPS.length)}>
          ▶
        </button>
      </div>
      )}
    </>
  );
}

function Harness() {
  const [i, setI] = useState(() => Number(new URLSearchParams(location.search).get('step') ?? 0));
  const [mode, setMode] = useState(() => new URLSearchParams(location.search).get('quality'));
  const step = STEPS[Math.min(i, STEPS.length - 1)];
  if (mode) window.localStorage.setItem('bj3d.quality', mode);
  return (
    <>
      {flatParam ? (
      <FlatTable
        table={{
          gameMode: 'blackjack',
          handInProgress: step.inProgress,
          seats: seats(step.count),
          activeSeatIndex: step.active,
          actionSeq: 0,
          handStartError: null,
          blackjackRounds: step.rounds,
          holdem: null,
          buttonSeatIndex: null,
          smallBlindSeatIndex: null,
          bigBlindSeatIndex: null,
          turnClockRemainingMs: null,
        }}
        mySeatIndex={0}
        connectionStatus="at-table"
        actionPending={false}
        onReady={() => undefined}
        onAction={() => undefined}
        onLeave={() => undefined}
        controls={null}
      />
      ) : (
      <Blackjack3D
        seats={seats(step.count)}
        activeSeatIndex={step.active}
        mySeatIndex={0}
        connectionStatus="at-table"
        handInProgress={step.inProgress}
        blackjackRounds={step.rounds}
        turnClockRemainingMs={step.clockMs ?? null}
        onReady={() => undefined}
        onLeave={() => undefined}
        onAction={() => setI((n) => Math.min(n + 1, STEPS.length - 1))}
        onSwitchTo2D={() => setMode(null)}
        onUnsupported={() => undefined}
      />
      )}
      {showBar && (
      <div className="fixed left-1/2 top-12 z-50 flex -translate-x-1/2 gap-2 text-xs">
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
      )}
    </>
  );
}

// ?layout=flat renders the flat table (the HUD in one column) instead of the 3D scene.
const flatParam = new URLSearchParams(location.search).get('layout') === 'flat';

// ?bar=0 hides the step bar so it cannot cover the HUD in screenshots.
const showBar = new URLSearchParams(location.search).get('bar') !== '0';

// ?quality=low|medium|high sets the persisted graphics preference before the scene reads it.
const qualityParam = new URLSearchParams(location.search).get('quality');
if (qualityParam) window.localStorage.setItem('bj3d.quality', qualityParam);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('game') === 'poker' ? <PokerHarness /> : <Harness />}
  </StrictMode>,
);
