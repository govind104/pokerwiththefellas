# Table Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seat-ring arrangement in `GameTable`/`PokerTable`/`BlackjackTable`
with the decoupled layout from
`docs/superpowers/specs/2026-08-22-table-layout-redesign-design.md` — a fixed
bottom-left player-info rail plus a dedicated bottom-center hand zone for Poker; a
felt row of per-player (cards + info box) slots for Blackjack — fixing the seat-overlap
bug as an architectural side effect rather than patching the old structure.

**Architecture:** `GameTable` stops owning seat positioning entirely. It becomes a
shell (banners, wood/felt oval, Ready/Leave buttons) with three content slots:
`children` (felt-center content), `railSlot` (optional, bottom-left overlay), and
`bottomCenterSlot` (optional, bottom-center overlay). `PokerTable` uses all three
(felt center = pot + community cards; rail = opponents; bottom-center = my hand).
`BlackjackTable` uses only `children` — its per-player slots (cards + info box) render
inside the felt itself, since Blackjack hands are public and don't need the
identity/card separation Poker's hidden hands require.

**Tech Stack:** Same as the saloon redesign this builds on — React 18 + TypeScript +
Tailwind CSS, Vitest + React Testing Library. No new dependencies.

## Global Constraints

Copied verbatim (or condensed without losing precision) from the design spec — every
task's work implicitly includes these:

- **Tokens/fonts/motion unchanged.** This plan reuses every saloon-redesign v1 token
  (`--brass`, `--felt`, etc.), the `Card`/`Chip` components, and `Button`/`panelStyles`
  helpers exactly as they exist today. No new design tokens.
- **`Card.tsx` and `Chip.tsx` are not modified.** Where Poker's own hand needs to
  render larger than the standard 64×96px card, that's done by wrapping `<Card>` in a
  sized container and applying a CSS `transform: scale(2)` to it externally — never by
  touching `Card.tsx`'s own className.
- **Backend untouched.** `packages/server` is not modified anywhere in this plan — per
  the explicit decision in the spec, Blackjack's "dealer + 4 players" is a display
  target the layout is designed to look good at, not a server-enforced seat cap.
  `seatCount` stays whatever it's configured to.
