// Draws live projectiles (pooled sprites), interpolated and lifted to flight height.
import Phaser from 'phaser';
import { lerp } from '../core/math';
import { DEPTH } from './depth';
import { PROJECTILE_HEIGHT, type Projectile } from '../combat/Projectiles';
import type { SpriteLib } from '../anim/SpriteLib';

export class ProjectileView {
  private pool: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: Phaser.Scene, private lib: SpriteLib) {}

  render(list: readonly Projectile[], alpha: number) {
    while (this.pool.length < list.length) this.pool.push(this.scene.add.sprite(0, 0, '__DEFAULT'));
    this.pool.forEach((s, i) => {
      const p = list[i];
      s.setVisible(!!p);
      if (!p) return;
      if (s.texture.key !== p.def.sprite) {
        s.setTexture(p.def.sprite, 0);
        this.lib.applyOrigin(s, p.def.sprite);
      }
      const x = Math.round(lerp(p.prevX, p.x, alpha));
      const y = Math.round(lerp(p.prevY, p.y, alpha));
      s.setPosition(x, y - PROJECTILE_HEIGHT).setRotation(p.angle).setDepth(DEPTH.actor(y) + 0.5);
    });
  }
}
