# 3D table readability and look: design

**Date:** 2026-10-02 · **Status:** approved by the user in brainstorming · **Branch:** `feat/3d-table-readability`
**Implements:** HANDOFF.md "Next step" item 2 (the 3D camera is too low), widened during brainstorming.

## 1. Problem

The first-person camera sits 0.29 m above the felt (`BASE_CAM` y 1.05, `TABLE_Y` 0.76), and the
on-your-turn "lean" drops it to 0.16 m. As a result:

- your own cards are hard to read in both games;
- the river is hard to see in Hold'em;
- opponents' revealed cards can't be read at showdown.

The seated mannequins also look pieced-together and off-putting, and in Hold'em the board sits
in one line with the side players' hole cards.

## 2. Evidence and visual references

Renders were made by patching the live dev scene at runtime, with no repo code changed.
`.playtest-data/camera-heights/` holds them: it is git-ignored and local-only, so **don't delete
it**.

- `compare.html`: camera heights from 0.29 m to 0.72 m, the "same pitch" variant, and the lean
  frames.
- `v2-review.html`: the figures removed; the seated, three-quarter (50°) and top-down views; the
  printed felt; the turn light; brighter lighting.
- `v3-review.html`: **the approved look.** The whole Plan A design is applied at once, with the
  HUD sketch on top (`v3-*.png`).
- `card-faces.html`: today's SVG faces against the big-index faces.

These are copied into the repo next to this spec:

- `2026-10-02-3d-table-readability/prototype-runtime-patch.js`: working prototype code for the
  seat layout, camera fit, big-index faces, printed felt and turn light. Use it as the reference
  implementation, but rewrite it as typed, tested modules.
- `2026-10-02-3d-table-readability/hud-sketch.html`: the HUD layout and styling. Its background
  PNGs live in `.playtest-data`, so it renders without them here.
- `2026-10-02-3d-table-readability/card-faces.html`: the face design. It needs the SVGs from
  `packages/frontend/src/assets/cards` next to it to show the "today" column.

## 3. Decisions (all made with the user, 2026-10-02)

