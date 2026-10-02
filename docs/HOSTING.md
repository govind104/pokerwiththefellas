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
   `ADMIN_PASSPHRASE` to a passphrase of at least 8 characters. Keep it to
   yourself (or whoever runs the game): it can change balances and release
   names, so don't share it with the group. It is separate from Tailscale —
   it just gates the admin controls once you're connected. The server
   refuses to start with `change-me` or anything shorter than 8 characters.
4. Install [Tailscale](https://tailscale.com/download) and sign in. This
   creates your "tailnet."
5. Turn on HTTPS certificates for the tailnet in the Tailscale admin
   console (the [DNS page](https://login.tailscale.com/admin/dns), "HTTPS
   Certificates"). Tailscale Serve needs them. The server listens only on
   `127.0.0.1` (set `HOST` in `.env` to change that), so friends reach it
   through Tailscale Serve rather than directly.

> **Not yet tested on the real host:** the `tailscale serve` commands below
> and the advice to share your machine rather than invite friends to your
> tailnet. The Serve commands follow Tailscale's documented CLI, and the
> sharing advice is an inference, not something tried here. The first real
> session is the check; if the browser console shows the socket refused, see
> "Friends can't connect" under Troubleshooting.

## One-time setup (each friend)

1. Install Tailscale and accept the host's invite to join their tailnet
   (the host sends this from the Tailscale admin console — "Invite
   external device" / "Share" — up to 5 friends fit in the free plan's
   6-user limit alongside the host). Host: prefer sharing the one machine
   (Tailscale admin console, Machines, "Share") over inviting friends to
   the tailnet, because an invite with the default access rules lets them
   reach every device on it. (This is the audit's inference; it isn't
   tested here.)
2. That's it — no account needed in the app itself beyond what already
   exists (a display name; the admin passphrase is only for whoever runs
   the game).

## Starting a session (host)

1. Make sure Tailscale is connected (check the Tailscale app/tray icon).
2. From the repo root, run:

   ```bash
   npm run play
   ```

   This builds the frontend and starts the server as a single process.
3. **First time only:** with the server running, run this once:

   ```bash
   tailscale serve --bg http://127.0.0.1:3000
   ```

   `tailscale serve status` shows it;
   `tailscale serve --https=443 off` turns it off. There's no firewall
   step: the server listens only on `127.0.0.1`, so the OS firewall has
   nothing to open, and Tailscale Serve carries the traffic.
4. Find your Tailscale hostname: run `tailscale status` and look for your
   own device's `<name>.<tailnet>.ts.net` entry, or check the
   [Tailscale admin console](https://login.tailscale.com/admin/machines).
   Prefer this hostname over the raw Tailscale IP — it's stable and
   doesn't need rechecking each session.
5. Share `https://<your-hostname>` (no port) in the group chat.

## Playing

Friends open the link in a browser — no install beyond the one-time
Tailscale setup above. From there it's the normal app flow: enter a
display name, an admin (the host, or whoever runs the game) opens the "Admin" button and enters the passphrase
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

## Names and balances

A name belongs to the browser that first sat down under it. The same
browser gets back in automatically (it keeps a token for that name); another
browser or device can't use the name. A player who clears their browser data
or changes device asks the admin to use **Release a name** in the admin
panel (their balance is kept) and then joins again. Releasing a name doesn't
unseat a player who is still connected under it: a new join gets "already
seated" until the old tab or device is closed. Names ignore capitals
("Bob" and "bob" are one player). If the same player opens a second tab or
device, the newest one takes the seat over and the older one is told, with a
**Play here instead** button if they want it back.

Upgrading from an older version: the first person to join under each
existing name claims it, and `balances.json.v1-backup` keeps a copy of the old
file.

## Ending a session

Stop the server with Ctrl+C — it shuts down cleanly (closes all
connections, then exits) rather than being hard-killed. Balances,
blind/bet settings, and hand history are already saved to local files on
the host's machine (`packages/server/balances.json`, `game-config.json`,
`hand.jsonl` by default) — nothing else to do.

## Troubleshooting

- **Port already in use:** `npm run play` defaults to port 3000. Set
  `PORT=<some other port>` in `packages/server/.env` to change it, and
  point Tailscale Serve at it: `tailscale serve --bg http://127.0.0.1:<that port>`.
  The shared `https://<your-hostname>` link stays the same.
- **Friends can't connect:** check `tailscale serve status`, and that they
  use the `https://` link (not `http://` or a `:3000` address). If the page
  loads but the browser console shows the socket refused, the server's
  Origin check didn't match the link: add the link's origin to
  `ALLOWED_ORIGINS` in `packages/server/.env` (for example
  `ALLOWED_ORIGINS=https://my-pc.tail1234.ts.net`) and restart.
- **The server won't start, "ADMIN_PASSPHRASE ...":** set a passphrase of
  at least 8 characters that isn't `change-me` in `packages/server/.env`.
- **"You opened the game in another tab or device":** that name is now
  seated in a newer tab or device. Click **Play here instead** to take the
  seat back.
- **Someone's phone died / they closed the tab and came back later:** by
  design, a seat stays reserved under that display name indefinitely —
  reconnecting from the same browser just picks the seat back up (another
  browser or device can't, unless the admin releases the name; see "Names
  and balances"), hand-in-progress or not. There's no timeout that kicks a slow-to-return
  player out of their seat; if they drop out mid-hand, the server
  auto-checks/auto-folds (Poker) or auto-stands (Blackjack) for them when
  it is their turn and a short grace window (`RECONNECT_GRACE_MS`, 2
  minutes by default) has passed, so the table isn't stuck waiting, but
  the seat itself is theirs until they leave or the admin removes them (next entry).
- **The table is waiting on someone who isn't playing** (never clicked Ready, walked away mid-hand,
  or a seat left behind by a closed browser): open the **Admin panel**.
  - **Remove from table** frees their seat. Mid-hand, they fold or stand from then on and the seat
    is freed when the hand ends. They keep their name and balance, and can sit down again by typing
    their name.
  - **Act for <name>** folds (or checks, when there is nothing to call) or stands for whoever the
    table is waiting on, once.
  - **Turn clock** (seconds, 0 = off) does the same automatically for any player who takes longer
    than that on a turn. It starts counting from the next turn, so for a player who is already
    stuck use **Act for <name>** once. It resets to off when the server restarts, and players see
    no countdown yet.
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
