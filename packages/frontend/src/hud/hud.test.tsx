import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BlackjackRoundView, HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card } from '@poker-blackjack/game-engine';
import { HoldemHud, type HoldemHudProps } from './HoldemHud';
import { BlackjackHud, type BlackjackHudProps } from './BlackjackHud';
import type { HudLayout } from './TableHud';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const seat = (seatIndex: number, displayName: string, extra: Partial<SeatView> = {}): SeatView => ({
  seatIndex,
  displayName,
  balance: 1000,
  connected: true,
  ready: true,
  ...extra,
});

function holdemView(over: Partial<HoldemView> = {}): HoldemView {
  return {
    street: 'preflop',
    communityCards: [],
    actingPlayerId: 'alice',
    pots: [],
    results: null,
    players: [
      { playerId: 'alice', stack: 995, streetContributed: 5, folded: false, isAllIn: false, holeCards: [c('A', 'spades'), c('K', 'hearts')] },
      { playerId: 'bob', stack: 990, streetContributed: 10, folded: false, isAllIn: false, holeCards: null },
    ],
    ...over,
  };
}

function holdemProps(over: Partial<HoldemHudProps> = {}): HoldemHudProps {
  return {
    layout: 'overlay',
    seats: [seat(0, 'alice'), seat(1, 'bob')],
    mySeatIndex: 0,
    handInProgress: true,
    holdem: holdemView(),
    blinds: { buttonSeatIndex: 0, smallBlindSeatIndex: 0, bigBlindSeatIndex: 1 },
    turnClockRemainingMs: null,
    actionPending: false,
    onAction: vi.fn(),
    onReady: vi.fn(),
    onLeave: vi.fn(),
    ...over,
  };
}

const round: BlackjackRoundView = {
  phase: 'playing',
  playerHands: [{ cards: [c('7', 'diamonds'), c('7', 'clubs')], bet: 25, doubled: false, done: false }],
  dealerUpcard: c('K', 'spades'),
  dealerCards: null,
  results: null,
};

function bjProps(over: Partial<BlackjackHudProps> = {}): BlackjackHudProps {
  return {
    layout: 'overlay',
    seats: [seat(0, 'alice'), seat(1, 'bob')],
    mySeatIndex: 0,
    activeSeatIndex: 0,
    handInProgress: true,
    blackjackRounds: { 0: round, 1: round },
    turnClockRemainingMs: null,
    actionPending: false,
    onAction: vi.fn(),
    onReady: vi.fn(),
    onLeave: vi.fn(),
    ...over,
  };
}

