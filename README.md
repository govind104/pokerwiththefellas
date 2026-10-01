# Poker or Blackjack

A browser-based Texas Hold'em + Blackjack table for a friend group. One
person hosts from their own machine, everyone else joins from a browser —
no accounts, no cloud hosting, no ongoing cost.

## Features

- **Texas Hold'em and Blackjack**, switchable by the host at runtime
  without restarting the server.
- **6-seat table**, real-time via Socket.IO — every player's browser stays
  in sync instantly.
- **First-person 3D tables (Blackjack and Hold'em)** — a moody, lamp-lit saloon view
  (Three.js) with animated dealing, silhouetted opponents and optional
  synthesised sound. Switch to the classic 2D table at any time; it also
  kicks in automatically if the browser can't run WebGL.
- **A proper shared Blackjack dealer** — one shoe and one dealer hand per
  round. Players act in seat order, the dealer plays once after the last
  player, and everyone is settled against that same hand.
- **No accounts.** Players just type a display name. A name belongs to the
  browser that first sat down under it (a token kept in that browser), so
  nobody else can take the seat or the balance. The host's admin passphrase
  (at least 8 characters, kept to themselves) gates host controls; the admin
  can release a name for a player who lost their browser data.
- **Admin toolkit**: correct a player's balance, adjust blinds / the
  Blackjack default bet / the starting balance for new joiners, switch
  game modes — all from a panel in the running app.
- **Persistent state** — balances, table settings, and hand history
  survive a server restart (plain JSON/JSONL files on the host's disk, no
  database).
- **Reconnect-friendly** — closing a tab or losing wifi doesn't lose a
  seat; rejoining from the same browser picks it back up. A short
  grace window auto-folds/auto-stands a slow-to-return player mid-hand so
  the table isn't stuck waiting, but nobody gets permanently kicked over
  a bad connection.
- **Local hosting over [Tailscale](https://tailscale.com)** — friends
  connect to the host's machine over a private network, so there's
  nothing to deploy and nothing running when nobody's playing.

## Tech stack

An npm-workspaces monorepo, split by responsibility:

| Package | What | Key tech |
|---|---|---|
| `packages/game-engine` | Card/hand/betting logic for both games — deck, shoe, Hold'em hand evaluation and betting rounds, Blackjack rounds and payouts | TypeScript, [pokersolver](https://www.npmjs.com/package/pokersolver) |
| `packages/server` | Real-time game server, admin controls, persistence | Node.js, TypeScript, [Socket.IO](https://socket.io), [sirv](https://github.com/lukeed/sirv) (static file serving) |
| `packages/frontend` | The web UI | React 18, [Vite](https://vitejs.dev), Tailwind CSS, Framer Motion, [Three.js](https://threejs.org) (3D table views), socket.io-client |

Testing is [Vitest](https://vitest.dev) across all three packages (plus
[Testing Library](https://testing-library.com) for the frontend's
component/integration tests) — 479 tests, run with one command.

## Getting started (local development)

```bash
npm install
```

Set the one required environment variable and start the backend:

```bash
ADMIN_PASSPHRASE=whatever-you-want npm run dev --workspace=@poker-blackjack/server
```

(That inline `VAR=value` form is for bash-style shells. On Windows PowerShell,
or to avoid retyping it, copy `packages/server/.env.example` to
`packages/server/.env` and set it there instead.)

This listens on port 3000 by default, on `127.0.0.1` only (set `HOST` to
change that; see `docs/HOSTING.md`). In a second terminal, start the
frontend:

```bash
npm run dev --workspace=@poker-blackjack/frontend
```

Open `http://localhost:5173` in a few browser tabs to play as different
seats. Click "Admin" in the corner, enter the passphrase you set above,
and pick Poker or Blackjack to start a game.

Tables open in the 3D view on screens at least 900px wide (toggle with the
"2D view" / "3D view" button; the choice is remembered). To look at the 3D
scene without a server or admin login, open
`http://localhost:5173/dev3d.html` (only the frontend dev server is needed) —
a scripted Blackjack hand you can step through (`?step=0..8`; add
`&game=poker` for a Hold'em hand, steps 0..5; `&quality=low|medium|high`).

See [`packages/server/src/index.ts`](packages/server/src/index.ts) for
every environment variable the server reads (blinds, default bet,
starting balance, reconnect grace window, where its data files live,
etc.) — `packages/server/.env.example` documents the same list. Blinds,
default bet and starting balance from the environment are only first-run
defaults: once an admin changes one in the app, the values saved in
`game-config.json` take over.

## Hosting an actual session with friends

That's a different, simpler flow — one command builds the frontend and
starts a single process serving both the app and the game server
together:

```bash
npm run play
```

Full walkthrough, including one-time [Tailscale](https://tailscale.com)
setup so friends can reach your machine without any port-forwarding or
cloud hosting (the server listens only on `127.0.0.1`; Tailscale Serve
publishes it to the tailnet over HTTPS): **[docs/HOSTING.md](docs/HOSTING.md)**.

## Running tests

```bash
npm test              # full suite across all three workspaces
npm run typecheck     # TypeScript across all three workspaces
```

Per-package: `npm run test --workspace=@poker-blackjack/<game-engine|server|frontend>`.

## Project structure

```
packages/
  game-engine/   deck, shoe, Hold'em + Blackjack rules — no I/O, pure logic
  server/        Socket.IO server, lobby/admin logic, JSON/JSONL persistence
  frontend/      React UI (lobby, 2D table views for both games, admin panel)
    src/three/   first-person 3D tables: pure scene models, Three.js engine, shared shell
    dev3d.html   dev-only 3D harness page (not part of the production build)
    THIRD_PARTY_NOTICES.md   licences for the card SVGs, three.js and fonts
scripts/
  playtest/      bot players, an admin conductor and a rule-checking spectator for playtesting a real server
docs/
  README.md                  index: which docs are kept current, which are historical
  HOSTING.md                 how to run a real session with friends
  superpowers/specs/         design docs for each feature area
  superpowers/plans/         the implementation plans those specs became (historical)
  superpowers/playtests/     findings from the AI playtests (3D tables; full audit 2026-10-01)
HANDOFF.md       full development history and where things stand
```

Not sure which doc to read? **[docs/README.md](docs/README.md)** lists every
document and whether it describes the current code or is a historical record.

## How this was built

Every feature started as a written design spec, became an implementation
plan, and was built task-by-task with a code review after each task plus
a whole-branch review before merging — several of those whole-branch
reviews caught real bugs that no single task's review could have (dead
code, a rejected admin action that nuked a session, a CSS overlap bug
that only showed up in a real browser). A later, dedicated hardening pass
drove the running server with real concurrent socket connections —
simulated disconnects, races, corrupted state files, capacity limits — to
verify the app holds up under real play, not just passing unit tests.
A follow-up round of that same scrutiny, specifically re-verifying
Blackjack payout math through the live server, incidentally caught two
real data-corruption bugs in how balances and game settings were
persisted under concurrent writes — the kind of thing that's easy to
miss until something is actually pushed hard enough to expose it.

The 3D tables were then playtested by AI players: separate subagents each
played hands in their own browser tab against a real running server, one of
them dedicated to reviewing how it looked, and a scripted spectator
re-derived every Blackjack outcome from the cards. That round found the
things unit tests could not — most importantly that Blackjack had been
dealing every seat its own private dealer hand, which is why the game now
uses one shared shoe and dealer. Details:
[docs/superpowers/playtests/](docs/superpowers/playtests/2026-09-29-3d-tables-playtest.md).

The full story — every plan, every review round, every fix, and why
several features were deliberately re-scoped along the way (accounts and
OAuth dropped in favor of a shared passphrase; AWS deployment dropped in
favor of local Tailscale hosting) — is in **[HANDOFF.md](HANDOFF.md)**.
That's the place to start if you're picking this project back up.
