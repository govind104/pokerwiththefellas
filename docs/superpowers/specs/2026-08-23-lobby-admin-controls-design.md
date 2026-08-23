# Lobby & Admin Controls — Design Spec

**Date:** 2026-08-23
**Status:** Approved for implementation planning
**Audience:** Whoever builds this (spec + the follow-up implementation plan are the handoff)

## 1. Overview & Goals

This is **Plan 5** on the project roadmap, replacing the original "Player Accounts &
Blacklisting" scope from `docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md`
Section 6. That section assumed Google OAuth and a DynamoDB `Users` table; both are
dropped for this closed friend-group app (see Section 2 below for why). What's
actually missing today, and what this plan builds instead, is:

1. **A lobby**, so the app can support both game modes from one running server
   instead of a hardcoded `GAME_MODE` env var fixed at process startup.
2. **Admin controls**, so game parameters (blinds, default bet, starting balance)
   and player balance corrections can be adjusted without editing env vars and
   restarting the server.

Persistent chip balances (the other original Plan 5 goal) already shipped in
Plan 3/4 — `packages/server/src/playerStore.ts` keys balances by `displayName`
in a JSON file. Nothing about that changes here.

**Goals:**
- One running server process supports either game mode, chosen at runtime
  instead of baked in at startup.
- An admin (whoever knows the shared passphrase) can start a game night, switch
  game modes, correct a player's balance, and adjust blinds/default
  bet/starting-balance — all without restarting the server.
