// A display name is the only identity players see, so two names that look the same must be the
// same player (audit M8): "Bob" and "bob", or "alice" with a zero-width space in it, used to be
// separate accounts with separate balances. Pure TypeScript with no Node imports: the frontend
// imports it too, so both sides fold a name the same way.

export const MAX_DISPLAY_NAME_LENGTH = 32;

/** The name as it will be shown and stored, or null if nothing usable is left. */
export function normaliseDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4 * MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }
  const cleaned = raw
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    // Unicode "Other": control characters, format characters (zero-width and bidi marks),
    // private-use and unassigned code points.
    .replace(/\p{C}/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (cleaned.length === 0 || cleaned.length > MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }
  return cleaned;
}

/** Case-insensitive key: two names with the same key are the same player. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

export function sameName(a: string | null | undefined, b: string): boolean {
  return a !== null && a !== undefined && nameKey(a) === nameKey(b);
}
