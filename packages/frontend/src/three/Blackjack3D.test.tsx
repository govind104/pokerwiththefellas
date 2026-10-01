import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BlackjackRoundView } from '@poker-blackjack/server/src/table';
import { makeSeat } from '../fixtures/tableStateFixtures';

// jsdom has no WebGL: replace the renderer with a recorder so the React shell
// (overlay, controls, model plumbing) is what's under test.
interface FakeScene {
  apply: ReturnType<typeof vi.fn>;
  applyQuality: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
const created: FakeScene[] = [];
let shouldThrow = false;

vi.mock('./engine/SceneRoot', () => ({
  SceneRoot: class {
    apply = vi.fn();
    applyQuality = vi.fn();
    dispose = vi.fn();
    setSize = vi.fn();
    onFrame = null;
    constructor() {
      if (shouldThrow) throw new Error('no webgl');
      created.push(this);
    }
  },
}));

import { Blackjack3D } from './Blackjack3D';

const round: BlackjackRoundView = {
  phase: 'playing',
  playerHands: [
    {
      cards: [
        { rank: '7', suit: 'diamonds' },
        { rank: '4', suit: 'clubs' },
      ],
      bet: 25,
      doubled: false,
      done: false,
    },
  ],
  dealerUpcard: { rank: 'K', suit: 'spades' },
  dealerCards: null,
  results: null,
};

function props(over: Partial<Parameters<typeof Blackjack3D>[0]> = {}) {
  return {
    seats: [makeSeat({ seatIndex: 0, displayName: 'alice' }), makeSeat({ seatIndex: 1, displayName: 'bob' })],
    activeSeatIndex: 0,
    mySeatIndex: 0,
    connectionStatus: 'at-table' as const,
    handInProgress: true,
    onReady: vi.fn(),
    onLeave: vi.fn(),
    blackjackRounds: { 0: round, 1: round },
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
  shouldThrow = false;
  window.localStorage.clear();
});

describe('Blackjack3D', () => {
  it('creates one scene, feeds it the model, and disposes it on unmount', () => {
    const { unmount } = render(<Blackjack3D {...props()} />);
    expect(created).toHaveLength(1);
    expect(created[0].apply).toHaveBeenCalled();
    unmount();
    expect(created[0].dispose).toHaveBeenCalled();
  });

  it('mirrors the table state in an accessible summary', () => {
    render(<Blackjack3D {...props()} />);
    expect(screen.getByTestId('dealer-hand')).toHaveTextContent('K of spades, face-down card');
    expect(screen.getByTestId('player-0')).toHaveTextContent('7 of diamonds, 4 of clubs');
    expect(screen.getByTestId('player-0')).toHaveAttribute('data-active', 'true');
  });

  it('shows action buttons only on the local turn and forwards the chosen action', async () => {
    const p = props();
    const { rerender } = render(<Blackjack3D {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hit' }));
    expect(p.onAction).toHaveBeenCalledWith('hit');
    // 7 + 4 is not a pair, so Split is unavailable; the first two cards can still Double.
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Double' }));
    expect(p.onAction).toHaveBeenLastCalledWith('double');

    rerender(<Blackjack3D {...p} activeSeatIndex={1} />);
    expect(screen.queryByRole('button', { name: 'Hit' })).not.toBeInTheDocument();
  });

  it('disables every action button while an action is pending', () => {
    render(<Blackjack3D {...props()} actionPending />);
    for (const name of ['Hit', 'Stand', 'Double', 'Split']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('offers Ready and Leave between hands', async () => {
    const p = props({
      handInProgress: false,
      blackjackRounds: null,
      activeSeatIndex: null,
      seats: [makeSeat({ seatIndex: 0, displayName: 'alice', ready: false })],
    });
    render(<Blackjack3D {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ready' }));
    expect(p.onReady).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(p.onLeave).toHaveBeenCalled();
    expect(screen.getByText('Waiting for hand to start…')).toBeInTheDocument();
  });

  it('hides Leave while a hand is running, and surfaces banners', () => {
    render(<Blackjack3D {...props({ connectionStatus: 'reconnecting', errorMessage: 'nope' })} />);
    expect(screen.queryByRole('button', { name: 'Leave table' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });

  it('falls back to 2D when WebGL cannot start', () => {
    shouldThrow = true;
    const p = props();
    render(<Blackjack3D {...p} />);
    expect(p.onUnsupported).toHaveBeenCalled();
  });

  it('applies and remembers the graphics quality choice', async () => {
    render(<Blackjack3D {...props()} />);
    await userEvent.selectOptions(screen.getByLabelText('Graphics quality'), 'low');
    expect(created[0].applyQuality).toHaveBeenLastCalledWith('low');
    expect(window.localStorage.getItem('bj3d.quality')).toBe('low');
  });

  it('switches back to the 2D table on request', async () => {
    const p = props();
    render(<Blackjack3D {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '2D view' }));
    expect(p.onSwitchTo2D).toHaveBeenCalled();
  });
});
