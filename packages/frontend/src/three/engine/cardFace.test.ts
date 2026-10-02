import type { Card } from '@poker-blackjack/game-engine';
import { recordingContext } from '../testCanvas';
import { FACE_BLACK, FACE_RED, drawCardFace } from './cardFace';

const draw = (card: Card, hasGlyph = (_: string) => true) => {
  const { ctx, calls } = recordingContext();
  drawCardFace(ctx, card, hasGlyph);
  return { texts: calls.filter((k) => k.name === 'fillText'), calls };
};

describe('drawCardFace', () => {
  it('draws a court card as two big corner indices and a framed glyph, in red for hearts', () => {
    const { texts, calls } = draw({ rank: 'Q', suit: 'hearts' });
    expect(texts.map((k) => k.args[0])).toEqual(['Q', '♥', 'Q', '♥', '♛']);
    expect(texts.every((k) => k.fillStyle === FACE_RED)).toBe(true);
    expect(texts[0].font).toMatch(/^bold \d+px Georgia/);
    expect(calls.filter((k) => k.name === 'strokeRect')).toHaveLength(1);
  });

  it('draws a pip card with one large centre suit, in black for spades, and condenses the 10', () => {
    const { texts, calls } = draw({ rank: '10', suit: 'spades' });
    expect(texts.map((k) => k.args[0])).toEqual(['10', '♠', '10', '♠', '♠']);
    expect(texts.every((k) => k.fillStyle === FACE_BLACK)).toBe(true);
    expect(calls.some((k) => k.name === 'scale' && (k.args[0] as number) < 1)).toBe(true);
    expect(calls.filter((k) => k.name === 'strokeRect')).toHaveLength(0);
  });

  it('falls back to letters when the font has no glyph', () => {
    const { texts } = draw({ rank: 'K', suit: 'clubs' }, () => false);
    expect(texts.map((k) => k.args[0])).toEqual(['K', 'C', 'K', 'C', 'K']);
  });
});
