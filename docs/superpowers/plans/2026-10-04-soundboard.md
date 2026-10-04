# Soundboard and Sound Mixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seated players at the 3D table fire meme clips that everyone at the table hears, and a four-channel sound mixer replaces the "Sound: on/off" chip.

**Architecture:** A committed clip list (`packages/server/src/soundboardClips.ts`) is shared by server and client. The server checks seat, clip id and a 3 s per-player cooldown, then broadcasts `soundboard` to every client. On the client, `SocketContext` fans the event out to subscribers; `TableStage` plays the clip through a rebuilt `SoundStage` (gain graph `effects` / `soundboard` / `ambience` → `master`, piano deleted) and shows a 2.5 s brass badge on the sender's HUD row through a small React context. Mixer state is a pure module persisted to `localStorage`.

**Tech Stack:** TypeScript, React 18, socket.io 4, Web Audio API, three.js 0.180 (untouched here), Vitest + jsdom + Testing Library. Run commands from the repo root.

**Spec:** `docs/superpowers/specs/2026-10-04-soundboard-design.md` (decisions S1–S11, §2–§5).

## Global Constraints

- Everyone at the table hears every clip; the sender hears its own clip through the same broadcast (S1).
- Only the 3D table has a soundboard. The lobby, the name screen, an off-table admin and the flat view have no audio (S2).
- Clip audio files are never committed. `packages/frontend/public/sounds/*` is gitignored except `README.md`; a missing file shows a disabled tile with the tooltip "Clip file missing" (S3).
- Clip list fields: `id`, `label`, `emoji`, `file`. List order is display order. Ids are unique (S4).
- `SOUNDBOARD_COOLDOWN_MS = 3000`, per player, enforced by the server, keyed by display name so a reconnect does not reset it. Clips from different players may overlap (S5).
- `SOUNDBOARD_MAX_CLIP_MS = 8000`; playback stops there with a 150 ms fade (S6).
- Badge: a brass "{emoji} {label}" pill on the sender's HUD row for 2.5 s; a new clip from the same player replaces it; shown only if the seat at `seatIndex` currently holds `displayName` (S7, §4).
- Soundboard UI: popover tile grid, 3 columns, emoji + label, opened by a "Soundboard" chip (S8).
- Mixer: popover rows Master, Table effects, Soundboard, Ambience; each a mute icon button (🔊 / 🔇) and a slider (S9).
- The saloon piano is deleted; the murmur stays as Ambience (S10).
- Defaults: Master 80%, Table effects 70%, Soundboard 60%, Ambience 30%, all unmuted. Stored as JSON under `bj3d.mix`. A legacy `bj3d.sound = 'off'` (with no `bj3d.mix`) starts Master muted; `bj3d.sound` is no longer written (S11).
- Server rejections of `soundboard` are dropped silently: no `error` event, no banner (§2.3).
- Hidden tab: clips are dropped, not queued; badges still show (§4).
- Popovers: one open at a time; Esc or a click outside closes; triggers are real buttons with `aria-expanded`; saloon styling (`bg-surface`, `border-wood-grain`, `font-utility`, `text-parchment`, `brass` / `brass-bright`).
- Non-goals: flat view, lobby or admin-panel audio; per-clip volume; local preview; hotkeys; uploads; music.
- Commands (repo root): all tests `npm test`; one workspace `npm test --workspace=@poker-blackjack/frontend` (or `server`); one file `npx vitest run <path relative to the package> --root packages/<pkg>`; typecheck `npm run typecheck`. Both green at every commit.
- Every task is test-first where a test is possible. When a new test passes at once, temporarily remove the code it guards, watch it fail, then restore it.
- The controller commits each task after a clean review without asking (user rule), then ticks the plan. Never push. The manual listening pass (Task 9) is user-gated.
- Code comments match the surrounding files (they explain *why*) and cite the spec (e.g. "soundboard spec S5").
- Never write `\u` escapes in code: write the real character (🔊 🔇 💥) or use `String.fromCodePoint(0x...)`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/server/src/soundboardClips.ts` (new) | Clip list and the two timing constants, shared with the client |
| `packages/server/src/soundboardClips.test.ts` (new) | Ids unique, constants |
| `packages/server/src/protocol.ts` | `soundboard` events both ways |
| `packages/server/src/socketServer.ts` | `soundboard` handler, cooldown, injectable clock |
| `packages/server/src/socketServer.test.ts` | Handler tests (own `describe` with its own server) |
| `.gitignore`, `packages/frontend/public/sounds/README.md` (new) | Ignore clip files; how to add one |
| `packages/frontend/src/three/engine/mixer.ts` (new) | Pure mixer state: defaults, parse, persist, effective gain |
| `packages/frontend/src/three/engine/audio.ts` | Rewritten `SoundStage`: gain graph, unlock, clip bank, `playClip` |
| `packages/frontend/src/socket/SocketContext.tsx` | `sendSoundboard`, `onSoundboard` |
| `packages/frontend/src/sound/clipBadges.tsx` (new) | Badge state hook + context + per-row lookup |
| `packages/frontend/src/sound/Popover.tsx` (new) | Shared popover trigger/panel (Esc, outside click, `aria-expanded`) |
| `packages/frontend/src/sound/MixerControl.tsx` (new) | "Sound" chip + mixer popover |
| `packages/frontend/src/sound/SoundboardControl.tsx` (new) | "Soundboard" chip + tile grid, cooldown, muted hint |
| `packages/frontend/src/hud/PlayerList.tsx` | Renders the badge |
| `packages/frontend/src/three/TableStage.tsx` | Wires engine, mixer, soundboard, badges; drops the on/off chip |
| `packages/frontend/src/index.css` | `sb-sweep` keyframes for the cooldown sweep |

`src/sound/` is outside `src/three/`, so the HUD (`PlayerList`) can import `clipBadges.tsx` without breaking the "HUD never reaches three" guard (`hud/noThree.test.ts`). Nothing in `src/sound/` imports `three`.

---

### Task 1: Clip list, protocol events and the sounds folder

**Files:**
- Create: `packages/server/src/soundboardClips.ts`
- Create: `packages/server/src/soundboardClips.test.ts`
- Modify: `packages/server/src/protocol.ts`
- Modify: `.gitignore`
- Create: `packages/frontend/public/sounds/README.md`

**Interfaces:**
- Produces: `interface SoundboardClip { id: string; label: string; emoji: string; file: string }`, `SOUNDBOARD_CLIPS: readonly SoundboardClip[]`, `SOUNDBOARD_COOLDOWN_MS = 3000`, `SOUNDBOARD_MAX_CLIP_MS = 8000`; protocol `SoundboardPayload { clipId: string }`, `SoundboardBroadcast { clipId: string; seatIndex: number; displayName: string }`, `ClientToServerEvents.soundboard(payload: SoundboardPayload)`, `ServerToClientEvents.soundboard(payload: SoundboardBroadcast)`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/soundboardClips.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SOUNDBOARD_CLIPS, SOUNDBOARD_COOLDOWN_MS, SOUNDBOARD_MAX_CLIP_MS } from './soundboardClips';

describe('soundboard clip list', () => {
  it('has unique ids', () => {
    const ids = SOUNDBOARD_CLIPS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids and a filename for every clip', () => {
    for (const clip of SOUNDBOARD_CLIPS) {
      expect(clip.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(clip.file).toMatch(/^[\w.-]+\.(mp3|ogg|wav)$/);
      expect(clip.label.length).toBeGreaterThan(0);
      expect(clip.emoji.length).toBeGreaterThan(0);
    }
  });

  it('sets the cooldown and playback cap from the spec (S5, S6)', () => {
    expect(SOUNDBOARD_COOLDOWN_MS).toBe(3000);
    expect(SOUNDBOARD_MAX_CLIP_MS).toBe(8000);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/soundboardClips.test.ts --root packages/server`
Expected: FAIL, cannot resolve `./soundboardClips`.

- [ ] **Step 3: Create `packages/server/src/soundboardClips.ts`**

The list below is a starter set. Before committing, show it to the user and use their edits (they choose the clips; files are theirs to drop in).

```ts
// The soundboard's clips (soundboard spec §2.1). Committed so the server can validate ids and the
// client can draw tiles; the audio files are not (the repo is public and the clips are copyrighted,
// S3). To add a clip: drop the file in packages/frontend/public/sounds/ and add one line here.
// List order is display order.
export interface SoundboardClip {
  id: string; // stable, kebab-case
  label: string; // shown on the tile and the badge
  emoji: string; // shown on the tile and the badge
  file: string; // filename under /sounds/
}

export const SOUNDBOARD_CLIPS: readonly SoundboardClip[] = [
  { id: 'vine-boom', label: 'Vine boom', emoji: '💥', file: 'vine-boom.mp3' },
  { id: 'bruh', label: 'Bruh', emoji: '😐', file: 'bruh.mp3' },
  { id: 'sad-trombone', label: 'Sad trombone', emoji: '🎺', file: 'sad-trombone.mp3' },
  { id: 'airhorn', label: 'Airhorn', emoji: '📯', file: 'airhorn.mp3' },
  { id: 'oh-no', label: 'Oh no', emoji: '😱', file: 'oh-no.mp3' },
  { id: 'wow', label: 'Wow', emoji: '🤩', file: 'wow.mp3' },
];

// Per player, enforced by the server (S5). Clips from different players may overlap.
export const SOUNDBOARD_COOLDOWN_MS = 3000;
// Hard playback cap per clip (S6); longer files are cut with a short fade.
export const SOUNDBOARD_MAX_CLIP_MS = 8000;
```

- [ ] **Step 4: Add the protocol events** in `packages/server/src/protocol.ts`. After `SetStartingBalancePayload`:

```ts
// Soundboard (soundboard spec §2.2). The broadcast carries the display name as well as the seat, so
// a client shows the badge only if that seat still holds that player (§4).
export interface SoundboardPayload {
  clipId: string;
}

export interface SoundboardBroadcast {
  clipId: string;
  seatIndex: number;
  displayName: string;
}
```

