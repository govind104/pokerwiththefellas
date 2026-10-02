import type { Card, Rank, Suit } from '@poker-blackjack/game-engine';

// Big-index card faces (spec §A4), drawn straight onto the card canvas with no SVG load, so a face
// is ready the moment its card is dealt. Coordinates are for the 256 x 358 card texture.

export const FACE_PAPER = '#e4d5ad';
export const FACE_RED = '#a3221b';
export const FACE_BLACK = '#1b1410';
export const SYMBOL_FONT = '"Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Symbols", serif';

const W = 256;
const H = 358;

const SUIT_GLYPH: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_LETTER: Record<Suit, string> = { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' };
const COURT_GLYPH: Partial<Record<Rank, string>> = { J: '♞', Q: '♛', K: '♚' };

export type GlyphCheck = (glyph: string) => boolean;

export function drawCardFace(ctx: CanvasRenderingContext2D, card: Card, hasGlyph: GlyphCheck): void {
  const suit = hasGlyph(SUIT_GLYPH[card.suit]) ? SUIT_GLYPH[card.suit] : SUIT_LETTER[card.suit];
  const ink = card.suit === 'hearts' || card.suit === 'diamonds' ? FACE_RED : FACE_BLACK;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // The rank at about 0.4 of the card width with the suit under it; "10" is condensed to fit.
  const index = () => {
    ctx.save();
    if (card.rank === '10') {
      ctx.translate(54, 100);
      ctx.scale(0.72, 1);
      ctx.font = 'bold 100px Georgia, serif';
      ctx.fillText('10', 0, 0);
    } else {
      ctx.font = 'bold 104px Georgia, serif';
      ctx.fillText(card.rank, 52, 100);
    }
    ctx.restore();
    ctx.font = `76px ${SYMBOL_FONT}`;
    ctx.fillText(suit, 52, 172);
  };
  index();
  // The same index mirrored in the opposite corner.
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  index();
  ctx.restore();

  ctx.textBaseline = 'middle';
  const court = COURT_GLYPH[card.rank];
  if (court) {
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.75;
    ctx.strokeRect(W * 0.3, H * 0.3, W * 0.4, H * 0.4);
    ctx.font = `86px ${SYMBOL_FONT}`;
    ctx.fillText(hasGlyph(court) ? court : card.rank, W / 2, H / 2 + 4);
  } else {
    ctx.globalAlpha = 0.9;
    ctx.font = `150px ${SYMBOL_FONT}`;
    ctx.fillText(suit, W / 2, H * 0.52);
  }
  ctx.restore();
}

const glyphs = new Map<string, boolean>();

// Glyph coverage differs by OS (spec §8). A font stack with no glyph for a character draws nothing,
// or the same "missing" box it draws for a private-use code point, so compare the two renderings.
export function glyphSupported(glyph: string): boolean {
  const known = glyphs.get(glyph);
  if (known !== undefined) return known;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true;
  const alpha = (ch: string) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.font = `48px ${SYMBOL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 32, 32);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const out: number[] = [];
    for (let i = 3; i < data.length; i += 4) out.push(data[i]);
    return out;
  };
  const drawn = alpha(glyph);
  const missing = alpha(String.fromCodePoint(0x10fffd));
  const ok = drawn.some((a) => a > 0) && drawn.some((a, i) => a !== missing[i]);
  glyphs.set(glyph, ok);
  return ok;
}
