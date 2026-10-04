# Saloon lobby, door entry and table-switch swing: design

Brainstormed with the user on 2026-10-04. Replaces the off-theme lobby and name screen with a
three.js "saloon doors" scene, adds a door-opening entry into the table and a 180° camera swing
when the admin switches between Poker and Blackjack, and restyles the admin controls. Independent
of the soundboard spec (`2026-10-04-soundboard-design.md`); either can ship first.

Preview mockups from the session live in `.superpowers/brainstorm/` (gitignored). The decisions
below are what count; previews were 2D approximations of 3D effects.

## 1. Decisions (all made with the user, 2026-10-04)

| # | Decision |
|---|---|
| L1 | **The doors are a three.js scene**, not a flat DOM layer. Flat illustrations clashed with the table's look (low-key lamplight, vignette, grain, procedural wood). The door scene reuses the table engine's textures, lights and post-processing. |
| L2 | **Look:** a moonlit boardwalk at night; batwing doors backlit by warm amber light from inside; a light beam and dust through the gap. Approved at **render gate 1** before any animation work. |
| L3 | **The doors frame both waiting and name entry.** One scene replaces both `Lobby` and `JoinScreen`. |
| L4 | **Before a game starts:** a "Closed — waiting for the dealer" sign overlay, styled like the table HUD panels. For the admin, the sign holds **Open for Poker / Open for Blackjack**, replacing the lobby's start buttons. |
| L5 | **Name entry:** new players get a name-ledger overlay at the doors. Returning players are rejoined automatically (as today) and skip it. |
| L6 | **Entering:** the table preloads first; then the doors swing inward on their hinges while the camera pushes through, handing over to the table. About 1.5 s, tuned at **render gate 2**. Plays on every doors → table entry, including after a reload. |
| L7 | **Table switch: a 180° camera swing.** The two tables face each other across one saloon; the camera turns on the spot from one to the other (≈96° of room passes between them at the table camera's ≈84° horizontal FOV). **1300 ms**, a single smooth speed curve (quintic smootherstep), **no overshoot or rubber-banding**, **light** speed-scaled horizontal motion blur, **no crane arc** (no vertical dip or zoom). Tuned at **render gate 3**. |
| L8 | **No mid-swing pause:** the new table is fully loaded while the old one is still on screen; the swing starts only when it is ready. |
| L9 | **Fallbacks:** reduce-motion → both transitions become a 300 ms crossfade. No WebGL, or the flat view → the doors become a plain themed screen with the same overlays, and the switch is a dip to black (≈260 ms out, ≈420 ms in). |
| L10 | **Restyle:** `AdminEntry` and `AdminPanel` move to the themed `Button` and saloon tokens. No behaviour change. The plan's **first task**, so it can ship before the doors. |
| L11 | **Load the Rye font again.** It was dropped as unused (commit `985a61e`), but the HUD now uses `font-display` for balances, which currently fall back to Georgia. The door sign also uses it. |
| L12 | **One plan, four phases with three render gates** (§6). |

## 2. Current behaviour this builds on

- `SocketContext` statuses: `lobby` while no game mode is active (only before the first game since
  server start); `entering-name` when a game is active and this client has no remembered name;
  `at-table` once seated. Returning players auto-rejoin with their stored name.
- An admin mode switch retires the old table, clears every seat and broadcasts the new mode; clients
  auto-rejoin. Clients are briefly unseated in between, so **the switch must be detected from the
  mode change, not from status**.
- Each game's 3D view is a separate lazy chunk (`Blackjack3D`, `Poker3D`) around the shared
  `TableStage`, with its own `SceneRoot` and WebGL context. `framer-motion` is installed and
  `MotionConfig reducedMotion="user"` is already set app-wide.

## 3. Architecture

### 3.1 Door scene (`three/engine/doorScene.ts` + `three/DoorStage.tsx`)

- `DoorScene` builds its own small scene: boardwalk planks, a door frame, two batwing door meshes
  hinged at their outer edges, the warm interior light (spot/point lights and an emissive backdrop)
  behind them, cold moonlight from above-left, dust points in the beam. Wood comes from
  `textures.ts` (`woodTexture`, `plankTexture`); grain and vignette match the table's render path.
- API: `setState('closed' | 'ledger' | 'opening')`, `open(onHandedOff)`, `advance(seconds)` for
  deterministic tests and render capture (same pattern as `SceneRoot`), `dispose()`.
- Opening animation: door yaw from 0 to ≈ ±75° inward with a damped swing; the camera dollies
  forward through the gap; ends by fading into the table (§3.3).
- `DoorStage.tsx`: React shell owning the canvas and lifecycle, rendering the overlays (§3.2). It is
  its own lazy chunk; while it loads, the plain themed fallback screen shows.

### 3.2 Overlays (DOM, styled like the HUD panels)

- **Closed sign** (status `lobby`): "Closed — waiting for the dealer". If `isAdmin`, the sign also
  shows `Open for Poker` / `Open for Blackjack` buttons calling the existing `adminStartGame`.
- **Name ledger** (status `entering-name`): the `JoinScreen` form (same validation, errors and
  `join` call) restyled as a parchment ledger. Submitting keeps the doors closed until seated.
- Admin entry/panel stay available in the corner, as today, restyled per L10.
- `Lobby.tsx` and `JoinScreen.tsx` are deleted; their behaviour moves into these overlays, and
  their tests move with it.

### 3.3 Entry hand-off (doors → table)

1. Status becomes `at-table` (or auto-rejoin seats the player).
2. The table view mounts **underneath** the door canvas, hidden, and signals ready once its
   `SceneRoot` has rendered its first frame with textures loaded.
3. `DoorScene.open()` plays; at its end the door canvas fades out over the table and unmounts,
   disposing its WebGL context.
- Two WebGL contexts exist only during this hand-off.

### 3.4 Table switch

A small controller in `App` (pure reducer, unit-tested) keyed on `state.mode`:

`idle → preparing (new mode seen; old view kept on screen; new view mounted hidden) → swinging
(new view ready) → idle (old view unmounted)`.

- While `preparing`, the old `TableStage` keeps rendering its last model; the brief unseated state
  from the server does not tear it down.
- **Swing:** both scenes' cameras yaw about their own vertical axis. The old camera turns 0° → 90°
  over the first half; at the midpoint the visible canvas swaps; the new camera turns from −90° →
  0° over the second half. Combined, this is one 180° turn on a single quintic-smootherstep curve
  over 1300 ms (L7), so velocity is continuous across the swap and there is no overshoot.
- **What passes between the tables** is each scene's own room shell (walls, back bar, window
  light) seen while turning. If the existing room shell is too sparse for a 90° turn, render
  gate 3 decides what to add.
