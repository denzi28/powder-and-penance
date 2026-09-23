import { TILE, type TileGrid } from '../world/TileGrid';

/** Walls and tall decor block sight (low wall caps and low decor do not). Samples the segment every 4 px. */
export function lineOfSight(g: TileGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / 4);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    if (g.blocksSight(Math.floor((x0 + (x1 - x0) * k) / TILE), Math.floor((y0 + (y1 - y0) * k) / TILE))) return false;
  }
  return true;
}

/** Vision cone + range + line of sight. halfAngle in radians; pass Math.PI to ignore facing. */
export function canSee(
  g: TileGrid,
  ex: number,
  ey: number,
  facing: number,
  tx: number,
  ty: number,
  range: number,
  halfAngle: number,
): boolean {
  const dx = tx - ex;
  const dy = ty - ey;
  if (Math.hypot(dx, dy) > range) return false;
  if (halfAngle < Math.PI) {
    let d = (Math.atan2(dy, dx) - facing) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > halfAngle) return false;
  }
  return lineOfSight(g, ex, ey, tx, ty);
}
