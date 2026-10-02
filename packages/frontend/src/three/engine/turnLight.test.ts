import { TURN_LIGHT_TAU, stepTurnLight } from './turnLight';

const off = { x: 0, z: 0, level: 0 };

describe('stepTurnLight', () => {
  it('appears on the first acting seat instead of sliding in from the last one', () => {
    const s = stepTurnLight({ x: -0.5, z: 0.2, level: 0 }, { x: 0.4, z: 0.3 }, 1 / 30, false);
    expect([s.x, s.z]).toEqual([0.4, 0.3]);
    expect(s.level).toBeGreaterThan(0);
  });

  it('glides between seats and reaches 95% within about 0.4 s', () => {
    let s = { x: 0, z: 0.5, level: 1 };
    let t = 0;
    while (Math.abs(0.6 - s.x) > 0.05 * 0.6 && t < 2) {
      s = stepTurnLight(s, { x: 0.6, z: 0.5 }, 1 / 60, false);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.42);
    expect(TURN_LIGHT_TAU).toBeCloseTo(0.12, 6);
  });

  it('fades out in place when nobody is acting', () => {
    let s = { x: 0.3, z: 0.2, level: 1 };
    for (let i = 0; i < 30; i++) s = stepTurnLight(s, null, 1 / 30, false);
    expect(s.level).toBeLessThan(0.01);
    expect([s.x, s.z]).toEqual([0.3, 0.2]);
  });

  it('jumps straight there under reduced motion', () => {
    expect(stepTurnLight({ x: 0, z: 0, level: 1 }, { x: 0.5, z: -0.2 }, 1 / 30, true)).toEqual({ x: 0.5, z: -0.2, level: 1 });
    expect(stepTurnLight(off, null, 1 / 30, true).level).toBe(0);
  });
});
