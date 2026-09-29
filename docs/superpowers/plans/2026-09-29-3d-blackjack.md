# 3D tables (RDR2-inspired, first-person) -- plan and outcome

**Status: shipped** in PR #12 (Blackjack), PR #13 (Hold'em, playtest fixes, shared Blackjack dealer) and
commit `b0acd11` (hand-log write-ahead, empty-shoe handling). The plan below was written for Blackjack only;
Hold'em followed as a stacked change. Deviations from the original plan are listed at the end.

## Decisions (user-approved in chat 2026-09-29)
- Browser + Three.js (no game engine). Optional Tauri wrap later, out of scope.
- First-person seated view. Opponents/dealer are minimal stylised silhouettes
  (hat, head, shoulders, hands), lit from below. Original art direction, not a
  copy of any Rockstar asset. All textures procedural; card faces are the
  vendored MIT SVGs. No audio files downloaded (audio is synthesized in-browser).
- The 2D UI stays as a fallback; a toggle (persisted in localStorage) switches.
- Action buttons, name plates, banners stay HTML (accessible + testable).

## Architecture (`packages/frontend/src/three/`)
- `sceneModel.ts` / `pokerModel.ts` -- PURE: server snapshot -> declarative `SceneModel` (cards with
  stable keys, face-up/down, chip stacks, seat slots, result labels, pot). Unit-tested, no WebGL.
- `engine/` -- Three.js: `SceneRoot` (renderer, camera, lights, post-fx, loop, reconciler),
  `room`, `textures` (procedural), `cards`, `chips`, `silhouette`, `tween`, `audio`.
- Reconciler: `SceneRoot.apply(model)` diffs by key -> deal / flip / sweep
  animations. Idempotent, so snapshots arriving faster than animations are fine.
  A slot whose card changes (or goes face-down) retires the old card and deals a new one.
- `TableStage.tsx` -- shared React shell (canvas lifecycle, projected plates, controls, banners).
  `Blackjack3D.tsx` / `Poker3D.tsx` -- per-game model + action buttons, lazy-loaded from `App.tsx`,
  guarded by `View3DBoundary.tsx`.
- Dev harness: `dev3d.html` + `src/three/devHarness.tsx` (scripted hands, no server).

## Stages (all done)
1. Scene: room, table, lamp lighting, grading, dust/smoke, camera sway.
2. Cards, chips, silhouettes, deal/flip/sweep animations.
3. Wiring: model reconciler, HTML overlay, 2D/3D toggle, tests.
4. Polish: synthesized audio, quality toggle, perf, reduced-motion.
5. (added) Hold'em: `pokerModel`, `Poker3D`, shared `TableStage`.
6. (added) AI playtest round, fixes, final review.

## Verification
`npm test`, `npm run typecheck` at the repo root; harness screenshots at Low/Medium/High; a live server with bot
players and a checker script; see `docs/superpowers/playtests/2026-09-29-3d-tables-playtest.md`.

## Deviations from the original plan
- Scope grew from "Blackjack only, server/engine untouched" to both games **and** an engine/server change: the
  playtest showed Blackjack dealt every seat a private shoe and dealer hand, so the game now uses one shared shoe and
  dealer (`SharedDealer`, `Table.advanceBlackjackTurn`). Hand-log format changed (`{ players, shoe }`).
- Game actions are now logged before they are applied (previously after); recovery skips actions the engine rejected.
- The View preference key is `table.view` (covers both games) rather than a Blackjack-specific key.
- Not done: a real session with friends, sound-quality judgement, weak-GPU/phone performance.
