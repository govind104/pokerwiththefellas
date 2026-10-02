import * as THREE from 'three';
import { CHIP_R } from '../layout';
import { TABLE_Y, chipsFor } from '../sceneModel';
import { chipSideTexture, chipTopTexture } from './textures';
import { Tweens, easeOutCubic } from './tween';

const CHIP_H = 0.0055;
const geometry = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28);

interface Denom {
  main: string;
  stripe: string;
}

const STYLE: Record<number, Denom> = {
  1: { main: '#d8ccb0', stripe: '#6a5a3a' },
  5: { main: '#8f2f24', stripe: '#e6d9b6' },
  25: { main: '#2f5a3a', stripe: '#e6d9b6' },
  100: { main: '#1d1a17', stripe: '#c9a24e' },
  500: { main: '#4a2a5a', stripe: '#e6d9b6' },
};

const materialCache = new Map<number, THREE.Material[]>();

function materialsFor(denom: number): THREE.Material[] {
  const cached = materialCache.get(denom);
  if (cached) return cached;
  const s = STYLE[denom] ?? STYLE[1];
  const side = new THREE.MeshStandardMaterial({ map: chipSideTexture(s.main, s.stripe), roughness: 0.55 });
  const top = new THREE.MeshStandardMaterial({ map: chipTopTexture(s.main, s.stripe, String(denom)), roughness: 0.5 });
  const mats = [side, top, top];
  materialCache.set(denom, mats);
  return mats;
}

export class ChipStackObject {
  readonly group = new THREE.Group();
  amount = -1;
  private chips: THREE.Mesh[] = [];

  constructor(private tweens: Tweens, private onClack: () => void) {}

  // (Re)builds the stack. Existing chips stay put; only the difference drops in,
  // so raising a bet visibly adds chips instead of teleporting a new pile.
  setAmount(amount: number, animate: boolean): void {
    if (amount === this.amount) return;
    this.amount = amount;
    const denoms = chipsFor(amount);

    while (this.chips.length > denoms.length) {
      const c = this.chips.pop();
      if (c) this.group.remove(c);
    }
    denoms.forEach((d, i) => {
      let chip = this.chips[i];
      const isNew = !chip;
      if (!chip) {
        chip = new THREE.Mesh(geometry, materialsFor(d));
        chip.castShadow = chip.receiveShadow = true;
        this.chips.push(chip);
        this.group.add(chip);
      } else {
        chip.material = materialsFor(d);
      }
      // Slightly untidy stack.
      const jx = Math.sin(i * 12.9898) * 0.0022;
      const jz = Math.cos(i * 78.233) * 0.0022;
      const restY = CHIP_H * i + CHIP_H / 2;
      chip.rotation.y = i * 0.7;
      if (isNew && animate) {
        chip.position.set(jx, restY + 0.16, jz);
        this.tweens.add({
          duration: 0.28,
          delay: 0.05 * i,
          ease: easeOutCubic,
          onUpdate: (p) => {
            chip.position.y = restY + 0.16 * (1 - p);
          },
          onDone: () => this.onClack(),
        });
      } else {
        chip.position.set(jx, restY, jz);
      }
    });
  }

  placeAt(x: number, z: number): void {
    this.group.position.set(x, TABLE_Y + 0.003, z);
  }

  dispose(): void {
    // Geometry and materials are shared module-level caches.
  }
}
