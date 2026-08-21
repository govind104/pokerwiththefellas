# Plan 4 — Frontend design

**Status:** Approved, ready for implementation planning
**Depends on:** Plan 3 (local real-time server), merged to `master`
**Precedes:** Plan 5 (accounts), Plan 6 (AWS deployment)

## 1. Scope

Build the browser UI for Texas Hold'em Poker and Blackjack, talking to the already-built
and already-fixed Plan 3 Socket.IO server, running locally in development.

**In scope:**
- A React SPA rendering both games' table UI: seats, cards, chips, betting/action
  controls, turn indicators, connection status.
- A join screen using plain display names, matching the server's current identity
  model exactly.
- Reconnection handling that resumes a seat within the server's existing grace window.

**Explicitly out of scope** (belongs to later plans, not touched here):
- Authentication. Plan 5 replaces plain display names with Google-OAuth-backed
  accounts; per the Plan 3 status doc, `PlayerStore`'s interface shouldn't need to
  change, only what's passed as the key — this plan's identity handling is written
  disposably, not designed around a future auth swap.
- Deployment/hosting. Plan 6 covers S3 + CloudFront (per the original design spec,
  Section 2) and the AWS-side plumbing. This plan targets a local Vite dev server
  against a local `packages/server` instance only.
- Any game beyond Poker and Blackjack. See Section 6.

## 2. Architecture

**New workspace:** `packages/frontend` — Vite + React + TypeScript + Tailwind CSS,
added as a new member of the existing npm-workspaces monorepo (`packages/game-engine`,
`packages/server`, now `packages/frontend`).

**Server integration:** `socket.io-client`, typed against the protocol the server
already exports — `ClientToServerEvents`/`ServerToClientEvents`/`ErrorPayload`/
`JoinPayload`/`ActionPayload` from `packages/server/src/protocol.ts`, and
`TableStateView` from `packages/server/src/table.ts`. The frontend takes
`@poker-blackjack/server` as a type-only workspace dependency rather than redefining
the protocol shape — no new shared-types package. This means a future protocol change
in the server breaks the frontend's typecheck immediately, rather than silently
diverging.

**Why not a shared-types package:** the server package already is the single source of
truth for the protocol; introducing a third package to hold copies of those types would
add indirection without adding safety. Revisit only if a non-TypeScript consumer of the
protocol ever appears.

## 3. Application structure

### 3.1 Connection state machine

No routing library — there is only ever one screen the user is "at":

```
disconnected → entering-name → connecting → at-table → (error, shown inline, retryable)
```

### 3.2 Components

**`JoinScreen`** — display-name input, opens the socket connection, emits `join`. On a
successful `state` event, transitions to `at-table`. On an `error` event (e.g. an
invalid display name), shows the error inline and stays on this screen.

