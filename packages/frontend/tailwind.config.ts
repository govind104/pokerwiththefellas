import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // These colors resolve to `var(--x)` CSS custom properties, so Tailwind's
      // `/opacity` modifier syntax (e.g. `bg-surface/80`) does NOT work on them --
      // it silently emits no CSS. Use the solid token, or a dedicated `--x-transparent`
      // custom property, instead.
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        wood: 'var(--wood)',
        'wood-dark': 'var(--wood-dark)',
        'wood-grain': 'var(--wood-grain)',
        felt: 'var(--felt)',
        'felt-hi': 'var(--felt-hi)',
        brass: 'var(--brass)',
        'brass-bright': 'var(--brass-bright)',
        parchment: 'var(--parchment)',
        'parchment-dim': 'var(--parchment-dim)',
        ink: 'var(--ink)',
        fg: 'var(--fg)',
        'fg-dim': 'var(--fg-dim)',
        'fg-faint': 'var(--fg-faint)',
        ember: 'var(--ember)',
        'ember-bright': 'var(--ember-bright)',
        'ember-text': 'var(--ember-text)',
        win: 'var(--win)',
        'win-bright': 'var(--win-bright)',
      },
      fontFamily: {
        // Rye's Google Fonts request is intentionally deferred (not fetched in
        // index.html) until a consumer exists -- Georgia is a fine fallback until then.
        display: ['Rye', 'Georgia', 'serif'],
        body: ['Vollkorn', 'Georgia', '"Times New Roman"', 'serif'],
        utility: ['"Special Elite"', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
