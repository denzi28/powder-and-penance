// A weapon sprite held in an actor's hand: rotates around its grip (the sprite pivot), flips vertically
// when pointing left, and draws behind the body when pointing into the "up" arc.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEG, normDeg } from '../core/math';
import type { SpriteLib } from '../anim/SpriteLib';

export class HeldWeapon {
  readonly sprite: Phaser.GameObjects.Sprite;
  private current = '';
  /** World position of the blade tip / muzzle after the last place(). */
  tipX = 0;
  tipY = 0;

  constructor(scene: Phaser.Scene, private lib: SpriteLib) {
    this.sprite = scene.add.sprite(0, 0, '__DEFAULT');
  }

  setSprite(name: string) {
    if (name === this.current) return;
    this.current = name;
    this.sprite.setTexture(name, 0);
    this.lib.applyOrigin(this.sprite, name);
  }

  place(handX: number, handY: number, angle: number, reach: number, bodyDepth: number) {
    const left = Math.cos(angle) < 0;
    const x = Math.round(handX + Math.cos(angle) * reach);
    const y = Math.round(handY + Math.sin(angle) * reach);
    const [a0, a1] = DATA.player.weaponBehindArcDeg;
    const deg = normDeg(angle / DEG);
    const behind = deg >= a0 && deg <= a1;
    this.sprite
      .setPosition(x, y)
      .setRotation(angle)
      .setScale(1, left ? -1 : 1)
      .setDepth(bodyDepth + (behind ? -0.05 : 0.2));

    const m = this.lib.manifest(this.current);
    const tip = m.points?.tip ?? m.points?.muzzle ?? [m.cell[0], m.pivot[1]];
    const len = tip[0] - m.pivot[0];
    this.tipX = x + Math.cos(angle) * len;
    this.tipY = y + Math.sin(angle) * len;
  }

  setVisible(v: boolean) {
    this.sprite.setVisible(v);
  }

  destroy() {
    this.sprite.destroy();
  }
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