**`GameTable`** (shared shell) — owns everything both games have in common: a seat ring
laid out responsively for whatever seat count `state.seats` reports (not hard-coded to
a fixed player count), per-seat chip balance / display name / connected+ready
indicators, the current-turn highlight (`state.activeSeatIndex` for Blackjack,
`state.holdem.actingPlayerId` mapped to a seat for Hold'em), and a non-blocking
reconnect/error banner. Renders one game-specific component into a center slot, chosen
once from `state.gameMode` on the first `state` event received.

`GameTable`'s props are generic — seats, active seat, connection status, a "center
content" slot — with zero Poker- or Blackjack-specific fields. This costs nothing extra
today (it's the natural shape for "seats + turn order + a middle area" regardless of
which two games exist) but is also deliberately the shape a future third game's table
would want to reuse. See Section 6 — this is the only concession made toward
future-game extensibility in this entire plan; everything else here is built exactly
for Poker and Blackjack, no more.

**`PokerTable`** — community cards, pot, own hole cards face-up / opponents' face-down
(the server already performs this filtering per-viewer; the client renders whatever it
receives without any client-side hiding logic), betting controls (fold / check / call /
raise, raise via a slider plus preset amount buttons) shown only when
`state.holdem.actingPlayerId` equals the viewer's own display name.

**`BlackjackTable`** — dealer's hand, each seat's hand(s) (two after a split),
hit/stand/double/split buttons shown only when `state.activeSeatIndex` is the viewer's
own seat, per-hand bust/blackjack/stand indicators.

**`Card`** — `<Card suit rank faceDown? />`, wraps the vendored SVG deck (Section 5).

### 3.3 State management

React Context + hooks — no external state library. The server is authoritative and
pushes the complete `TableStateView` on every change; the client's job is mostly to
render the latest pushed state, not manage complex local state. A `SocketContext`
owns the `socket.io-client` instance, exposes connection status, the latest
`TableStateView`, dispatch functions for `join`/`ready`/`action`/`leave`, and the most
recent error message.

### 3.4 Reconnection

The display name is kept in `sessionStorage` — survives a page reload, clears when the
tab closes (no login exists yet, so nothing more persistent would be appropriate).
`socket.io-client`'s built-in reconnection handles the transport; on reconnect, the
client re-emits `join` with the stored name, landing on the server's existing
`reconnect()` path and resuming the same seat within its grace window.
While disconnected, `GameTable` shows a "Reconnecting…" banner over the last-known
state rather than falling back to `JoinScreen` — the seat is still the player's own
until the grace window actually expires server-side.

## 4. Testing

- Component tests for `Card`, `GameTable`, `PokerTable`, `BlackjackTable`, rendering
  against real `TableStateView` fixtures (not hand-rolled custom shapes) covering:
  your-turn vs. not-your-turn (controls enabled/disabled), hole cards visible vs.
  hidden, representative mid-hand states (post-flop, a Blackjack split hand), and a
  disconnected/reconnecting seat.
- One join → ready → play integration test per game, mirroring Plan 3's own
  `integration.test.ts` shape: a real `packages/server` instance, real
  `socket.io-client` connections, driven end to end. Unit tests alone can't catch a
  frontend/protocol mismatch; this is the same reasoning Plan 3 used for its own
  integration suite.
- Vitest + React Testing Library, matching the monorepo's existing Vitest usage in
  `game-engine` and `server`.
- No visual/screenshot regression testing — real tooling weight for low value at this
  stage of the project.

## 5. Assets and open-source reference

Researched candidate open-source projects before designing this plan (full findings in
session history; summarized here for anyone picking this up later):

- **Card deck:** vendored directly from
  [`Webisso/playing-cards`](https://github.com/Webisso/playing-cards) (MIT, actively
  maintained, predictable `ace_of_spades.svg`-style naming) into
  `packages/frontend/src/assets/cards/`, with attribution recorded in a
  `THIRD_PARTY_NOTICES.md`. [`htdebeer/SVG-cards`](https://github.com/htdebeer/SVG-cards)
  (LGPL-2.1, more visually detailed) is a look-only reference — nothing from it is
  copied into the repo, sidestepping the license question entirely rather than
  resolving it.
- **Poker chips:** built as simple styled components (stacked circles, a value label)
  rather than sourced — no chip asset pack found was worth the dependency over building
  one directly.
- **Layout/UI patterns:** [`therewillbecode/poker-maison`](https://github.com/therewillbecode/poker-maison)
  (Unlicense, demo GIFs in README) and
  [`Pobermeier/vintage-poker`](https://github.com/Pobermeier/vintage-poker) (MIT, live
  demo linked) are read-only references while building the seat ring, chip stacks, and
  turn indicators — not installed as dependencies, since both are full-stack apps whose
  own state/socket layers would be dead weight here.
- **Blackjack UI:** no usable open-source reference was found (only unmaintained
  single-player toy projects). Built from scratch, transferring the same seat/chip/
  turn-indicator visual language `PokerTable` establishes, rather than inventing a
  second visual style.
- **Not used, bookmarked for later:**
  [`boardgame.io`](https://github.com/boardgameio/boardgame.io) (12.4k stars, very
  active) — the cleanest example found of a reusable multi-game seat/turn/phase
  abstraction, but it owns its own state/networking layer that would compete with the
  existing Socket.IO server. Not touched in Plan 4; worth a dedicated look if a future
  plan ever revisits the server architecture for real multi-game support. See Section 6.

## 6. Future multi-game extensibility (context, not a requirement)

There's a long-term (explicitly not current-scope) interest in eventually supporting
more games beyond Poker and Blackjack — Codenames, Uno, Modern Art, Catan, possibly
Monopoly, possibly simpler games like Bomb Party. This plan does not design for that.
The one place it's acted on is Section 3.2's `GameTable` shell being generic rather
than Poker/Blackjack-specific — a decision that cost nothing extra given the natural
shape of the component anyway. No plugin system, no game registry, no abstraction
beyond that single component boundary. If a future plan actually pursues multi-game
support, `boardgame.io` (Section 5) is worth a dedicated evaluation at that time, since
it may replace more of the current architecture than it would extend.
