# Saloon redesign — frontend visual design

**Status:** Approved, ready for implementation planning
**Depends on:** Plan 4 (frontend), merged to `master`
**Relationship to the roadmap:** not part of the original 6-plan roadmap (see
`HANDOFF.md`) — a standalone visual redesign of the existing Plan 4 frontend, triggered
by the current UI reading as unstyled/default. Independent of Plan 5 (accounts) and
Plan 6 (deployment); can land before or after either.

## 1. Scope

Restyle the existing Poker/Blackjack table UI (built in Plan 4) around a saloon-western
visual identity inspired by *Red Dead Redemption 2* — its mood and material language
(worn wood, brass, leather, lantern light), recreated fully in 2D, not its 3D rendering.
This is explicitly phased:

**v1 (this plan) — "Clean Saloon + Flat/Vector":**
- A warm, saloon-themed reskin of the table shell and core in-hand action controls.
- The existing vendored 52-card SVG pack stays untouched; only the surrounding chrome
  changes.
- Flatter, higher-contrast rendering (no grain texture, moderate vignette) — legible
  over "worn," matching the phased-effort decision made during design (grain/vignette
  tuning and full painterly card art are real but avoidable costs for a first pass).

**v2 (explicitly future, not this plan) — "Deep Saloon + Painterly":** see Section 8.
Not scheduled, not scoped, not started. Called out here only so v1's token structure and
component seams don't have to be reworked when it happens.

**In scope for the visual restyle:**
- `GameTable` — seat ring, felt, rail, pot area, per-seat name/chip/ready/turn-indicator
  display, Ready/Leave buttons.
- `PokerTable` — community card area, pot display, betting controls (fold/check/call/
  raise buttons, the raise slider and amount input), showdown results display.
- `BlackjackTable` — dealer hand area, per-seat hand rendering, hit/stand/double/split
  buttons, bet and outcome badges.
- `Card` — the frame/border around each card (the vendored face art inside is untouched)
  and its face-down rendering (Section 5) — whether the card-back treatment lands as a
  new component or a branch inside `Card.tsx` is left to implementation planning.
- A new chip / chip-stack visual component.

**Explicitly out of scope for this plan** (stays on current Tailwind defaults):
- `JoinScreen` (the display-name entry screen).
- The connection/error banners (`role="status"` reconnecting banner, `role="alert"`
  error banner) — no bespoke visual pass, though the accessibility contract in Section 7
  still applies to them unchanged.
