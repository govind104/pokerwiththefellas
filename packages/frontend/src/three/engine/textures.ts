import * as THREE from 'three';
import type { Card, Rank } from '@poker-blackjack/game-engine';

// Every texture is generated on a canvas at startup (seeded, so it looks the
// same every run). No image downloads except the vendored MIT card-face SVGs.

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, opts: { repeat?: [number, number]; srgb?: boolean } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, r: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export function woodTexture(base = '#4a2f1c', seed = 7, repeat: [number, number] = [2, 2]): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 1024);
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 520; i++) {
    const x = r() * 1024;
    const w = 1 + r() * 5;
    const dark = r() < 0.6;
    ctx.fillStyle = dark ? `rgba(20,10,4,${0.05 + r() * 0.16})` : `rgba(170,110,60,${0.04 + r() * 0.1})`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    const wob = (r() - 0.5) * 30;
    ctx.bezierCurveTo(x + wob, 340, x - wob, 680, x + wob * 0.4, 1024);
    ctx.lineTo(x + w, 1024);
    ctx.bezierCurveTo(x - wob + w, 680, x + wob + w, 340, x + w, 0);
    ctx.fill();
  }
  for (let i = 0; i < 5; i++) {
    const kx = r() * 1024;
    const ky = r() * 1024;
    for (let k = 1; k < 7; k++) {
      ctx.strokeStyle = `rgba(25,12,5,${0.16 - k * 0.02})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 6 + k * 5, 14 + k * 11, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  noise(ctx, 1024, 1024, 14, r);
  return tex(c, { repeat });
}

export function feltTexture(seed = 3): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const r = rng(seed);
  ctx.fillStyle = '#1b3b2c';
  ctx.fillRect(0, 0, 512, 512);
  noise(ctx, 512, 512, 30, r);
  for (let i = 0; i < 1400; i++) {
    ctx.strokeStyle = r() < 0.5 ? 'rgba(10,25,15,0.12)' : 'rgba(120,160,120,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x = r() * 512;
    const y = r() * 512;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 14);
    ctx.stroke();
  }
  // Worn patches and a few stains near where hands rest.
  for (let i = 0; i < 14; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 40 + r() * 90;
    const dark = r() < 0.5;
    // Drawn at every wrapped offset so a stain near the canvas edge continues on the
    // opposite side; otherwise the tiled felt shows a hard seam line.
    for (const ox of [-512, 0, 512]) {
      for (const oy of [-512, 0, 512]) {
        const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grad.addColorStop(0, dark ? 'rgba(15,20,10,0.22)' : 'rgba(150,170,120,0.08)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  return tex(c, { repeat: [3, 2] });
}

export function plankTexture(seed = 11, tint = '#3a2616'): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 1024);
  const r = rng(seed);
  const planks = 8;
  const pw = 1024 / planks;
  for (let p = 0; p < planks; p++) {
    const shade = 0.7 + r() * 0.5;
    ctx.fillStyle = tint;
    ctx.fillRect(p * pw, 0, pw, 1024);
    ctx.fillStyle = `rgba(${Math.floor(90 * shade)},${Math.floor(56 * shade)},${Math.floor(30 * shade)},0.55)`;
    ctx.fillRect(p * pw, 0, pw, 1024);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(15,8,3,${0.05 + r() * 0.12})`;
      ctx.lineWidth = 1 + r() * 2;
      const x = p * pw + r() * pw;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (r() - 0.5) * 12, 300, x + (r() - 0.5) * 12, 700, x + (r() - 0.5) * 6, 1024);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(p * pw, 0, 3, 1024);
    for (let j = 0; j < 2; j++) {
      const ny = r() * 1024;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p * pw + 12, ny, 4, 4);
      ctx.fillRect(p * pw + pw - 16, ny, 4, 4);
    }
  }
  noise(ctx, 1024, 1024, 18, r);
  return tex(c, { repeat: [2, 1] });
}

export const CARD_TEX_W = 256;
export const CARD_TEX_H = 358;

function roundRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number) {
  ctx.beginPath();
  ctx.moveTo(rad, 0);
  ctx.arcTo(w, 0, w, h, rad);
  ctx.arcTo(w, h, 0, h, rad);
  ctx.arcTo(0, h, 0, 0, rad);
  ctx.arcTo(0, 0, w, 0, rad);
  ctx.closePath();
}

