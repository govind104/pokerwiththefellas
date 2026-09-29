import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from '../components/Button';
import { TABLE_Y, type SceneModel } from './sceneModel';
import { SceneRoot, type Quality } from './engine/SceneRoot';
import { SoundStage } from './engine/audio';

// Everything the Blackjack and Hold'em 3D tables share: the canvas and scene
// lifecycle, projected name plates / result labels, the settings chips, the
// connection banners and Ready / Leave. Each game supplies only its model, an
// accessible text summary, and its own action buttons (children).

const QUALITY_KEY = 'bj3d.quality';
const SOUND_KEY = 'bj3d.sound';

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference just won't persist */
  }
}

const GLOW = '0 -2px 10px rgba(255,170,80,0.45), 0 1px 2px rgba(0,0,0,0.9)';

// Brighter than the 2D palette: these sit directly on dark green felt.
const POLARITY_COLOR = {
  win: '#c9e59a',
  lose: '#f0866a',
  push: '#e8d9b5',
} as const;

const PLATE_BG = 'linear-gradient(to top, rgba(40,26,14,0.92), rgba(20,13,8,0.85))';

export interface TableStageProps {
  model: SceneModel;
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the 2D table.
  onUnsupported: () => void;
  // Screen-reader / test surface mirroring what the 3D scene shows.
  summary: ReactNode;
  // The game's own action buttons, shown bottom-centre.
  children?: ReactNode;
}

