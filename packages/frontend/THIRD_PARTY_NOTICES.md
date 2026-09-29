# Third-party assets

## Playing card SVGs

Source: https://github.com/Webisso/playing-cards
License: MIT
Vendored into: `src/assets/cards/`

Copied verbatim, unmodified, as part of Plan 4 (frontend). See that repository's
LICENSE file for the full MIT license text.

In the 3D tables (`src/three/`) these same SVGs are drawn onto a canvas at runtime,
multiplied over an aged-paper tint, and used as card textures. The originals are not modified.

## Three.js

Source: https://threejs.org (npm package `three`)
License: MIT
Used by: the lazy-loaded 3D table views (`src/three/`). Installed as a normal
dependency, not vendored; see the package's LICENSE file for the full text.

## Web fonts

Vollkorn and Special Elite are loaded at runtime from Google Fonts by `index.html` (and the
dev-only `dev3d.html`). They are not vendored or bundled; each font's licence is listed on
its Google Fonts page.

## Everything else in the 3D tables

Wood, felt, plank, card-back and chip textures are generated procedurally on a canvas at
startup, and all sound (room murmur, piano, card and chip effects) is synthesised with the
Web Audio API. No other image, model, font or audio file is bundled. The look is inspired by
the general atmosphere of Western saloon games but uses no assets, names or music from any
existing game.
