# Saloon lobby plan: planning notes (input for writing the plan)

Written 2026-10-04 by the session that wrote `2026-10-04-soundboard.md`; it ran out of context
before writing the lobby plan. These are the decisions it had settled after reading the code. The
next session writes `docs/superpowers/plans/2026-10-04-saloon-lobby.md` from the spec
(`docs/superpowers/specs/2026-10-04-saloon-lobby-design.md`) plus these notes, with
`superpowers:writing-plans`, using the soundboard plan's format and Global Constraints style
(commit after clean review without asking; render gates are user-gated). Delete this file in the
commit that adds the plan.

## Code facts that shape the plan

- **No WebGL in jsdom and no SceneRoot unit tests.** Component tests mock `./engine/SceneRoot`
  (see `three/Blackjack3D.test.tsx`, which also stubs `window.ResizeObserver`). So every animated
  thing needs a pure, tested module, and the WebGL classes are checked by typecheck + gates.
- All textures in `three/engine/textures.ts` are synchronous canvas textures (no loads). "Ready" =
  `SceneRoot` has drawn its first frame. Add `SceneRoot.onFirstFrame: (() => void) | null`, fired
  once after the first draw in `tick`.
- `SocketContext` keeps `status === 'at-table'` through an admin mode switch (the auto-rejoin
  branch never calls `setStatus`); only `state.mode` / `state.table` change. So the door flow
  ignores at-table→at-table, and the switch is keyed on `state.mode` (spec §2).
- App tests (`App.test.tsx`) find the name screen by label `/display name/i` and button "Join
  table", and the lobby by `/waiting for a game to start/` (line 86). Keep the label and button
  text in the ledger overlay; change the lobby regex to the sign's text. Add
  `vi.mock('./three/DoorStage', () => ({ default: () => <div data-testid="door-stage" /> }))` to
  App.test so jsdom never constructs the door scene.
- `Lobby`'s "switch" branch is dead (status `lobby` only happens with mode null); drop it.
- `GradeShader` lives inside `SceneRoot.ts`; extract to `three/engine/grade.ts` so the door scene
  shares the exact grain/vignette pass.
- `tween.ts` has no imports (pure easings). Add `export const smootherstep: Ease` there, used by
  both the door motion and the swing curve. Anything App imports statically must not import
  `three` (it would pull three.js out of the lazy chunk).
- AdminPanel restyle can be specified as an exact class mapping: wrapper `text-white` →
  `font-utility text-parchment`; trigger `rounded-md bg-slate-700 px-3 py-1.5 font-medium` → the
  table chip classes (`rounded-md border border-wood-grain bg-surface px-2 py-1 font-utility text-xs
  text-parchment`); panel `border-slate-600 bg-slate-800` → `border-wood-grain bg-surface`;
  `text-slate-400` → `text-fg-dim`; inputs `border-slate-600 bg-slate-900` → `border-wood-grain
  bg-bg text-parchment`; `<button className="rounded bg-emerald-600 px-2 py-1">` → `<Button
  variant="primary">`; amber Force act → `variant="neutral"`; red-700 Kick → `variant="danger"`;
  `text-red-400` → `text-ember-text`; `text-emerald-300` → `text-win-bright`. AdminEntry the same
  way (it is 53 lines; give full code). No test asserts class names.
- Rye: add `&family=Rye` to the Google Fonts URL in `index.html` and `dev3d.html`; update the
  comment in `tailwind.config.ts`; test with a file read like `tailwind.config.test.ts`.

## Task outline (phases per spec §6)

**Phase a**
1. Restyle AdminEntry/AdminPanel + Rye (one task, normal review).

**Phase b → Gate 1**
2. `three/engine/doorMotion.ts` (pure): `DOOR_OPEN_DEG = 75`, `DOOR_OPEN_S = 1.5`, fade over the
   last 0.35 s; `doorAngleDeg(t) = 75·(1 − e^(−4t)·cos(2π·0.9·t))` (batwing overshoot ≈ 83° at
   0.56 s, within 0.2° of 75 by 1.5 s); camera z from 3.2 to −0.6 on smootherstep (look target
   moves with it); `fade(t)`. Tests: angle 0 at t=0, within 1° of 75 at 1.5 s; camera monotonic;
   doors ≥ 60° open when the camera crosses the door plane z=0 (no clipping); reduced motion =
   0.3 s fade, doors stay shut.
3. `three/engine/doorSet.ts` (geometry with injected textures, so it builds in jsdom; tests:
   `setOpen(deg)` sets hinge yaw +deg / −deg so both doors swing inward (away from +z camera);
   `dispose()` disposes every geometry and material) + `three/engine/doorScene.ts` (renderer,
   composer with the shared grade pass, quality like SceneRoot, `setState('closed'|'ledger')` —
   ledger lowers exposure a little so the parchment reads — `open(onHandedOff, {reducedMotion})`,
   `advance(s)`, `onFirstFrame`, sets its canvas opacity from `fade`, `dispose()`; no unit test).
   First-pass look: doorway 1.1 m, frame posts at x ±0.62, plank facade, boardwalk plane, warm
   backdrop at z −3 + warm point light + a shadow-casting spot spilling through the gap onto the
   boardwalk, moonlight `0x6f8fbe` from above-left, dim night hemisphere, dust `Points` in the beam
   (`softDotTexture`), background `0x05070c`, fog `0x070a12`. Camera fov 50 at (0, 1.55, 3.2)
   looking at (0, 1.3, 0).
