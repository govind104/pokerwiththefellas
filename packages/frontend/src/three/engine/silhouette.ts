import * as THREE from 'three';

// A deliberately minimal seated figure: hat, shadowed head, shoulders, two
// resting hands. It is a shape you read as "a person at the table", not a
// character -- the point is mood, and it costs a handful of primitives.

export type HatStyle = 'stetson' | 'flat' | 'bowler' | 'none';

export interface SilhouetteOptions {
  hat: HatStyle;
  hatColor: number;
  coatColor: number;
  dealer?: boolean;
}

const skin = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.85, emissive: 0x1a0d06 });

export class Silhouette {
  readonly group = new THREE.Group();
  private upper = new THREE.Group();
  private hat = new THREE.Group();
  private hands: THREE.Mesh[] = [];
  private lean = 0;
  private leanTarget = 0;
  private phase = Math.random() * 10;

  constructor(opts: SilhouetteOptions) {
    const coat = new THREE.MeshStandardMaterial({ color: opts.coatColor, roughness: 0.9, emissive: 0x1c0f06 });
    const hatMat = new THREE.MeshStandardMaterial({ color: opts.hatColor, roughness: 0.75, emissive: 0x160c05 });

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), coat);
    torso.scale.set(0.42, 0.6, 0.26);
    torso.position.y = 1.02;
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.4, 6, 12), coat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.y = 1.26;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 10), skin);
    neck.position.y = 1.36;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.098, 18, 14), skin);
    head.scale.set(0.9, 1.08, 0.95);
    head.position.y = 1.47;

    // Seated lower body: a dark column so the figure never floats above the floor.
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.72, 14), coat);
    lower.position.y = 0.36;
    this.group.add(lower);

    this.upper.add(torso, shoulders, neck, head);

    if (opts.dealer) {
      // Bow tie and vest line so the dealer reads differently at a glance.
      const tie = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.035, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x6a1d16, roughness: 0.7 }),
      );
      tie.position.set(0, 1.34, 0.085);
      this.upper.add(tie);
    }

    this.buildHat(opts.hat, hatMat);
    this.upper.add(this.hat);

    // Arms run from each shoulder to a hand resting on the rail in front of the seat.
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Vector3(sx * 0.25, 1.24, 0);
      const handPos = new THREE.Vector3(sx * 0.15, 0.8, 0.34);
      const len = shoulder.distanceTo(handPos);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, len - 0.08, 5, 10), coat);
      arm.position.copy(shoulder).lerp(handPos, 0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), handPos.clone().sub(shoulder).normalize());
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), skin);
      hand.scale.set(1.0, 0.6, 1.5);
      hand.position.copy(handPos);
      this.hands.push(hand);
      this.upper.add(arm, hand);
    }

    this.group.add(this.upper);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  private buildHat(style: HatStyle, mat: THREE.Material): void {
    if (style === 'none') return;
    const y = 1.55;
    if (style === 'stetson') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.008, 28), mat);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.098, 0.13, 20), mat);
      crown.position.y = 0.065;
      const dent = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mat);
      dent.scale.set(1.5, 0.35, 1);
      dent.position.y = 0.135;
      this.hat.add(brim, crown, dent);
    } else if (style === 'flat') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.007, 26), mat);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.098, 0.085, 20), mat);
      crown.position.y = 0.045;
      this.hat.add(brim, crown);
    } else {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.008, 24), mat);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      crown.scale.set(1, 1.05, 1);
      this.hat.add(brim, crown);
    }
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.099, 0.101, 0.02, 20),
      new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 0.6 }),
    );
    band.position.y = style === 'bowler' ? 0.014 : 0.02;
    this.hat.add(band);
    this.hat.position.y = y;
    this.hat.rotation.z = (Math.random() - 0.5) * 0.08;
  }

  setActive(active: boolean): void {
    this.leanTarget = active ? 1 : 0;
  }

  // Faces the table centre from wherever it stands.
  faceToward(cx: number, cz: number): void {
    this.group.rotation.y = Math.atan2(cx - this.group.position.x, cz - this.group.position.z);
  }

  update(t: number, dt: number, still: boolean): void {
    this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 4);
    const breathe = still ? 0 : Math.sin(t * 1.1 + this.phase) * 0.006;
    this.upper.position.y = breathe;
    this.upper.rotation.x = 0.08 * this.lean + (still ? 0 : Math.sin(t * 0.5 + this.phase) * 0.01);
    this.upper.position.z = 0.06 * this.lean;
    this.hat.rotation.x = -0.05 * this.lean;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (m !== skin) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
  }
}

const HATS: HatStyle[] = ['stetson', 'flat', 'bowler', 'stetson', 'flat'];
const HAT_COLORS = [0x2a1d14, 0x3a2b1e, 0x1c1a19, 0x4a3a28, 0x241a12];
const COATS = [0x1d1612, 0x2a1c14, 0x17181a, 0x2b2419, 0x1a1210];

export function silhouetteFor(seatIndex: number): SilhouetteOptions {
  const i = ((seatIndex % HATS.length) + HATS.length) % HATS.length;
  return { hat: HATS[i], hatColor: HAT_COLORS[i], coatColor: COATS[i] };
}