- Admin-adjusted config values survive server restarts (the server restarts most
  game nights, once Plan 6's idle auto-shutdown exists), so they don't need to
  be re-applied every night.

**Non-goals (explicitly out of scope for this plan):**
- Google OAuth or any per-player login/identity system.
- Blacklisting. For a closed friend group, not sharing the game link/passphrase
  with someone is sufficient moderation — no code needed.
- Live seat-count changes. Seat count stays fixed (currently 6), changeable only
  by editing code/config and restarting.
- Rate-limiting or brute-force protection on the admin passphrase. There's no
  real money at stake (see the master spec's own non-goals), and the passphrase
  carries the same trust model as the game link itself: don't share it widely.

**Unrelated fix, not part of this plan:** a game-engine audit run during this
plan's brainstorming found that split-hand Blackjack currently pays 3:2 (same as
a natural blackjack) where official rules say a post-split 21 should pay 1:1
(`packages/game-engine/src/blackjackRound.ts:126`). This is being fixed as its
own small, separately-scoped change immediately after this spec is approved —
it's a self-contained rule correction with existing test coverage, unrelated to
lobby/admin work.

## 2. Why Not Google OAuth + DynamoDB

The original spec's Plan 5 assumed AWS (DynamoDB) already existed, but AWS
itself is Plan 6 and hasn't started. Beyond that sequencing issue: this app is
for a closed friend group where the person running the server already controls
who gets the link. A real identity/blacklist system solves a problem — strangers
reaching the table, a disruptive player needing to be reliably blocked even if
they retype a new name — that doesn't apply here. Building it anyway would mean
carrying OAuth client setup, a storage-adapter abstraction, and enforcement
logic for a threat model this app doesn't have. Cut for now; nothing here
forecloses adding real accounts later if the app ever grows beyond one friend
group (see the project's own future-multi-game-platform ambitions, which are a
separate, later conversation).

## 3. Architecture

### 3.1 Server: Admin Auth

A single shared passphrase, `ADMIN_PASSPHRASE`, read from the environment at
startup (same convention as `SMALL_BLIND`, `PLAYER_STORE_PATH`, etc. in
`packages/server/src/index.ts`).

- Client emits `admin:login` with the entered passphrase, over the same
  Socket.IO connection used for all gameplay.
- Server compares it to `ADMIN_PASSPHRASE`. On match, marks that specific
  socket connection as admin-authenticated (in-memory only — a `Set<socketId>`
  or equivalent flag on the connection's server-side session state) and
  responds `admin:login:result` `{ success: true }`. On mismatch, responds
  `{ success: false }`.
- **Every** admin action event (Section 3.3) is checked server-side against
  this flag before taking effect — never trust that only the admin UI can
  reach these events, per the same "server is the authority, client only sends
  actions" principle the rest of the app already follows.
- Admin status is **not persisted** — it lives only as long as that socket
  connection does. A page refresh or a disconnect (even within the existing
  reconnect grace window) requires re-entering the passphrase. This is a
  deliberate simplicity choice: no token issuance, no expiry logic, no new
  failure modes to handle.
- If `ADMIN_PASSPHRASE` is unset at startup, every `admin:login` attempt fails
  (there is no default passphrase) and the server logs a warning at startup
  noting that admin controls are unreachable until the env var is set. This
  fails closed rather than open.

### 3.2 Server: Config Persistence

New `gameConfigStore.ts`, structurally identical to the existing
`playerStore.ts` (`packages/server/src/playerStore.ts`) — atomic
temp-file-then-rename writes, and a corrupted file is handled by logging the
error, renaming the corrupt file aside, and degrading to defaults rather than
crashing or rejecting forever. This mirrors a pattern already built, tested,
and proven for exactly this kind of small durable JSON state.

**Persisted fields** (`game-config.json`, path configurable via
`GAME_CONFIG_PATH` env var, default `./game-config.json`):

| Field | Notes |
|---|---|
| `smallBlind` | Poker only |
| `bigBlind` | Poker only |
| `blackjackDefaultBet` | Blackjack only |
| `defaultStartingBalance` | Applies to any never-before-seen `displayName` in `playerStore` |

On first-ever start (no config file yet), these fall back to the existing env
vars (`SMALL_BLIND`, `BIG_BLIND`, `BLACKJACK_DEFAULT_BET`,
`DEFAULT_STARTING_BALANCE`). Any admin edit (Section 3.3) writes through to
this file, which then takes precedence over the env vars on every subsequent
restart.

**`gameMode` is deliberately NOT part of this persisted config.** Every server
start begins with no table and no mode selected — an empty lobby state — so a
stale mode from last time never silently resumes without an admin actively
choosing it that night.

### 3.3 Server: Table Lifecycle & Admin Actions

At startup, the server holds no `Table` instance — just the lobby state
(`mode: null`). Admin actions:

- **`admin:startGame` `{ mode: 'holdem' | 'blackjack' }`** — requires
  admin-authenticated socket. Constructs a `Table` for that mode using the
  current config values (Section 3.2), moves all connected clients from lobby
  to that game, and broadcasts the new mode to everyone so their frontend
  routes into the right table UI.
- **`admin:switchMode` `{ mode }`** — same as `admin:startGame`, but only
  valid when a table already exists. **Rejected if a hand is currently in
  progress** (the server already tracks hand/round state for this — reuse
  that, don't add a parallel flag). If accepted: the current table is torn
  down, all seats cleared (seat semantics differ between Poker and Blackjack,
  so nothing carries over structurally), a new `Table` is constructed for the
  new mode, and all clients are sent back to that game's join screen. Player
  balances are untouched — they live in `playerStore`, entirely separate from
  the `Table`'s live seat state.
- **`admin:adjustBalance` `{ displayName, balance }`** — updates
  `playerStore.setBalance(displayName, balance)`. If that player is currently
  seated at the table, also updates their live in-table balance — **but only
  if they are not currently in an active hand**. A player with chips already
  committed to a pot mid-hand cannot have their stack overwritten without
  corrupting pot math; if the target player is mid-hand, the server rejects
  the action with an error the admin panel surfaces (e.g. "Can't adjust —
  player is in an active hand"). Every affected client's view of that
  balance updates live via the normal state broadcast.
- **`admin:setBlinds` `{ smallBlind, bigBlind }`** (Poker) /
  **`admin:setDefaultBet` `{ blackjackDefaultBet }`** (Blackjack) — updates
  both the live `Table`'s config and the persisted `game-config.json`. Applies
  starting with the **next** hand; a hand already in progress keeps whatever
  blinds/bet it already posted.
- **`admin:setStartingBalance` `{ defaultStartingBalance }`** — updates the
  persisted config. Affects only players whose name has never been seen before
  in `playerStore` (existing players are unaffected — this isn't a balance
  correction tool, that's `admin:adjustBalance`).

### 3.4 Frontend

- New top-level app state: **Lobby vs. Table.** On connect, the server reports
  the current mode. `mode: null` renders the Lobby; a non-null mode routes
  straight into the existing Poker/Blackjack table UI (unchanged).
- **Lobby** (`Lobby.tsx`, new): non-admins see a simple "waiting for a game to
  start" message. An admin-unlocked browser additionally sees a mode picker —
  "Start Poker Night" / "Start Blackjack Night" buttons, or, if a table is
  already active, "Switch to Poker" / "Switch to Blackjack".
- **Admin entry point**: a small "Admin" button/link (visible to everyone —
  no need to hide it; knowing it exists isn't a security boundary, the
  passphrase is) opens a passphrase prompt. On success, that browser's socket
  session is marked admin (Section 3.1) and the UI reveals: the lobby's mode
  picker, plus, once in a table, an **Admin Panel** (`AdminPanel.tsx`, new) —
  a small panel/drawer with: a player picker + balance field (calls
  `admin:adjustBalance`), blind fields or a default-bet field depending on
  the active mode (calls `admin:setBlinds` / `admin:setDefaultBet`), and a
  starting-balance field (calls `admin:setStartingBalance`).

## 4. Data Flow (happy path: admin corrects a balance mid-session)

1. Admin clicks "Admin" → enters the passphrase → client emits `admin:login`.
2. Server validates against `ADMIN_PASSPHRASE`, marks the socket admin,
   responds success.
3. Client reveals the Admin Panel. Admin picks a player name + new balance,
   clicks Save → client emits `admin:adjustBalance { displayName, balance }`.
4. Server checks: (a) socket is admin-authenticated, (b) the named player is
   not currently in an active hand. If both pass: `playerStore.setBalance`
   is called, the live in-table balance is updated if they're seated, and the
   resulting state is broadcast to all connected clients.
5. If the player IS mid-hand, the server responds with an error; the Admin
   Panel surfaces it inline. No state changes.

## 5. Error Handling & Known Limitations

- **Wrong passphrase:** generic failure response, no lockout/rate-limit (see
  Section 1's non-goals — acceptable given the threat model).
- **Balance correction mid-hand:** rejected outright rather than attempting
  any partial/deferred correction — keeps pot math unambiguous. Admin can
  retry once the hand ends.
- **Mode switch mid-hand:** rejected outright, same reasoning.
- **Config file corruption:** identical handling to `playerStore.ts` — logged,
  moved aside, degrades to env-var defaults rather than crashing.
- **Admin status on disconnect:** lost. Reconnecting (even within the existing
  reconnect grace window) requires re-entering the passphrase. This is simpler
  than trying to extend admin trust across a reconnect and was a deliberate
  choice, not an oversight.

## 6. Testing Strategy

- **Unit tests:** `gameConfigStore.ts`, mirroring `playerStore.test.ts` —
  defaults on first read, atomic writes, corrupted-file degradation.
- **Server tests:** admin login accept/reject; every admin action rejected for
  a non-admin socket; balance correction accepted when idle, rejected mid-hand;
  blind/bet changes apply starting next hand, not the current one; mode switch
  accepted when idle, rejected mid-hand; starting-balance changes affect only
  never-before-seen names.
- **Integration test:** scripted multi-client scenario — admin logs in, starts
  a game, players join, admin changes blinds mid-session, play a hand under
  the old blinds (already in progress), verify the *next* hand uses the new
  ones.
- **Frontend tests:** Lobby renders correctly for admin vs. non-admin; Admin
  Panel is gated behind successful login; each control emits the correct
  socket event with the correct payload.
