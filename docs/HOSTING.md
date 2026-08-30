# Hosting a Session

The app runs on one person's machine during a session ("the host") and the
rest of the group connects to it over [Tailscale](https://tailscale.com), a
free private-network tool. No cloud hosting, no ongoing cost. See
`docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md` for
the full design rationale.

## One-time setup (host)

1. Install [Node.js](https://nodejs.org) (LTS) and clone this repo, if you
   haven't already. This is the one step that's obvious to a developer but
   worth spelling out for a friend who ends up hosting and isn't one.
2. Run `npm install` at the repo root.
3. Copy `packages/server/.env.example` to `packages/server/.env` and set
   `ADMIN_PASSPHRASE` to a passphrase you'll share with the group in-app
   (this is separate from Tailscale — it just gates the admin controls
   once you're already connected).
4. Install [Tailscale](https://tailscale.com/download) and sign in. This
   creates your "tailnet."

## One-time setup (each friend)

1. Install Tailscale and accept the host's invite to join their tailnet
   (the host sends this from the Tailscale admin console — "Invite
   external device" / "Share" — up to 5 friends fit in the free plan's
   6-user limit alongside the host).
2. That's it — no account needed in the app itself beyond what already
   exists (a display name, and the shared admin passphrase if you're
   running the game).

## Starting a session (host)

1. Make sure Tailscale is connected (check the Tailscale app/tray icon).
2. From the repo root, run:

   ```bash
   npm run play
   ```

   This builds the frontend and starts the server as a single process.
3. **First time only:** your OS will likely prompt to allow the app
   through the firewall. Accept it for Private/home networks — otherwise
   friends won't be able to reach the port at all.
4. Find your Tailscale hostname: run `tailscale status` and look for your
   own device's `<name>.<tailnet>.ts.net` entry, or check the
   [Tailscale admin console](https://login.tailscale.com/admin/machines).
   Prefer this hostname over the raw Tailscale IP — it's stable and
   doesn't need rechecking each session.
5. Share `http://<your-hostname>:3000` in the group chat.

## Playing

Friends open the link in a browser — no install beyond the one-time
Tailscale setup above. From there it's the normal app flow: enter a
display name, an admin opens the "Admin" button and enters the passphrase
to pick Poker or Blackjack and start the game, everyone else takes a seat.

## Ending a session

Stop the server with Ctrl+C. Balances, blind/bet settings, and hand
history are already saved to local files on the host's machine
(`packages/server/balances.json`, `game-config.json`, `hand.jsonl` by
default) — nothing else to do.

## Troubleshooting

- **Port already in use:** `npm run play` defaults to port 3000. Set
  `PORT=<some other port>` in `packages/server/.env` to change it, and
  share `http://<your-hostname>:<that port>` instead.

## One thing to decide up front: who hosts

Balances and settings live on whichever machine last ran the server —
they do **not** follow the game if a different person hosts next time.
For continuity, pick one person's machine as the regular host. If hosting
genuinely needs to rotate, the outgoing host would need to manually copy
`balances.json`, `game-config.json`, and `hand.jsonl` from
`packages/server/` to the next host's machine before their session — this
isn't automated.
