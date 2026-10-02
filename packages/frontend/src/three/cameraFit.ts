import * as THREE from 'three';
import { TABLE_Y } from './layout';

// A fixed three-quarter view (spec §A2): 50 degrees down through a long lens, framed so the rail
// and skirt fill the frame with an even margin. Pure three.js maths, no renderer, so it is
// unit-tested and recomputed on every resize.

export const CAMERA_PITCH_DEG = 50;
export const CAMERA_FOV_DEG = 35;
export const FRAME_MARGIN = 0.05;

export interface CameraFit {
  fov: number;
  position: THREE.Vector3;
  look: THREE.Vector3;
}

let outline: THREE.Vector3[] | null = null;

// What must be in frame: the outer rail (about 1.28 x 0.93 at y 0.79) and the skirt below it
// (about 1.3 x 0.95 at y 0.6).
export function frameOutline(): readonly THREE.Vector3[] {
  if (!outline) {
    outline = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      outline.push(
        new THREE.Vector3(1.28 * Math.cos(a), 0.79, 0.93 * Math.sin(a)),
        new THREE.Vector3(1.3 * Math.cos(a), 0.6, 0.95 * Math.sin(a)),
      );
    }
  }
  return outline;
}

export function cameraFor(fit: CameraFit, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fit.fov, aspect, 0.05, 30);
  cam.position.copy(fit.position);
  cam.lookAt(fit.look);
  cam.updateMatrixWorld();
  return cam;
}

// Iterates the look point's z (to centre the outline vertically) and the distance along the view
// direction (so the larger of the horizontal and vertical extents fills 1 - FRAME_MARGIN).
export function fitCamera(aspect: number): CameraFit {
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 0.05, 30);
  const q = new THREE.Vector3();
  const look = new THREE.Vector3(0, TABLE_Y, 0);
  let d = 3;
  for (let it = 0; it < 80; it++) {
    cam.position.copy(look).addScaledVector(dir, -d);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    let xMax = 0;
    let yMax = -Infinity;
    let yMin = Infinity;
    for (const p of frameOutline()) {
      q.copy(p).project(cam);
      xMax = Math.max(xMax, Math.abs(q.x));
      yMax = Math.max(yMax, q.y);
      yMin = Math.min(yMin, q.y);
    }
    look.z -= ((yMax + yMin) / 2) * d * 0.25;
    d *= Math.max(xMax, (yMax - yMin) / 2) / (1 - FRAME_MARGIN);
  }
  return { fov: CAMERA_FOV_DEG, position: look.clone().addScaledVector(dir, -d), look };
}

// Screen position as fractions of the viewport from its top-left.
export function projectToScreen(cam: THREE.PerspectiveCamera, x: number, y: number, z: number): { sx: number; sy: number } {
  const q = new THREE.Vector3(x, y, z).project(cam);
  return { sx: (q.x + 1) / 2, sy: (1 - q.y) / 2 };
}