- **Motion blur:** a single-pass post-processing shader blurring along screen X, length
  proportional to the camera's angular velocity, kept light (L7). Requirements: at least 16 samples
  per pixel with per-pixel dithering (jittered sample offsets), computed in floating point in one
  pass. **No stacking of multiple frames or canvas copies** (that caused banding in the previews).
- If the new view fails to load (3D error), fall back to the dip to black once the flat view is
  ready.

### 3.5 Fallbacks (L9)

- `prefers-reduced-motion`: the door opening and the swing are replaced by a 300 ms crossfade.
- No WebGL / flat view: `DoorStage` renders the plain themed screen with the same overlays; the
  switch uses the dip to black. The existing `View3DBoundary` error path applies to the door chunk
  too.

### 3.6 Restyle and font (L10, L11)

- `AdminEntry` / `AdminPanel`: replace slate/emerald classes with `Button` variants and the saloon
  tokens (`bg-surface`, `border-wood-grain`, `text-parchment`, `font-utility`, brass accents).
  Existing tests keep passing; class-name assertions, if any, are updated.
- `index.html`: add `Rye` to the Google Fonts request.

## 4. Error handling

- Door chunk fails to load or throws → the plain themed screen with the same overlays.
- Table never reports ready within 8 s during entry or switch → hand over anyway (crossfade), so a
  slow GPU never traps a player behind closed doors.
- A second mode switch arriving mid-swing → let the swing finish, then run the next switch from
  `idle`.

## 5. Testing

- **Reducers:** the switch controller and the door state (`closed`/`ledger`/`opening`/handed-off)
  as pure functions: every transition, the 8 s ready timeout, a switch arriving mid-swing.
- **Overlays:** the closed sign (admin buttons only for admins, calling `adminStartGame`); the name
  ledger (validation, error display, `join` call), carrying over `Lobby.test` / `JoinScreen.test`
  cases.
- **Swing curve:** a unit test that the yaw curve is monotonic (no overshoot), starts and ends with
  zero velocity, and hits exactly 90° at the swap.
- **DoorScene:** `advance()`-driven tests that the doors reach their open angle and that `dispose`
  frees GPU resources (same pattern as the table scene tests).
- **Restyle:** existing `AdminEntry` / `AdminPanel` tests pass.
- **Font:** `index.html` requests Rye (a simple file assertion, like the existing token test).

## 6. Phases and render gates (L12)

Render gates use the established method (HANDOFF "Render method"): a subagent drives a dev harness
in the in-app browser, steps animations with `advance()`, and saves PNG captures via
`scripts/render/save-server.cjs`. The user approves each gate before the next phase.

| Phase | Content | Gate |
|---|---|---|
| a | Restyle (L10) and Rye (L11) | none; normal review |
| b | Door scene look (static) and a `dev3d`-style harness entry for it | **Gate 1:** stills of the doors in the closed and ledger states |
| c | Overlays, entry hand-off, door animation, fallbacks | **Gate 2:** a frame sequence of the door opening and hand-off |
| d | Table-switch controller, swing, motion-blur shader | **Gate 3:** a frame sequence of the swing. **Fails** if any mid-swing frame shows banding, ghost copies, hard seams, overshoot, or a pause |

## 7. Non-goals

Phones; sound for the doors or swing (the soundboard spec owns audio); a shared single-room scene
holding both tables (rejected as 3–4x cost); changes to server behaviour.
