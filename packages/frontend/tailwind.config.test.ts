import { describe, expect, it } from 'vitest';
import tailwindConfig from './tailwind.config';

describe('tailwind theme tokens', () => {
  it('maps every saloon color token to its CSS custom property', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, string>;
    expect(colors.bg).toBe('var(--bg)');
    expect(colors.surface).toBe('var(--surface)');
    expect(colors['surface-raised']).toBe('var(--surface-raised)');
    expect(colors.wood).toBe('var(--wood)');
    expect(colors['wood-dark']).toBe('var(--wood-dark)');
    expect(colors['wood-grain']).toBe('var(--wood-grain)');
    expect(colors.felt).toBe('var(--felt)');
    expect(colors['felt-hi']).toBe('var(--felt-hi)');
    expect(colors.brass).toBe('var(--brass)');
    expect(colors['brass-bright']).toBe('var(--brass-bright)');
    expect(colors.parchment).toBe('var(--parchment)');
    expect(colors['parchment-dim']).toBe('var(--parchment-dim)');
    expect(colors.ink).toBe('var(--ink)');
    expect(colors.fg).toBe('var(--fg)');
    expect(colors['fg-dim']).toBe('var(--fg-dim)');
    expect(colors['fg-faint']).toBe('var(--fg-faint)');
    expect(colors.ember).toBe('var(--ember)');
    expect(colors['ember-bright']).toBe('var(--ember-bright)');
    expect(colors['ember-text']).toBe('var(--ember-text)');
    expect(colors.win).toBe('var(--win)');
    expect(colors['win-bright']).toBe('var(--win-bright)');
  });

  it('defines the three saloon font-family roles', () => {
    const fonts = tailwindConfig.theme?.extend?.fontFamily as Record<string, string[]>;
    expect(fonts.display[0]).toBe('Rye');
    expect(fonts.body[0]).toBe('Vollkorn');
    expect(fonts.utility[0]).toBe('"Special Elite"');
  });
});
