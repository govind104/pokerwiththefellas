import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('renders a face-up card with an accessible name including rank and suit', () => {
    render(<Card card={{ suit: 'spades', rank: 'A' }} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName(/A.*spades/i);
  });

  it('renders a face-down placeholder when faceDown is true, even with a card given', () => {
    render(<Card card={{ suit: 'hearts', rank: 'K' }} faceDown />);
    expect(screen.getByRole('img', { name: /face-down/i })).toBeInTheDocument();
  });

  it('renders a face-down placeholder when no card is given at all', () => {
    render(<Card />);
    expect(screen.getByRole('img', { name: /face-down/i })).toBeInTheDocument();
  });

  it('renders a distinct image source for each of the 13 ranks', () => {
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
    const sources = ranks.map((rank) => {
      const { unmount } = render(<Card card={{ suit: 'clubs', rank }} />);
      const src = screen.getByRole('img').getAttribute('src');
      unmount();
      return src;
    });
    expect(new Set(sources).size).toBe(ranks.length);
  });
});
