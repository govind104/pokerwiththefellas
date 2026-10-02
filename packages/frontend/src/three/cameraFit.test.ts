import { CAMERA_FOV_DEG, cameraFor, fitCamera, frameOutline, projectToScreen } from './cameraFit';
import { hudZoneAt } from './hudZones';

describe('fitCamera', () => {
  it('converges to the prototype framing at 16:9', () => {
    const fit = fitCamera(16 / 9);
    expect(fit.fov).toBe(CAMERA_FOV_DEG);
    expect(fit.position.x).toBeCloseTo(0, 6);
    expect(fit.position.y).toBeCloseTo(2.59, 2);
    expect(fit.position.z).toBeCloseTo(1.808, 2);
    expect(fit.look.y).toBeCloseTo(0.76, 6);
    expect(fit.look.z).toBeCloseTo(0.272, 2);
  });

  it('looks 50 degrees down', () => {
    const { position, look } = fitCamera(16 / 9);
    const pitch = Math.atan2(position.y - look.y, position.z - look.z);
    expect((pitch * 180) / Math.PI).toBeCloseTo(50, 6);
  });

  it.each([
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
  ])('fills a %s frame symmetrically with a 5%% margin', (_, aspect) => {
    const cam = cameraFor(fitCamera(aspect), aspect);
    let xMin = 1;
    let xMax = -1;
    let yMin = 1;
    let yMax = -1;
    for (const p of frameOutline()) {
      const q = p.clone().project(cam);
      xMin = Math.min(xMin, q.x);
      xMax = Math.max(xMax, q.x);
      yMin = Math.min(yMin, q.y);
      yMax = Math.max(yMax, q.y);
    }
    expect(Math.max(xMax, -xMin, (yMax - yMin) / 2)).toBeCloseTo(0.95, 2);
    expect((yMax + yMin) / 2).toBeCloseTo(0, 2);
    expect(xMax + xMin).toBeCloseTo(0, 3);
  });

  it('projects the table centre near the middle of the screen', () => {
    const cam = cameraFor(fitCamera(16 / 9), 16 / 9);
    const { sx, sy } = projectToScreen(cam, 0, 0.76, 0);
    expect(sx).toBeCloseTo(0.5, 3);
    expect(sy).toBeGreaterThan(0.3);
    expect(sy).toBeLessThan(0.7);
  });
});

describe('hudZoneAt', () => {
  it('finds the three HUD rectangles and nothing in the middle', () => {
    expect(hudZoneAt(0.1, 0.9)?.name).toBe('players');
    expect(hudZoneAt(0.9, 0.1)?.name).toBe('table');
    expect(hudZoneAt(0.9, 0.9)?.name).toBe('actions');
    expect(hudZoneAt(0.5, 0.5)).toBeNull();
    expect(hudZoneAt(0.3, 0.9)).toBeNull();
  });
});
