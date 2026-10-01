# Full audit and live playtest — 2026-10-01

Branch `audit/2026-10-01-full-audit`. No code was changed for this audit. The code is the source of truth: every
Critical and Important finding below was re-checked against the current source, and the line numbers were corrected
where the sources had them wrong.

## 1. Summary

- **Not ready for a real session with friends yet.** The rules engines are solid: side pots, showdown evaluation,
  Blackjack dealing and settlement, and hole-card secrecy during a hand all held up across 138 scripted Hold'em hands,
  56 rule-checked Blackjack hands and two multi-tester browser sessions. The weak points are around the edges: what is
  revealed after a fold-out, concurrency, admin operations, error handling, and phone layout.
- **Top risks:** (1) a heads-up hand where both players are all-in from the blinds locks the table until the server
  restarts; (2) a player who wins because everyone else folded has their hole cards shown to the whole table, on every
  such hand; (3) two quick Blackjack actions (a double-click on Double or Split) can push a balance below zero, and
  the negative balance is saved; (4) any admin action that hits a briefly locked data file crashes the whole server;
  (5) anyone can take over a disconnected player's seat, cards and chips just by typing that player's name.
- The most common annoyances in live play: nothing stops an idle but connected player from blocking the table
  (no turn or ready timer, and no admin kick); "Call N" is offered to a short stack and then rejected; a double-tap
  on Hit deals two cards; and on phones the 2D Hold'em action bar overflows (Fold is off-screen) while the pot reads 0.
- **Counts:** 5 Critical, 15 Important, 30 Minor (after merging duplicates across 13 sources).

## 2. Method

- **Baseline:** `npm run typecheck` exit 0; `npm test` 479/479 (frontend 174, game-engine 131, server 174);
  frontend build exit 0, with a Vite warning that the TableStage chunk is 578.5 kB (150.7 kB gzipped).
- **Five independent Opus code audits:** (a) Blackjack, (b) Hold'em, (c) server and security, (d) frontend,
  (e) docs. Each wrote throwaway `*.auditrepro.test.ts` repros, which were deleted afterwards. Copies are kept in
  `.playtest-data/audit/repro/{a,b,c}`.
- **Scripted Hold'em run:** a socket-protocol agent on its own server (port 3101, grace 5 s) played 138 hands with
  6 seated clients, a rejected 7th client, a spectator and an admin. It checked about 30,000 state snapshots for
  hole-card leaks, re-derived every pot layer and winner with pokersolver, and checked chip conservation and the
  persisted `balances.json` after every hand.
- **Blackjack rule verifier** (`scripts/playtest/verify-blackjack.cjs`): 3 runs (6 bots, 6 bots, then a human
  session), 18 + 20 + 18 = 56 hands, `problems: []` in all three.
- **Two browser sessions** on an isolated server (port 3100, built `dist` served). Testers were Sonnet subagents, one
  tab each. Blackjack: dan (mid-hand join, reload, short and long disconnects), eve (bad names, double-submit,
  illegal actions, identity), fay (admin), cara (visual), plus 2 bots. Hold'em: hal (raise-box abuse, all-in), ivy
  (admin), gus (mid-hand join, reload, disconnects), cara (visual), plus 2 bots.
