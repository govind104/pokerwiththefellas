export type Ease = (t: number) => number;

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export interface TweenSpec {
  duration: number; // seconds
  delay?: number;
  ease?: Ease;
  onStart?: () => void;
  onUpdate: (t: number) => void;
  onDone?: () => void;
}

export interface TweenHandle {
  cancel: () => void;
}

interface Active {
  spec: TweenSpec;
  elapsed: number;
  started: boolean;
  dead: boolean;
}

// Minimal fixed-purpose tween runner. `instant` collapses every duration and
// delay (used for prefers-reduced-motion) while still calling each callback,
// so end states are identical with and without animation.
export class Tweens {
  private list: Active[] = [];
  instant = false;

  add(spec: TweenSpec): TweenHandle {
    const a: Active = { spec, elapsed: -(this.instant ? 0 : (spec.delay ?? 0)), started: false, dead: false };
    this.list.push(a);
    return {
      cancel: () => {
        a.dead = true;
      },
    };
  }

  update(dt: number): void {
    if (this.list.length === 0) return;
    for (const a of this.list) {
      if (a.dead) continue;
      a.elapsed += dt;
      if (a.elapsed < 0) continue;
      if (!a.started) {
        a.started = true;
        a.spec.onStart?.();
      }
      const dur = this.instant ? 0 : a.spec.duration;
      const p = dur <= 0 ? 1 : Math.min(1, a.elapsed / dur);
      a.spec.onUpdate((a.spec.ease ?? easeOutCubic)(p));
      if (p >= 1) {
        a.dead = true;
        a.spec.onDone?.();
      }
    }
    this.list = this.list.filter((a) => !a.dead);
  }

  clear(): void {
    this.list = [];
  }
}
