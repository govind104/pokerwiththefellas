# 3D Blackjack (RDR2-inspired, first-person) -- plan

Branch: `feat/3d-blackjack`. Blackjack only; Poker stays 2D. Server/engine untouched.

## Decisions (user-approved in chat 2026-09-29)
- Browser + Three.js (no game engine). Optional Tauri wrap later, out of scope.
- First-person seated view. Opponents/dealer are minimal stylised silhouettes
  (hat, head, shoulders, hands), lit from below. Original art direction, not a
  copy of any Rockstar asset. All textures procedural; card faces are the
  vendored MIT SVGs. No audio files downloaded (audio is synthesized in-browser).
- The 2D UI stays as a fallback; a toggle (persisted in localStorage) switches.
- Action buttons, name plates, banners stay HTML (accessible + testable).

## Architecture (`packages/frontend/src/three/`)
- `sceneModel.ts` -- PURE: server snapshot -> declarative `SceneModel` (cards with
  stable keys, face-up/down, chip stacks, seat slots). Unit-tested, no WebGL.
- `engine/` -- Three.js: `SceneRoot` (renderer, camera, lights, post-fx, loop),
  `room`, `textures` (procedural), `cards`, `chips`, `silhouette`, `tween`, `audio`.
- Reconciler: `SceneRoot.apply(model)` diffs by key -> deal / flip / sweep
  animations. Idempotent, so snapshots arriving faster than animations are fine.
- `Blackjack3D.tsx` -- React component, same props as `BlackjackTable`, lazy-loaded.

## Stages
1. Scene: room, table, lamp lighting, grading, dust/smoke, camera sway.
2. Cards, chips, silhouettes, deal/flip/sweep animations.
3. Wiring: model reconciler, HTML overlay, 2D/3D toggle, tests.
4. Polish: synthesized audio, quality toggle, perf, reduced-motion.

## Verification
`npm test`, `npm run typecheck` in `packages/frontend`; live run via preview
(frontend + server), screenshots, console clean.
