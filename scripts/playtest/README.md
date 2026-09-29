# Playtest tooling

Small socket.io scripts for exercising a REAL running server with several players, used for the AI
playtest of the 3D tables (`docs/superpowers/playtests/2026-09-29-3d-tables-playtest.md`). They only
speak the public socket protocol, so they need nothing but Node and the repo's `node_modules`.

## 1. Start an isolated server (never point this at real balances)

Run the server on its own port with scratch data files and a throwaway passphrase, serving the
built frontend. From the repo root (bash; on PowerShell set the variables with `$env:NAME = 'value'`):

```bash
export PLAYTEST_PASSPHRASE=$(node -e "console.log(require('crypto').randomBytes(9).toString('hex'))")
export PLAYTEST_PORT=3100
rm -rf .playtest-data && mkdir .playtest-data
npm run build --workspace=@poker-blackjack/frontend
ADMIN_PASSPHRASE=$PLAYTEST_PASSPHRASE PORT=$PLAYTEST_PORT STATIC_DIR=../frontend/dist \
  PLAYER_STORE_PATH=../../.playtest-data/balances.json GAME_CONFIG_PATH=../../.playtest-data/game-config.json \
  HAND_LOG_PATH=../../.playtest-data/hand.jsonl npm run start --workspace=@poker-blackjack/server
```

(The data paths are relative to `packages/server`, where the workspace script runs; `.playtest-data/`
is git-ignored.) Delete and recreate `.playtest-data` between runs for a clean table. Restarting the
server does NOT drop browser tabs from a previous run: they silently rejoin, so close stale tabs first.

## 2. Drive it

```bash
node scripts/playtest/admin.cjs mode blackjack        # or holdem; needs PLAYTEST_PASSPHRASE
node scripts/playtest/admin.cjs peek                  # one-line table summary
node scripts/playtest/bots.cjs blackjack ann bea cyd  # autonomous players; run in the background
node scripts/playtest/verify-blackjack.cjs 180        # exits 1 and lists any rule violation it sees
```

`verify-blackjack.cjs` recomputes every settled Blackjack outcome from the cards and checks that all
seats share one dealer, that the dealer is revealed only after the last player, and that nobody is
settled early. Give the bots a minute or two to play a number of hands, and read its JSON output.

## 3. Human-style play in a browser

Open `http://127.0.0.1:3100`, join under any name, and play beside the bots. For AI browser testers,
each one needs its OWN tab, should read the visually hidden status region
(`document.querySelector('[role=status].sr-only').innerText`) instead of taking screenshots, and
should click buttons through JavaScript when their tab is in the background (background tabs also
throttle `requestAnimationFrame`, so animations only progress in the foreground tab). Only one tester
should use the foreground tab and screenshots.

For a look at the 3D scene with no server at all: `npm run dev --workspace=@poker-blackjack/frontend`
and open `/dev3d.html` (parameters are described in `HANDOFF.md`, "After Plan 6").
