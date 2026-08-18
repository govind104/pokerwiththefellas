# Local Real-Time Server — Design Spec

**Date:** 2026-08-17
**Status:** Approved for implementation planning
**Audience:** Whoever builds this (spec + the follow-up implementation plan are the handoff)
**Relationship to prior docs:** Implements most of
`docs/superpowers/specs/2026-08-15-poker-blackjack-friends-app-design.md` Section 2
(Architecture) and Section 7 (Data Flow), minus the AWS/Google-OAuth-specific pieces
(those are Plans 5 and 6). Wires the engines built in
`docs/superpowers/plans/2026-08-15-blackjack-engine.md` (Plan 1) and
`docs/superpowers/specs/2026-08-16-holdem-engine-design.md` (Plan 2) to real WebSocket
clients for the first time. This is Plan 3 of the project's 6-plan roadmap.

## 1. Overview & Goals

A local, real-time Socket.IO server that drives one live table of either Blackjack or
Texas Hold'em, using the `@poker-blackjack/game-engine` package unchanged, plus a local
persistence layer for chip balances. No AWS, no Google OAuth, no frontend — same
local-first constraint that shaped Plans 1 and 2, applied one layer up the stack.

**Goals:**
- A new `packages/server` workspace member: a Node.js + TypeScript + Socket.IO process
  that is the authoritative source of truth for one table's game state, exactly as
  described in the original spec's Section 2 — clients send actions, never game state.
- Full seat/turn/settlement orchestration for both `BlackjackRound` and `HoldemHand`,
  including the between-hands transition (constructing a fresh engine instance per
  round/hand).
- A `PlayerStore` interface for chip balances, with a local JSON-file-backed
  implementation, designed so a DynamoDB implementation can be swapped in during Plan 6
  without touching `Table` or the engines.
- Disconnect/reconnect handling with a grace window, matching the original spec's
  Section 8.
- A `HandLog` write-ahead log that lets the server recover an in-progress hand's state
  after a crash or restart, narrowing (not eliminating) the original spec's accepted
  "crash mid-hand loses that hand's state" limitation.
- Full correctness proven by scripted `socket.io-client` integration tests — no manual
  client, no UI, in this plan.

**Non-goals (explicitly out of scope for this plan):**
- Any UI or manually-operable client. Plan 4 (frontend) is the first plan where a human
  clicks through a hand; this plan is proven entirely by automated test clients.
- Google OAuth, an allowlist, or a `Users` table with real accounts. A connecting
  player identifies themselves with a plain display name (Section 4). Real accounts are
  Plan 5.
- Multiple simultaneous tables, a lobby, or matchmaking — the original spec's Section 1
  lists this as a non-goal for the whole project, not just this plan. One hardcoded
  table.
- AWS deployment of any kind (EC2, DynamoDB, Lambda start/stop) — Plan 6.
- Rebuys, admin balance adjustment, or any other chip-management flow beyond
  start-of-session balance and end-of-hand settlement.
- Turn timers/clocks for a player who is connected but simply slow to act. The engines
  already documented this as a deliberate non-goal (Section 3 of both engine specs);
  this plan only reacts to a socket actually disconnecting, not to inactivity.
