import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PokerTable } from './PokerTable';
import {
  makeSeat,
  makeHoldemPreflopState,
  makeHoldemMyTurnState,
  makeHoldemSettledState,
} from '../fixtures/tableStateFixtures';

const baseProps = {
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
  onAction: vi.fn(),
};

describe('PokerTable', () => {
  it('renders my own hole cards face-up in a dedicated hand zone, with no cards shown for opponents mid-hand', () => {
    const state = makeHoldemPreflopState();
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('my-hand').querySelectorAll('img')).toHaveLength(2);
    expect(screen.queryAllByRole('img', { name: /face-down/i })).toHaveLength(0);
    expect(screen.getByTestId('player-info-1').querySelector('img, svg[role="img"]')).not.toBeInTheDocument();
  });

  it('shows Ready/Not ready/Disconnected for an opponent in the rail before a hand starts', () => {
    const seats = [
      makeSeat({ seatIndex: 0, displayName: 'alice', ready: false }),
      makeSeat({ seatIndex: 1, displayName: 'bob', ready: true }),
    ];
    render(<PokerTable {...baseProps} seats={seats} mySeatIndex={0} holdem={null} />);
    // toHaveTextContent checks the row's FULL concatenated text (avatar letter +
    // name + balance + status), so this must be unanchored -- an anchored
    // /^Ready$/ would require the entire row to read exactly "Ready", which it
    // never will since the name/balance text is a sibling in the same row.
    expect(screen.getByTestId('player-info-1')).toHaveTextContent(/ready/i);
  });

  it('shows Disconnected instead of Waiting/Thinking for an opponent mid-hand whose seat is disconnected', () => {
    const state = makeHoldemPreflopState({
      seats: [
        makeSeat({ seatIndex: 0, displayName: 'alice', balance: 990 }),
        makeSeat({ seatIndex: 1, displayName: 'bob', balance: 995, connected: false }),
      ],
    });
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('player-info-1')).toHaveTextContent(/disconnected/i);
  });

  it('still shows Folded for a disconnected opponent who folded, not Disconnected', () => {
    const base = makeHoldemPreflopState();
    const state = makeHoldemPreflopState({
      seats: [
        makeSeat({ seatIndex: 0, displayName: 'alice', balance: 990 }),
        makeSeat({ seatIndex: 1, displayName: 'bob', balance: 995, connected: false }),
      ],
      holdem: {
        ...base.holdem!,
        players: base.holdem!.players.map((p) => (p.playerId === 'bob' ? { ...p, folded: true } : p)),
      },
    });
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('player-info-1')).toHaveTextContent(/folded/i);
    expect(screen.getByTestId('player-info-1')).not.toHaveTextContent(/disconnected/i);
  });

  it('still shows the settlement result for a disconnected opponent, not Disconnected', () => {
    const state = makeHoldemSettledState({
      seats: [
        makeSeat({ seatIndex: 0, displayName: 'alice', balance: 1010 }),
        makeSeat({ seatIndex: 1, displayName: 'bob', balance: 980, connected: false }),
        makeSeat({ seatIndex: 2, displayName: 'carol', balance: 1000 }),
      ],
    });
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('player-info-1')).toHaveTextContent(/lost 20/i);
    expect(screen.getByTestId('player-info-1')).not.toHaveTextContent(/disconnected/i);
  });

  it("highlights the acting opponent's rail row with data-active", () => {
    const state = makeHoldemPreflopState({
      holdem: {
        ...makeHoldemPreflopState().holdem!,
        actingPlayerId: 'bob',
      },
    });
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('player-info-1')).toHaveAttribute('data-active', 'true');
  });

  it('renders community cards and the total pot', () => {
    const state = makeHoldemPreflopState({
      holdem: {
        street: 'flop',
        communityCards: [
          { suit: 'clubs', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'hearts', rank: 'Q' },
        ],
        actingPlayerId: 'bob',
        pots: [{ amount: 10, eligiblePlayerIds: ['alice', 'bob'] }, { amount: 5, eligiblePlayerIds: ['bob'] }],
        results: null,
        players: makeHoldemPreflopState().holdem!.players,
      },
    });
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('community-cards').querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByText(/pot: 15/i)).toBeInTheDocument();
  });

  it('shows betting controls only when it is my turn', () => {
    const notMyTurn = makeHoldemPreflopState();
    const { rerender } = render(
      <PokerTable {...baseProps} seats={notMyTurn.seats} mySeatIndex={1} holdem={notMyTurn.holdem} />
    );
    expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument();

    const myTurn = makeHoldemMyTurnState();
    rerender(<PokerTable {...baseProps} seats={myTurn.seats} mySeatIndex={0} holdem={myTurn.holdem} />);
    expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
  });

  it('sends the right action with amount when a betting control is used', async () => {
    const onAction = vi.fn();
    const state = makeHoldemMyTurnState();
    render(
      <PokerTable {...baseProps} onAction={onAction} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />
    );
    await userEvent.click(screen.getByRole('button', { name: /fold/i }));
    expect(onAction).toHaveBeenCalledWith('fold');

    await userEvent.clear(screen.getByLabelText(/raise amount/i));
    await userEvent.type(screen.getByLabelText(/raise amount/i), '40');
    await userEvent.click(screen.getByRole('button', { name: /^raise$/i }));
    expect(onAction).toHaveBeenCalledWith('raise', 40);
  });

  it('renders a waiting-room view with no crash when holdem is null', () => {
    render(<PokerTable {...baseProps} seats={[makeSeat({ seatIndex: 0 })]} mySeatIndex={0} holdem={null} />);
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });

  it('forwards errorMessage to the shared error banner', () => {
    const state = makeHoldemPreflopState();
    render(
      <PokerTable
        {...baseProps}
        seats={state.seats}
        mySeatIndex={0}
        holdem={state.holdem}
        errorMessage="Cannot check while facing a bet"
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot check while facing a bet');
  });

  it('constrains the raise input with a min, step, and a max based on the acting player\'s stack', () => {
    const state = makeHoldemMyTurnState();
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    const input = screen.getByLabelText(/raise amount/i);
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('step', '1');
    expect(input).toHaveAttribute('max', '990');
  });

  it('resets the raise amount whenever the street or acting player changes', async () => {
    const state = makeHoldemMyTurnState();
    const { rerender } = render(
      <PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />
    );
    await userEvent.clear(screen.getByLabelText(/raise amount/i));
    await userEvent.type(screen.getByLabelText(/raise amount/i), '40');
    expect(screen.getByLabelText(/raise amount/i)).toHaveValue(40);

    const nextStreetState = makeHoldemMyTurnState({
      holdem: { ...state.holdem!, street: 'flop', communityCards: [{ suit: 'clubs', rank: '2' }] },
    });
    rerender(<PokerTable {...baseProps} seats={nextStreetState.seats} mySeatIndex={0} holdem={nextStreetState.holdem} />);

    expect(screen.getByLabelText(/raise amount/i)).toHaveValue(0);
  });

  it("renders showdown results inline in each opponent's rail row, and my own result near my hand", () => {
    const state = makeHoldemSettledState();
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('player-info-1')).toHaveTextContent(/lost 20/i);
    expect(screen.getByTestId('player-info-2')).toHaveTextContent(/push|split/i);
    expect(screen.getByTestId('player-cards-1').querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByTestId('my-result')).toHaveTextContent(/won 20/i);
  });

  it('does not render my-result or revealed opponent cards before the street is settled', () => {
    const state = makeHoldemPreflopState();
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.queryByTestId('my-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('player-cards-1')).not.toBeInTheDocument();
  });

  it('does not render my-result on a settled-adjacent street fixture with results still null', () => {
    const state = makeHoldemPreflopState({
      holdem: {
        street: 'flop',
        communityCards: [
          { suit: 'clubs', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'hearts', rank: 'Q' },
        ],
        actingPlayerId: 'bob',
        pots: [{ amount: 15, eligiblePlayerIds: ['alice', 'bob'] }],
        results: null,
        players: makeHoldemPreflopState().holdem!.players,
      },
    });
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.queryByTestId('my-result')).not.toBeInTheDocument();
  });

  it('renders a decorative chip icon next to the pot total', () => {
    const state = makeHoldemPreflopState();
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('pot').querySelector('svg')).toBeInTheDocument();
    expect(screen.getByTestId('pot')).toHaveTextContent(/pot: 15/i);
  });
});
