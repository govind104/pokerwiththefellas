import type { Card as CardModel, Rank } from '@poker-blackjack/game-engine';

// Confirmed against the actual vendored filenames from Task 3, Step 1:
// the Webisso/playing-cards repo uses `<name>_of_<suit>.svg`, with face cards
// spelled out (`ace`, `jack`, `queen`, `king`) and bare digits for numbers
// 2-10. This mapping matches the real files exactly.
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

function assetUrl(card: CardModel): string {
  return new URL(`../assets/cards/${RANK_FILE[card.rank]}_of_${card.suit}.svg`, import.meta.url).href;
}

export interface CardProps {
  card?: CardModel;
  faceDown?: boolean;
}

export function Card({ card, faceDown = false }: CardProps) {
  if (faceDown || !card) {
    return (
      <div
        role="img"
        aria-label="face-down card"
        className="h-24 w-16 rounded-md border border-slate-600 bg-slate-700"
      />
    );
  }
  return (
    <img
      src={assetUrl(card)}
      alt={`${card.rank} of ${card.suit}`}
      className="h-24 w-16 rounded-md border border-slate-300 bg-white"
    />
  );
}
