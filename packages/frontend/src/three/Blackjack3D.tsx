import { useEffect, useMemo, useRef, useState } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, Card } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from '../components/Button';
import { buildSceneModel, TABLE_Y } from './sceneModel';
import { SceneRoot, type Quality } from './engine/SceneRoot';
import { SoundStage } from './engine/audio';

export interface Blackjack3DProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  onAction: (action: PlayerAction) => void;
  onSwitchTo2D: () => void;
  // Called if WebGL can't start, so the parent can fall back to the 2D table.
  onUnsupported: () => void;
}

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

function describeCard(c: Card | null): string {
  return c ? `${c.rank} of ${c.suit}` : 'face-down card';
}

const GLOW = '0 -2px 10px rgba(255,170,80,0.45), 0 1px 2px rgba(0,0,0,0.9)';

// Brighter than the 2D palette: these sit directly on dark green felt.
const POLARITY_COLOR = {
  win: '#c9e59a',
  lose: '#f0866a',
  push: '#e8d9b5',
} as const;

export function Blackjack3D({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  blackjackRounds,
  onAction,
  onSwitchTo2D,
  onUnsupported,
}: Blackjack3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRoot | null>(null);
  const soundRef = useRef<SoundStage | null>(null);
  const plateEls = useRef(new Map<string, HTMLElement>());
  const anchors = useRef(new Map<string, { x: number; y: number; z: number }>());

  const [quality, setQuality] = useState<Quality>(() => readPref<Quality>(QUALITY_KEY, ['low', 'medium', 'high'], 'medium'));
  const [soundOn, setSoundOn] = useState(false);

  const model = useMemo(
    () => buildSceneModel({ seats, activeSeatIndex, mySeatIndex, blackjackRounds }),
    [seats, activeSeatIndex, mySeatIndex, blackjackRounds],
  );
  const modelRef = useRef(model);
  modelRef.current = model;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  // Screen-space anchors for the HTML plates: rebuilt whenever the model changes,
  // read every frame by the projection loop (no React re-render per frame).
  useEffect(() => {
    const a = anchors.current;
    a.clear();
    for (const s of model.seats) if (!s.isMe) a.set(`plate:${s.seatIndex}`, { x: s.plateX, y: TABLE_Y + 0.07, z: s.plateZ });
    for (const o of model.outcomes) a.set(o.key, { x: o.x, y: TABLE_Y + 0.1, z: o.z });
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
      onUnsupported();
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
    if (readPref(SOUND_KEY, ['on', 'off'], 'off') === 'on') {
      // Browsers block audio until a gesture, so a stored "on" only takes effect after a click.
      const arm = () => {
        void sound.enable().then(() => setSoundOn(sound.enabled));
        window.removeEventListener('pointerdown', arm);
      };
      window.addEventListener('pointerdown', arm);
    }
    return () => {
      ro.disconnect();
      scene.dispose();
      sound.dispose();
      sceneRef.current = null;
    };
    // The scene is created once; later prop changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const mySeat = mySeatIndex !== null ? (seats.find((s) => s.seatIndex === mySeatIndex) ?? null) : null;
  const myModel = model.seats.find((s) => s.isMe);
  const dealerRound = blackjackRounds ? Object.values(blackjackRounds)[0] : undefined;
  const dealerText = dealerRound
    ? (dealerRound.dealerCards ?? [dealerRound.dealerUpcard, null]).map(describeCard).join(', ')
    : 'no hand in progress';

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

      {/* Screen-reader / test surface mirroring what the 3D scene shows. */}
      <div className="sr-only" role="status" aria-live="polite">
        <p data-testid="dealer-hand">Dealer: {dealerText}</p>
        {model.seats.map((s) => {
          const round = blackjackRounds?.[s.seatIndex];
          return (
            <p key={s.seatIndex} data-testid={`player-${s.seatIndex}`} data-active={s.isActive ? 'true' : 'false'}>
              {s.name}, balance {s.balance}, {s.status}.
              {round?.playerHands.map((h, i) => (
                <span key={i}>
                  {' '}
                  Hand {i + 1}: {h.cards.map(describeCard).join(', ')}; bet {h.bet}.
                </span>
              ))}
            </p>
          );
        })}
        {model.outcomes.map((o) => (
          <p key={o.key} data-testid={`hand-result-${o.seatIndex}`} data-outcome={o.polarity}>
            {o.text}
          </p>
        ))}
      </div>

      {/* Brass name plates for the other players, projected from the 3D rail. */}
      {model.seats
        .filter((s) => !s.isMe)
        .map((s) => (
          <div
            key={s.seatIndex}
            ref={(el) => {
              const k = `plate:${s.seatIndex}`;
              if (el) plateEls.current.set(k, el);
              else plateEls.current.delete(k);
            }}
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 top-0 flex flex-col items-center rounded border px-3 py-1 text-center ${
              s.isActive ? 'border-brass-bright' : 'border-wood-grain'
            }`}
            style={{
              visibility: 'hidden',
              background: 'linear-gradient(to top, rgba(40,26,14,0.92), rgba(20,13,8,0.85))',
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
          ref={(el) => {
            if (el) plateEls.current.set(o.key, el);
            else plateEls.current.delete(o.key);
          }}
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
        {model.myTurn && (
          <div className="flex gap-2">
            <Button variant="neutral" size="md" onClick={() => onAction('hit')}>
              Hit
            </Button>
            <Button variant="neutral" size="md" onClick={() => onAction('stand')}>
              Stand
            </Button>
            <Button variant="primary" size="md" onClick={() => onAction('double')}>
              Double
            </Button>
            <Button variant="danger" size="md" onClick={() => onAction('split')}>
              Split
            </Button>
          </div>
        )}
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
          className="absolute bottom-4 left-4 flex flex-col rounded border border-wood-grain px-3 py-1.5"
          style={{ background: 'linear-gradient(to top, rgba(40,26,14,0.92), rgba(20,13,8,0.85))' }}
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

export default Blackjack3D;
