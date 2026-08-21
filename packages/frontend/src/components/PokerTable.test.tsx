import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PokerTable } from './PokerTable';
import { makeSeat, makeHoldemPreflopState, makeHoldemMyTurnState } from '../fixtures/tableStateFixtures';

const baseProps = {
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
  onAction: vi.fn(),
};

describe('PokerTable', () => {
  it('renders own hole cards face-up and the opponent face-down', () => {
    const state = makeHoldemPreflopState();
    render(
      <PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.getByTestId('hole-cards-0').querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByTestId('hole-cards-1').querySelectorAll('img')).toHaveLength(0);
    expect(screen.getAllByRole('img', { name: /face-down/i })).toHaveLength(2);
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
    render(
      <PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.getByTestId('community-cards').querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByText(/pot: 15/i)).toBeInTheDocument();
  });

  it('shows betting controls only when it is my turn', () => {
    const notMyTurn = makeHoldemPreflopState();
    const { rerender } = render(
      <PokerTable {...baseProps} seats={notMyTurn.seats} mySeatIndex={1} holdem={notMyTurn.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument();

    const myTurn = makeHoldemMyTurnState();
    rerender(
      <PokerTable {...baseProps} seats={myTurn.seats} mySeatIndex={0} holdem={myTurn.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
  });

  it('sends the right action with amount when a betting control is used', async () => {
    const onAction = vi.fn();
    const state = makeHoldemMyTurnState();
    render(
      <PokerTable {...baseProps} onAction={onAction} seats={state.seats} mySeatIndex={0} holdem={state.holdem}>
        {null}
      </PokerTable>
    );
    await userEvent.click(screen.getByRole('button', { name: /fold/i }));
    expect(onAction).toHaveBeenCalledWith('fold');

    await userEvent.clear(screen.getByLabelText(/raise amount/i));
    await userEvent.type(screen.getByLabelText(/raise amount/i), '40');
    await userEvent.click(screen.getByRole('button', { name: /^raise$/i }));
    expect(onAction).toHaveBeenCalledWith('raise', 40);
  });

  it('renders a waiting-room view with no crash when holdem is null', () => {
    render(
      <PokerTable {...baseProps} seats={[makeSeat({ seatIndex: 0 })]} mySeatIndex={0} holdem={null}>
        {null}
      </PokerTable>
    );
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });
});
