import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinScreen } from './JoinScreen';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';

function renderWithContext(overrides: Partial<SocketContextValue> = {}) {
  const connect = vi.fn();
  const value: SocketContextValue = {
    status: 'entering-name',
    state: null,
    errorMessage: null,
    displayName: null,
    connect,
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <JoinScreen />
    </SocketContext.Provider>
  );
  return { connect };
}

describe('JoinScreen', () => {
  it('calls connect with the trimmed display name on submit', async () => {
    const { connect } = renderWithContext();
    await userEvent.type(screen.getByLabelText(/display name/i), '  alice  ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(connect).toHaveBeenCalledWith('alice');
  });

  it('does not call connect for an empty or whitespace-only name', async () => {
    const { connect } = renderWithContext();
    await userEvent.type(screen.getByLabelText(/display name/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(connect).not.toHaveBeenCalled();
  });

  it('disables the form while connecting', () => {
    renderWithContext({ status: 'connecting' });
    expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /joining/i })).toBeDisabled();
  });

  it('shows an error message when one is present', () => {
    renderWithContext({ errorMessage: 'Invalid display name' });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid display name');
  });

  it('links the error message to the display name input via aria-describedby', () => {
    renderWithContext({ errorMessage: 'Invalid display name' });
    const input = screen.getByLabelText(/display name/i);
    const alert = screen.getByRole('alert');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
  });

  it('does not set aria-describedby when there is no error', () => {
    renderWithContext();
    expect(screen.getByLabelText(/display name/i)).not.toHaveAttribute('aria-describedby');
  });
});