| # | Decision |
|---|---|
| D1 | A fixed **three-quarter camera, 50° down, with a long lens** (35° vertical FOV). The framing is computed to fill the frame symmetrically. No room is built; the camera zooms to what matters. |
| D2 | **Remove the figures** (players and dealer) and show **nothing** for an occupied seat. Remove the cigar, saucer, smoke, ember, the whiskey glass and the visible lamp (cord, shade, bulb, halo). The lamp's light stays. |
| D3 | **Seats are spread for the player count**, recomputed only between hands. Hands move out toward the rail and are spaced further apart. The Hold'em board goes to the exact centre of the table. |
| D4 | Blackjack seats: **you stay at the bottom centre, with equal rail distance between neighbours.** Others alternate left and right; with an even count the extra player goes on the left, so one side has a seat's worth of empty felt. Hold'em seats go evenly around the whole table. |
| D5 | **2D HUD in the 3D view, as in the sketch:** player list at the bottom left (at 85% of the sketch's size), board or dealer panel at the top right, action prompts with keyboard shortcuts at the bottom right. |
| D6 | **Turn cue:** a pool of lamp light on the acting seat, **including your own seat**. It replaces the camera lean. |
| D7 | **Showdown:** the winning five cards lift and glow in 3D, and the HUD shows hand names. |
| D8 | **Printed felt.** Blackjack: rule arcs plus a betting circle per seat. Hold'em: a betting line and a board box. |
| D9 | **Big-index card faces**, with court cards drawn as a framed crown or knight. |
| D10 | **Lighting:** no blanket brightening. Tune exposure with the turn light on screen and keep its contrast (§A6). |
| D11 | **Out of scope:** the room (on hold), the 2D view, and phones (the 3D view only opens at 900 px wide or more). *Amended 2026-10-02 by `2026-10-02-3d-plan-b-hud-design.md`: the 2D view is deleted; windows under the overlay thresholds get the flat HUD view.* |

## 4. Split into two plans

- **Plan A, the 3D scene:** A1–A6 below. It ships on its own; the 3D name plates stay until
  Plan B replaces them.
- **Plan B, HUD and showdown:** B1–B2, including the small server view change.

Effort is about 4–5× the original camera-only fix, and Plan A is about 60% of it. Each plan gets
its own `superpowers:writing-plans` plan file and runs through
`superpowers:subagent-driven-development`.

## 5. Plan A: the 3D scene

All geometry is in metres. The felt is an ellipse with half-axes `TABLE_A` 1.2 (x) and
`TABLE_B` 0.85 (z) at `TABLE_Y` 0.76. The far side is −z. The tuned values below come from the
prototype and are starting points, settled at Gate 1.

### A1. Seat layout (pure functions in `three/`, unit-tested)

- **Positions are by rail distance, not angle.** Equal angles on an ellipse give unequal gaps,
  which was the visible bug in the prototype. Sample the hand-radius ellipse (`HAND_FACTOR`, about
  0.8 of the felt) by arc length.
- **Hold'em:** n seats at equal arc length around the whole ellipse. Seat 0 is you at the bottom
  centre (+z), and the others follow clockwise in seat-index order. Seen from the camera,
  clockwise runs left, then far, then right.
- **Blackjack:**
  - You are at the bottom centre.
  - The others take slots at equal arc spacing `s`, alternating left and right of you. The left
    side has `L = ceil((n−1)/2)` slots and the right side `R = floor((n−1)/2)`.
  - Seats are assigned in cyclic seat order after yours: the left slots from the centre outward,
    then the right slots from the outermost inward.
  - `s` = the available arc on one side (from the bottom centre to `BJ_ARC_END`, roughly 100° of
    the ellipse from the bottom) ÷ `L`, capped at `S_MAX` so 2–3 players aren't flung to the ends.
    The prototype used about 34° steps and a 102° half-arc.
- **Frozen during a hand.** Layout is computed from the seats dealt into the current hand while a
  hand is in progress, and from all seated players otherwise. A mid-hand joiner gets a 3D
  position at the next deal.
- **Placement:**
  - Each hand is centred on its seat point and fanned along the ellipse tangent. Card step is
    about 0.2 in Hold'em and 0.15–0.16 in Blackjack.
  - A Blackjack split puts the two hands about 0.45 apart along the tangent.
  - Cards keep today's partial 35% turn toward their owner.
  - Bets sit inward from the hand at about 0.5–0.58 of the felt radius.
  - Hold'em board: centred at z = 0, with a 0.19 step.
  - Pot: at z ≈ −0.25, just beyond the board.
  - Blackjack dealer cards: at about 0.62 toward the far rail. The shoe and tray stay.
- **HUD-safe zones.** A shared constant module (`hudZones`) defines the three screen rectangles
  the HUD will use at a 16:9 reference: bottom-left list about 25% wide × 32% tall, top-right
  panel about 26% × 20%, bottom-right prompts about 15% × 26%. Plan B sizes the HUD to fit inside
  them.
- **No-overlap test.** A property test runs n = 2…6 in both games, including a Blackjack split
  with 4-card hands, and asserts:
  - no two card rectangles from different hands overlap (oriented-rectangle test);
  - no chip stack overlaps a card;
  - every card corner is inside 0.95 of the felt ellipse;
  - with the fitted camera (A2) at 1280×720, no projected card corner falls inside a HUD-safe
    zone.

### A2. Camera

- **Fixed pitch and lens:** 50° down, 35° vertical FOV.
- **`fitCamera(aspect)` is a pure, unit-tested function.**
  - It samples the outer rail ellipse (about 1.28 × 0.93 at y 0.79) and the skirt (about
    1.3 × 0.95 at y 0.6).
  - It iterates the look-point z and the distance along the view direction until the projected
    bounds are vertically centred and `max(|x|, half-height)` = 1 − 0.05.
  - At 16:9 the prototype converged to position (0, 2.59, 1.808) and look (0, 0.76, 0.272).
  - It is recomputed in `setSize`.
- **Remove all camera motion:** `LEAN_CAM` / `LEAN_LOOK` / `lean`, the pointer parallax (and its
  `pointermove` listener) and the idle sway. The camera is static.

### A3. Removals

- **Figures:** the `Silhouette` usage in `SceneRoot`, and `silhouette.ts` if nothing else uses it.
- **Props:** the cigar, saucer, ember and smoke (and their per-tick update), and the whiskey glass
  (`room.ts`).
- **Lamp:** its visible meshes and halo sprite. The `SpotLight` and its flicker stay.
- **Uplight:** retune it if its only job was lighting the figures' faces.

### A4. Big-index card faces

- **Drawn directly:** `cardFaceTexture` draws the face on its existing 256×358 canvas, with no
  SVG load:
  - the parchment `#e4d5ad` plus the existing `age()` pass;
  - the rank in bold Georgia at about 0.4 of the card width ("10" condensed horizontally), with
    the suit glyph under it;
  - the same index mirrored in the opposite corner;
  - in the centre, one large suit for A–10, or a framed glyph for J/Q/K (♞ ♛ ♚).
- **Colours:** red `#a3221b`, black `#1b1410`.
- **Fonts:** the font stack must cover the glyphs (`"Segoe UI Symbol", "Noto Sans Symbols 2",
  "Apple Symbols", serif`). If a glyph is missing, fall back to the letter.
- **Becomes synchronous.** This removes the async SVG load and the blank-face race; keep or drop
  the `onLoaded` callback accordingly.
- **Unchanged:** the 2D view (`components/Card.tsx`) keeps the SVGs, and card backs stay as they
  are.

### A5. Printed felt

- **A per-game felt texture** generated on a 2048×1451 canvas:
  - The base is today's felt texture as a repeating pattern at the same scale.
  - It maps across the ellipse with UV = metres: `repeat (1/2.4, 1/1.7)`, `offset (0.5, 0.5)`,
    clamped.
  - A canvas pixel for world (x, z) is `((x + 1.2) / 2.4 · W, (z + 0.85) / 1.7 · H)`.
- **Ink:** `rgba(232, 205, 140, 0.5)`, Georgia.
- **Blackjack:**
  - "BLACKJACK PAYS 3 TO 2" (bold) and "Dealer must stand on 17 and draw to 16" (italic) on arcs
    of radius about 1.1, centred at z about −0.28 and −0.17, between the dealer's cards and the
    players' cards.
  - A 0.09 m ring at every occupied seat's bet spot.
- **Hold'em:** a betting-line ellipse at about 0.68 of the felt, and a rounded box around the
  five board positions.
- **Regenerated when the layout changes**, between hands only. The old texture is disposed.

### A6. Turn light and lighting

- **One shadowless `SpotLight`** owned by the scene:
  - **Target:** the acting seat's hand centre (or the dealer's cards).
  - **Position:** nearly straight above the target, so it doesn't spill onto the rail or floor.
  - **Shape:** a soft penumbra.
  - **Movement:** it glides between seats (about 0.4 s) and fades out when nobody is acting.
  - **Your own seat:** lit the same way when it's your turn.