// Foxing, thumb-grime and edge wear -- shared by faces and backs.
function age(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number) {
  for (let i = 0; i < 9; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 14 + r() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(90,60,25,${0.05 + r() * 0.1})`);
    g.addColorStop(1, 'rgba(90,60,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const edge = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.68);
  edge.addColorStop(0, 'rgba(60,35,10,0)');
  edge.addColorStop(1, 'rgba(60,35,10,0.42)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(40,22,8,0.55)';
  ctx.lineWidth = 3;
  roundRectPath(ctx, w, h, 14);
  ctx.stroke();
}

export function cardBackTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(CARD_TEX_W, CARD_TEX_H);
  const r = rng(99);
  const w = CARD_TEX_W;
  const h = CARD_TEX_H;
  ctx.save();
  roundRectPath(ctx, w, h, 14);
  ctx.clip();
  ctx.fillStyle = '#e2d3ac';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5c1d18';
  ctx.fillRect(14, 14, w - 28, h - 28);
  ctx.strokeStyle = 'rgba(226,205,150,0.55)';
  ctx.lineWidth = 1.5;
  for (let i = -h; i < w + h; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 14);
    ctx.lineTo(i + h, h - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + h, 14);
    ctx.lineTo(i, h - 14);
    ctx.stroke();
  }
  ctx.strokeStyle = '#d9c28a';
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.fillStyle = '#5c1d18';
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, 42, 58, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d9c28a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#d9c28a';
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2 - 30);
  ctx.lineTo(w / 2 + 20, h / 2);
  ctx.lineTo(w / 2, h / 2 + 30);
  ctx.lineTo(w / 2 - 20, h / 2);
  ctx.closePath();
  ctx.fill();
  age(ctx, w, h, r);
  ctx.restore();
  return tex(c);
}

const RANK_FILE: Record<Rank, string> = {
  A: 'ace',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
};

function faceUrl(card: Card): string {
  return new URL(`../../assets/cards/${RANK_FILE[card.rank]}_of_${card.suit}.svg`, import.meta.url).href;
}

const faceCache = new Map<string, THREE.CanvasTexture>();

// Returns immediately with a blank aged card; the SVG is composited onto it
// (multiplied, so the white becomes parchment) as soon as it has loaded.
export function cardFaceTexture(card: Card, onLoaded?: () => void): THREE.CanvasTexture {
  const id = `${card.rank}-${card.suit}`;
  const cached = faceCache.get(id);
  if (cached) return cached;

  const [c, ctx] = canvas(CARD_TEX_W, CARD_TEX_H);
  const seed = id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const paint = (img?: HTMLImageElement) => {
    ctx.clearRect(0, 0, CARD_TEX_W, CARD_TEX_H);
    ctx.save();
    roundRectPath(ctx, CARD_TEX_W, CARD_TEX_H, 14);
    ctx.clip();
    ctx.fillStyle = '#e4d5ad';
    ctx.fillRect(0, 0, CARD_TEX_W, CARD_TEX_H);
    if (img) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(img, 6, 6, CARD_TEX_W - 12, CARD_TEX_H - 12);
      ctx.globalCompositeOperation = 'source-over';
    }
    age(ctx, CARD_TEX_W, CARD_TEX_H, rng(seed));
    ctx.restore();
  };
  paint();
  const t = tex(c);
  faceCache.set(id, t);

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    paint(img);
    t.needsUpdate = true;
    onLoaded?.();
  };
  img.src = faceUrl(card);
  return t;
}

export function chipSideTexture(main: string, stripe: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 32);
  ctx.fillStyle = main;
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = stripe;
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 32 + 4, 0, 16, 32);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, 256, 3);
  ctx.fillRect(0, 29, 256, 3);
  return tex(c, { repeat: [1, 1] });
}

export function chipTopTexture(main: string, stripe: string, label: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = main;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = stripe;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = stripe;
  ctx.font = 'bold 34px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 66);
  return tex(c);
}

export function softDotTexture(inner = 'rgba(255,220,160,1)'): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(255,200,120,0.35)');
  g.addColorStop(1, 'rgba(255,190,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return tex(c);
}
