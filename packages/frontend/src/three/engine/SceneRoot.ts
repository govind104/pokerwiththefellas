import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { TABLE_Y, type SceneModel } from '../sceneModel';
import { fitCamera } from '../cameraFit';
import { CardObject } from './cards';
import { ChipStackObject } from './chips';
import { Room } from './room';
import { SoundStage } from './audio';
import { Tweens, easeInOutCubic } from './tween';

export type Quality = 'low' | 'medium' | 'high';

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface SceneRootOptions {
  canvas: HTMLCanvasElement;
  quality: Quality;
  reducedMotion: boolean;
  sound: SoundStage;
}

// Warm, slightly crushed film look, applied after tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 }, grain: { value: 0.055 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float dist = length(d);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d * 0.0025 * dist * 4.0).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d * 0.0025 * dist * 4.0).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.8);
      col = pow(col, vec3(1.08));
      col *= vec3(1.05, 1.0, 0.92);
      col += (1.0 - smoothstep(0.0, 0.3, l)) * vec3(-0.004, 0.010, 0.016);
      float v = smoothstep(0.92, 0.22, dist * 1.3);
      col *= mix(0.28, 1.0, v);
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(time) * 100.0) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// Where cards are dealt from and swept to. Nothing is drawn at these points: the Blackjack shoe and
// discard tray were removed as clutter at Gate 1 (plan A deviation 8), so Blackjack cards come from
// beside the dealer's right hand and go to the left. Hold'em deals from the middle and mucks far side.
const BJ_DEAL_POS = new THREE.Vector3(0.62, TABLE_Y + 0.03, -0.55);
const BJ_DISCARD_POS = new THREE.Vector3(-0.62, TABLE_Y + 0.01, -0.55);
const DECK_POS = new THREE.Vector3(0, TABLE_Y + 0.03, -0.3);
const MUCK_POS = new THREE.Vector3(0, TABLE_Y + 0.01, -0.62);

