import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders the given value as text', () => {
    render(<Chip value={125} />);
    expect(screen.getByText('125')).toBeInTheDocument();
  });

  it('marks its decorative graphic as aria-hidden, so only the value is announced', () => {
    render(<Chip value={10} />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
