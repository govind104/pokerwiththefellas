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
to pick Poker or Blackjack and start the game, everyone else takes a seat
(the table has 6 seats).

**3D or classic table.** Both games open in a first-person 3D saloon view on
screens at least 900px wide (narrower screens such as phones get the classic 2D table). Each player
can switch at any time with the "2D view" / "3D view" button; the choice is
remembered per browser. The 3D view needs WebGL (any current desktop
browser) and loads its code (~150 kB gzipped) only when it is shown; if
WebGL isn't available the app falls back to the 2D table by itself. The
"Quality" menu (Low / Medium / High) trades looks for speed on older
laptops, and "Sound" is off until someone turns it on. All of this runs in
each player's own browser — the host machine does no extra work for it.

**Blackjack rules at the table.** Everyone at the table is dealt from one
shared shoe against one dealer hand. Players act in seat order, the dealer
plays once after the last player, and everyone is paid together.

## Ending a session

Stop the server with Ctrl+C — it shuts down cleanly (closes all
connections, then exits) rather than being hard-killed. Balances,
blind/bet settings, and hand history are already saved to local files on
the host's machine (`packages/server/balances.json`, `game-config.json`,
`hand.jsonl` by default) — nothing else to do.

## Troubleshooting

- **Port already in use:** `npm run play` defaults to port 3000. Set
  `PORT=<some other port>` in `packages/server/.env` to change it, and
  share `http://<your-hostname>:<that port>` instead.
- **Someone's phone died / they closed the tab and came back later:** by
  design, a seat stays reserved under that display name indefinitely —
  reconnecting (same name, any device) just picks the seat back up,
  hand-in-progress or not. There's no timeout that kicks a slow-to-return
  player out of their seat; if they drop out mid-hand, the server
  auto-checks/auto-folds (Poker) or auto-stands (Blackjack) for them when
  it is their turn and a short grace window (`RECONNECT_GRACE_MS`, 2
  minutes by default) has passed, so the table isn't stuck waiting, but
  the seat itself is theirs until they explicitly leave.
- **Upgrading the server while a Blackjack hand is on disk:** the hand log
  format changed when Blackjack moved to one shared shoe. If the server is
  stopped mid-hand on the old version and restarted on the new one, the old
  in-progress hand is discarded with a warning (nobody is paid or charged
  for it) and the table starts clean. Finished hands are unaffected.
- **A hand ended with no result:** if the server ever cannot finish a
  Blackjack hand (it would have to run out of cards in the shoe, which six
  decks at six seats cannot do in normal play), it cancels that hand with
  no balance changes, sends everyone back to "not ready", and logs the
  reason to the server console. Players just ready up again.

## One thing to decide up front: who hosts

Balances and settings live on whichever machine last ran the server —
they do **not** follow the game if a different person hosts next time.
For continuity, pick one person's machine as the regular host. If hosting
genuinely needs to rotate, the outgoing host would need to manually copy
`balances.json`, `game-config.json`, and `hand.jsonl` from
`packages/server/` to the next host's machine before their session — this
isn't automated.