- **Starting values from the prototype:**
  - in the Hold'em turn frame, angle 0.22 and 5× the lamp intensity;
  - in the Blackjack six-player frame, the prototype's 1.7× was too faint on your seat.
  - Use one strength for all seats.
- **Contrast rule.** In a 1280×720 render, the mean brightness of the pool must be at least about
  1.6× that of the surrounding felt. The gate subagent measures this by sampling the canvas.
  Exposure and other lights change only if the rule still holds.

### Dev harness

`devHarness.tsx` gains:

- **Blackjack:** steps with 2, 3, 4 and 6 dealt players, a split hand, and an acting-seat step
  for each, including yours and the dealer's.
- **Hold'em:** 2, 3 and 6-player steps, with an acting seat.

## 6. Plan B: HUD and showdown

### B1. HUD (3D view only; React, in `three/hud/`, mounted by `TableStage`)

- **`PlayerList`, bottom left, at 85% of the sketch's size:**
  - One row per seated player, with you last (bottom) and the others in table order.
  - Every row: an initial avatar, the live balance (large) and the name.
  - Hold'em rows add:
    - the street bet;
    - D / SB / BB badges;
    - a status: Folded, All-in, Your turn or Thinking…, Waiting. Statuses are derived only from
      the existing view; add no last-action labels.
    - mini cards for your hole cards, and for opponents' once the server reveals them;
    - at showdown, the hand name and the win or loss.
  - Blackjack rows add the bet and mini cards with a total (soft totals marked). The status is
    Waiting, Your turn, Playing, Stood, Bust or Blackjack, then Win +x, Push or Lose −x. A split
    shows a second card group.
  - The row of the acting seat gets the gold edge, and folded rows are dimmed.
  - It must fit the A1 HUD zone with 6 rows.
