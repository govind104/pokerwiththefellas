import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HoldemView } from '@poker-blackjack/server/src/table';
import { makeSeat } from '../fixtures/tableStateFixtures';

// jsdom has no WebGL: replace the renderer with a recorder so the React shell
// (overlay, controls, model plumbing) is what's under test.
const created: { apply: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];

vi.mock('./engine/SceneRoot', () => ({
  SceneRoot: class {
    apply = vi.fn();
    applyQuality = vi.fn();
    dispose = vi.fn();
    setSize = vi.fn();
    onFrame = null;
    constructor() {
      created.push(this);
    }
  },
}));

import { Poker3D } from './Poker3D';

const holdem: HoldemView = {
  street: 'flop',
  communityCards: [
    { rank: '2', suit: 'clubs' },
    { rank: '7', suit: 'diamonds' },
    { rank: 'Q', suit: 'hearts' },
  ],
  actingPlayerId: 'alice',
  pots: [{ amount: 40, eligiblePlayerIds: ['alice', 'bob'] }],
  results: null,
  players: [
    {
      playerId: 'alice',
      stack: 900,
      streetContributed: 0,
      folded: false,
      isAllIn: false,
      holeCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
      ],
    },
    { playerId: 'bob', stack: 900, streetContributed: 10, folded: false, isAllIn: false, holeCards: null },
  ],
};

function props(over: Partial<Parameters<typeof Poker3D>[0]> = {}) {
  return {
    seats: [makeSeat({ seatIndex: 0, displayName: 'alice' }), makeSeat({ seatIndex: 1, displayName: 'bob' })],
    mySeatIndex: 0,
    connectionStatus: 'at-table' as const,
    handInProgress: true,
    onReady: vi.fn(),
    onLeave: vi.fn(),
    holdem,
    onAction: vi.fn(),
    onSwitchTo2D: vi.fn(),
    onUnsupported: vi.fn(),
    ...over,
  };
}

beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  created.length = 0;
  window.localStorage.clear();
});

describe('Poker3D', () => {
  it('creates one scene and feeds it the poker model', () => {
    render(<Poker3D {...props()} />);
    expect(created).toHaveLength(1);
    const model = created[0].apply.mock.calls[0][0];
    expect(model.kind).toBe('holdem');
    expect(model.dealerFigure).toBe(false);
  });

  it('mirrors the table in an accessible summary and hides opponents\' cards', () => {
    render(<Poker3D {...props()} />);
    expect(screen.getByTestId('community-cards')).toHaveTextContent('2 of clubs, 7 of diamonds, Q of hearts');
    expect(screen.getByTestId('player-info-0')).toHaveTextContent('A of spades, K of hearts');
    expect(screen.getByTestId('player-info-1')).toHaveTextContent('face-down card, face-down card');
    expect(screen.getByTestId('player-info-0')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('pot')).toHaveTextContent('Pot: 40');
  });

  it('shows the action bar only on my turn and forwards each action', async () => {
    const p = props();
    const { rerender } = render(<Poker3D {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(p.onAction).toHaveBeenLastCalledWith('fold');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(p.onAction).toHaveBeenLastCalledWith('check');
    await userEvent.click(screen.getByRole('button', { name: 'Call' }));
    expect(p.onAction).toHaveBeenLastCalledWith('call');
    await userEvent.click(screen.getByRole('button', { name: 'All In' }));
    expect(p.onAction).toHaveBeenLastCalledWith('all-in');

    rerender(<Poker3D {...p} holdem={{ ...holdem, actingPlayerId: 'bob' }} />);
    expect(screen.queryByRole('button', { name: 'Fold' })).not.toBeInTheDocument();
  });

  it('sends the typed raise amount, and clears it when the street changes', async () => {
    const p = props();
    const { rerender } = render(<Poker3D {...p} />);
    const input = screen.getByLabelText('Raise amount');
    await userEvent.clear(input);
    await userEvent.type(input, '75');
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(p.onAction).toHaveBeenLastCalledWith('raise', 75);

    rerender(<Poker3D {...p} holdem={{ ...holdem, street: 'turn' }} />);
    expect(screen.getByLabelText('Raise amount')).toHaveValue(0);
  });

  it('offers Ready between hands and switches back to 2D on request', async () => {
    const p = props({ handInProgress: false, holdem: null, seats: [makeSeat({ seatIndex: 0, displayName: 'alice', ready: false })] });
    render(<Poker3D {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ready' }));
    expect(p.onReady).toHaveBeenCalled();
    expect(screen.getByText('Waiting for hand to start…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2D view' }));
    expect(p.onSwitchTo2D).toHaveBeenCalled();
  });
});
