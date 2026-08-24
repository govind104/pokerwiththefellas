import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinScreen } from './JoinScreen';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';

function renderWithContext(overrides: Partial<SocketContextValue> = {}) {
  const joinWithName = vi.fn();
  const value: SocketContextValue = {
    status: 'entering-name',
    state: null,
    errorMessage: null,
    adminErrorMessage: null,
    displayName: null,
    isAdmin: false,
    joinWithName,
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    adminLogin: vi.fn(),
    adminStartGame: vi.fn(),
    adminSwitchMode: vi.fn(),
    adminAdjustBalance: vi.fn(),
    adminSetBlinds: vi.fn(),
    adminSetDefaultBet: vi.fn(),
    adminSetStartingBalance: vi.fn(),
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <JoinScreen />
    </SocketContext.Provider>
  );
  return { joinWithName };
}

describe('JoinScreen', () => {
  it('calls joinWithName with the trimmed display name on submit', async () => {
    const { joinWithName } = renderWithContext();
    await userEvent.type(screen.getByLabelText(/display name/i), '  alice  ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(joinWithName).toHaveBeenCalledWith('alice');
  });

  it('does not call joinWithName for an empty or whitespace-only name', async () => {
    const { joinWithName } = renderWithContext();
    await userEvent.type(screen.getByLabelText(/display name/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(joinWithName).not.toHaveBeenCalled();
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

  it('does not show an admin-login error as a join error', () => {
    renderWithContext({ errorMessage: null, adminErrorMessage: 'Incorrect admin passphrase' });
    expect(screen.queryByText('Incorrect admin passphrase')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
