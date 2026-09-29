// All sound is synthesised in the browser (no audio files, nothing to license):
// a low room murmur, a sparse out-of-tune saloon piano, card snaps and chip clacks.

const SCALE = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66]; // A minor-ish, low
const PATTERNS = [
  [5, 3, 4, 2],
  [5, 4, 2, 0],
  [3, 5, 7, 5],
  [2, 4, 5, 3],
];

export class SoundStage {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;
  private pattern = 0;
  enabled = false;

  // Must be called from a user gesture (browser autoplay policy).
  async enable(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.7;
      this.sfx.connect(this.master);
      this.buildAmbience();
    }
    await this.ctx.resume();
    this.enabled = true;
    this.master?.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.2);
    this.startPiano();
  }

  disable(): void {
    this.enabled = false;
    if (this.ctx) this.master?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
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

  private buildAmbience(): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(6, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(lp).connect(g).connect(this.master as GainNode);
    src.start();
  }

  private startPiano(): void {
    if (this.timer !== null || !this.ctx) return;
    this.timer = window.setInterval(() => {
      if (!this.enabled || document.hidden) return;
      const pat = PATTERNS[this.pattern % PATTERNS.length];
      if (Math.random() < 0.72) this.pluck(SCALE[pat[this.step % pat.length]] * (Math.random() < 0.15 ? 2 : 1));
      this.step++;
      if (this.step % 8 === 0) this.pattern = Math.floor(Math.random() * PATTERNS.length);
    }, 620);
  }

  private pluck(freq: number): void {
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    for (const detune of [-9, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = detune + (Math.random() - 0.5) * 8;
      o.connect(lp);
      o.start(t);
      o.stop(t + 2);
    }
    lp.connect(g);
    g.connect(this.master as GainNode);
    // A single feedback echo stands in for the room.
    const d = ctx.createDelay();
    d.delayTime.value = 0.19;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    g.connect(d);
    d.connect(fb).connect(d);
    d.connect(this.master as GainNode);
  }

  private burst(freq: number, dur: number, gain: number, q = 1.2): void {
    if (!this.enabled || !this.ctx || !this.sfx) return;
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
    src.connect(bp).connect(g).connect(this.sfx);
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
    if (!this.enabled || !this.ctx || !this.sfx) return;
    this.burst(4200, 0.05, 0.5, 4);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(3100 + Math.random() * 500, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.enabled = false;
    void this.ctx?.close();
    this.ctx = null;
  }
}
