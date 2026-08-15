# Poker & Blackjack Friends App — Design Spec

**Date:** 2026-08-15
**Status:** Approved for implementation planning
**Audience:** Whoever builds this (spec + the follow-up implementation plan are the handoff)

## 1. Overview & Goals

A browser-based multiplayer app so a friend group can play Texas Hold'em and
Blackjack together online, replacing an existing Discord bot. Chip balances
persist across sessions. Hosted on AWS, on-demand, within a ~$5-15/month
budget. This is explicitly the **friends-only MVP** — a possible future
Steam release is a separate, much larger effort (see Section 9).

**Goals:**
- Friends can start a game night, log in, and play a full hand of Hold'em or
  Blackjack together in a browser, no installs.
- Chip balances persist per-player across sessions.
- Hosting cost stays low and can't runaway even if something misbehaves.
- A host can remove (blacklist) a disruptive player.

**Non-goals (explicitly out of scope for this spec):**
- Real-money wagering or chip purchases/cash-outs of any kind.
- Multiple simultaneous tables or matchmaking with strangers.
- Steam packaging, Steamworks integration, or any storefront requirements.
- Mobile native apps (the browser app should be usable on mobile browsers,
  but no dedicated app).

## 2. Architecture

**Frontend:** Static single-page app (React) hosted on S3 + CloudFront.
Handles Google sign-in, the lobby screen, and the table UI (cards, chips,
betting controls) over a WebSocket connection to the game server.

**Game server:** A single Node.js + TypeScript process using Socket.IO,
running on one EC2 (or Lightsail) instance — e.g. `t3.micro`/`t4g.micro`.
This process is the **authoritative** source of truth for all game state:
deck, hands, pot, turn order. The client never sends "I have blackjack" or
"the pot is X" — it only sends actions (`hit`, `bet 50`, `fold`), and the
server computes and broadcasts the resulting state. This closes off the
obvious client-side cheating vector by construction.

**Data store:** DynamoDB, single table `Users`:

| Field | Notes |
|---|---|
| `googleSub` (PK) | Stable Google account ID — the permanent player identity |
| `displayName` | From Google profile |
| `chipBalance` | Only written at hand-boundary commits (see Section 6) |
| `role` | `player` \| `admin` |
| `isBlacklisted` | bool |
| `blacklistReason`, `blacklistedBy`, `blacklistedAt` | audit trail |
| `createdAt`, `lastSeenAt` | |

DynamoDB on-demand pricing is effectively free at 8-player scale and stays
always-on independent of whether the game server is running, so balances
are queryable/manageable even while the game server is stopped.

**Auth:** Google OAuth 2.0. The ID token's `sub` claim is the permanent
player identity key. Only pre-approved Google accounts can create a profile
(see Section 4 — this is also the primary anti-abuse gate, not just a login
mechanic).

**Start/stop control plane:** A "Start Game Night" button (visible only to
`admin`-role accounts) calls a small Lambda via API Gateway that runs
`ec2:StartInstances` on the game server instance. The instance runs an
idle-shutdown script (cron/systemd timer) that checks the current Socket.IO
connection count every few minutes and self-shuts-down after ~15 minutes at
zero connections.

## 3. Game Rules (MVP defaults)

These are defaults chosen to keep the engine simple to build; call them out
explicitly to whoever implements this so they're a deliberate choice, not a
gap:

**Blackjack:**
- 6-deck shoe, reshuffled fresh every hand (simpler than tracking
  penetration across hands — no physical deck constraint online).
- Dealer stands on all 17s (hard and soft).
- Blackjack pays 3:2.
- Double-down on any first two cards; split once per hand, double after
  split allowed; no insurance or other side bets in the MVP.

**Texas Hold'em:**
- No-Limit, standard blind structure (small/big blind amounts configurable
  by the host at table creation).
- Up to 8 players, one table.
- Dealer button rotates each hand; standard hand ranking.
- **All-in / side pots are supported and are the single trickiest part of
  this engine to get right** — multiple players all-in for different
  amounts in the same hand requires correctly splitting the pot into main
  + side pots and awarding each to the right subset of eligible players.
  Flagging this explicitly because it's the most common source of subtle
  poker-engine bugs; it deserves dedicated test cases (see Section 8), not
  just casual manual testing.

## 4. Security & Firewall