- **Deviations from a real session:** `RECONNECT_GRACE_MS=30000` (the default is 120000) to keep disconnect tests
  short. The in-app browser pane was hidden for the whole run, so `requestAnimationFrame` was throttled (about
  0.5 fps in Blackjack, 0 fps in Hold'em). Live 3D animation could not be judged; the visual reviewer stepped
  `/dev3d.html` by hand instead.
- **Reproducing:** follow `scripts/playtest/README.md`, but point the data paths at a subfolder (see §7). The
  throwaway admin passphrase was kept in a file and never printed.

## 3. Findings

Severity is judged for a friend group whose play-money balances persist. Wrong money, hidden-card leaks, permanently
stuck tables, server crashes and identity takeover are Critical. VERIFIED means reproduced (repro output or a live
hand) or shown by unambiguous quoted code. INFERRED means reasoned from the code and not run.

### Critical

#### C1. Heads-up hand where both blinds are all-in settles inside the constructor; the table is locked until a restart
- **Where:** `packages/game-engine/src/holdemHand.ts:126,148-155` (the constructor calls `resolveActingPlayer`,
  which calls `advanceStreet` and runs the board out to `settled`); `packages/server/src/table.ts:390` (startHand
  never checks `street === 'settled'`); `table.ts:461-464` (`settleHoldem` is only reached from `submitAction`).
- **Status:** VERIFIED. Audit B's table repro (alice 5, bob 8, blinds 5/10) gives `street settled acting null
  handInProgress true`, then `leave -> Cannot leave while a hand is in progress`, `action -> It is not alice's turn`,
  and the persisted balances are unchanged. The scripted run hit the same thing live in hand 132 (S7d): admin
  adjust and switch mode are also refused.
- **Scenario:** two players are left with chips, both stacks ≤ the big blind (normal near the end of a session, or
  after the admin raises the blinds). Both click Ready.
- **Impact:** every action, leave, admin adjust and mode switch is refused, and the hand is never paid. Only a server
  restart frees it.
  *What a restart does (this settles the conflict between the sources):* `recoverFromLog` replays the log to
  `settled`, clears it without paying, and restores no seats (`table.ts:715-718`). So the stuck hand is voided and
  no chips move (the script agent is right). But the two players still have the same stacks, so the next time both
  click Ready with unchanged blinds the same lock happens again (audit B is right about that). The admin has to
  change a balance or the blinds between the restart and the next Ready.
- **Suggested fix:** in `startHand` (Hold'em branch), right after `new HoldemHand(...)`:
  `if (this.holdemHand.street === 'settled') await this.settleHoldem(this.holdemHand);`. Do the same after replay in
  `recoverFromLog`, and settle instead of voiding. Add a table test with two short stacks.
- **Sources:** audit B (Critical), play-script-holdem B1 (Critical), orchestrator-notes.

#### C2. A fold-out winner's hole cards are shown to every client
- **Where:** `packages/server/src/table.ts:851-854`
  (`p.playerId === viewerDisplayName || (hand.street === 'settled' && !p.folded)`). This contradicts the engine's own
  contract at `holdemHand.ts:44-48` ("only players who did NOT fold (i.e. reached showdown) may have their hole cards
  revealed").
- **Status:** VERIFIED. Audit B repro: the loser's view and the spectator view both contain the winner's cards. The
  scripted run saw it in every fold-out (hands 45-54, on all four streets). Live: gus H2 (ann's `5♠ A♥` shown after
  everyone folded) and H7 (bea's `8♠ 8♣`); hal and cara saw the same.
- **Scenario:** any hand that ends with everyone else folding. The cards stay visible until the next hand starts,
  because `lastSettledHoldemHand` is kept.
- **Impact:** every bluff that gets folded to is exposed to the table. Happens many times a session.
- **Suggested fix:** add a `wentToShowdown` flag in HoldemHand (set it in `settleShowdown`, not in
  `settleUncontested`) and reveal only when it is set. Add a fold-out view test.
- **Sources:** audit B (Critical), script B2 (rated Important, "minor impact"; **under-rated**: it is a hidden-card
  leak on a large share of hands), gus (Important), cara S3, hal.

#### C3. Two Blackjack actions sent close together skip the affordability check; the balance goes negative and is saved
- **Where:** `packages/server/src/table.ts:466-476`. `assertCanAffordBlackjackAction` runs before
  `await handLog.append(...)`, and `round.act()` runs after it. `socketServer.ts:259-270` does not serialize
  `action` events per socket. `SocketContext.tsx:301-303` sends with no in-flight guard.
- **Status:** VERIFIED. Audit A repros R1-R3. R3 used real socket.io, JsonlHandLog and JsonPlayerStore:
  `emit('action',{action:'split'})` immediately followed by `emit('action',{action:'double'})` with a balance of 50
  persisted `{ alice: -25 }`. R2: after a legal split, two concurrent `double`s were both applied (exposure 100
  against a balance of 75). Not hit live.
- **Scenario:** a player double-clicks Double on split hand 1 (both clicks land inside the log append, which is a few
  ms of file I/O), or a console user sends two emits in a row. The second action is checked against the stale
  exposure.
- **Impact:** breaks the "balance never below 0" rule and persists a negative balance. Hand-log replay stays
  consistent, so recovery does not fix it.
- **Suggested fix:** a per-table promise-chain mutex around the body of `submitAction` (the auto-act path goes
  through it too), or re-run the turn and affordability checks after the append, just before `round.act()`. Also add
  the client in-flight guard from I1.
- **Sources:** audit A (Critical).

#### C4. Any admin handler can crash the whole server on a transient file error
- **Where:** `packages/server/src/socketServer.ts:313-336, 338-373, 375-403, 405-417, 419-430, 432-443`. None has a
  try/catch, socket.io ignores the returned promise, and Node 24 exits on an unhandled rejection. `index.ts` has no
  `unhandledRejection` handler.
- **Status:** VERIFIED. Audit C `probe2.cjs lock`: another process holds `balances.json` exclusively, then the admin
  sends `adminAdjustBalance`. `repro/c/data-main/server.log`: `Error: EBUSY: resource busy or locked ... at async
  JsonPlayerStore.readAll` then `EXIT CODE 1`. The lock was injected. How often antivirus, backup or indexer tools
  hold these files on a real host is INFERRED.
- **Scenario:** the admin adjusts a balance, changes blinds, bet or starting balance, or starts or switches the game
  while `balances.json` or `game-config.json` is briefly locked (a Windows `rename` over an open file gives EPERM).
- **Impact:** every player is disconnected and nothing restarts the server. An in-flight hand is recovered from the
  log after a manual restart. On a failure that does not crash, the admin gets no error.
- **Suggested fix:** wrap each async admin handler in a `safeHandler` that catches and calls
  `rejectAdmin(err.message)`; add `process.on('unhandledRejection', ...)` logging in `index.ts`; optionally retry
  `rename` on EPERM/EBUSY.
- **Sources:** audit C (Critical).

#### C5. Identity is only the display name: anyone can take a disconnected player's seat, see their cards, act for them and inherit their balance
- **Where:** `socketServer.ts:221-222` (`table.reconnect(payload.displayName)`); `table.ts:285-308` (matches by name
  alone, with no time limit, by design); `playerStore.ts:106` (balances keyed by the raw name). After a restart every
  recovered seat is disconnected (`table.ts:789-793`).
- **Status:** VERIFIED. Audit C `probe.cjs` T1: "mallory" typed `alice` mid-hand, saw alice's hole cards
  (`10♠ 4♦`) and balance, and acted for her. Live: the orchestrator freed six ghost seats by joining as those names
  and emitting `leave`. A connected seat cannot be taken (eve's `ann` attempt was rejected with "already seated").
  FIXED on audit/2026-10-01-full-audit (item 5); browser pass and Tailscale Serve check pending.
- **Scenario:** Alice's wifi drops mid-hand. Anyone sends `join {displayName:"alice"}` and gets her seat, cards and
  chips; Alice's own reconnect then fails with "already seated". After a restart, every seat can be claimed this way.
  Different spellings ("Bob" and "bob", a name with a zero-width space) are also separate accounts with fresh
  balances.
- **Impact:** hidden-card leak and play with another person's money. Inside a trusted tailnet this needs a friend to
  misbehave, but I7 makes the server reachable beyond the tailnet. The docs do not tell the host any of this (audit E).
- **Suggested fix:** issue a random per-player token on first join, keep it in the client's localStorage, store it
  with the balance, and require it for `reconnect` and for joining under an existing name. Add an admin reset. Until
  then, document the trust model in HOSTING.md.
- **Sources:** audit C (Critical), audit E (Important, docs), audits A/B (noted, out of scope), orchestrator-notes.

### Important

#### I1. A double-click or double-tap sends two actions (an extra Hit card; Stand on both split hands)
- **Where:** `packages/frontend/src/components/BlackjackTable.tsx:186-197`, `three/Blackjack3D.tsx:96-107`,
  `socket/SocketContext.tsx:301-303` (no pending state; the buttons stay enabled until the next snapshot).
- **Status:** VERIFIED. Audit D repro: `userEvent.dblClick(Hit)` gave `[['hit'],['hit']]`. Live, eve H3: two clicks
  on Hit with 4+3 dealt `K♥` and `5♣`, a bust. In Hold'em the second click is rejected ("not your turn"), as hal
  verified.
- **Impact:** real balance lost on a hand the player did not play that way. Lag over Tailscale and the 3D deal delay
  both encourage a second click.
- **Suggested fix:** an `actionPending` flag set by `sendAction` and cleared on the next `state` or `error`; disable
  all action buttons while it is set. Better still, have the server accept a turn token or sequence number with each
  action. The server-side serialization from C3 does not fix this one, because both actions are legal.
- **Sources:** audit D (Important), eve (Important), audit A (Minor; **under-rated**).

#### I2. Admin handlers check for a hand and then await: a hand or a join can land in between
- **Where:** `socketServer.ts:396-401` (adjust balance), `348-368` (switch mode), `221-239` (join, which uses the
  *new* `table` after its await); `table.ts:156-164` (`setSeatBalance` has no `handInProgress` guard).
- **Status:** VERIFIED with injected store delays of 300-400 ms. Adjust: audit C R2 persisted `{ alice: -5 }`;
  audit A R5 persisted `{ alice: -25 }`. Switch: audit A R6 and audit C R3 left a `*_hand_started` from the
  abandoned table at the head of the shared log; after a simulated restart A R6 recovered the orphaned Blackjack hand
  and dropped the live Hold'em hand. Join: audit C R1, where alice (never seated on the new table) saw and folded
  bob's hand. The windows were not hit live; the live mid-hand refusals work (fay, ivy).
- **Scenario:** the admin edits a balance or switches mode at the same moment the last player clicks Ready, or a
  player's auto-rejoin is in flight during a switch.
- **Impact:** wrong persisted money, a corrupted write-ahead log, or another player's cards leaked. Each consequence
  would be Critical on its own. Rated Important because every case needs two humans to act within one file write
  (a few ms), which the repros could only hit with artificial delays. All three sources rated it Important; agreed.
- **Suggested fix:** let Table own these operations, synchronously: `adminSetBalance` rejects while a hand is in
  progress and sets the in-memory balance before the awaited persist. Add a `freeze()` that `startHandIfEveryoneReady`
  honours during a switch, and re-check after every await. In `join`, capture `const t = table` and drop the result
  if `table !== t`. Give a replaced table a `dispose()` that clears its timers.
- **Sources:** audit A (2 × Important), audit B (Important + Minor), audit C (3 × Important).

#### I3. Hold'em settlement is not crash-safe: a crash between balance writes creates or destroys chips
- **Where:** `table.ts:545-558` (sequential per-player `setBalance`, no write-ahead marker); `table.ts:715-718`
  (recovery of a `settled` hand just clears the log).
- **Status:** VERIFIED. Audit B repro: the second `setBalance` never completes, and a new Table recovers. Persisted
  `{ alice: 1010 }` with bob still at the default 1000, so 2010 chips instead of 2000.
- **Impact:** wrong money after a crash or a Ctrl+C during settlement (narrow window). A crash after the last action
  is logged but before any write silently voids a decided hand. Blackjack already has a `blackjack_seat_settled`
  marker for this.
- **Suggested fix:** when recovery replays to `settled`, apply `hand.results` as absolute balances
  (`stack + payout` from `holdem_hand_started.players`), which is idempotent, then clear.
- **Sources:** audit B (Important).

#### I4. Invalid blind or env config silently stops every hand from starting
- **Where:** `socketServer.ts:405-417` (each blind is checked to be positive, but `smallBlind <= bigBlind` is never
  checked); `gameConfigStore.ts:37` (`sanitize` does not check the relationship, and is not applied to env
  defaults); `index.ts:13,18-21` (`Number(env ?? d)` is never validated); `table.ts:408-428` (a failed start is
  logged to the console only, with no broadcast).
- **Status:** VERIFIED live. Ivy saved SB 50 / BB 10: everyone Ready, no hand, no client error;
  `server.log: bigBlind must be greater than or equal to smallBlind`. Audit C probe3 confirmed the same for 50/0.5 and
  for `SMALL_BLIND=abc`. `RECONNECT_GRACE_MS=abc`, blank or negative gives a 1 ms timer, so a disconnect is auto-acted
  at once (audit C, run with node).
- **Impact:** the table looks frozen with no explanation, and after the blinds are fixed it stays frozen (I5).
  Recoverable, so not Critical. Ivy and cara rated it Critical; **over-rated**, because a reload or a leave unblocks it.
- **Suggested fix:** reject `smallBlind > bigBlind` and non-integers in `adminSetBlinds` and in AdminPanel; validate env
  defaults at boot and fail fast, as is done for `ADMIN_PASSPHRASE`; when `startHand` fails, emit an error to the
  ready seats and the admin.
- **Sources:** audit B (Important), audit C (Important + Minor), audit E (Minor), ivy (Critical), cara S1 (Critical),
  hal B4.

#### I5. The ready check is not re-run after admin balance, blind or bet changes
- **Where:** `table.ts:145-149` (`updateConfig`) and `156-164` (`setSeatBalance`) never call
  `startHandIfEveryoneReady()`; `GameTable.tsx:62` and `TableStage.tsx:317` hide Ready once a seat is ready.
- **Status:** VERIFIED. Audit A R4 (setting the only not-ready seat to 0 leaves `handInProgress=false`); script S7c2
  (topping up a 0-balance ready seat starts nothing); live, ivy (after fixing the blinds the table stayed stuck until
  she clicked Leave).
- **Impact:** the ready players have no button to press and cannot see why the table is waiting. It clears on any
  leave, disconnect or reconnect.
- **Suggested fix:** call `this.startHandIfEveryoneReady().catch(...)` at the end of `setSeatBalance` and
  `updateConfig`, the same pattern `reconnect` uses.
- **Sources:** audit A (Important), script B7 (Minor), ivy, cara S1.

#### I6. No turn or ready timeout for connected players, and no admin kick; ghost seats fill the table
- **Where:** the only auto-act path is the disconnect grace timer (`table.ts:252-342`); seats are held by name forever
  (`table.ts:276-284`); there is no kick event in `protocol.ts`.
- **Status:** VERIFIED live several times. Cara stayed connected and never clicked Ready, which blocked Blackjack for
  20+ minutes (dan, fay). A bot stuck on a rejected `call` froze Hold'em for about 5 minutes (ivy). bea was
  "Thinking…" for over 2 minutes while online (gus). After six bots were killed, all six seats stayed occupied
  indefinitely, and a 7th person got "Table is full" (orchestrator).
- **Impact:** one idle friend (a phone left on the table screen) stalls everyone, and the admin has no tool: no
  force-stand or force-fold, no void, no kick. A mode switch clears seats only between hands. Not Critical because
  the idle player can be asked to act or close the tab, but it will happen in a real session.
- **Suggested fix:** an admin "kick seat" event (between hands; mid-hand, auto-fold or stand then free the seat); an
  optional turn clock that reuses the grace auto-act; show who the table is waiting for.
- **Sources:** audit A (Minor), audit B (Minor), audit C (Minor), audit E (Minor), dan, eve, fay, gus, ivy,
  orchestrator-notes.

#### I7. Network exposure: listens on all interfaces, CORS allows any origin, no admin rate limit, `change-me` accepted
- **Where:** `index.ts:53` (`httpServer.listen(port, ...)` with no host); `socketServer.ts:121`
  (`cors: { origin: '*' }`); `socketServer.ts:286-295` (no attempt limit, plain `===`); `index.ts:31-32` (only an
  empty passphrase is refused); `.env.example:6` (`ADMIN_PASSPHRASE=change-me`); `docs/HOSTING.md:15-18, 42-44`.
- **Status:** VERIFIED (audit C): `netstat` shows `0.0.0.0:3251` and `[::]:3251`; a handshake with
  `Origin: evil.example` gets `ACAO: *`; 5000 wrong passphrases are answered in 198 ms with no lockout. Whether the
  Windows firewall or Tailscale ACLs on a real host block LAN access is INFERRED.
  FIXED on audit/2026-10-01-full-audit (item 5); browser pass and Tailscale Serve check pending.
- **Impact:** HOSTING tells the host to allow node.exe for Private networks, so the whole home LAN can reach the
  server and its plaintext admin login. Combined with C5, someone outside the friend group can rewrite balances or
  take seats. HOSTING also says to "share" the passphrase "with the group", which gives everyone admin.
- **Suggested fix:** a `HOST` env var (default the Tailscale IP, or 127.0.0.1 behind Tailscale Serve); restrict CORS
  or check `Origin` in `allowRequest`; rate-limit `adminLogin`; refuse `change-me` or a short passphrase at boot. In
  the docs: a port-specific firewall rule, and give the passphrase only to whoever runs the game.
- **Sources:** audit C (Important), audit E (Important + Minor).

#### I8. "Call N" is offered to a short stack, and the server rejects it
- **Where:** `packages/frontend/src/three/pokerModel.ts:35-38` (`amountToCall` caps the amount at the stack);
  `three/Poker3D.tsx:104-108` (enabled, labelled `Call ${toCall}`); `game-engine/src/holdemBetting.ts:37-38` (call
  with `stack < toCall` throws "go all-in instead").
- **Status:** VERIFIED. Audit D repro (`Call 40 disabled false`); live, hal twice (stack 20 facing 40); cara S2. The
  ~5-minute Hold'em freeze came from the playtest bot never retrying (a harness bug, fixed only in a scratch copy).
- **Impact:** a common end-of-night situation offers an illegal button. A human can recover from the error text, but
  it is confusing. Audit D rated it Minor; **under-rated** given how often it comes up.
- **Suggested fix:** treat a short call as all-in in the engine (standard "all-in for less"), or relabel the button
  "All in (N)". Fix `scripts/playtest/bots.cjs` to go all-in when short.
- **Sources:** audit D (Minor), hal B1, cara S2, orchestrator-notes, ivy.

#### I9. The client decides it is "seated" by matching names, so a rejected join can lock a player into someone else's seat view
- **Where:** `packages/frontend/src/socket/SocketContext.tsx:141-153` (`mySeated` = any connected seat with our name;
  it then stores the name in sessionStorage and sets `at-table`).
- **Status:** VERIFIED live (eve): joining as `ann` (connected) was rejected, but the next broadcast matched ann's
  connected seat. Eve's client then showed ann's panel as her own, had no join form, and a reload retried as ann; only
  clearing sessionStorage by hand got her out. Audit D's half-open reconnect repro (`status at-table error "alice" is
  already seated`) has the same root cause, and so does a duplicated tab.
  FIXED on audit/2026-10-01-full-audit (item 5); browser pass and Tailscale Serve check pending.
- **Impact:** a new player who picks a taken name is stuck out of the join form. A reconnecting player can sit on a
  socket the server never mapped (every action gets "Not seated"; no hole cards) until the ping timeout of about 45 s.
- **Suggested fix:** have the server include `mySeatIndex` in each per-socket state and use that instead of a name
  match; clear the stored name on a rejected join.
- **Sources:** eve (Important), audit D (Minor).

#### I10. Reconnect can stick on "Reconnecting…": `joinInFlightRef` survives a disconnect
- **Where:** `SocketContext.tsx:249-253` (the disconnect handler does not clear `joinInFlightRef`), `:264` (rejoin only
  `if (!joinInFlightRef.current)`), `:158-165` (later states fall into the do-nothing branch).
- **Status:** VERIFIED by audit D repro (`R1 joins after 2nd reconnect: [] status: reconnecting`). Not hit live:
  testers' disconnects were single and clean.
- **Impact:** after two quick network drops, the player sits on "Reconnecting…" and is auto-folded or auto-stood on
  every turn until they reload.
- **Suggested fix:** clear `joinInFlightRef` (and `joinedRef`) in the disconnect handler; optionally use a socket.io
  ack on `join`.
- **Sources:** audit D (Important).

#### I11. Leave racing a hand start: the client drops its identity, but the server keeps the seat
- **Where:** `SocketContext.tsx:305-319` (the local name is cleared before the server answers; the guard at `:311`
  only helps when the client already knows a hand started); `socketServer.ts:272-284`.
- **Status:** client half VERIFIED (audit D repro: `R3 status entering-name session name null`). The table stall is
  INFERRED: the leaver is still connected, so no grace timer starts. An integration test where one player emits
  `leave` in the same tick as the other's `ready` would confirm it.
- **Impact:** the leaver sees the Join screen, re-typing the name gives "already seated", and the table waits on their
  turn until their tab is closed or reloaded (I6 makes this worse).
- **Suggested fix:** clear local identity only after the server confirms (an ack, or a state without our seat); make
  `leave` un-ready first, or hide Leave while ready.
- **Sources:** audit D (Important).

#### I12. 2D Hold'em hides the pot and the call price, and its controls do not match the rules
- **Where:** `packages/frontend/src/components/PokerTable.tsx:233` (sums `holdem.pots`, which is `[]` until
  settlement); `:158-182` (Check and Call are always enabled, Call shows no amount, the box is "Raise amount" but means
  raise-to, it starts at 0, `max` is the stack instead of stack + street contribution, and decimals are sent unchanged
  at `:171`).
- **Status:** VERIFIED: script B8 (8/8 hands show `Pot: 0`), hal B2, cara S4-S6, audit D (quoted lines).
- **Impact:** 2D is the default below 900 px, so phone players never see the pot or what a call costs. Check facing a
  bet gives an error toast.
- **Suggested fix:** reuse the 3D `livePot()` and `amountToCall`; label the box "Raise to", prefill the minimum
  raise-to, floor to an integer, and disable illegal buttons as the 3D bar does.
- **Sources:** script B8 (Minor), hal B2 (Minor), cara S4/S5/S6 (Minor/Important), audit D (Important + Minor).

#### I13. Layout breaks on phones and at 6 seats (2D overflow hides Fold; 3D labels and plates overlap)
- **Where:** 2D: `GameTable.tsx:34,47` (`p-8` around a `w-[96vw]` oval), `PokerTable.tsx:158` (6 controls in a row
  that does not wrap). 3D: name plates, result labels and the pot label in `three/` (SceneRoot and room layout).
- **Status:** VERIFIED in emulated viewports by cara: 375×812 2D page `scrollWidth 393`, Fold at x = −17.7 (clipped,
  cannot be scrolled to), "All In" wraps; the Blackjack seat row scrolls (710 vs 410) and the player's own cards are
  off-screen on their turn. 3D: Win/Lose labels cover name plates (worse after a split), the pot label covers the
  top-centre plate, plates stack on mobile, and at 800×450 hole-card ranks are hidden and community cards are barely
  legible. Real phones were not tested.
- **Impact:** on a phone, Fold cannot be reached in 2D Hold'em; results and names are unreadable in 3D at a full table.
- **Suggested fix:** let the 2D action row wrap and drop the outer `p-8` on small screens; scroll the active seat into
  view; offset labels from plates and clamp the camera so plates do not overlap at 6 seats.
- **Sources:** cara (Blackjack items 2, 4-7; Hold'em L1, L3 and the mobile notes), audit D (Minor, inferred).

#### I14. 3D cards end up in the wrong place when they move while a deal animation is queued
- **Where:** `packages/frontend/src/three/engine/cards.ts:77-102` (`moveTo` never cancels the earlier tween; `from` is
  captured at call time); `three/engine/SceneRoot.ts:287-314`.
- **Status:** VERIFIED by audit D repro with a real SceneRoot: the card ends half a card-step off, on top of its
  neighbour, for the rest of the hand. Not observable live (pane hidden).
- **Impact:** visual only (2D and the screen-reader text stay correct), but cards overlap at a full table after a fast
  hit, a split or a mid-hand join.
- **Suggested fix:** one movement-tween handle per card, cancelled in `moveTo` and `retire`; capture `from` in
  `onStart`.
- **Sources:** audit D (Important).

#### I15. 3D: snapshots applied while the tab is hidden build a deal backlog of up to about 20 s
- **Where:** `SceneRoot.ts:217, 287-288` (`nextDealAt` grows by 0.34 s per card); `SceneRoot.ts:377` (time advances only
  in rAF, capped at 0.05 s per frame).
- **Status:** VERIFIED by audit D repro (`my cards landed after ~19 s`; 66 flip sounds). The run's own environment (a
  hidden, throttled pane) showed the same symptoms: cara saw card backs and missing cards on her own turn.
- **Impact:** a player returning from another tab gets live Hit/Stand buttons while their cards are still in the shoe,
  plus a burst of sounds.
- **Suggested fix:** clamp `nextDealAt` to `now + small cap`; on `visibilitychange` to visible, finish all tweens
  instantly.
- **Sources:** audit D (Important), cara (Blackjack item 3, UNCLEAR).

### Minor

| ID | Title | Where | Status | Sources / note |
|---|---|---|---|---|
| M1 | Fractional chips: Blackjack 3:2 on odd bets (37.5), Hold'em split pots (`pot.amount / winners`, 91.5 each), decimal raises accepted (25.5 live; 2D sends 40.5) | `game-engine/src/payout.ts:40-44`, `holdemHand.ts:341`, `holdemBetting.ts:41-46`, `PokerTable.tsx:171` | VERIFIED (script hands 107, 124; orchestrator balances like 962.5) | Script B3/B4 and audit D rated it Important. **Re-rated to Minor:** chips are conserved, and the fractions in Blackjack and split pots are deliberate per code comments and tests. Decide on integer chips with an odd-chip rule and `Number.isInteger` checks. |
| M2 | A short all-in "raise" shrinks the minimum raise and reopens betting | `holdemHand.ts:213-226` | VERIFIED (audit B engine repro; script hand 127: raise to 30 accepted, min should be 35) | Audit B rated it Important. **Re-rated to Minor:** the reopening is a documented simplification; the min-raise shrink is a real rules bug, but rare and no money is lost. |
| M3 | Heads-up short big blind: the button must call the full BB or fold, and the disconnect auto-act folds | `holdemHand.ts:116`, `table.ts:334` | INFERRED | Audit B. |
| M4 | Recovery renumbers seats 0..n-1, drops undealt seated players, resets the button to seat 0 | `table.ts:719-727` | VERIFIED (quoted code) | Audit B. |
| M5 | The button advances even when `startHand` fails | `table.ts:372` | VERIFIED (quoted code) | Audit B. |
| M6 | No dead-button or new-player-must-post rule | `table.ts:349-359` | VERIFIED (quoted code) | Audit B; acceptable for a casual table. |
| M7 | The uncalled-bet refund appears as a separate one-player "pot"; `peek` pot includes it | engine `pots` | VERIFIED (gus H3: 2297.5 vs 1845) | Audit B, gus; cosmetic. |
| M8 | Names are not normalised (case, zero-width, bidi, control characters); markup-like names accepted; no `maxLength` on the input | `socketServer.ts:52-54` | VERIFIED (audit C probe T2; eve). FIXED on audit/2026-10-01-full-audit (item 5); browser pass and Tailscale Serve check pending | Escaping is safe (no XSS found in 2D, 3D or sr text). Feeds C5. |
| M9 | Raw internal error text reaches clients: absolute paths in EBUSY errors; `Cannot read properties of null` for a null action payload | `socketServer.ts:242, 266-268` | VERIFIED (audit C; script S6) | Audit C, script B6. |
| M10 | Balances from a hand-edited `balances.json` are not type-checked; NaN is written as `null` and resets to the default | `playerStore.ts:106` | VERIFIED (audit C) | Audit C. |
| M11 | Admin rights are lost silently on every transport reconnect | `socketServer.ts:446` | VERIFIED (quoted code). FIXED on audit/2026-10-01-full-audit (item 5); browser pass and Tailscale Serve check pending | Audits C and D; ivy saw admin persist across Leave/Join on the same socket. |
| M12 | After settlement, a folded player's cards are visible to anyone who later sits down under that name | `table.ts:852` | INFERRED | Audit C. |
| M13 | No security headers; no per-socket event or connection rate limit (5000 events in 200 ms all processed) | static serving, `socketServer.ts` | VERIFIED (audit C) | Audit C; low risk. |
| M14 | Join-form errors are wiped by any broadcast, contradicting the comment at `:279-281` | `SocketContext.tsx:117` | VERIFIED (quoted lines) | Audit D. |
| M15 | Accessibility: the 3D live region re-reads the whole table on every update; 2D has none; banner contrast is 2.45:1 and 3.72:1; the failed admin unlock is not in `role=alert` | `TableStage.tsx:211, 295`; `GameTable.tsx:37`; AdminEntry | VERIFIED (audit D; dan, ivy, fay, cara) | Several sources. |
| M16 | Synthesised piano leaves a delay feedback loop connected per note | `three/engine/audio.ts:119` | INFERRED (check node count in chrome://webaudio over 30 min) | Audit D. |
| M17 | Post-processing passes (bloom render targets) are not disposed on a quality change; `applyQuality` runs twice on mount | `SceneRoot.ts:125, 150-175` | VERIFIED (quoted three r180 code) | Audit D. |
| M18 | No `webglcontextlost` handling; errors in the rAF loop bypass View3DBoundary | `three/engine/SceneRoot.ts` | INFERRED | Audit D. |
| M19 | AdminPanel keeps a departed player as `targetName`, so a save still targets them | `AdminPanel.tsx:28, 42, 64` | VERIFIED (quoted code) | Audit D. The server rejects it if they are not seated. |
| M20 | 3D Blackjack plate shows balance minus bets; 2D shows the raw balance | `three/sceneModel.ts:246` | VERIFIED (quoted code; fay) | Audit D, fay. |
| M21 | A mid-hand joiner and a 0-balance or under-bet player get no explanation of why they are not dealt in; no rebuy | `table.ts:235-242`; UI | VERIFIED live (dan, gus, hal, fay) | hal rated it Important; Minor, because the admin can top up. |
| M22 | Successful admin saves show no confirmation | AdminPanel | VERIFIED live (fay, ivy) | |
| M23 | Wording: "Switch to Poker" vs "Hold'em"; "It is not X's turn" vs "It is not X's turn to act"; sr text "Blackjack!." and "Thinking…." | AdminPanel; `table.ts:450` vs engine; sr summary | VERIFIED live (fay, hal, cara) | Code text, not docs, so not in the §7 typo list. |
| M24 | No main/side-pot breakdown in either view; an all-in player is labelled "Waiting", not "All in" | PokerTable, Poker3D | VERIFIED live (hal, cara S8) | |
| M25 | Small 3D/2D visual nits: 2D does not draw the dealer's hole card; busted hands show "Bet 25" until settlement; seats shift sides between hands; own plate detached; the big centre "Lost 10" disagrees with the plate's "Folded"; the 2D own hole cards cover the board at 800×450 | various | VERIFIED live (cara) | |
| M26 | 3D animation nits: a split re-deals the split card from the shoe; opponents' unrevealed cards keep their object across hands; `dealerActive` never true | `SceneRoot.ts`, `sceneModel.ts` | VERIFIED (audit D, quoted code) | |
| M27 | Blackjack rules not stated: no dealer peek (double or split into a dealer Blackjack loses the full stake), split aces can be hit and doubled, no resplit | `blackjackRound.ts`, `split.ts` | VERIFIED (audit A) | Document the rules, or add a peek. |
| M28 | The Blackjack "self-corrects on the next write" payout is lost if the seat leaves or the mode switches before a successful write | `table.ts:596, 639` | INFERRED | Audit A. |
| M29 | `recoverFromLog` writes seats without a bounds check against `seatCount`; junk actions are appended to the log before the engine rejects them | `table.ts:762`; `table.ts:457, 474` | VERIFIED (quoted code) | Audit A. |
| M30 | A double-click on "Leave table" emits twice; the second gives "Not seated" on the join screen. The 3D chunk is 578.5 kB (Vite warning) | `GameTable.tsx:67-71`; build.log | VERIFIED (audit D; build.log) | |

**Dropped or not a bug:**
- "An OFF seat stayed ready and kept being dealt in" (orchestrator, ivy): `eligibleSeatsForHand` excludes
  disconnected seats (`table.ts:237`). The seat most likely disconnected after being dealt in, which then costs one
  30 s wait per turn in that hand only (I6 covers the waiting). Dropped.
- "Blinds changed mid-hand affected later streets" (ivy): HoldemHand keeps its own config, and `updateConfig` only
  changes `Table.config`. The 40 bet was the bot's hard-coded raise. Not a bug.
- "Bet size changed between hands" and "unexplained balance jumps" (dan): explained by fay's admin tests.
- Mode switch drops every seat (fay): by design; balances were checked and kept in `balances.json` (orchestrator).

## 4. Verified working, with evidence

- **Side pots:** 36 scripted all-in hands with 3-5 pot layers (25 with an uncalled excess). Every layer, winner
  (pokersolver on eligible hands), payout and `balances.json` entry matched. Example: script S2 hand 10, pots
  244/426/608/494. Live: cara's 1372.5 all-in, ann called 920, refund 452.5, total 4447.5 before and after.
- **No hole-card leak during a hand:** about 30,000 snapshots across 9 viewers (6 seated, a rejected 7th, a spectator,
  the admin) showed zero opponent hole cards before settlement, in the `holeCards` field or anywhere in the raw JSON,
  and no `deck` or `shoe` key. Folded players' cards were never revealed. Blackjack: the dealer's hole card stayed
  hidden until the last player finished (dan polled every 500 ms; 56 verifier hands). The only leak is C2.
- **Blackjack rules:** 56 hands re-derived from the cards with 0 violations (one shared dealer, reveal only after the
  last player, nobody settled early, outcomes match the cards). Double worked live (dan, fay) and Split worked live
  (eve, 10/10). Illegal Split or Double with `disabled` removed had no effect (eve).
- **Hold'em flow:** heads-up blinds and acting order correct in 14/14 hands (S5). Every malformed raise (NaN,
  Infinity, strings, objects, negatives, 1e9) was rejected with unchanged state (S6, hal). Out-of-turn actions were
  rejected, and a stale handler after settlement gave "No hand in progress".
- **Reload and disconnect recovery:** reload on your own turn restored the same cards, bet and buttons in about
  630 ms with no name re-entry (dan, gus, eve). A short disconnect inside the grace period resumed the turn (dan,
  gus). A long disconnect auto-stood (Blackjack) or auto-folded or auto-checked (Hold'em) at the grace time (5021 ms
  and 5009 ms scripted; about 30 s live). Rejoin kept the seat and balance.
- **Mid-hand mode switch refused** in both games (ivy in Hold'em through the admin UI; orchestrator in Blackjack
  through the socket). **Mid-hand balance adjust refused** (fay, ivy). Default bet and blinds changes applied from the
  next hand (fay, ivy).
- **7th join rejected** with "Table is full"; the socket stays as a spectator (script S1, orchestrator).
- **Chip conservation:** held in every one of the 138 scripted hands and in every live hand that was checked.
  `balances.json` matched the seat balances.
- **Escaping:** the name `<img src=x onerror=alert(1)>` rendered as plain text in 2D, 3D and the sr text; no alert
  fired (eve, fay, cara).
- **Leave and rejoin between hands** kept the balance per name (eve, hal). The quality switch and the 2D/3D toggle
  mid-hand kept the game state. No console errors in any tester tab.

## 5. Verified vs inferred

Every finding above is labelled. These rest on inference only, or have an inferred part:
- I11: the table-stall half (the client half is verified).
- I2: the consequences after a restart of an orphaned switch-mode hand on the live path, and stale balance writes from
  the old table's timers (the log orphaning itself is verified).
- C4: how often a real host's antivirus, backup or indexer actually locks the data files.
- I7: whether Windows Firewall or Tailscale ACLs on the real host block LAN access.
- M3 heads-up short BB, M12 same-name reveal after settlement, M16 audio node leak, M18 WebGL context loss, M28 lost
  payout on leave.
- Docs: Tailscale's default allow-all ACL, what `tailscale status` prints, the console label "Invite external device".

## 6. Could not be checked

- Sound quality; real phones (only emulated 375×812 viewports); weak or integrated GPUs; a real multi-device session
  over Tailscale with friends; long sessions (hours) and memory growth; real Windows file-lock contention (the C4 crash
  used an injected lock).
- Live 3D animation feel and reveal timing (the pane was hidden, so rAF was throttled).
- Testers could not reach some things: Split was never dealt to most testers (only eve's 10/10), so split double-click
  and split-then-double were not tried live; mid-hand Leave has no UI (the button is hidden while a hand is in
  progress, so only the socket-level rejection is verified); 3+ layer side-pot visuals; the C3 and I2 races (not hit
  live).

## 7. Docs

Stale or wrong claims (audit E, checked against the code):
- **"Hand history" is not kept.** `README.md:25-27` and `docs/HOSTING.md:77-80, 112-114` say hand history survives a
  restart, but `hand.jsonl` is cleared after every hand (`handLog.ts:87-88`, `table.ts:568, 678`). It only holds the
  in-progress hand, for crash recovery. Important for disputes: there is no audit trail anywhere.
- **Identity and balances** (see C5): no doc says that balances are keyed by exact name, that a new name gets a fresh
  stack, or that anyone can claim an offline player's seat.
- **Passphrase guidance** (see I7): HOSTING says to share the passphrase with the group, and `change-me` boots.
- **Tailscale invite** (`HOSTING.md:24-27`, INFERRED): inviting users with the default ACL exposes the host's whole
  tailnet. Recommend machine sharing instead.
- **Firewall** (`HOSTING.md:42-44`): allowing node.exe exposes the server to the home LAN. There is also no
  troubleshooting entry for "friends can't connect".
- **Undocumented host-relevant behaviour:** `balances.json.corrupt-<ts>` files (not covered by `.gitignore`); after a
  restart the admin must start a game again before anyone can rejoin; how to back up or reset; ghost seats (I6);
  Blackjack rules (M27); `README.md:30` says only "auto-folds" (the code checks when free); no minimum Node version
  (Vite 7 needs 20.19+ or 22.12+); the host must stay awake.
- **Third-party notices** are incomplete: the bundled React, socket.io-client, framer-motion and Tailwind preflight
  are not listed, no licence text ships in `dist`, and the card SVGs' upstream (Byron Knoll's Vector Playing Cards)
  is not named.
- **`scripts/playtest/README.md:15`** runs `rm -rf .playtest-data && mkdir .playtest-data`. That deletes this audit's
  inputs and repros in `.playtest-data/audit/` (git-ignored, so they are not recoverable). Use a subfolder such as
  `.playtest-data/run` for scratch server data, and update lines 18-19 and 23 to match.

**Trivial typos** (mechanical, docs only; each was checked against the current file):
1. `README.md:111`. Wrong: `npm run typecheck      # TypeScript across all three workspaces` (6 spaces, so `#` is in
   column 24). Correct: `npm run typecheck     # TypeScript across all three workspaces` (5 spaces, so `#` lines up
   with line 110 in column 23).
2. `HANDOFF.md:44` (123 characters; the neighbouring lines are about 90). Wrong:
   ``merge commit `b1dfae1`), including a 2-round critical-bug-fix pass. 0 Critical, 0 Important findings remain. Full detail in``
   Correct (two lines):
   ``merge commit `b1dfae1`), including a 2-round critical-bug-fix pass. 0 Critical, 0 Important``
   `findings remain. Full detail in`
3. `HANDOFF.md:26`. Wrong: ``(PR #7, merge commit `6891af5`)``. Correct: ``(PR #7, fast-forwarded; last commit `6891af5`)``
   (`6891af5` has a single parent and is the branch's final fix commit; there is no merge commit).
4. `README.md` project structure, after line 124 (`    dev3d.html   dev-only 3D harness page (not part of the
   production build)`), insert:
   `    THIRD_PARTY_NOTICES.md   licences for the card SVGs, three.js and fonts`
5. `README.md:132`. Wrong: `  superpowers/playtests/     findings from the AI playtest of the 3D tables`. Correct:
   `  superpowers/playtests/     findings from the AI playtests (3D tables; full audit 2026-10-01)`
6. `docs/HOSTING.md:61`. Wrong: `screens at least 900px wide (phones get the classic 2D table). Each player`.
   Correct: `screens at least 900px wide (narrower screens such as phones get the classic 2D table). Each player`

(Audit E's `HOSTING.md:25` "Invite external device" is left out of this list on purpose: the correct console label is
unconfirmed, and the advice itself should change; see above.)

## 8. Suggested fix order

1. **C1 + C2** (two small server changes, each with a table test): settle a hand that is already settled at
   construction or replay, and reveal cards only at a real showdown.
2. **Concurrency in one pass (C3, I1, I2):** a per-table action lock around `submitAction`, re-validation after
   every await, a client `actionPending` guard, Table-owned synchronous admin balance set, and a table `freeze()` and
   `dispose()` with a generation check for mode switch and join.
3. **C4:** a `safeHandler` wrapper for every admin handler, plus an `unhandledRejection` safety net.
4. **Config and the ready check (I4, I5, M5):** validate blinds and env at the edges; re-run the ready check after
   balance and config changes; tell players when a hand fails to start.
5. **Identity and exposure (C5, I7, I9, M8, M11):** per-player reconnect token, server-sent `mySeatIndex`, name
   normalisation, `HOST` binding, CORS and Origin check, admin rate limit, refuse `change-me`. Then update HOSTING.md.
6. **Unsticking tables (I6, I11, I10):** admin kick and force-act, an optional turn clock, leave confirmed by the
   server, and the `joinInFlightRef` reset.
7. **I3:** idempotent Hold'em settlement on recovery.
8. **Short stacks and 2D (I8, I12, I13, M1, M3, M24):** call-for-less as all-in, a 2D pot and call price, a wrapping
   action row, integer chips.
9. **3D polish (I14, I15, M16-M18, M25-M26)**, then **docs** (§7) and the remaining Minor items.
