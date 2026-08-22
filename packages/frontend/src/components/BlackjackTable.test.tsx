import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlackjackTable } from './BlackjackTable';
import {
  makeSeat,
  makeBlackjackPlayingState,
  makeBlackjackSplitHandState,
  makeBlackjackSettledState,
} from '../fixtures/tableStateFixtures';

const baseProps = {
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
  onAction: vi.fn(),
};

describe('BlackjackTable', () => {
  it("renders the dealer's up-card before the round settles", () => {
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds} />
    );
    expect(screen.getByTestId('dealer-hand').querySelectorAll('img')).toHaveLength(1);
  });

  it("renders both of a seat's hands after a split", () => {
    const state = makeBlackjackSplitHandState();
    render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds} />
    );
    const hands = screen.getByTestId('hands-0');
    expect(hands.querySelectorAll('img')).toHaveLength(4);
  });

  it('shows action controls only when it is my seat\'s turn', () => {
    const state = makeBlackjackPlayingState();
    const { rerender } = render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={1} blackjackRounds={state.blackjackRounds} />
    );
    expect(screen.queryByRole('button', { name: /^hit$/i })).not.toBeInTheDocument();

    rerender(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds} />
    );
    expect(screen.getByRole('button', { name: /^hit$/i })).toBeInTheDocument();
  });

  it('sends the right action when a control is clicked', async () => {
    const onAction = vi.fn();
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable
        {...baseProps}
        onAction={onAction}
        seats={state.seats}
        activeSeatIndex={0}
        mySeatIndex={0}
        blackjackRounds={state.blackjackRounds}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /^stand$/i }));
    expect(onAction).toHaveBeenCalledWith('stand');
  });

  it('renders a waiting-room view with no crash when blackjackRounds is null', () => {
    render(
      <BlackjackTable {...baseProps} seats={[makeSeat({ seatIndex: 0 })]} activeSeatIndex={null} mySeatIndex={0} blackjackRounds={null} />
    );
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });

  it('forwards errorMessage to the shared error banner', () => {
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable
        {...baseProps}
        seats={state.seats}
        activeSeatIndex={0}
        mySeatIndex={0}
        blackjackRounds={state.blackjackRounds}
        errorMessage="Not your turn"
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Not your turn');
  });

  it("renders each hand's bet amount at all times a hand exists", () => {
    const playing = makeBlackjackPlayingState();
    const { rerender } = render(
      <BlackjackTable
        {...baseProps}
        seats={playing.seats}
        activeSeatIndex={0}
        mySeatIndex={0}
        blackjackRounds={playing.blackjackRounds}
      />
    );
    expect(screen.getByTestId('hand-bet-0-0')).toHaveTextContent(/25/);

    const settled = makeBlackjackSettledState();
    rerender(
      <BlackjackTable
        {...baseProps}
        seats={settled.seats}
        activeSeatIndex={null}
        mySeatIndex={0}
        blackjackRounds={settled.blackjackRounds}
      />
    );
    expect(screen.getByTestId('hand-bet-0-0')).toHaveTextContent(/25/);
    expect(screen.getByTestId('hand-bet-0-1')).toHaveTextContent(/25/);
  });

  it('renders a per-hand outcome status once the round settles', () => {
    const state = makeBlackjackSettledState();
    render(
      <BlackjackTable
        {...baseProps}
        seats={state.seats}
        activeSeatIndex={null}
        mySeatIndex={0}
        blackjackRounds={state.blackjackRounds}
      />
    );
    expect(screen.getByTestId('hand-result-0-0')).toHaveTextContent(/bust/i);
    expect(screen.getByTestId('hand-result-0-1')).toHaveTextContent(/blackjack/i);
  });

  it('does not render an outcome status before the round settles', () => {
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable
        {...baseProps}
        seats={state.seats}
        activeSeatIndex={0}
        mySeatIndex={0}
        blackjackRounds={state.blackjackRounds}
      />
    );
    expect(screen.queryByTestId('hand-result-0-0')).not.toBeInTheDocument();
  });

  it('marks each settled outcome with a semantic win/lose/push polarity for styling', () => {
    const state = makeBlackjackSettledState();
    render(
      <BlackjackTable
        {...baseProps}
        seats={state.seats}
        activeSeatIndex={null}
        mySeatIndex={0}
        blackjackRounds={state.blackjackRounds}
      />
    );
    // makeBlackjackSettledState's hand 0 busts, hand 1 gets blackjack.
    expect(screen.getByTestId('hand-result-0-0')).toHaveAttribute('data-outcome', 'lose');
    expect(screen.getByTestId('hand-result-0-1')).toHaveAttribute('data-outcome', 'win');
  });
});
