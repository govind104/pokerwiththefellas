import type { FeltPrint } from '../sceneModel';
import { BOARD_STEP, BOARD_Z, TABLE_A, TABLE_B } from '../layout';

// The printed felt (spec §A5): one canvas covering the felt ellipse's bounding box. The felt's
// ShapeGeometry UVs are its position in metres, so with repeat (1/2.4, 1/1.7) and offset (0.5, 0.5)
// the canvas pixel for world (x, z) is feltPx(x, z). 2048 x 1451 keeps pixels square.

export const FELT_TEX_W = 2048;
export const FELT_TEX_H = 1451;
const PX_PER_M = FELT_TEX_W / (2 * TABLE_A);

export const FELT_INK = 'rgba(232, 205, 140, 0.5)';
export const BET_RING_R = 0.09;
// Between the bets (0.56 of the felt) and the hole cards' inner edges (hands at 0.76): the spec's
// 0.68 would run under the cards (plan deviation 6).
export const BETTING_LINE_FACTOR = 0.61;

interface ArcLine {
  text: string;
  font: string;
  spacing: number;
  // Top of the arc, in metres; the circle's centre is `radius` nearer the players.
  z: number;
  radius: number;
}

// Between the dealer's cards and the players' cards.
export const BLACKJACK_LINES: readonly ArcLine[] = [
  { text: 'BLACKJACK PAYS 3 TO 2', font: 'bold 46px Georgia, serif', spacing: 8, z: -0.28, radius: 1.1 },
  { text: 'Dealer must stand on 17 and draw to 16', font: 'italic 30px Georgia, serif', spacing: 3, z: -0.17, radius: 1.1 },
];

export function feltPx(x: number, z: number): [number, number] {
  return [((x + TABLE_A) / (2 * TABLE_A)) * FELT_TEX_W, ((z + TABLE_B) / (2 * TABLE_B)) * FELT_TEX_H];
}

export interface FeltBase {
  image: CanvasImageSource;
  width: number;
  height: number;
  // How often the base texture repeated per metre when tiled straight onto the felt.
  repeat: [number, number];
}

export function paintFelt(ctx: CanvasRenderingContext2D, base: FeltBase, print: FeltPrint): void {
  // Today's felt as a repeating pattern, at the same scale it had on the mesh.
  const pattern = ctx.createPattern(base.image, 'repeat');
  if (pattern) {
    pattern.setTransform(new DOMMatrix().scale(PX_PER_M / base.repeat[0] / base.width, PX_PER_M / base.repeat[1] / base.height));
    ctx.fillStyle = pattern;
  } else {
    ctx.fillStyle = '#1b3b2c';
  }
  ctx.fillRect(0, 0, FELT_TEX_W, FELT_TEX_H);

  ctx.save();
  ctx.strokeStyle = FELT_INK;
  ctx.fillStyle = FELT_INK;
  ctx.lineWidth = 2.5;
  ctx.textAlign = 'center';
  if (print.kind === 'blackjack') {
    for (const line of BLACKJACK_LINES) arcText(ctx, line);
    for (const r of print.rings) {
      const [px, py] = feltPx(r.x, r.z);
      ctx.beginPath();
      ctx.arc(px, py, BET_RING_R * PX_PER_M, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const [cx, cy] = feltPx(0, 0);
    ctx.beginPath();
    ctx.ellipse(cx, cy, BETTING_LINE_FACTOR * TABLE_A * PX_PER_M, BETTING_LINE_FACTOR * TABLE_B * PX_PER_M, 0, 0, Math.PI * 2);
    ctx.stroke();
    // A box round the five board positions.
    const [x0, y0] = feltPx(-2 * BOARD_STEP - 0.1, BOARD_Z - 0.12);
    const [x1, y1] = feltPx(2 * BOARD_STEP + 0.1, BOARD_Z + 0.12);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 28);
    ctx.stroke();
  }
  ctx.restore();
}

// Text set letter by letter along the top of a circle, reading left to right from the players' side.
function arcText(ctx: CanvasRenderingContext2D, line: ArcLine): void {
  const r = line.radius * PX_PER_M;
  ctx.save();
  ctx.font = line.font;
  const chars = [...line.text];
  const widths = chars.map((ch) => ctx.measureText(ch).width + line.spacing);
  const total = widths.reduce((a, b) => a + b, 0) - line.spacing;
  const [cx, top] = feltPx(0, line.z);
  const cy = top + r;
  let angle = -total / r / 2;
  chars.forEach((ch, i) => {
    const a = angle + (widths[i] - line.spacing) / r / 2;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.rotate(a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += widths[i] / r;
  });
  ctx.restore();
}
