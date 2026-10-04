# Saloon Lobby, Door Entry and Table-Switch Swing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A three.js scene of saloon batwing doors replaces the lobby and name screens. The doors swing open onto the table on entry, the camera swings 180° from one table to the other when the admin switches games, and the admin controls get the saloon look.

**Architecture:** A pure motion module (`doorMotion.ts`) and a geometry module (`doorSet.ts`) feed a small `DoorScene` (own renderer, the table's grade pass), wrapped by a lazy `DoorStage`. `EntranceScreen` (closed sign / name ledger overlays over the doors, or over a plain themed screen) is driven by a pure `doorFlow` reducer in `App`, which waits for the table underneath to report its first frame before the doors open. A `TableSwitcher` component keeps the old table on screen while the new one loads hidden, then runs a pure `switchFlow` reducer and a `SwingDriver`. The driver turns each `SceneRoot` camera on a quintic smootherstep curve and drives a single-pass motion-blur shader. Admin restyle and the Rye font come first.

**Tech Stack:** TypeScript, React 18, three.js 0.180 (EffectComposer, ShaderPass), framer-motion 13 (`useReducedMotion`), Tailwind 3, Vitest + jsdom + Testing Library. Run commands from the repo root.

**Spec:** `docs/superpowers/specs/2026-10-04-saloon-lobby-design.md` (decisions L1–L12, §2–§7).

## Global Constraints

- The doors are a three.js scene reusing the table's textures (`textures.ts`) and grade pass. Look: moonlit boardwalk at night, batwing doors backlit by warm amber light, a light beam and dust through the gap (L1, L2).
- One door scene frames both waiting and name entry; `Lobby.tsx` and `JoinScreen.tsx` are deleted (L3, §3.2).
- Closed sign text: "Closed — waiting for the dealer". Admins also get **Open for Poker** / **Open for Blackjack**, calling the existing `adminStartGame` (L4).
- Name ledger: same validation, errors and `joinWithName` call as `JoinScreen`; keep the label "Display name" and the button "Join table" / "Joining…". Returning players auto-rejoin and skip it (L5).
- Entry: the table preloads first (first frame drawn), then the doors swing inward while the camera pushes through, about 1.5 s; it plays on every doors → table entry, including after a reload (L6).
- Switch: 180° camera turn on the spot, `SWING_MS = 1300`, one quintic smootherstep curve, no overshoot or rubber-banding, light speed-scaled horizontal motion blur, no crane arc (no vertical dip or zoom) (L7). The swing starts only when the new table is ready (L8).
- Motion blur: one pass, at least 16 samples per pixel, per-pixel jittered sample offsets, floating point, **no stacking of frames or canvas copies** (§3.4).
- Fallbacks: reduced motion → both transitions are a 300 ms crossfade. No WebGL or the flat view → plain themed screen with the same overlays; the switch dips to black, 260 ms out and 420 ms in (L9).
- `TABLE_READY_TIMEOUT_MS = 8000` (entry and switch): hand over with a crossfade if the table never reports ready (§4).
- A mode switch arriving mid-switch waits; the next switch runs from idle (latest wins) (§4).
- Restyle: `AdminEntry` / `AdminPanel` move to `Button` and the saloon tokens, no behaviour change (L10). Load Rye from Google Fonts in `index.html` and `dev3d.html` (L11).
- Non-goals: phones, door/swing sound, one shared room for both tables, server changes (§7).
- Nothing `App.tsx` imports statically may import the `three` package (it would pull three.js out of the lazy chunks). `src/entrance/` and `src/switch/` never import `three`; the HUD import guard (`src/hud/noThree.test.ts`) is extended to check them.
- Nothing built for the 3D tables may break: `SceneRoot` changes are additive (a first-frame hook, a yaw that is 0 by default, a blur pass that is disabled at 0).
- Commands (repo root): all tests `npm test`; one workspace `npm test --workspace=@poker-blackjack/frontend`; one file `npx vitest run <path relative to the package> --root packages/frontend`; typecheck `npm run typecheck`. Both green at every commit.
- Every task is test-first where a test is possible. When a new test passes at once, temporarily remove the code it guards, watch it fail, then restore it. WebGL classes (`DoorScene`, `SceneRoot`) have no unit tests (no WebGL in jsdom); typecheck, the suite and the render gates check them.
- The controller commits each task after a clean review without asking (user rule), then ticks the plan. Never push. The three render gates are user-gated: stop and wait for approval.
- Code comments match the surrounding files (they explain *why*) and cite the spec (e.g. "lobby spec L7").
- Never write `\u` escapes in code: write the real character (— …) or use `String.fromCodePoint(0x...)`.
- The soundboard plan (`2026-10-04-soundboard.md`) may ship first and also edits `TableStage.tsx` and `SocketContextValue`. Read each file before editing; snippets here show only this plan's additions. If `SocketContextValue` has gained fields, add them as `vi.fn()` in `src/entrance/testSocket.ts`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/frontend/src/components/AdminEntry.tsx`, `AdminPanel.tsx` | Restyle; `AdminPanel` gains `align` (T-3) |
| `packages/frontend/index.html`, `dev3d.html`, `tailwind.config.ts`, `fonts.test.ts` (new) | Rye font |
| `packages/frontend/src/three/engine/tween.ts` | `smootherstep` (shared by doors and swing) |
| `packages/frontend/src/three/engine/doorMotion.ts` (new) | Pure door-opening timing: angle, camera, fade |
| `packages/frontend/src/three/engine/doorSet.ts` (new) | Door, frame, facade and boardwalk meshes with injected textures |
| `packages/frontend/src/three/engine/grade.ts` (new) | `GradeShader`, moved out of `SceneRoot.ts` so both scenes share it |
| `packages/frontend/src/three/engine/doorScene.ts` (new) | Renderer, lights, dust, opening playback, first-frame hook |
| `packages/frontend/src/three/DoorStage.tsx` (new) | Lazy React shell for `DoorScene` |
| `packages/frontend/src/three/devHarness.tsx` | `?game=doors` and `?game=swing` harnesses for the gates |
| `packages/frontend/src/entrance/doorFlow.ts` (new) | Pure entry reducer |
| `packages/frontend/src/entrance/ClosedSign.tsx`, `NameLedger.tsx`, `EntranceScreen.tsx`, `testSocket.ts` (new) | Overlays and the entrance layer |
| `packages/frontend/src/three/engine/SceneRoot.ts` | `onFirstFrame`, `setViewYaw`, `setMotionBlur` |
| `packages/frontend/src/three/engine/motionBlur.ts` (new) | The motion-blur shader |
| `packages/frontend/src/three/TableStage.tsx`, `Blackjack3D.tsx`, `Poker3D.tsx` | `onViewReady`, `onScene` props |
| `packages/frontend/src/switch/swingCurve.ts`, `switchFlow.ts`, `SwingDriver.ts`, `TableSwitcher.tsx` (new) | Swing timing, switch reducer, swing driver, layered views |
| `packages/frontend/src/App.tsx` | Entrance, door flow, `TableSwitcher` |

---

## Phase a: restyle and font (no gate)

### Task 1: Restyle `AdminEntry` / `AdminPanel`, load Rye, fix T-3

**Files:**
- Modify: `packages/frontend/src/components/AdminEntry.tsx` (full rewrite below)
- Modify: `packages/frontend/src/components/AdminPanel.tsx`
- Modify: `packages/frontend/src/components/AdminPanel.test.tsx`
- Modify: `packages/frontend/src/App.tsx` (off-table panel wrapper)
- Modify: `packages/frontend/index.html`, `packages/frontend/dev3d.html`, `packages/frontend/tailwind.config.ts`
- Create: `packages/frontend/fonts.test.ts`

**Interfaces:**
- Produces: `AdminPanel({ align }: { align?: 'left' | 'right' })`, default `'left'`; `'right'` anchors the dropdown to the trigger's right edge.

`TODO.md` T-3: off-table, the "Admin panel" button sits at the left of a `w-64` box pinned to the right edge, so it is not flush right. The wrapper drops `w-64` and the panel opens leftward from a right-aligned trigger.

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/fonts.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

describe('Google Fonts request', () => {
  it.each(['index.html', 'dev3d.html'])('%s loads Rye alongside the other faces (lobby spec L11)', (file) => {
    const html = read(file);
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?[^"]*family=Rye/);
    expect(html).toMatch(/family=Special\+Elite/);
  });
});
```

Add to `packages/frontend/src/components/AdminPanel.test.tsx`, inside `describe('AdminPanel')`:

```tsx
  it('opens leftward from a right-aligned trigger when align is right (TODO T-3)', () => {
    const value = makeSocketValue();
    render(
      <SocketContext.Provider value={value}>
        <AdminPanel align="right" />
      </SocketContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    const panel = screen.getByText(/currently playing/i).closest('div.absolute') as HTMLElement;
    expect(panel.className).toMatch(/\bright-0\b/);
    expect(panel.className).not.toMatch(/\bleft-0\b/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run fonts.test.ts src/components/AdminPanel.test.tsx --root packages/frontend`
Expected: FAIL. Both font cases fail (no `family=Rye`), and the align test fails (`left-0`, `align` unknown to TypeScript is fine at runtime).

- [ ] **Step 3: Load Rye**

In `packages/frontend/index.html` change the font URL to:

```html
      href="https://fonts.googleapis.com/css2?family=Vollkorn:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Special+Elite&family=Rye&display=swap"
```

In `packages/frontend/dev3d.html`:

```html
      href="https://fonts.googleapis.com/css2?family=Vollkorn:wght@400;600&family=Special+Elite&family=Rye&display=swap"
```

In `packages/frontend/tailwind.config.ts` replace the two comment lines above `display:` with:

```ts
        // Rye is fetched in index.html and dev3d.html (lobby spec L11): the HUD balances and the
        // closed sign use font-display. Georgia shows while it loads.
```

- [ ] **Step 4: Rewrite `packages/frontend/src/components/AdminEntry.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';
import { Button } from './Button';

// Saloon look (lobby spec L10): the trigger matches the table's settings chips.
const CHIP = 'rounded-md border border-wood-grain bg-surface px-2 py-1 font-utility text-xs text-parchment';

export function AdminEntry({ inline = false }: { inline?: boolean } = {}) {
  const { isAdmin, adminLogin, adminErrorMessage } = useSocket();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const pos = inline ? 'relative' : 'fixed right-2 top-2 z-50';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (passphrase.trim().length === 0) {
      return;
    }
    adminLogin(passphrase.trim());
    setPassphrase('');
  }

  if (isAdmin) {
    return <p className={`${pos} font-utility text-xs text-brass-bright`}>Admin</p>;
  }

  return (
    <div className={`${pos} font-utility text-sm text-parchment`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={CHIP}>
        Admin
      </button>
      {open && (
        <form
          onSubmit={handleSubmit}
          className={`${inline ? 'absolute left-0 top-full z-50 ' : ''}mt-1 flex flex-col gap-1 rounded-md border border-wood-grain bg-surface p-2`}
        >
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase"
            aria-label="Admin passphrase"
            className="rounded border border-wood-grain bg-bg px-2 py-1 text-xs text-parchment"
          />
          <Button type="submit" variant="primary" className="text-xs">
            Unlock
          </Button>
          {adminErrorMessage && <p className="text-xs text-ember-text">{adminErrorMessage}</p>}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Restyle `packages/frontend/src/components/AdminPanel.tsx`**

Add `import { Button } from './Button';` after the `GameMode` import, and change the signature to:

```tsx
// align 'right' opens the dropdown leftward from the trigger, for the off-table corner (TODO T-3).
export function AdminPanel({ align = 'left' }: { align?: 'left' | 'right' } = {}) {
```

Then apply these exact replacements (the left side appears verbatim in the file today):

| Old | New | Count |
|---|---|---|
| `<div className="relative text-sm text-white">` | `<div className="relative font-utility text-sm text-parchment">` | 1 |
| `className="rounded-md bg-slate-700 px-3 py-1.5 font-medium"` | `className="rounded-md border border-wood-grain bg-surface px-2 py-1 font-utility text-xs text-parchment"` | 1 |
| `<div className="absolute left-0 top-full z-50 mt-2 flex max-h-[calc(100vh-5rem)] w-64 flex-col gap-3 overflow-y-auto rounded-md border border-slate-600 bg-slate-800 p-3">` | ``<div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-50 mt-2 flex max-h-[calc(100vh-5rem)] w-64 flex-col gap-3 overflow-y-auto rounded-md border border-wood-grain bg-surface p-3`}>`` | 1 |
| `text-xs text-slate-400` | `text-xs text-fg-dim` | all |
| `rounded border border-slate-600 bg-slate-900 px-2 py-1` | `rounded border border-wood-grain bg-bg px-2 py-1 text-parchment` | all |
| `text-xs text-red-400` | `text-xs text-ember-text` | 1 |
| `text-xs text-emerald-300` | `text-xs text-win-bright` | 1 |

Every `<button ... className="rounded bg-emerald-600 px-2 py-1" ...>…</button>` (the "Switch to …" button and the six "Save …" / "Release name" submits) becomes `<Button variant="primary" ...>…</Button>`: keep every other attribute (`type`, `onClick`) and the children, drop the `className`, and change the closing tag. The amber "Act for …" button becomes `<Button type="button" variant="neutral" onClick={() => adminForceAct()}>`. The red "Remove from table" submit becomes `<Button type="submit" variant="danger">`.

- [ ] **Step 6: Right-align the off-table panel in `packages/frontend/src/App.tsx`**

Replace

```tsx
        <div className="fixed right-2 top-9 z-50 w-64">
          <AdminPanel />
        </div>
```

with

```tsx
        <div className="fixed right-2 top-9 z-50">
          <AdminPanel align="right" />
        </div>
```

- [ ] **Step 7: Check nothing off-theme is left, then run the tests**

Run: `grep -nE "slate|emerald|amber|red-[0-9]|text-white" packages/frontend/src/components/AdminPanel.tsx packages/frontend/src/components/AdminEntry.tsx`
Expected: no output.

Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck`
Expected: PASS (the existing `AdminEntry` / `AdminPanel` / `App` tests query by role and text, not class).

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/fonts.test.ts packages/frontend/index.html packages/frontend/dev3d.html packages/frontend/tailwind.config.ts packages/frontend/src/components/AdminEntry.tsx packages/frontend/src/components/AdminPanel.tsx packages/frontend/src/components/AdminPanel.test.tsx packages/frontend/src/App.tsx
git commit -m "feat(ui): saloon restyle for the admin controls; load Rye again; panel flush right off-table"
```

---

## Phase b: the door scene (static) → Gate 1

### Task 2: `smootherstep` and the door motion (pure)

**Files:**
- Modify: `packages/frontend/src/three/engine/tween.ts`
- Create: `packages/frontend/src/three/engine/tween.test.ts`
- Create: `packages/frontend/src/three/engine/doorMotion.ts`
- Create: `packages/frontend/src/three/engine/doorMotion.test.ts`

**Interfaces:**
- Produces: `smootherstep: Ease` in `tween.ts` (unclamped; callers clamp to [0, 1]). `doorMotion.ts`: `DOOR_OPEN_DEG = 75`, `DOOR_OPEN_S = 1.5`, `DOOR_FADE_S = 0.35`, `REDUCED_FADE_S = 0.3`, `CAMERA_START_Z = 3.2`, `CAMERA_END_Z = -0.6`, `interface DoorPose { angleDeg: number; cameraZ: number; opacity: number; done: boolean }`, `doorAngleDeg(t: number): number`, `doorCameraZ(t: number): number`, `doorPose(t: number, reducedMotion: boolean): DoorPose` (t in seconds since the opening began).

The door yaw is a damped batwing swing, `75·(1 − e^(−4t)·cos(2π·0.9·t))`. It overshoots once to about 83° at 0.56 s and is within 0.2° of 75° by 1.5 s. The camera dollies from z 3.2 to −0.6 on smootherstep. It crosses the door plane (z = 0) at about 1.06 s, when the doors are about 74° open, so it never clips a leaf. The door canvas fades out over the last 0.35 s. Reduced motion: doors stay shut, camera still, 0.3 s fade.

- [ ] **Step 1: Write the failing tests**

`packages/frontend/src/three/engine/tween.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { smootherstep } from './tween';

describe('smootherstep', () => {
  it('runs 0 → 1 through exactly 0.5 at the midpoint', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBe(0.5);
  });

  it('is monotonic and flat at both ends', () => {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const v = smootherstep(i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(smootherstep(0.001) / 0.001).toBeLessThan(0.001);
    expect((1 - smootherstep(0.999)) / 0.001).toBeLessThan(0.001);
  });
});
```

`packages/frontend/src/three/engine/doorMotion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CAMERA_END_Z,
  CAMERA_START_Z,
  DOOR_OPEN_DEG,
  DOOR_OPEN_S,
  REDUCED_FADE_S,
  doorAngleDeg,
  doorCameraZ,
  doorPose,
} from './doorMotion';

describe('door motion (lobby spec L6)', () => {
  it('opens from shut to within 1° of 75° in 1.5 s', () => {
    expect(DOOR_OPEN_DEG).toBe(75);
    expect(DOOR_OPEN_S).toBe(1.5);
    expect(doorAngleDeg(0)).toBe(0);
    expect(Math.abs(doorAngleDeg(DOOR_OPEN_S) - 75)).toBeLessThan(1);
  });

  it('overshoots like a batwing, but only once and by under 11°', () => {
    let peak = 0;
    for (let t = 0; t <= DOOR_OPEN_S; t += 1 / 240) peak = Math.max(peak, doorAngleDeg(t));
    expect(peak).toBeGreaterThan(78);
    expect(peak).toBeLessThan(86);
  });

  it('dollies the camera forward monotonically from 3.2 to -0.6', () => {
    expect(doorCameraZ(0)).toBe(CAMERA_START_Z);
    expect(doorCameraZ(DOOR_OPEN_S)).toBe(CAMERA_END_Z);
    let prev = Infinity;
    for (let t = 0; t <= DOOR_OPEN_S; t += 1 / 240) {
      const z = doorCameraZ(t);
      expect(z).toBeLessThanOrEqual(prev);
      prev = z;
    }
  });

  it('has the doors at least 60° open when the camera crosses the door plane', () => {
    let t = 0;
    while (doorCameraZ(t) > 0) t += 1 / 240;
    expect(t).toBeLessThan(DOOR_OPEN_S);
    expect(doorAngleDeg(t)).toBeGreaterThanOrEqual(60);
  });

  it('fades the door canvas out over the last 0.35 s and then reports done', () => {
    expect(doorPose(1.0, false).opacity).toBe(1);
    expect(doorPose(1.3, false).opacity).toBeGreaterThan(0);
    expect(doorPose(1.3, false).opacity).toBeLessThan(1);
    expect(doorPose(DOOR_OPEN_S, false).opacity).toBe(0);
    expect(doorPose(1.49, false).done).toBe(false);
    expect(doorPose(DOOR_OPEN_S, false).done).toBe(true);
  });

  it('keeps the doors shut and the camera still under reduced motion, fading in 0.3 s (L9)', () => {
    expect(REDUCED_FADE_S).toBe(0.3);
    const mid = doorPose(0.15, true);
    expect(mid.angleDeg).toBe(0);
    expect(mid.cameraZ).toBe(CAMERA_START_Z);
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(doorPose(0.29, true).done).toBe(false);
    expect(doorPose(REDUCED_FADE_S, true).done).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/three/engine/tween.test.ts src/three/engine/doorMotion.test.ts --root packages/frontend`
Expected: FAIL: `smootherstep` is not exported; `./doorMotion` cannot be resolved.

- [ ] **Step 3: Add `smootherstep` to `packages/frontend/src/three/engine/tween.ts`** (after `easeOutBack`)

```ts
// Quintic smootherstep: zero velocity and acceleration at both ends, exactly 0.5 at t = 0.5.
// Unclamped; callers clamp t to [0, 1]. Used by the door dolly and the table-switch swing (lobby spec L7).
export const smootherstep: Ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);
```

- [ ] **Step 4: Create `packages/frontend/src/three/engine/doorMotion.ts`**

```ts
import { smootherstep } from './tween';

// Door-entry timing (lobby spec L6, §3.1). Pure so it can be unit-tested; DoorScene applies it.
// Values are first passes, settled at render gate 2.
export const DOOR_OPEN_DEG = 75;
export const DOOR_OPEN_S = 1.5;
export const DOOR_FADE_S = 0.35;
// prefers-reduced-motion: no swing or dolly, just a fade (spec L9).
export const REDUCED_FADE_S = 0.3;
export const CAMERA_START_Z = 3.2;
export const CAMERA_END_Z = -0.6;
// A damped oscillation: batwing doors overshoot once (~83° at 0.56 s) and settle at 75°.
const SWING_DAMPING = 4;
const SWING_HZ = 0.9;

export interface DoorPose {
  angleDeg: number;
  cameraZ: number;
  opacity: number;
  done: boolean;
}

export function doorAngleDeg(t: number): number {
  if (t <= 0) return 0;
  return DOOR_OPEN_DEG * (1 - Math.exp(-SWING_DAMPING * t) * Math.cos(2 * Math.PI * SWING_HZ * t));
}

export function doorCameraZ(t: number): number {
  const x = Math.min(1, Math.max(0, t / DOOR_OPEN_S));
  return CAMERA_START_Z + (CAMERA_END_Z - CAMERA_START_Z) * smootherstep(x);
}

function fadeOut(t: number, start: number, end: number): number {
  if (t <= start) return 1;
  if (t >= end) return 0;
  return 1 - (t - start) / (end - start);
}

export function doorPose(t: number, reducedMotion: boolean): DoorPose {
  if (reducedMotion) {
    return {
      angleDeg: 0,
      cameraZ: CAMERA_START_Z,
      opacity: fadeOut(t, 0, REDUCED_FADE_S),
      done: t >= REDUCED_FADE_S,
    };
  }
  return {
    angleDeg: doorAngleDeg(Math.min(t, DOOR_OPEN_S)),
    cameraZ: doorCameraZ(t),
    opacity: fadeOut(t, DOOR_OPEN_S - DOOR_FADE_S, DOOR_OPEN_S),
    done: t >= DOOR_OPEN_S,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/three/engine/tween.test.ts src/three/engine/doorMotion.test.ts --root packages/frontend`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/three/engine/tween.ts packages/frontend/src/three/engine/tween.test.ts packages/frontend/src/three/engine/doorMotion.ts packages/frontend/src/three/engine/doorMotion.test.ts
git commit -m "feat(doors): smootherstep and the pure door-opening motion"
```

---

### Task 3: Door geometry, shared grade pass and `DoorScene`

**Files:**
- Create: `packages/frontend/src/three/engine/doorSet.ts`
- Create: `packages/frontend/src/three/engine/doorSet.test.ts`
- Create: `packages/frontend/src/three/engine/grade.ts`
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts` (delete `GradeShader`, import it)
- Create: `packages/frontend/src/three/engine/doorScene.ts`

**Interfaces:**
- Consumes: `doorPose`, `CAMERA_START_Z` (Task 2); `woodTexture`, `plankTexture`, `softDotTexture` from `textures.ts`; `type Quality` from `SceneRoot.ts`.
- Produces:
  - `doorSet.ts`: `interface DoorTextures { wood: THREE.Texture; plank: THREE.Texture; floor: THREE.Texture }`, `class DoorSet { readonly group: THREE.Group; readonly left: THREE.Group; readonly right: THREE.Group; constructor(tex: DoorTextures); setOpen(deg: number): void; dispose(): void }`. Each hinge group's only child is its leaf mesh. `dispose()` frees its geometries and materials, not the injected textures.
  - `grade.ts`: `GradeShader` (same object `SceneRoot` used).
  - `doorScene.ts`: `type DoorState = 'closed' | 'ledger'`, `class DoorScene { paused: boolean; onFirstFrame: (() => void) | null; constructor(opts: { canvas: HTMLCanvasElement; quality: Quality }); setSize(w: number, h: number): void; setState(s: DoorState): void; open(onHandedOff: () => void, opts: { reducedMotion: boolean }): void; advance(seconds: number): void; dispose(): void }`. `open()` puts the scene in its opening state (the spec's `setState('opening')`), sets the canvas's CSS opacity from `doorPose` every frame and calls `onHandedOff` once when the pose is done.

`DoorSet` takes its textures as arguments, so it builds in jsdom (the canvas textures need a 2D context jsdom lacks). `DoorScene` needs WebGL and has no unit test.

- [ ] **Step 1: Write the failing test** — `packages/frontend/src/three/engine/doorSet.test.ts`:

```ts
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DoorSet } from './doorSet';

const textures = () => ({ wood: new THREE.Texture(), plank: new THREE.Texture(), floor: new THREE.Texture() });

function leafWorldZ(pivot: THREE.Group): number {
  pivot.updateWorldMatrix(true, true);
  return pivot.children[0].getWorldPosition(new THREE.Vector3()).z;
}

describe('DoorSet', () => {
  it('starts shut, with both leaves in the door plane', () => {
    const doors = new DoorSet(textures());
    expect(Math.abs(leafWorldZ(doors.left))).toBeLessThan(1e-6);
    expect(Math.abs(leafWorldZ(doors.right))).toBeLessThan(1e-6);
  });

  it('swings both leaves inward, away from the camera on +z (lobby spec §3.1)', () => {
    const doors = new DoorSet(textures());
    doors.setOpen(75);
    expect(doors.left.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(75));
    expect(doors.right.rotation.y).toBeCloseTo(-THREE.MathUtils.degToRad(75));
    expect(leafWorldZ(doors.left)).toBeLessThan(-0.2);
    expect(leafWorldZ(doors.right)).toBeLessThan(-0.2);
  });

  it('disposes every geometry and material it made, but not the textures it was given', () => {
    const tex = textures();
    const doors = new DoorSet(tex);
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    doors.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        spies.push(vi.spyOn(o.geometry, 'dispose'));
        spies.push(vi.spyOn(o.material as THREE.Material, 'dispose'));
      }
    });
    const texSpy = vi.spyOn(tex.wood, 'dispose');
    expect(spies.length).toBeGreaterThan(10);
    doors.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(texSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/three/engine/doorSet.test.ts --root packages/frontend`
Expected: FAIL, cannot resolve `./doorSet`.

- [ ] **Step 3: Create `packages/frontend/src/three/engine/doorSet.ts`**

```ts
import * as THREE from 'three';

// The saloon entrance (lobby spec §3.1): boardwalk, facade, door frame, a warm back wall inside, and
// two batwing leaves hinged at their outer edges. Textures are injected so this builds without a
// 2D canvas (unit tests) and so DoorScene owns and frees them. First-pass sizes, settled at gate 1.
export const DOORWAY_HALF = 0.55; // a 1.1 m doorway
const LEAF_W = DOORWAY_HALF - 0.01; // a 2 cm gap between the shut leaves lets the light through
const LEAF_H = 1.05;
const LEAF_BOTTOM = 0.45;
const POST_X = 0.62;
const POST_H = 2.5;

export interface DoorTextures {
  wood: THREE.Texture;
  plank: THREE.Texture;
  floor: THREE.Texture;
}

export class DoorSet {
  readonly group = new THREE.Group();
  readonly left = new THREE.Group();
  readonly right = new THREE.Group();
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor(tex: DoorTextures) {
    const wood = this.mat(new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.7 }));
    const facade = this.mat(new THREE.MeshStandardMaterial({ map: tex.plank, roughness: 0.95, color: 0x9c8a72 }));
    const boards = this.mat(new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.85 }));
    // The back bar wall glows faintly on its own so the interior reads as lit even off the beam.
    const glow = this.mat(
      new THREE.MeshStandardMaterial({ map: tex.plank, color: 0x3a2412, emissive: 0xffa552, emissiveIntensity: 0.4, roughness: 1 }),
    );

    // One floor plane runs from the boardwalk through the doorway into the saloon.
    const walk = this.mesh(new THREE.PlaneGeometry(9, 8), boards);
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(0, 0, 0.5);
    walk.receiveShadow = true;

    // Facade either side of and above the doorway, just behind the frame.
    for (const side of [-1, 1]) {
      const wall = this.mesh(new THREE.PlaneGeometry(3.5, 3.4), facade);
      wall.position.set(side * (POST_X + 0.05 + 1.75), 1.7, -0.02);
      wall.receiveShadow = true;
    }
    const header = this.mesh(new THREE.PlaneGeometry(2 * POST_X + 0.1, 0.9), facade);
    header.position.set(0, POST_H + 0.45, -0.02);

    for (const side of [-1, 1]) {
      const post = this.mesh(new THREE.BoxGeometry(0.1, POST_H, 0.14), wood);
      post.position.set(side * POST_X, POST_H / 2, 0);
      post.castShadow = true;
    }
    const lintel = this.mesh(new THREE.BoxGeometry(2 * POST_X + 0.1, 0.12, 0.14), wood);
    lintel.position.set(0, POST_H, 0);

    const back = this.mesh(new THREE.PlaneGeometry(5, 3.4), glow);
    back.position.set(0, 1.7, -3);

    // Leaves: each hinge group sits at a doorway edge; its leaf extends toward the centre.
    for (const [pivot, side] of [
      [this.left, -1],
      [this.right, 1],
    ] as const) {
      pivot.position.set(side * DOORWAY_HALF, 0, 0);
      const leaf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(LEAF_W, LEAF_H, 0.035)), wood);
      leaf.position.set((-side * LEAF_W) / 2, LEAF_BOTTOM + LEAF_H / 2, 0);
      leaf.castShadow = true;
      pivot.add(leaf);
      this.group.add(pivot);
    }
  }

  // Inward = away from the camera (+z): the left leaf turns +deg about Y, the right leaf -deg.
  setOpen(deg: number): void {
    const r = THREE.MathUtils.degToRad(deg);
    this.left.rotation.y = r;
    this.right.rotation.y = -r;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(g), m);
    this.group.add(mesh);
    return mesh;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/three/engine/doorSet.test.ts --root packages/frontend`
Expected: PASS (3 tests).

- [ ] **Step 5: Move `GradeShader` to `packages/frontend/src/three/engine/grade.ts`**

Cut the `// Warm, slightly crushed film look…` comment and the whole `const GradeShader = { … };` block from `SceneRoot.ts` into the new file, unchanged except for the export and the type import:

```ts
import type * as THREE from 'three';

// Warm, slightly crushed film look, applied after tone mapping. Shared by the table (SceneRoot) and
// the saloon doors (DoorScene), so the two scenes hand over without a change in grain or vignette
// (lobby spec L1).
export const GradeShader = {
  // …the uniforms, vertexShader and fragmentShader exactly as they were in SceneRoot.ts…
};
```

In `SceneRoot.ts` add `import { GradeShader } from './grade';` with the other local imports.

- [ ] **Step 6: Create `packages/frontend/src/three/engine/doorScene.ts`**

```ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Quality } from './SceneRoot';
import { GradeShader } from './grade';
import { DoorSet } from './doorSet';
import { CAMERA_START_Z, doorPose } from './doorMotion';
import { plankTexture, rng, softDotTexture, woodTexture } from './textures';

export type DoorState = 'closed' | 'ledger';

// Camera framing (first pass, settled at gate 1): eye height, looking slightly down at the doors.
const CAMERA_Y = 1.55;
const LOOK_Y = 1.3;
const LOOK_AHEAD = CAMERA_START_Z; // the look target starts at the door plane and travels with the camera
// The ledger dims the scene a little so the parchment overlay reads (lobby spec §3.2).
const EXPOSURE: Record<DoorState, number> = { closed: 1.05, ledger: 0.85 };
const DUST_COUNT = 140;

interface Opening {
  t: number;
  reducedMotion: boolean;
  onHandedOff: () => void;
  handed: boolean;
}

// The saloon doors at night (lobby spec L1, L2, §3.1): its own small scene and WebGL context, alive
// only while the doors are on screen. Same tone mapping and grade pass as the table.
export class DoorScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 30);
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private doors: DoorSet;
  private textures: THREE.Texture[];
  private dust: THREE.Points;
  private spill: THREE.SpotLight;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private lastTs = 0;
  private time = 0;
  private width = 1;
  private height = 1;
  private drawn = false;
  private disposed = false;
  private opening: Opening | null = null;
  // Capture aid (render gates): stops the rAF loop advancing time, so only advance() moves it.
  paused = false;
  onFirstFrame: (() => void) | null = null;

  constructor({ canvas, quality }: { canvas: HTMLCanvasElement; quality: Quality }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE.closed;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.FogExp2(0x070a12, 0.06);

    const wood = woodTexture('#4a2f1c', 7, [1, 1]);
    const plank = plankTexture(11);
    const floor = plankTexture(23, '#2a1a0e');
    floor.repeat.set(4, 2);
    const dot = softDotTexture('rgba(255,235,200,1)');
    this.textures = [wood, plank, floor, dot];
    this.doors = new DoorSet({ wood, plank, floor });
    this.scene.add(this.doors.group);

    // Night outside: a dim cold hemisphere and moonlight from above-left (matches room.ts's moon).
    this.scene.add(new THREE.HemisphereLight(0x1a2233, 0x050403, 0.35));
    const moon = new THREE.DirectionalLight(0x6f8fbe, 0.6);
    moon.position.set(-4, 5, 3);
    this.scene.add(moon);
    // Lamplight inside, and a spot that spills through the doorway onto the boardwalk.
    const inside = new THREE.PointLight(0xffa552, 6, 6, 1.6);
    inside.position.set(0, 1.6, -1.8);
    this.scene.add(inside);
    this.spill = new THREE.SpotLight(0xffb066, 30, 9, Math.PI / 7, 0.6, 1.4);
    this.spill.position.set(0, 2.2, -2.2);
    this.spill.target.position.set(0, 0, 1.6);
    this.spill.castShadow = true;
    this.spill.shadow.mapSize.set(1024, 1024);
    this.spill.shadow.bias = -0.0004;
    this.scene.add(this.spill, this.spill.target);

    // Dust drifting in the beam.
    const r = rng(5);
    const pos = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      pos[i * 3] = (r() - 0.5) * 0.9;
      pos[i * 3 + 1] = 0.2 + r() * 1.9;
      pos[i * 3 + 2] = -1.5 + r() * 3;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        map: dot,
        size: 0.02,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.dust);

    this.setupQuality(quality);
    this.placeCamera(CAMERA_START_Z);
    this.raf = requestAnimationFrame(this.loop);
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
  }

  setState(s: DoorState): void {
    this.renderer.toneMappingExposure = EXPOSURE[s];
  }

  // Plays the opening once; later calls are ignored.
  open(onHandedOff: () => void, { reducedMotion }: { reducedMotion: boolean }): void {
    if (this.opening) return;
    this.opening = { t: 0, reducedMotion, onHandedOff, handed: false };
  }

  // Dev/test aid, as SceneRoot.advance: step the simulation without rAF, then draw one frame.
  advance(seconds: number): void {
    const step = 1 / 30;
    for (let t = 0; t < seconds; t += step) this.tick(step, false);
    this.tick(0, true);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.composer?.dispose();
    this.doors.dispose();
    this.dust.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    for (const t of this.textures) t.dispose();
    this.spill.shadow.map?.dispose();
    // No forceContextLoss(), for the same StrictMode reason as SceneRoot.dispose.
    this.renderer.dispose();
  }

  private setupQuality(q: Quality): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(dpr, q === 'high' ? 2 : 1.5));
    this.renderer.shadowMap.enabled = q !== 'low';
    if (q === 'low') return;
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q === 'high') {
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.45, 0.6, 0.9));
    }
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    this.composer = composer;
  }

  private placeCamera(z: number): void {
    this.camera.position.set(0, CAMERA_Y, z);
    this.camera.lookAt(0, LOOK_Y, z - LOOK_AHEAD);
  }

  private loop = (ts: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;
    if (!this.paused) this.tick(dt, true);
  };

  private tick(dt: number, draw: boolean): void {
    this.time += dt;
    const o = this.opening;
    if (o) {
      o.t += dt;
      const pose = doorPose(o.t, o.reducedMotion);
      this.doors.setOpen(pose.angleDeg);
      this.placeCamera(pose.cameraZ);
      this.canvas.style.opacity = String(pose.opacity);
      if (pose.done && !o.handed) {
        o.handed = true;
        o.onHandedOff();
      }
    }
    this.dust.position.y = Math.sin(this.time * 0.3) * 0.03;

    if (!draw) return;
    if (this.grade) this.grade.uniforms.time.value = this.time;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    // All textures are synchronous canvas textures, so the first drawn frame is a complete one.
    if (!this.drawn) {
      this.drawn = true;
      this.onFirstFrame?.();
    }
  }
}
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck`
Expected: PASS. (`grade.ts` is checked by typecheck; the table look is unchanged because the shader object is the same.)

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/three/engine/doorSet.ts packages/frontend/src/three/engine/doorSet.test.ts packages/frontend/src/three/engine/grade.ts packages/frontend/src/three/engine/SceneRoot.ts packages/frontend/src/three/engine/doorScene.ts
git commit -m "feat(doors): door geometry and the DoorScene; share the grade pass with the table"
```

---

### Task 4: `DoorStage` and the `?game=doors` harness

**Files:**
- Create: `packages/frontend/src/three/DoorStage.tsx`
- Create: `packages/frontend/src/three/DoorStage.test.tsx`
- Modify: `packages/frontend/src/three/devHarness.tsx`
- Modify: `packages/frontend/dev3d.html` (comment only)

**Interfaces:**
- Consumes: `DoorScene`, `DoorState` (Task 3).
- Produces: `interface DoorStageProps { state: DoorState; open: boolean; reducedMotion: boolean; onReady: () => void; onHandedOff: () => void; onUnsupported: () => void }`; `DoorStage` is both a named and the default export (the default is what `lazy()` loads). In DEV it sets `window.__doors` to the live `DoorScene`. Harness: `/dev3d.html?game=doors&state=closed|ledger`, plus `&table=1&step=N&bar=0` to mount the Blackjack table underneath (gate 2).

- [ ] **Step 1: Write the failing test** — `packages/frontend/src/three/DoorStage.test.tsx`:

```tsx
import { act, render } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL: a recorder stands in for the scene, so the React shell is what's under test.
interface FakeDoors {
  setState: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onFirstFrame: (() => void) | null;
}
const created: FakeDoors[] = [];
let shouldThrow = false;

vi.mock('./engine/doorScene', () => ({
  DoorScene: class {
    setState = vi.fn();
    setSize = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    onFirstFrame = null;
    constructor() {
      if (shouldThrow) throw new Error('no webgl');
      created.push(this as unknown as FakeDoors);
    }
  },
}));

import { DoorStage, type DoorStageProps } from './DoorStage';

function props(over: Partial<DoorStageProps> = {}): DoorStageProps {
  return {
    state: 'closed',
    open: false,
    reducedMotion: false,
    onReady: vi.fn(),
    onHandedOff: vi.fn(),
    onUnsupported: vi.fn(),
    ...over,
  };
}

beforeAll(() => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  created.length = 0;
  shouldThrow = false;
});

describe('DoorStage', () => {
  it('creates one scene and gives it the current state', () => {
    render(<DoorStage {...props({ state: 'ledger' })} />);
    expect(created).toHaveLength(1);
    expect(created[0].setState).toHaveBeenCalledWith('ledger');
  });

  it('passes state changes on to the scene', () => {
    const { rerender } = render(<DoorStage {...props()} />);
    rerender(<DoorStage {...props({ state: 'ledger' })} />);
    expect(created[0].setState).toHaveBeenLastCalledWith('ledger');
  });

  it('reports ready when the scene draws its first frame', () => {
    const p = props();
    render(<DoorStage {...p} />);
    expect(p.onReady).not.toHaveBeenCalled();
    act(() => created[0].onFirstFrame?.());
    expect(p.onReady).toHaveBeenCalledTimes(1);
  });

  it('opens the doors when asked and reports the hand-off', () => {
    const p = props({ reducedMotion: true });
    const { rerender } = render(<DoorStage {...p} />);
    expect(created[0].open).not.toHaveBeenCalled();
    rerender(<DoorStage {...p} open />);
    expect(created[0].open).toHaveBeenCalledWith(expect.any(Function), { reducedMotion: true });
    act(() => (created[0].open.mock.calls[0][0] as () => void)());
    expect(p.onHandedOff).toHaveBeenCalledTimes(1);
  });

  it('disposes the scene on unmount', () => {
    const { unmount } = render(<DoorStage {...props()} />);
    unmount();
    expect(created[0].dispose).toHaveBeenCalled();
  });

  it('reports unsupported when WebGL cannot start', () => {
    shouldThrow = true;
    const p = props();
    render(<DoorStage {...p} />);
    expect(p.onUnsupported).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/three/DoorStage.test.tsx --root packages/frontend`
Expected: FAIL, cannot resolve `./DoorStage`.

- [ ] **Step 3: Create `packages/frontend/src/three/DoorStage.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { DoorScene, type DoorState } from './engine/doorScene';
import type { Quality } from './engine/SceneRoot';

// React shell for the saloon doors (lobby spec §3.1). Its own lazy chunk; the overlays live in
// EntranceScreen so the plain fallback screen shares them.

export interface DoorStageProps {
  state: DoorState;
  open: boolean;
  reducedMotion: boolean;
  onReady: () => void;
  onHandedOff: () => void;
  onUnsupported: () => void;
}

// Same stored preference the table uses (TableStage's bj3d.quality).
function readQuality(): Quality {
  try {
    const v = window.localStorage.getItem('bj3d.quality');
    return v === 'low' || v === 'high' ? v : 'medium';
  } catch {
    return 'medium';
  }
}

export function DoorStage({ state, open, reducedMotion, onReady, onHandedOff, onUnsupported }: DoorStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DoorScene | null>(null);
  const cb = useRef({ onReady, onHandedOff, onUnsupported });
  cb.current = { onReady, onHandedOff, onUnsupported };
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let scene: DoorScene;
    try {
      scene = new DoorScene({ canvas, quality: readQuality() });
    } catch {
      cb.current.onUnsupported();
      return;
    }
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __doors?: DoorScene }).__doors = scene;
    scene.setState(stateRef.current);
    scene.onFirstFrame = () => cb.current.onReady();
    const resize = () => scene.setSize(wrap.clientWidth, wrap.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (open) sceneRef.current?.open(() => cb.current.onHandedOff(), { reducedMotion });
  }, [open, reducedMotion]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
}

export default DoorStage;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/three/DoorStage.test.tsx --root packages/frontend`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the door harness to `packages/frontend/src/three/devHarness.tsx`**

Add `import { DoorStage } from './DoorStage';` with the other imports. Add this component above the `// ?layout=flat` comment:

```tsx
// ?game=doors&state=closed|ledger shows the saloon doors (lobby spec gate 1). &table=1 mounts the
// Blackjack table underneath (with &step=N, &bar=0) so gate 2 can capture the hand-off; the
// opening is started from the console with window.__doors.open(...).
function DoorHarness() {
  const params = new URLSearchParams(location.search);
  const state = params.get('state') === 'ledger' ? 'ledger' : 'closed';
  return (
    <>
      {params.get('table') === '1' && <Harness />}
      <div className="fixed inset-0 z-[60]">
        <DoorStage
          state={state}
          open={false}
          reducedMotion={false}
          onReady={() => undefined}
          onHandedOff={() => undefined}
          onUnsupported={() => console.error('doors: WebGL unavailable')}
        />
      </div>
    </>
  );
}
```

Replace the render call's body line with:

```tsx
    {(() => {
      const game = new URLSearchParams(location.search).get('game');
      if (game === 'poker') return <PokerHarness />;
      if (game === 'doors') return <DoorHarness />;
      return <Harness />;
    })()}
```

Update the comment at the top of `dev3d.html` to: `Dev-only harness for the 3D scenes: Blackjack by default, Hold'em with ?game=poker, the saloon doors with ?game=doors (see src/three/devHarness.tsx). Not built for production.`

- [ ] **Step 6: Typecheck, suite, and a smoke look**

Run: `npm run typecheck` and `npm test --workspace=@poker-blackjack/frontend`
Expected: PASS.

The controller checks for console errors, but not from the main thread (user rule: never drive the browser from the main thread). That check is part of the Gate 1 subagent's brief below.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/three/DoorStage.tsx packages/frontend/src/three/DoorStage.test.tsx packages/frontend/src/three/devHarness.tsx packages/frontend/dev3d.html
git commit -m "feat(doors): DoorStage shell and the ?game=doors harness"
```

---

### Gate 1: the door look (controller + render subagent; the user approves)

Spec §6 gate 1, after phase b. Not an implementer task.

- [ ] **Step 1: Dispatch the render subagent** (model: sonnet) with this brief:

  > Render Gate 1 stills of the saloon doors. Do not edit repo files.
  > 1. Start the save server in the background: `node scripts/render/save-server.cjs .playtest-data/lobby-gates/gate1` (port 3199).
  > 2. Start the dev server with the in-app browser's `preview_start` `{ name: "frontend" }` (Vite on 5173). Set the viewport with `resize_window` to 1280×720.
  > 3. For each shot, navigate to the URL, wait 4.5 s, then run in the page:
  >    ```js
  >    const s = window.__doors; s.paused = true; s.advance(0.5);
  >    const src = s.renderer.domElement; const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  >    c.getContext('2d').drawImage(src, 0, 0);
  >    const r = await fetch('http://127.0.0.1:3199/save?name=NAME.png', { method: 'POST', body: c.toDataURL('image/png') }); await r.text();
  >    ```
  >    Shots: `doors-closed` (`/dev3d.html?game=doors&state=closed`), `doors-ledger` (`…&state=ledger`), `doors-closed-high` (`…&state=closed&quality=high`), `doors-closed-low` (`…&state=closed&quality=low`). Reload between shots.
  > 4. Record any console errors per shot (`read_console_messages`).
  > 5. Write `.playtest-data/lobby-gates/gate1/findings.md`. For each shot, say whether these read clearly: the doorway and both batwing leaves; warm light from inside against a cold, moonlit outside; the light beam and dust through the gap and over and under the leaves; the boardwalk. Also note any hard banding in the dark gradients, anything clipped by the frame, and the console errors. Return a 10-line summary; no image data in your reply.

- [ ] **Step 2: Show the user** the four PNGs (`SendUserFile`, `display: render`) and the findings summary. Ask for approval of the look (L2).
- [ ] **Step 3: If the user asks for changes,** turn them into a follow-up task on the constants in `doorSet.ts` / `doorScene.ts` (sizes, light colours and intensities, exposure, fog, camera framing), re-render the affected shots, and record the settled values under "Deviations" below. Do not start phase c until the user approves.

---

## Phase c: overlays, entry hand-off, fallbacks → Gate 2

### Task 5: The entry reducer (`doorFlow`, pure)

**Files:**
- Create: `packages/frontend/src/entrance/doorFlow.ts`
- Create: `packages/frontend/src/entrance/doorFlow.test.ts`

**Interfaces:**
- Consumes: `type ConnectionStatus` from `../socket/SocketContext`.
- Produces: `type DoorPhase = 'closed' | 'ledger' | 'waiting-table' | 'opening' | 'gone'`, `interface DoorFlowState { phase: DoorPhase; crossfade: boolean; since: number }`, `type DoorFlowEvent = { type: 'status'; status: ConnectionStatus; now: number } | { type: 'table-ready' } | { type: 'tick'; now: number } | { type: 'handed-off' }`, `TABLE_READY_TIMEOUT_MS = 8000`, `initialDoorFlow: DoorFlowState`, `doorFlowReducer(s: DoorFlowState, e: DoorFlowEvent): DoorFlowState`.

Rules: `lobby` → `closed` and `entering-name` → `ledger`, from any phase. `at-table` from `closed` / `ledger` → `waiting-table` (stamping `since`); from any other phase it changes nothing, which covers an admin mode switch, where the status stays `at-table`. `table-ready`: `waiting-table` → `opening`. `tick` past 8 s in `waiting-table` → `opening` with `crossfade`. `handed-off`: `opening` → `gone`. The initial phase is `closed`, so a reload that auto-rejoins still plays the doors (L6). Unchanged inputs return the same object (no re-render).

- [ ] **Step 1: Write the failing test** — `packages/frontend/src/entrance/doorFlow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ConnectionStatus } from '../socket/SocketContext';
import { TABLE_READY_TIMEOUT_MS, doorFlowReducer, initialDoorFlow, type DoorFlowEvent, type DoorFlowState } from './doorFlow';

const run = (s: DoorFlowState, ...events: DoorFlowEvent[]) => events.reduce(doorFlowReducer, s);
const status = (st: ConnectionStatus, now = 0): DoorFlowEvent => ({ type: 'status', status: st, now });

describe('doorFlowReducer (lobby spec §3.3, §4)', () => {
  it('starts closed, so a reload with auto-rejoin still plays the doors (L6)', () => {
    expect(initialDoorFlow).toEqual({ phase: 'closed', crossfade: false, since: 0 });
    expect(run(initialDoorFlow, status('connecting'), status('at-table', 100)).phase).toBe('waiting-table');
  });

  it('shows the closed sign in the lobby and the ledger when a name is needed, from any phase', () => {
    expect(run(initialDoorFlow, status('entering-name')).phase).toBe('ledger');
    const gone: DoorFlowState = { phase: 'gone', crossfade: false, since: 0 };
    expect(run(gone, status('entering-name')).phase).toBe('ledger');
    expect(run(gone, status('lobby')).phase).toBe('closed');
  });

  it('waits for the table once seated, stamping the time', () => {
    const s = run(initialDoorFlow, status('entering-name'), status('at-table', 500));
    expect(s).toEqual({ phase: 'waiting-table', crossfade: false, since: 500 });
  });

  it('ignores at-table once past the doors (an admin mode switch keeps the status at-table)', () => {
    const gone: DoorFlowState = { phase: 'gone', crossfade: false, since: 0 };
    expect(run(gone, status('at-table', 9))).toBe(gone);
    const opening: DoorFlowState = { phase: 'opening', crossfade: false, since: 0 };
    expect(run(opening, status('at-table', 9))).toBe(opening);
  });

  it('ignores reconnecting and other statuses', () => {
    const waiting: DoorFlowState = { phase: 'waiting-table', crossfade: false, since: 5 };
    expect(run(waiting, status('reconnecting'))).toBe(waiting);
    expect(run(waiting, status('replaced'))).toBe(waiting);
  });

  it('opens when the table reports ready, and only from waiting-table', () => {
    const waiting: DoorFlowState = { phase: 'waiting-table', crossfade: false, since: 5 };
    expect(run(waiting, { type: 'table-ready' })).toEqual({ phase: 'opening', crossfade: false, since: 5 });
    expect(run(initialDoorFlow, { type: 'table-ready' })).toBe(initialDoorFlow);
  });

  it('hands over with a crossfade if the table is not ready within 8 s (§4)', () => {
    expect(TABLE_READY_TIMEOUT_MS).toBe(8000);
    const waiting: DoorFlowState = { phase: 'waiting-table', crossfade: false, since: 1000 };
    expect(run(waiting, { type: 'tick', now: 8999 })).toBe(waiting);
    expect(run(waiting, { type: 'tick', now: 9000 })).toEqual({ phase: 'opening', crossfade: true, since: 1000 });
  });

  it('is gone after the hand-off, and only from opening', () => {
    const opening: DoorFlowState = { phase: 'opening', crossfade: false, since: 0 };
    expect(run(opening, { type: 'handed-off' }).phase).toBe('gone');
    const waiting: DoorFlowState = { phase: 'waiting-table', crossfade: false, since: 0 };
    expect(run(waiting, { type: 'handed-off' })).toBe(waiting);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/entrance/doorFlow.test.ts --root packages/frontend`
Expected: FAIL, cannot resolve `./doorFlow`.

- [ ] **Step 3: Create `packages/frontend/src/entrance/doorFlow.ts`**

```ts
import type { ConnectionStatus } from '../socket/SocketContext';

// Doors → table (lobby spec §3.3, §4). Pure; App feeds it the connection status, the table's
// first-frame signal, a clock tick and the doors' hand-off.
export type DoorPhase = 'closed' | 'ledger' | 'waiting-table' | 'opening' | 'gone';

export interface DoorFlowState {
  phase: DoorPhase;
  // True when the hand-off was forced by the timeout: crossfade instead of the door animation.
  crossfade: boolean;
  since: number;
}

export type DoorFlowEvent =
  | { type: 'status'; status: ConnectionStatus; now: number }
  | { type: 'table-ready' }
  | { type: 'tick'; now: number }
  | { type: 'handed-off' };

// A slow GPU must never trap a player behind closed doors (§4).
export const TABLE_READY_TIMEOUT_MS = 8000;

// Closed, not gone: a reload that auto-rejoins goes closed → waiting-table, so the doors play (L6).
export const initialDoorFlow: DoorFlowState = { phase: 'closed', crossfade: false, since: 0 };

export function doorFlowReducer(s: DoorFlowState, e: DoorFlowEvent): DoorFlowState {
  switch (e.type) {
    case 'status':
      if (e.status === 'lobby') return s.phase === 'closed' ? s : { phase: 'closed', crossfade: false, since: e.now };
      if (e.status === 'entering-name') return s.phase === 'ledger' ? s : { phase: 'ledger', crossfade: false, since: e.now };
      // Only an entry from the doors waits for the table. An admin mode switch keeps the status
      // at-table throughout (SocketContext's auto-rejoin never calls setStatus), so it lands here
      // in 'gone' and changes nothing; the switch itself is keyed on the mode (spec §2).
      if (e.status === 'at-table' && (s.phase === 'closed' || s.phase === 'ledger')) {
        return { phase: 'waiting-table', crossfade: false, since: e.now };
      }
      return s;
    case 'table-ready':
      return s.phase === 'waiting-table' ? { ...s, phase: 'opening' } : s;
    case 'tick':
      return s.phase === 'waiting-table' && e.now - s.since >= TABLE_READY_TIMEOUT_MS
        ? { ...s, phase: 'opening', crossfade: true }
        : s;
    case 'handed-off':
      return s.phase === 'opening' ? { ...s, phase: 'gone' } : s;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/entrance/doorFlow.test.ts --root packages/frontend`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/entrance/doorFlow.ts packages/frontend/src/entrance/doorFlow.test.ts
git commit -m "feat(entrance): pure door-flow reducer with the 8 s ready timeout"
```

---

### Task 6: Closed sign, name ledger and `EntranceScreen`; delete `Lobby` and `JoinScreen`

**Files:**
- Create: `packages/frontend/src/entrance/testSocket.ts`
- Create: `packages/frontend/src/entrance/ClosedSign.tsx`, `ClosedSign.test.tsx`
- Create: `packages/frontend/src/entrance/NameLedger.tsx`, `NameLedger.test.tsx`
- Create: `packages/frontend/src/entrance/EntranceScreen.tsx`, `EntranceScreen.test.tsx`
- Delete: `packages/frontend/src/components/Lobby.tsx`, `Lobby.test.tsx`, `JoinScreen.tsx`, `JoinScreen.test.tsx`
- Modify: `packages/frontend/src/App.tsx`, `packages/frontend/src/App.test.tsx`
- Modify: `packages/frontend/src/components/AdminPanel.tsx` (two comments that name the deleted files)
- Modify: `packages/frontend/src/hud/noThree.test.ts`

**Interfaces:**
- Consumes: `DoorPhase` (Task 5); `DoorStage` (Task 4, lazily); `View3DBoundary`; `Button`; `useSocket`.
- Produces: `socketValue(overrides?: Partial<SocketContextValue>): SocketContextValue` (test helper); `ClosedSign()`; `NameLedger()`; `FALLBACK_FADE_MS = 300`; `interface EntranceScreenProps { phase: Exclude<DoorPhase, 'gone'>; crossfade: boolean; use3D: boolean; reducedMotion: boolean; onHandedOff: () => void }`; `EntranceScreen(props)`, root `data-testid="entrance"`.

`EntranceScreen` draws the door scene when `use3D`. It draws the plain themed background when the doors are not on screen yet (loading), failed, or not in use. On top go the closed sign (`closed`) or the ledger (`ledger`), and nothing in `waiting-table` / `opening`. In `opening` it plays the door animation only if the door scene is already on screen and the hand-off is not a timeout `crossfade`. Otherwise it fades itself out over 300 ms, then calls `onHandedOff`. The choice is latched when the opening starts. While covering the table (`waiting-table`, `opening`) it sits at `z-[60]`; otherwise at `z-40`, under the off-table admin corner (`z-50`).

In this task `App` drives the phase straight from the status (`lobby` → `closed`, `entering-name` → `ledger`); Task 7 wires the reducer.

- [ ] **Step 1: Write the test helper** — `packages/frontend/src/entrance/testSocket.ts`:

```ts
import { vi } from 'vitest';
import type { SocketContextValue } from '../socket/SocketContext';

// A complete SocketContextValue for overlay tests. If SocketContextValue gains fields (the soundboard
// plan adds sendSoundboard / onSoundboard), add them here as vi.fn().
export function socketValue(overrides: Partial<SocketContextValue> = {}): SocketContextValue {
  return {
    status: 'lobby',
    state: null,
    errorMessage: null,
    adminErrorMessage: null,
    adminActionErrorMessage: null,
    adminNoticeMessage: null,
    actionPending: false,
    displayName: null,
    isAdmin: false,
    joinWithName: vi.fn(),
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
    adminReleaseName: vi.fn(),
    adminKick: vi.fn(),
    adminForceAct: vi.fn(),
    adminSetTurnClock: vi.fn(),
    takeOver: vi.fn(),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing overlay tests**

`packages/frontend/src/entrance/ClosedSign.test.tsx` (carries over `Lobby.test`'s start cases; its switch cases go, because that branch was unreachable):

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { ClosedSign } from './ClosedSign';
import { socketValue } from './testSocket';

function renderSign(overrides: Partial<SocketContextValue> = {}) {
  const value = socketValue(overrides);
  render(
    <SocketContext.Provider value={value}>
      <ClosedSign />
    </SocketContext.Provider>
  );
  return value;
}

describe('ClosedSign (lobby spec L4)', () => {
  it('tells a non-admin the saloon is closed, with no start buttons', () => {
    renderSign();
    expect(screen.getByText('Closed — waiting for the dealer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open for/i })).not.toBeInTheDocument();
  });

  it('lets an admin open for Poker', () => {
    const value = renderSign({ isAdmin: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open for Poker' }));
    expect(value.adminStartGame).toHaveBeenCalledWith('holdem');
  });

  it('lets an admin open for Blackjack', () => {
    const value = renderSign({ isAdmin: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open for Blackjack' }));
    expect(value.adminStartGame).toHaveBeenCalledWith('blackjack');
  });
});
```

`packages/frontend/src/entrance/NameLedger.test.tsx` (every `JoinScreen.test` case, unchanged apart from the component):

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { NameLedger } from './NameLedger';
import { socketValue } from './testSocket';

function renderLedger(overrides: Partial<SocketContextValue> = {}) {
  const value = socketValue({ status: 'entering-name', ...overrides });
  render(
    <SocketContext.Provider value={value}>
      <NameLedger />
    </SocketContext.Provider>
  );
  return value;
}

describe('NameLedger (lobby spec L5)', () => {
  it('calls joinWithName with the trimmed display name on submit', async () => {
    const { joinWithName } = renderLedger();
    await userEvent.type(screen.getByLabelText(/display name/i), '  alice  ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(joinWithName).toHaveBeenCalledWith('alice');
  });

  it('does not call joinWithName for an empty or whitespace-only name', async () => {
    const { joinWithName } = renderLedger();
    await userEvent.type(screen.getByLabelText(/display name/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(joinWithName).not.toHaveBeenCalled();
  });

  it('limits the name input to the server maximum (audit M8)', () => {
    renderLedger();
    expect(screen.getByLabelText(/display name/i)).toHaveAttribute('maxLength', '32');
  });

  it('disables the form while connecting', () => {
    renderLedger({ status: 'connecting' });
    expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /joining/i })).toBeDisabled();
  });

  it('shows an error message when one is present', () => {
    renderLedger({ errorMessage: 'Invalid display name' });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid display name');
  });

  it('links the error message to the display name input via aria-describedby', () => {
    renderLedger({ errorMessage: 'Invalid display name' });
    expect(screen.getByLabelText(/display name/i)).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  });

  it('does not set aria-describedby when there is no error', () => {
    renderLedger();
    expect(screen.getByLabelText(/display name/i)).not.toHaveAttribute('aria-describedby');
  });

  it('does not show an admin-login error as a join error', () => {
    renderLedger({ errorMessage: null, adminErrorMessage: 'Incorrect admin passphrase' });
    expect(screen.queryByText('Incorrect admin passphrase')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
```

`packages/frontend/src/entrance/EntranceScreen.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SocketContext } from '../socket/SocketContext';
import { EntranceScreen, FALLBACK_FADE_MS, type EntranceScreenProps } from './EntranceScreen';
import { socketValue } from './testSocket';

// jsdom has no WebGL: the lazy door chunk is a stub exposing its two callbacks.
vi.mock('../three/DoorStage', () => ({
  default: (p: { state: string; open: boolean; onReady: () => void; onHandedOff: () => void }) => (
    <div data-testid="door-stage" data-state={p.state} data-open={String(p.open)}>
      <button onClick={p.onReady}>doors-ready</button>
      <button onClick={p.onHandedOff}>doors-done</button>
    </div>
  ),
}));

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

function setup(over: Partial<EntranceScreenProps> = {}) {
  const props: EntranceScreenProps = { phase: 'closed', crossfade: false, use3D: false, reducedMotion: false, onHandedOff: vi.fn(), ...over };
  const ui = (p: EntranceScreenProps) => (
    <SocketContext.Provider value={socketValue({ status: p.phase === 'ledger' ? 'entering-name' : 'lobby' })}>
      <EntranceScreen {...p} />
    </SocketContext.Provider>
  );
  const utils = render(ui(props));
  return { props, rerender: (p: Partial<EntranceScreenProps>) => utils.rerender(ui({ ...props, ...p })) };
}

describe('EntranceScreen (lobby spec §3.2, §3.5)', () => {
  it('shows the closed sign on the plain screen when 3D is off', () => {
    setup();
    expect(screen.getByText('Closed — waiting for the dealer')).toBeInTheDocument();
    expect(screen.queryByTestId('door-stage')).not.toBeInTheDocument();
  });

  it('shows the name ledger in the ledger phase', () => {
    setup({ phase: 'ledger' });
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('puts the doors behind the overlays when 3D is on', async () => {
    setup({ phase: 'ledger', use3D: true });
    expect(await screen.findByTestId('door-stage')).toHaveAttribute('data-state', 'ledger');
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('shows no overlay while waiting for the table, and covers it', () => {
    setup({ phase: 'waiting-table' });
    expect(screen.queryByText(/waiting for the dealer/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('entrance').className).toMatch(/z-\[60\]/);
  });

  it('crossfades out and hands off after 300 ms without 3D (L9)', async () => {
    const { props } = setup({ phase: 'opening' });
    expect(FALLBACK_FADE_MS).toBe(300);
    await wait(150);
    expect(props.onHandedOff).not.toHaveBeenCalled();
    await wait(250);
    expect(props.onHandedOff).toHaveBeenCalledTimes(1);
  });

  it('plays the door animation when the doors are on screen, and hands off when they say so', async () => {
    const { props, rerender } = setup({ use3D: true });
    fireEvent.click(await screen.findByText('doors-ready'));
    rerender({ phase: 'opening' });
    expect(screen.getByTestId('door-stage')).toHaveAttribute('data-open', 'true');
    await wait(400);
    expect(props.onHandedOff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('doors-done'));
    expect(props.onHandedOff).toHaveBeenCalledTimes(1);
  });

  it('crossfades instead when the hand-off was forced by the timeout', async () => {
    const { props, rerender } = setup({ use3D: true });
    fireEvent.click(await screen.findByText('doors-ready'));
    rerender({ phase: 'opening', crossfade: true });
    expect(screen.getByTestId('door-stage')).toHaveAttribute('data-open', 'false');
    await wait(400);
    expect(props.onHandedOff).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/entrance --root packages/frontend`
Expected: FAIL: `./ClosedSign`, `./NameLedger`, `./EntranceScreen` cannot be resolved (the `doorFlow` tests still pass).

- [ ] **Step 4: Create `packages/frontend/src/entrance/ClosedSign.tsx`**

```tsx
import { Button } from '../components/Button';
import { useSocket } from '../socket/SocketContext';

// Before the first game (status 'lobby'): the sign on the saloon doors, styled like the HUD panels.
// Admins open the saloon from here, replacing the old lobby's start buttons (lobby spec L4).
export function ClosedSign() {
  const { isAdmin, adminStartGame } = useSocket();
  return (
    <section className="flex flex-col items-center gap-3 rounded-md border border-wood-grain bg-surface px-6 py-4 text-center shadow-lg">
      <p className="font-display text-2xl text-brass-bright">Closed — waiting for the dealer</p>
      {isAdmin && (
        <div className="flex gap-2">
          <Button variant="primary" size="md" onClick={() => adminStartGame('holdem')}>
            Open for Poker
          </Button>
          <Button variant="primary" size="md" onClick={() => adminStartGame('blackjack')}>
            Open for Blackjack
          </Button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Create `packages/frontend/src/entrance/NameLedger.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { MAX_DISPLAY_NAME_LENGTH } from '@poker-blackjack/server/src/names';
import { Button } from '../components/Button';
import { useSocket } from '../socket/SocketContext';

// New players sign the ledger at the doors (lobby spec L5). Same behaviour as the old JoinScreen:
// trimmed name, server maximum, disabled while connecting, the join error linked to the input.
// Submitting keeps the doors shut until the player is seated.
export function NameLedger() {
  const { status, errorMessage, joinWithName } = useSocket();
  const [name, setName] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    joinWithName(trimmed);
  }

  const connecting = status === 'connecting';

  return (
    <section className="w-72 rounded-sm border border-wood bg-parchment px-6 py-5 font-body text-ink shadow-xl">
      <h1 className="mb-3 text-center font-display text-2xl">Poker &amp; Blackjack</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="displayName" className="font-utility text-sm">
          Display name
        </label>
        <input
          id="displayName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          disabled={connecting}
          aria-describedby={errorMessage ? 'displayName-error' : undefined}
          className="border-b-2 border-wood bg-parchment-dim px-2 py-1 text-ink disabled:opacity-50"
        />
        <Button type="submit" variant="primary" size="md" disabled={connecting || name.trim().length === 0}>
          {connecting ? 'Joining…' : 'Join table'}
        </Button>
        {errorMessage && (
          <p id="displayName-error" role="alert" className="text-sm text-ember">
            {errorMessage}
          </p>
        )}
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Create `packages/frontend/src/entrance/EntranceScreen.tsx`**

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { View3DBoundary } from '../three/View3DBoundary';
import { ClosedSign } from './ClosedSign';
import { NameLedger } from './NameLedger';
import type { DoorPhase } from './doorFlow';

// The door scene is its own lazy chunk; three.js loads only when the doors are shown in 3D.
const DoorStage = lazy(() => import('../three/DoorStage'));

// The crossfade used instead of the door animation: reduced motion is handled inside the door scene
// (its own 300 ms fade); this one covers no WebGL, the flat view, doors still loading and the 8 s
// timeout (lobby spec L9, §4).
export const FALLBACK_FADE_MS = 300;
const FALLBACK_BG = 'radial-gradient(ellipse at 50% 45%, #3a2414 0%, #140f0a 55%, #05070c 100%)';

export interface EntranceScreenProps {
  phase: Exclude<DoorPhase, 'gone'>;
  crossfade: boolean;
  use3D: boolean;
  reducedMotion: boolean;
  onHandedOff: () => void;
}

export function EntranceScreen({ phase, crossfade, use3D, reducedMotion, onHandedOff }: EntranceScreenProps) {
  const [doorsFailed, setDoorsFailed] = useState(false);
  const [doorsReady, setDoorsReady] = useState(false);
  const doors = use3D && !doorsFailed;
  const opening = phase === 'opening';

  // Latched when the opening starts, so the doors finishing their load mid-fade can't switch paths.
  // If the door scene dies mid-animation, fall back to the fade so the player is never stuck.
  const openWith = useRef<'scene' | 'fade' | null>(null);
  if (!opening) openWith.current = null;
  else if (openWith.current === null) openWith.current = doors && doorsReady && !crossfade ? 'scene' : 'fade';
  else if (openWith.current === 'scene' && !doors) openWith.current = 'fade';
  const fading = openWith.current === 'fade';

  const handedOff = useRef(onHandedOff);
  handedOff.current = onHandedOff;
  useEffect(() => {
    if (!fading) return;
    const id = setTimeout(() => handedOff.current(), FALLBACK_FADE_MS);
    return () => clearTimeout(id);
  }, [fading]);

  const covering = phase === 'waiting-table' || opening;
  return (
    <div
      data-testid="entrance"
      className={`fixed inset-0 ${covering ? 'z-[60]' : 'z-40'}`}
      style={fading ? { opacity: 0, transition: `opacity ${FALLBACK_FADE_MS}ms linear` } : undefined}
    >
      {!(doors && doorsReady) && <div aria-hidden="true" className="absolute inset-0" style={{ background: FALLBACK_BG }} />}
      {doors && (
        <View3DBoundary onError={() => setDoorsFailed(true)}>
          <Suspense fallback={null}>
            <DoorStage
              state={phase === 'ledger' ? 'ledger' : 'closed'}
              open={openWith.current === 'scene'}
              reducedMotion={reducedMotion}
              onReady={() => setDoorsReady(true)}
              onHandedOff={onHandedOff}
              onUnsupported={() => setDoorsFailed(true)}
            />
          </Suspense>
        </View3DBoundary>
      )}
      {(phase === 'closed' || phase === 'ledger') && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          {phase === 'closed' ? <ClosedSign /> : <NameLedger />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the overlay tests**

Run: `npx vitest run src/entrance --root packages/frontend`
Expected: PASS (26 tests across four files).

- [ ] **Step 8: Wire `App.tsx` and delete the old screens**

In `packages/frontend/src/App.tsx`:
- Replace the `Lobby` and `JoinScreen` imports with:

  ```tsx
  import { useReducedMotion } from 'framer-motion';
  import { EntranceScreen } from './entrance/EntranceScreen';
  ```

  (merge `useReducedMotion` into the existing `framer-motion` import line).
- At the top of `AppContent`, right after the `useSocket()` line (hooks must run before the early returns):

  ```tsx
  const reducedMotion = useReducedMotion() ?? false;
  const size = useWindowSize();
  // The doors follow the table's view choice: no 3D table, no 3D doors (lobby spec L9).
  const use3D = chooseTableLayout({ ...size, pref: readViewPref(), failed: false }) === 'overlay';
  ```

- Replace

  ```tsx
      {status === 'lobby' && <Lobby />}
      {status === 'entering-name' && <JoinScreen />}
  ```

  with

  ```tsx
      {(status === 'lobby' || status === 'entering-name') && (
        <EntranceScreen
          phase={status === 'lobby' ? 'closed' : 'ledger'}
          crossfade={false}
          use3D={use3D}
          reducedMotion={reducedMotion}
          onHandedOff={() => undefined}
        />
      )}
  ```

Delete the four files:

```bash
git rm packages/frontend/src/components/Lobby.tsx packages/frontend/src/components/Lobby.test.tsx packages/frontend/src/components/JoinScreen.tsx packages/frontend/src/components/JoinScreen.test.tsx
```

In `packages/frontend/src/components/AdminPanel.tsx`, replace the comment block that starts `{/* The mode picker lives here, not in Lobby:` with:

```tsx
          {/* The mode switch lives here: the panel is mounted exactly when a table exists, which is
              when switching makes sense. Before the first game, the closed sign on the saloon doors
              holds the start buttons (lobby spec L4). */}
```

and the one that starts `{/* Admin-action rejections land here rather than in JoinScreen's` with:

```tsx
          {/* Admin-action rejections land here, not in the name ledger's form, where they would read
              as a problem with the display name. */}
```

- [ ] **Step 9: Update `packages/frontend/src/App.test.tsx`**

Add, next to the other `vi.mock` calls:

```tsx
// The door scene needs WebGL; App tests run the flat view, but stub it so jsdom never builds it.
vi.mock('./three/DoorStage', () => ({ default: () => <div data-testid="door-stage" /> }));
```

Rename the test `'shows the Lobby (not the join screen or a table) once connected with no active game mode'` to `'shows the closed sign (not the name ledger or a table) once connected with no active game mode'`, and change its first assertion to:

```tsx
    expect(screen.getByText(/waiting for the dealer/i)).toBeInTheDocument();
```

- [ ] **Step 10: Extend the import guard** in `packages/frontend/src/hud/noThree.test.ts`

Change the test title to `'nothing src/hud, src/table or src/entrance imports reaches the three package'` and its first line to:

```ts
    const stack = [...sourceFiles(join(SRC, 'hud')), ...sourceFiles(join(SRC, 'table')), ...sourceFiles(join(SRC, 'entrance'))];
```

(The lazy `import('../three/DoorStage')` is a dynamic import, which the guard's `from '…'` pattern rightly skips.)

- [ ] **Step 11: Run everything**

Run: `grep -rn "Lobby\|JoinScreen" packages/frontend/src` — expected: no output.
Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add -A packages/frontend/src/entrance packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx packages/frontend/src/components packages/frontend/src/hud/noThree.test.ts
git commit -m "feat(entrance): closed sign and name ledger over the saloon doors replace Lobby and JoinScreen"
```

---

### Task 7: Entry hand-off (table ready → doors open → gone)

**Files:**
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts` (`onFirstFrame`)
- Modify: `packages/frontend/src/three/TableStage.tsx` (`onViewReady`)
- Modify: `packages/frontend/src/three/Blackjack3D.tsx`, `Poker3D.tsx` (pass-through)
- Modify: `packages/frontend/src/three/Blackjack3D.test.tsx`
- Modify: `packages/frontend/src/App.tsx` (`TableView.onViewReady`, door flow)
- Modify: `packages/frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `doorFlowReducer`, `initialDoorFlow` (Task 5); `EntranceScreen` (Task 6).
- Produces: `SceneRoot.onFirstFrame: (() => void) | null` (fired once, after the first drawn frame); `TableStageProps.onViewReady?: () => void`; the same optional prop on `Blackjack3DProps` and `Poker3DProps`; `TableView` prop `onViewReady: (kind: 'scene' | 'flat') => void` (flat: fired in an effect whenever the layout is not `overlay`, which also covers a 3D failure falling back).

`App` keeps the door flow in a reducer. The status is dispatched in a **layout** effect, so the phase follows it before paint and a returning player never sees the sign flash over the table. While the phase is `waiting-table` or `opening`, `App` renders the table underneath and `EntranceScreen` on top. On `gone` it unmounts the entrance, which disposes the door scene's WebGL context, so two contexts exist only during the hand-off (§3.3).

- [ ] **Step 1: Write the failing tests**

In `packages/frontend/src/three/Blackjack3D.test.tsx`, add `onFirstFrame: (() => void) | null;` to the `FakeScene` interface and `onFirstFrame = null;` to the mocked class (next to `onFrame = null;`). Add `act` to the Testing Library import. Then add inside the top-level `describe`:

```tsx
  it('reports the view ready once the scene has drawn its first frame (lobby spec §3.3)', () => {
    const onViewReady = vi.fn();
    render(<Blackjack3D {...props({ onViewReady })} />);
    expect(onViewReady).not.toHaveBeenCalled();
    act(() => created[created.length - 1].onFirstFrame?.());
    expect(onViewReady).toHaveBeenCalledTimes(1);
  });
```

In `packages/frontend/src/App.test.tsx`, add inside `describe('App')`:

```tsx
  it('opens the doors onto the table once it is ready, then removes the entrance (lobby spec §3.3)', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
    });
    expect(screen.getByTestId('entrance')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { mySeatIndex: 0 }));
    });
    expect(await screen.findByRole('button', { name: 'Fold' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('entrance')).not.toBeInTheDocument());
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/three/Blackjack3D.test.tsx src/App.test.tsx --root packages/frontend`
Expected: the `Blackjack3D` test FAILS (`onViewReady` never called). The App test already passes, because Task 6 drops the entrance as soon as the status is `at-table`. It guards the hand-off once Step 5 renders the entrance over the table. After Step 5, temporarily remove `onViewReady={onTableReady}` from the `TableView` in `App`: the test must then fail (the entrance stays until the 8 s timeout, past `waitFor`'s 1 s). Then restore it.

- [ ] **Step 3: `SceneRoot.onFirstFrame`** in `packages/frontend/src/three/engine/SceneRoot.ts`

Next to `onFrame`:

```ts
  // Fired once, after the first drawn frame. Every texture is a synchronous canvas texture, so that
  // frame is complete: the door entry waits for it before opening (lobby spec §3.3).
  onFirstFrame: (() => void) | null = null;
  private firstFrameDone = false;
```

At the end of `tick`, after `this.onFrame?.(this.project);`:

```ts
    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      this.onFirstFrame?.();
    }
```

- [ ] **Step 4: Thread `onViewReady` through the 3D shells**

`packages/frontend/src/three/TableStage.tsx`: add to `TableStageProps`:

```ts
  // Called once the scene has drawn its first frame (the door entry and the table switch wait for it).
  onViewReady?: () => void;
```

Destructure `onViewReady` in `TableStage`, keep it in a ref next to `unsupportedRef`:

```ts
  const viewReadyRef = useRef(onViewReady);
  viewReadyRef.current = onViewReady;
```

and right after `sceneRef.current = scene;` in the mount effect:

```ts
    scene.onFirstFrame = () => viewReadyRef.current?.();
```

`Blackjack3D.tsx` and `Poker3D.tsx`: add to the props interface

```ts
  // From TableStage: the scene has drawn its first frame (lobby spec §3.3).
  onViewReady?: () => void;
```

destructure it, and pass `onViewReady={onViewReady}` to `<TableStage>`.

- [ ] **Step 5: `TableView` reports ready, and `App` runs the door flow**

In `packages/frontend/src/App.tsx`:
- Imports: add `useCallback, useEffect, useLayoutEffect, useReducer, useRef` to the React import, and `import { doorFlowReducer, initialDoorFlow } from './entrance/doorFlow';`.
- `TableView`: add the prop `onViewReady: (kind: 'scene' | 'flat') => void;` to its props type and destructuring. After `const layout = …`:

  ```tsx
  const viewReadyRef = useRef(onViewReady);
  viewReadyRef.current = onViewReady;
  // The flat view is ready as soon as it renders; this also fires when a 3D failure falls back.
  useEffect(() => {
    if (layout !== 'overlay') viewReadyRef.current('flat');
  }, [layout]);
  ```

  and add `onViewReady: () => viewReadyRef.current('scene'),` to `sharedProps`.
- `AppContent`, after the `use3D` line from Task 6:

  ```tsx
  const [flow, dispatchFlow] = useReducer(doorFlowReducer, initialDoorFlow);
  // A layout effect: the phase must follow the status before paint, or a returning player would
  // see the closed sign flash over the table.
  useLayoutEffect(() => {
    dispatchFlow({ type: 'status', status, now: Date.now() });
  }, [status]);
  useEffect(() => {
    if (flow.phase !== 'waiting-table') return;
    const id = setInterval(() => dispatchFlow({ type: 'tick', now: Date.now() }), 250);
    return () => clearInterval(id);
  }, [flow.phase]);
  const onTableReady = useCallback(() => dispatchFlow({ type: 'table-ready' }), []);
  const onHandedOff = useCallback(() => dispatchFlow({ type: 'handed-off' }), []);
  ```

- Replace the Task 6 `EntranceScreen` block and the `TableView` block with (the table first, so the entrance stacks above it):

  ```tsx
      {atTable && state.table && (
        <TableView
          table={state.table}
          mySeatIndex={state.mySeatIndex}
          connectionStatus={status}
          errorMessage={errorMessage ?? state.table.handStartError}
          actionPending={actionPending}
          onReady={sendReady}
          onAction={sendAction}
          onLeave={leave}
          onViewReady={onTableReady}
        />
      )}
      {flow.phase !== 'gone' && (status === 'lobby' || status === 'entering-name' || atTable) && (
        // Unmounting on 'gone' disposes the door scene's WebGL context (spec §3.3).
        <EntranceScreen
          phase={flow.phase}
          crossfade={flow.crossfade}
          use3D={use3D}
          reducedMotion={reducedMotion}
          onHandedOff={onHandedOff}
        />
      )}
  ```

- [ ] **Step 6: Run everything**

Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck`
Expected: PASS. In the 3D App tests the `Blackjack3D` stub never reports ready, so the entrance stays in the DOM over the stub until the 8 s timeout; those tests query the stub and the flat table, which are unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/three/engine/SceneRoot.ts packages/frontend/src/three/TableStage.tsx packages/frontend/src/three/Blackjack3D.tsx packages/frontend/src/three/Poker3D.tsx packages/frontend/src/three/Blackjack3D.test.tsx packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx
git commit -m "feat(entrance): doors open onto the table once its first frame is drawn"
```

---

### Gate 2: the door opening and hand-off (controller + render subagent; the user approves)

Spec §6 gate 2, after phase c. Not an implementer task.

- [ ] **Step 1: Dispatch the render subagent** (model: sonnet) with this brief:

  > Render Gate 2: a frame sequence of the saloon doors opening onto the Blackjack table. Do not edit repo files.
  > 1. Start the save server in the background: `node scripts/render/save-server.cjs .playtest-data/lobby-gates/gate2` (port 3199).
  > 2. `preview_start` `{ name: "frontend" }`; `resize_window` 1280×720.
  > 3. Navigate to `http://localhost:5173/dev3d.html?game=doors&table=1&step=9&bar=0`, wait 4.5 s, then run in the page:
  >    ```js
  >    const d = window.__doors, t = window.__bj3d; d.paused = true; let handedAt = -1;
  >    const save = async (name, c) => { const r = await fetch(`http://127.0.0.1:3199/save?name=${name}.png`, { method: 'POST', body: c.toDataURL('image/png') }); await r.text(); };
  >    const frame = () => { t.advance(0); const dc = d.renderer.domElement, tc = t.renderer.domElement;
  >      const c = document.createElement('canvas'); c.width = dc.width; c.height = dc.height; const g = c.getContext('2d');
  >      g.drawImage(tc, 0, 0, c.width, c.height); g.globalAlpha = Number(dc.style.opacity || 1); g.drawImage(dc, 0, 0); return c; };
  >    d.open(() => { handedAt = f; }, { reducedMotion: false });
  >    var f = 0; const thumbs = [];
  >    for (f = 0; f <= 48; f++) { if (f === 0) d.advance(0); else d.advance(1 / 30); const c = frame(); await save(`entry-${String(f).padStart(2, '0')}`, c); if (f % 4 === 0) thumbs.push(c); }
  >    const sheet = document.createElement('canvas'); sheet.width = 4 * 320; sheet.height = Math.ceil(thumbs.length / 4) * 180; const sg = sheet.getContext('2d');
  >    thumbs.forEach((c, i) => sg.drawImage(c, (i % 4) * 320, Math.floor(i / 4) * 180, 320, 180)); await save('entry-sheet', sheet); handedAt;
  >    ```
  >    Note the returned `handedAt` frame.
  > 4. Reload and repeat with `{ reducedMotion: true }`, frames 0–12 only, names `reduced-NN`, no sheet.
  > 5. Write `.playtest-data/lobby-gates/gate2/findings.md`: the frame where the doors look fully open; whether the camera ever clips a leaf; whether the overshoot reads as a batwing swing or as a glitch; whether the fade into the table is smooth (no flash or black frame); `handedAt` for both runs; console errors. Return a 10-line summary; no image data in your reply.

- [ ] **Step 2: Show the user** `entry-sheet.png` plus frames 00, 16, 32, 40 and 48 (`SendUserFile`, `display: render`) and the findings summary. Ask for approval of the timing and feel (L6).
- [ ] **Step 3: If the user asks for changes,** adjust the constants in `doorMotion.ts` (`DOOR_OPEN_S`, `SWING_DAMPING`, `SWING_HZ`, `CAMERA_END_Z`, `DOOR_FADE_S`) as a follow-up task. Re-run Task 2's tests, which pin the no-clipping and settle rules, update any pinned value with a comment citing gate 2, and re-render. Record the settled values under "Deviations". Do not start phase d until the user approves.

---

## Phase d: the table-switch swing → Gate 3

### Task 8: The swing curve (pure)

**Files:**
- Create: `packages/frontend/src/switch/swingCurve.ts`
- Create: `packages/frontend/src/switch/swingCurve.test.ts`

**Interfaces:**
- Consumes: `smootherstep` from `../three/engine/tween` (that module has no imports, so it pulls in no three.js).
- Produces: `SWING_MS = 1300`, `SWING_DEG = 180`, `SWAP_MS = 650`, `MAX_BLUR = 0.02` (fraction of screen width at peak speed; gate 3 tunes it), `interface SwingPose { showing: 'old' | 'new'; yawDeg: number; velocityDegPerS: number; blur: number }`, `swingTotalDeg(ms: number): number`, `swingVelocityDegPerS(ms: number): number`, `swingPose(ms: number): SwingPose`.

One 180° turn on smootherstep over 1300 ms. The old camera shows 0 → 90°, and the new one shows −90° → 0 (its `yawDeg` is total − 180). The swap is at exactly 650 ms, where the total is exactly 90°, so the velocity is continuous across it. Velocity comes from smootherstep's derivative `30x²(x−1)²` and peaks at 1.875·180/1.3 ≈ 260°/s. Blur scales with velocity, reaching `MAX_BLUR` at the peak.

- [ ] **Step 1: Write the failing test** — `packages/frontend/src/switch/swingCurve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_BLUR, SWAP_MS, SWING_MS, swingPose, swingTotalDeg, swingVelocityDegPerS } from './swingCurve';

describe('swing curve (lobby spec L7, §5)', () => {
  it('lasts 1300 ms and swaps at the midpoint', () => {
    expect(SWING_MS).toBe(1300);
    expect(SWAP_MS).toBe(650);
  });

  it('turns monotonically from 0 to 180 with no overshoot', () => {
    let prev = -Infinity;
    for (let ms = 0; ms <= SWING_MS; ms++) {
      const total = swingTotalDeg(ms);
      expect(total).toBeGreaterThanOrEqual(prev);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(180);
      prev = total;
    }
    expect(swingTotalDeg(0)).toBe(0);
    expect(swingTotalDeg(SWING_MS)).toBe(180);
    expect(swingTotalDeg(SWING_MS + 500)).toBe(180);
  });

  it('starts and ends at rest', () => {
    expect(swingVelocityDegPerS(0)).toBe(0);
    expect(swingVelocityDegPerS(SWING_MS)).toBe(0);
    expect(swingPose(0).blur).toBe(0);
    expect(swingPose(SWING_MS).blur).toBe(0);
  });

  it('is at exactly 90° at the swap, where the new view takes over at -90°', () => {
    expect(swingTotalDeg(SWAP_MS)).toBe(90);
    const before = swingPose(SWAP_MS - 0.001);
    expect(before.showing).toBe('old');
    expect(before.yawDeg).toBeCloseTo(90, 2);
    const at = swingPose(SWAP_MS);
    expect(at.showing).toBe('new');
    expect(at.yawDeg).toBe(-90);
  });

  it('keeps each camera inside its half-turn', () => {
    for (let ms = 0; ms <= SWING_MS; ms += 5) {
      const p = swingPose(ms);
      if (p.showing === 'old') {
        expect(p.yawDeg).toBeGreaterThanOrEqual(0);
        expect(p.yawDeg).toBeLessThanOrEqual(90);
      } else {
        expect(p.yawDeg).toBeGreaterThanOrEqual(-90);
        expect(p.yawDeg).toBeLessThanOrEqual(0);
      }
    }
  });

  it('blurs in proportion to speed, peaking at MAX_BLUR mid-swing', () => {
    expect(swingPose(SWAP_MS).blur).toBeCloseTo(MAX_BLUR, 10);
    expect(swingPose(SWAP_MS / 2).blur).toBeGreaterThan(0);
    expect(swingPose(SWAP_MS / 2).blur).toBeLessThan(MAX_BLUR);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/switch/swingCurve.test.ts --root packages/frontend`
Expected: FAIL, cannot resolve `./swingCurve`.

- [ ] **Step 3: Create `packages/frontend/src/switch/swingCurve.ts`**

```ts
import { smootherstep } from '../three/engine/tween';

// The table-switch swing (lobby spec L7, §3.4): one 180° turn on a single quintic smootherstep, so
// it starts and ends at rest, never overshoots, and its speed is continuous across the swap.
export const SWING_MS = 1300;
export const SWING_DEG = 180;
export const SWAP_MS = SWING_MS / 2;
// Blur length at peak speed, as a fraction of screen width. "Light" per L7; settled at gate 3.
export const MAX_BLUR = 0.02;

export interface SwingPose {
  showing: 'old' | 'new';
  yawDeg: number;
  velocityDegPerS: number;
  blur: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// smootherstep' = 30x²(x−1)², which peaks at 1.875 when x = 0.5.
const PEAK_VELOCITY = (SWING_DEG * 1.875) / (SWING_MS / 1000);

export function swingTotalDeg(ms: number): number {
  return SWING_DEG * smootherstep(clamp01(ms / SWING_MS));
}

export function swingVelocityDegPerS(ms: number): number {
  const x = clamp01(ms / SWING_MS);
  return (SWING_DEG * 30 * x * x * (x - 1) * (x - 1)) / (SWING_MS / 1000);
}

// The old camera turns 0 → 90°; at the swap the new camera, facing the other way, turns −90° → 0.
export function swingPose(ms: number): SwingPose {
  const total = swingTotalDeg(ms);
  const velocityDegPerS = swingVelocityDegPerS(ms);
  const blur = (MAX_BLUR * velocityDegPerS) / PEAK_VELOCITY;
  return ms < SWAP_MS
    ? { showing: 'old', yawDeg: total, velocityDegPerS, blur }
    : { showing: 'new', yawDeg: total - SWING_DEG, velocityDegPerS, blur };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/switch/swingCurve.test.ts --root packages/frontend`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/switch/swingCurve.ts packages/frontend/src/switch/swingCurve.test.ts
git commit -m "feat(switch): pure 180° swing curve on quintic smootherstep"
```

---

### Task 9: The switch reducer (`switchFlow`, pure)

**Files:**
- Create: `packages/frontend/src/switch/switchFlow.ts`
- Create: `packages/frontend/src/switch/switchFlow.test.ts`

**Interfaces:**
- Consumes: `type GameMode` from `@poker-blackjack/server/src/table`.
- Produces: `type SwitchStyle = 'swing' | 'crossfade' | 'dip'`, `type SwitchPhase = 'idle' | 'preparing' | 'transitioning'`, `interface SwitchFlowState { phase: SwitchPhase; shown: GameMode | null; from: GameMode | null; to: GameMode | null; queued: GameMode | null; style: SwitchStyle | null; since: number }`, `type SwitchFlowEvent = { type: 'mode'; mode: GameMode | null; now: number } | { type: 'set'; mode: GameMode | null } | { type: 'ready'; style: SwitchStyle } | { type: 'tick'; now: number } | { type: 'done'; now: number }`, `SWITCH_READY_TIMEOUT_MS = 8000`, `initialSwitchFlow`, `switchFlowReducer(s, e)`.

Rules:
- `mode` with `null` resets. The first mode while `shown` is null just sets it, because that entry belongs to the doors.
- In `idle`, a different mode starts `preparing` (`from` = shown, `to` = mode, `since` = now) and the same mode changes nothing.
- During `preparing` / `transitioning` a mode goes to `queued` (latest wins). A mode equal to `to` clears the queue.
- `set` jumps to idle with that mode, with no transition (used while the doors are up).
- `ready` (preparing only) → `transitioning` with the given style. A `tick` 8 s after `since` while preparing → `transitioning` with `crossfade`.
- `done` (transitioning only) → idle showing `to`; a queued mode different from the new `shown` then starts the next `preparing` at once.

- [ ] **Step 1: Write the failing test** — `packages/frontend/src/switch/switchFlow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SWITCH_READY_TIMEOUT_MS,
  initialSwitchFlow,
  switchFlowReducer,
  type SwitchFlowEvent,
  type SwitchFlowState,
} from './switchFlow';

const run = (s: SwitchFlowState, ...events: SwitchFlowEvent[]) => events.reduce(switchFlowReducer, s);
const idleHoldem = run(initialSwitchFlow, { type: 'mode', mode: 'holdem', now: 0 });
const preparing = run(idleHoldem, { type: 'mode', mode: 'blackjack', now: 1000 });

describe('switchFlowReducer (lobby spec §3.4, §4)', () => {
  it('takes the first mode as shown, without a transition (the doors own that entry)', () => {
    expect(idleHoldem).toEqual({ ...initialSwitchFlow, shown: 'holdem' });
  });

  it('jumps straight to a mode with set (doors still up)', () => {
    expect(run(idleHoldem, { type: 'set', mode: 'blackjack' })).toEqual({ ...initialSwitchFlow, shown: 'blackjack' });
    expect(run(idleHoldem, { type: 'set', mode: 'holdem' })).toBe(idleHoldem);
  });

  it('prepares a switch on a new mode, keeping the old one shown', () => {
    expect(preparing).toEqual({ phase: 'preparing', shown: 'holdem', from: 'holdem', to: 'blackjack', queued: null, style: null, since: 1000 });
    expect(run(idleHoldem, { type: 'mode', mode: 'holdem', now: 5 })).toBe(idleHoldem);
  });

  it('transitions with the chosen style once the new view is ready, and only from preparing', () => {
    expect(run(preparing, { type: 'ready', style: 'swing' })).toMatchObject({ phase: 'transitioning', style: 'swing' });
    expect(run(idleHoldem, { type: 'ready', style: 'swing' })).toBe(idleHoldem);
  });

  it('hands over with a crossfade if the new view is not ready within 8 s', () => {
    expect(SWITCH_READY_TIMEOUT_MS).toBe(8000);
    expect(run(preparing, { type: 'tick', now: 8999 })).toBe(preparing);
    expect(run(preparing, { type: 'tick', now: 9000 })).toMatchObject({ phase: 'transitioning', style: 'crossfade' });
  });

  it('finishes by showing the new mode', () => {
    const s = run(preparing, { type: 'ready', style: 'dip' }, { type: 'done', now: 2000 });
    expect(s).toEqual({ ...initialSwitchFlow, shown: 'blackjack' });
    expect(run(preparing, { type: 'done', now: 2000 })).toBe(preparing);
  });

  it('queues a mode arriving mid-switch and runs it from idle after done (latest wins)', () => {
    const swinging = run(preparing, { type: 'ready', style: 'swing' });
    const queued = run(swinging, { type: 'mode', mode: 'holdem', now: 1500 });
    expect(queued.queued).toBe('holdem');
    expect(queued.phase).toBe('transitioning');
    expect(run(queued, { type: 'done', now: 2300 })).toEqual({
      phase: 'preparing', shown: 'blackjack', from: 'blackjack', to: 'holdem', queued: null, style: null, since: 2300,
    });
  });

  it('drops the queue when the latest mode is the one already being switched to', () => {
    const swinging = run(preparing, { type: 'ready', style: 'swing' });
    const s = run(swinging, { type: 'mode', mode: 'holdem', now: 1 }, { type: 'mode', mode: 'blackjack', now: 2 });
    expect(s.queued).toBeNull();
    expect(run(s, { type: 'done', now: 3 })).toEqual({ ...initialSwitchFlow, shown: 'blackjack' });
  });

  it('resets when the mode goes away', () => {
    expect(run(preparing, { type: 'mode', mode: null, now: 5 })).toEqual(initialSwitchFlow);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/switch/switchFlow.test.ts --root packages/frontend`
Expected: FAIL, cannot resolve `./switchFlow`.

- [ ] **Step 3: Create `packages/frontend/src/switch/switchFlow.ts`**

```ts
import type { GameMode } from '@poker-blackjack/server/src/table';

// Table switch (lobby spec §3.4, §4), keyed on the game mode: an admin switch keeps the status
// at-table, so only the mode says a switch happened. Pure; TableSwitcher drives it.
export type SwitchStyle = 'swing' | 'crossfade' | 'dip';
export type SwitchPhase = 'idle' | 'preparing' | 'transitioning';

export interface SwitchFlowState {
  phase: SwitchPhase;
  shown: GameMode | null;
  from: GameMode | null;
  to: GameMode | null;
  queued: GameMode | null;
  style: SwitchStyle | null;
  since: number;
}

export type SwitchFlowEvent =
  | { type: 'mode'; mode: GameMode | null; now: number }
  | { type: 'set'; mode: GameMode | null }
  | { type: 'ready'; style: SwitchStyle }
  | { type: 'tick'; now: number }
  | { type: 'done'; now: number };

export const SWITCH_READY_TIMEOUT_MS = 8000;

export const initialSwitchFlow: SwitchFlowState = {
  phase: 'idle',
  shown: null,
  from: null,
  to: null,
  queued: null,
  style: null,
  since: 0,
};

function prepare(from: GameMode, to: GameMode, now: number): SwitchFlowState {
  return { phase: 'preparing', shown: from, from, to, queued: null, style: null, since: now };
}

export function switchFlowReducer(s: SwitchFlowState, e: SwitchFlowEvent): SwitchFlowState {
  switch (e.type) {
    case 'set':
      return s.phase === 'idle' && s.shown === e.mode ? s : { ...initialSwitchFlow, shown: e.mode };
    case 'mode': {
      if (e.mode === null) return initialSwitchFlow;
      if (s.phase === 'idle') {
        if (s.shown === null) return { ...s, shown: e.mode };
        return e.mode === s.shown ? s : prepare(s.shown, e.mode, e.now);
      }
      // Mid-switch: let it finish, then run the latest mode from idle (§4).
      const queued = e.mode === s.to ? null : e.mode;
      return queued === s.queued ? s : { ...s, queued };
    }
    case 'ready':
      return s.phase === 'preparing' ? { ...s, phase: 'transitioning', style: e.style } : s;
    case 'tick':
      return s.phase === 'preparing' && e.now - s.since >= SWITCH_READY_TIMEOUT_MS
        ? { ...s, phase: 'transitioning', style: 'crossfade' }
        : s;
    case 'done': {
      if (s.phase !== 'transitioning' || s.to === null) return s;
      const shown = s.to;
      if (s.queued !== null && s.queued !== shown) return prepare(shown, s.queued, e.now);
      return { ...initialSwitchFlow, shown };
    }
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/switch/switchFlow.test.ts --root packages/frontend`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/switch/switchFlow.ts packages/frontend/src/switch/switchFlow.test.ts
git commit -m "feat(switch): pure switch reducer with ready timeout and a latest-wins queue"
```

---

### Task 10: Camera yaw and the motion-blur pass in `SceneRoot`

**Files:**
- Create: `packages/frontend/src/three/engine/motionBlur.ts`
- Create: `packages/frontend/src/three/engine/motionBlur.test.ts`
- Modify: `packages/frontend/src/three/engine/SceneRoot.ts`

**Interfaces:**
- Produces: `MOTION_BLUR_SAMPLES = 16`, `MotionBlurShader` (`defines: { SAMPLES }`, uniforms `tDiffuse`, `amount`); `SceneRoot.setViewYaw(deg: number): void` (turns the fitted camera about world Y, on the spot, and is re-applied after every resize); `SceneRoot.setMotionBlur(amount: number): void` (blur length as a fraction of screen width; the pass is disabled at 0).

The blur pass sits after the RenderPass (and bloom on high) and before the OutputPass. The composer's render targets are half-float, so the blur runs in floating point on linear HDR colour, before tone mapping and 8-bit output. That avoids the banding the previews showed (§3.4). Low quality has no composer, so no blur (deviation 2).

- [ ] **Step 1: Write the failing test** — `packages/frontend/src/three/engine/motionBlur.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MOTION_BLUR_SAMPLES, MotionBlurShader } from './motionBlur';

const fs = MotionBlurShader.fragmentShader;

describe('motion-blur shader (lobby spec §3.4)', () => {
  it('takes at least 16 samples per pixel', () => {
    expect(MOTION_BLUR_SAMPLES).toBeGreaterThanOrEqual(16);
    expect(MotionBlurShader.defines.SAMPLES).toBe(MOTION_BLUR_SAMPLES);
    expect(fs).toMatch(/i < SAMPLES/);
  });

  it('jitters the sample offsets per pixel', () => {
    expect(fs).toMatch(/gl_FragCoord/);
    expect(fs).toMatch(/jitter/);
  });

  it('blurs along screen X from the current frame only: no history texture, no stacking', () => {
    expect(Object.keys(MotionBlurShader.uniforms).sort()).toEqual(['amount', 'tDiffuse']);
    expect(fs).toMatch(/vec2\(t \* amount, 0\.0\)/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/three/engine/motionBlur.test.ts --root packages/frontend`
Expected: FAIL, cannot resolve `./motionBlur`.

- [ ] **Step 3: Create `packages/frontend/src/three/engine/motionBlur.ts`**

```ts
// Speed-scaled horizontal motion blur for the table-switch swing (lobby spec L7, §3.4). One pass
// over the current frame only: no frame history or canvas stacking, which is what banded in the 2D
// previews. Per-pixel jitter turns the stepped copies a fixed tap pattern leaves into fine noise,
// which the grade pass's grain then hides.
export const MOTION_BLUR_SAMPLES = 16;

export const MotionBlurShader = {
  defines: { SAMPLES: MOTION_BLUR_SAMPLES },
  uniforms: {
    tDiffuse: { value: null as unknown },
    // Blur length as a fraction of screen width (SwingDriver sets it from the swing speed).
    amount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      float jitter = hash(gl_FragCoord.xy) - 0.5;
      vec4 sum = vec4(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        float t = (float(i) + 0.5 + jitter) / float(SAMPLES) - 0.5;
        sum += texture2D(tDiffuse, vUv + vec2(t * amount, 0.0));
      }
      gl_FragColor = sum / float(SAMPLES);
    }
  `,
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/three/engine/motionBlur.test.ts --root packages/frontend`
Expected: PASS (3 tests).

- [ ] **Step 5: Add yaw and blur to `packages/frontend/src/three/engine/SceneRoot.ts`**

Import: `import { MotionBlurShader } from './motionBlur';`. Above the class:

```ts
const WORLD_UP = new THREE.Vector3(0, 1, 0);
```

Fields (with the other privates):

```ts
  private blur: ShaderPass | null = null;
  private blurAmount = 0;
  // The fitted camera orientation, and the table-switch turn applied on top (lobby spec §3.4).
  private baseQuat = new THREE.Quaternion();
  private yawQuat = new THREE.Quaternion();
  private viewYawDeg = 0;
```

In `setSize`, right after `this.camera.lookAt(fit.look);`:

```ts
    this.baseQuat.copy(this.camera.quaternion);
    this.applyViewYaw();
```

In `applyQuality`, add `this.blur = null;` next to `this.grade = null;`, and between the bloom block and `composer.addPass(new OutputPass());`:

```ts
      // Before OutputPass, so it blurs the half-float linear image (no 8-bit banding, spec §3.4).
      this.blur = new ShaderPass(MotionBlurShader);
      this.blur.uniforms.amount.value = this.blurAmount;
      this.blur.enabled = this.blurAmount > 0;
      composer.addPass(this.blur);
```

New public methods (after `setReducedMotion`):

```ts
  // Table-switch swing (lobby spec L7): turn on the spot about world Y, on top of the fitted view.
  // No crane arc: position, height and FOV never change.
  setViewYaw(deg: number): void {
    this.viewYawDeg = deg;
    this.applyViewYaw();
  }

  // Blur length as a fraction of screen width; 0 disables the pass. Low quality has no composer,
  // so no blur there.
  setMotionBlur(amount: number): void {
    this.blurAmount = Math.max(0, amount);
    if (this.blur) {
      this.blur.uniforms.amount.value = this.blurAmount;
      this.blur.enabled = this.blurAmount > 0;
    }
  }

  private applyViewYaw(): void {
    this.yawQuat.setFromAxisAngle(WORLD_UP, THREE.MathUtils.degToRad(this.viewYawDeg));
    this.camera.quaternion.copy(this.baseQuat).premultiply(this.yawQuat);
  }
```

- [ ] **Step 6: Run everything**

Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck`
Expected: PASS. With yaw 0 and blur 0 the table renders exactly as before (the pass is disabled); gate 3 re-checks this on the unswung frames.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/three/engine/motionBlur.ts packages/frontend/src/three/engine/motionBlur.test.ts packages/frontend/src/three/engine/SceneRoot.ts
git commit -m "feat(3d): camera yaw and a single-pass jittered motion blur for the table switch"
```

---

### Task 11: `SwingDriver` and `TableSwitcher`

**Files:**
- Create: `packages/frontend/src/switch/SwingDriver.ts`, `SwingDriver.test.ts`
- Create: `packages/frontend/src/switch/TableSwitcher.tsx`, `TableSwitcher.test.tsx`

**Interfaces:**
- Consumes: `swingPose`, `SWING_MS`, `SWING_DEG` (Task 8); `switchFlowReducer`, `initialSwitchFlow`, `SwitchStyle` (Task 9).
- Produces:
  - `SwingDriver.ts`: `interface SwingTarget { setViewYaw(deg: number): void; setMotionBlur(amount: number): void; advance(seconds: number): void }` (`SceneRoot` satisfies it), `class SwingDriver { constructor(targets: { old: SwingTarget; next: SwingTarget }, cb: { onSwap: () => void; onDone: () => void }); readonly finished: boolean; advance(dtMs: number): void }`.
  - `TableSwitcher.tsx`: `type ViewKind = 'scene' | 'flat'`, `CROSSFADE_MS = 300`, `DIP_OUT_MS = 260`, `DIP_IN_MS = 420`, `interface SwitchLayer { mode: GameMode; table: TableStateView; mySeatIndex: number | null; onViewReady: (kind: ViewKind) => void; onScene: (scene: SwingTarget | null) => void }`, `interface TableSwitcherProps { table: TableStateView; mySeatIndex: number | null; active: boolean; reducedMotion: boolean; onShownViewReady: () => void; renderView: (layer: SwitchLayer) => ReactNode }`, `TableSwitcher(props)`, `pickStyle(reducedMotion: boolean, fromKind: ViewKind | undefined, toKind: ViewKind, scenesReady: boolean): SwitchStyle`.

`SwingDriver` pre-poses the incoming camera at −90° and on each `advance` poses the visible camera, then calls its `advance(0)`. That draws the posed frame synchronously in the same tick, so the scene's own rAF can't show it a frame late. It calls `onSwap` once at 650 ms and `onDone` once at 1300 ms (both in one call if a single step jumps past the end) and leaves the new camera at yaw 0 with no blur.

`TableSwitcher` keeps the last view of each mode. When idle it renders `[shown]`; while switching it renders a keyed `[from, to]`, so the incoming view is the same instance that stays afterwards (no remount, no second load). The old layer shows its last frozen table; the new one shows the live table, mounted hidden (`visibility: hidden`, which keeps rendering and layout). The incoming layer's `onViewReady` picks the style: reduced motion → crossfade; both views 3D with scenes → swing; otherwise → dip. Crossfade is the old layer fading over the new for 300 ms. Dip is a black overlay, 260 ms out, swap, 420 ms in. On the swing's swap, the layers' visibility is flipped imperatively, in the same frame the incoming camera is posed (a React commit would land a frame late and show as a hitch). `active` is false while the doors are up: then a mode change is a `set`, with no transition.

- [ ] **Step 1: Write the failing tests**

`packages/frontend/src/switch/SwingDriver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SwingDriver } from './SwingDriver';

const target = () => ({ setViewYaw: vi.fn(), setMotionBlur: vi.fn(), advance: vi.fn() });
const yaws = (t: ReturnType<typeof target>) => t.setViewYaw.mock.calls.map((c) => c[0] as number);

function setup() {
  const old = target();
  const next = target();
  const cb = { onSwap: vi.fn(), onDone: vi.fn() };
  const driver = new SwingDriver({ old, next }, cb);
  return { old, next, cb, driver };
}

describe('SwingDriver (lobby spec §3.4)', () => {
  it('waits with the incoming camera turned away, unblurred', () => {
    const { next } = setup();
    expect(next.setViewYaw).toHaveBeenCalledWith(-90);
    expect(next.setMotionBlur).toHaveBeenCalledWith(0);
  });

  it('turns the old camera 0 → 90 before the swap, then the new one -90 → 0', () => {
    const { old, next, driver } = setup();
    for (let i = 0; i < 100; i++) driver.advance(16);
    const o = yaws(old);
    expect(o.every((y) => y >= 0 && y <= 90)).toBe(true);
    expect(o.every((y, i) => i === 0 || y >= o[i - 1])).toBe(true);
    const n = yaws(next).slice(1); // skip the -90 pre-pose
    expect(n.every((y) => y >= -90 && y <= 0)).toBe(true);
    expect(n.every((y, i) => i === 0 || y >= n[i - 1])).toBe(true);
    expect(n[n.length - 1]).toBe(0);
  });

  it('swaps once at 650 ms and finishes once at 1300 ms', () => {
    const { cb, driver } = setup();
    driver.advance(649);
    expect(cb.onSwap).not.toHaveBeenCalled();
    driver.advance(1);
    expect(cb.onSwap).toHaveBeenCalledTimes(1);
    driver.advance(649);
    expect(cb.onDone).not.toHaveBeenCalled();
    driver.advance(1);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(driver.finished).toBe(true);
    driver.advance(100);
    expect(cb.onSwap).toHaveBeenCalledTimes(1);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('handles one step past the end: swap, then done, at rest with no blur', () => {
    const { next, cb, driver } = setup();
    driver.advance(5000);
    expect(cb.onSwap).toHaveBeenCalledTimes(1);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(next.setViewYaw).toHaveBeenLastCalledWith(0);
    expect(next.setMotionBlur).toHaveBeenLastCalledWith(0);
  });

  it('draws the visible scene right after posing it', () => {
    const { old, next, driver } = setup();
    driver.advance(100);
    expect(old.advance).toHaveBeenLastCalledWith(0);
    expect(next.advance).not.toHaveBeenCalled();
    driver.advance(700);
    expect(next.advance).toHaveBeenLastCalledWith(0);
  });
});
```

`packages/frontend/src/switch/TableSwitcher.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableStateView } from '@poker-blackjack/server/src/table';
import { makeBlackjackPlayingState, makeHoldemPreflopState } from '../fixtures/tableStateFixtures';
import { SWITCH_READY_TIMEOUT_MS } from './switchFlow';
import { CROSSFADE_MS, DIP_IN_MS, DIP_OUT_MS, TableSwitcher, pickStyle, type SwitchLayer, type TableSwitcherProps } from './TableSwitcher';

const makeScene = () => ({ setViewYaw: vi.fn(), setMotionBlur: vi.fn(), advance: vi.fn() });
let scenes: Record<string, ReturnType<typeof makeScene>>;

// Stands in for TableView: hands over a fake scene and exposes the two ready signals.
function FakeView({ layer }: { layer: SwitchLayer }) {
  useEffect(() => {
    layer.onScene(scenes[layer.mode]);
    return () => layer.onScene(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div data-testid={`view-${layer.mode}`}>
      <button onClick={() => layer.onViewReady('flat')}>flat-{layer.mode}</button>
      <button onClick={() => layer.onViewReady('scene')}>scene-{layer.mode}</button>
    </div>
  );
}

const holdem = makeHoldemPreflopState();
const blackjack = makeBlackjackPlayingState();
const layerOf = (mode: string) => screen.getByTestId(`view-${mode}`).parentElement as HTMLElement;
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

function setup(over: Partial<TableSwitcherProps> = {}) {
  const props: TableSwitcherProps = {
    table: holdem,
    mySeatIndex: 0,
    active: true,
    reducedMotion: false,
    onShownViewReady: vi.fn(),
    renderView: (layer) => <FakeView layer={layer} />,
    ...over,
  };
  const utils = render(<TableSwitcher {...props} />);
  const switchTo = (table: TableStateView) => utils.rerender(<TableSwitcher {...props} table={table} />);
  return { props, switchTo };
}

beforeEach(() => {
  scenes = { holdem: makeScene(), blackjack: makeScene() };
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  });
});
afterEach(() => vi.useRealTimers());

describe('TableSwitcher (lobby spec §3.4, L8, L9)', () => {
  it('shows one view and reports when it is ready (the door entry waits for this)', () => {
    const { props } = setup();
    expect(screen.queryByTestId('view-blackjack')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('flat-holdem'));
    expect(props.onShownViewReady).toHaveBeenCalledTimes(1);
  });

  it('keeps the old view on screen while the new one loads hidden (L8)', () => {
    const { switchTo } = setup();
    switchTo(blackjack);
    expect(layerOf('holdem').style.visibility).toBe('visible');
    expect(layerOf('blackjack').style.visibility).toBe('hidden');
    expect(layerOf('blackjack')).toHaveAttribute('aria-hidden', 'true');
  });

  it('dips to black when the new view is flat: 260 ms out, swap, 420 ms in (L9)', () => {
    const { switchTo } = setup();
    fireEvent.click(screen.getByText('flat-holdem'));
    switchTo(blackjack);
    fireEvent.click(screen.getByText('flat-blackjack'));
    tick(DIP_OUT_MS);
    expect(layerOf('blackjack').style.visibility).toBe('visible');
    expect(screen.getByTestId('view-holdem')).toBeInTheDocument();
    tick(DIP_IN_MS);
    expect(screen.queryByTestId('view-holdem')).not.toBeInTheDocument();
    expect(layerOf('blackjack').style.visibility).toBe('visible');
  });

  it('crossfades for 300 ms under reduced motion (L9)', () => {
    const { switchTo } = setup({ reducedMotion: true });
    fireEvent.click(screen.getByText('scene-holdem'));
    switchTo(blackjack);
    fireEvent.click(screen.getByText('scene-blackjack'));
    tick(1);
    expect(layerOf('holdem').style.opacity).toBe('0');
    expect(layerOf('blackjack').style.visibility).toBe('visible');
    tick(CROSSFADE_MS);
    expect(screen.queryByTestId('view-holdem')).not.toBeInTheDocument();
  });

  it('swings between two 3D views: old camera up to 90°, new one ending at 0 (L7)', () => {
    const { switchTo } = setup();
    fireEvent.click(screen.getByText('scene-holdem'));
    switchTo(blackjack);
    fireEvent.click(screen.getByText('scene-blackjack'));
    tick(1400);
    expect(screen.queryByTestId('view-holdem')).not.toBeInTheDocument();
    const oldYaws = scenes.holdem.setViewYaw.mock.calls.map((c) => c[0] as number);
    expect(Math.max(...oldYaws)).toBeLessThanOrEqual(90);
    expect(Math.max(...oldYaws)).toBeGreaterThan(80);
    expect(scenes.blackjack.setViewYaw.mock.calls[0][0]).toBe(-90);
    expect(scenes.blackjack.setViewYaw).toHaveBeenLastCalledWith(0);
    expect(scenes.blackjack.setMotionBlur).toHaveBeenLastCalledWith(0);
  });

  it('crossfades anyway if the new view is not ready within 8 s (§4)', () => {
    const { switchTo } = setup();
    switchTo(blackjack);
    tick(SWITCH_READY_TIMEOUT_MS + 250);
    tick(CROSSFADE_MS);
    expect(screen.queryByTestId('view-holdem')).not.toBeInTheDocument();
  });

  it('just replaces the view while the doors are still up', () => {
    const { switchTo } = setup({ active: false });
    switchTo(blackjack);
    expect(screen.queryByTestId('view-holdem')).not.toBeInTheDocument();
    expect(screen.getByTestId('view-blackjack')).toBeInTheDocument();
  });
});

describe('pickStyle', () => {
  it('crossfades under reduced motion, swings between two ready scenes, and dips otherwise', () => {
    expect(pickStyle(true, 'scene', 'scene', true)).toBe('crossfade');
    expect(pickStyle(false, 'scene', 'scene', true)).toBe('swing');
    expect(pickStyle(false, 'scene', 'scene', false)).toBe('dip');
    expect(pickStyle(false, 'flat', 'scene', true)).toBe('dip');
    expect(pickStyle(false, 'scene', 'flat', true)).toBe('dip');
    expect(pickStyle(false, undefined, 'scene', true)).toBe('dip');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/switch/SwingDriver.test.ts src/switch/TableSwitcher.test.tsx --root packages/frontend`
Expected: FAIL, cannot resolve `./SwingDriver` / `./TableSwitcher`.

- [ ] **Step 3: Create `packages/frontend/src/switch/SwingDriver.ts`**

```ts
import { SWING_DEG, SWING_MS, swingPose } from './swingCurve';

// What the swing needs from a table scene; SceneRoot satisfies it.
export interface SwingTarget {
  setViewYaw(deg: number): void;
  setMotionBlur(amount: number): void;
  advance(seconds: number): void;
}

// Plays the 180° swing across two scenes (lobby spec §3.4). Each step poses the visible camera and
// draws it at once (advance(0)), so the scene's own rAF can't show the pose a frame late.
export class SwingDriver {
  private ms = 0;
  private swapped = false;
  private done = false;

  constructor(
    private readonly targets: { old: SwingTarget; next: SwingTarget },
    private readonly cb: { onSwap: () => void; onDone: () => void },
  ) {
    // The incoming camera waits turned away, so its first visible frame continues the turn.
    targets.next.setMotionBlur(0);
    targets.next.setViewYaw(-SWING_DEG / 2);
  }

  get finished(): boolean {
    return this.done;
  }

  advance(dtMs: number): void {
    if (this.done) return;
    this.ms = Math.min(SWING_MS, this.ms + Math.max(0, dtMs));
    const pose = swingPose(this.ms);
    const { old, next } = this.targets;
    if (pose.showing === 'old') {
      old.setViewYaw(pose.yawDeg);
      old.setMotionBlur(pose.blur);
      old.advance(0);
    } else {
      if (!this.swapped) {
        this.swapped = true;
        old.setMotionBlur(0);
        this.cb.onSwap();
      }
      next.setViewYaw(pose.yawDeg);
      next.setMotionBlur(pose.blur);
      next.advance(0);
    }
    if (this.ms >= SWING_MS) {
      this.done = true;
      next.setViewYaw(0);
      next.setMotionBlur(0);
      this.cb.onDone();
    }
  }
}
```

- [ ] **Step 4: Create `packages/frontend/src/switch/TableSwitcher.tsx`**

```tsx
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { GameMode, TableStateView } from '@poker-blackjack/server/src/table';
import { initialSwitchFlow, switchFlowReducer, type SwitchStyle } from './switchFlow';
import { SwingDriver, type SwingTarget } from './SwingDriver';

// Admin table switch (lobby spec §3.4, L7–L9): the old table stays on screen while the new one
// loads hidden, then a swing, crossfade or dip hands over. Keyed layers keep the incoming view
// mounted across the hand-over, so nothing loads twice.
export type ViewKind = 'scene' | 'flat';
export const CROSSFADE_MS = 300;
export const DIP_OUT_MS = 260;
export const DIP_IN_MS = 420;

export interface SwitchLayer {
  mode: GameMode;
  table: TableStateView;
  mySeatIndex: number | null;
  onViewReady: (kind: ViewKind) => void;
  onScene: (scene: SwingTarget | null) => void;
}

export interface TableSwitcherProps {
  table: TableStateView;
  mySeatIndex: number | null;
  // False while the saloon doors are up: a mode change then just replaces the view.
  active: boolean;
  reducedMotion: boolean;
  // The shown view is ready (the door entry waits for this).
  onShownViewReady: () => void;
  renderView: (layer: SwitchLayer) => ReactNode;
}

export function pickStyle(
  reducedMotion: boolean,
  fromKind: ViewKind | undefined,
  toKind: ViewKind,
  scenesReady: boolean,
): SwitchStyle {
  if (reducedMotion) return 'crossfade';
  if (fromKind === 'scene' && toKind === 'scene' && scenesReady) return 'swing';
  return 'dip';
}

export function TableSwitcher({ table, mySeatIndex, active, reducedMotion, onShownViewReady, renderView }: TableSwitcherProps) {
  const mode = table.gameMode;
  // The last view of each mode: the old table keeps showing its final state while unseated
  // in between (spec §3.4).
  const last = useRef<Partial<Record<GameMode, { table: TableStateView; mySeatIndex: number | null }>>>({});
  last.current[mode] = { table, mySeatIndex };
  const [sw, dispatch] = useReducer(switchFlowReducer, initialSwitchFlow);
  const swRef = useRef(sw);
  swRef.current = sw;
  const kinds = useRef<Partial<Record<GameMode, ViewKind>>>({});
  const scenes = useRef<Partial<Record<GameMode, SwingTarget | null>>>({});
  const els = useRef<Partial<Record<GameMode, HTMLDivElement | null>>>({});
  const latest = useRef({ reducedMotion, onShownViewReady });
  latest.current = { reducedMotion, onShownViewReady };
  const [swapped, setSwapped] = useState(false);
  const [fading, setFading] = useState(false);
  const [dip, setDip] = useState({ opacity: 0, ms: DIP_OUT_MS });

  // Layout effect: the switch must start before paint, or the new table would flash in the old one's place.
  useLayoutEffect(() => {
    dispatch(active ? { type: 'mode', mode, now: Date.now() } : { type: 'set', mode });
  }, [mode, active]);

  useEffect(() => {
    if (sw.phase !== 'preparing') return;
    setSwapped(false);
    setFading(false);
    setDip({ opacity: 0, ms: DIP_OUT_MS });
    const id = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 250);
    return () => clearInterval(id);
  }, [sw.phase, sw.to]);

  useEffect(() => {
    if (sw.phase !== 'transitioning' || !sw.from || !sw.to) return;
    const from = sw.from;
    const to = sw.to;
    const finish = () => dispatch({ type: 'done', now: Date.now() });

    if (sw.style === 'swing') {
      const old = scenes.current[from];
      const next = scenes.current[to];
      if (!old || !next) {
        finish();
        return;
      }
      const driver = new SwingDriver(
        { old, next },
        {
          onSwap: () => {
            // Same frame as the first posed frame of the new camera; a React commit lands a frame late.
            const a = els.current[from];
            const b = els.current[to];
            if (a) a.style.visibility = 'hidden';
            if (b) b.style.visibility = 'visible';
            setSwapped(true);
          },
          onDone: finish,
        },
      );
      let raf = 0;
      let lastTs: number | null = null;
      const step = (ts: number) => {
        driver.advance(lastTs === null ? 0 : ts - lastTs);
        lastTs = ts;
        if (!driver.finished) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }

    if (sw.style === 'crossfade') {
      setFading(true);
      const id = setTimeout(finish, CROSSFADE_MS);
      return () => clearTimeout(id);
    }

    setDip({ opacity: 1, ms: DIP_OUT_MS });
    let inTimer: ReturnType<typeof setTimeout> | undefined;
    const outTimer = setTimeout(() => {
      setSwapped(true);
      setDip({ opacity: 0, ms: DIP_IN_MS });
      inTimer = setTimeout(finish, DIP_IN_MS);
    }, DIP_OUT_MS);
    return () => {
      clearTimeout(outTimer);
      clearTimeout(inTimer);
    };
  }, [sw.phase, sw.style, sw.from, sw.to]);

  const onViewReady = useCallback((m: GameMode, kind: ViewKind) => {
    kinds.current[m] = kind;
    const s = swRef.current;
    if (s.phase === 'idle' && m === s.shown) latest.current.onShownViewReady();
    if (s.phase === 'preparing' && s.from && m === s.to) {
      const ready = !!scenes.current[s.from] && !!scenes.current[m];
      dispatch({ type: 'ready', style: pickStyle(latest.current.reducedMotion, kinds.current[s.from], kind, ready) });
    }
  }, []);

  const switching = sw.phase !== 'idle' && sw.from !== null && sw.to !== null;
  const modes: GameMode[] = switching ? [sw.from as GameMode, sw.to as GameMode] : [sw.shown ?? mode];
  const visible = !switching ? modes[0] : sw.phase === 'transitioning' && swapped ? sw.to : sw.from;
  const crossfading = switching && sw.phase === 'transitioning' && sw.style === 'crossfade';

  return (
    <>
      {modes.map((m) => {
        const view = m === mode ? { table, mySeatIndex } : last.current[m];
        if (!view) return null;
        const isOld = switching && m === sw.from;
        const shown = m === visible || crossfading;
        return (
          <div
            key={m}
            ref={(el) => {
              els.current[m] = el;
            }}
            className={switching ? 'fixed inset-0 overflow-auto' : 'relative'}
            aria-hidden={shown ? undefined : true}
            style={{
              visibility: shown ? 'visible' : 'hidden',
              pointerEvents: switching ? 'none' : undefined,
              zIndex: switching ? (isOld ? 2 : 1) : undefined,
              opacity: crossfading && isOld && fading ? 0 : 1,
              transition: crossfading ? `opacity ${CROSSFADE_MS}ms linear` : undefined,
            }}
          >
            {renderView({
              mode: m,
              table: view.table,
              mySeatIndex: view.mySeatIndex,
              onViewReady: (kind) => onViewReady(m, kind),
              onScene: (scene) => {
                scenes.current[m] = scene;
              },
            })}
          </div>
        );
      })}
      {switching && sw.style === 'dip' && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 bg-black"
          style={{ zIndex: 3, opacity: dip.opacity, transition: `opacity ${dip.ms}ms ease-in-out` }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/switch --root packages/frontend`
Expected: PASS (all four `src/switch` test files). If the swing test reports no `setViewYaw` calls on the old scene, check that this vitest version fakes `requestAnimationFrame` with the `toFake` list above (`npx vitest --version`); do not replace the rAF loop with timers to make it pass.

- [ ] **Step 6: Extend the import guard** in `packages/frontend/src/hud/noThree.test.ts`: add `...sourceFiles(join(SRC, 'switch'))` to the `stack` array and `src/switch` to the test title.

Run: `npx vitest run src/hud/noThree.test.ts --root packages/frontend` — expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/switch packages/frontend/src/hud/noThree.test.ts
git commit -m "feat(switch): swing driver and the layered TableSwitcher (swing, crossfade, dip)"
```

---

### Task 12: Wire the switch into `App`, and the `?game=swing` harness

**Files:**
- Modify: `packages/frontend/src/three/TableStage.tsx` (`onScene`)
- Modify: `packages/frontend/src/three/Blackjack3D.tsx`, `Poker3D.tsx` (pass-through)
- Modify: `packages/frontend/src/three/Blackjack3D.test.tsx`
- Modify: `packages/frontend/src/App.tsx`, `packages/frontend/src/App.test.tsx`
- Modify: `packages/frontend/src/three/devHarness.tsx`

**Interfaces:**
- Consumes: `TableSwitcher`, `ViewKind`, `SwitchLayer` (Task 11); `SwingDriver`, `SwingTarget` (Task 11); `SceneRoot.setViewYaw` / `setMotionBlur` (Task 10).
- Produces: `TableStageProps.onScene?: (scene: SceneRoot | null) => void` (called with the scene after it is built, and with `null` on teardown); the same optional prop on `Blackjack3DProps` / `Poker3DProps`; `TableView` props `onViewReady: (kind: ViewKind) => void` and `onScene?: (scene: SwingTarget | null) => void`. Harness `/dev3d.html?game=swing` exposes `window.__swing = { start(): void; advance(ms: number): void; visible(): 'old' | 'next'; scenes: { old: SceneRoot | null; next: SceneRoot | null } }`.

- [ ] **Step 1: Write the failing tests**

In `packages/frontend/src/three/Blackjack3D.test.tsx`:

```tsx
  it('hands its scene to onScene and clears it on unmount (lobby spec §3.4)', () => {
    const onScene = vi.fn();
    const { unmount } = render(<Blackjack3D {...props({ onScene })} />);
    expect(onScene).toHaveBeenLastCalledWith(created[created.length - 1]);
    unmount();
    expect(onScene).toHaveBeenLastCalledWith(null);
  });
```

In `packages/frontend/src/App.test.tsx`, inside `describe('App')`:

```tsx
  it('switches tables when the admin changes the game, without leaving the table (lobby spec §3.4)', async () => {
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
    await waitFor(() => expect(screen.queryByTestId('entrance')).not.toBeInTheDocument());
    act(() => {
      handlers.get('state')?.(makeAppState(makeBlackjackPlayingState(), { mySeatIndex: 0 }));
    });
    // The flat view switches with a dip to black (260 + 420 ms).
    expect(await screen.findByRole('button', { name: 'Hit' }, { timeout: 2000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Fold' })).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.queryByTestId('entrance')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/three/Blackjack3D.test.tsx src/App.test.tsx --root packages/frontend`
Expected: the `onScene` test FAILS (never called). The App switch test may already pass (today the view just re-renders with the new table); it guards the wiring. After Step 4, check it by temporarily passing `active={false}`: the test must still pass, and the dip must be skipped. Then restore. This proves the test exercises the real path either way and that nothing waits on a swing that can't happen in jsdom.

- [ ] **Step 3: `onScene` through the 3D shells**

`TableStage.tsx`: add to `TableStageProps`:

```ts
  // The live scene, for the table-switch swing (lobby spec §3.4); null when it is torn down.
  onScene?: (scene: SceneRoot | null) => void;
```

Destructure `onScene`, keep it in a ref (`const sceneCbRef = useRef(onScene); sceneCbRef.current = onScene;`), call `sceneCbRef.current?.(scene);` right after `scene.onFirstFrame = …` in the mount effect, and `sceneCbRef.current?.(null);` at the start of that effect's cleanup.

`Blackjack3D.tsx` / `Poker3D.tsx`: add `onScene?: TableStageProps['onScene'];` to the props interface (import `type TableStageProps` from `./TableStage`), destructure it and pass `onScene={onScene}` to `<TableStage>`.

- [ ] **Step 4: Render tables through `TableSwitcher` in `packages/frontend/src/App.tsx`**

Imports: `import { TableSwitcher, type ViewKind } from './switch/TableSwitcher';` and `import type { SwingTarget } from './switch/SwingDriver';` (neither imports three).

`TableView`: change the `onViewReady` prop type to `(kind: ViewKind) => void`, add `onScene?: (scene: SwingTarget | null) => void;` to the props type and destructuring, and add `onScene,` to `sharedProps`.

Replace the `{atTable && state.table && ( <TableView … /> )}` block from Task 7 with:

```tsx
      {atTable && state.table && (
        <TableSwitcher
          table={state.table}
          mySeatIndex={state.mySeatIndex}
          active={flow.phase === 'gone'}
          reducedMotion={reducedMotion}
          onShownViewReady={onTableReady}
          renderView={(layer) => (
            <TableView
              table={layer.table}
              mySeatIndex={layer.mySeatIndex}
              connectionStatus={status}
              errorMessage={errorMessage ?? layer.table.handStartError}
              actionPending={actionPending}
              onReady={sendReady}
              onAction={sendAction}
              onLeave={leave}
              onViewReady={layer.onViewReady}
              onScene={layer.onScene}
            />
          )}
        />
      )}
```

- [ ] **Step 5: The swing harness** in `packages/frontend/src/three/devHarness.tsx`

Imports: add `useEffect, useRef` to the React import, `import type { SceneRoot } from './engine/SceneRoot';` and `import { SwingDriver } from '../switch/SwingDriver';`. Add above the `// ?layout=flat` comment:

```tsx
// ?game=swing mounts the Blackjack table (old) and the Hold'em table (next) for gate 3. The swing is
// stepped by hand from the console, so frames can be captured one at a time:
// __swing.start(); then repeatedly __swing.advance(1000 / 60) and capture __swing.scenes[__swing.visible()].
function SwingHarness() {
  const scenes = useRef<{ old: SceneRoot | null; next: SceneRoot | null }>({ old: null, next: null });
  const [visible, setVisible] = useState<'old' | 'next'>('old');
  useEffect(() => {
    let driver: SwingDriver | null = null;
    let now: 'old' | 'next' = 'old';
    (window as unknown as { __swing?: unknown }).__swing = {
      start() {
        const { old, next } = scenes.current;
        if (!old || !next) throw new Error('scenes not ready yet');
        now = 'old';
        driver = new SwingDriver({ old, next }, { onSwap: () => { now = 'next'; setVisible('next'); }, onDone: () => undefined });
      },
      advance(ms: number) {
        driver?.advance(ms);
      },
      visible: () => now,
      scenes: scenes.current,
    };
  }, []);
  const bj = STEPS[9];
  const he = POKER_STEPS[6];
  const layer = (shown: boolean) => ({ position: 'fixed' as const, inset: 0, visibility: shown ? ('visible' as const) : ('hidden' as const) });
  return (
    <>
      <div style={layer(visible === 'old')}>
        <Blackjack3D
          seats={seats(bj.count)}
          activeSeatIndex={bj.active}
          mySeatIndex={0}
          connectionStatus="at-table"
          handInProgress={bj.inProgress}
          blackjackRounds={bj.rounds}
          onReady={() => undefined}
          onLeave={() => undefined}
          onAction={() => undefined}
          onSwitchTo2D={() => undefined}
          onUnsupported={() => undefined}
          onScene={(s) => {
            scenes.current.old = s;
          }}
        />
      </div>
      <div style={layer(visible === 'next')}>
        <Poker3D
          seats={seats(he.count)}
          mySeatIndex={0}
          connectionStatus="at-table"
          handInProgress={he.inProgress}
          holdem={he.holdem}
          blinds={he.blinds}
          onReady={() => undefined}
          onLeave={() => undefined}
          onAction={() => undefined}
          onSwitchTo2D={() => undefined}
          onUnsupported={() => undefined}
          onScene={(s) => {
            scenes.current.next = s;
          }}
        />
      </div>
    </>
  );
}
```

Add `if (game === 'swing') return <SwingHarness />;` to the router from Task 4. If `STEPS[9]` or `POKER_STEPS[6]` is out of range in the current harness, use the steps Gate 1 of Plan A used for `bj-2` / `he-2` (step 9 / poker step 6) and say so in the commit message.

Add `?game=swing` to the `dev3d.html` comment.

- [ ] **Step 6: Run everything**

Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/three/TableStage.tsx packages/frontend/src/three/Blackjack3D.tsx packages/frontend/src/three/Poker3D.tsx packages/frontend/src/three/Blackjack3D.test.tsx packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx packages/frontend/src/three/devHarness.tsx packages/frontend/dev3d.html
git commit -m "feat(switch): tables switch through TableSwitcher; ?game=swing harness"
```

---

### Gate 3: the swing (controller + render subagent; the user approves)

Spec §6 gate 3, after phase d. Not an implementer task. **The gate fails** if any mid-swing frame shows banding, ghost copies, hard seams, overshoot, or a pause.

- [ ] **Step 1: Dispatch the render subagent** (model: sonnet) with this brief:

  > Render Gate 3: a frame sequence of the table-switch swing. Do not edit repo files.
  > 1. Start the save server in the background: `node scripts/render/save-server.cjs .playtest-data/lobby-gates/gate3` (port 3199).
  > 2. `preview_start` `{ name: "frontend" }`; `resize_window` 1280×720.
  > 3. Navigate to `http://localhost:5173/dev3d.html?game=swing&quality=high`, wait 4.5 s, then run in the page:
  >    ```js
  >    const w = window.__swing; const save = async (name, c) => { const r = await fetch(`http://127.0.0.1:3199/save?name=${name}.png`, { method: 'POST', body: c.toDataURL('image/png') }); await r.text(); };
  >    const grab = () => { const src = w.scenes[w.visible()].renderer.domElement; const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; };
  >    w.start(); const thumbs = []; const log = [];
  >    for (let f = 0; f <= 79; f++) { if (f > 0) w.advance(1000 / 60); const c = grab(); log.push(w.visible());
  >      await save(`swing-${String(f).padStart(2, '0')}`, c); if (f % 6 === 0) thumbs.push(c); }
  >    const sheet = document.createElement('canvas'); sheet.width = 4 * 320; sheet.height = Math.ceil(thumbs.length / 4) * 180; const g = sheet.getContext('2d');
  >    thumbs.forEach((c, i) => g.drawImage(c, (i % 4) * 320, Math.floor(i / 4) * 180, 320, 180)); await save('swing-sheet', sheet);
  >    log.join(',');
  >    ```
  >    Also save a 100% crop of the centre 640×360 of frames 30, 39 and 48 (draw with source rect) as `crop-30`, `crop-39`, `crop-48`.
  > 4. Reload and repeat at `&quality=medium` (frames only, prefix `med-`), and at `&quality=low` frames 0, 39, 79 only (prefix `low-`; low has no blur, by design).
  > 5. Write `.playtest-data/lobby-gates/gate3/findings.md`. For the mid-swing frames (about 20–60), say whether any shows banding (stepped bands in gradients), ghost copies (distinct repeated edges rather than a smooth smear), hard seams (a sharp edge in the room shell), overshoot (the view turning past the target and coming back), or a pause (two consecutive frames nearly identical away from the ends, especially around the swap at frame 39). Also say whether frames 0 and 79 look exactly like the static tables (no leftover yaw or blur), what passes between the tables (walls, back bar, window light) and whether the room looks too sparse for a 90° turn, and the console errors. Return a 12-line summary; no image data in your reply.

- [ ] **Step 2: Show the user** `swing-sheet.png`, frames 20, 30, 39, 48 and 60, and the three crops (`SendUserFile`, `display: render`), with the findings summary. Ask for approval against the fail list.
- [ ] **Step 3: If the gate fails or the user asks for changes,** make each change a follow-up task:
  - Blur strength: `MAX_BLUR` in `swingCurve.ts`.
  - Banding or ghosting: raise `MOTION_BLUR_SAMPLES` (keep ≥ 16) or adjust the jitter in `motionBlur.ts`.
  - A sparse room between the tables: additions to `room.ts` decided with the user (spec §3.4).
  - A pause at the swap: check the imperative swap in `TableSwitcher` and the `advance(0)` in `SwingDriver`.
  Re-run the affected tests and re-render. Record the settled values under "Deviations".

---

### Task 13: Docs and close-out (controller)

Not an implementer task.

- [ ] **Step 1: Docs.** Update `HANDOFF.md` "Next steps": saloon lobby shipped; gate outcomes and settled constants; the harness entries (`?game=doors`, `?game=swing`). Close `TODO.md` T-3 (fixed in Task 1). Add any Minor review findings to `TODO.md`. Check `docs/README.md` and any user guide for mentions of the old lobby or join screen (`grep -rn "Start Poker Night\|Waiting for a game\|JoinScreen\|Lobby" docs README.md`) and update them. Commit `docs: saloon lobby, door entry and table-switch swing`.
- [ ] **Step 2:** One whole-branch review (top-tier model) per the review stop rule: fix only Critical/Important; Minors go to `TODO.md`. Then `superpowers:finishing-a-development-branch`.

---

## Deviations

Known when the plan was written:

1. **Overlays live in `EntranceScreen`, not `DoorStage`** (spec §3.1 put them in `DoorStage`), so the plain fallback screen and the door scene share one set of overlays and one fade path.
2. **No motion blur at low quality**: low quality renders without a composer, so there is no pass to add the blur to. The swing still runs.
3. **`DoorScene.open()` sets the opening state** instead of `setState('opening')`; `setState` takes only `closed | ledger`.
4. **The switch controller is a component (`TableSwitcher`)** around the spec's pure reducer, rather than reducer logic inline in `App`, so the layering, timers and the swing driver are unit-tested without App's socket plumbing.
5. **TODO T-3 is fixed in Task 1** with an `align` prop on `AdminPanel`.
6. **The door chunk's error boundary reuses `View3DBoundary`**, whose console message names the 3D table.

Settled at the gates: (record here)

## Self-review notes (written with the plan)

- Spec coverage: L1/L2 (Tasks 3, 4, Gate 1), L3 (Task 6 deletes `Lobby` / `JoinScreen`), L4 (Task 6 `ClosedSign`), L5 (Task 6 `NameLedger`; auto-rejoin untouched), L6 (Tasks 2, 5, 7, Gate 2; initial `closed` covers reloads), L7 (Tasks 8, 10, 11, Gate 3), L8 (Task 11 hidden preload; swing starts on `ready`), L9 (Task 6 fade, Task 2 reduced-motion pose, Task 11 crossfade/dip), L10 (Task 1), L11 (Task 1), L12 (phases a–d and three gates). §3.3 two contexts only during the hand-off (Task 7 unmounts the entrance on `gone`). §3.4 blur requirements (Task 10 test). §4 8 s timeouts (Tasks 5, 9), mid-swing switch (Task 9 queue), door chunk failure (Task 6 boundary). §5 tests: reducers (Tasks 5, 9), overlays (Task 6), swing curve (Task 8), DoorScene via `DoorSet` + `DoorStage` tests (Tasks 3, 4; the scene itself needs WebGL), restyle (Task 1), font (Task 1).
- Deliberate choices: `doorMotion` and `swingCurve` are pure so the no-clip, no-overshoot and exact-90° rules are tested, not eyeballed. `SwingDriver` draws synchronously and the swap flips visibility imperatively, both to rule out a one-frame hitch at the midpoint. The status → door-flow dispatch and the mode → switch dispatch are layout effects, so neither shows a wrong frame before paint.
