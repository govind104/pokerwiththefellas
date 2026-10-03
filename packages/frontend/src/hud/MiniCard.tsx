import type { Card } from '@poker-blackjack/game-engine';

// HTML mini cards in the A4 big-index style (base spec §B1): parchment face, bold Georgia rank,
// red #a3221b / black #1b1410. Sizes are in em so they follow the HUD's root font size.

const SUIT_GLYPH: Record<Card['suit'], string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
// Card font size as a share of the surrounding text: 0.36 × the sketch's card widths (1.9 and 4.4).
const FONT: Record<'sm' | 'lg', string> = { sm: '0.684em', lg: '1.584em' };
// Width and height relative to the card's own font size: 1 / 0.36 and 1.4 / 0.36.
const BOX = { width: '2.78em', height: '3.89em' } as const;

export function MiniCard({ card, size = 'sm' }: { card: Card | null; size?: 'sm' | 'lg' }) {
  if (!card) {
    return (
      <span
        role="img"
        aria-label="face-down card"
        className="inline-block flex-none rounded-[0.28em] border-[0.15em] border-[#e4d5ad] bg-[repeating-linear-gradient(45deg,#7a1d1d_0_0.3em,#932828_0.3em_0.6em)] shadow-[0_0.1em_0.3em_rgba(0,0,0,0.6)]"
        style={{ fontSize: FONT[size], ...BOX }}
      />
    );
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <span
      role="img"
      aria-label={`${card.rank} of ${card.suit}`}
      className={`inline-flex flex-none flex-col justify-between rounded-[0.28em] bg-[#e4d5ad] p-[0.2em] font-bold leading-none shadow-[0_0.1em_0.3em_rgba(0,0,0,0.6)] ${red ? 'text-[#a3221b]' : 'text-[#1b1410]'}`}
      style={{ fontSize: FONT[size], fontFamily: 'Georgia, serif', ...BOX }}
    >
      <span aria-hidden="true">{card.rank}</span>
      <span aria-hidden="true" className="self-center text-[1.5em]">
        {SUIT_GLYPH[card.suit]}
      </span>
    </span>
  );
}
