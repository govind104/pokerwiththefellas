# Plan 6 (Re-scoped): Local Hosting Over Tailscale

## 1. Overview & Goals

Get the app playable by the friend group without any cloud hosting. The
group plays occasionally — roughly once a week or once every few weeks, for
an hour or two at a time — so an always-on cloud deployment is unnecessary
cost and complexity for the actual usage pattern. Instead, whoever is
hosting a session (the user, or a friend) runs the app on their own machine
for the duration of play, and the rest of the group connects to it over a
private [Tailscale](https://tailscale.com) network.

This replaces the original Plan 6 scope ("AWS deployment: DynamoDB, EC2")
entirely — see Section 10 for what's dropped and why.

**Goals:**
- Starting a session is a single command.
- Friends join with a browser, no install beyond a one-time Tailscale setup.
- No ongoing cost.
- No new cloud infrastructure, accounts, or credentials to manage.
- Existing local JSON-file persistence (balances, game config, hand log)
  keeps working unchanged.

## 2. Architecture

**Today:** two separate processes — a Vite dev server (frontend, port 5173)
and a bare `node:http` server with Socket.IO attached (backend, port 3000,
`packages/server/src/socketServer.ts`). The frontend reads
`VITE_SERVER_URL` at build time (`packages/frontend/src/App.tsx:12`),
defaulting to `http://localhost:3000`. This is fine for local development
but means two ports to expose and two things to start for a game night.

**Target:** one process, one port. The backend serves the frontend's built
static assets directly, alongside its existing Socket.IO/API traffic, using
a shared `http.createServer` instance (Socket.IO already supports this;
adding static-file serving — via Express's `static` middleware, the
simplest well-trodden option — is additive, not a rewrite of the existing
server). `VITE_SERVER_URL`'s hardcoded `localhost:3000` default becomes
same-origin-aware (falling back to `window.location.origin` when unset)
so the built frontend works correctly when accessed via the host's
Tailscale address, while remaining overridable for local dev with two
separate ports.

**Persistence is unchanged.** `PlayerStore`/`GameConfigStore`/`HandLog`
(`packages/server/src/{playerStore,gameConfigStore,handLog}.ts`) keep
writing to local JSON/JSONL files on the host's disk. No database
migration — the app only runs while someone is actively hosting, so an
always-on managed database buys nothing here.

**Connectivity:** [Tailscale](https://tailscale.com) (WireGuard-based mesh
VPN). The host and every friend install the Tailscale client once and join
the host's tailnet (free "Personal" plan: 6 users, unlimited devices per
user — matches this app's own 6-seat table cap exactly). Once joined,
every device gets a stable private address and a MagicDNS hostname
(`<device>.<tailnet>.ts.net`) that friends can reach directly — no port
forwarding, no fixed/public IP required (works fine behind CGNAT, which is
relevant since the user is in India where ISPs commonly don't hand out a
fixed public IP), and the host's real home IP is never exposed to anyone.

**No TLS/reverse-proxy layer.** Tailscale's own WireGuard tunnel already
encrypts all traffic between joined devices, so plain HTTP within the
tailnet is fine. This drops the original spec's entire Nginx +
Let's Encrypt requirement.

## 3. Server Changes

- Add static-file serving for the frontend's built output
  (`packages/frontend/dist` after `vite build`) to the existing HTTP
  server in `packages/server/src/socketServer.ts`, sharing the same
  `http.createServer` instance Socket.IO already attaches to.
- Change `packages/frontend/src/App.tsx`'s `SERVER_URL` default from the
  hardcoded `'http://localhost:3000'` to a same-origin fallback, so a
  single deployed instance needs no build-time server URL configuration.
  `VITE_SERVER_URL` remains a supported override for the existing
  two-port local dev workflow.
- No changes to game logic, admin controls, or the lobby — this plan is
  purely about how the already-working app gets reached.

## 4. Launch & Runbook

- A single launch path (npm script or small cross-platform script) that
  builds the frontend and starts the server together, so running a
  session is one command rather than two terminals.
- A runbook document covering:
  - **One-time setup:** install Tailscale, host creates/uses their
    tailnet, invite each friend (up to 5, filling the free 6-user tier).
  - **Per-session:** confirm Tailscale is connected, run the launch
    command, find the host's MagicDNS hostname (`tailscale ip -4`, or the
    stable `<device>.<tailnet>.ts.net` name — prefer the hostname over the
    raw IP since it doesn't need rechecking each time), share
    `http://<hostname>:<port>` in the group chat, play, then stop the
    process when done (state persists to disk for next time).
  - Required env vars, matching what's already documented in
    `HANDOFF.md` (`ADMIN_PASSPHRASE`, blind/bet/balance defaults, etc.) —
    unchanged by this plan.

## 5. Data Flow (happy path)

1. Host runs the launch command. Server builds/serves the frontend and
   starts listening.
2. Host confirms Tailscale is up and notes their MagicDNS hostname.
3. Host shares `http://<hostname>:<port>` with the group.
4. Friends (already tailnet members from one-time setup) open the link in
   a browser — normal app flow from there: lobby, admin passphrase entry,
   seating, play.
5. Host stops the process when the session ends. Balances/config/hand log
   are already persisted to local JSON files; nothing further to do.

## 6. Error Handling & Known Limitations

- **Server started before Tailscale is connected:** should fail or warn
  clearly rather than silently binding to an interface nobody can reach.
- **A friend not yet added to the tailnet:** outside the app's control;
  the runbook calls this out as a pre-session checklist item.
- **Stale build:** the launch path must always rebuild the frontend
  rather than trust a possibly-outdated `dist/` folder.
- **Port already in use:** existing `PORT` env var override already
  covers this; document it in the runbook.
- **Host's machine goes to sleep / closes laptop mid-session:** ends the
  game for everyone, same as any locally-hosted LAN-party-style game.
  Acceptable for this use case; not a bug to engineer around.

## 7. Testing Strategy

- Unit/integration coverage for the new static-file serving: the server
  returns the built `index.html`/assets correctly, and existing
  Socket.IO/API behavior on the same port is unaffected.
- A test for the frontend's same-origin `SERVER_URL` default, alongside
  the existing `VITE_SERVER_URL`-override behavior (already covered by
  `packages/frontend/src/integration/integrationTestServer.ts`) — both
  paths must keep working.
- No new AWS-related test surface; that category is removed entirely
  (see Section 10).

## 8. Security

- Traffic between tailnet devices is already encrypted (WireGuard); no
  additional TLS setup needed.
- The app is unreachable from the public internet — only devices
  explicitly invited into the host's tailnet can connect at all. This is
  a stronger isolation boundary than the original spec's EC2 security
  group + allowlist approach, achieved with less configuration.
- Existing in-app security (the shared `ADMIN_PASSPHRASE` gating admin
  actions, server-side validation of all game actions) is unchanged and
  still the right boundary for "friend with a bad idea" rather than
  "stranger on the internet," which no longer applies here anyway.

## 9. Containerization — Considered and Rejected

Docker was considered as a way to make hosting portable across whichever
friend is hosting on a given night. Rejected: this is a single Node/
TypeScript monorepo with no exotic dependencies, so Docker's main
benefits (dependency isolation, environment parity) don't address a real
pain point here — the single-command launch script (Section 4) already
solves "easy to start." What Docker would add is friction that matters
more for this use case than its benefit: whoever hosts needs Docker
installed (heavier than Node itself), and the JSON-file state (balances,
config, hand log) would need a correctly-configured volume mount to
survive between sessions — get that wrong once and a container
rebuild silently wipes everyone's chip balances. Not worth it for a
casual, infrequent hobby session.

## 10. Explicitly Out of Scope (dropped from the original Plan 6)

The original master spec (`2026-08-15-poker-blackjack-friends-app-design.md`,
Sections 2, 4, 5) targeted AWS: EC2/Lightsail hosting, DynamoDB, S3 +
CloudFront, security groups, Let's Encrypt, AWS Budget alarms, and an
idle-shutdown script. All of it is dropped:

- **AWS compute (EC2/Lightsail) and containers (ECS Fargate/Lightsail
  Containers):** unnecessary now that hosting is local; also, as
  researched during brainstorming, AWS's free tier changed fundamentally
  in July 2025 (no more perpetual EC2 free tier for new accounts; Fargate
  has never had one) — none of it was actually free long-term anyway.
- **DynamoDB:** the original spec's `Users` table also predates Plan 5's
  re-scope away from accounts/blacklisting — it no longer matches this
  app's actual data model (balances + game config + hand log via
  `PlayerStore`/`GameConfigStore`/`HandLog`), and a database migration
  buys nothing for a server that only runs during active sessions.
- **S3 + CloudFront:** no static hosting needed; the frontend is served
  directly by the local process (Section 2/3).
- **Security groups, Let's Encrypt/TLS, AWS Budget alarms,
  idle-shutdown script:** all specific to running an internet-facing
  cloud instance; none apply to a Tailscale-only, never-internet-facing
  local process.

A cloud deployment remains a possible future direction if the group's
needs ever outgrow "occasional local sessions" (e.g., wanting the app
always reachable without anyone hosting) — this spec does not preclude
that, it just reflects that it isn't the actual need right now.
