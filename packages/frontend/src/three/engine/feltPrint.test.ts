import { recordingContext } from '../testCanvas';
import { BETTING_LINE_FACTOR, BET_RING_R, BLACKJACK_LINES, FELT_TEX_H, FELT_TEX_W, feltPx, paintFelt } from './feltPrint';

const base = { image: {} as CanvasImageSource, width: 512, height: 512, repeat: [3, 2] as [number, number] };
const pxPerM = FELT_TEX_W / 2.4;

describe('feltPx', () => {
  it('maps the felt bounding box onto the whole canvas, far side at the top', () => {
    expect(feltPx(-1.2, -0.85)).toEqual([0, 0]);
    const [x, y] = feltPx(1.2, 0.85);
    expect(x).toBeCloseTo(FELT_TEX_W, 9);
    expect(y).toBeCloseTo(FELT_TEX_H, 9);
    const [cx, cy] = feltPx(0, 0);
    expect(cx).toBeCloseTo(FELT_TEX_W / 2, 9);
    expect(cy).toBeCloseTo(FELT_TEX_H / 2, 9);
  });

  it('keeps pixels square', () => {
    expect(FELT_TEX_H / 1.7).toBeCloseTo(FELT_TEX_W / 2.4, 0);
  });
});

describe('paintFelt', () => {
  it('prints both Blackjack rule lines and one ring per seat at its bet spot', () => {
    const { ctx, calls } = recordingContext();
    const rings = [
      { x: 0, z: 0.48 },
      { x: -0.5, z: 0.3 },
    ];
    paintFelt(ctx, base, { kind: 'blackjack', rings });
    const letters = BLACKJACK_LINES.reduce((n, l) => n + [...l.text].length, 0);
    expect(calls.filter((k) => k.name === 'fillText')).toHaveLength(letters);
    const arcs = calls.filter((k) => k.name === 'arc');
    expect(arcs).toHaveLength(2);
    arcs.forEach((k, i) => {
      const [px, py] = feltPx(rings[i].x, rings[i].z);
      expect(k.args[0]).toBeCloseTo(px, 6);
      expect(k.args[1]).toBeCloseTo(py, 6);
      expect(k.args[2]).toBeCloseTo(BET_RING_R * pxPerM, 6);
    });
  });

  it("prints a Hold'em betting line and a box round the board, with no text", () => {
    const { ctx, calls } = recordingContext();
    paintFelt(ctx, base, { kind: 'holdem', rings: [] });
    expect(calls.filter((k) => k.name === 'fillText')).toHaveLength(0);
    const line = calls.filter((k) => k.name === 'ellipse');
    expect(line).toHaveLength(1);
    expect(line[0].args[2]).toBeCloseTo(BETTING_LINE_FACTOR * 1.2 * pxPerM, 6);
    expect(calls.filter((k) => k.name === 'roundRect')).toHaveLength(1);
  });
});
