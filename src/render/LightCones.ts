// Visible sight cones for enemies with `lightCone` (Mire Lanterns): a pale wedge of light along their gaze,
// cut short by walls and tall decor (the same things that block their sight), so the player can read the
// sweep and hide from it. Brighter once the lantern is suspicious, bright when it has seen you.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEG } from '../core/math';
import { DEPTH } from './depth';
import { TILE } from '../world/TileGrid';
import type { Enemy } from '../enemies/Enemy';
import type { TileGrid } from '../world/TileGrid';

const RAYS = 18;
const STEP = 4;

export class LightCones {
  private g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.shadow + 2);
  }

  draw(enemies: Iterable<Enemy>, grid: TileGrid) {
    const g = this.g.clear();
    for (const e of enemies) {
      const cone = e.def.lightCone;
      if (!cone || e.dead || e.alpha <= 0) continue;
      const half = e.def.perception.halfAngleDeg * DEG;
      const st = e.stateName;
      const alpha = st === 'idle' || st === 'return' ? 0.1 : st === 'suspicious' ? 0.18 : 0.26;
      const color = Phaser.Display.Color.HexStringToColor(DATA.palette[cone.color] ?? DATA.palette.flame2).color;
      const pts: Phaser.Types.Math.Vector2Like[] = [{ x: e.x, y: e.y }];
      for (let i = 0; i <= RAYS; i++) {
        const a = e.facing - half + (2 * half * i) / RAYS;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        let d = STEP;
        for (; d < cone.length; d += STEP)
          if (grid.blocksSight(Math.floor((e.x + dx * d) / TILE), Math.floor((e.y + dy * d) / TILE))) break;
        pts.push({ x: e.x + dx * d, y: e.y + dy * d });
      }
      g.fillStyle(color, alpha).fillPoints(pts, true);
    }
  }
}
