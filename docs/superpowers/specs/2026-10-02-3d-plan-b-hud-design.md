# 3D readability Plan B (HUD and showdown) and retiring the 2D view: design

Brainstormed with the user on 2026-10-02. This spec **amends** §6 of
`2026-10-02-3d-table-readability-design.md` (the "base spec"). It does not repeat it: §B1 and §B2
there apply as written, except where this file says otherwise. Plan A of the base spec is done
(PR #15).

## 1. Decisions (all made with the user, 2026-10-02)

| # | Decision |
|---|---|
| P1 | **Phones are out of scope.** Everyone plays on a laptop or desktop. |
| P2 | **The 2D view is deleted** (`PokerTable`, `BlackjackTable`, `GameTable`, the 2D `Card` and `Chip`, and their tests). |
| P3 | **The HUD has two layouts.** `overlay`: the base spec's corner panels over the 3D canvas. `column`: the same panels stacked on a flat felt background, with no canvas. The column layout is the "flat view". |
| P4 | **The flat view is used when 3D fails** (no WebGL, a lost GPU context, a three.js error), **when the window is too narrow** for the overlay, and **when the player chooses it**. |
| P5 | **A "Flat view" / "3D view" toggle stays** in the top-left controls, replacing today's "2D view" / "3D view" button. |
| P6 | **One plan** builds both layouts and deletes 2D (approach A; about 1.3× the base spec's Plan B). |
| P7 | **Nothing built for the 3D side may break.** §4 below makes this enforceable. |

Base spec D11 is amended: the 2D view is no longer "out of scope" but deleted, and windows under
900 px get the flat view instead of 2D. Phones remain out of scope.

## 2. View selection and component structure

### 2.1 Choosing the layout

A pure, unit-tested function:

```ts
chooseTableLayout({ width, height, pref, failed }): 'overlay' | 'column'
```

Rules, in order:

1. `pref === 'flat'` → `column`.
2. `failed` → `column`. `failed` means 3D was unsupported or errored this session. It is not
   persisted, as today.
3. `width < 900` or `width / height < 1.25` → `column`. Gate 3 confirms both thresholds from
   shots at 4:3, 16:9 and 21:9, and may move them.
4. Otherwise → `overlay`.

- **Preference storage.** `pref` uses the existing `table.view` localStorage key. The stored value
  `'2d'` means flat and `'3d'` means 3D, so existing choices carry over. With nothing stored, the
  preference is 3D. The window size is no longer part of the stored preference: today's
  `readView` mixes the two, and this splits them.
- **Live resizing.** The size rule is re-evaluated on resize, debounced about 200 ms, so snapping
  or unsnapping a window switches the layout.

### 2.2 Tree

- `TableView` renders one of:
  - `TableStage`: canvas plus `<TableHud layout="overlay">`, inside `View3DBoundary` as today;
  - `FlatTable`: a felt background plus `<TableHud layout="column">`.
- The top-left control cluster (view toggle, Admin) is shared by both layouts. "Leave table" stays a small link in `ActionPrompts` (base spec §B1).
- **The HUD lives in `packages/frontend/src/hud/`, not `three/hud/`** (a change from the base spec).
  The flat view must never load the lazy three.js chunk, so nothing in `src/hud/` imports from
  `src/three/`, and a test asserts this.
- `View3DBoundary`'s `onError` and `TableStage`'s `onUnsupported` set `failed` (column layout)
  where they used to set 2D.

### 2.3 Fixes this depends on

- **`Room.dispose()`** (deferred from Plan A) is part of this plan. It frees the room textures,
  the ~12 MB printed felt and `feltBase`. Resize-driven switching makes repeated canvas
  mount/unmount reachable, and without it each switch leaks. It is called on `TableStage` unmount.
- **Admin panel scrolling** (the item-6 bug: at 800×450 the panel runs off the top of the
  screen and "Switch to Blackjack" can't be reached). The panel gets `max-height: 100vh;
  overflow: auto`. It is shared, so both layouts get the fix.

### 2.4 Deleting 2D

- The 2D components are deleted only after the integration tests pass on the column layout
  (§5, task 4), so 2D can be restored until then.
- `blackjackActions.ts` stays, because `ActionPrompts` uses it.
- `vitest.setup.ts` changes its `table.view = '2d'` default to the flat preference, so the
  integration tests (`integration/*.integration.test.tsx`) and `App.test.tsx` drive `FlatTable`.
  `App.test.tsx`'s view-switch tests are rewritten for the new toggle labels and for
  `chooseTableLayout`.

## 3. HUD contents

Base spec §B1 (`PlayerList`, `TablePanel`, `ActionPrompts`, mini cards in the A4 style, D/SB/BB
badges, removing the projected labels) and §B2 (showdown hand names, the winners' cards lifting
and glowing) apply as written, with these changes:

1. **Column layout.** Top to bottom: `TablePanel` (board or dealer), `PlayerList`, then
   `ActionPrompts` pinned to the bottom of the viewport so they are never scrolled away. Max
   width about 560 px, centred. Keyboard shortcuts work the same in both layouts.
2. **Overlay sizing.** The HUD scales with the viewport: one root font size set with `clamp()`,
   with everything inside sized in `em`. Six player rows must fit the base spec's players zone
   (`three/hudZones.ts`) from 900 px wide up to 1920 px.
3. **Turn-clock countdown.**
   - Server: `Table` records when it arms `turnClockTimer`. The view gains
     `turnClockRemainingMs: number | null`, computed at each broadcast. It is null when the clock
     is off or no turn is open.
   - Client: it counts down locally from the moment it receives the view (`performance.now()`),
     so server and client clocks never need to agree.
   - Display: on the acting row ("Your turn · 23s" / "Thinking… · 23s"), styled as urgent under
     10 s.
4. **Leave visibility.** "Leave table" shows whenever the server would accept a leave: between
   hands, or mid-hand for a seat that was not dealt in. A folded player still cannot leave. A pure
   `canLeaveNow(view, mySeatIndex)` mirrors `Table.leave`'s rule. The server remains the
   authority.
5. **The sit-out re-flow** (Plan A's "expect at playtest" note: a seat that sits a hand out makes
   the table re-flow twice a hand) is not changed. Gate 3 includes a sit-out sequence, and it is
   fixed only if the user judges it bad from the shots.
6. **No additions beyond the base spec:** no last-action labels, chat, sounds or HUD animations.

## 4. Protecting the 3D side (P7)

Plan B touches the 3D code in only these places:

- **removal** of the projected name plates, the pot label, the outcome labels and the "my seat"
  plate (base spec §B1, already approved), which the HUD replaces;
- **addition** of the showdown lift and glow (§B2);
- **addition** of `Room.dispose()`;
- **mounting** the overlay HUD in `TableStage`.

Everything else in `packages/frontend/src/three/` keeps its behaviour. Four mechanisms enforce
this:

1. **Canvas pixel baseline.**
   - Before any frontend change, a subagent renders the Plan A gate states from `master` through
     the existing render method (`/dev3d.html`, `window.__bj3d`, `canvas.toDataURL`, the
     save-server) at 1280×720. The states: Blackjack n = 2, 4, 6 and a split; Hold'em n = 2, 5, 6;
     the turn light on an opponent and on you. The renders are saved as a baseline set.
   - After Plan B, the same states are rendered again and a script diffs the canvas pixels
     against the baseline. Any difference beyond a small anti-aliasing tolerance, in any state
     that isn't a showdown, fails Gate 3.
   - The name plates and labels are HTML elements over the canvas (`TableStage.tsx` `plateEls`),
     so `toDataURL` does not capture them, and removing them cannot change the canvas.
2. **The `three/` tests are locked.**
   - Every task review runs `git diff master -- 'packages/frontend/src/three/**/*.test.*'`.
   - The only allowed changes: tests for the four removed labels, and new tests for the showdown
     glow and `dispose()`.
   - Any other change to an existing `three/` test is a review failure. It must not be fixed by
     editing the test.
3. **Settled values are frozen.** Plan A's Deviations 1-10, the `fitCamera` constants, the A1
   layout functions, the felt, the card faces and the lighting/turn-light values go into the
   plan's global constraints as "do not modify", as in `planA-global-constraints.md`.
4. **The dev harness keeps working.** `/dev3d.html` and `window.__bj3d` keep every Plan A step
   and gain HUD and showdown states. Gate 3 renders through it.

## 5. Server, tests, gate and order

### 5.1 Server and engine changes (view-only; the hand log is unchanged)

- `buttonSeatIndex`, `smallBlindSeatIndex`, `bigBlindSeatIndex`: Hold'em only, otherwise null,
  taken from where `startHand` actually posts the blinds. Heads-up, the button is the small
  blind. The client never re-derives the blind rules (base spec §B1).
- `handName` and `bestCards` on each showdown participant's result, from an extended
  `describeHand` in `game-engine/src/holdemHandRank.ts`. Only at a real showdown
  (`HoldemHand.wentToShowdown`), absent on a fold-out (base spec §B2).
- `turnClockRemainingMs` (§3 item 3).

### 5.2 Tests

- Server tests for the three new view fields, including heads-up blinds, a fold-out, and the
  clock being off.
- Unit tests for `chooseTableLayout`, `canLeaveNow`, and the countdown (with fake timers).
- RTL tests for every `PlayerList` row state, the badges, `TablePanel`, and `ActionPrompts`'
  keyboard handling (ignored while an input, textarea or select has focus) and `actionPending`
  lockout. Each runs in both layouts.
- Both integration tests play full hands through `FlatTable`.
- A test that no file in `src/hud/` imports from `src/three/`.
- All existing `three/` tests pass, unchanged except as §4 item 2 allows.
- `npm test` and `npm run typecheck` are green at every commit.

### 5.3 Gate 3

A subagent render pass in the in-app browser that writes its findings to a file. The user
approves from the shots. It covers:

- the overlay HUD in every state of the base spec's sketch, at 900 and 1920 px wide;
- a Hold'em showdown with a split pot;
- the column layout at 700 px wide and when forced flat at 1280 px;
- the overlay/column thresholds at 4:3, 16:9 and 21:9;
- the sit-out re-flow sequence;
- the §4 item 1 pixel-diff result, with Plan A's states shown side by side with the baseline.

### 5.4 Task order

1. Server and engine view fields.
2. The 3D canvas pixel baseline (§4 item 1), rendered from `master`.
3. HUD components in `src/hud/` (`PlayerList`, `TablePanel`, `ActionPrompts`, the countdown,
   `canLeaveNow`).
4. `FlatTable`, `chooseTableLayout`, the toggle, and the port of the integration and `App` tests
   to the column layout.
5. The overlay mount in `TableStage`, removal of the projected labels, and admin panel scrolling.
6. The B2 showdown lift and glow in 3D.
7. `Room.dispose()`.
8. Deleting the 2D components and their tests.
9. Gate 3, then docs.

### 5.5 Docs

- HANDOFF: the "Open decision: retire the 2D view?" is resolved. The audit's 2D items (I12, I13's
  2D half, M25's 2D nits) are dropped. Plan A's `Room.dispose()` follow-up moves into this plan.
- `docs/README.md` and any doc that mentions the 2D view or the 900 px phone rule are updated.

## 6. Risks

- **The integration-test port** is the least certain part of the estimate. The 2D views' button
  names and table text are what those tests query. The HUD keeps the same accessible names
  (Fold, Check, Call, Raise, Hit, Stand, Double, Split, Ready, Leave table) where it can, to keep
  the port mechanical.
- **Overlay sizing at 900 px.** Six rows in the players zone may be too tight at the narrowest
  overlay width. The fallback is to raise the §2.1 width threshold at Gate 3, not to move the
  zones, because the zones are Plan A layout constraints (§4 item 3).
- **Switching views on resize.** Repeated switching depends on `Room.dispose()` and on the WebGL
  context being released on unmount. Gate 3 switches back and forth several times and checks
  `renderer.info` memory counts do not grow.