- **Ordering:** every player-derived list (rail rows, Blackjack's felt row) is sorted
  ascending by `seatIndex` — the same deterministic order the old seat-ring iterated
  in.
- **The table shell grows and becomes viewport-relative, per spec Section 6.** v1's
  fixed `h-[28rem] w-[36rem]` (448×576px) oval is too small to hold the spec's
  validated card/rail sizing without cramming — Task 1 replaces it with
  `h-[min(75vh,42rem)] w-[min(90vw,54rem)]`, capped at 672×864px so it doesn't grow
  unbounded on very large monitors, but scaling down gracefully on a real browser
  viewport once taskbar/chrome are accounted for (the exact finding that motivated
  Section 6). This is the one property every later task's felt/rail/my-hand math is
  built against — get this right in Task 1 before anything else depends on it.
- **Sizing** (validated at 1920×1080 scale in the spec, applied verbatim now that the
  shell above actually has room for it):
  - Standard card: 64×96px (`h-24 w-16` — unchanged, already `Card.tsx`'s size).
  - Poker's own-hand card: rendered at 130×190px via a sized wrapper + `scale(2)` on
    the standard `Card`.
  - Rail-row avatar: `h-10 w-10` (40px) — close to the spec's validated 44px, rounded
    to an existing Tailwind size step.
  - Names 14px (`text-sm`), balance/status 12px (`text-xs`), consistent with the rest
    of this app's existing type scale rather than the spec mockup's literal px values.
  - Exact spacing (gaps, padding) is expected to get a final live pass during this
    plan's closing manual-verification step, same as saloon redesign v1's own contrast
    work was computed then confirmed live — but the shell's sizing strategy itself
    (viewport-relative, not fixed) is not up for revision there, it's a Global
    Constraint.
- **Test suite: expect substantial rewriting, not incremental edits.** Per spec
  Section 8, `seat-${seatIndex}` and `hole-cards-${seatIndex}` don't survive this
  plan. New testids introduced by this plan (used verbatim by every task below):
  `player-rail` (the rail's wrapping container, added by `GameTable`), `player-info-${seatIndex}`
  (a Poker opponent's rail row), `player-cards-${seatIndex}` (that opponent's revealed
  hand at showdown, nested in their row), `my-hand` (Poker — the viewing player's own
  two cards), `my-result` (Poker — the viewing player's own win/lose/push line at
  showdown), `player-${seatIndex}` (Blackjack — replaces the old `hands-${seatIndex}`,
  now wraps that player's cards AND their info box together). `dealer-hand`,
  `community-cards`, `pot`, `hand-bet-${seatIndex}-${i}`, `hand-result-${seatIndex}-${i}`
  are unchanged from v1 — reused verbatim, not renamed.
- **A gap found and closed while planning, not present in the mockups:** the approved
  mockups only showed table states mid-hand. Before a hand starts, v1's seat-ring
  always showed every seated player's name/balance/ready-status — this plan's rail
  (Poker) and per-player boxes (Blackjack) must preserve that: both render whenever a
  player is seated, independent of `holdem`/`blackjackRounds` being null, with their
  status line switching between "Ready"/"Not ready"/"Disconnected" (no hand) and
  in-hand status (hand in progress). This is why `railSlot`/the Blackjack player row
  are keyed off `seats`, not off `holdem`/`blackjackRounds`.
- **Split hands (Blackjack) are preserved.** A player with two hands (from a split)
  renders two adjacent card+bet+outcome columns side by side under one shared
  name/balance/status box — reusing the existing `hand-bet-${seatIndex}-${i}` /
  `hand-result-${seatIndex}-${i}` per-hand testids unchanged, just relocated.
- **Poker's own showdown result was a genuine gap in the spec, resolved here:** the
  spec's rail shows opponents' win/lose/push, but the viewing player has no rail row
  to show it in. This plan adds a `my-result` element next to the viewing player's own
  hand at showdown, using the same win/lose/push token scheme as the rail.

---

### Task 1: `GameTable` — remove the seat-ring, add `railSlot`/`bottomCenterSlot`

**Files:**
- Modify: `packages/frontend/src/components/GameTable.tsx`
- Modify: `packages/frontend/src/components/GameTable.test.tsx`

**Interfaces:**
- Consumes: `Button` (unchanged import).
- Produces: `GameTableProps` drops `activeSeatIndex` and `seatContent` entirely, adds
  `railSlot?: ReactNode` and `bottomCenterSlot?: ReactNode`. `seats: SeatView[]` and
  `mySeatIndex: number | null` stay (still needed to find `mySeat` for the Ready
  button). Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/frontend/src/components/GameTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { makeSeat } from '../fixtures/tableStateFixtures';

const baseProps = {
  seats: [makeSeat({ seatIndex: 0, displayName: 'alice' }), makeSeat({ seatIndex: 1, displayName: 'bob' })],
  mySeatIndex: 0,
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
};

describe('GameTable', () => {
  it('renders children in the center of the table', () => {
    render(<GameTable {...baseProps}>{<span data-testid="center">community</span>}</GameTable>);
    expect(screen.getByTestId('center')).toBeInTheDocument();
  });

  it('renders railSlot content wrapped in a player-rail container when provided', () => {
    render(
      <GameTable {...baseProps} railSlot={<span data-testid="rail-row">bob&apos;s row</span>}>
        {null}
      </GameTable>
    );
    expect(screen.getByTestId('player-rail')).toBeInTheDocument();
    expect(screen.getByTestId('player-rail')).toContainElement(screen.getByTestId('rail-row'));
  });

  it('does not render a player-rail container when railSlot is not provided', () => {
    render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.queryByTestId('player-rail')).not.toBeInTheDocument();
  });

  it('renders bottomCenterSlot content when provided', () => {
    render(
      <GameTable {...baseProps} bottomCenterSlot={<span data-testid="my-hand-slot">my cards</span>}>
        {null}
      </GameTable>
    );
    expect(screen.getByTestId('my-hand-slot')).toBeInTheDocument();
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=@poker-blackjack/frontend -- GameTable.test.tsx`
Expected: FAIL — `GameTableProps` doesn't have `railSlot`/`bottomCenterSlot` yet
(TypeScript error under `vitest`'s esbuild transform surfaces as a runtime failure
since the props are simply ignored/undefined and no `player-rail` testid exists), and
the "renders every seat"/"seatContent" behaviors from the old test file are gone —
this new file replaces them, so the new `player-rail`/`bottomCenterSlot` assertions
are what actually fail against the current component.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/GameTable.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from './Button';

export interface GameTableProps {
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  railSlot?: ReactNode;
  bottomCenterSlot?: ReactNode;
  children: ReactNode;
}

export function GameTable({
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  railSlot,
  bottomCenterSlot,
  children,
}: GameTableProps) {
  const mySeat = mySeatIndex !== null ? (seats.find((s) => s.seatIndex === mySeatIndex) ?? null) : null;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-bg p-8 font-body text-fg">
      <div className="absolute top-4 flex flex-col items-center gap-2">
        {connectionStatus === 'reconnecting' && (
          <div role="status" className="rounded-md bg-amber-600 px-4 py-2 font-medium">
            Reconnecting…
          </div>
        )}
        {errorMessage && (
          <div role="alert" className="rounded-md bg-red-600 px-4 py-2 font-medium">
            {errorMessage}
          </div>
        )}
      </div>
      <div className="relative flex h-[min(75vh,42rem)] w-[min(90vw,54rem)] items-center justify-center rounded-full border-[10px] border-wood bg-gradient-to-br from-wood to-wood-dark shadow-[inset_0_0_60px_20px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(120%_100%_at_50%_30%,var(--felt-hi)_0%,var(--felt)_100%)] shadow-[inset_0_10px_30px_rgba(0,0,0,0.45)]">
          <div className="flex h-full flex-col items-center justify-center gap-2">{children}</div>
        </div>
        {railSlot && (
          <div data-testid="player-rail" className="absolute bottom-2 left-2 flex flex-col gap-1.5">
            {railSlot}
          </div>
        )}
        {bottomCenterSlot && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
            {bottomCenterSlot}
          </div>
        )}
      </div>
      {mySeat && !handInProgress && !mySeat.ready && (
        <Button variant="primary" size="md" onClick={onReady} className="mt-4 font-medium">
          Ready
        </Button>
      )}
      {!handInProgress && (
        <button onClick={onLeave} className="mt-2 text-sm text-fg-dim underline hover:text-parchment">
          Leave table
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=@poker-blackjack/frontend -- GameTable.test.tsx`
Expected: PASS (9 tests)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: FAIL at this point — `PokerTable.tsx` and `BlackjackTable.tsx` still pass
the now-removed `activeSeatIndex`/`seatContent` props to `GameTable`. This is expected
and resolved by Tasks 2 and 3; do not attempt to fix it in this task.

```bash
git add packages/frontend/src/components/GameTable.tsx packages/frontend/src/components/GameTable.test.tsx
git commit -m "feat(frontend): replace GameTable's seat-ring with railSlot/bottomCenterSlot"
```

---

### Task 2: `PokerTable` — rail, my-hand zone, my-result

**Files:**
- Modify: `packages/frontend/src/components/PokerTable.tsx`
- Modify: `packages/frontend/src/components/PokerTable.test.tsx`

**Interfaces:**
- Consumes: `GameTable`'s new `railSlot`/`bottomCenterSlot` props (Task 1), `Card`,
  `Button`, `PANEL_CLASS` (all unchanged).
- Produces: `player-info-${seatIndex}`, `player-cards-${seatIndex}`, `my-hand`,
  `my-result` testids (see Global Constraints). `PokerTableProps` is unchanged from
  before this plan.

**Design note on card sizing:** the viewing player's own two cards render inside a
fixed `h-[190px] w-[130px]` wrapper per card (reserving the larger layout footprint)
with an inline `transform: scale(2)` applied to an inner div wrapping `<Card>` (which
still renders at its native 64×96px inside that scaled inner div — 64×2=128≈130,
96×2=192≈190, matching Section 5 of the spec within a couple of px). `Card.tsx` itself
is untouched.

**Design note on opponents' cards during play:** per the spec, nothing card-shaped
renders for an opponent until showdown — no face-down placeholder, nothing. This is a
deliberate behavior change from v1 (which rendered 2 face-down `Card`s per opponent);
the rail's name/balance/status row is the only signal an opponent exists and is
in-hand.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/frontend/src/components/PokerTable.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=@poker-blackjack/frontend -- PokerTable.test.tsx`
Expected: FAIL — none of the new testids (`player-info-*`, `my-hand`, `my-result`,
`player-cards-*`) exist on the current component.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/PokerTable.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';
import { Button } from './Button';
import { PANEL_CLASS } from './panelStyles';

type ResultPolarity = 'win' | 'lose' | 'push';

const RESULT_COLOR: Record<ResultPolarity, string> = {
  win: 'text-win-bright',
  lose: 'text-ember-text',
  push: 'text-parchment-dim',
};

function polarityOf(payout: number): ResultPolarity {
  return payout > 0 ? 'win' : payout < 0 ? 'lose' : 'push';
}

export interface PokerTableProps {
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  holdem: HoldemView | null;
  onAction: (action: HoldemAction, amount?: number) => void;
}

export function PokerTable({
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  holdem,
  onAction,
}: PokerTableProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);

  const activeSeatIndex = holdem
    ? (seats.find((s) => s.displayName === holdem.actingPlayerId)?.seatIndex ?? null)
    : null;
  const isMyTurn = mySeatIndex !== null && mySeatIndex === activeSeatIndex;
  const myPlayer = holdem ? (holdem.players.find((p) => p.playerId === holdem.actingPlayerId) ?? null) : null;
  const mySeatDisplayName = seats.find((s) => s.seatIndex === mySeatIndex)?.displayName;
  const myHoleCards = holdem
    ? (holdem.players.find((p) => p.playerId === mySeatDisplayName)?.holeCards ?? null)
    : null;

  // A value typed into the raise field on one street/turn must not leak into
  // the next -- reset whenever the street or the acting player changes (a new
  // street, a new turn, or a new hand entirely).
  useEffect(() => {
    setRaiseAmount(0);
  }, [holdem?.street, holdem?.actingPlayerId]);

  const opponents = seats
    .filter((s) => s.seatIndex !== mySeatIndex && s.displayName)
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const railSlot: ReactNode =
    opponents.length > 0 ? (
      <>
        {opponents.map((seat) => {
          const player = holdem?.players.find((p) => p.playerId === seat.displayName) ?? null;
          const isActive = holdem !== null && seat.seatIndex === activeSeatIndex;
          const result =
            holdem?.street === 'settled'
              ? (holdem.results?.find((r) => r.playerId === seat.displayName) ?? null)
              : null;
          const polarity = result ? polarityOf(result.payout) : null;

          let statusNode: ReactNode;
          if (!holdem) {
            statusNode = seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
          } else if (result && polarity) {
            const badgeClass =
              polarity === 'win'
                ? 'bg-win text-[#0d1508]'
                : polarity === 'lose'
                  ? 'bg-ember text-[#1a0a06]'
                  : 'bg-wood-grain text-parchment-dim';
            statusNode = (
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}>
                {polarity === 'win'
                  ? `Won ${result.payout}`
                  : polarity === 'lose'
                    ? `Lost ${Math.abs(result.payout)}`
                    : 'Push'}
              </span>
            );
          } else if (player?.folded) {
            statusNode = <span className="rounded border border-wood-grain px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-faint">Folded</span>;
          } else {
            statusNode = isActive ? 'Thinking…' : 'Waiting';
          }

          return (
            <div
              key={seat.seatIndex}
              data-testid={`player-info-${seat.seatIndex}`}
              data-active={isActive ? 'true' : 'false'}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                isActive ? 'border-brass-bright bg-surface-raised seat-active-glow' : 'border-wood-grain bg-surface'
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brass bg-wood text-sm font-bold text-parchment">
                {seat.displayName?.[0]?.toUpperCase()}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-parchment">
                  {seat.displayName} &middot; {seat.balance}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-fg-dim">{statusNode}</span>
              </div>
              {result && (
                <div data-testid={`player-cards-${seat.seatIndex}`} className="flex gap-1">
                  {(player?.holeCards ?? []).map((card, i) => (
                    <div key={i} className="h-[29px] w-[19px] overflow-hidden rounded-sm">
                      <div className="origin-top-left" style={{ transform: 'scale(0.3)' }}>
                        <Card card={card} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </>
    ) : undefined;

  const myResult = (() => {
    if (holdem?.street !== 'settled' || !holdem.results) return null;
    const result = holdem.results.find((r) => r.playerId === mySeatDisplayName);
    return result ?? null;
  })();

  const bottomCenterSlot: ReactNode =
    holdem && myHoleCards ? (
      <>
        {isMyTurn && (
          <div className="flex items-center gap-2">
            <Button variant="danger" onClick={() => onAction('fold')}>
              Fold
            </Button>
            <Button variant="neutral" onClick={() => onAction('check')}>
              Check
            </Button>
            <Button variant="neutral" onClick={() => onAction('call')}>
              Call
            </Button>
            <input
              type="number"
              value={raiseAmount}
              onChange={(event) => setRaiseAmount(Number(event.target.value))}
              aria-label="Raise amount"
              min={1}
              step={1}
              max={myPlayer ? myPlayer.stack : undefined}
              className="w-20 rounded-md border border-wood-grain bg-surface px-2 py-1 text-fg"
            />
            <Button variant="primary" onClick={() => onAction('raise', raiseAmount)}>
              Raise
            </Button>
            <Button variant="danger" onClick={() => onAction('all-in')}>
              All In
            </Button>
          </div>
        )}
        {myResult && (
          <div data-testid="my-result" className={`${PANEL_CLASS} text-sm ${RESULT_COLOR[polarityOf(myResult.payout)]}`}>
            {myResult.payout > 0
              ? `You won ${myResult.payout}`
              : myResult.payout < 0
                ? `You lost ${Math.abs(myResult.payout)}`
                : 'You split even'}
          </div>
        )}
        <div data-testid="my-hand" className="flex items-end gap-1">
          <div className="flex h-[190px] w-[130px] items-center justify-center" style={{ transform: 'rotate(-6deg)' }}>
            <div style={{ transform: 'scale(2)' }}>
              <Card card={myHoleCards[0]} />
            </div>
          </div>
          <div className="flex h-[190px] w-[130px] items-center justify-center" style={{ transform: 'rotate(6deg)' }}>
            <div style={{ transform: 'scale(2)' }}>
              <Card card={myHoleCards[1]} />
            </div>
          </div>
        </div>
      </>
    ) : undefined;

  return (
    <GameTable
      seats={seats}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
      railSlot={railSlot}
      bottomCenterSlot={bottomCenterSlot}
    >
      {holdem ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-1" data-testid="community-cards">
            {holdem.communityCards.map((card, i) => (
              <Card key={i} card={card} />
            ))}
          </div>
          <div
            data-testid="pot"
            className={`${PANEL_CLASS} flex items-center gap-1.5 font-utility text-sm text-brass-bright`}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <circle cx="10" cy="10" r="9" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1" />
              <circle cx="10" cy="10" r="5.5" fill="none" stroke="var(--ink)" strokeWidth="0.75" strokeDasharray="1.5 2" />
            </svg>
            Pot: {holdem.pots.reduce((sum, pot) => sum + pot.amount, 0)}
          </div>
        </div>
      ) : (
        <div className={`${PANEL_CLASS} text-fg-dim`}>Waiting for hand to start…</div>
      )}
    </GameTable>
  );
}
```

- [ ] **Step 4: Run the full PokerTable suite to verify everything passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- PokerTable.test.tsx`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PokerTable.tsx packages/frontend/src/components/PokerTable.test.tsx
git commit -m "feat(frontend): rebuild PokerTable around a player-info rail and a dedicated my-hand zone"
```

---

### Task 3: `BlackjackTable` — per-player felt slots (cards + info box)

**Files:**
- Modify: `packages/frontend/src/components/BlackjackTable.tsx`
- Modify: `packages/frontend/src/components/BlackjackTable.test.tsx`

**Interfaces:**
- Consumes: `GameTable` (Task 1, uses only `children` — no `railSlot`/`bottomCenterSlot`
  for this game), `Card`, `Chip`, `Button`, `PANEL_CLASS`/`PANEL_CLASS_SM` (all
  unchanged).
- Produces: `player-${seatIndex}` (replaces the old `hands-${seatIndex}` — now wraps
  cards AND the info box together). `hand-bet-${seatIndex}-${i}` and
  `hand-result-${seatIndex}-${i}` are unchanged from v1, just relocated inside the new
  wrapper. `BlackjackTableProps` is unchanged from before this plan.

**Design note on why Blackjack has no rail:** per the spec, Blackjack hands are public
(only the dealer's hole card is hidden), so there's no reason to separate identity
from cards the way Poker's hidden hands require — keeping a player's cards and their
name/balance/status together in one felt slot is simpler and reads more clearly.

**Design note on splits:** a player with two hands (`round.playerHands.length === 2`)
renders two adjacent card+bet(+outcome) columns side by side, with ONE shared
name/balance/status box centered beneath both — this preserves every existing
per-hand testid unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/frontend/src/components/BlackjackTable.test.tsx`:

```tsx
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
    const player = screen.getByTestId('player-0');
    expect(player.querySelectorAll('img')).toHaveLength(4);
  });

  it('shows a player\'s name, balance, and bet status beneath their hand', () => {
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={1} blackjackRounds={state.blackjackRounds} />
    );
    expect(screen.getByTestId('player-0')).toHaveTextContent(/alice/i);
    expect(screen.getByTestId('player-0')).toHaveTextContent(/975/);
    expect(screen.getByTestId('player-0')).toHaveTextContent(/bet 25/i);
  });

  it('shows Ready/Not ready/Disconnected for a seated player before a round starts', () => {
    const seats = [makeSeat({ seatIndex: 0, displayName: 'alice', ready: false })];
    render(
      <BlackjackTable {...baseProps} seats={seats} activeSeatIndex={null} mySeatIndex={0} blackjackRounds={null} />
    );
    expect(screen.getByTestId('player-0')).toHaveTextContent(/not ready/i);
  });

  it("shows 'Your turn' and data-active on my own box when it's my turn, not on other players'", () => {
    const state = makeBlackjackPlayingState({
      seats: [
        makeSeat({ seatIndex: 0, displayName: 'alice', balance: 975 }),
        makeSeat({ seatIndex: 1, displayName: 'bob', balance: 1000 }),
      ],
    });
    render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds} />
    );
    expect(screen.getByTestId('player-0')).toHaveTextContent(/your turn/i);
    expect(screen.getByTestId('player-0')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('player-1')).toHaveAttribute('data-active', 'false');
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
    expect(screen.getByTestId('hand-result-0-0')).toHaveAttribute('data-outcome', 'lose');
    expect(screen.getByTestId('hand-result-0-1')).toHaveAttribute('data-outcome', 'win');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=@poker-blackjack/frontend -- BlackjackTable.test.tsx`
Expected: FAIL — `player-0`/`player-1` testids don't exist yet (the component still
produces `hands-0`), and the current component doesn't render Ready/Not-ready/status
text or `data-active` on anything.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/BlackjackTable.tsx`:

```tsx
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Outcome } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { Chip } from './Chip';
import { GameTable } from './GameTable';
import { Button } from './Button';
import { PANEL_CLASS, PANEL_CLASS_SM } from './panelStyles';

const OUTCOME_LABELS: Record<Outcome, string> = {
  blackjack: 'Blackjack!',
  bust: 'Bust',
  win: 'Win',
  lose: 'Lose',
  push: 'Push',
};

const OUTCOME_POLARITY: Record<Outcome, 'win' | 'lose' | 'push'> = {
  blackjack: 'win',
  win: 'win',
  bust: 'lose',
  lose: 'lose',
  push: 'push',
};

const OUTCOME_COLOR: Record<'win' | 'lose' | 'push', string> = {
  win: 'text-win-bright',
  lose: 'text-ember-text',
  push: 'text-parchment-dim',
};

export interface BlackjackTableProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  onAction: (action: PlayerAction) => void;
}

export function BlackjackTable({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  blackjackRounds,
  onAction,
}: BlackjackTableProps) {
  const isMyTurn = mySeatIndex !== null && mySeatIndex === activeSeatIndex;
  const dealerRound = blackjackRounds ? Object.values(blackjackRounds)[0] : undefined;

  const players = seats.filter((s) => s.displayName).sort((a, b) => a.seatIndex - b.seatIndex);

  return (
    <GameTable
      seats={seats}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
    >
      <div className="flex h-full flex-col items-center justify-between gap-2 py-2">
        {blackjackRounds ? (
          <div className="flex flex-col items-center gap-1" data-testid="dealer-hand">
            <p className={`${PANEL_CLASS} font-utility text-xs uppercase tracking-wide text-brass-bright`}>Dealer</p>
            <div className="flex gap-1">
              {dealerRound?.dealerCards
                ? dealerRound.dealerCards.map((card, i) => <Card key={i} card={card} />)
                : dealerRound && <Card card={dealerRound.dealerUpcard} />}
            </div>
          </div>
        ) : (
          <div className={`${PANEL_CLASS} text-fg-dim`}>Waiting for hand to start…</div>
        )}

        <div className="flex flex-1 items-center justify-center gap-3">
          {players.map((seat) => {
            const round = blackjackRounds?.[seat.seatIndex];
            const isActive = seat.seatIndex === activeSeatIndex;
            const isMe = seat.seatIndex === mySeatIndex;
            const totalBet = round ? round.playerHands.reduce((sum, hand) => sum + hand.bet, 0) : 0;

            let status: string;
            if (!round) {
              status = seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected';
            } else if (isMe && isActive) {
              status = 'Your turn';
            } else {
              status = `Bet ${totalBet}`;
            }

            return (
              <div
                key={seat.seatIndex}
                data-testid={`player-${seat.seatIndex}`}
                data-active={isActive ? 'true' : 'false'}
                className="flex flex-col items-center gap-1.5"
              >
                {round && (
                  <div className="flex gap-3">
                    {round.playerHands.map((hand, i) => {
                      const outcome = round.phase === 'settled' && round.results ? round.results[i].outcome : null;
                      const polarity = outcome ? OUTCOME_POLARITY[outcome] : null;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div className="flex gap-1">
                            {hand.cards.map((card, j) => (
                              <Card key={`${card.rank}-${card.suit}-${j}`} card={card} />
                            ))}
                          </div>
                          <div
                            data-testid={`hand-bet-${seat.seatIndex}-${i}`}
                            aria-label={`Bet: ${hand.bet}`}
                            className={PANEL_CLASS_SM}
                          >
                            <Chip
                              key={`${hand.bet}-${hand.cards.map((c) => `${c.rank}${c.suit}`).join('')}`}
                              value={hand.bet}
                            />
                          </div>
                          {outcome && polarity && (
                            <div
                              className={`${PANEL_CLASS_SM} font-body text-xs font-semibold ${OUTCOME_COLOR[polarity]}`}
                              data-testid={`hand-result-${seat.seatIndex}-${i}`}
                              data-outcome={polarity}
                            >
                              {OUTCOME_LABELS[outcome]}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div
                  className={`flex flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 ${
                    isActive ? 'border-brass-bright bg-surface-raised seat-active-glow' : 'border-wood-grain bg-surface'
                  }`}
                >
                  <span className="text-sm font-semibold text-parchment">
                    {seat.displayName} &middot; {seat.balance}
                  </span>
                  <span className={`text-xs ${isActive ? 'text-brass-bright' : 'text-fg-dim'}`}>{status}</span>
                </div>
              </div>
            );
          })}
        </div>

        {isMyTurn && (
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => onAction('hit')}>
              Hit
            </Button>
            <Button variant="neutral" onClick={() => onAction('stand')}>
              Stand
            </Button>
            <Button variant="primary" onClick={() => onAction('double')}>
              Double
            </Button>
            <Button variant="danger" onClick={() => onAction('split')}>
              Split
            </Button>
          </div>
        )}
      </div>
    </GameTable>
  );
}
```

- [ ] **Step 4: Run the full BlackjackTable suite to verify everything passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- BlackjackTable.test.tsx`
Expected: PASS (13 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: PASS (this is the task that resolves the typecheck failure noted at the end
of Task 1 — both `PokerTable.tsx` and `BlackjackTable.tsx` now call `GameTable` with
its new prop shape).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/BlackjackTable.tsx packages/frontend/src/components/BlackjackTable.test.tsx
git commit -m "feat(frontend): rebuild BlackjackTable around per-player felt slots (cards + info box)"
```

---

### Task 4: Integration tests — update to the new testids

**Files:**
- Modify: `packages/frontend/src/integration/poker.integration.test.tsx`
- Modify: `packages/frontend/src/integration/blackjack.integration.test.tsx`

**Interfaces:**
- Consumes: the new testids produced by Tasks 2 and 3. No production code changes in
  this task — test-only.

- [ ] **Step 1: Update `poker.integration.test.tsx`**

Replace the full contents of `packages/frontend/src/integration/poker.integration.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import { setupIntegrationServer } from './integrationTestServer';

// Mirrors packages/server/src/integration.test.ts's own setup pattern -- see
// integrationTestServer.ts for the shared fixture this and
// blackjack.integration.test.tsx both use.
function buildConfig(): TableConfig {
  return {
    gameMode: 'holdem',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 120_000,
    random: Math.random,
  };
}

const ctx = setupIntegrationServer(buildConfig, 'frontend-poker-integration-');

describe('Poker end-to-end via App', () => {
  it('two players join, ready up, and see the hand start with correct hole-card visibility', async () => {
    const { App } = ctx;
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    // Wait for alice's real App instance to reflect bob's join before moving
    // on -- see the module doc comment above for why this findBy* sync point
    // (act-wrapped by testing-library) matters here.
    await within(screen.getByTestId('player-info-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-info-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('my-hand').querySelectorAll('img')).toHaveLength(2);
    });
    // My own hole cards are real card images; the opponent gets no card
    // element at all mid-hand (their rail row is identity/status only).
    expect(screen.getByTestId('player-info-1').querySelector('img, svg[role="img"]')).not.toBeInTheDocument();
  });

  it('sendAction round-trips: calling advances the acting player from alice to bob', async () => {
    const { App } = ctx;
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    await within(screen.getByTestId('player-info-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-info-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    // On the first hand, seat 0 (alice) is the button/small blind and acts
    // first preflop in this heads-up table -- her own action controls
    // appearing is the turn signal (she has no rail row to carry
    // data-active, since the rail only lists opponents).
    await screen.findByRole('button', { name: /^call$/i });

    // The wire payload this proves: SocketContext.sendAction emits
    // { action: 'call', amount: undefined } over the real socket, the server
    // applies it, and pushes a fresh `state` back that moves the acting
    // player on to bob.
    await userEvent.click(screen.getByRole('button', { name: /^call$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('player-info-1')).toHaveAttribute('data-active', 'true');
    });
    // It's no longer alice's turn, so her action controls should be gone.
    expect(screen.queryByRole('button', { name: /^call$/i })).not.toBeInTheDocument();
  });

  it('an illegal action (checking while facing a bet) surfaces the error banner', async () => {
    const { App } = ctx;
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    await within(screen.getByTestId('player-info-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-info-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    // Alice (small blind, first to act preflop heads-up) still owes the
    // difference to the big blind -- checking here is illegal and the
    // server rejects it via an `error` event instead of a `state` update.
    await screen.findByRole('button', { name: /^check$/i });
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot check while facing a bet/i);
  });
});
```

- [ ] **Step 2: Update `blackjack.integration.test.tsx`**

In `packages/frontend/src/integration/blackjack.integration.test.tsx`, apply these
exact replacements (the config/RNG-seeding block above the `describe` is unchanged —
only the assertions inside the one test change):

Replace:
```tsx
    await within(screen.getByTestId('seat-1')).findByText('bob');

    bobSocket.emit('ready');
    await within(screen.getByTestId('seat-1')).findByText(/^Ready$/);
```
with:
```tsx
    await within(screen.getByTestId('player-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-1')).findByText(/^Ready$/);
```

Replace:
```tsx
    await waitFor(() => {
      expect(screen.getByTestId('hands-0').querySelectorAll('img').length).toBeGreaterThanOrEqual(2);
    });
```
with:
```tsx
    await waitFor(() => {
      expect(screen.getByTestId('player-0').querySelectorAll('img').length).toBeGreaterThanOrEqual(2);
    });
```

- [ ] **Step 3: Run both integration suites**

Run: `npm test --workspace=@poker-blackjack/frontend -- poker.integration.test.tsx blackjack.integration.test.tsx`
Expected: PASS (3 poker + 1 blackjack = 4 tests)

- [ ] **Step 4: Run the full frontend suite and typecheck**

Run: `npm test --workspace=@poker-blackjack/frontend`
Expected: PASS, every file green. Test count changes from this plan: `GameTable.test.tsx`
9 (was 8), `PokerTable.test.tsx` 14 (was 12), `BlackjackTable.test.tsx` 13 (was 10),
integration files unchanged in count (3 + 1). `Card.test.tsx`/`Chip.test.tsx`/
`App.test.tsx`/`JoinScreen.test.tsx`/`SocketContext.test.tsx`/`tailwind.config.test.ts`
are untouched by this plan and should show their pre-existing counts unchanged.

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/integration/poker.integration.test.tsx packages/frontend/src/integration/blackjack.integration.test.tsx
git commit -m "test(frontend): update integration tests for the new player-info/player testids"
```

---

## After all tasks: manual verification

Not a task with its own commit. Per the design spec's Section 6 finding (a literal
1920×1080 canvas is not what a real browser window gives you once taskbar/browser
chrome are accounted for) and this plan's own Global Constraints note that exact
avatar/text sizing was scaled down from the spec's full-scale mockup to fit the real,
much smaller table oval — this plan's visual proportions need a live pass more than
saloon redesign v1's did. Start both dev servers, open two browser tabs, and check
specifically:

- Poker: opponent rail rows are legible and don't overflow the felt/rail boundary;
  the my-hand zone's larger cards don't collide with the action bar or the pot;
  showdown correctly shows revealed opponent cards inline in the rail and `my-result`
  near my own hand.
- Blackjack: with 4 seated players, the evenly-spaced row fits inside the felt without
  overlapping the dealer's hand above it; a split hand's two card-columns and shared
  info box read clearly as belonging to one player.
- The specific bug this plan was written to eliminate: seat content — cards
  specifically — should no longer overflow or overlap anything at any seat position,
  including the case that broke under the old seat-ring (the rightmost seat position).
- If any spacing needs adjustment, it's a Tailwind className tweak on the values this
  plan introduced (avatar size, gap/padding values, the `h-[190px] w-[130px]` my-hand
  wrapper, the felt row's `gap-3`) — not a re-architecture. Adjust and re-run the
  affected test file to confirm nothing structural broke.
