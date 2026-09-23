// Spilled wax (strike.pools): slowing puddles laid during a fight. Anyone wading one moves at its
// speedMult, like on a wax floor tile. A pool spreads out over a few ticks, sits, then shrinks away when
// its time is up. They belong to the fight: the world reset clears them.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';

export interface Pool {
  x: number;
  y: number;
  /** Full radius (px); the pool is drawn and felt as an ellipse `r` wide, `r * FLAT` tall. */
  r: number;
  t: number;
  ticks: number;
  speedMult: number;
}

/** Older pools set first once there are this many. */
const MAX_POOLS = 16;
const SPREAD_TICKS = 14;
const SHRINK_TICKS = 40;
const FLAT = 0.6;

export class WaxPools {
  list: Pool[] = [];
  private g: Phaser.GameObjects.Graphics | null = null;

  add(x: number, y: number, r: number, ticks: number, speedMult: number) {
    this.list.push({ x, y, r, t: 0, ticks, speedMult });
    if (this.list.length > MAX_POOLS) this.list.shift();
  }

  tick() {
    for (const p of this.list) p.t++;
    this.list = this.list.filter(p => p.t < p.ticks);
  }

  /** Current radius: spreading out, full, then shrinking as it sets. */
  radius(p: Pool) {
    const grow = Math.min(1, p.t / SPREAD_TICKS);
    const set = Math.min(1, (p.ticks - p.t) / SHRINK_TICKS);
    return p.r * Math.min(grow, set);
  }

  /** Movement multiplier at (x, y): the slowest pool underfoot, or 1. */
  mult(x: number, y: number): number {
    let m = 1;
    for (const p of this.list) {
      const r = this.radius(p);
      if (r <= 0) continue;
      const dx = (x - p.x) / r;
      const dy = (y - p.y) / (r * FLAT);
      if (dx * dx + dy * dy <= 1) m = Math.min(m, p.speedMult);
    }
    return m;
  }

  clear() {
    this.list = [];
    this.g?.clear();
  }

  /** Flat molten puddles on the floor: a dark rim, the pale wax, a glint. */
  draw(scene: Phaser.Scene) {
    this.g ??= scene.add.graphics().setDepth(DEPTH.floor + 2);
    const g = this.g.clear();
    const pal = DATA.palette;
    for (const p of this.list) {
      const r = Math.round(this.radius(p));
      if (r < 2) continue;
      const ry = Math.max(1, Math.round(r * FLAT));
      g.fillStyle(hexToInt(pal.ember), 0.55).fillEllipse(p.x, p.y + 1, r * 2 + 2, ry * 2 + 2);
      g.fillStyle(hexToInt(pal.wax1), 0.92).fillEllipse(p.x, p.y, r * 2, ry * 2);
      g.fillStyle(hexToInt(pal.wax2), 0.9).fillEllipse(p.x - r * 0.3, p.y - ry * 0.3, r * 0.7, ry * 0.6);
    }
  }
}
