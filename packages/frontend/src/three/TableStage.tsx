import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';
import type { SceneModel } from './sceneModel';
import { SceneRoot, type Quality } from './engine/SceneRoot';
import { SoundStage } from './engine/audio';

// Everything the Blackjack and Hold'em 3D tables share: the canvas and scene lifecycle, the
// settings chips, the connection banners, and the HUD on top. The HUD (src/hud) is the single
// place names, results, the pot and the actions are shown (base spec §B1); the projected plates
// and labels that used to float over the table are gone.

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

export interface TableStageProps {
  model: SceneModel;
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  // Switches to the flat (2D) view; the prop keeps its old name (Plan B deviation 4).
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the flat view.
  onUnsupported: () => void;
  // Screen-reader / test surface mirroring what the 3D scene shows.
  summary: ReactNode;
  // The game's HUD in its overlay layout.
  hud: ReactNode;
  // Extra controls for the top-left cluster (Admin).
  controls?: ReactNode;
}

export function TableStage({
  model,
  connectionStatus,
  errorMessage,
  onSwitchTo2D,
  onUnsupported,
  summary,
  hud,
  controls,
}: TableStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRoot | null>(null);
  const soundRef = useRef<SoundStage | null>(null);

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
    scene.apply(modelRef.current);
    let arm: (() => void) | null = null;
    if (readPref(SOUND_KEY, ['on', 'off'], 'off') === 'on') {
      // Browsers block audio until a gesture, so a stored "on" only takes effect after a click.
      arm = () => {
        void sound.enable().then(
          () => setSoundOn(sound.enabled),
          () => undefined,
        );
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
      try {
        await sound.enable();
      } catch {
        return; // the browser refused to start audio; stay off
      }
      setSoundOn(sound.enabled);
      if (sound.enabled) writePref(SOUND_KEY, 'on');
    }
  }

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

      {!model.hasRound && (
        <div
          className="absolute left-1/2 top-[38%] -translate-x-1/2 rounded-md border border-wood-grain bg-surface px-4 py-2 font-utility text-sm text-fg-dim"
          style={{ textShadow: GLOW }}
        >
          Waiting for hand to start…
        </div>
      )}

      {hud}

      <div className="absolute left-3 top-3 z-40 flex flex-wrap items-start gap-2">
        <button type="button" className={chip} onClick={onSwitchTo2D}>
          Flat view
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
        {controls}
      </div>

      <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
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
    </div>
  );
}