- **`TablePanel`, top right:**
  - Hold'em: five board slots, face-down until dealt, with the street and pot (including live
    bets).
  - Blackjack: the dealer's cards, with the hole card face-down and "10 + ?" until the reveal,
    then the total.
- **`ActionPrompts`, bottom right:**
  - They replace the 3D view's bottom-centre buttons. Hold'em: Fold F, Check/Call C, Raise R
    (with the amount input). Blackjack: Hit H, Stand S, Double D, Split P. Ready is Space; "Leave
    table" stays as a small link.
  - Illegal actions are greyed out, using the existing `blackjackActions.ts` and
    Check/Call/Raise legality.
  - Keys are ignored while an input, textarea or select has focus, and they respect the existing
    `actionPending` lockout.
  - They remain real buttons, so accessibility doesn't depend on the keyboard hints.
- **Removed from the 3D view**, with the HUD as the single source: the projected name plates,
  the pot label, the outcome labels and the bottom-left "my seat" plate. Admin moves into the
  top-left control cluster.
- **Mini cards** use the same big-index styling as A4.
- **Server change.** The table view gains `buttonSeatIndex`, `smallBlindSeatIndex` and
  `bigBlindSeatIndex` (Hold'em only, otherwise null), taken from where `startHand` actually posts
  the blinds. Heads-up, the button is the small blind. The client never re-derives the blind
  rules.

### B2. Showdown highlight

- **Server.** At a real showdown (`HoldemHand.wentToShowdown`), each participant's result gains
  `handName: string` and `bestCards: Card[]`, the five cards pokersolver selected.
  `describeHand` in `game-engine/src/holdemHandRank.ts` is extended to return them. The fields are
  absent on a fold-out. They are view-only, so the hand log is unaffected.
- **3D.** The winners' best-five cards (hole and board) lift about 0.015 m and get a warm emissive
  glow. In a split pot every winner's cards do. The highlight clears when the next hand is dealt.
- **HUD.** Each showdown row shows its hand name, and the winner's row is highlighted.

## 7. Verification gates

Each gate is a subagent render pass in the in-app browser against the dev harness at 1280×720.
It uses the method in §2 and the gotchas in HANDOFF.md, and writes its findings to a file. The
user approves each gate from the screenshots.

1. **Gate 1, after A1–A3:** layout and framing at Blackjack n = 2, 4, 6 (plus a split) and
   Hold'em n = 2, 5, 6. Check the equal gaps, the symmetric framing and that the HUD zones are
   empty.
2. **Gate 2, after A4–A6:** faces, felt, the turn light on an opponent, on you and on the dealer,
   and the contrast measurement.
3. **Gate 3, after Plan B:** the HUD in every state of the sketch, plus showdown with a split pot.

Tests:
- unit tests for the layout (the property test in A1), `fitCamera` and the felt mapping;
- RTL component tests for the HUD (rows, badges, statuses, keyboard handling with input focus);
- server tests for the blind-seat and showdown fields;
- `npm test` and `npm run typecheck` green at every commit.

## 8. Risks

- **Glyph coverage** differs by OS. The fallback is the letter, and Gate 2 checks Windows.
- **Extreme aspect ratios.** `fitCamera` is only exercised at 900 px wide and up. Unit-test 4:3
  and 21:9.
- **The extra spotlight** recompiles materials once, which is acceptable. The felt canvas is
  regenerated only between hands.
- **Deleting the silhouette and prop code** touches `room.ts` and `SceneRoot.ts`, which the
  existing reconciler tests cover. Keep them green.