- **EC2 security group:** inbound allowed only on 443 (HTTPS/WSS, terminated
  via Nginx + Let's Encrypt on the instance). SSH (22) restricted to a
  specific known IP, never open to `0.0.0.0/0`.
- **IAM least privilege:** the start/stop Lambda's role may only
  `StartInstances`/`StopInstances` on this one instance's ARN. The game
  server's own instance role may only read/write the `Users` table —
  nothing broader.
- **Allowlist gate:** Google OAuth proves identity but not group membership.
  A pre-approved list of Google account emails (config, not user-editable)
  gates who can create a `Users` profile at all. This is the primary
  control keeping strangers from ever reaching the game server or
  contributing to cost.
- **No AWS credentials in frontend code** — all AWS SDK calls happen
  server-side only.
- **Server-side validation on every action** — never trust client-submitted
  game state (see Section 2).
- Rate-limit the `/start-game` endpoint and any join/auth endpoints.

## 5. Cost Control

Two independent layers, so a failure in one doesn't mean runaway cost:

1. **Application-level:** idle-shutdown script (Section 2) stops the
   instance when nobody's connected. This handles the common case.
2. **Hard backstop:** an AWS Budget alarm emails at $10 and $20/month
   thresholds. Recommended: also wire the budget action to a Lambda that
   force-stops the instance if spend crosses a hard ceiling, so a bug in
   the idle-shutdown script (or an unexpected traffic pattern) can't
   silently run the bill up — this doesn't rely on anyone seeing the email
   in time.

DynamoDB (on-demand) and S3+CloudFront (static assets) are both
effectively pennies/month at this scale and don't need the same guardrails,
but should still appear on the same billing alarm as a sanity check.

## 6. Player Accounts & Blacklisting

- Roles: `player` (default) and `admin` (one or more trusted friends, set
  directly in the `Users` table — no self-service admin promotion).
- Admins get access to admin-only server endpoints: view all players,
  manually adjust a chip balance (for correcting mistakes), and
  blacklist/unblacklist a player with a required reason.
- **Blacklist enforcement happens server-side at two points:** (1) the
  join-table request, and (2) the WebSocket connection handshake itself —
  so a blacklisted player can't get a live connection at all, not just a
  UI-level restriction that a determined person could bypass.
- Blacklist state lives in DynamoDB, so it survives server restarts and
  applies immediately on next connection attempt.

## 7. Data Flow (happy path)

1. Browser → Google OAuth → app receives ID token.
2. Backend verifies the token, checks the account against the allowlist and
   `isBlacklisted`, then issues an app session token.
3. Client opens a WebSocket (Socket.IO) using that session token; server
   authenticates the connection before allowing it to join a table.
4. Game actions (`bet`, `hit`, `fold`, etc.) flow over the socket; server
   validates each against current authoritative state and broadcasts the
   resulting state to all seated players.
5. At the end of each hand, the server computes the outcome and commits
   updated `chipBalance` values to DynamoDB for every affected player.

## 8. Error Handling & Known Limitations

- **Crash mid-hand:** because balances only commit to DynamoDB at hand
  boundaries (Section 7, step 5), a server crash mid-hand loses that hand's
  in-progress state but never loses already-committed chips. This is an
  accepted MVP limitation — worth stating explicitly so it's a known
  trade-off, not a surprise. A future iteration could add periodic
  in-hand state checkpointing if this proves annoying in practice.
- **Reconnect:** a dropped connection (refresh, flaky wifi) resumes the
  player's seat within a short grace window (target: 2 minutes) using the
  same session token before the server auto-folds/sits them out.

## 9. Future Scaling Considerations (if this ever targets a public storefront)

Not part of this MVP's build, but worth building the MVP with these in mind
so the eventual pivot isn't a rewrite. Full detail was researched separately
(legal, security, architecture, accessibility, privacy) — the load-bearing
points to keep in the back of your mind while building the MVP:

- **Never introduce a dual-currency model** (a purchasable currency
  convertible to game chips) — several US states are actively legislating
  against exactly this pattern for simulated-casino apps. Keep chips
  strictly non-purchasable and non-redeemable, even later.
- The single-instance, in-memory game server (Section 2) would need to
  split into a **connection layer + game-logic layer** (e.g., Socket.IO +
  Redis pub/sub) to horizontally scale beyond one box.
- A **provably-fair shuffle** (server commits a hash of its shuffle seed
  before the hand, reveals it after) becomes worth adding once players are
  strangers rather than friends who trust you.
- One-by-one blacklisting (Section 6) would need to become a real
  reporting/moderation pipeline with a support queue.
- GDPR/CCPA compliance (real data export/delete flows, not just a DB flag)
  becomes mandatory once the app is publicly reachable, not optional.
- Steam release itself requires a Steam Direct fee, a store page in
  "Coming Soon" status for 2+ weeks before release, and two separate Valve
  review passes (store page, then build) — budget calendar time for this
  independent of dev time.
- Legal review specifically on simulated-gambling classification and
  age-rating strategy (ESRB vs. PEGI diverge significantly here) should
  happen before, not after, committing to a storefront release.

## 10. Testing Strategy

- **Unit tests** for game logic in isolation (no server/network): deck
  shuffling, hand evaluation, Blackjack payout rules, Hold'em pot/side-pot
  splitting (Section 3) — this last one specifically needs multiple
  all-in-with-different-stacks test cases, not just the simple case.
- **Integration tests** spinning up the server with a few scripted
  Socket.IO clients to play a full hand end-to-end, including a disconnect/
  reconnect scenario.
- **Manual playtest checklist** with the actual friend group before
  treating it as ready for a real game night — automated tests won't catch
  UX friction (confusing controls, unclear turn indicators, etc.).
