# Soundboard and sound mixer: design

Brainstormed with the user on 2026-10-04. Standalone feature: a fixed set of meme/vine clips that
any seated player can fire, heard by everyone at the table, plus a per-channel sound mixer that
replaces today's single "Sound: on/off" chip. Mockups from the session live in
`.superpowers/brainstorm/` (gitignored); the decisions below are what count.

## 1. Decisions (all made with the user, 2026-10-04)

| # | Decision |
|---|---|
| S1 | **Everyone at the table hears every clip.** The server broadcasts; the sender hears its own clip via the same broadcast. |
| S2 | **Only the 3D table has a soundboard.** Seated players fire and hear clips. The lobby, the name screen, an off-table admin and the flat view have no audio and are out of scope. |
| S3 | **Clip audio files are never committed.** The repo is public and the clips are copyrighted. Files live in a gitignored folder; a missing file shows a disabled tile. |
| S4 | **The clip list is committed** (approach A): `id`, `label`, `emoji`, `file`. Adding a clip is one line plus dropping the file in. Rejected: a gitignored local manifest (B, about 1.3x cost) and a folder scan (C, no control over order or labels). At the expected rate (a clip or two every week or two) the one-line commit is cheaper than B's extra server route and dev proxy. |
| S5 | **Spam control: a per-player cooldown of 3 s, enforced by the server; clips from different players may overlap.** |
| S6 | **Hard 8 s playback cap** per clip. |
| S7 | **Attribution: a brass "🔊 {label}" pill on the sender's row in the HUD player list for 2.5 s.** (The projected 3D name plates no longer exist; the HUD player list is where names live.) |
| S8 | **Soundboard UI: a popover tile grid** (3 columns, emoji + label), opened by a "Soundboard" chip in the top-left cluster. |
| S9 | **"Sound" becomes a mixer popover** with rows Master, Table effects, Soundboard, Ambience. Each row has a mute icon and a volume slider (layout C). Music can return later as one more row. |
| S10 | **The saloon piano is deleted.** The room murmur stays, as the Ambience channel. |
| S11 | **Sound is on by default:** Master 80%, Table effects 70%, Soundboard 60%, Ambience 30%, all unmuted. A legacy `bj3d.sound = 'off'` migrates to a muted Master. |

## 2. Architecture and data flow

### 2.1 Clip list

New file `packages/server/src/soundboardClips.ts`, imported by the frontend the same way it
imports `protocol.ts`:

```ts
export interface SoundboardClip {
  id: string;     // stable, kebab-case, e.g. 'vine-boom'
  label: string;  // shown on the tile and the badge
  emoji: string;  // shown on the tile and the badge
  file: string;   // filename under /sounds/, e.g. 'vine-boom.mp3'
}
export const SOUNDBOARD_CLIPS: readonly SoundboardClip[] = [/* ... */];
export const SOUNDBOARD_COOLDOWN_MS = 3000;
export const SOUNDBOARD_MAX_CLIP_MS = 8000;
```

List order is display order. Ids must be unique (a unit test asserts it).

### 2.2 Protocol (`protocol.ts`)

- Client → server: `soundboard: (payload: { clipId: string }) => void`
- Server → client: `soundboard: (payload: { clipId: string; seatIndex: number; displayName: string }) => void`

`displayName` lets the client match the badge on seat *and* name (§4).

### 2.3 Server handler (`socketServer.ts`)

Shaped like the `ready` handler:

1. The socket must be seated (`seatBySocketId`) and a table must exist.
2. `clipId` must be in `SOUNDBOARD_CLIPS`.
3. Cooldown: at most one clip per player per `SOUNDBOARD_COOLDOWN_MS`, keyed by the seat's display
   name (so a reconnect does not reset it). The clock is injectable (`now`), as in `loginLimiter.ts`.
4. On success, `io.emit('soundboard', { clipId, seatIndex, displayName })` to every client.
5. **Any rejection is dropped silently**: no `error` event, no banner. The client already blocks
   these cases, so only a modified client reaches them.

### 2.4 Files

- `packages/frontend/public/sounds/` is gitignored except for a committed `README.md`, via
  `.gitignore` entries `packages/frontend/public/sounds/*` and `!packages/frontend/public/sounds/README.md`.
- Vite serves `public/` in dev, and `npm run play`'s build copies it into `dist`, which the server
  already serves. No server routing or proxy changes.
- The README says: MP3, ideally under 500 KB, at most 8 s (longer is cut), add a line to
  `soundboardClips.ts`, list order is display order.

### 2.5 Client flow

`SocketContext` receives `soundboard` and exposes it to subscribers (a listener API or an event
stream; the plan picks the smallest fit with the existing context). The table screen
(`TableStage`) plays the clip and records the badge for the HUD.

## 3. Client audio and UI

### 3.1 Audio engine (`three/engine/audio.ts`)

- **Delete the piano:** `SCALE`, `PATTERNS`, `startPiano`, `pluck`, the interval timer.
- **Gain graph:** channels `ambience`, `effects`, `soundboard` → `master` → destination. The murmur
  feeds `ambience`; `cardSnap` / `cardFlip` / `chipClack` feed `effects`. Their call sites in
  `SceneRoot.ts` do not change.
