import * as THREE from 'three';
import type { Card } from '@poker-blackjack/game-engine';
import { CARD_H, CARD_W, TABLE_Y } from '../sceneModel';
import { cardBackTexture, cardFaceTexture } from './textures';
import { Tweens, easeInOutCubic, easeOutCubic } from './tween';

const geometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
let backTexture: THREE.CanvasTexture | null = null;
let backMaterial: THREE.MeshStandardMaterial | null = null;

function sharedBackMaterial(): THREE.MeshStandardMaterial {
  backTexture ??= cardBackTexture();
  backMaterial ??= new THREE.MeshStandardMaterial({
    map: backTexture,
    color: 0x877c67,
    roughness: 0.82,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
  return backMaterial;
}

export interface CardTarget {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

// One physical card: `group` carries table-plane position and yaw; `flipper`
// carries the face-up/face-down pitch so a flip is a single rotation.
export class CardObject {
  readonly group = new THREE.Group();
  private flipper = new THREE.Group();
  private front: THREE.Mesh;
  private frontMat: THREE.MeshStandardMaterial;
  card: Card | null = null;
  faceUp = false;
  landed = false;
  target: CardTarget = { x: 0, y: TABLE_Y, z: 0, rotY: 0 };

  constructor(private tweens: Tweens) {
    this.frontMat = new THREE.MeshStandardMaterial({
      color: 0x7d735f,
      roughness: 0.78,
      alphaTest: 0.5,
      transparent: false,
    });
    this.front = new THREE.Mesh(geometry, this.frontMat);
    const back = new THREE.Mesh(geometry, sharedBackMaterial());
    back.rotation.y = Math.PI;
    back.position.z = -0.0006;
    this.front.position.z = 0.0006;
    // No cast shadows: a card in flight throws a large hard-edged dark rectangle across the felt.
    this.front.castShadow = back.castShadow = false;
    this.front.receiveShadow = back.receiveShadow = true;
    this.flipper.add(this.front, back);
    this.group.add(this.flipper);
    // Face-up lies with +z (the face) pointing up: pitch -90deg. Face-down: +90deg.
    this.flipper.rotation.x = Math.PI / 2;
  }

  setCard(card: Card | null): void {
    this.card = card;
    if (card) {
      this.frontMat.map = cardFaceTexture(card);
      this.frontMat.needsUpdate = true;
    }
  }

  // A winning card at a showdown glows warm (base spec §B2); off again for the next hand.
  setHighlight(on: boolean): void {
    this.frontMat.emissive.setHex(on ? 0xffb45a : 0x000000);
    this.frontMat.emissiveIntensity = on ? 0.35 : 0;
  }

  placeAt(t: CardTarget): void {
    this.group.position.set(t.x, t.y, t.z);
    this.group.rotation.y = t.rotY;
    this.target = t;
  }

  moveTo(t: CardTarget, opts: { duration: number; delay: number; arc: number; onLand?: () => void }): void {
    const from = {
      x: this.group.position.x,
      y: this.group.position.y,
      z: this.group.position.z,
      rotY: this.group.rotation.y,
    };
    this.target = t;
    this.tweens.add({
      duration: opts.duration,
      delay: opts.delay,
      ease: easeOutCubic,
      onUpdate: (p) => {
        this.group.position.set(
          from.x + (t.x - from.x) * p,
          from.y + (t.y - from.y) * p + Math.sin(Math.PI * p) * opts.arc,
          from.z + (t.z - from.z) * p,
        );
        this.group.rotation.y = from.rotY + (t.rotY - from.rotY) * p;
      },
      onDone: () => {
        this.landed = true;
        opts.onLand?.();
      },
    });
  }

  flip(faceUp: boolean, delay: number, onDone?: () => void): void {
    if (this.faceUp === faceUp) return;
    this.faceUp = faceUp;
    const from = this.flipper.rotation.x;
    const to = faceUp ? -Math.PI / 2 : Math.PI / 2;
    const baseY = this.group.position.y;
    this.tweens.add({
      duration: 0.42,
      delay,
      ease: easeInOutCubic,
      onUpdate: (p) => {
        this.flipper.rotation.x = from + (to - from) * p;
        this.group.position.y = Math.max(baseY, this.target.y) + Math.sin(Math.PI * p) * 0.05;
      },
      onDone: () => {
        this.group.position.y = this.target.y;
        onDone?.();
      },
    });
  }

  setFaceUpImmediate(faceUp: boolean): void {
    this.faceUp = faceUp;
    this.flipper.rotation.x = faceUp ? -Math.PI / 2 : Math.PI / 2;
  }

  dispose(): void {
    this.frontMat.dispose();
  }
}
