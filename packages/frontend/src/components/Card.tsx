import { useId } from 'react';
import { motion } from 'framer-motion';
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
  const patternId = useId();

  if (faceDown || !card) {
    return (
      <motion.svg
        role="img"
        aria-label="face-down card"
        viewBox="0 0 64 96"
        className="h-24 w-16 rounded-md"
        initial={{ opacity: 0, y: -12, rotate: -4 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <defs>
          <pattern
            id={`card-back-lattice-${patternId}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="var(--ink)" />
            <path d="M5,1 L9,5 L5,9 L1,5 Z" fill="none" stroke="var(--brass)" strokeWidth="0.75" opacity="0.6" />
          </pattern>
        </defs>
        <rect
          x="1"
          y="1"
          width="62"
          height="94"
          rx="4"
          fill={`url(#card-back-lattice-${patternId})`}
          stroke="var(--brass)"
          strokeWidth="2"
        />
      </motion.svg>
    );
  }
  return (
    <motion.img
      src={assetUrl(card)}
      alt={`${card.rank} of ${card.suit}`}
      className="h-24 w-16 rounded-md border-2 border-brass bg-parchment shadow-md"
      initial={{ opacity: 0, y: -12, rotate: 4 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    />
  );
}
