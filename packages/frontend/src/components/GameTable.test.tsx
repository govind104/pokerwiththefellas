import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { makeSeat } from '../fixtures/tableStateFixtures';

const baseProps = {
  seats: [makeSeat({ seatIndex: 0, displayName: 'alice' }), makeSeat({ seatIndex: 1, displayName: 'bob' })],
  activeSeatIndex: 1,
  mySeatIndex: 0,
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
};

describe('GameTable', () => {
  it('renders every seat with its display name and highlights the active one', () => {
    render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.getByTestId('seat-0')).toHaveTextContent('alice');
    expect(screen.getByTestId('seat-1')).toHaveTextContent('bob');
    expect(screen.getByTestId('seat-1').className).toMatch(/bg-amber-500/);
    expect(screen.getByTestId('seat-0').className).not.toMatch(/bg-amber-500/);
  });

  it('renders per-seat extra content passed via seatContent', () => {
    render(
      <GameTable {...baseProps} seatContent={{ 0: <span data-testid="extra">hi</span> }}>
        {null}
      </GameTable>
    );
    expect(screen.getByTestId('seat-0')).toContainElement(screen.getByTestId('extra'));
  });

  it('renders children in the center of the table', () => {
    render(<GameTable {...baseProps}>{<span data-testid="center">community</span>}</GameTable>);
    expect(screen.getByTestId('center')).toBeInTheDocument();
  });

  it('shows a reconnecting banner only when connectionStatus is reconnecting', () => {
    const { rerender } = render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(
      <GameTable {...baseProps} connectionStatus="reconnecting">
        {null}
      </GameTable>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/reconnecting/i);
  });

  it('shows an error banner only when an errorMessage is provided', () => {
    const { rerender } = render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(
      <GameTable {...baseProps} errorMessage="It is not alice's turn">
        {null}
      </GameTable>
    );
    expect(screen.getByRole('alert')).toHaveTextContent("It is not alice's turn");
  });

  it('hides the Leave table button while a hand is in progress, and shows it otherwise', () => {
    const { rerender } = render(
      <GameTable {...baseProps} handInProgress={true}>
        {null}
      </GameTable>
    );
    expect(screen.queryByRole('button', { name: /leave table/i })).not.toBeInTheDocument();

    rerender(
      <GameTable {...baseProps} handInProgress={false}>
        {null}
      </GameTable>
    );
    expect(screen.getByRole('button', { name: /leave table/i })).toBeInTheDocument();
  });

  it('shows a Ready button only for my own not-yet-ready seat with no hand in progress', () => {
    const { rerender } = render(
      <GameTable {...baseProps} handInProgress={false} seats={[makeSeat({ seatIndex: 0, ready: false })]} mySeatIndex={0}>
        {null}
      </GameTable>
    );
    expect(screen.getByRole('button', { name: /ready/i })).toBeInTheDocument();

    rerender(
      <GameTable {...baseProps} handInProgress={true} seats={[makeSeat({ seatIndex: 0, ready: false })]} mySeatIndex={0}>
        {null}
      </GameTable>
    );
    expect(screen.queryByRole('button', { name: /^ready$/i })).not.toBeInTheDocument();
  });

  it('calls onReady and onLeave when their buttons are clicked', async () => {
    const onReady = vi.fn();
    const onLeave = vi.fn();
    render(
      <GameTable
        {...baseProps}
        handInProgress={false}
        seats={[makeSeat({ seatIndex: 0, ready: false })]}
        mySeatIndex={0}
        onReady={onReady}
        onLeave={onLeave}
      >
        {null}
      </GameTable>
    );
    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));
    expect(onReady).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /leave table/i }));
    expect(onLeave).toHaveBeenCalled();
  });
});
