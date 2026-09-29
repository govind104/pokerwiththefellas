import * as THREE from 'three';
import { TABLE_A, TABLE_B, TABLE_Y } from '../sceneModel';
import { feltTexture, plankTexture, rng, smokeTexture, softDotTexture, woodTexture } from './textures';

export const SHOE_POS = new THREE.Vector3(0.62, TABLE_Y + 0.03, -0.55);
export const TRAY_POS = new THREE.Vector3(-0.62, TABLE_Y + 0.01, -0.55);

const LAMP_POS = new THREE.Vector3(0, 2.3, -0.05);

function ellipseShape(a: number, b: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absellipse(0, 0, a, b, 0, Math.PI * 2, false, 0);
  return s;
}

export class Room {
  readonly group = new THREE.Group();
  readonly spot: THREE.SpotLight;
  readonly fill: THREE.PointLight;
  readonly uplight: THREE.PointLight;
  private bulb: THREE.Mesh;
  private halo: THREE.Sprite;
  private dust: THREE.Points;
  private dustSeeds: Float32Array;
  private smoke: THREE.Sprite[] = [];
  private ember: THREE.Mesh;
  private baseSpot = 22;
  private dealerProps = new THREE.Group();

  constructor() {
    const g = this.group;

    // --- Light ---------------------------------------------------------
    g.add(new THREE.HemisphereLight(0x2a2f3d, 0x0d0806, 0.55));

    this.spot = new THREE.SpotLight(0xffa552, this.baseSpot, 9, Math.PI / 3.1, 0.85, 1.6);
    this.spot.position.copy(LAMP_POS);
    this.spot.target.position.set(0, TABLE_Y, -0.05);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.radius = 5;
    this.spot.shadow.camera.near = 0.3;
    this.spot.shadow.camera.far = 6;
    g.add(this.spot, this.spot.target);

    this.fill = new THREE.PointLight(0xff9440, 2.4, 10, 1.7);
    this.fill.position.set(0, 1.85, 0);
    g.add(this.fill);

    // Low warm bounce off the felt: this is what lights the figures' faces and
    // hat undersides from below.
    this.uplight = new THREE.PointLight(0xffb060, 3.2, 5.5, 1.5);
    this.uplight.position.set(0, TABLE_Y + 0.22, -0.1);
    g.add(this.uplight);

    // Cold moonlight through a window off to the left, for rim contrast.
    const moon = new THREE.DirectionalLight(0x6f8fbe, 0.55);
    moon.position.set(-5, 3, -2);
    g.add(moon);

    // --- Room shell ----------------------------------------------------
    const plank = plankTexture(11);
    const wallMat = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.95, color: 0xb8a58c });
    const floorTex = plankTexture(23, '#2a1a0e');
    floorTex.repeat.set(3, 3);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.4), wallMat);
    back.position.set(0, 2.2, -4);
    const left = back.clone();
    left.rotation.y = Math.PI / 2;
    left.position.set(-4.4, 2.2, 0);
    const right = back.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.set(4.4, 2.2, 0);
    const front = back.clone();
    front.rotation.y = Math.PI;
    front.position.set(0, 2.2, 5);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 1 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.4;
    g.add(floor, back, left, right, front, ceiling);

    for (const z of [-2.4, 0.4, 2.8]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(14, 0.22, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x1d120a, roughness: 0.9 }),
      );
      beam.position.set(0, 3.28, z);
      g.add(beam);
    }

    // Back bar: shelf with bottles, catching a little of the lamp.
    const shelfMat = new THREE.MeshStandardMaterial({ map: woodTexture('#3a2415', 5, [3, 1]), roughness: 0.6 });
    for (const y of [1.25, 1.85]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.05, 0.32), shelfMat);
      shelf.position.set(0, y, -3.8);
      g.add(shelf);
      const r = rng(y * 100);
      for (let i = 0; i < 17; i++) {
        const h = 0.24 + r() * 0.12;
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035 + r() * 0.015, 0.045 + r() * 0.015, h, 12),
          new THREE.MeshStandardMaterial({
            color: r() < 0.5 ? 0x2a1608 : r() < 0.5 ? 0x14291a : 0x3a2410,
            roughness: 0.18,
            metalness: 0.25,
          }),
        );
        bottle.position.set(-2.5 + i * 0.31 + (r() - 0.5) * 0.05, y + 0.025 + h / 2, -3.8);
        g.add(bottle);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.1, 8), bottle.material);
        neck.position.set(bottle.position.x, y + 0.025 + h + 0.04, -3.8);
        g.add(neck);
      }
    }

    // --- Table ---------------------------------------------------------
    const woodTex = woodTexture('#4a2f1c', 7, [1, 1]);
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xb09a86, roughness: 0.66, metalness: 0 });
    const feltMat = new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.96 });

    const feltGeo = new THREE.ShapeGeometry(ellipseShape(TABLE_A, TABLE_B), 72);
    feltGeo.rotateX(-Math.PI / 2);
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.position.y = TABLE_Y;
    felt.receiveShadow = true;

    const railShape = ellipseShape(TABLE_A + 0.12, TABLE_B + 0.12);
    railShape.holes.push(ellipseShape(TABLE_A, TABLE_B));
    const railGeo = new THREE.ExtrudeGeometry(railShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.02,
      bevelSegments: 4,
      curveSegments: 72,
    });
    railGeo.rotateX(-Math.PI / 2);
    const rail = new THREE.Mesh(railGeo, woodMat);
    rail.position.y = TABLE_Y - 0.03;
    rail.castShadow = rail.receiveShadow = true;

    const skirtGeo = new THREE.ExtrudeGeometry(ellipseShape(TABLE_A + 0.1, TABLE_B + 0.1), {
      depth: 0.2,
      bevelEnabled: false,
      curveSegments: 72,
    });
    skirtGeo.rotateX(-Math.PI / 2);
    const skirt = new THREE.Mesh(skirtGeo, woodMat);
    skirt.position.y = TABLE_Y - 0.23;
    skirt.castShadow = true;

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, TABLE_Y - 0.2, 20), woodMat);
    pedestal.position.y = (TABLE_Y - 0.2) / 2;
    g.add(felt, rail, skirt, pedestal);

    // Dealing shoe and discard tray.
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.08, 0.11),
      new THREE.MeshStandardMaterial({ color: 0x1a110a, roughness: 0.5 }),
    );
    shoe.position.copy(SHOE_POS);
    shoe.rotation.y = -0.25;
    shoe.castShadow = true;
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.02, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.4, metalness: 0.4 }),
    );
    tray.position.copy(TRAY_POS);
    tray.receiveShadow = true;
    this.dealerProps.add(shoe, tray);
    g.add(this.dealerProps);

    // Whiskey glass and a cigar in a saucer, near the local player's hand.
    const glassProfile = [
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(0.026, 0),
      new THREE.Vector2(0.032, 0.01),
      new THREE.Vector2(0.038, 0.085),
      new THREE.Vector2(0.036, 0.086),
      new THREE.Vector2(0.029, 0.02),
      new THREE.Vector2(0.0, 0.016),
    ];
    const glass = new THREE.Mesh(
      new THREE.LatheGeometry(glassProfile, 24),
      new THREE.MeshStandardMaterial({
        color: 0xd8c8a0,
        transparent: true,
        opacity: 0.35,
        roughness: 0.08,
        metalness: 0.1,
      }),
    );
    const whiskey = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.026, 0.045, 18),
      new THREE.MeshStandardMaterial({ color: 0x9a5a14, emissive: 0x3a1c04, roughness: 0.2 }),
    );
    whiskey.position.y = 0.032;
    const glassGroup = new THREE.Group();
    glassGroup.add(glass, whiskey);
    glassGroup.position.set(0.78, TABLE_Y + 0.001, 0.62);
    g.add(glassGroup);

    const saucer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.05, 0.012, 20),
      new THREE.MeshStandardMaterial({ color: 0x2b2018, roughness: 0.4, metalness: 0.5 }),
    );
    saucer.position.set(-0.85, TABLE_Y + 0.006, 0.55);
    const cigar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.13, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.9 }),
    );
    cigar.rotation.z = Math.PI / 2 - 0.15;
    cigar.position.set(-0.85, TABLE_Y + 0.02, 0.55);
    this.ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.0085, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a1e }),
    );
    this.ember.position.set(-0.85 + 0.065, TABLE_Y + 0.0235, 0.55 + 0.004);
    g.add(saucer, cigar, this.ember);

    // --- Hanging lamp --------------------------------------------------
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 3.4 - LAMP_POS.y, 6),
      new THREE.MeshStandardMaterial({ color: 0x0a0806 }),
    );
    cord.position.set(0, (3.4 + LAMP_POS.y) / 2, -0.05);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.24, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
    );
    shade.position.set(0, LAMP_POS.y + 0.1, -0.05);
    this.bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    this.bulb.position.set(0, LAMP_POS.y - 0.04, -0.05);
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softDotTexture(),
        color: 0xffb060,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.halo.scale.set(0.9, 0.9, 1);
    this.halo.position.copy(this.bulb.position);
    g.add(cord, shade, this.bulb, this.halo);

    // --- Atmosphere ----------------------------------------------------
    const N = 260;
    const pos = new Float32Array(N * 3);
    this.dustSeeds = new Float32Array(N * 4);
    const r = rng(42);
    for (let i = 0; i < N; i++) {
      const ang = r() * Math.PI * 2;
      const rad = Math.sqrt(r()) * 1.7;
      this.dustSeeds.set([ang, rad, r() * 6.28, 0.02 + r() * 0.05], i * 4);
      pos[i * 3] = Math.cos(ang) * rad;
      pos[i * 3 + 1] = 0.9 + r() * 1.5;
      pos[i * 3 + 2] = Math.sin(ang) * rad - 0.2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        map: softDotTexture('rgba(255,235,200,1)'),
        size: 0.02,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    g.add(this.dust);

    const smokeTex = smokeTexture();
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false, color: 0xd8c8b0 }),
      );
      s.userData.t0 = i / 7;
      g.add(s);
      this.smoke.push(s);
    }
  }

  // The shoe and discard tray belong to Blackjack only.
  setMode(kind: 'blackjack' | 'holdem'): void {
    this.dealerProps.visible = kind === 'blackjack';
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.spot.castShadow = q !== 'low';
    this.spot.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.spot.shadow.map?.dispose();
    this.spot.shadow.map = null;
    this.dust.visible = q !== 'low';
    this.smoke.forEach((s) => (s.visible = q !== 'low'));
  }

  update(t: number, still: boolean): void {
    const flick = still
      ? 1
      : 1 + Math.sin(t * 13.1) * 0.025 + Math.sin(t * 7.7 + 1.3) * 0.03 + Math.sin(t * 29) * 0.012;
    this.spot.intensity = this.baseSpot * flick;
    this.fill.intensity = 2.4 * flick;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.75 * flick;
    this.ember.scale.setScalar(0.8 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.2)));

    if (!still) {
      const arr = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i++) {
        const ang = this.dustSeeds[i * 4];
        const rad = this.dustSeeds[i * 4 + 1];
        const ph = this.dustSeeds[i * 4 + 2];
        const sp = this.dustSeeds[i * 4 + 3];
        arr.setX(i, Math.cos(ang + t * sp * 0.15) * rad + Math.sin(t * 0.3 + ph) * 0.06);
        arr.setZ(i, Math.sin(ang + t * sp * 0.15) * rad - 0.2 + Math.cos(t * 0.27 + ph) * 0.06);
        let y = arr.getY(i) - sp * 0.02 * (1 / 60);
        if (y < 0.85) y = 2.4;
        arr.setY(i, y);
      }
      arr.needsUpdate = true;
    }

    for (const s of this.smoke) {
      const k = (((t * 0.06 + (s.userData.t0 as number)) % 1) + 1) % 1;
      s.position.set(-0.78 + Math.sin(k * 6 + (s.userData.t0 as number) * 9) * 0.1 * k, TABLE_Y + 0.05 + k * 1.0, 0.55);
      const size = 0.12 + k * 0.55;
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = still ? 0.05 : Math.sin(Math.PI * k) * 0.22;
    }
  }
}