describe.each<HudLayout>(['overlay', 'column'])('HoldemHud (%s)', (layout) => {
  it('shows rows, badges, my cards and the board', () => {
    render(<HoldemHud {...holdemProps({ layout })} />);
    const me = screen.getByTestId('hud-player-0');
    expect(me).toHaveAttribute('data-active', 'true');
    expect(within(me).getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual(['A of spades', 'K of hearts']);
    expect(within(me).getByText('D')).toBeInTheDocument();
    expect(within(me).getByText('SB')).toBeInTheDocument();
    expect(within(screen.getByTestId('hud-player-1')).queryAllByRole('img')).toHaveLength(0);
    expect(within(screen.getByTestId('hud-board')).getAllByRole('img')).toHaveLength(5);
    expect(screen.getByTestId('hud-pot')).toHaveTextContent('Pot 15');
  });

  it('acts from the buttons and the keyboard, but not while typing a raise', async () => {
    const p = holdemProps({ layout });
    render(<HoldemHud {...p} />);
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    await userEvent.keyboard('c');
    expect(p.onAction).toHaveBeenLastCalledWith('call');
    await userEvent.type(screen.getByLabelText('Raise amount'), 'f');
    expect(p.onAction).not.toHaveBeenCalledWith('fold');
    await userEvent.clear(screen.getByLabelText('Raise amount'));
    await userEvent.type(screen.getByLabelText('Raise amount'), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(p.onAction).toHaveBeenLastCalledWith('raise', 40);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('f');
    expect(p.onAction).toHaveBeenLastCalledWith('fold');
  });

  it('presses Check with C when nothing is owed', async () => {
    const p = holdemProps({
      layout,
      holdem: holdemView({
        players: [
          { playerId: 'alice', stack: 990, streetContributed: 10, folded: false, isAllIn: false, holeCards: [c('A', 'spades'), c('K', 'hearts')] },
          { playerId: 'bob', stack: 990, streetContributed: 10, folded: false, isAllIn: false, holeCards: null },
        ],
      }),
    });
    render(<HoldemHud {...p} />);
    await userEvent.keyboard('c');
    expect(p.onAction).toHaveBeenLastCalledWith('check');
  });

  it('ignores shortcuts and disables buttons while an action is pending', async () => {
    const p = holdemProps({ layout, actionPending: true });
    render(<HoldemHud {...p} />);
    await userEvent.keyboard('fcr');
    expect(p.onAction).not.toHaveBeenCalled();
    for (const name of ['Fold', 'Call 5', 'Raise', 'All In']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('readies with Space between hands and offers Leave', async () => {
    const p = holdemProps({ layout, handInProgress: false, holdem: null, seats: [seat(0, 'alice', { ready: false }), seat(1, 'bob')] });
    render(<HoldemHud {...p} />);
    await userEvent.keyboard(' ');
    expect(p.onReady).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(p.onLeave).toHaveBeenCalled();
  });

  it('offers Leave mid-hand only to a seat that was not dealt in', () => {
    const { unmount } = render(<HoldemHud {...holdemProps({ layout })} />);
    expect(screen.queryByRole('button', { name: 'Leave table' })).not.toBeInTheDocument();
    unmount();
    render(<HoldemHud {...holdemProps({ layout, seats: [seat(0, 'alice'), seat(1, 'bob'), seat(2, 'cara')], mySeatIndex: 2 })} />);
    expect(screen.getByRole('button', { name: 'Leave table' })).toBeInTheDocument();
  });

  it('shows the countdown on the acting row, urgent under 10 s', () => {
    const { rerender } = render(<HoldemHud {...holdemProps({ layout, turnClockRemainingMs: 23_000 })} />);
    const clock = within(screen.getByTestId('hud-player-0')).getByTestId('hud-clock');
    expect(clock).toHaveTextContent('23s');
    expect(clock).toHaveAttribute('data-urgent', 'false');
    rerender(<HoldemHud {...holdemProps({ layout, turnClockRemainingMs: 8_000 })} />);
    expect(screen.getByTestId('hud-clock')).toHaveAttribute('data-urgent', 'true');
  });

  it('shows hand names and highlights the winner at a showdown', () => {
    render(
      <HoldemHud
        {...holdemProps({
          layout,
          handInProgress: false,
          holdem: holdemView({
            street: 'settled',
            actingPlayerId: null,
            communityCards: [c('Q', 'hearts'), c('Q', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), c('2', 'clubs')],
            pots: [{ amount: 20, eligiblePlayerIds: ['alice', 'bob'] }],
            players: [
              { playerId: 'alice', stack: 1010, streetContributed: 0, folded: false, isAllIn: false, holeCards: [c('A', 'spades'), c('K', 'hearts')] },
              { playerId: 'bob', stack: 990, streetContributed: 0, folded: false, isAllIn: false, holeCards: [c('9', 'hearts'), c('8', 'clubs')] },
            ],
            results: [
              { playerId: 'alice', payout: 10, handName: "Two Pair, Q's & 7's", bestCards: [] },
              { playerId: 'bob', payout: -10, handName: "Two Pair, Q's & 7's", bestCards: [] },
            ],
          }),
        })}
      />,
    );
    expect(screen.getByTestId('hud-player-0')).toHaveAttribute('data-won', 'true');
    expect(screen.getByTestId('hud-player-1')).toHaveAttribute('data-won', 'false');
    expect(screen.getAllByText("Two Pair, Q's & 7's")).toHaveLength(2);
    expect(within(screen.getByTestId('hud-player-1')).getAllByRole('img')).toHaveLength(2);
  });
});

describe.each<HudLayout>(['overlay', 'column'])('BlackjackHud (%s)', (layout) => {
  it('shows the dealer upcard and a face-down card, and my total', () => {
    render(<BlackjackHud {...bjProps({ layout })} />);
    expect(within(screen.getByTestId('hud-dealer')).getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual([
      'K of spades',
      'face-down card',
    ]);
    expect(screen.getByTestId('hud-dealer-total')).toHaveTextContent('10 + ?');
    expect(within(screen.getByTestId('hud-cards-0-0')).getByText('14')).toBeInTheDocument();
  });

  it('acts with H S D P and respects legality', async () => {
    const p = bjProps({ layout });
    render(<BlackjackHud {...p} />);
    await userEvent.keyboard('h');
    expect(p.onAction).toHaveBeenLastCalledWith('hit');
    await userEvent.keyboard('p');
    expect(p.onAction).toHaveBeenLastCalledWith('split');
    await userEvent.keyboard('d');
    expect(p.onAction).toHaveBeenLastCalledWith('double');
    await userEvent.keyboard('s');
    expect(p.onAction).toHaveBeenLastCalledWith('stand');
  });

  it('does not double or split when the move is illegal', async () => {
    const p = bjProps({
      layout,
      blackjackRounds: { 0: { ...round, playerHands: [{ cards: [c('7', 'diamonds'), c('4', 'clubs'), c('2', 'clubs')], bet: 25, doubled: false, done: false }] } },
    });
    render(<BlackjackHud {...p} />);
    expect(screen.getByRole('button', { name: 'Double' })).toBeDisabled();
    await userEvent.keyboard('dp');
    expect(p.onAction).not.toHaveBeenCalled();
  });
});