Add `soundboard: (payload: SoundboardPayload) => void;` as the last member of `ClientToServerEvents`, and `soundboard: (payload: SoundboardBroadcast) => void;` as the last member of `ServerToClientEvents`.

- [ ] **Step 5: Ignore clip files.** Append to `.gitignore`:

```gitignore

# Soundboard clip files (copyrighted, never committed: soundboard spec S3). Only the README is tracked.
packages/frontend/public/sounds/*
!packages/frontend/public/sounds/README.md
```

- [ ] **Step 6: Create `packages/frontend/public/sounds/README.md`**

```markdown
# Soundboard clips

The clip files live here but are never committed (they are copyrighted and the repo is public).
`.gitignore` ignores everything in this folder except this README.

To add a clip:

1. Drop the file here. MP3, ideally under 500 KB, at most 8 seconds (anything longer is cut at 8 s).
2. Add one line to `packages/server/src/soundboardClips.ts`: `id` (kebab-case, unique), `label`,
   `emoji`, and `file` (this filename). List order is the order of the tiles.

A clip listed there whose file is missing shows as a disabled tile ("Clip file missing").
Vite serves this folder in dev, and `npm run play` copies it into the build, so no server change is needed.
```

- [ ] **Step 7: Verify.** Run `npx vitest run src/soundboardClips.test.ts --root packages/server` (PASS), `npm run typecheck` (PASS), and `git check-ignore -v packages/frontend/public/sounds/x.mp3` (prints the ignore rule) and `git check-ignore packages/frontend/public/sounds/README.md` (prints nothing, exit 1).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/soundboardClips.ts packages/server/src/soundboardClips.test.ts packages/server/src/protocol.ts .gitignore packages/frontend/public/sounds/README.md
git commit -m "feat(soundboard): clip list, protocol events and gitignored sounds folder"
```

---

### Task 2: Server `soundboard` handler with cooldown

**Files:**
- Modify: `packages/server/src/socketServer.ts`
- Test: `packages/server/src/socketServer.test.ts` (new `describe` at the end of the file)

**Interfaces:**
- Consumes: Task 1's `SOUNDBOARD_CLIPS`, `SOUNDBOARD_COOLDOWN_MS`, `SoundboardPayload`.
- Produces: `CreateServerOptions.soundboardNow?: () => number` (defaults to `Date.now`); every client receives `soundboard` `{ clipId, seatIndex, displayName }` for an accepted clip.

- [ ] **Step 1: Write the failing tests.** Append to `packages/server/src/socketServer.test.ts`. Add `SoundboardBroadcast` to the existing `import type { ErrorPayload } from './protocol';` line, and add `import { SOUNDBOARD_CLIPS, SOUNDBOARD_COOLDOWN_MS } from './soundboardClips';`.

```ts
describe('soundboard (soundboard spec §2.3)', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];
  let clock: number;
  const CLIP = SOUNDBOARD_CLIPS[0].id;

  beforeEach(async () => {
    clock = 1_000_000;
    dir = await mkdtemp(join(tmpdir(), 'socket-server-soundboard-test-'));
    const playerStore = new JsonPlayerStore(join(dir, 'balances.json'), DEFAULT_GAME_CONFIG.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), DEFAULT_GAME_CONFIG);
    server = await createServer(DEFAULT_STATIC_CONFIG, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE, {
      // settle() below sends wrong passphrases as a round-trip barrier; never lock out.
      adminLoginLimiter: createAttemptLimiter({ maxFailures: 1_000_000 }),
      soundboardNow: () => clock,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  // Records every soundboard and error event a socket receives.
  function record(socket: ClientSocket): { clips: SoundboardBroadcast[]; errors: ErrorPayload[] } {
    const log = { clips: [] as SoundboardBroadcast[], errors: [] as ErrorPayload[] };
    socket.on('soundboard', (p: SoundboardBroadcast) => log.clips.push(p));
    socket.on('error', (p: ErrorPayload) => log.errors.push(p));
    return log;
  }

  // A round trip on the same socket: the server handles a socket's events in order and the
  // soundboard handler is synchronous, so once this answer arrives, any broadcast the earlier
  // soundboard event caused has already been written to this socket.
  async function settle(socket: ClientSocket): Promise<void> {
    socket.emit('adminLogin', { passphrase: 'not-the-passphrase' });
    await waitForEvent(socket, 'adminLoginResult');
  }

  async function seat(name: string, token?: string): Promise<ClientSocket> {
    const socket = connect();
    const seated = waitForState(socket, (s) => s.mySeatIndex !== null);
    if (token) socket.emit('join', { displayName: name, token });
    else await joinAndGetToken(socket, name);
    await seated;
    return socket;
  }

  async function startTable(): Promise<void> {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
  }

  it('ignores a clip from a socket that is not seated, without an error', async () => {
    await startTable();
    const watcher = connect();
    const log = record(watcher);
    watcher.emit('soundboard', { clipId: CLIP });
    await settle(watcher);
    expect(log.clips).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  it('ignores an unknown or malformed clip id, without an error', async () => {
    await startTable();
    const alice = await seat('alice');
    const log = record(alice);
    alice.emit('soundboard', { clipId: 'no-such-clip' });
    alice.emit('soundboard', { clipId: 42 } as unknown as { clipId: string });
    alice.emit('soundboard', undefined as unknown as { clipId: string });
    await settle(alice);
    expect(log.clips).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  it('broadcasts a valid clip to every client, the sender included, with seat and name', async () => {
    await startTable();
    const alice = await seat('alice');
    const bob = await seat('bob');
    const aliceLog = record(alice);
    const bobGot = waitForEvent<SoundboardBroadcast>(bob, 'soundboard');
    alice.emit('soundboard', { clipId: CLIP });
    const expected = { clipId: CLIP, seatIndex: 0, displayName: 'alice' };
    expect(await bobGot).toEqual(expected);
    await settle(alice);
    expect(aliceLog.clips).toEqual([expected]);
  });

  it('drops a second clip within the cooldown and accepts one after it', async () => {
    await startTable();
    const alice = await seat('alice');
    const log = record(alice);
    alice.emit('soundboard', { clipId: CLIP });
    clock += SOUNDBOARD_COOLDOWN_MS - 1;
    alice.emit('soundboard', { clipId: CLIP });
    await settle(alice);
    expect(log.clips).toHaveLength(1);
    expect(log.errors).toEqual([]);
    clock += 1;
    alice.emit('soundboard', { clipId: CLIP });
    await settle(alice);
    expect(log.clips).toHaveLength(2);
  });

  it('keeps cooldowns per player: two players may fire at once', async () => {
    await startTable();
    const alice = await seat('alice');
    const bob = await seat('bob');
    const log = record(alice);
    alice.emit('soundboard', { clipId: CLIP });
    bob.emit('soundboard', { clipId: CLIP });
    await settle(bob);
    await settle(alice);
    expect(log.clips.map((c) => c.displayName).sort()).toEqual(['alice', 'bob']);
  });

  it('does not reset the cooldown when the player reconnects', async () => {
    await startTable();
    const first = connect();
    const firstSeated = waitForState(first, (s) => s.mySeatIndex !== null);
    const token = await joinAndGetToken(first, 'alice');
    await firstSeated;
    first.emit('soundboard', { clipId: CLIP });
    await settle(first);
    first.disconnect();
    const again = await seat('alice', token);
    const log = record(again);
    again.emit('soundboard', { clipId: CLIP });
    await settle(again);
    expect(log.clips).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/socketServer.test.ts --root packages/server -t soundboard`
Expected: typecheck error on `soundboardNow` (unknown option) or the broadcast tests time out. The two "ignores" tests may pass already (nothing handles the event); remove nothing for those, they become meaningful once the handler exists.

- [ ] **Step 3: Implement.** In `packages/server/src/socketServer.ts`:

Imports: add `import { nameKey } from './names';` next to the `normaliseDisplayName` import (one line: `import { nameKey, normaliseDisplayName } from './names';`), `import { SOUNDBOARD_CLIPS, SOUNDBOARD_COOLDOWN_MS } from './soundboardClips';`, and `SoundboardPayload` in the protocol type import list.

In `CreateServerOptions`, after `allowedOrigins`:

```ts
  // The soundboard cooldown's clock (soundboard spec §2.3). Injectable so tests can step it.
  soundboardNow?: () => number;
```

Destructure it: `const { staticDir, adminLoginLimiter = createAttemptLimiter(), allowedOrigins = [], soundboardNow = Date.now } = options;`

After `let turnClockMs = 0;`:

```ts
  // When each player last fired a clip, by name key: a reconnect gets a new socket but keeps the
  // name, so it does not reset the cooldown (soundboard spec S5). Memory only.
  const lastClipAt = new Map<string, number>();
```

After the `action` handler:

```ts
    // Soundboard (spec §2.3). Every rejection is dropped silently: the client already blocks these
    // cases, so only a modified client gets here, and an error banner would be noise.
    socket.on('soundboard', (payload: SoundboardPayload) => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) return;
      const displayName = table.seats[seatIndex]?.displayName;
      if (!displayName) return;
      const clipId: unknown = payload?.clipId;
      if (typeof clipId !== 'string' || !SOUNDBOARD_CLIPS.some((c) => c.id === clipId)) return;
      const key = nameKey(displayName);
      const now = soundboardNow();
      const last = lastClipAt.get(key);
      if (last !== undefined && now - last < SOUNDBOARD_COOLDOWN_MS) return;
      lastClipAt.set(key, now);
      io.emit('soundboard', { clipId, seatIndex, displayName });
    });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/socketServer.test.ts --root packages/server`
Expected: PASS, all of the file (old tests unchanged). Then `npm run typecheck`: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/socketServer.ts packages/server/src/socketServer.test.ts
git commit -m "feat(soundboard): server handler with per-player cooldown"
```

---

### Task 3: Mixer state (pure)

**Files:**
- Create: `packages/frontend/src/three/engine/mixer.ts`
- Test: `packages/frontend/src/three/engine/mixer.test.ts`

**Interfaces:**
- Produces: `type ChannelName = 'master' | 'effects' | 'soundboard' | 'ambience'`, `interface ChannelMix { level: number; muted: boolean }`, `type Mix = Record<ChannelName, ChannelMix>`, `CHANNELS`, `CHANNEL_LABELS`, `DEFAULT_MIX`, `MIX_KEY = 'bj3d.mix'`, `LEGACY_SOUND_KEY = 'bj3d.sound'`, `parseMix(raw: string | null, legacySound: string | null): Mix`, `readMix(storage?: Storage): Mix`, `writeMix(mix: Mix, storage?: Storage): void`, `channelGain(mix: Mix, ch: ChannelName): number`, `soundboardAudible(mix: Mix): boolean`.

- [ ] **Step 1: Write the failing tests** — `packages/frontend/src/three/engine/mixer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIX,
  LEGACY_SOUND_KEY,
  MIX_KEY,
  channelGain,
  parseMix,
  readMix,
  soundboardAudible,
  writeMix,
  type Mix,
} from './mixer';

describe('mixer state (soundboard spec §3.2)', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the S11 mix, all unmuted', () => {
    expect(DEFAULT_MIX).toEqual({
      master: { level: 0.8, muted: false },
      effects: { level: 0.7, muted: false },
      soundboard: { level: 0.6, muted: false },
      ambience: { level: 0.3, muted: false },
    });
    expect(parseMix(null, null)).toEqual(DEFAULT_MIX);
  });

  it('falls back to the default on malformed JSON', () => {
    expect(parseMix('{not json', null)).toEqual(DEFAULT_MIX);
    expect(parseMix('"a string"', null)).toEqual(DEFAULT_MIX);
    expect(parseMix('null', null)).toEqual(DEFAULT_MIX);
  });

  it('falls back per field on partial or out-of-range values', () => {
    const raw = JSON.stringify({
      master: { level: 0.5, muted: true },
      effects: { level: 7 },
      soundboard: { level: 'loud', muted: 'yes' },
      ambience: { level: -0.1, muted: false },
    });
    expect(parseMix(raw, null)).toEqual({
      master: { level: 0.5, muted: true },
      effects: { level: 0.7, muted: false },
      soundboard: { level: 0.6, muted: false },
      ambience: { level: 0.3, muted: false },
    });
  });

  it('migrates a legacy "off" to a muted master when no mix is stored', () => {
    expect(parseMix(null, 'off').master).toEqual({ level: 0.8, muted: true });
    expect(parseMix(null, 'on')).toEqual(DEFAULT_MIX);
  });

  it('ignores the legacy key once a mix is stored', () => {
    expect(parseMix(JSON.stringify(DEFAULT_MIX), 'off').master.muted).toBe(false);
  });

  it('round-trips through localStorage and never writes the legacy key', () => {
    const mix: Mix = { ...DEFAULT_MIX, effects: { level: 0.25, muted: true } };
    writeMix(mix);
    expect(JSON.parse(localStorage.getItem(MIX_KEY) as string)).toEqual(mix);
    expect(readMix()).toEqual(mix);
    expect(localStorage.getItem(LEGACY_SOUND_KEY)).toBeNull();
  });

  it('reads the legacy key from storage', () => {
    localStorage.setItem(LEGACY_SOUND_KEY, 'off');
    expect(readMix().master.muted).toBe(true);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readMix(broken)).toEqual(DEFAULT_MIX);
    expect(() => writeMix(DEFAULT_MIX, broken)).not.toThrow();
  });

  it('gives a muted channel zero gain and leaves its level alone', () => {
    const mix: Mix = { ...DEFAULT_MIX, effects: { level: 0.7, muted: true } };
    expect(channelGain(mix, 'effects')).toBe(0);
    expect(channelGain(mix, 'soundboard')).toBe(0.6);
    expect(mix.effects.level).toBe(0.7);
  });

  it('treats master as its own channel, so unmuting it restores the mix', () => {
    const muted: Mix = { ...DEFAULT_MIX, master: { level: 0.8, muted: true } };
    expect(channelGain(muted, 'master')).toBe(0);
    expect(channelGain(muted, 'ambience')).toBe(0.3);
    expect(channelGain({ ...muted, master: { level: 0.8, muted: false } }, 'master')).toBe(0.8);
  });

  it('reports the soundboard inaudible when it or master is muted', () => {
    expect(soundboardAudible(DEFAULT_MIX)).toBe(true);
    expect(soundboardAudible({ ...DEFAULT_MIX, soundboard: { level: 0.6, muted: true } })).toBe(false);
    expect(soundboardAudible({ ...DEFAULT_MIX, master: { level: 0.8, muted: true } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/three/engine/mixer.test.ts --root packages/frontend`
Expected: FAIL, cannot resolve `./mixer`.

- [ ] **Step 3: Create `packages/frontend/src/three/engine/mixer.ts`**

```ts
// The sound mixer's state (soundboard spec §3.2). Pure: the engine applies it, the popover edits it.

export type ChannelName = 'master' | 'effects' | 'soundboard' | 'ambience';

export interface ChannelMix {
  level: number; // 0..1
  muted: boolean;
}

export type Mix = Record<ChannelName, ChannelMix>;

// Row order in the mixer popover (S9).
export const CHANNELS: readonly ChannelName[] = ['master', 'effects', 'soundboard', 'ambience'];

export const CHANNEL_LABELS: Record<ChannelName, string> = {
  master: 'Master',
  effects: 'Table effects',
  soundboard: 'Soundboard',
  ambience: 'Ambience',
};

// Sound is on by default (S11).
export const DEFAULT_MIX: Mix = {
  master: { level: 0.8, muted: false },
  effects: { level: 0.7, muted: false },
  soundboard: { level: 0.6, muted: false },
  ambience: { level: 0.3, muted: false },
};

export const MIX_KEY = 'bj3d.mix';
// The old on/off chip's key. Read once for migration, never written again (S11).
export const LEGACY_SOUND_KEY = 'bj3d.sound';

function defaults(): Mix {
  return JSON.parse(JSON.stringify(DEFAULT_MIX)) as Mix;
}

function parseChannel(value: unknown, fallback: ChannelMix): ChannelMix {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof ChannelMix, unknown>>;
  const level =
    typeof v.level === 'number' && Number.isFinite(v.level) && v.level >= 0 && v.level <= 1 ? v.level : fallback.level;
  const muted = typeof v.muted === 'boolean' ? v.muted : fallback.muted;
  return { level, muted };
}

// Missing, malformed or out-of-range values fall back per field to the default.
export function parseMix(raw: string | null, legacySound: string | null): Mix {
  if (raw === null) {
    const mix = defaults();
    if (legacySound === 'off') mix.master.muted = true;
    return mix;
  }
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Partial<Record<ChannelName, unknown>>;
  return {
    master: parseChannel(obj.master, DEFAULT_MIX.master),
    effects: parseChannel(obj.effects, DEFAULT_MIX.effects),
    soundboard: parseChannel(obj.soundboard, DEFAULT_MIX.soundboard),
    ambience: parseChannel(obj.ambience, DEFAULT_MIX.ambience),
  };
}

function storageOrNull(storage?: Storage): Storage | null {
  try {
    return storage ?? window.localStorage;
  } catch {
    return null;
  }
}

export function readMix(storage?: Storage): Mix {
  const s = storageOrNull(storage);
  try {
    return parseMix(s?.getItem(MIX_KEY) ?? null, s?.getItem(LEGACY_SOUND_KEY) ?? null);
  } catch {
    return defaults();
  }
}

export function writeMix(mix: Mix, storage?: Storage): void {
  try {
    storageOrNull(storage)?.setItem(MIX_KEY, JSON.stringify(mix));
  } catch {
    /* storage unavailable: the mix just won't persist */
  }
}

// A channel's own gain node value. Master is a separate node, so muting it leaves every channel's
// state alone and unmuting restores the previous mix.
export function channelGain(mix: Mix, ch: ChannelName): number {
  return mix[ch].muted ? 0 : mix[ch].level;
}

// Whether this player would hear soundboard clips (for the popover's "others still hear you" hint).
export function soundboardAudible(mix: Mix): boolean {
  return !mix.master.muted && !mix.soundboard.muted;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/three/engine/mixer.test.ts --root packages/frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/three/engine/mixer.ts packages/frontend/src/three/engine/mixer.test.ts
git commit -m "feat(sound): pure mixer state with defaults, parsing and legacy migration"
```

---

### Task 4: Rebuild the audio engine (gain graph, unlock, clip bank, no piano)

**Files:**
- Modify (rewrite): `packages/frontend/src/three/engine/audio.ts`
- Test: `packages/frontend/src/three/engine/audio.test.ts` (new)

**Interfaces:**
- Consumes: Task 3's `Mix`, `CHANNELS`, `channelGain`, `ChannelName`; Task 1's `SOUNDBOARD_MAX_CLIP_MS`, `SoundboardClip`.
- Produces:
  - `interface SoundStageOptions { mix: Mix; createContext?: () => AudioContext | null; fetchClip?: (url: string) => Promise<ArrayBuffer>; isHidden?: () => boolean }`
  - `class SoundStage` with `constructor(opts)`, `unlocked: boolean`, `readonly channels: Record<ChannelName, GainNode> | null`, `unlock(): Promise<void>`, `setMix(mix: Mix): void`, `loadClips(clips: readonly SoundboardClip[], base?: string): Promise<Set<string>>` (resolves to the ids that loaded), `playClip(id: string): boolean` (true if it started), `cardSnap()`, `cardFlip()`, `chipClack()`, `dispose()`.
  - `SceneRoot.ts` keeps calling `cardSnap` / `cardFlip` / `chipClack` unchanged. `enable()`, `disable()` and `enabled` are removed (only `TableStage` used them; Task 8 replaces those calls).

- [ ] **Step 1: Write the failing tests** — `packages/frontend/src/three/engine/audio.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundStage } from './audio';
import { DEFAULT_MIX, type Mix } from './mixer';
import { SOUNDBOARD_CLIPS, SOUNDBOARD_MAX_CLIP_MS } from '@poker-blackjack/server/src/soundboardClips';

// A small stand-in for the Web Audio API (jsdom has none): records the graph and the schedule.
class FakeParam {
  value = 1;
  calls: [string, number, number][] = [];
  setTargetAtTime(v: number, t: number) {
    this.calls.push(['target', v, t]);
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(['linear', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exp', v, t]);
  }
}
class FakeNode {
  out: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.out.push(n);
    return n;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(t = 0) {
    this.startedAt = t;
  }
  stop(t = 0) {
    this.stoppedAt = t;
  }
}
class FakeFilter extends FakeNode {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
}
class FakeOsc extends FakeSource {
  type = '';
  frequency = new FakeParam();
}
class FakeCtx {
  state = 'suspended';
  currentTime = 10;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createOscillator() {
    return new FakeOsc();
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
  async decodeAudioData(data: ArrayBuffer) {
    if (data.byteLength === 0) throw new Error('undecodable');
    return { duration: 2 } as AudioBuffer;
  }
}

const CLIP = SOUNDBOARD_CLIPS[0];

function stage(over: { mix?: Mix; hidden?: () => boolean; files?: Record<string, number> } = {}) {
  const ctx = new FakeCtx();
  const files = over.files ?? { [CLIP.file]: 4 };
  const sound = new SoundStage({
    mix: over.mix ?? DEFAULT_MIX,
    createContext: () => ctx as unknown as AudioContext,
    fetchClip: async (url) => {
      const name = url.replace('/sounds/', '');
      if (!(name in files)) throw new Error('404');
      return new ArrayBuffer(files[name]);
    },
    isHidden: over.hidden ?? (() => false),
  });
  return { sound, ctx };
}

async function ready(over: Parameters<typeof stage>[0] = {}) {
  const s = stage(over);
  await s.sound.loadClips([CLIP]);
  await s.sound.unlock();
  return s;
}

describe('SoundStage (soundboard spec §3.1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes effects, soundboard and ambience through master to the speakers', () => {
    const { sound, ctx } = stage();
    const ch = sound.channels as unknown as Record<string, FakeGain>;
    expect(ch.master.out).toEqual([ctx.destination]);
    for (const name of ['effects', 'soundboard', 'ambience']) expect(ch[name].out).toEqual([ch.master]);
  });

  it('sets each channel gain from the mix', () => {
    const { sound } = stage({ mix: { ...DEFAULT_MIX, effects: { level: 0.7, muted: true } } });
    const ch = sound.channels as unknown as Record<string, FakeGain>;
    expect(ch.master.gain.value).toBe(0.8);
    expect(ch.effects.gain.value).toBe(0);
    expect(ch.soundboard.gain.value).toBe(0.6);
    expect(ch.ambience.gain.value).toBe(0.3);
  });

  it('glides gain changes instead of jumping (no clicks)', () => {
    const { sound } = stage();
    sound.setMix({ ...DEFAULT_MIX, soundboard: { level: 0.2, muted: false } });
    const ch = sound.channels as unknown as Record<string, FakeGain>;
    expect(ch.soundboard.gain.calls.at(-1)?.slice(0, 2)).toEqual(['target', 0.2]);
  });

  it('feeds the murmur into the ambience channel', () => {
    const { sound, ctx } = stage();
    const ambience = (sound.channels as unknown as Record<string, FakeGain>).ambience;
    const murmur = ctx.sources[0];
    expect(murmur.loop).toBe(true);
    // source -> lowpass -> gain -> ambience
    expect(murmur.out[0].out[0].out[0]).toBe(ambience);
  });

  it('starts no piano timer (S10)', async () => {
    const spy = vi.spyOn(window, 'setInterval');
    await ready();
    expect(spy).not.toHaveBeenCalled();
  });

  it('plays a loaded clip through the soundboard channel and cuts it at the cap with a fade', async () => {
    const { sound, ctx } = await ready();
    expect(sound.playClip(CLIP.id)).toBe(true);
    const src = ctx.sources.at(-1) as FakeSource;
    const fade = src.out[0] as FakeGain;
    expect(fade.out[0]).toBe((sound.channels as unknown as Record<string, FakeGain>).soundboard);
    const stopAt = 10 + SOUNDBOARD_MAX_CLIP_MS / 1000;
    expect(src.startedAt).toBe(10);
    expect(src.stoppedAt).toBe(stopAt);
    expect(fade.gain.calls).toEqual([
      ['set', 1, stopAt - 0.15],
      ['linear', 0, stopAt],
    ]);
  });

  it('drops a clip before the first gesture unlocks audio', async () => {
    const { sound } = stage();
    await sound.loadClips([CLIP]);
    expect(sound.playClip(CLIP.id)).toBe(false);
  });

  it('drops a clip while the tab is hidden', async () => {
    const { sound } = await ready({ hidden: () => true });
    expect(sound.playClip(CLIP.id)).toBe(false);
  });

  it('drops a clip whose file is missing or undecodable, and reports it unavailable', async () => {
    const { sound } = stage({ files: { [SOUNDBOARD_CLIPS[1].file]: 0 } });
    const available = await sound.loadClips(SOUNDBOARD_CLIPS.slice(0, 2));
    expect(available.size).toBe(0);
    await sound.unlock();
    expect(sound.playClip(CLIP.id)).toBe(false);
  });

  it('drops a clip when the soundboard or master is muted', async () => {
    const a = await ready({ mix: { ...DEFAULT_MIX, soundboard: { level: 0.6, muted: true } } });
    expect(a.sound.playClip(CLIP.id)).toBe(false);
    const b = await ready({ mix: { ...DEFAULT_MIX, master: { level: 0.8, muted: true } } });
    expect(b.sound.playClip(CLIP.id)).toBe(false);
  });

  it('plays table effects only once unlocked', async () => {
    const { sound, ctx } = stage();
    const before = ctx.sources.length;
    sound.cardSnap();
    expect(ctx.sources.length).toBe(before);
    await sound.unlock();
    sound.cardSnap();
    expect(ctx.sources.length).toBe(before + 1);
  });

  it('is a silent no-op without Web Audio', async () => {
    const sound = new SoundStage({ mix: DEFAULT_MIX, createContext: () => null });
    expect(await sound.loadClips([CLIP])).toEqual(new Set());
    await sound.unlock();
    expect(sound.playClip(CLIP.id)).toBe(false);
    expect(() => sound.chipClack()).not.toThrow();
    expect(() => sound.dispose()).not.toThrow();
  });

  it('stays locked if disposed while resuming', async () => {
    const { sound, ctx } = stage();
    const pending = sound.unlock();
    sound.dispose();
    await pending;
    expect(sound.unlocked).toBe(false);
    expect(ctx.state).toBe('closed');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/three/engine/audio.test.ts --root packages/frontend`
Expected: FAIL (the old `SoundStage` has no `channels`, `loadClips`, `playClip`, `unlock`).

- [ ] **Step 3: Rewrite `packages/frontend/src/three/engine/audio.ts`**

```ts
import { SOUNDBOARD_MAX_CLIP_MS, type SoundboardClip } from '@poker-blackjack/server/src/soundboardClips';
import { CHANNELS, channelGain, type ChannelName, type Mix } from './mixer';

// Table effects and the room murmur are synthesised in the browser; soundboard clips are files the
// host drops into public/sounds (soundboard spec §2.4). Gain graph (§3.1):
//   murmur -> ambience ┐
//   card/chip -> effects ├-> master -> speakers
//   clips -> soundboard ┘
// The saloon piano is gone (S10).

export interface SoundStageOptions {
  mix: Mix;
  // Injectable for tests; the default uses the browser's AudioContext, or null where there is none.
  createContext?: () => AudioContext | null;
  fetchClip?: (url: string) => Promise<ArrayBuffer>;
  isHidden?: () => boolean;
}

function browserContext(): AudioContext | null {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.arrayBuffer();
}

// The murmur's own level inside the ambience channel. Raised from the old 0.16 so that the default
// mix (master 0.8 x ambience 0.3, S11) sounds as loud as the murmur did under the old master 0.9.
const MURMUR_GAIN = 0.6;
const CLIP_FADE_S = 0.15;
// Time constant for mixer changes: fast enough to feel immediate, slow enough not to click.
const GAIN_SMOOTHING_S = 0.05;

export class SoundStage {
  private ctx: AudioContext | null;
  readonly channels: Record<ChannelName, GainNode> | null = null;
  private mix: Mix;
  private clips = new Map<string, AudioBuffer>();
  private fetchClip: (url: string) => Promise<ArrayBuffer>;
  private isHidden: () => boolean;
  // Browsers keep audio suspended until a user gesture; until then everything is silent.
  unlocked = false;

  constructor(opts: SoundStageOptions) {
    this.mix = opts.mix;
    this.fetchClip = opts.fetchClip ?? fetchArrayBuffer;
    this.isHidden = opts.isHidden ?? (() => document.hidden);
    this.ctx = (opts.createContext ?? browserContext)();
    const ctx = this.ctx;
    if (!ctx) return;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const channel = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    this.channels = { master, effects: channel(), soundboard: channel(), ambience: channel() };
    for (const ch of CHANNELS) this.channels[ch].gain.value = channelGain(this.mix, ch);
    this.buildAmbience();
  }

  // Call from a user gesture (pointerdown / keydown). Safe to call more than once.
  async unlock(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.unlocked) return;
    await ctx.resume();
    // dispose() may have run while resume() was pending.
    if (this.ctx !== ctx) return;
    this.unlocked = true;
  }

  setMix(mix: Mix): void {
    this.mix = mix;
    if (!this.ctx || !this.channels) return;
    const t = this.ctx.currentTime;
    for (const ch of CHANNELS) this.channels[ch].gain.setTargetAtTime(channelGain(mix, ch), t, GAIN_SMOOTHING_S);
  }

  // Fetches and decodes each clip once (decoding works on a suspended context). Resolves to the ids
  // that loaded; a fetch or decode failure leaves that clip unavailable.
  async loadClips(clips: readonly SoundboardClip[], base = '/sounds/'): Promise<Set<string>> {
    const ctx = this.ctx;
    if (!ctx) return new Set();
    await Promise.all(
      clips.map(async (clip) => {
        try {
          const buffer = await ctx.decodeAudioData(await this.fetchClip(base + clip.file));
          if (this.ctx === ctx) this.clips.set(clip.id, buffer);
        } catch {
          /* missing or undecodable: the tile shows disabled */
        }
      }),
    );
    return new Set(this.clips.keys());
  }

  // Dropped, not queued, when audio is locked, the tab is hidden (no burst on return, spec §4), the
  // clip is unavailable, or the player muted the soundboard or master.
  playClip(id: string): boolean {
    const ctx = this.ctx;
    const buffer = this.clips.get(id);
    if (!ctx || !this.channels || !this.unlocked || this.isHidden() || !buffer) return false;
    if (this.mix.master.muted || this.mix.soundboard.muted) return false;
    const t = ctx.currentTime;
    const stopAt = t + SOUNDBOARD_MAX_CLIP_MS / 1000;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(1, stopAt - CLIP_FADE_S);
    fade.gain.linearRampToValueAtTime(0, stopAt);
    src.connect(fade).connect(this.channels.soundboard);
    src.start(t);
    src.stop(stopAt);
    return true;
  }

  private noiseBuffer(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  // Started at once; it is silent until unlock() resumes the context.
  private buildAmbience(): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(6, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = MURMUR_GAIN;
    src.connect(lp).connect(g).connect((this.channels as Record<ChannelName, GainNode>).ambience);
    src.start();
  }

  private burst(freq: number, dur: number, gain: number, q = 1.2): void {
    if (!this.unlocked || !this.ctx || !this.channels) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.2, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * (0.9 + Math.random() * 0.2);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(bp).connect(g).connect(this.channels.effects);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  cardSnap(): void {
    this.burst(2600, 0.07, 0.55, 0.9);
  }

  cardFlip(): void {
    this.burst(1700, 0.11, 0.35, 0.7);
  }

  chipClack(): void {
    if (!this.unlocked || !this.ctx || !this.channels) return;
    this.burst(4200, 0.05, 0.5, 4);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(3100 + Math.random() * 500, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(this.channels.effects);
    o.start(t);
    o.stop(t + 0.1);
  }

  dispose(): void {
    this.unlocked = false;
    this.clips.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/three/engine/audio.test.ts --root packages/frontend` → PASS.
Run: `npm run typecheck` → expect errors only in `TableStage.tsx` (it still calls `enable` / `disable` / `enabled` and `new SoundStage()` with no options). Make the smallest bridge so this task's commit is green, in `TableStage.tsx`:
- `const sound = new SoundStage({ mix: readMix() });` (import `readMix` from `./engine/mixer`)
- replace `sound.enable()` with `sound.unlock()` and `sound.enabled` with `sound.unlocked`; replace the body of `toggleSound` with `const sound = soundRef.current; if (!sound) return; await sound.unlock().catch(() => undefined); setSoundOn(sound.unlocked);` (the chip can only turn sound on until Task 8 replaces it).
Task 8 replaces all of this. Then `npm run typecheck` and `npm test --workspace=@poker-blackjack/frontend` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/three/engine/audio.ts packages/frontend/src/three/engine/audio.test.ts packages/frontend/src/three/TableStage.tsx
git commit -m "feat(sound): channel gain graph, gesture unlock and clip bank; remove the piano"
```

---

### Task 5: `SocketContext` sends and fans out `soundboard`

**Files:**
- Modify: `packages/frontend/src/socket/SocketContext.tsx`
- Test: `packages/frontend/src/socket/SocketContext.test.tsx` (append a `describe`)
- Modify (add two fields to full context literals): `packages/frontend/src/components/AdminEntry.test.tsx`, `AdminPanel.test.tsx`, `JoinScreen.test.tsx`, `Lobby.test.tsx`

**Interfaces:**
- Consumes: Task 1's `SoundboardBroadcast`.
- Produces: on `SocketContextValue`: `sendSoundboard: (clipId: string) => void;` and `onSoundboard: (listener: (payload: SoundboardBroadcast) => void) => () => void;` (returns the unsubscribe; the function identity is stable across renders, so it is safe in effect dependency lists).

- [ ] **Step 1: Write the failing tests.** Append to `packages/frontend/src/socket/SocketContext.test.tsx` (it already has the fake socket, `handlers`, `emitted`):

```tsx
describe('SocketProvider soundboard (soundboard spec §2.5)', () => {
  beforeEach(() => {
    handlers.clear();
    ioManagerHandlers.clear();
    emitted.length = 0;
    localStorage.clear();
    sessionStorage.clear();
  });

  function SoundboardConsumer({ onClip }: { onClip: (p: unknown) => void }) {
    const { sendSoundboard, onSoundboard } = useSocket();
    const [subscribed, setSubscribed] = useState(true);
    useEffect(() => (subscribed ? onSoundboard(onClip) : undefined), [subscribed, onSoundboard, onClip]);
    return (
      <>
        <button onClick={() => sendSoundboard('vine-boom')}>fire</button>
        <button onClick={() => setSubscribed(false)}>unsubscribe</button>
      </>
    );
  }

  it('emits soundboard with the clip id', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <SoundboardConsumer onClip={vi.fn()} />
      </SocketProvider>,
    );
    await userEvent.click(screen.getByText('fire'));
    expect(emitted).toContainEqual({ event: 'soundboard', payload: { clipId: 'vine-boom' } });
  });

  it('passes broadcasts to subscribers until they unsubscribe', async () => {
    const onClip = vi.fn();
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <SoundboardConsumer onClip={onClip} />
      </SocketProvider>,
    );
    const payload = { clipId: 'vine-boom', seatIndex: 2, displayName: 'bob' };
    act(() => handlers.get('soundboard')?.(payload));
    expect(onClip).toHaveBeenCalledWith(payload);
    await userEvent.click(screen.getByText('unsubscribe'));
    act(() => handlers.get('soundboard')?.(payload));
    expect(onClip).toHaveBeenCalledTimes(1);
  });
});
```

Add `useEffect, useState` to a new `import { useEffect, useState } from 'react';` line and `import userEvent from '@testing-library/user-event';` at the top if not present.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/socket/SocketContext.test.tsx --root packages/frontend -t soundboard`
Expected: FAIL (typecheck: `sendSoundboard` not on the context; or `handlers.get('soundboard')` undefined).

- [ ] **Step 3: Implement** in `SocketContext.tsx`:
- import `useCallback` from react; add `SoundboardBroadcast` to the protocol type import.
- In `SocketContextValue`, after `takeOver`:

```ts
  // Soundboard (soundboard spec §2.5). onSoundboard returns its unsubscribe and keeps one identity
  // for the provider's lifetime, so subscribers can list it in effect dependencies.
  sendSoundboard: (clipId: string) => void;
  onSoundboard: (listener: (payload: SoundboardBroadcast) => void) => () => void;
```

- In `SocketProvider`, next to the other refs: `const soundboardListenersRef = useRef(new Set<(payload: SoundboardBroadcast) => void>());`
- In the socket effect, after the `adminNotice` handler:

```ts
    socket.on('soundboard', (payload: SoundboardBroadcast) => {
      for (const listener of soundboardListenersRef.current) listener(payload);
    });
```

- After `adminSetTurnClock`:

```ts
  function sendSoundboard(clipId: string) {
    socketRef.current?.emit('soundboard', { clipId });
  }

  const onSoundboard = useCallback((listener: (payload: SoundboardBroadcast) => void) => {
    soundboardListenersRef.current.add(listener);
    return () => {
      soundboardListenersRef.current.delete(listener);
    };
  }, []);
```

- Add `sendSoundboard, onSoundboard,` to `value` after `takeOver`.
- In the four component test files listed above, add after `takeOver: vi.fn(),`:

```ts
    sendSoundboard: vi.fn(),
    onSoundboard: vi.fn(() => () => undefined),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test --workspace=@poker-blackjack/frontend` and `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/socket/SocketContext.tsx packages/frontend/src/socket/SocketContext.test.tsx packages/frontend/src/components/*.test.tsx
git commit -m "feat(soundboard): socket context sends clips and fans out broadcasts"
```

---

### Task 6: Clip badges on the HUD player list

**Files:**
- Create: `packages/frontend/src/sound/clipBadges.tsx`
- Test: `packages/frontend/src/sound/clipBadges.test.tsx`
- Modify: `packages/frontend/src/hud/PlayerList.tsx`

**Interfaces:**
- Consumes: Task 1's `SOUNDBOARD_CLIPS`, `SoundboardBroadcast`.
- Produces: `interface ClipBadge { seatIndex: number; displayName: string; emoji: string; label: string; key: number }`, `BADGE_MS = 2500`, `useClipBadges(): { badges: Record<number, ClipBadge>; show: (p: SoundboardBroadcast) => void }` (`show` is stable), `ClipBadgeContext` (React context of `Record<number, ClipBadge>`, default `{}`), `useClipBadgeFor(seatIndex: number, name: string): ClipBadge | null`. `PlayerRow` renders `data-testid="hud-clip-badge-{seatIndex}"`.

- [ ] **Step 1: Write the failing tests** — `packages/frontend/src/sound/clipBadges.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUNDBOARD_CLIPS } from '@poker-blackjack/server/src/soundboardClips';
import type { SoundboardBroadcast } from '@poker-blackjack/server/src/protocol';
import type { HudRow } from '../hud/hudModel';
import { PlayerList } from '../hud/PlayerList';
import { BADGE_MS, ClipBadgeContext, useClipBadges } from './clipBadges';

const [A, B] = SOUNDBOARD_CLIPS;

function row(seatIndex: number, name: string): HudRow {
  return {
    seatIndex,
    name,
    balance: 1000,
    isMe: false,
    isActive: false,
    dimmed: false,
    won: false,
    bet: null,
    badges: [],
    status: 'waiting',
    tone: 'plain',
    handName: null,
    groups: [],
  };
}

let fire: (p: SoundboardBroadcast) => void = () => undefined;

function Harness({ rows }: { rows: HudRow[] }) {
  const { badges, show } = useClipBadges();
  fire = show;
  return (
    <ClipBadgeContext.Provider value={badges}>
      <PlayerList rows={rows} clockSeconds={null} />
    </ClipBadgeContext.Provider>
  );
}

describe('clip badges (soundboard spec S7, §4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the clip on the sender's row and expires it after 2.5 s", () => {
    render(<Harness rows={[row(0, 'alice'), row(1, 'bob')]} />);
    act(() => fire({ clipId: A.id, seatIndex: 1, displayName: 'bob' }));
    expect(screen.getByTestId('hud-clip-badge-1')).toHaveTextContent(`${A.emoji} ${A.label}`);
    expect(screen.queryByTestId('hud-clip-badge-0')).toBeNull();
    act(() => vi.advanceTimersByTime(BADGE_MS - 1));
    expect(screen.getByTestId('hud-clip-badge-1')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('hud-clip-badge-1')).toBeNull();
  });

  it('replaces the badge and restarts its timer on a new clip from the same player', () => {
    render(<Harness rows={[row(0, 'alice')]} />);
    act(() => fire({ clipId: A.id, seatIndex: 0, displayName: 'alice' }));
    act(() => vi.advanceTimersByTime(2000));
    act(() => fire({ clipId: B.id, seatIndex: 0, displayName: 'alice' }));
    expect(screen.getByTestId('hud-clip-badge-0')).toHaveTextContent(B.label);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('hud-clip-badge-0')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId('hud-clip-badge-0')).toBeNull();
  });

  it('shows no badge when the seat now holds someone else', () => {
    render(<Harness rows={[row(0, 'carol')]} />);
    act(() => fire({ clipId: A.id, seatIndex: 0, displayName: 'alice' }));
    expect(screen.queryByTestId('hud-clip-badge-0')).toBeNull();
  });

  it('ignores an unknown clip id', () => {
    render(<Harness rows={[row(0, 'alice')]} />);
    act(() => fire({ clipId: 'nope', seatIndex: 0, displayName: 'alice' }));
    expect(screen.queryByTestId('hud-clip-badge-0')).toBeNull();
  });

  it('renders no badge without a provider (the flat view)', () => {
    render(<PlayerList rows={[row(0, 'alice')]} clockSeconds={null} />);
    expect(screen.queryByTestId('hud-clip-badge-0')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sound/clipBadges.test.tsx --root packages/frontend`
Expected: FAIL, cannot resolve `./clipBadges`.

- [ ] **Step 3: Create `packages/frontend/src/sound/clipBadges.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SOUNDBOARD_CLIPS } from '@poker-blackjack/server/src/soundboardClips';
import type { SoundboardBroadcast } from '@poker-blackjack/server/src/protocol';

// Who just fired which clip, shown as a brass pill on their HUD row (soundboard spec S7). Lives
// outside src/three so the HUD can read it without reaching the three.js chunk.

export interface ClipBadge {
  seatIndex: number;
  displayName: string;
  emoji: string;
  label: string;
  key: number;
}

export const BADGE_MS = 2500;

export function useClipBadges(): { badges: Record<number, ClipBadge>; show: (p: SoundboardBroadcast) => void } {
  const [badges, setBadges] = useState<Record<number, ClipBadge>>({});
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
    };
  }, []);

  const show = useCallback((p: SoundboardBroadcast) => {
    const clip = SOUNDBOARD_CLIPS.find((c) => c.id === p.clipId);
    if (!clip) return;
    seq.current += 1;
    const badge: ClipBadge = { seatIndex: p.seatIndex, displayName: p.displayName, emoji: clip.emoji, label: clip.label, key: seq.current };
    setBadges((b) => ({ ...b, [p.seatIndex]: badge }));
    // A new clip from the same seat replaces the badge and restarts its 2.5 s.
    clearTimeout(timers.current.get(p.seatIndex));
    timers.current.set(
      p.seatIndex,
      setTimeout(() => {
        timers.current.delete(p.seatIndex);
        setBadges((b) => {
          const rest = { ...b };
          delete rest[p.seatIndex];
          return rest;
        });
      }, BADGE_MS),
    );
  }, []);

  return { badges, show };
}

// Default {}: no provider (the flat view, tests) means no badges.
export const ClipBadgeContext = createContext<Record<number, ClipBadge>>({});

// Matched on seat and name, so a clip from a player who has left shows nothing and a newcomer in a
// reused seat never inherits one (spec §4).
export function useClipBadgeFor(seatIndex: number, name: string): ClipBadge | null {
  const badge = useContext(ClipBadgeContext)[seatIndex];
  return badge && badge.displayName === name ? badge : null;
}
```

- [ ] **Step 4: Render it in `PlayerList.tsx`.** Add `import { useClipBadgeFor } from '../sound/clipBadges';`. In `PlayerRow`, first line of the body: `const clip = useClipBadgeFor(row.seatIndex, row.name);`. Inside the name line's `<div className="mt-[0.15em] flex flex-wrap ...">`, right after the name `<span>`:

```tsx
          {clip && (
            <span
              key={clip.key}
              data-testid={`hud-clip-badge-${row.seatIndex}`}
              className="rounded-full border border-brass-bright bg-brass px-[0.5em] text-[0.85em] font-semibold text-ink"
            >
              {clip.emoji} {clip.label}
            </span>
          )}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/sound/clipBadges.test.tsx src/hud --root packages/frontend` → PASS (includes `noThree.test.ts`, which now walks into `src/sound/clipBadges.tsx`). Then `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/sound/clipBadges.tsx packages/frontend/src/sound/clipBadges.test.tsx packages/frontend/src/hud/PlayerList.tsx
git commit -m "feat(soundboard): brass clip badge on the sender's HUD row"
```

---

### Task 7: Mixer and Soundboard popovers

**Files:**
- Create: `packages/frontend/src/sound/Popover.tsx`
- Create: `packages/frontend/src/sound/MixerControl.tsx`
- Create: `packages/frontend/src/sound/SoundboardControl.tsx`
- Test: `packages/frontend/src/sound/controls.test.tsx`
- Modify: `packages/frontend/src/index.css` (keyframes)

**Interfaces:**
- Consumes: Task 3's `Mix`, `CHANNELS`, `CHANNEL_LABELS`, `ChannelName`, `soundboardAudible`; Task 1's `SoundboardClip`, `SOUNDBOARD_COOLDOWN_MS`.
- Produces:
  - `Popover({ label, open, onToggle, onClose, panelLabel, children })`: trigger `<button aria-expanded aria-haspopup="dialog">` + panel `role="dialog" aria-label={panelLabel}`; Esc or `pointerdown` outside the wrapper calls `onClose`.
  - `MixerControl({ mix, onChange, open, onToggle, onClose })`, trigger text "Sound ▾".
  - `SoundboardControl({ clips, available, mix, onFire, open, onToggle, onClose })`; renders nothing when `clips` is empty; trigger text "Soundboard".
  - `TableStage` (Task 8) owns which popover is open, so only one is open at a time.

- [ ] **Step 1: Write the failing tests** — `packages/frontend/src/sound/controls.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOUNDBOARD_CLIPS, SOUNDBOARD_COOLDOWN_MS } from '@poker-blackjack/server/src/soundboardClips';
import { DEFAULT_MIX, type Mix } from '../three/engine/mixer';
import { MixerControl } from './MixerControl';
import { SoundboardControl } from './SoundboardControl';

const [A, B] = SOUNDBOARD_CLIPS;

function MixerHarness({ onChange }: { onChange: (m: Mix) => void }) {
  const [mix, setMix] = useState(DEFAULT_MIX);
  const [open, setOpen] = useState(false);
  return (
    <MixerControl
      mix={mix}
      onChange={(m) => {
        setMix(m);
        onChange(m);
      }}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClose={() => setOpen(false)}
    />
  );
}

function BoardHarness(props: { available?: Set<string>; mix?: Mix; onFire?: (id: string) => void; clips?: typeof SOUNDBOARD_CLIPS }) {
  const [open, setOpen] = useState(true);
  return (
    <SoundboardControl
      clips={props.clips ?? SOUNDBOARD_CLIPS}
      available={props.available ?? new Set([A.id, B.id])}
      mix={props.mix ?? DEFAULT_MIX}
      onFire={props.onFire ?? vi.fn()}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClose={() => setOpen(false)}
    />
  );
}

describe('MixerControl (soundboard spec §3.3)', () => {
  it('opens from a button that reports aria-expanded', async () => {
    render(<MixerHarness onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /sound/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Master', 'Table effects', 'Soundboard', 'Ambience']) {
      expect(screen.getByRole('slider', { name: `${label} volume` })).toBeInTheDocument();
    }
  });

  it('mutes a channel and changes its level', async () => {
    const onChange = vi.fn();
    render(<MixerHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /sound/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Mute Table effects' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MIX, effects: { level: 0.7, muted: true } });
    expect(screen.getByRole('button', { name: 'Unmute Table effects' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('slider', { name: 'Ambience volume' }), { target: { value: '55' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ambience: { level: 0.55, muted: false } }));
  });

  it('closes on Escape and on a click outside', async () => {
    render(
      <>
        <MixerHarness onChange={vi.fn()} />
        <p>outside</p>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /sound/i }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /sound/i }));
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SoundboardControl (soundboard spec §3.3)', () => {
  afterEach(() => vi.useRealTimers());

  it('renders one tile per clip, emoji and label, and fires the clip', async () => {
    const onFire = vi.fn();
    render(<BoardHarness onFire={onFire} />);
    const tile = screen.getByRole('button', { name: `${A.emoji} ${A.label}` });
    await userEvent.click(tile);
    expect(onFire).toHaveBeenCalledWith(A.id);
    // The grid stays open after firing.
    expect(screen.getByRole('dialog', { name: 'Soundboard' })).toBeInTheDocument();
  });

  it('disables a tile whose file is missing, with a tooltip', () => {
    render(<BoardHarness available={new Set([A.id])} />);
    const missing = screen.getByRole('button', { name: `${B.emoji} ${B.label}` });
    expect(missing).toBeDisabled();
    expect(missing).toHaveAttribute('title', 'Clip file missing');
  });

  it('disables every tile for the cooldown after a click', () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    render(<BoardHarness onFire={onFire} />);
    fireEvent.click(screen.getByRole('button', { name: `${A.emoji} ${A.label}` }));
    expect(screen.getByRole('button', { name: `${B.emoji} ${B.label}` })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: `${A.emoji} ${A.label}` }));
    expect(onFire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(SOUNDBOARD_COOLDOWN_MS));
    expect(screen.getByRole('button', { name: `${B.emoji} ${B.label}` })).toBeEnabled();
  });

  it('keeps the cooldown when the grid is closed and reopened', () => {
    vi.useFakeTimers();
    render(<BoardHarness />);
    fireEvent.click(screen.getByRole('button', { name: `${A.emoji} ${A.label}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Soundboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soundboard' }));
    expect(screen.getByRole('button', { name: `${A.emoji} ${A.label}` })).toBeDisabled();
  });

  it('hints that others still hear you when you muted the soundboard or master', () => {
    const { unmount } = render(<BoardHarness mix={{ ...DEFAULT_MIX, soundboard: { level: 0.6, muted: true } }} />);
    expect(screen.getByText(/others still hear your clips/i)).toBeInTheDocument();
    unmount();
    render(<BoardHarness />);
    expect(screen.queryByText(/others still hear your clips/i)).toBeNull();
  });

  it('renders nothing when there are no clips', () => {
    render(<BoardHarness clips={[]} />);
    expect(screen.queryByRole('button', { name: 'Soundboard' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sound/controls.test.tsx --root packages/frontend` → FAIL (modules missing).

- [ ] **Step 3: Create `packages/frontend/src/sound/Popover.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from 'react';

// A chip that opens a panel below it (soundboard spec §3.3). The parent owns `open`, so it can keep
// only one popover open at a time; Esc or a press outside closes it.
export const CHIP = 'rounded-md border border-wood-grain bg-surface px-2 py-1 font-utility text-xs text-parchment';

export function Popover({
  label,
  panelLabel,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: ReactNode;
  panelLabel: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" className={CHIP} aria-expanded={open} aria-haspopup="dialog" onClick={onToggle}>
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={panelLabel}
          className="absolute left-0 top-full z-50 mt-2 rounded-md border border-wood-grain bg-surface p-3 font-utility text-xs text-parchment shadow-[0_0.6em_1.6em_rgba(0,0,0,0.6)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `packages/frontend/src/sound/MixerControl.tsx`**

```tsx
import { CHANNELS, CHANNEL_LABELS, type ChannelName, type Mix } from '../three/engine/mixer';
import { Popover } from './Popover';

// The "Sound" mixer (soundboard spec S9, layout C): per channel a mute button and a slider.
// Changes apply and persist immediately (the parent writes them).
export function MixerControl({
  mix,
  onChange,
  open,
  onToggle,
  onClose,
}: {
  mix: Mix;
  onChange: (mix: Mix) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const set = (ch: ChannelName, patch: Partial<Mix[ChannelName]>) => onChange({ ...mix, [ch]: { ...mix[ch], ...patch } });
  return (
    <Popover label="Sound ▾" panelLabel="Sound mixer" open={open} onToggle={onToggle} onClose={onClose}>
      <div className="flex w-60 flex-col gap-2">
        {CHANNELS.map((ch) => {
          const label = CHANNEL_LABELS[ch];
          const muted = mix[ch].muted;
          return (
            <div key={ch} className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
                aria-pressed={muted}
                onClick={() => set(ch, { muted: !muted })}
                className="w-6 flex-none text-base leading-none"
              >
                {muted ? '🔇' : '🔊'}
              </button>
              <span className={`w-24 flex-none ${muted ? 'text-fg-faint' : ''}`}>{label}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                aria-label={`${label} volume`}
                value={Math.round(mix[ch].level * 100)}
                onChange={(e) => set(ch, { level: Number(e.target.value) / 100 })}
                className="min-w-0 flex-1 accent-[var(--brass-bright)]"
              />
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
```

- [ ] **Step 5: Create `packages/frontend/src/sound/SoundboardControl.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { SOUNDBOARD_COOLDOWN_MS, type SoundboardClip } from '@poker-blackjack/server/src/soundboardClips';
import { soundboardAudible, type Mix } from '../three/engine/mixer';
import { Popover } from './Popover';

// The soundboard tile grid (soundboard spec S8, §3.3). The cooldown starts on click, not on the
// server's echo, and is per player, so every tile waits. The state lives here, outside the panel,
// so closing and reopening the grid keeps it.
export function SoundboardControl({
  clips,
  available,
  mix,
  onFire,
  open,
  onToggle,
  onClose,
}: {
  clips: readonly SoundboardClip[];
  available: ReadonlySet<string>;
  mix: Mix;
  onFire: (clipId: string) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (clips.length === 0) return null;

  function fire(id: string) {
    if (cooling) return;
    onFire(id);
    setCooling(true);
    timer.current = setTimeout(() => setCooling(false), SOUNDBOARD_COOLDOWN_MS);
  }

  return (
    <Popover label="Soundboard" panelLabel="Soundboard" open={open} onToggle={onToggle} onClose={onClose}>
      <div className="grid w-72 grid-cols-3 gap-2">
        {clips.map((clip) => {
          const missing = !available.has(clip.id);
          return (
            <button
              key={clip.id}
              type="button"
              disabled={missing || cooling}
              title={missing ? 'Clip file missing' : undefined}
              onClick={() => fire(clip.id)}
              className="relative flex flex-col items-center gap-1 overflow-hidden rounded-md border border-wood-grain bg-surface-raised px-1 py-2 text-parchment hover:border-brass-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="text-xl leading-none">{clip.emoji}</span> <span className="text-[0.95em]">{clip.label}</span>
              {cooling && !missing && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 origin-left bg-[rgba(0,0,0,0.55)]"
                  style={{ animation: `sb-sweep ${SOUNDBOARD_COOLDOWN_MS}ms linear forwards` }}
                />
              )}
            </button>
          );
        })}
      </div>
      {!soundboardAudible(mix) && (
        <p className="mt-2 text-fg-dim">You have the soundboard muted; others still hear your clips.</p>
      )}
    </Popover>
  );
}
```

The tile's accessible name is "{emoji} {label}" (the literal space between the spans is part of the text content).

- [ ] **Step 6: Add the sweep keyframes** to `packages/frontend/src/index.css`, after the `seat-pulse` keyframes block:

```css
/* Soundboard cooldown: the dark overlay drains left to right over the 3 s (soundboard spec §3.3). */
@keyframes sb-sweep {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/sound --root packages/frontend` → PASS. `npm run typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/sound/Popover.tsx packages/frontend/src/sound/MixerControl.tsx packages/frontend/src/sound/SoundboardControl.tsx packages/frontend/src/sound/controls.test.tsx packages/frontend/src/index.css
git commit -m "feat(sound): mixer and soundboard popovers"
```

---

### Task 8: Wire it all into `TableStage`

**Files:**
- Modify: `packages/frontend/src/three/TableStage.tsx`
- Test: `packages/frontend/src/three/TableStage.test.tsx` (new)

**Interfaces:**
- Consumes: Task 3 `readMix`, `writeMix`, `Mix`; Task 4 `SoundStage`; Task 5 `SocketContext` (`sendSoundboard`, `onSoundboard`); Task 6 `useClipBadges`, `ClipBadgeContext`; Task 7 `MixerControl`, `SoundboardControl`.
- Produces: the top-left cluster `Flat view · Quality · Sound ▾ · Soundboard · {controls}`. The Soundboard chip shows only when a `SocketContext` is present (not in the dev harness) and the clip list is non-empty. `TableStage` reads the context with `useContext(SocketContext)` (nullable), not `useSocket()`, so tests and the dev harness work without a provider.

- [ ] **Step 1: Write the failing tests** — `packages/frontend/src/three/TableStage.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundboardBroadcast } from '@poker-blackjack/server/src/protocol';
import { SOUNDBOARD_CLIPS } from '@poker-blackjack/server/src/soundboardClips';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { PlayerList } from '../hud/PlayerList';
import type { HudRow } from '../hud/hudModel';
import { MIX_KEY } from './engine/mixer';

vi.mock('./engine/SceneRoot', () => ({
  SceneRoot: class {
    apply = vi.fn();
    applyQuality = vi.fn();
    dispose = vi.fn();
    setSize = vi.fn();
    onFrame = null;
  },
}));

const played: string[] = [];
const mixes: unknown[] = [];
vi.mock('./engine/audio', () => ({
  SoundStage: class {
    unlocked = false;
    unlock = vi.fn(async () => {
      this.unlocked = true;
    });
    setMix = vi.fn((m: unknown) => mixes.push(m));
    loadClips = vi.fn(async () => new Set([SOUNDBOARD_CLIPS[0].id]));
    playClip = vi.fn((id: string) => {
      played.push(id);
      return true;
    });
    dispose = vi.fn();
  },
}));

import { TableStage } from './TableStage';
import { buildSceneModel } from './sceneModel';

const A = SOUNDBOARD_CLIPS[0];
let listener: ((p: SoundboardBroadcast) => void) | null = null;

function socketValue(): SocketContextValue {
  return {
    sendSoundboard: vi.fn(),
    onSoundboard: vi.fn((l: (p: SoundboardBroadcast) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
  } as unknown as SocketContextValue;
}

const row: HudRow = {
  seatIndex: 0, name: 'alice', balance: 1000, isMe: true, isActive: false, dimmed: false, won: false,
  bet: null, badges: [], status: 'waiting', tone: 'plain', handName: null, groups: [],
};

function stage(socket: SocketContextValue | null) {
  const ui = (
    <TableStage
      model={buildSceneModel({ seats: [], activeSeatIndex: null, mySeatIndex: null, blackjackRounds: null })}
      seats={[]}
      mySeatIndex={0}
      connectionStatus="at-table"
      handInProgress={false}
      onReady={vi.fn()}
      onLeave={vi.fn()}
      onSwitchTo2D={vi.fn()}
      onUnsupported={vi.fn()}
      summary={null}
      hud={<PlayerList rows={[row]} clockSeconds={null} />}
    />
  );
  return render(socket ? <SocketContext.Provider value={socket}>{ui}</SocketContext.Provider> : ui);
}

describe('TableStage sound wiring (soundboard spec §3)', () => {
  beforeEach(() => {
    localStorage.clear();
    played.length = 0;
    mixes.length = 0;
    listener = null;
  });

  it('replaces the on/off chip with the mixer and the soundboard', () => {
    stage(socketValue());
    expect(screen.queryByRole('button', { name: /sound: (on|off)/i })).toBeNull();
    expect(screen.getByRole('button', { name: /sound ▾/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soundboard' })).toBeInTheDocument();
  });

  it('has no soundboard without a socket (dev harness)', () => {
    stage(null);
    expect(screen.queryByRole('button', { name: 'Soundboard' })).toBeNull();
  });

  it('keeps only one popover open at a time', async () => {
    stage(socketValue());
    await userEvent.click(screen.getByRole('button', { name: /sound ▾/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Soundboard' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Soundboard' })).toBeInTheDocument();
  });

  it('fires a clip through the socket', async () => {
    const socket = socketValue();
    stage(socket);
    await userEvent.click(screen.getByRole('button', { name: 'Soundboard' }));
    const tile = screen.getByRole('button', { name: `${A.emoji} ${A.label}` });
    // Enabled once the (mocked) clip bank has loaded.
    await waitFor(() => expect(tile).toBeEnabled());
    await userEvent.click(tile);
    expect(socket.sendSoundboard).toHaveBeenCalledWith(A.id);
  });

  it('plays a broadcast clip and badges the sender', () => {
    stage(socketValue());
    act(() => listener?.({ clipId: A.id, seatIndex: 0, displayName: 'alice' }));
    expect(played).toEqual([A.id]);
    expect(screen.getByTestId('hud-clip-badge-0')).toHaveTextContent(A.label);
  });

  it('persists mixer changes and pushes them to the engine', async () => {
    stage(socketValue());
    await userEvent.click(screen.getByRole('button', { name: /sound ▾/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Mute Master' }));
    expect(JSON.parse(localStorage.getItem(MIX_KEY) as string).master.muted).toBe(true);
    expect(mixes.at(-1)).toMatchObject({ master: { muted: true } });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/three/TableStage.test.tsx --root packages/frontend` → FAIL ("Sound: off" still rendered, no Soundboard chip).

- [ ] **Step 3: Rewrite the sound parts of `TableStage.tsx`.**

Imports: replace `useEffect, useRef, useState, type ReactNode` with `useContext, useEffect, useRef, useState, type ReactNode`; add

```tsx
import { SOUNDBOARD_CLIPS } from '@poker-blackjack/server/src/soundboardClips';
import { SocketContext } from '../socket/SocketContext';
import { readMix, writeMix, type Mix } from './engine/mixer';
import { MixerControl } from '../sound/MixerControl';
import { SoundboardControl } from '../sound/SoundboardControl';
import { ClipBadgeContext, useClipBadges } from '../sound/clipBadges';
import { CHIP } from '../sound/Popover';
```

Delete `const SOUND_KEY = 'bj3d.sound';`, the `soundOn` state, the `arm` block in the mount effect, and the whole `toggleSound` function (and the Task 4 bridge). Replace `const chip = '...'` with `const chip = CHIP;`.

New state and refs after the `quality` state:

```tsx
  const socket = useContext(SocketContext);
  const [mix, setMix] = useState<Mix>(readMix);
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const [available, setAvailable] = useState<ReadonlySet<string>>(() => new Set());
  const [popover, setPopover] = useState<'mixer' | 'soundboard' | null>(null);
  const { badges, show: showBadge } = useClipBadges();
```

In the mount effect, replace `const sound = new SoundStage();` with:

```tsx
    const sound = new SoundStage({ mix: mixRef.current });
    let unmounted = false;
    void sound.loadClips(SOUNDBOARD_CLIPS).then((ids) => {
      if (!unmounted) setAvailable(ids);
    });
    // Browsers block audio until a gesture: the first press or key anywhere unlocks it (spec §3.1).
    const unlock = () => {
      void sound.unlock().catch(() => undefined);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
```

and the cleanup becomes:

```tsx
    return () => {
      unmounted = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      ro.disconnect();
      scene.dispose();
      sound.dispose();
      sceneRef.current = null;
      soundRef.current = null;
    };
```

Note: the `catch` path where `new SceneRoot` throws returns before these listeners are added; move the `SoundStage` creation and the listener setup to *after* the `try { scene = new SceneRoot(...) }` block is not possible because `SceneRoot` takes `sound`. Instead, in that `catch`, call `sound.dispose()` before `unsupportedRef.current(); return;` and add the listeners after the try/catch.

New effects after the quality effect:

```tsx
  // Clips from the server: play (if this player can hear them) and badge the sender (spec §2.5, S7).
  const onSoundboard = socket?.onSoundboard;
  useEffect(() => {
    if (!onSoundboard) return;
    return onSoundboard((p) => {
      soundRef.current?.playClip(p.clipId);
      showBadge(p);
    });
  }, [onSoundboard, showBadge]);

  function changeMix(next: Mix) {
    setMix(next);
    writeMix(next);
    soundRef.current?.setMix(next);
  }

  const toggle = (which: 'mixer' | 'soundboard') => setPopover((p) => (p === which ? null : which));
  const closePopover = () => setPopover(null);
```

Wrap the HUD: replace `{hud}` with `<ClipBadgeContext.Provider value={badges}>{hud}</ClipBadgeContext.Provider>`.

In the top-left cluster, replace the old `<button ... onClick={toggleSound} ...>Sound: ...</button>` with:

```tsx
        <MixerControl
          mix={mix}
          onChange={changeMix}
          open={popover === 'mixer'}
          onToggle={() => toggle('mixer')}
          onClose={closePopover}
        />
        {socket && (
          <SoundboardControl
            clips={SOUNDBOARD_CLIPS}
            available={available}
            mix={mix}
            onFire={socket.sendSoundboard}
            open={popover === 'soundboard'}
            onToggle={() => toggle('soundboard')}
            onClose={closePopover}
          />
        )}
```

Note on "one popover at a time": clicking the second trigger fires the first popover's outside-press `onClose` (pointerdown) and then the second trigger's `onToggle` (click), leaving only the second open — what the test asserts.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/three --root packages/frontend` (TableStage, Blackjack3D, Poker3D tests) → PASS. `npm test` and `npm run typecheck` → PASS. `grep -rn "bj3d.sound\|enable()\|startPiano" packages/frontend/src` → only `mixer.ts`'s `LEGACY_SOUND_KEY` and its test.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/three/TableStage.tsx packages/frontend/src/three/TableStage.test.tsx
git commit -m "feat(soundboard): mixer and soundboard in the table's top-left cluster"
```

---

### Task 9: Manual check, listening pass and docs (controller + user)

Not an implementer task. The automated tests cannot judge balance, and the existing audio has never had a listening pass (spec §5).

- [ ] **Step 1: Two-player browser check** (delegate to a sonnet subagent that writes `.playtest-data/soundboard/browser-check.md` and returns a summary). Put two test MP3s (any short sounds the user supplies, or generated with `ffmpeg -f lavfi -i "sine=frequency=440:duration=1" packages/frontend/public/sounds/vine-boom.mp3` and the same for `bruh.mp3` at 660 Hz) in `packages/frontend/public/sounds/`. Use the isolated playtest server from `scripts/playtest/README.md` (never real balances), seat two players in two tabs, open the 3D view, and check: tiles enabled for the two files and disabled ("Clip file missing") for the rest; firing in tab 1 shows the badge on the sender's row in both tabs; every tile is disabled for 3 s; the mixer opens, Esc closes it, only one popover at a time; reload keeps the mix; `bj3d.mix` is in localStorage and `bj3d.sound` is never written; no console errors.
- [ ] **Step 2: Listening pass with the user.** Ask the user to play a hand with sound on at the default mix and fire a few clips, and to say whether murmur, card/chip effects and clips are balanced. If not, change `DEFAULT_MIX` in `mixer.ts` (and its test) or `MURMUR_GAIN` in `audio.ts` with a comment citing the listening pass, and commit `fix(sound): settle the default mix after the listening pass`.
- [ ] **Step 3: Docs.** Update `HANDOFF.md` "Next steps" (soundboard shipped; how to add a clip: `packages/frontend/public/sounds/README.md`; the listening-pass result) and the user guide if one lists the old "Sound: on/off" chip (`grep -rn "Sound: on" docs README.md`). Commit `docs: soundboard and mixer`.
- [ ] **Step 4:** One whole-branch review (top-tier model) per the review stop rule: fix only Critical/Important; Minors go to `TODO.md`. Then `superpowers:finishing-a-development-branch`.

---

## Self-review notes (written with the plan)

- Spec coverage: S1 (Task 2 broadcast test incl. sender), S2 (Task 8 chip only with a socket; flat view has no provider → no badges, Task 6 test), S3 (Task 1 gitignore + README; Task 7 disabled tile), S4 (Task 1), S5 (Task 2 cooldown + reconnect tests; Task 7 client cooldown), S6 (Task 4 stop + fade test), S7 (Task 6), S8 (Task 7), S9 (Task 7), S10 (Task 4 no-interval test), S11 (Task 3), §2.3 silent drops (Task 2), §3.1 unlock / hidden / unavailable / muted drops (Task 4), §4 badge identity (Task 6), §5 integration "two clients at one table" (Task 2's broadcast test seats two players), §5 manual (Task 9).
- Deliberate choices: `SocketContext` exposes a listener API (`onSoundboard`) rather than state, so a burst of clips is never collapsed by React batching. `TableStage` reads the context nullably so the dev harness and the 3D component tests need no provider.
</content>
</invoke>
