import * as THREE from 'three';
import { TABLE_A, TABLE_B, TABLE_Y, type FeltPrint } from '../sceneModel';
import { feltTexture, plankTexture, printedFeltTexture, rng, softDotTexture, woodTexture } from './textures';

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
  private dust: THREE.Points;
  private dustSeeds: Float32Array;
  private baseSpot = 22;
  private feltBase = feltTexture();
  private feltMat = new THREE.MeshStandardMaterial({ map: this.feltBase, roughness: 0.96 });
  private printedFelt: THREE.CanvasTexture | null = null;

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

    // Low warm bounce off the felt. It was tuned to light the seated figures' faces, which are gone;
    // the value was settled at Gate 2 with the turn light on screen (spec §A3, §A6).
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

    const feltGeo = new THREE.ShapeGeometry(ellipseShape(TABLE_A, TABLE_B), 72);
    feltGeo.rotateX(-Math.PI / 2);
    const felt = new THREE.Mesh(feltGeo, this.feltMat);
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
  }

  // Called only when the seat layout changes, i.e. between hands (spec §A5).
  setFeltPrint(print: FeltPrint): void {
    const next = printedFeltTexture(this.feltBase, print);
    this.feltMat.map = next;
    this.feltMat.needsUpdate = true;
    this.printedFelt?.dispose();
    this.printedFelt = next;
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.spot.castShadow = q !== 'low';
    this.spot.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.spot.shadow.map?.dispose();
    this.spot.shadow.map = null;
    this.dust.visible = q !== 'low';
  }

  update(t: number, still: boolean): void {
    const flick = still
      ? 1
      : 1 + Math.sin(t * 13.1) * 0.025 + Math.sin(t * 7.7 + 1.3) * 0.03 + Math.sin(t * 29) * 0.012;
    this.spot.intensity = this.baseSpot * flick;
    this.fill.intensity = 2.4 * flick;

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
  }
}
