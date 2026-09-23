// Overhead enemy health bars (shown after taking damage, with a trailing "recent damage" chunk) and
// stealth awareness meters (while the enemy is not yet fighting).
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from './depth';
import { hexToInt } from '../ui/colors';
import { TrailBar } from '../ui/TrailBar';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyView } from '../enemies/EnemyView';

export class EnemyBars {
  private g: Phaser.GameObjects.Graphics;
  private trails = new WeakMap<Enemy, TrailBar>();

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.overlay - 3);
  }

  draw(views: Iterable<EnemyView>, dtMs: number) {
    const g = this.g;
    const pal = DATA.palette;
    const fb = DATA.juice.hitFeedback;
    g.clear();
    for (const v of views) {
      const e = v.e;
      if (e.dead || !e.isFighter || e.def.boss) continue; // bosses use the big bar at the bottom of the screen
      let trail = this.trails.get(e);
      if (!trail) this.trails.set(e, (trail = new TrailBar(e.hp)));
      trail.update(e.hp, e.maxHp, dtMs, fb.trailHoldMs, fb.trailDrainPerSec);

      const w = 16;
      const x = v.x - w / 2;
      let y = v.y - e.def.hurtbox.h - 9;
      if (e.barTicks > 0) {
        g.fillStyle(hexToInt(pal.ink), 1).fillRect(x - 1, y - 1, w + 2, 4);
        g.fillStyle(hexToInt(pal.dark2), 1).fillRect(x, y, w, 2);
        g.fillStyle(hexToInt(pal.wax2), 1).fillRect(x, y, Math.round((w * trail.value) / e.maxHp), 2);
        g.fillStyle(hexToInt(pal.blood2), 1).fillRect(x, y, Math.max(1, Math.round((w * e.hp) / e.maxHp)), 2);
        y -= 4;
      }
      const guard = e.def.guard;
      if (guard && e.guardPoints < guard.max) {
        // Shield guard left (steel), shown while it's been worn down.
        g.fillStyle(hexToInt(pal.ink), 1).fillRect(x - 1, y - 1, w + 2, 3);
        g.fillStyle(hexToInt(pal.steel2), 1).fillRect(x, y, Math.round((w * e.guardPoints) / guard.max), 1);
        y -= 3;
      }
      const st = e.stateName;
      if (e.awareness > 0 && (st === 'idle' || st === 'suspicious' || st === 'return')) {
        const aw = 10;
        g.fillStyle(hexToInt(pal.ink), 1).fillRect(v.x - aw / 2 - 1, y - 1, aw + 2, 3);
        g.fillStyle(hexToInt(e.awareness >= e.def.perception.suspicionAt ? pal.flame2 : pal.wax1), 1).fillRect(
          v.x - aw / 2,
          y,
          Math.max(1, Math.round(aw * e.awareness)),
          1,
        );
      }
    }
  }
}
