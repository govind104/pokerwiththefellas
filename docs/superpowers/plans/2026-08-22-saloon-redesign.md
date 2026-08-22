# Saloon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Plan 4 Poker/Blackjack table UI around a saloon-western
visual identity (RDR2's mood and material language, in flat 2D) — the "Clean Saloon +
Flat/Vector" v1 scope from the design spec.

**Architecture:** Pure frontend restyle. No new backend, protocol, or state-management
changes. New CSS custom properties + Tailwind theme tokens (Task 1) underpin every later
task; two new small components (`Chip`, and a restyled `Card` face-down branch) are built
in isolation before being wired into the three table components; Framer Motion is layered
on last, on top of the already-restyled components.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS (existing), Framer Motion (new
dependency, added in Task 7), Vitest + React Testing Library (existing).

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-22-saloon-redesign-design.md` —
every task's work implicitly includes these:

- **v1 scope only:** Clean Saloon + Flat/Vector. Deep Saloon and painterly card art are
  out of scope (Section 8 of the spec) — do not build them.
- **Card faces stay untouched.** The vendored 52-card SVG pack
  (`packages/frontend/src/assets/cards/`) is not modified. Only the card *back* and the
  frame around a face-up card change.
- **Restyle scope:** `GameTable`, `PokerTable`, `BlackjackTable`, `Card`, and a new
  `Chip` component. `JoinScreen` and the connection/error banners keep their current
  Tailwind styling — not touched by this plan.
- **Card back pattern:** a repeating lattice of small ornamental medallion shapes,
  rendered in brass-on-`--ink` (not RDR2's literal blue).
- **Motion:** Framer Motion. Card deal-in ~220–280ms ease-out with a few degrees of
  rotation. Chip movement ~150–200ms ease-out. Turn indicator is a subtle pulsing glow,
  not scale/bounce. Everything collapses to opacity-only under `prefers-reduced-motion`.
- **Color contrast:** every new color pairing actually used for text must meet WCAG AA —
  4.5:1 for body text, 3:1 for large text and UI component boundaries. This was checked
  by computing real contrast ratios (not eyeballed) for every token pair this plan
  actually uses, against the *real* background behind each piece of text — not just
  `--bg`. Two consequences that follow from that check, both baked into the tasks below
  rather than left for a later fix-up pass:
  1. Status text that floats directly over the felt (pot total, dealer label, showdown/
     outcome results, "waiting for hand" text) does not have enough contrast against
     `--felt`/`--felt-hi` for several of the palette's accent colors (as low as 1.77:1
     for ember-bright on felt-hi — a hard fail, not a near-miss). Tasks 5 and 6 give
     each of these elements a small `bg-surface` pill background — the same pattern the
     seat badges already use — rather than rendering as bare text on felt.
  2. Even against `--surface`, `--ember-bright` only reaches 4.25:1 for text (short of
     4.5:1) — see Task 1's `--ember-text` token.
- **Test suite:** every existing `data-testid` and ARIA role stays present and behaves
  the same. The one known, necessary exception: 5 assertions across
  `GameTable.test.tsx` and `poker.integration.test.tsx` currently assert the literal
  Tailwind class `bg-amber-500` as a proxy for "this seat is active" — that literal class
  goes away with the restyle, so Task 4 replaces it with a stable `data-active`
  attribute and updates those 5 assertions to check it instead. No other test file needs
  editing to accommodate styling changes (verified empirically against React Testing
  Library's `getByText`/`toHaveTextContent` matching behavior while writing this plan).
- **Desktop-first.** No dedicated mobile/small-screen layout work.
- **No sound.**

---

### Task 1: Design tokens, fonts, and Tailwind theme wiring

**Files:**
- Modify: `packages/frontend/index.html`
- Modify: `packages/frontend/src/index.css`
- Modify: `packages/frontend/tailwind.config.ts`
- Test: `packages/frontend/tailwind.config.test.ts` (new)

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces: CSS custom properties on `:root` (`--bg`, `--surface`, `--surface-raised`,
  `--wood`, `--wood-dark`, `--wood-grain`, `--felt`, `--felt-hi`, `--brass`,
  `--brass-bright`, `--parchment`, `--parchment-dim`, `--ink`, `--fg`, `--fg-dim`,
  `--fg-faint`, `--ember`, `--ember-bright`, `--ember-text`, `--win`, `--win-bright`)
  and matching Tailwind color utilities of the same names (e.g. `bg-felt`,
  `text-brass-bright`, `border-wood-grain`), plus `font-display` / `font-body` /
  `font-utility` font-family utilities. Every later task's className strings depend on
  these existing.

  `--ember-text` (`#d97a5c`) is a fourth ember variant, distinct from `--ember`/
  `--ember-bright`: it exists specifically for ember-colored *text* rendered on a
  `--surface` background. `--ember-bright` (`#c85a3c`) only clears 4.25:1 against
  `--surface` — short of the WCAG AA 4.5:1 body-text bar (verified by computing
  contrast ratios for every token pairing actually used, while writing this plan).
  `--ember-bright` stays correct for borders and button fills, where this bar doesn't
  apply the same way; `--ember-text` is what Tasks 5 and 6 use for actual ember-colored
  text.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tailwind.config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import tailwindConfig from './tailwind.config';

describe('tailwind theme tokens', () => {
  it('maps every saloon color token to its CSS custom property', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, string>;
    expect(colors.bg).toBe('var(--bg)');
    expect(colors.surface).toBe('var(--surface)');
    expect(colors['surface-raised']).toBe('var(--surface-raised)');
    expect(colors.wood).toBe('var(--wood)');
    expect(colors['wood-dark']).toBe('var(--wood-dark)');
    expect(colors['wood-grain']).toBe('var(--wood-grain)');
    expect(colors.felt).toBe('var(--felt)');
    expect(colors['felt-hi']).toBe('var(--felt-hi)');
    expect(colors.brass).toBe('var(--brass)');
    expect(colors['brass-bright']).toBe('var(--brass-bright)');
    expect(colors.parchment).toBe('var(--parchment)');
    expect(colors['parchment-dim']).toBe('var(--parchment-dim)');
    expect(colors.ink).toBe('var(--ink)');
    expect(colors.fg).toBe('var(--fg)');
    expect(colors['fg-dim']).toBe('var(--fg-dim)');
    expect(colors['fg-faint']).toBe('var(--fg-faint)');
    expect(colors.ember).toBe('var(--ember)');
    expect(colors['ember-bright']).toBe('var(--ember-bright)');
    expect(colors['ember-text']).toBe('var(--ember-text)');
    expect(colors.win).toBe('var(--win)');
    expect(colors['win-bright']).toBe('var(--win-bright)');
  });

  it('defines the three saloon font-family roles', () => {
    const fonts = tailwindConfig.theme?.extend?.fontFamily as Record<string, string[]>;
    expect(fonts.display[0]).toBe('Rye');
    expect(fonts.body[0]).toBe('Vollkorn');
    expect(fonts.utility[0]).toBe('"Special Elite"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- tailwind.config.test.ts`
Expected: FAIL — `tailwindConfig.theme?.extend?.colors` is `undefined` (empty `extend: {}`
today), so `colors.bg` throws or is `undefined`, not `'var(--bg)'`.

- [ ] **Step 3: Add the CSS custom properties**

Replace the full contents of `packages/frontend/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #140f0a;
  --surface: #1c1611;
  --surface-raised: #241c15;
  --wood: #4a2f1c;
  --wood-dark: #2c1c10;
  --wood-grain: #5e3d25;
  --felt: #2f4a3a;
  --felt-hi: #3c5c48;
  --brass: #b8863b;
  --brass-bright: #ddb15c;
  --parchment: #e8d9b5;
  --parchment-dim: #cdbb8f;
  --ink: #1a130d;
  --fg: #ede1c4;
  --fg-dim: #b8a988;
  --fg-faint: #8a7a5f;
  --ember: #a8452e;
  --ember-bright: #c85a3c;
  --ember-text: #d97a5c;
  --win: #5f7a4a;
  --win-bright: #7a9c5e;
}
```

- [ ] **Step 4: Extend the Tailwind theme**

Replace the full contents of `packages/frontend/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        wood: 'var(--wood)',
        'wood-dark': 'var(--wood-dark)',
        'wood-grain': 'var(--wood-grain)',
        felt: 'var(--felt)',
        'felt-hi': 'var(--felt-hi)',
        brass: 'var(--brass)',
        'brass-bright': 'var(--brass-bright)',
        parchment: 'var(--parchment)',
        'parchment-dim': 'var(--parchment-dim)',
        ink: 'var(--ink)',
        fg: 'var(--fg)',
        'fg-dim': 'var(--fg-dim)',
        'fg-faint': 'var(--fg-faint)',
        ember: 'var(--ember)',
        'ember-bright': 'var(--ember-bright)',
        'ember-text': 'var(--ember-text)',
        win: 'var(--win)',
        'win-bright': 'var(--win-bright)',
      },
      fontFamily: {
        display: ['Rye', 'Georgia', 'serif'],
        body: ['Vollkorn', 'Georgia', '"Times New Roman"', 'serif'],
        utility: ['"Special Elite"', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Add the Google Fonts links**

In `packages/frontend/index.html`, inside `<head>`, before the `<title>` line, add:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Rye&family=Vollkorn:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Special+Elite&display=swap"
      rel="stylesheet"
    />
```

The full `<head>` should now read:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Rye&family=Vollkorn:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Special+Elite&display=swap"
      rel="stylesheet"
    />
    <title>Poker &amp; Blackjack</title>
  </head>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- tailwind.config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: no errors

```bash
git add packages/frontend/index.html packages/frontend/src/index.css packages/frontend/tailwind.config.ts packages/frontend/tailwind.config.test.ts
git commit -m "feat(frontend): add saloon design tokens, fonts, and Tailwind theme wiring"
```

---

### Task 2: Chip component

**Files:**
- Create: `packages/frontend/src/components/Chip.tsx`
- Test: `packages/frontend/src/components/Chip.test.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`brass`, `ink`, `brass-bright`, `font-utility`).
- Produces: `Chip` component — `export function Chip({ value }: { value: number })` —
  consumed by Task 6 (`BlackjackTable`).

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/Chip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders the given value as text', () => {
    render(<Chip value={125} />);
    expect(screen.getByText('125')).toBeInTheDocument();
  });

  it('marks its decorative graphic as aria-hidden, so only the value is announced', () => {
    render(<Chip value={10} />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- Chip.test.tsx`
Expected: FAIL — `Cannot find module './Chip'`

- [ ] **Step 3: Write the component**

Create `packages/frontend/src/components/Chip.tsx`:

```tsx
export interface ChipProps {
  value: number;
}

// text-brass-bright only clears WCAG AA against a dark surface (e.g. --surface) --
// callers must render this on top of a sufficiently dark background, not bare felt.
export function Chip({ value }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <svg viewBox="0 0 40 40" className="h-5 w-5" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="12" fill="none" stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
      <span className="font-utility text-sm text-brass-bright">{value}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- Chip.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/Chip.tsx packages/frontend/src/components/Chip.test.tsx
git commit -m "feat(frontend): add Chip component"
```

---

### Task 3: Card back (lattice pattern) and card frame

**Files:**
- Modify: `packages/frontend/src/components/Card.tsx`
- Modify: `packages/frontend/src/components/Card.test.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`brass`, `parchment`, CSS vars `--ink`,
  `--brass` used directly in SVG since Tailwind arbitrary color classes don't apply
  inside raw SVG attribute values).
- Produces: same `Card` component signature as before
  (`{ card?: CardModel; faceDown?: boolean }`), consumed unchanged by `PokerTable`,
  `BlackjackTable`, and Task 7's motion wrapping.

- [ ] **Step 1: Write the failing test**

Add to `packages/frontend/src/components/Card.test.tsx` (inside the existing `describe`
block, after the last test):

```tsx
  it('renders a repeating lattice pattern (not the old plain placeholder) when face down', () => {
    render(<Card faceDown />);
    const svg = screen.getByRole('img', { name: /face-down/i });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('pattern')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- Card.test.tsx`
Expected: FAIL — the current face-down placeholder is a `<div>`, not an `<svg>`, so
`svg.tagName` is undefined / the assertion throws.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/Card.tsx`:

```tsx
import { useId } from 'react';
import type { Card as CardModel, Rank } from '@poker-blackjack/game-engine';

// Confirmed against the actual vendored filenames from Task 3, Step 1:
// the Webisso/playing-cards repo uses `<name>_of_<suit>.svg`, with face cards
// spelled out (`ace`, `jack`, `queen`, `king`) and bare digits for numbers
// 2-10. This mapping matches the real files exactly.
const RANK_FILE: Record<Rank, string> = {
  A: 'ace',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
};

function assetUrl(card: CardModel): string {
  return new URL(`../assets/cards/${RANK_FILE[card.rank]}_of_${card.suit}.svg`, import.meta.url).href;
}

export interface CardProps {
  card?: CardModel;
  faceDown?: boolean;
}

export function Card({ card, faceDown = false }: CardProps) {
  const patternId = useId();

  if (faceDown || !card) {
    return (
      <svg role="img" aria-label="face-down card" viewBox="0 0 64 96" className="h-24 w-16 rounded-md">
        <defs>
          <pattern
            id={`card-back-lattice-${patternId}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="var(--ink)" />
            <path d="M5,1 L9,5 L5,9 L1,5 Z" fill="none" stroke="var(--brass)" strokeWidth="0.75" opacity="0.6" />
          </pattern>
        </defs>
        <rect
          x="1"
          y="1"
          width="62"
          height="94"
          rx="4"
          fill={`url(#card-back-lattice-${patternId})`}
          stroke="var(--brass)"
          strokeWidth="2"
        />
      </svg>
    );
  }
  return (
    <img
      src={assetUrl(card)}
      alt={`${card.rank} of ${card.suit}`}
      className="h-24 w-16 rounded-md border-2 border-brass bg-parchment shadow-md"
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=@poker-blackjack/frontend -- Card.test.tsx`
Expected: PASS (5 tests — the 4 pre-existing tests plus the new one)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/Card.tsx packages/frontend/src/components/Card.test.tsx
git commit -m "feat(frontend): replace card-back placeholder with brass lattice pattern, brass card frame"
```

---

### Task 4: GameTable restyle — felt, rail, seat ring, turn indicator

**Files:**
- Modify: `packages/frontend/src/components/GameTable.tsx`
- Modify: `packages/frontend/src/components/GameTable.test.tsx`
- Modify: `packages/frontend/src/integration/poker.integration.test.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1.
- Produces: a `data-active` attribute (string `"true"`/`"false"`) on each seat's
  `data-testid="seat-N"` element, replacing `bg-amber-500` as the active-seat signal.
  Consumed by Task 7 (seat-pulse animation) and by the two test files updated in this
  task.

**Design note on the banners:** the `role="status"` reconnecting banner and `role="alert"`
error banner live inside this same file, but per the spec (Section 1), they're explicitly
out of scope for this plan — no bespoke visual pass. The step below leaves their
`className`s exactly as they are today (`bg-amber-600`, `bg-red-600`); only the felt,
rail, seats, and buttons change.

- [ ] **Step 1: Write the failing test**

In `packages/frontend/src/components/GameTable.test.tsx`, replace the body of the first
test (`'renders every seat with its display name and highlights the active one'`):

```tsx
  it('renders every seat with its display name and highlights the active one', () => {
    render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.getByTestId('seat-0')).toHaveTextContent('alice');
    expect(screen.getByTestId('seat-1')).toHaveTextContent('bob');
    expect(screen.getByTestId('seat-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('seat-0')).toHaveAttribute('data-active', 'false');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- GameTable.test.tsx`
Expected: FAIL — no `data-active` attribute exists yet (also, the old assertion's
removal means the old `bg-amber-500` check is gone, so this is testing the new
attribute against code that doesn't produce it yet).

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/GameTable.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';

export interface GameTableProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  seatContent?: Partial<Record<number, ReactNode>>;
  children: ReactNode;
}

export function GameTable({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  seatContent,
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
      <div className="relative flex h-[28rem] w-[36rem] items-center justify-center rounded-full border-[10px] border-wood bg-gradient-to-br from-wood to-wood-dark shadow-[inset_0_0_60px_20px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(120%_100%_at_50%_30%,var(--felt-hi)_0%,var(--felt)_100%)] shadow-[inset_0_10px_30px_rgba(0,0,0,0.45)]">
          {seats.map((seat, i) => {
            const angle = (i / seats.length) * 2 * Math.PI;
            const x = 50 + 42 * Math.cos(angle);
            const y = 50 + 42 * Math.sin(angle);
            const isActive = seat.seatIndex === activeSeatIndex;
            return (
              <div
                key={seat.seatIndex}
                data-testid={`seat-${seat.seatIndex}`}
                data-active={isActive ? 'true' : 'false'}
                className={`absolute flex flex-col items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? 'border-brass-bright bg-surface-raised text-parchment shadow-[0_0_10px_2px_rgba(221,177,92,0.5)]'
                    : 'border-wood-grain bg-surface/80 text-fg-dim'
                }`}
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              >
                <span className="font-semibold text-parchment">{seat.displayName ?? 'Empty seat'}</span>
                {seat.displayName && (
                  <>
                    <span>{seat.balance} chips</span>
                    <span>{seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected'}</span>
                    {seatContent?.[seat.seatIndex]}
                  </>
                )}
              </div>
            );
          })}
          <div className="flex h-full flex-col items-center justify-center gap-2">{children}</div>
        </div>
      </div>
      {mySeat && !handInProgress && !mySeat.ready && (
        <button
          onClick={onReady}
          className="mt-4 rounded-md border border-brass-bright bg-brass px-4 py-2 font-medium text-ink hover:bg-brass-bright"
        >
          Ready
        </button>
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- GameTable.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Update the integration test's coupled assertions**

In `packages/frontend/src/integration/poker.integration.test.tsx`, the active-seat
checks (originally around lines 86, 95, 97) currently read:

```tsx
    expect(screen.getByTestId('seat-0').className).toMatch(/bg-amber-500/);
```

and, a few lines later:

```tsx
    await waitFor(() => {
      expect(screen.getByTestId('seat-1').className).toMatch(/bg-amber-500/);
    });
    expect(screen.getByTestId('seat-0').className).not.toMatch(/bg-amber-500/);
```

Replace all three with the `data-active` attribute check:

```tsx
    expect(screen.getByTestId('seat-0')).toHaveAttribute('data-active', 'true');
```

and:

```tsx
    await waitFor(() => {
      expect(screen.getByTestId('seat-1')).toHaveAttribute('data-active', 'true');
    });
    expect(screen.getByTestId('seat-0')).toHaveAttribute('data-active', 'false');
```

- [ ] **Step 6: Run the integration test to verify it still passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- poker.integration.test.tsx`
Expected: PASS (same test count as before this task)

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/GameTable.tsx packages/frontend/src/components/GameTable.test.tsx packages/frontend/src/integration/poker.integration.test.tsx
git commit -m "style(frontend): restyle GameTable with saloon tokens, replace bg-amber-500 active-seat signal with data-active"
```

---

### Task 5: PokerTable restyle

**Files:**
- Modify: `packages/frontend/src/components/PokerTable.tsx`
- Modify: `packages/frontend/src/components/PokerTable.test.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1, restyled `Card` (Task 3), restyled `GameTable`
  (Task 4).
- Produces: `data-testid="pot"` on the pot line (new — not required by any other task in
  this plan, but available for future use).

**Design note on the pot line:** the existing test asserts
`screen.getByText(/pot: 15/i)`, which requires "Pot: " and the number to remain in the
same text node (verified empirically while writing this plan — React Testing Library's
`getByText` fails to find text that's split across a parent and a child element). So the
pot number stays a plain `{...}` expression exactly as today, as a direct sibling of the
"Pot: " text; the new chip icon is an `aria-hidden` SVG sibling before it, not a wrapper
around the number. The whole line also needs a `bg-surface` background (see the Global
Constraints note on felt contrast) — that's an *additional* outer styling change, not a
restructuring of the text itself, and was separately verified not to break `getByText`.

- [ ] **Step 1: Write the failing test**

Add to `packages/frontend/src/components/PokerTable.test.tsx` (inside the existing
`describe` block, after the last test):

```tsx
  it('renders a decorative chip icon next to the pot total', () => {
    const state = makeHoldemPreflopState();
    render(<PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem} />);
    expect(screen.getByTestId('pot').querySelector('svg')).toBeInTheDocument();
    expect(screen.getByTestId('pot')).toHaveTextContent(/pot: 15/i);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- PokerTable.test.tsx`
Expected: FAIL — no element has `data-testid="pot"` yet.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/PokerTable.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';

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

  // A value typed into the raise field on one street/turn must not leak into
  // the next -- reset whenever the street or the acting player changes (a new
  // street, a new turn, or a new hand entirely).
  useEffect(() => {
    setRaiseAmount(0);
  }, [holdem?.street, holdem?.actingPlayerId]);

  const seatContent: Partial<Record<number, ReactNode>> = {};
  if (holdem) {
    for (const player of holdem.players) {
      const seat = seats.find((s) => s.displayName === player.playerId);
      if (!seat) continue;
      seatContent[seat.seatIndex] = (
        <div className="flex gap-1" data-testid={`hole-cards-${seat.seatIndex}`}>
          <Card card={player.holeCards?.[0]} faceDown={player.holeCards === null} />
          <Card card={player.holeCards?.[1]} faceDown={player.holeCards === null} />
        </div>
      );
    }
  }

  return (
    <GameTable
      seats={seats}
      activeSeatIndex={activeSeatIndex}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
      seatContent={seatContent}
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
            className="flex items-center gap-1.5 rounded-md border border-wood-grain bg-surface px-3 py-1 font-utility text-sm text-brass-bright"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <circle cx="10" cy="10" r="9" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1" />
              <circle cx="10" cy="10" r="5.5" fill="none" stroke="var(--ink)" strokeWidth="0.75" strokeDasharray="1.5 2" />
            </svg>
            Pot: {holdem.pots.reduce((sum, pot) => sum + pot.amount, 0)}
          </div>
          {holdem.street === 'settled' && holdem.results && (
            <div className="flex flex-col items-center gap-1" data-testid="holdem-results">
              {holdem.results.map((result) => (
                <div
                  key={result.playerId}
                  data-testid={`holdem-result-${result.playerId}`}
                  className={`rounded-md border border-wood-grain bg-surface px-3 py-1 font-body text-sm ${
                    result.payout > 0
                      ? 'text-win-bright'
                      : result.payout < 0
                        ? 'text-ember-text'
                        : 'text-parchment-dim'
                  }`}
                >
                  {result.payout > 0
                    ? `${result.playerId} won ${result.payout}`
                    : result.payout < 0
                      ? `${result.playerId} lost ${Math.abs(result.payout)}`
                      : `${result.playerId} split even`}
                </div>
              ))}
            </div>
          )}
          {isMyTurn && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onAction('fold')}
                className="rounded-md border border-ember bg-surface px-3 py-1 text-ember-text hover:bg-surface-raised"
              >
                Fold
              </button>
              <button
                onClick={() => onAction('check')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Check
              </button>
              <button
                onClick={() => onAction('call')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Call
              </button>
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
              <button
                onClick={() => onAction('raise', raiseAmount)}
                className="rounded-md border border-brass-bright bg-brass px-3 py-1 text-ink hover:bg-brass-bright"
              >
                Raise
              </button>
              <button
                onClick={() => onAction('all-in')}
                className="rounded-md border border-ember-bright bg-surface px-3 py-1 text-ember-text hover:bg-surface-raised"
              >
                All In
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg-dim">Waiting for hand to start…</div>
      )}
    </GameTable>
  );
}
```

- [ ] **Step 4: Run the full PokerTable suite to verify everything passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- PokerTable.test.tsx`
Expected: PASS (all pre-existing tests plus the new one, 12 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PokerTable.tsx packages/frontend/src/components/PokerTable.test.tsx
git commit -m "style(frontend): restyle PokerTable with saloon tokens and a pot chip icon"
```

---

### Task 6: BlackjackTable restyle

**Files:**
- Modify: `packages/frontend/src/components/BlackjackTable.tsx`
- Modify: `packages/frontend/src/components/BlackjackTable.test.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1, `Chip` (Task 2), restyled `Card` (Task 3),
  restyled `GameTable` (Task 4).
- Produces: `data-outcome` attribute (`'win' | 'lose' | 'push'`) on each
  `hand-result-${seatIndex}-${i}` element — a stable, semantic hook for the outcome's
  polarity, parallel to Task 4's `data-active`, used instead of asserting the literal
  Tailwind color class in tests.

**Design note on the bet line:** unlike `PokerTable`'s pot text (tested with
`getByText`), the existing bet assertion is `screen.getByTestId('hand-bet-0-0')` +
`.toHaveTextContent(/25/)` — `toHaveTextContent` checks one already-selected element's
full text, so nesting the `Chip` component inside that `data-testid` element is safe
regardless of internal structure (verified empirically while writing this plan). The
"Bet: " label is dropped — the chip icon now conveys that on its own, mirroring how an
actual bet is shown as a stack of chips, not chips-plus-text. Both the bet wrapper and
the outcome result element get a `bg-surface` background for the same reason as
`PokerTable`'s pot/results (Global Constraints, "Color contrast") — `Chip`'s
`text-brass-bright` and the outcome colors don't have enough contrast against bare felt.

- [ ] **Step 1: Write the failing test**

Add to `packages/frontend/src/components/BlackjackTable.test.tsx` (inside the existing
`describe` block, after the last test):

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- BlackjackTable.test.tsx`
Expected: FAIL — no `data-outcome` attribute exists yet.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `packages/frontend/src/components/BlackjackTable.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Outcome } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { Chip } from './Chip';
import { GameTable } from './GameTable';

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

  const seatContent: Partial<Record<number, ReactNode>> = {};
  if (blackjackRounds) {
    for (const [seatIndexStr, round] of Object.entries(blackjackRounds)) {
      const seatIndex = Number(seatIndexStr);
      seatContent[seatIndex] = (
        <div className="flex flex-col gap-1" data-testid={`hands-${seatIndex}`}>
          {round.playerHands.map((hand, i) => {
            const outcome = round.phase === 'settled' && round.results ? round.results[i].outcome : null;
            const polarity = outcome ? OUTCOME_POLARITY[outcome] : null;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="flex gap-1">
                  {hand.cards.map((card, j) => (
                    <Card key={j} card={card} />
                  ))}
                </div>
                <div
                  data-testid={`hand-bet-${seatIndex}-${i}`}
                  className="rounded-md border border-wood-grain bg-surface px-2 py-0.5"
                >
                  <Chip value={hand.bet} />
                </div>
                {outcome && polarity && (
                  <div
                    className={`rounded-md border border-wood-grain bg-surface px-2 py-0.5 font-body text-xs font-semibold ${OUTCOME_COLOR[polarity]}`}
                    data-testid={`hand-result-${seatIndex}-${i}`}
                    data-outcome={polarity}
                  >
                    {OUTCOME_LABELS[outcome]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  }

  return (
    <GameTable
      seats={seats}
      activeSeatIndex={activeSeatIndex}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      errorMessage={errorMessage}
      onReady={onReady}
      onLeave={onLeave}
      seatContent={seatContent}
    >
      {blackjackRounds ? (
        <div className="flex flex-col items-center gap-2" data-testid="dealer-hand">
          <p className="rounded-md border border-wood-grain bg-surface px-3 py-1 font-utility text-xs uppercase tracking-wide text-brass-bright">
            Dealer
          </p>
          <div className="flex gap-1">
            {dealerRound?.dealerCards
              ? dealerRound.dealerCards.map((card, i) => <Card key={i} card={card} />)
              : dealerRound && <Card card={dealerRound.dealerUpcard} />}
          </div>
          {isMyTurn && (
            <div className="flex gap-2">
              <button
                onClick={() => onAction('hit')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Hit
              </button>
              <button
                onClick={() => onAction('stand')}
                className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg hover:bg-surface-raised"
              >
                Stand
              </button>
              <button
                onClick={() => onAction('double')}
                className="rounded-md border border-brass-bright bg-brass px-3 py-1 text-ink hover:bg-brass-bright"
              >
                Double
              </button>
              <button
                onClick={() => onAction('split')}
                className="rounded-md border border-ember-bright bg-surface px-3 py-1 text-ember-text hover:bg-surface-raised"
              >
                Split
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-wood-grain bg-surface px-3 py-1 text-fg-dim">Waiting for hand to start…</div>
      )}
    </GameTable>
  );
}
```

- [ ] **Step 4: Run the full BlackjackTable suite to verify everything passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- BlackjackTable.test.tsx`
Expected: PASS (all pre-existing tests plus the new one, 10 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/BlackjackTable.tsx packages/frontend/src/components/BlackjackTable.test.tsx
git commit -m "style(frontend): restyle BlackjackTable with saloon tokens, Chip bets, and outcome polarity"
```

---

### Task 7: Motion — card deal-in, chip entrance, turn-indicator pulse

**Files:**
- Modify: `packages/frontend/package.json` (via `npm install`)
- Modify: `packages/frontend/src/components/Card.tsx`
- Modify: `packages/frontend/src/components/Chip.tsx`
- Modify: `packages/frontend/src/components/GameTable.tsx`
- Modify: `packages/frontend/src/components/GameTable.test.tsx`
- Modify: `packages/frontend/src/index.css`
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `Card` (Task 3), `Chip` (Task 2), `GameTable`'s `data-active` attribute
  (Task 4), `App`'s root JSX (existing).
- Produces: a `.seat-active-glow` CSS class (index.css) applied to the active seat,
  motion-wrapped `Card`/`Chip` root elements, and app-wide `MotionConfig` with
  `reducedMotion="user"` so every Framer Motion animation in the app automatically
  collapses to opacity-only when the OS-level reduced-motion preference is set — nothing
  else in this plan needs to branch on `prefers-reduced-motion` itself.

Automated testing note: Framer Motion's actual animation values aren't meaningfully
testable under jsdom (animations are effectively instantaneous/no-op in that
environment), consistent with the design spec's Section 7 choice to skip visual/
animation regression tooling. This task's verification is therefore: (a) one new test
for the one new piece of markup-level behavior this task adds (the `seat-active-glow`
class), and (b) re-running every test file this task touches to confirm the motion
wrapping introduces zero regressions in accessible roles, testids, or text content.
Actual animation feel is confirmed by a live manual click-through, the same pattern
Plan 4 used.

- [ ] **Step 1: Install Framer Motion**

Run: `npm install framer-motion --workspace=@poker-blackjack/frontend`
Expected: `packages/frontend/package.json`'s `dependencies` gains a `framer-motion`
entry at whatever the current published version resolves to.

- [ ] **Step 2: Write the failing test for the seat-pulse class**

In `packages/frontend/src/components/GameTable.test.tsx`, extend the same test edited in
Task 4 (`'renders every seat with its display name and highlights the active one'`) with
two more assertions:

```tsx
  it('renders every seat with its display name and highlights the active one', () => {
    render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.getByTestId('seat-0')).toHaveTextContent('alice');
    expect(screen.getByTestId('seat-1')).toHaveTextContent('bob');
    expect(screen.getByTestId('seat-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('seat-0')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('seat-1').className).toMatch(/seat-active-glow/);
    expect(screen.getByTestId('seat-0').className).not.toMatch(/seat-active-glow/);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace=@poker-blackjack/frontend -- GameTable.test.tsx`
Expected: FAIL — no element has the `seat-active-glow` class yet.

- [ ] **Step 4: Add the pulse keyframes**

In `packages/frontend/src/index.css`, append after the `:root { ... }` block added in
Task 1:

```css

@keyframes seat-pulse {
  0%,
  100% {
    box-shadow: 0 0 8px 2px rgba(221, 177, 92, 0.35);
  }
  50% {
    box-shadow: 0 0 14px 4px rgba(221, 177, 92, 0.65);
  }
}

.seat-active-glow {
  animation: seat-pulse 2.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .seat-active-glow {
    animation: none;
  }
}
```

- [ ] **Step 5: Wire the class into GameTable and drop the now-redundant static shadow**

In `packages/frontend/src/components/GameTable.tsx`, find the seat `className` template
literal added in Task 4:

```tsx
                className={`absolute flex flex-col items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? 'border-brass-bright bg-surface-raised text-parchment shadow-[0_0_10px_2px_rgba(221,177,92,0.5)]'
                    : 'border-wood-grain bg-surface/80 text-fg-dim'
                }`}
```

Replace the static `shadow-[...]` utility with the new animated class:

```tsx
                className={`absolute flex flex-col items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? 'border-brass-bright bg-surface-raised text-parchment seat-active-glow'
                    : 'border-wood-grain bg-surface/80 text-fg-dim'
                }`}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test --workspace=@poker-blackjack/frontend -- GameTable.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 7: Add the card deal-in animation**

In `packages/frontend/src/components/Card.tsx`, add the import:

```ts
import { motion } from 'framer-motion';
```

Change the face-down branch's root element from `<svg ...>` to `<motion.svg ...>`, and
add the animation props. The full face-down return becomes:

```tsx
    return (
      <motion.svg
        role="img"
        aria-label="face-down card"
        viewBox="0 0 64 96"
        className="h-24 w-16 rounded-md"
        initial={{ opacity: 0, y: -12, rotate: -4 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <defs>
          <pattern
            id={`card-back-lattice-${patternId}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="var(--ink)" />
            <path d="M5,1 L9,5 L5,9 L1,5 Z" fill="none" stroke="var(--brass)" strokeWidth="0.75" opacity="0.6" />
          </pattern>
        </defs>
        <rect
          x="1"
          y="1"
          width="62"
          height="94"
          rx="4"
          fill={`url(#card-back-lattice-${patternId})`}
          stroke="var(--brass)"
          strokeWidth="2"
        />
      </motion.svg>
    );
```

And change the face-up `<img ...>` to `<motion.img ...>`:

```tsx
  return (
    <motion.img
      src={assetUrl(card)}
      alt={`${card.rank} of ${card.suit}`}
      className="h-24 w-16 rounded-md border-2 border-brass bg-parchment shadow-md"
      initial={{ opacity: 0, y: -12, rotate: 4 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    />
  );
```

- [ ] **Step 8: Run the Card suite to verify no regression**

Run: `npm test --workspace=@poker-blackjack/frontend -- Card.test.tsx`
Expected: PASS (5 tests, unchanged from Task 3 — `motion.img`/`motion.svg` still render
real `<img>`/`<svg>` elements with the same attributes, so every existing role/attribute
assertion still holds)

- [ ] **Step 9: Add the chip entrance animation**

Replace the full contents of `packages/frontend/src/components/Chip.tsx`:

```tsx
import { motion } from 'framer-motion';

export interface ChipProps {
  value: number;
}

// text-brass-bright only clears WCAG AA against a dark surface (e.g. --surface) --
// callers must render this on top of a sufficiently dark background, not bare felt.
export function Chip({ value }: ChipProps) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="inline-flex items-center gap-1 align-middle"
    >
      <svg viewBox="0 0 40 40" className="h-5 w-5" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="12" fill="none" stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
      <span className="font-utility text-sm text-brass-bright">{value}</span>
    </motion.span>
  );
}
```

- [ ] **Step 10: Run the Chip suite to verify no regression**

Run: `npm test --workspace=@poker-blackjack/frontend -- Chip.test.tsx`
Expected: PASS (2 tests, unchanged from Task 2)

- [ ] **Step 11: Wrap the app root with reduced-motion config**

In `packages/frontend/src/App.tsx`, add the import:

```ts
import { MotionConfig } from 'framer-motion';
```

Change the `App` function's return to wrap `SocketProvider`:

```tsx
function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SocketProvider serverUrl={SERVER_URL}>
        <AppContent />
      </SocketProvider>
    </MotionConfig>
  );
}
```

- [ ] **Step 12: Run the full frontend test suite to confirm zero regressions**

Run: `npm test --workspace=@poker-blackjack/frontend`
Expected: PASS, all test files green (component tests, integration tests, `App.test.tsx`,
`SocketContext.test.tsx`, `tailwind.config.test.ts`)

- [ ] **Step 13: Typecheck**

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: no errors

- [ ] **Step 14: Commit**

```bash
git add packages/frontend/package.json packages/frontend/package-lock.json packages/frontend/src/components/Card.tsx packages/frontend/src/components/Chip.tsx packages/frontend/src/components/GameTable.tsx packages/frontend/src/components/GameTable.test.tsx packages/frontend/src/index.css packages/frontend/src/App.tsx
git commit -m "feat(frontend): add Framer Motion — card deal-in, chip entrance, seat-pulse turn indicator"
```

---

## After all tasks: manual verification

Not a task with its own commit — a final check before opening a PR, mirroring how
Plan 4 was verified. Start the real backend (`npm run dev --workspace=@poker-blackjack/server`)
and frontend (`npm run dev --workspace=@poker-blackjack/frontend`), open two browser
tabs, and confirm live: the saloon palette and fonts render correctly, the active seat
pulses, cards deal in with a slight arc, face-down cards show the brass lattice pattern,
and chip values appear correctly styled for both games' bets/pot.

Every token pairing this plan actually uses was checked against computed WCAG contrast
ratios while writing this plan (not just eyeballed) — see the Global Constraints "Color
contrast" note and Tasks 1/5/6 for the two real problems that check caught (`--ember-text`
and the `bg-surface` pills over felt) before any code was written. This manual pass is a
final sanity check that the real, rendered result matches what was computed — not the
first line of defense.