export class SceneRoot {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 30);
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private room = new Room();
  private tweens = new Tweens();
  private time = 0;
  private lastTs = 0;
  private cards = new Map<string, CardObject>();
  private sweeping = new Set<CardObject>();
  private chips = new Map<string, ChipStackObject>();
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private nextDealAt = 0;
  private tmp = new THREE.Vector3();
  private quality: Quality;
  private reducedMotion: boolean;
  private sound: SoundStage;
  onFrame: ((project: (x: number, y: number, z: number) => ScreenPoint) => void) | null = null;

  constructor(opts: SceneRootOptions) {
    this.quality = opts.quality;
    this.reducedMotion = opts.reducedMotion;
    this.sound = opts.sound;
    this.tweens.instant = opts.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x060403);
    this.scene.fog = new THREE.FogExp2(0x0a0604, 0.055);
    this.scene.add(this.room.group);

    this.applyQuality(opts.quality);
    this.raf = requestAnimationFrame(this.loop);
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const aspect = this.width / this.height;
    // A fixed three-quarter view framed to fill the screen evenly (spec §A2). The camera never
    // moves after this: no lean, sway or pointer parallax.
    const fit = fitCamera(aspect);
    this.camera.fov = fit.fov;
    this.camera.aspect = aspect;
    this.camera.position.copy(fit.position);
    this.camera.lookAt(fit.look);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
  }

  applyQuality(q: Quality): void {
    this.quality = q;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(dpr, q === 'high' ? 2 : 1.5));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.room.setQuality(q);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
      }
    });

    this.composer?.dispose();
    this.composer = null;
    this.grade = null;
    if (q !== 'low') {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (q === 'high') {
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.38, 0.6, 0.97));
      }
      composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      composer.addPass(this.grade);
      this.composer = composer;
    }
    this.setSize(this.width, this.height);
  }

  getQuality(): Quality {
    return this.quality;
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
    this.tweens.instant = v;
  }

  project = (x: number, y: number, z: number): ScreenPoint => {
    this.tmp.set(x, y, z).project(this.camera);
    return {
      x: (this.tmp.x * 0.5 + 0.5) * this.width,
      y: (-this.tmp.y * 0.5 + 0.5) * this.height,
      visible: this.tmp.z < 1 && this.tmp.z > -1,
    };
  };

  // Dev-console aid: where every card currently is.
  debugCards(): { key: string; pos: number[]; faceUp: boolean; landed: boolean; card: string | null }[] {
    return [...this.cards].map(([key, o]) => ({
      key,
      pos: o.group.position.toArray().map((n) => Math.round(n * 1000) / 1000),
      faceUp: o.faceUp,
      landed: o.landed,
      card: o.card ? `${o.card.rank}${o.card.suit[0]}` : null,
    }));
  }

  getStats(): { cards: number; chips: number } {
    return { cards: this.cards.size, chips: this.chips.size };
  }

  // Reconcile the scene against a snapshot-derived model. Idempotent: calling it
  // repeatedly with the same model changes nothing, and calling it while
  // animations are mid-flight just retargets them.
  apply(model: SceneModel): void {
    const now = this.time;
    if (this.nextDealAt < now) this.nextDealAt = now;

    const origin = model.kind === 'blackjack' ? BJ_DEAL_POS : DECK_POS;
    const sweepTo = model.kind === 'blackjack' ? BJ_DISCARD_POS : MUCK_POS;

    // Cards.
    const keep = new Set<string>();
    let sweepIdx = 0;
    for (const slot of model.cards) {
      keep.add(slot.key);
      const target = { x: slot.x, y: slot.y, z: slot.z, rotY: slot.rotY };
      let obj = this.cards.get(slot.key);
      if (
        obj &&
        obj.card &&
        (!slot.card || obj.card.rank !== slot.card.rank || obj.card.suit !== slot.card.suit)
      ) {
        // Keys repeat from one hand to the next (and a split rekeys a hand), so a slot that now
        // holds a different card -- or a face-down one -- is a new card: retire the old one and
        // deal a fresh one instead of relabelling it in place (which would show last hand's card).
        this.cards.delete(slot.key);
        this.retire(obj, sweepTo, 0.04 * sweepIdx++);
        obj = undefined;
      }
      if (!obj) {
        const created = new CardObject(this.tweens);
        obj = created;
        created.setCard(slot.card);
        created.setFaceUpImmediate(false);
        created.placeAt({ x: origin.x, y: origin.y + 0.03, z: origin.z, rotY: 0.6 });
        this.scene.add(created.group);
        this.cards.set(slot.key, created);
        const delay = this.nextDealAt - now;
        this.nextDealAt += 0.34;
        created.moveTo(target, {
          duration: 0.5,
          delay,
          arc: 0.18,
          onLand: () => {
            this.sound.cardSnap();
            if (created.card) {
              created.flip(true, 0.12, () => this.sound.cardFlip());
            }
          },
        });
      } else {
        if (slot.card && !obj.card) {
          // The dealer's hole card (or an opponent's showdown hand) is being turned over.
          obj.setCard(slot.card);
          if (obj.landed) {
            const delay = this.nextDealAt - now;
            this.nextDealAt += 0.5;
            obj.flip(true, delay, () => this.sound.cardFlip());
          }
        }
        const moved =
          Math.abs(obj.target.x - target.x) > 0.002 ||
          Math.abs(obj.target.z - target.z) > 0.002 ||
          Math.abs(obj.target.rotY - target.rotY) > 0.01;
        if (moved) obj.moveTo(target, { duration: 0.35, delay: 0, arc: 0.03 });
      }
    }
    // Cards no longer in play get swept to the discard tray.
    for (const [key, obj] of this.cards) {
      if (keep.has(key)) continue;
      this.cards.delete(key);
      this.retire(obj, sweepTo, 0.04 * sweepIdx++);
    }

    // Chip stacks.
    const keepChips = new Set<string>();
    for (const c of model.chips) {
      keepChips.add(c.key);
      let stack = this.chips.get(c.key);
      const isNew = !stack;
      if (!stack) {
        stack = new ChipStackObject(this.tweens, () => this.sound.chipClack());
        this.scene.add(stack.group);
        this.chips.set(c.key, stack);
      }
      stack.placeAt(c.x, c.z);
      stack.setAmount(c.amount, true);
      void isNew;
    }
    for (const [key, stack] of this.chips) {
      if (keepChips.has(key)) continue;
      this.chips.delete(key);
      const from = stack.group.position.clone();
      this.tweens.add({
        duration: 0.7,
        delay: 0.4,
        ease: easeInOutCubic,
        onUpdate: (p) => {
          stack.group.position.set(from.x * (1 - p), from.y, from.z + (-0.95 - from.z) * p);
        },
        onDone: () => this.scene.remove(stack.group),
      });
    }
  }

  // Sweep a card off the table; it is disposed when it lands (or on scene teardown).
  private retire(obj: CardObject, to: THREE.Vector3, delay: number): void {
    this.sweeping.add(obj);
    obj.moveTo(
      { x: to.x, y: to.y + 0.02, z: to.z, rotY: 0.2 },
      {
        duration: 0.55,
        delay,
        arc: 0.06,
        onLand: () => {
          this.sweeping.delete(obj);
          this.scene.remove(obj.group);
          obj.dispose();
        },
      },
    );
  }

  private loop = (ts: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // The dt clamp absorbs the gap when a background tab returns.
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;
    this.tick(dt, true);
  };

  // Dev/test aid: run the simulation forward without waiting on rAF (which
  // browsers throttle for panes that aren't foreground), then draw one frame.
  advance(seconds: number): void {
    const step = 1 / 30;
    for (let t = 0; t < seconds; t += step) this.tick(step, false);
    this.tick(0, true);
  }

  private tick(dt: number, draw: boolean): void {
    this.time += dt;
    const t = this.time;
    const still = this.reducedMotion;

    this.tweens.update(dt);
    this.room.update(t, still);

    if (!draw) return;
    if (this.grade) this.grade.uniforms.time.value = t;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.onFrame?.(this.project);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.tweens.clear();
    this.composer?.dispose();
    for (const c of this.cards.values()) c.dispose();
    for (const c of this.sweeping) c.dispose();
    this.sweeping.clear();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    // No forceContextLoss(): under React StrictMode the effect re-runs on the
    // same <canvas>, and a force-lost context can't be recreated there.
    this.renderer.dispose();
  }
}
