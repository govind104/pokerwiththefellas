// Default-import-then-destructure rather than `import { Hand } from 'pokersolver'`:
// pokersolver assigns its exports dynamically through a helper function rather
// than as statically-analyzable `exports.Hand = ...` lines, so Node's ESM loader
// (cjs-module-lexer) can't detect `Hand` as a named export at runtime -- a plain
// named import works under Vite/Vitest's esbuild-based resolution (which doesn't
// have this limitation) but throws under native `node` (see packages/server's
// standalone-run scripts). This form works under both.
import pokersolverPkg from 'pokersolver';
const { Hand } = pokersolverPkg;
import { Card, Rank, Suit } from './deck';

const SUIT_CODES: Record<Suit, string> = {
  clubs: 'c',
  diamonds: 'd',
  hearts: 'h',
  spades: 's',
};

function rankCode(rank: Rank): string {
  return rank === '10' ? 'T' : rank;
}

function toPokersolverCard(card: Card): string {
  return `${rankCode(card.rank)}${SUIT_CODES[card.suit]}`;
}

export function determineWinners(
  players: { playerId: string; holeCards: [Card, Card] }[],
  communityCards: Card[]
): string[] {
  const solved = players.map((p) => ({
    playerId: p.playerId,
    hand: Hand.solve([...p.holeCards, ...communityCards].map(toPokersolverCard)),
  }));
  const winningHands = Hand.winners(solved.map((s) => s.hand));
  return solved.filter((s) => winningHands.includes(s.hand)).map((s) => s.playerId);
}

export function describeHand(
  holeCards: [Card, Card],
  communityCards: Card[]
): { name: string; description: string } {
  const hand = Hand.solve([...holeCards, ...communityCards].map(toPokersolverCard));
  return { name: hand.name, description: hand.descr };
}
