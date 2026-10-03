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

const SUIT_FROM_CODE: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

// pokersolver writes a ten as 'T' and, in a wheel straight (A-2-3-4-5), the ace as '1'.
function fromPokersolverCard(c: { value: string; suit: string }): Card {
  const rank = c.value === 'T' ? '10' : c.value === '1' ? 'A' : c.value;
  return { rank: rank as Rank, suit: SUIT_FROM_CODE[c.suit] };
}

export function describeHand(
  holeCards: [Card, Card],
  communityCards: Card[]
): { name: string; description: string; bestCards: Card[] } {
  const hand = Hand.solve([...holeCards, ...communityCards].map(toPokersolverCard));
  // The five that make the hand: the client lifts these at a showdown (Plan B spec §5.1).
  return { name: hand.name, description: hand.descr, bestCards: hand.cards.slice(0, 5).map(fromPokersolverCard) };
}
