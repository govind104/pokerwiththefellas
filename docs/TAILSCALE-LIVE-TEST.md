# Tailscale live test (Windows host)

The first real run of the game behind Tailscale Serve: Task 9 step 6 of
`docs/superpowers/plans/2026-10-01-identity-and-exposure.md`. It answers
whether Serve's `Host` / `X-Forwarded-Host` pass the server's Origin check,
and tests the "share the machine" advice in `docs/HOSTING.md`.

Test with your own phone first, then add a friend. The phone needs no
sharing, so if something fails you know it's the server or Serve, not the
invite.

## A. One-time setup on the host PC

1. **Install Tailscale** (tailscale.com/download, Windows) and sign in with
   Google, Microsoft or GitHub. That creates your tailnet.
2. **Name the machine first.** In the admin console (login.tailscale.com),
   go to **Machines**, then ⋯ → Edit machine name, and pick something
   neutral like `poker`. Do this **before** step 9: the first Serve run gets
   an HTTPS certificate, and the machine's full name
   (`poker.tailXXXX.ts.net`) is then published in the public certificate
   transparency logs for good. Don't let a name like `firstname-laptop` or
   `DESKTOP-ABC123` end up there.
3. **Turn on HTTPS:** in the admin console, open **DNS**, check that
   **MagicDNS** is on, then click **Enable HTTPS** under HTTPS
   Certificates. Serve needs it. Enabling only allows certificates; one is
   issued, and the name published, when Serve first runs on a machine.
4. **Get the full hostname** (`poker.tailXXXX.ts.net`):
   ```bash
   tailscale status
   ```
5. **Back up your balances:** the first start of this branch converts
   `packages/server/balances.json` to the v2 format. It saves
   `balances.json.v1-backup` itself, but copy `balances.json`,
   `game-config.json` and `hand.jsonl` from `packages/server/` somewhere
   safe anyway.
6. **Check the passphrase:** `ADMIN_PASSPHRASE` in `packages/server/.env`
   must be at least 8 characters and not `change-me`, or the server won't
   start.

## B. Your phone

7. Install Tailscale on the phone, sign in with the **same account** and
   turn it on. It is now on your tailnet.

## C. Find out which header Serve sends

The server doesn't log why it refuses a socket. So before starting the
game, put a page on port 3000 that just prints the request headers.

8. On the host, from any folder:
   ```bash
   node -e "require('http').createServer((q,r)=>{r.setHeader('content-type','text/plain');r.end(JSON.stringify(q.headers,null,2))}).listen(3000,'127.0.0.1')"
   ```
9. In a second terminal, start Serve:
   ```bash
   tailscale serve --bg http://127.0.0.1:3000
   ```
   The first time, it may print a login.tailscale.com link asking you to
   allow Serve on your tailnet. Open it, approve, and run the command again.
   If it says access denied, use a terminal opened with Run as
   administrator.
10. Check it. It should show `https://poker.tailXXXX.ts.net` proxying to
    `http://127.0.0.1:3000`:
    ```bash
    tailscale serve status
    ```
11. On the phone, with Tailscale on, open `https://poker.tailXXXX.ts.net`.
    You'll see the request headers as JSON. **Note what `host` and
    `x-forwarded-host` say** (a screenshot is fine).
    - If either one equals `poker.tailXXXX.ts.net`, the Origin check will
      pass with no extra setting.
    - If neither does, you'll need `ALLOWED_ORIGINS` (step 14).
12. Stop the header page with Ctrl+C in its terminal. Serve keeps its
    setting (that's what `--bg` does), so it will forward to the game next.

## D. Run the game

13. From the repo root:
    ```bash
    npm run play
    ```
    It should report listening on 127.0.0.1:3000.
14. **On the phone,** open the same `https://…ts.net` link and join with a
    name.
    - **You get a seat:** the socket connected and the Origin check passed.
    - **The page loads but stays on "Connecting…" / "Reconnecting…":** the
      Origin check refused it. Add this line to `packages/server/.env`,
      then press Ctrl+C and run `npm run play` again:
      ```
      ALLOWED_ORIGINS=https://poker.tailXXXX.ts.net
      ```
15. **On the host,** open `http://localhost:3000`, log in as admin and start
    a game. Play one hand with the phone seated.

## E. Add a friend

16. In the admin console, go to **Machines**, click ⋯ on the host PC, then
    **Share**, and either copy the invite link or share by email. A shared
    machine lets them reach only this PC, not the rest of your tailnet.
    Don't invite them as tailnet users.
17. The friend installs Tailscale, creates a free account, opens the invite
    link and accepts. Then they open `https://poker.tailXXXX.ts.net` and
    join.

## F. Afterwards

18. Stop the game with Ctrl+C, then stop publishing the PC:
    ```bash
    tailscale serve reset
    ```
19. Record in `HANDOFF.md`:
    - the `host` and `x-forwarded-host` values from step 11;
    - whether step 14 worked without `ALLOWED_ORIGINS`;
    - whether the friend got in through the share.

    Then remove the "Not yet tested" warning from `docs/HOSTING.md`, check
    its free-plan user-limit claim against what sharing actually needed,
    and tick Task 9 step 6 in the plan.

## How sure this guide is (2026-10-01)

- **Steps 9–10 and 18 (the Serve commands):** checked against Tailscale's
  Serve docs on 2026-10-01. Whether you must approve Serve first, and
  whether Windows needs admin rights, are from memory.
- **Which headers Serve sends:** not documented by Tailscale. Step 11
  exists to find out.
- **Sharing (steps 16–17):** matches Tailscale's sharing docs, which say
  the recipient reaches only the shared machine.
