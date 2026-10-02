// Screen rectangles Plan B's HUD will cover, as fractions of the viewport from its top-left, at a
// 16:9 reference (spec §A1). The table layout keeps every card out of them; Plan B sizes the HUD
// to fit inside them.

export interface HudZone {
  name: 'players' | 'table' | 'actions';
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HUD_ZONES: readonly HudZone[] = [
  { name: 'players', x: 0, y: 1 - 0.32, w: 0.25, h: 0.32 },
  { name: 'table', x: 1 - 0.26, y: 0, w: 0.26, h: 0.2 },
  { name: 'actions', x: 1 - 0.15, y: 1 - 0.26, w: 0.15, h: 0.26 },
];

export function hudZoneAt(sx: number, sy: number): HudZone | null {
  return HUD_ZONES.find((z) => sx > z.x && sx < z.x + z.w && sy > z.y && sy < z.y + z.h) ?? null;
}