- **Unlock:** browsers block audio until a user gesture. The AudioContext is created on table mount
  (suspended) and resumed on the first `pointerdown` or `keydown` anywhere. Until then everything
  is silent and incoming clips are dropped.
- **Clip bank:** on table mount, each clip's file is fetched and decoded once (decoding works on a
  suspended context) and cached as an `AudioBuffer`. A fetch or decode failure marks that clip
  unavailable. Availability is exposed to the UI.
- **`playClip(id)`** drops the clip if: audio is not unlocked, `document.hidden`, the clip is
  unavailable, or Soundboard or Master is muted. Otherwise it plays through the `soundboard`
  channel and is stopped at `SOUNDBOARD_MAX_CLIP_MS` with a 150 ms fade.

### 3.2 Mixer state (new `three/engine/mixer.ts`, pure)

- Shape: `{ master, effects, soundboard, ambience }`, each `{ level: number /* 0..1 */, muted: boolean }`.
- Defaults per S11. Persisted as JSON under localStorage key `bj3d.mix` (reads and writes wrapped
  in try/catch, like the existing `readPref` / `writePref`).
- Parsing: missing, malformed or out-of-range values fall back per field to the default.
- Migration: if `bj3d.mix` is absent and legacy `bj3d.sound === 'off'`, Master starts muted.
  `bj3d.sound` is no longer written.
- Effective gain of a channel = `muted ? 0 : level`. The engine applies changes with
  `setTargetAtTime` so slider moves do not click. Master muting does not alter channel state, so
  unmuting Master restores the previous mix.

### 3.3 UI

Top-left cluster becomes: `Flat view · Quality · Sound ▾ · Soundboard · {admin controls}`.

- **Sound ▾** opens the mixer popover: rows Master, Table effects, Soundboard, Ambience. Each row:
  a mute icon button (🔊 / 🔇) and a styled native `<input type="range">`. Changes persist
  immediately.
- **Soundboard** opens the tile grid popover: 3 columns, each tile a button with emoji + label.
  - A clip whose file is unavailable renders disabled with the tooltip "Clip file missing".
  - After firing, **every** tile shows a cooldown sweep and is disabled for
    `SOUNDBOARD_COOLDOWN_MS` (the cooldown is per player). The client starts the cooldown on click,
    not on the server echo.
  - The grid stays open after firing.
  - If the player's Soundboard channel or Master is muted, a one-line hint at the bottom says
    others still hear their clips.
  - If `SOUNDBOARD_CLIPS` is empty, the Soundboard chip is not rendered.
- **Popover behaviour (both):** one open at a time; Esc or a click outside closes; triggers are
  real buttons with `aria-expanded`. Saloon styling: `bg-surface`, `border-wood-grain`,
  `font-utility`, `text-parchment`, brass (`brass`, `brass-bright`) accents.
- **Badge:** `PlayerList` rows accept an optional clip badge; the row renders "{emoji} {label}" in
  a brass pill next to the name for 2.5 s. A new clip from the same player replaces it.

## 4. Edge cases

- **Hidden tab:** clips are dropped, not queued (avoids the I15-style burst on return). Badges
  still show.
- **Badge identity:** the badge applies only if the seat at `seatIndex` currently holds
  `displayName`. A clip from a player who left shows no badge; a newcomer in a reused seat never
  inherits one.
- **Poker ↔ Blackjack switch:** the table screen remounts and reloads the clip bank. Acceptable
  (a few hundred KB over Tailscale).
- **Double clicks:** blocked by the client-side cooldown; the server is the real guard.
- **No files present:** every tile disabled; the README explains how to add clips.

## 5. Testing

Vitest, following existing patterns.

- **Server (`socketServer.test.ts`):** unseated sender ignored; unknown `clipId` ignored; a valid
  clip reaches every connected client with `seatIndex` and `displayName`; a second clip within
  3 s is ignored and one after 3 s goes through (injected clock); reconnecting does not reset the
  cooldown. Silent drops emit no `error`.
- **`soundboardClips.ts`:** ids unique; constants as specified.
- **`mixer.ts`:** defaults; garbage and partial JSON fall back per field; the `bj3d.sound='off'`
  migration; effective gain with channel and master mutes.
- **Audio engine (small fake AudioContext):** every `playClip` drop rule; the 8 s stop; channel
  routing; the piano is gone (no interval timer started).
- **Components:** the mixer popover (mute and slider changes persist); the Soundboard grid
  (disabled tiles, cooldown disables all tiles, firing emits `soundboard`, hint when muted, chip
  hidden when the list is empty); the `PlayerList` badge appears, is matched on seat + name, and
  expires (fake timers).
- **Integration:** two clients at one table; one fires a clip, the other receives it with the
  right seat.
- **Manual:** a real listening pass on the default mix. Automated tests cannot judge balance, and
  the existing audio has never had one (`HANDOFF.md`).

## 6. Non-goals

Flat view, lobby or admin-panel audio; per-clip volume; local preview; hotkeys; uploading clips
from the UI; music (the mixer has room for a Music row later).