export function TableStage({
  model,
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  onSwitchTo2D,
  onUnsupported,
  summary,
  children,
}: TableStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRoot | null>(null);
  const soundRef = useRef<SoundStage | null>(null);
  const plateEls = useRef(new Map<string, HTMLElement>());
  const anchors = useRef(new Map<string, { x: number; y: number; z: number }>());

  const [quality, setQuality] = useState<Quality>(() =>
    readPref<Quality>(QUALITY_KEY, ['low', 'medium', 'high'], 'medium'),
  );
  const [soundOn, setSoundOn] = useState(false);

  const modelRef = useRef(model);
  modelRef.current = model;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const unsupportedRef = useRef(onUnsupported);
  unsupportedRef.current = onUnsupported;

  // Screen-space anchors for the HTML plates: rebuilt whenever the model changes,
  // read every frame by the projection loop (no React re-render per frame).
  useEffect(() => {
    const a = anchors.current;
    a.clear();
    for (const s of model.seats) if (!s.isMe) a.set(`plate:${s.seatIndex}`, { x: s.plateX, y: TABLE_Y + 0.07, z: s.plateZ });
    for (const o of model.outcomes) a.set(o.key, { x: o.x, y: TABLE_Y + 0.1, z: o.z });
    if (model.pot) a.set('pot', { x: model.pot.x, y: TABLE_Y + 0.13, z: model.pot.z });
  }, [model]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const sound = new SoundStage();
    soundRef.current = sound;
    let scene: SceneRoot;
    try {
      scene = new SceneRoot({
        canvas,
        quality: qualityRef.current,
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        sound,
      });
    } catch {
      unsupportedRef.current();
      return;
    }
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __bj3d?: SceneRoot }).__bj3d = scene;
    const resize = () => scene.setSize(wrap.clientWidth, wrap.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    scene.onFrame = (project) => {
      for (const [key, el] of plateEls.current) {
        const a = anchors.current.get(key);
        if (!a) continue;
        const p = project(a.x, a.y, a.z);
        // Keep plates on screen even when their seat is around the edge of the view.
        const x = Math.min(Math.max(p.x, 70), Math.max(70, wrap.clientWidth - 70));
        const y = Math.min(Math.max(p.y, 40), Math.max(40, wrap.clientHeight - 40));
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.visibility = p.visible ? 'visible' : 'hidden';
      }
    };
    scene.apply(modelRef.current);
    let arm: (() => void) | null = null;
    if (readPref(SOUND_KEY, ['on', 'off'], 'off') === 'on') {
      // Browsers block audio until a gesture, so a stored "on" only takes effect after a click.
      arm = () => {
        void sound.enable().then(() => setSoundOn(sound.enabled));
        window.removeEventListener('pointerdown', arm as () => void);
      };
      window.addEventListener('pointerdown', arm);
    }
    return () => {
      if (arm) window.removeEventListener('pointerdown', arm);
      ro.disconnect();
      scene.dispose();
      sound.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.apply(model);
  }, [model]);

  useEffect(() => {
    sceneRef.current?.applyQuality(quality);
    writePref(QUALITY_KEY, quality);
  }, [quality]);

  async function toggleSound() {
    const sound = soundRef.current;
    if (!sound) return;
    if (sound.enabled) {
      sound.disable();
      setSoundOn(false);
      writePref(SOUND_KEY, 'off');
    } else {
      await sound.enable();
      setSoundOn(sound.enabled);
      writePref(SOUND_KEY, 'on');
    }
  }

  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) plateEls.current.set(key, el);
    else plateEls.current.delete(key);
  };

  const mySeat = mySeatIndex !== null ? (seats.find((s) => s.seatIndex === mySeatIndex) ?? null) : null;
  const myModel = model.seats.find((s) => s.isMe);
  const chip = 'rounded-md border border-wood-grain bg-surface px-2 py-1 font-utility text-xs text-parchment';

  return (
    <div ref={wrapRef} className="relative h-screen w-screen overflow-hidden bg-black font-body text-fg">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {quality === 'low' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.75) 100%)' }}
        />
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {summary}
      </div>

      {/* Brass name plates for the other players, projected from the 3D rail. */}
      {model.seats
        .filter((s) => !s.isMe)
        .map((s) => (
          <div
            key={s.seatIndex}
            ref={register(`plate:${s.seatIndex}`)}
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 top-0 flex flex-col items-center rounded border px-3 py-1 text-center ${
              s.isActive ? 'border-brass-bright' : 'border-wood-grain'
            }`}
            style={{
              visibility: 'hidden',
              background: PLATE_BG,
              boxShadow: s.isActive ? '0 0 16px 3px rgba(221,177,92,0.5)' : '0 2px 8px rgba(0,0,0,0.6)',
            }}
          >
            <span className="font-utility text-sm text-parchment" style={{ textShadow: GLOW }}>
              {s.name} &middot; {s.balance}
            </span>
            <span
              className={`font-body text-xs ${!s.connected ? 'text-ember-text' : s.isActive ? 'text-brass-bright' : 'text-fg-dim'}`}
            >
              {s.status}
            </span>
          </div>
        ))}

      {model.outcomes.map((o) => (
        <div
          key={o.key}
          ref={register(o.key)}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 font-display text-3xl"
          style={{
            visibility: 'hidden',
            color: POLARITY_COLOR[o.polarity],
            textShadow: '0 2px 10px rgba(0,0,0,0.95), 0 0 14px rgba(255,170,80,0.35)',
          }}
        >
          {o.text}
        </div>
      ))}

      {model.pot && (
        <div
          ref={register('pot')}
          aria-hidden="true"
          data-testid="pot"
          className="pointer-events-none absolute left-0 top-0 rounded border border-wood-grain px-2 py-0.5 font-utility text-sm text-brass-bright"
          style={{ visibility: 'hidden', background: PLATE_BG, textShadow: GLOW }}
        >
          Pot: {model.pot.amount}
        </div>
      )}

      <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <button type="button" className={chip} onClick={onSwitchTo2D}>
          2D view
        </button>
        <label className={`${chip} flex items-center gap-1`}>
          Quality
          <select
            aria-label="Graphics quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as Quality)}
            className="bg-surface text-parchment"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <button type="button" className={chip} onClick={toggleSound} aria-pressed={soundOn}>
          Sound: {soundOn ? 'on' : 'off'}
        </button>
      </div>

      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2">
        {connectionStatus === 'reconnecting' && (
          <div role="status" className="rounded-md bg-amber-600 px-4 py-2 font-medium">
            Reconnecting…
          </div>
        )}
        {errorMessage && (
          <div role="alert" className="rounded-md bg-red-600 px-4 py-2 font-medium">
            {errorMessage}
          </div>
        )}
      </div>

      {!model.hasRound && (
        <div
          className="absolute left-1/2 top-[38%] -translate-x-1/2 rounded-md border border-wood-grain bg-surface px-4 py-2 font-utility text-sm text-fg-dim"
          style={{ textShadow: GLOW }}
        >
          Waiting for hand to start…
        </div>
      )}

      <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
        {children}
        {mySeat && !handInProgress && !mySeat.ready && (
          <Button variant="primary" size="md" onClick={onReady} className="font-medium">
            Ready
          </Button>
        )}
        {!handInProgress && (
          <button onClick={onLeave} className="text-sm text-fg-dim underline hover:text-parchment">
            Leave table
          </button>
        )}
      </div>

      {myModel && (
        <div
          className="absolute bottom-32 left-4 flex flex-col rounded border border-wood-grain px-3 py-1.5 sm:bottom-4"
          style={{ background: PLATE_BG }}
        >
          <span className="font-utility text-sm text-parchment" style={{ textShadow: GLOW }}>
            {myModel.name} &middot; {myModel.balance}
          </span>
          <span className={`text-xs ${myModel.isActive ? 'text-brass-bright' : 'text-fg-dim'}`}>{myModel.status}</span>
        </div>
      )}
    </div>
  );
}
