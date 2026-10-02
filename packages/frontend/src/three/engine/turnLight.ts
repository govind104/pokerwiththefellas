import type { Vec2 } from '../sceneModel';

// The turn light's motion (spec §A6): it glides from seat to seat and fades out when nobody is
// acting. Exponential, so a new target mid-glide just bends the path instead of jumping.

export interface TurnLightState {
  x: number;
  z: number;
  // 0 = off, 1 = full strength.
  level: number;
}

// 95% of the way in about 0.36 s (spec: "about 0.4 s").
export const TURN_LIGHT_TAU = 0.12;

export function stepTurnLight(s: TurnLightState, goal: Vec2 | null, dt: number, instant: boolean): TurnLightState {
  const k = instant ? 1 : 1 - Math.exp(-dt / TURN_LIGHT_TAU);
  if (!goal) return { x: s.x, z: s.z, level: s.level + (0 - s.level) * k };
  // A light that is off (or nearly) appears on the new seat rather than sliding in from the old one.
  if (s.level < 0.05) return { x: goal.x, z: goal.z, level: s.level + (1 - s.level) * k };
  return { x: s.x + (goal.x - s.x) * k, z: s.z + (goal.z - s.z) * k, level: s.level + (1 - s.level) * k };
}