4. `three/DoorStage.tsx` (lazy default export: canvas lifecycle, ResizeObserver, `window.__doors`
   in DEV, props `state`, `open`, `reducedMotion`, `onReady`, `onHandedOff`, `onUnsupported`;
   test with a mocked doorScene) + dev harness `?game=doors&state=closed|ledger`.
   **Gate 1** (stills, closed and ledger), render method as in the soundboard-era HANDOFF
   "Render method"; brief format as Plan A's Gate 1 (`2026-10-02-3d-table-readability-plan-a.md`).

**Phase c → Gate 2**
5. `src/entrance/ClosedSign.tsx` ("Closed — waiting for the dealer"; admin gets "Open for Poker" /
   "Open for Blackjack" → `adminStartGame`), `NameLedger.tsx` (JoinScreen behaviour, parchment
   ledger; keep "Display name" label and "Join table"), `EntranceScreen.tsx` (themed CSS fallback
   background until the door canvas reports ready; lazy DoorStage inside a View3DBoundary-style
   boundary; `use3D` from `chooseTableLayout` so the flat view gets the plain screen). Move the
   Lobby/JoinScreen test cases, delete `Lobby.tsx`, `JoinScreen.tsx` and their tests; wire App for
   `lobby` / `entering-name`.
6. `src/entrance/doorFlow.ts` reducer: phases `closed | ledger | waiting-table | opening | gone`,
   plus `crossfade: boolean`. Events: `status` (lobby→closed, entering-name→ledger from any phase;
   at-table from closed/ledger → waiting-table with `since`; others unchanged), `table-ready`
   (waiting-table → opening), `tick` (waiting-table past `TABLE_READY_TIMEOUT_MS = 8000` → opening
   with crossfade), `handed-off` (opening → gone). Initial `closed`, so a reload with auto-rejoin
   still plays the doors (L6).
7. Entry hand-off: `SceneRoot.onFirstFrame`; `TableStage`/`Blackjack3D`/`Poker3D` prop
   `onViewReady`; `TableView` calls `onViewReady('scene' | 'flat')` (flat: in an effect when the
   layout is not overlay, which also covers a 3D failure falling back). App renders the table
   underneath and `EntranceScreen` on top (`fixed inset-0 z-[60]`) during waiting-table/opening;
   unmounting it on `gone` disposes the door WebGL context. Fallback screens crossfade 300 ms.
   **Gate 2** (frame sequence of the opening and hand-off).

**Phase d → Gate 3**
8. `src/switch/swingCurve.ts` (pure, imports `smootherstep` from `three/engine/tween.ts`):
   `SWING_MS = 1300`; total yaw `180·smootherstep(ms/1300)`; pose `{ showing: 'old'|'new', yawDeg,
   velocityDegPerS }` (old 0→90, new −90→0, swap at exactly 650 ms where total = 90);
   velocity from `30x²(x−1)²`; blur amount = velocity / peak velocity × `MAX_BLUR` (start 0.02 of
   screen width; Gate 3 tunes). Tests per spec §5: monotonic, no overshoot (all totals in
   [0, 180]), zero velocity at both ends, exactly 90° at the swap.
9. `src/switch/switchFlow.ts` reducer: `idle | preparing | transitioning`, `shown`, `from`, `to`,
   `queued`, `style: 'swing' | 'crossfade' | 'dip'`, `since`. First mode while `shown` is null just
   sets `shown` (that entry is the doors' job). A different mode while idle → preparing. `ready`
   carries the style (App picks: reduced motion → crossfade; new view flat → dip; else swing).
   `tick` past 8000 ms → transitioning with crossfade. A mode during preparing/transitioning →
   `queued` (latest wins), run from idle after `done`. Mode null → reset.
10. `SceneRoot.setViewYaw(deg)` (store the fitted camera quaternion in `setSize`, apply yaw about
    world Y on top, re-applied after resizes) and `setMotionBlur(amount)` with
    `three/engine/motionBlur.ts`: single pass after RenderPass/bloom, before OutputPass (the
    composer's targets are half-float, so it is floating point), `defines: { SAMPLES: 16 }`, per-pixel
    hash jitter on the sample offsets, `pass.enabled = amount > 0`. Low quality has no composer, so
    no blur there (a deviation to record). String test on the shader: SAMPLES ≥ 16, jitter present,
    no frame stacking.
11. `src/switch/SwingDriver.ts` (pure: `advance(ms)` applies yaw/blur to `{ old, next }` targets,
    calls `onSwap` once at 650 ms and `onDone` once at 1300 ms; tested) + App wiring: keep
    `lastViews[mode] = { table, mySeatIndex }`; render a keyed list of layers (`[shown]` when idle,
    `[from, to]` while switching) so the incoming TableView is the same instance that stays after
    the switch (no remount, no second load); the visible layer flips at the swap; crossfade =
    300 ms opacity; dip = black overlay 260 ms out, swap, 420 ms in; `onScene` prop on
    TableStage/Blackjack3D/Poker3D to reach each SceneRoot. Dev harness `?game=swing` mounts both
    tables and exposes `window.__swing.advance(ms)` with rAF paused, for capture.
    **Gate 3** (frame sequence; fails on banding, ghost copies, hard seams, overshoot or a pause).
12. Docs: HANDOFF, close `TODO.md` T-3.
</content>
</invoke>
