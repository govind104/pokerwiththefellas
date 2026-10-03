import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import {
  makeAppState,
  makeLobbyState,
  makeWaitingState,
  makeHoldemPreflopState,
  makeBlackjackPlayingState,
} from './fixtures/tableStateFixtures';
import { MIN_ACTION_LOCKOUT_MS } from './socket/SocketContext';

const handlers = new Map<string, (...args: unknown[]) => void>();
const emitted: { event: string; payload: unknown }[] = [];
let disconnectCalls = 0;

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
    io: { on: () => {} },
  };
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket()) }));

// jsdom has no WebGL, so the lazy 3D table is replaced with a stub that exposes
// the two callbacks App wires up.
vi.mock('./three/Poker3D', () => ({
  default: () => <div data-testid="poker3d" />,
}));
vi.mock('./three/Blackjack3D', () => ({
  default: (p: { onSwitchTo2D: () => void; onUnsupported: () => void }) => (
    <div data-testid="bj3d">
      <button onClick={p.onSwitchTo2D}>stub-to-2d</button>
      <button onClick={p.onUnsupported}>stub-unsupported</button>
    </div>
  ),
}));

describe('App', () => {
  beforeEach(() => {
    handlers.clear();
    emitted.length = 0;
    disconnectCalls = 0;
    sessionStorage.clear();
    // Not localStorage.clear(): vitest.setup.ts has just set 'table.view' to '2d' for this test.
    localStorage.removeItem('poker-blackjack:identity');
  });

  it('offers to play here after another tab took the seat (audit C5)', () => {
    localStorage.setItem(
      'poker-blackjack:identity',
      JSON.stringify({ lastName: 'alice', tokens: { alice: 'tok-a' } })
    );
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { mySeatIndex: 0 }));
      handlers.get('error')?.({ message: 'You opened the game in another tab or device.', code: 'replaced' });
    });
    expect(screen.getByText('You opened the game in another tab or device.')).toBeInTheDocument();
    emitted.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Play here instead' }));
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
  });

  it('shows a connecting message before any state has arrived', () => {
    render(<App />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the Lobby (not the join screen or a table) once connected with no active game mode', () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeLobbyState());
    });
    expect(screen.getByText(/waiting for a game to start/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hit' })).not.toBeInTheDocument();
  });

  it('shows the join screen once connected without a known display name', () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
    });
    expect(screen.getByRole('heading', { name: /poker & blackjack/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows the actual error message and a reload option on a connection error, instead of a stuck "Connecting" state', () => {
    render(<App />);
    act(() => {
      handlers.get('error')?.({ message: 'Server unavailable' });
    });
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('shows the Hold’em table once seated', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { mySeatIndex: 0 }));
    });
    expect(await screen.findByRole('button', { name: 'Fold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows the AdminPanel alongside the table once seated as an admin', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { isAdmin: true, mySeatIndex: 0 }));
    });
    expect(await screen.findByRole('button', { name: 'Fold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /admin panel/i })).toBeInTheDocument();
  });

  it("surfaces a rejected admin action inside the AdminPanel's own error surface", async () => {
    // A rejected admin action (server-side: adminAdjustBalance refused
    // because the target is mid-hand) arrives tagged `scope: 'admin'`, which
    // routes it to AdminPanel's own error surface rather than the shared
    // join/table channel that JoinScreen wires to its display-name input via
    // aria-describedby. Driven through the real 'error' event on the fake
    // socket, with the full tree mounted as in real usage.
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { isAdmin: true, mySeatIndex: 0 }));
    });
    await userEvent.click(await screen.findByRole('button', { name: /admin panel/i }));

    act(() => {
      handlers.get('error')?.({
        message: "Can't adjust -- bob is in an active hand",
        scope: 'admin',
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent("Can't adjust -- bob is in an active hand");
    // The table's alert banner must NOT have picked it up:
    // exactly one alert is on screen, and it is the admin panel's.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it("an admin can trigger adminSwitchMode from the running UI while a game is active", async () => {
    // Reachability regression: the mode-switch UI used to live only in
    // Lobby, which App renders only at status 'lobby' -- a status
    // SocketContext only reaches when NO mode is active, which is precisely
    // when Lobby's switch UI does not render. So adminSwitchMode had no path
    // from the real app at all. This drives the whole composed tree (real
    // SocketProvider, real fake-socket 'state' events) and asserts the
    // adminSwitchMode emit actually goes out over the socket.
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(
        makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true, mySeatIndex: 0 })
      );
    });

    await userEvent.click(await screen.findByRole('button', { name: /admin panel/i }));
    emitted.length = 0;
    await userEvent.click(screen.getByRole('button', { name: /switch to blackjack/i }));

    expect(emitted).toContainEqual({ event: 'adminSwitchMode', payload: { mode: 'blackjack' } });
  });

  it('a rejected admin action from an unseated admin does not destroy the session', async () => {
    // The admin unlocked the panel but never took a seat, so status is
    // 'entering-name'. A rejection used to disconnect the socket and replace
    // the whole app with the reload screen.
    render(<App />);
    act(() => {
      handlers.get('state')?.(
        makeAppState(makeWaitingState({ gameMode: 'holdem', seats: [] }), { isAdmin: true })
      );
    });
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();

    act(() => {
      handlers.get('error')?.({
        message: "Can't adjust -- alice is in an active hand",
        scope: 'admin',
      });
    });

    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument();
    expect(disconnectCalls).toBe(0);
  });

  it('an admin on the join screen with a table present still sees the admin panel', async () => {
    // Off-table (status 'entering-name', e.g. after "Leave table" or a rejected join) the panel
    // must stay reachable so an admin can switch the game mode before sitting down.
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /admin panel/i })).toBeInTheDocument();
  });

  it('shows the Blackjack table once seated', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack' })));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeBlackjackPlayingState(), { mySeatIndex: 0 }));
    });
    expect(await screen.findByRole('button', { name: 'Hit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  describe('Blackjack flat/3D view', () => {
    // jsdom's default 1024×768 window is below OVERLAY_MIN_WIDTH (1200), which would always pick
    // the flat view; these tests need a window wide enough for the 3D one.
    const jsdomSize = { w: window.innerWidth, h: window.innerHeight };
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    });
    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: jsdomSize.w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: jsdomSize.h });
    });

    async function seatAtBlackjack() {
      render(<App />);
      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack' })));
      });
      await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
      await userEvent.click(screen.getByRole('button', { name: /join table/i }));
      act(() => {
        handlers.get('state')?.(makeAppState(makeBlackjackPlayingState(), { mySeatIndex: 0 }));
      });
    }

    it('shows the 3D table when that is the stored preference, and switching to the flat view is remembered', async () => {
      window.localStorage.setItem('table.view', '3d');
      await seatAtBlackjack();
      expect(await screen.findByTestId('bj3d')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'stub-to-2d' }));
      expect(await screen.findByRole('button', { name: 'Hit' })).toBeInTheDocument();
      expect(window.localStorage.getItem('table.view')).toBe('2d');
    });

    it('offers a 3D view button on the flat table and remembers the choice', async () => {
      await seatAtBlackjack();
      await userEvent.click(await screen.findByRole('button', { name: '3D view' }));
      expect(await screen.findByTestId('bj3d')).toBeInTheDocument();
      expect(window.localStorage.getItem('table.view')).toBe('3d');
    });

    it('auto-dismisses a rejected-action banner after a few seconds while seated', async () => {
      await seatAtBlackjack();
      await screen.findByRole('button', { name: 'Hit' });
      vi.useFakeTimers();
      try {
        act(() => {
          handlers.get('error')?.({ message: 'Cannot check while facing a bet' });
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Cannot check while facing a bet');
        act(() => {
          vi.advanceTimersByTime(6100);
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to the flat view when WebGL is unsupported, without overwriting the stored preference', async () => {
      window.localStorage.setItem('table.view', '3d');
      await seatAtBlackjack();
      await userEvent.click(await screen.findByRole('button', { name: 'stub-unsupported' }));
      expect(await screen.findByRole('button', { name: 'Hit' })).toBeInTheDocument();
      expect(window.localStorage.getItem('table.view')).toBe('3d');
    });

    it('offers the 3D table for Hold’em too, using the same stored preference', async () => {
      render(<App />);
      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
      });
      await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
      await userEvent.click(screen.getByRole('button', { name: /join table/i }));
      act(() => {
        handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { mySeatIndex: 0 }));
      });
      await userEvent.click(await screen.findByRole('button', { name: '3D view' }));
      expect(await screen.findByTestId('poker3d')).toBeInTheDocument();
      expect(window.localStorage.getItem('table.view')).toBe('3d');
    });

    it('uses the flat view in a narrow window even when 3D is preferred, and 3D again once it widens', async () => {
      window.localStorage.setItem('table.view', '3d');
      const original = { w: window.innerWidth, h: window.innerHeight };
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
      try {
        await seatAtBlackjack();
        expect(await screen.findByRole('button', { name: 'Hit' })).toBeInTheDocument();
        expect(screen.queryByTestId('bj3d')).not.toBeInTheDocument();
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
        act(() => {
          window.dispatchEvent(new Event('resize'));
        });
        expect(await screen.findByTestId('bj3d', {}, { timeout: 2000 })).toBeInTheDocument();
        expect(window.localStorage.getItem('table.view')).toBe('3d');
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: original.w });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: original.h });
      }
    });
  });

  it('shows the players why a hand could not start (audit I4)', async () => {
    window.localStorage.setItem('table.view', '2d');
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(
        makeAppState(makeWaitingState({ handStartError: 'The hand could not start: bad blinds' }), {
          mySeatIndex: 0,
        })
      );
    });
    expect(await screen.findByText('The hand could not start: bad blinds')).toBeInTheDocument();
  });

  describe('double-click protection', () => {
    const STALE_SEQ_ERROR = 'That action has already been handled (the table moved on)';

    async function seatAtBlackjack(actionSeq: number) {
      window.localStorage.setItem('table.view', '2d');
      render(<App />);
      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack' })));
      });
      await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
      await userEvent.click(screen.getByRole('button', { name: /join table/i }));
      act(() => {
        handlers.get('state')?.(makeAppState(makeBlackjackPlayingState({ actionSeq }), { mySeatIndex: 0 }));
      });
      return screen.findByRole('button', { name: 'Hit' });
    }

    const actionEvents = () => emitted.filter((e) => e.event === 'action');

    it('a double-click on Hit emits exactly one action', async () => {
      const hit = await seatAtBlackjack(3);
      await userEvent.dblClick(hit);
      expect(actionEvents()).toHaveLength(1);
    });

    it('a double-click whose second click lands after the server reply still emits one action (review IMP-1)', async () => {
      // On a LAN the reply to the first click usually arrives inside the double-click
      // window, carrying a new actionSeq that the second click would otherwise send.
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      act(() => {
        handlers.get('state')?.(makeAppState(makeBlackjackPlayingState({ actionSeq: 4 }), { mySeatIndex: 0 }));
      });
      await userEvent.click(screen.getByRole('button', { name: 'Hit' }));
      expect(actionEvents()).toHaveLength(1);
    });

    it("sends the table's actionSeq with the action", async () => {
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      expect(actionEvents()[0].payload).toEqual({ action: 'hit', amount: undefined, seq: 3 });
    });

    it('re-enables the action buttons once a state with a new actionSeq arrives and the lockout has passed', async () => {
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      expect(hit).toBeDisabled();
      act(() => {
        handlers.get('state')?.(makeAppState(makeBlackjackPlayingState({ actionSeq: 4 }), { mySeatIndex: 0 }));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Hit' })).toBeEnabled(), {
        timeout: MIN_ACTION_LOCKOUT_MS + 500,
      });
      expect(screen.getByRole('button', { name: 'Stand' })).toBeEnabled();
    });

    it('keeps the buttons disabled when a state arrives with the same actionSeq', async () => {
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      act(() => {
        handlers.get('state')?.(makeAppState(makeBlackjackPlayingState({ actionSeq: 3 }), { mySeatIndex: 0 }));
      });
      expect(screen.getByRole('button', { name: 'Hit' })).toBeDisabled();
    });

    it('does not stay disabled after a disconnect, even if the next state repeats the actionSeq', async () => {
      // A restarted server recovers with actionSeq back at a low number, which can equal
      // the seq the lost action was sent with.
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      act(() => {
        handlers.get('disconnect')?.('transport close');
        handlers.get('state')?.(makeAppState(makeBlackjackPlayingState({ actionSeq: 3 }), { mySeatIndex: 0 }));
      });
      expect(screen.getByRole('button', { name: 'Hit' })).toBeEnabled();
    });

    it('re-enables the buttons after an ordinary rejection', async () => {
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      act(() => {
        handlers.get('error')?.({ message: 'Cannot split these cards' });
      });
      expect(screen.getByRole('button', { name: 'Hit' })).toBeEnabled();
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot split these cards');
    });

    it('does not show the stale-action error to the player, and re-enables the buttons', async () => {
      const hit = await seatAtBlackjack(3);
      await userEvent.click(hit);
      act(() => {
        handlers.get('error')?.({ message: STALE_SEQ_ERROR });
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(STALE_SEQ_ERROR)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hit' })).toBeEnabled();
    });
  });
});
