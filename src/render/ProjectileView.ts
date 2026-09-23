// Draws live projectiles (pooled sprites), interpolated and lifted to their flight height. Lobbed projectiles
// also get a ground shadow and a pulsing warning ring where they will land.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { lerp } from '../core/math';
import { DEPTH } from './depth';
import { hexToInt } from '../ui/colors';
import type { Projectile } from '../combat/Projectiles';
import type { SpriteLib } from '../anim/SpriteLib';

export class ProjectileView {
  private pool: Phaser.GameObjects.Sprite[] = [];
  private g: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private lib: SpriteLib) {
    this.g = scene.add.graphics().setDepth(DEPTH.shadow + 2);
  }

  render(list: readonly Projectile[], alpha: number) {
    while (this.pool.length < list.length) this.pool.push(this.scene.add.sprite(0, 0, '__DEFAULT'));
    const g = this.g;
    g.clear();
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
      const h = Math.round(lerp(p.prevHeight, p.height, alpha));
      s.setPosition(x, y - h)
        .setRotation(p.lob ? p.lob.t * 0.35 : p.angle) // pots tumble
        .setDepth(DEPTH.actor(y) + 0.5);
      if (p.lob && p.def.lob) {
        const k = Math.min(1, p.lob.t / p.def.lob.flightTicks);
        const r = p.def.lob.blastRadius;
        // Warning ring (flattened for the 3/4 view), brighter as the landing nears.
        g.lineStyle(1, hexToInt(DATA.palette.ember), 0.35 + 0.6 * k);
        g.strokeEllipse(p.lob.tx, p.lob.ty, r * 2, r * 1.3);
        g.fillStyle(hexToInt(DATA.palette.ember), 0.08 + 0.2 * k);
        g.fillEllipse(p.lob.tx, p.lob.ty, r * 2 * k, r * 1.3 * k);
        g.fillStyle(hexToInt(DATA.palette.ink), 0.35);
        g.fillEllipse(x, y, 6, 3); // shadow under the pot
      }
    });
  }
}