- Any page-level nav/chrome — none currently exists beyond `JoinScreen` → `GameTable`
  (per Plan 4 Section 3.1, there's no routing layer to restyle).
- Sound design, mobile-first layout work, and the v2 items in Section 8.

## 2. Visual direction

**Anchor:** RDR2's saloon mood, not its engine. Worn wood rail, brass fittings, leather,
felt, lantern-glow lighting — expressed as flat 2D illustration (CSS/SVG), not attempted
as a 3D scene.

**Relationship to prior design research:** two artifacts were produced during
brainstorming and are the visual reference for this spec — "Felt & Chips" (broad
reference-gallery research: table/HUD layout patterns, card/chip motion techniques,
7 style buckets) and "Saloon Table Mockups" (the RDR2-specific direction: table takes,
card/chip art styles, card-back options). Felt & Chips' *structural* research is kept as
this plan's technical foundation — its seat-ring layout pattern and CSS 3D card-flip
technique are still the intended implementation approach; only its style-bucket
recommendation (noir/luxury) was superseded by the RDR2 direction. Both artifacts are
private, account-scoped references produced during design, not a runtime dependency —
nothing is fetched from them at build time.

**What "Clean" means here, precisely:** same materials and palette as a "Deep Saloon"
take would use, but without a grain/noise texture overlay and with a lighter vignette —
prioritizing legibility over wear. This was a deliberate legibility/effort trade,
not a lesser version of the real direction.

## 3. Design tokens

All colors below are CSS custom properties, named semantically (not e.g. `--clean-felt`)
so a future v2 pass can add overlay effects (grain, stronger vignette) on top of the same
tokens rather than renaming anything.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#140f0a` | Page/app background |
| `--surface` | `#1c1611` | Panel/card-container background |
| `--surface-raised` | `#241c15` | Slightly raised panel (e.g. label bars) |
| `--wood` | `#4a2f1c` | Table rail |
| `--wood-dark` | `#2c1c10` | Rail shadow/gradient end |
| `--wood-grain` | `#5e3d25` | Hairline borders/dividers |
| `--felt` | `#2f4a3a` | Table surface |
| `--felt-hi` | `#3c5c48` | Table surface highlight (radial gradient center) |
| `--brass` | `#b8863b` | Accent borders, chip trim, primary decorative accent |
| `--brass-bright` | `#ddb15c` | Accent highlights, active/focus states |
| `--parchment` | `#e8d9b5` | Headings and labels on dark surfaces |
| `--parchment-dim` | `#cdbb8f` | Secondary labels; also the push/tie semantic color |
| `--ink` | `#1a130d` | Text on light surfaces |
| `--fg` | `#ede1c4` | Primary body text on dark surfaces |
| `--fg-dim` | `#b8a988` | Secondary body text |
| `--fg-faint` | `#8a7a5f` | Tertiary/caption text |
| `--ember` | `#a8452e` | Decorative warm accent, and the loss/bust/fold semantic color |
| `--ember-bright` | `#c85a3c` | Ember highlight/hover state |
| `--win` | `#5f7a4a` | Win semantic color — deliberately distinct from brass/ember, not a decorative accent |
| `--win-bright` | `#7a9c5e` | Win highlight/hover state |

**Typography:**

| Role | Face | Usage rule |
|---|---|---|
| Display | `Rye` (Google Fonts) | App branding and section headers only. Not used for in-game text — a heavy woodtype face that loses legibility at small sizes. |
| Body | `Vollkorn` (Google Fonts) | All in-game text that must stay legible: seat names, hand results, error messages, button labels. |
| Utility | `Special Elite` (Google Fonts) | Short uppercase tags/timers only (e.g. "POT", a seat's blind label). Never paragraph text — a typewriter face, tiring to read in long strings. |

Fallback stacks: `Rye, Georgia, serif` / `Vollkorn, Georgia, 'Times New Roman', serif` /
`'Special Elite', 'Courier New', monospace`.

## 4. Table layout

Seat-ring layout follows Felt & Chips' existing research: seats arranged around an oval
felt, scaling from 2 up through 8 seats (`seatCount: 8` is the server's current default,
`packages/server/src/index.ts:8`, and is configurable per table — the layout must not
assume a fixed count). Rail, brass accents, and lantern-glow lighting (a radial gradient
positioned above the felt) wrap the same seat-ring structure Plan 4 already established;
this plan restyles that structure, it doesn't redesign its arrangement logic.

Pot and per-seat chip stacks use the new chip component (Section 5). Turn indicator is a
subtle glow/highlight on the active seat, not a bespoke shape — consistent with the
restrained-motion decision in Section 6.

## 5. Cards and chips

**Card faces:** unchanged. The existing vendored 52-card flat/vector SVG pack
(`packages/frontend/src/assets/cards/`, from `Webisso/playing-cards`, MIT, per Plan 4
Section 5) stays exactly as-is — no re-tinting, no new per-card art. `Card.tsx`'s
`assetUrl()` function remains the single resolution seam; this is also the seam a future
v2 painterly pack would replace, so nothing about this decision needs to change later,
only what `assetUrl()` points at.

**Card frame:** the border/mount around each face gets the saloon treatment (brass-trimmed
edge, drop shadow) — this is new work, distinct from the untouched face art inside it.

**Card back:** one new asset, replacing the current plain slate-gray placeholder in
`Card.tsx`. Confirmed against an actual RDR2 screenshot (a repeating grid of small
ornamental medallion shapes, thin border frame) — this plan reproduces that *pattern
structure* (a tiled lattice of small repeating ornamental units) but in this plan's own
palette (brass-on-`--ink`, bordered in `--brass`), not RDR2's literal blue — a cool-blue
card back would be the one element fighting the felt and wood everywhere it appears,
since it's visible on every face-down card and the deck itself. The "Repeating Lattice"
option in the Saloon Table Mockups artifact is the visual reference for the pattern
structure; the brass/ink recolor is the one specified here.

**Chips:** a small new component (not sourced — Plan 4 Section 5 already found no chip
asset pack worth the dependency), styled per the mockups: brass/ember stacked edge bands
under a face-on top chip, brass border.

## 6. Motion

Tactile and physical, but restrained — speed and clarity over spectacle. Explicitly not
the "juicy"/celebratory style (screen shake, particle bursts) — that direction was
considered and rejected during design.

**Library:** Framer Motion, per Felt & Chips' research — new dependency in
`packages/frontend`.

**Concrete targets** (so "restrained" isn't left to interpretation):
- Card deal-in: ~220–280ms, ease-out, with a few degrees of rotation as it lands.
- Chip movement (bet placed, pot collected): ~150–200ms, ease-out.
- Turn indicator: a subtle pulsing glow, not a scale/bounce effect.
- All of the above collapse to opacity-only fades under `prefers-reduced-motion`.

## 7. Accessibility and testing constraints

This is a visual restyle, not a behavior change:

- Every existing `data-testid` (including the Task 10 results/outcome-badge testids —
  `holdem-results`, `holdem-result-${playerId}`, `hand-bet-${seatIndex}-${handIndex}`,
  `hand-result-${seatIndex}-${handIndex}`) stays present under the same name. The
  existing test suite should not need rewriting for this plan to land.
- Existing ARIA roles (`role="status"` on the reconnecting banner, `role="alert"` on the
  error banner) are preserved even though those banners are visually out of scope
  (Section 1) — no regression, just no redesign.
- New color pairs actually used for text must meet WCAG AA contrast: 4.5:1 for body
  text, 3:1 for large text and UI component boundaries. Checked manually (no automated
  a11y tooling exists in this project yet, matching Plan 4's own testing scope).
- No visual/screenshot regression testing, matching Plan 4's Section 4 reasoning — real
  tooling weight for low value at this stage. Verification is a live manual click-through
  per game, the same pattern already used to verify Plan 4 itself.

## 8. Responsiveness

Desktop-first, not mobile-optimized — this is a browser app played by a friend group on
laptops/desktops. The explicit bar is "not visibly broken" down to common laptop widths
(~1024px), not a dedicated small-screen layout for the 8-seat ring. No mobile-specific
engineering is in scope for this plan.

## 9. Out of scope / future work

- **v2 "Deep Saloon + Painterly":** a grain/noise texture overlay and stronger vignette
  on the same table tokens (additive, not a token rename), plus genuinely new painterly
  card art (52 faces + a painterly back) replacing what `assetUrl()` points at. Not
  scheduled. The single biggest cost/risk in that future scope is the painterly card
  art — no usable base to build from, unlike every other item in this plan.
- **Full app chrome re-theme:** `JoinScreen` and the connection/error banners, left
  unstyled by deliberate scope choice (Section 1) rather than oversight.
- **Mobile-first responsive layout.**
- **Sound design.**