- Switching game mode (Blackjack ↔ Hold'em) within a running server process (Section 2).

## 2. Architecture

New `packages/server` workspace member, `@poker-blackjack/server`, matching
`game-engine`'s conventions: TypeScript strict mode, `"type": "module"`, depends on
`@poker-blackjack/game-engine` via the npm workspace. Runtime dependency: `socket.io`
(server) for the transport.

One Node process runs one `Table`, holding all live state in memory: seated players
(socket ID ↔ display name ↔ seat index ↔ stack), the configured game mode, and per-seat
disconnect timers. While a round is in progress, `Table` holds either one shared
`HoldemHand` instance (its constructor already takes multiple players) or one
independent `BlackjackRound` instance per seated player, keyed by seat index —
`BlackjackRound`'s constructor takes a single `initialBet` and has no multiplayer
concept at all (`playerHands` is one player's *split* hands, not other players' hands),
so a multi-seat Blackjack table is modeled as N independent player-vs-dealer rounds
running in parallel, each with its own shoe and dealer outcome, coordinated by `Table`
only for turn order and broadcasting. This requires no changes to the engine and is
consistent with the 6-deck-shoe-reshuffled-every-hand rule already established for
Blackjack (Section 3 of the original spec) — nothing about that rule assumed a shared
shoe across players. There is no multi-tenancy and no `TableManager` — the original
spec's Section 1 explicitly excludes multiple simultaneous tables for this project, so
building one now would be speculative. `Table` is kept as a single, well-bounded class
specifically so that promoting to multiple tables later, if it's ever genuinely needed,
is a contained addition rather than a rewrite.

Game mode (Blackjack or Hold'em), small/big blind amounts (Hold'em), and starting
balance for new players are all startup configuration (environment variables or a
config file), not runtime-switchable — matching the Non-goals above. Seat capacity is 8
for both games, matching the original spec's Hold'em cap (Section 3) and applied
uniformly rather than defining a separate, unspecified Blackjack limit.

| File | Responsibility |
|---|---|
| `table.ts` | The `Table` class: seat assignment, turn routing, delegating actions to the active engine instance, triggering settlement, managing between-hands transitions, disconnect grace-window timers, and the startup crash-recovery routine (Section 3) — `Table` is the only place with full knowledge of both engines' constructors, so all game-specific log interpretation lives here rather than in `handLog.ts`. |
| `playerStore.ts` | The `PlayerStore` interface (Section 3) plus a `JsonPlayerStore` implementation. |
| `handLog.ts` | The generic, game-agnostic `HandLog` interface (Section 3) plus a `JsonlHandLog` implementation — knows nothing about `Table` or the engines. |
| `protocol.ts` | Shared TypeScript types for socket event payloads, reusing `game-engine`'s `PlayerAction`/`HoldemAction`/etc. types directly rather than redefining them. |
| `socketServer.ts` | Socket.IO server setup and event wiring: translates socket events into `Table` method calls, and serializes `Table`'s state into a per-socket view (Section 4). |
| `index.ts` | Process entry point: reads config, constructs `Table`, `PlayerStore`, `HandLog`, starts the Socket.IO server. |

## 3. Storage Interfaces

Two independent interfaces, each with exactly one local implementation in this plan.
Both are `Promise`-returning even though the local implementations don't strictly need
to be asynchronous — DynamoDB (Plan 6's eventual `PlayerStore` implementation) is
inherently network-bound, so the interface is shaped for that constraint now rather
than changed later.

```typescript
interface PlayerStore {
  getBalance(displayName: string): Promise<number>;
  setBalance(displayName: string, balance: number): Promise<void>;
}
```

`JsonPlayerStore` persists balances to a single local JSON file, read on
`getBalance`/written on `setBalance`. A name with no prior entry returns a configured
default starting balance rather than an error — matching how a new friend joining a
game night should just join. This is the interface Plan 6 replaces with a
DynamoDB-backed implementation; `Table` and the engines never change.

```typescript
interface HandLog {
  append(entry: HandLogEntry): Promise<void>;
  readAll(): Promise<HandLogEntry[]>;
  clear(): Promise<void>;
}
```

`HandLog` is deliberately game-agnostic: `HandLogEntry` is just an opaque
`{ type: string; data: unknown }` record, and `HandLog` itself has no knowledge of
`Table`, `HoldemHand`, or `BlackjackRound`. All interpretation of what's in `data`,
and the actual crash-recovery reconstruction, live in `Table.recoverFromLog()`
instead (Section 5) — `Table` is the only place with full knowledge of both engines'
constructors. Keeping `HandLog` itself generic keeps it low-risk and independently
testable.

`JsonlHandLog` writes each entry as one JSON line to a local file; `clear()` truncates
it. `Table` appends a `hand_started`-typed entry (the constructed engine's config and
the already-shuffled deck, so recovery replays actions, never randomness) when a hand
begins and an `action`-typed entry after each accepted action, then calls `clear()` —
not a `hand_settled` entry — once a hand settles, so the log only ever holds at most
one in-progress hand's worth of history.

`Table.recoverFromLog()` is called once, at server startup: if the log is empty,
there's nothing to recover. Otherwise it reconstructs a fresh engine instance from the
logged config/deck and replays the logged `action` entries through `.act()` in order.
If replay produces an already-settled hand — meaning the crash happened during or
after the multi-seat settlement commit, where recovery can't tell which balances were
already written — it discards the hand and clears the log rather than risk
re-applying a payout that was already committed (Section 6). Otherwise, it restores
seats from the logged player list and marks every recovered seat disconnected,
starting the same grace-window timers an ordinary disconnect would (Section 5), so
reconnecting players resume through the normal reconnect path rather than a separate
recovery-specific one.

`HandLog` is local-only scaffolding for crash recovery. Unlike `PlayerStore`, it has no
designed DynamoDB counterpart — Plan 6 will decide, based on real operational
experience, whether to keep it (e.g., against local EC2 disk, since recovery is
inherently a single-box concern), replace it, or drop it. Not designed further here.

## 4. Socket Protocol

Client → server events:
- `join { displayName }` — request a seat. Rejected with `error` if the table is full
  or the name is already seated. If the name matches a seat currently in its
  disconnect grace window (Section 5), rebinds this socket to that seat instead of
  assigning a new one.
- `ready {}` — the sending seat signals ready for the next hand. Once every seated
  player is ready (minimum 2 seated, uniformly for both games — solo Blackjack against
  the dealer is out of scope for this friends-focused app, and a uniform rule keeps
  `Table`'s ready-check logic game-agnostic), `Table` starts the next hand
  automatically. An explicit signal rather than a countdown/timer, so both this plan's
  automated tests and Plan 4's eventual UI have a deterministic trigger to drive.
- `action { ...PlayerAction | HoldemAction }` — passed through to the active engine's
  `.act()` after `Table` validates it's the sending seat's turn. The payload shape is
  exactly the engine's own action type; the server does not define a parallel type.
- `leave {}` — vacate a seat. Only permitted between hands; mid-hand, folding via
  `action` is the only way to stop participating in the current hand.

Server → client events:
- `state { ... }` — the full authoritative table state, sent to every seated socket
  after any change (join/leave/ready/action/settlement). Filtered per-recipient: a
  player's own `holeCards` are included, everyone else's are omitted, and the dealer's
  full hand is omitted until Blackjack's `phase === 'settled'` — mirroring exactly what
  the engines' own doc comments already say is safe to reveal, enforced here for the
  first time since nothing enforced it before this plan existed.
- `error { message }` — sent only to the socket whose action was rejected. No broadcast,
  no state change.

## 5. Data Flow

**Happy path:**
1. Client connects, emits `join`. `Table` assigns an open seat, loads the player's
   balance via `PlayerStore.getBalance` (creating a default-balance entry if new).
2. Each seated player emits `ready`. Once all seated players (≥2) are ready, `Table`
   constructs a fresh `BlackjackRound`/`HoldemHand` with current stacks, deals, and logs
   `hand_started` to `HandLog`.
3. Each `action` is validated for turn/seat ownership, passed to `.act()`, logged to
   `HandLog`, and the resulting filtered `state` is broadcast.
4. On settlement, `Table` reads `results`, commits new balances via
   `PlayerStore.setBalance` for every affected seat, logs `hand_settled`, and returns to
   a between-hands state awaiting the next round of `ready`s.

**Disconnect / reconnect:**
5. A socket disconnecting mid-hand marks its seat disconnected and starts a ~2-minute
   grace-window timer. If the same display name reconnects (a fresh `join`) within the
   window, the new socket is rebound to that seat and play resumes exactly where it
   left off.
6. If the window elapses while it is that seat's turn, `Table` calls the safest
   always-legal action into `.act()` on the player's behalf — `stand` in Blackjack;
   `check` if available, otherwise `fold`, in Hold'em — the same as if a real player
   had chosen it, logged the same way. If the window elapses on a seat that isn't
   currently acting, the seat is simply marked sat-out until it reconnects or the hand
   ends.

**Server restart:**
7. On boot, `Table.recoverFromLog()` runs before the Socket.IO server starts
   accepting connections. If it finds an unsettled hand, `Table` adopts the
   reconstructed engine instance and seat mapping as its starting state. Since a
   process restart necessarily drops every existing socket connection, every
   previously-seated player reconnects through the normal `join` flow in step 1/5 — the
   grace-window mechanism built for ordinary disconnects is what lets them resume their
   seats after a restart too, with no separate recovery-specific reconnect path needed.

## 6. Error Handling & Known Limitations

- **Illegal actions throw inside the engines**, same as `BlackjackRound`/`HoldemHand`
  always have. `Table`'s methods simply let the throw propagate (rejecting the
  returned promise) — `Table` has no knowledge of sockets. `socketServer.ts` is what
  catches it and emits `error` to that one socket. Either way, there's no state
  change or broadcast, since the throw happens before anything is mutated.
- **Malformed or unexpected socket payloads are rejected before reaching the engine at
  all** — never let unvalidated input reach `.act()`.
- **A crash mid-write** (process dies after appending an `action` log entry but before
  broadcasting it, or vice versa) loses at most that single in-flight action on
  recovery — the hand resumes one action short of where it actually was. This narrows
  the original spec's accepted "crash mid-hand loses that hand's state" limitation
  (Section 8) to "loses at most the last action," rather than eliminating the
  limitation entirely.
- **No rebuys.** A player whose balance reaches 0 can't post a blind or place a bet and
  is effectively out for the session — no in-plan flow to add chips. Consistent with
  the original spec's silence on rebuys and this plan's non-goal on chip-management
  flows beyond settlement.
- **No admin/host controls.** Manually adjusting a balance or removing a disruptive
  player (Section 6 of the original spec) requires the `admin` role, which requires
  accounts — Plan 5.

## 7. Testing Strategy

Entirely via scripted `socket.io-client` connections (per this plan's non-goal on a
manual client) — the same "prove it with tests, not by hand" discipline Plans 1 and 2
used for the engines, one layer up the stack:

- A full hand end-to-end for both Blackjack and Hold'em, multiple seated clients,
  through settlement and a verified `PlayerStore` balance commit.
- Reconnect within the grace window resuming the same seat mid-hand correctly.
- Disconnect past the grace window on the disconnected seat's turn, verifying the
  server-driven fold/check and that the hand continues correctly for the rest of the
  table.
- Illegal action attempts rejected via `error`, with no state change and no broadcast
  to other sockets.
- Balances surviving a simulated server restart (stop the server, start a new instance
  pointed at the same `PlayerStore` file, verify balances match).
- Crash recovery: mid-hand, discard the in-memory `Table` and call
  `HandLog.recoverInProgressHand()` directly against the log file, asserting the
  reconstructed engine state matches what was true immediately before the "crash."
- Full-table capacity and rejected-`join` behavior (table full, duplicate name).

## 8. Future Scaling Considerations

Not part of this plan's build, kept in mind so the later plans aren't a rewrite:

- **Plan 4 (frontend)** becomes the real consumer of the Socket Protocol (Section 4)
  defined here — `join`/`ready`/`action`/`leave` and `state`/`error` are the actual
  integration surface a React client will be built against.
- **Plan 5 (accounts)** replaces plain-display-name identity with `googleSub`-keyed
  identity, and adds an auth handshake before `join` is even accepted (the original
  spec's Section 7, steps 1-3). `PlayerStore`'s interface shape shouldn't need to
  change — only what gets passed as the key, and where that key comes from.
- **Plan 6 (AWS)** swaps `JsonPlayerStore` for a DynamoDB-backed implementation behind
  the same `PlayerStore` interface. `HandLog`'s fate is an open question deferred to
  that plan, per Section 3.
- If a lobby or multiple simultaneous tables are ever genuinely needed (the original
  spec's Section 9 public-storefront scenario), `Table`'s isolation (Section 2) is
  designed so that becomes an additive `TableManager` wrapping multiple `Table`
  instances, not a restructuring of `Table` itself.
