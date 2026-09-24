// Grid A* (8-directional, no corner cutting) plus line-of-walk checks for path smoothing.
// Works on the TileGrid's solidity (walls and the floor tiles under wall caps are blocked).
import { TILE, type TileGrid } from './TileGrid';

export interface Point {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Minimal binary min-heap keyed by f-score. */
class Heap {
  private items: { key: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(key: number, f: number) {
    const a = this.items;
    a.push({ key, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.key;
  }
}

export class Pathfinder {
  constructor(private grid: () => TileGrid) {}

  /**
   * Can a box of half-width `hw` walk in a straight line from a to b? Samples the segment every 4 px and
   * tests the two edges of the swept box.
   */
  clearLine(ax: number, ay: number, bx: number, by: number, hw: number): boolean {
    const g = this.grid();
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(d / 4));
    const nx = d > 0 ? -(by - ay) / d : 0;
    const ny = d > 0 ? (bx - ax) / d : 0;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const x = ax + (bx - ax) * k;
      const y = ay + (by - ay) * k - 2; // test at the collider's centre, just above the feet
      for (const s of [-hw, 0, hw])
        if (g.isSolid(Math.floor((x + nx * s) / TILE), Math.floor((y + ny * s) / TILE))) return false;
    }
    return true;
  }

  /**
   * Can a body of half-width `hw` stand centred on tile (x, y)? A body wider than a tile needs the tiles on
   * either side open too (bodies are shallow, so only their width matters).
   */
  fits(x: number, y: number, hw: number): boolean {
    const g = this.grid();
    const cx = x * TILE + TILE / 2;
    for (let tx = Math.floor((cx - hw) / TILE); tx <= Math.floor((cx + hw) / TILE); tx++) if (g.isSolid(tx, y)) return false;
    return true;
  }

  /** The tile nearest to a world point (within `r` tiles) where a body of half-width `hw` fits; null if none. */
  nearestFit(px: number, py: number, hw: number, r = 3): Point | null {
    const x0 = Math.floor(px / TILE);
    const y0 = Math.floor((py - 2) / TILE);
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (!this.fits(x0 + dx, y0 + dy, hw)) continue;
        const d = Math.hypot((x0 + dx) * TILE + TILE / 2 - px, (y0 + dy) * TILE + TILE / 2 + 2 - py);
        if (!best || d < best.d) best = { x: x0 + dx, y: y0 + dy, d };
      }
    return best ? { x: best.x * TILE + TILE / 2, y: best.y * TILE + TILE / 2 + 2 } : null;
  }

  /**
   * Waypoints (world px, tile centres, smoothed) from (sx,sy) to (tx,ty), or null if unreachable. Planned for
   * the body's width first (a big boss isn't sent through a one-tile gap it can't fit), then, if nothing fits,
   * as for a one-tile body. A start or goal where the body doesn't fit (wedged at a wall, a player standing
   * against one) is moved to the nearest place it does.
   */
  find(sx: number, sy: number, tx: number, ty: number, hw: number, maxNodes = 4000): Point[] | null {
    if (hw > TILE / 2) {
      const wide = this.search(sx, sy, tx, ty, hw, (x, y) => this.fits(x, y, hw), maxNodes);
      if (wide) return wide;
    }
    const g = this.grid();
    return this.search(sx, sy, tx, ty, hw, (x, y) => !g.isSolid(x, y), maxNodes);
  }

  private search(sx: number, sy: number, tx: number, ty: number, hw: number, open: (x: number, y: number) => boolean, maxNodes: number): Point[] | null {
    const g = this.grid();
    const W = g.w;
    const toKey = (x: number, y: number) => (y - g.oy) * W + (x - g.ox);
    // the nearest tile (within 3) that's open for this body
    const near = (x: number, y: number) => {
      if (open(x, y)) return { x, y };
      for (let r = 1; r <= 3; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && open(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      return null;
    };
    const s = near(Math.floor(sx / TILE), Math.floor((sy - 2) / TILE));
    const t = near(Math.floor(tx / TILE), Math.floor((ty - 2) / TILE));
    if (!s || !t) return null;

    const startKey = toKey(s.x, s.y);
    const goalKey = toKey(t.x, t.y);
    const gScore = new Map<number, number>([[startKey, 0]]);
    const came = new Map<number, number>();
    const heap = new Heap();
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - t.x);
      const dy = Math.abs(y - t.y);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    heap.push(startKey, h(s.x, s.y));
    let expanded = 0;
    while (heap.size && expanded++ < maxNodes) {
      const cur = heap.pop();
      if (cur === goalKey) return this.smooth(this.rebuild(came, cur, g), sx, sy, tx, ty, hw);
      const cx = (cur % W) + g.ox;
      const cy = Math.floor(cur / W) + g.oy;
      const cg = gScore.get(cur)!;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!open(nx, ny)) continue;
        if (dx && dy && (!open(cx + dx, cy) || !open(cx, cy + dy))) continue; // no corner cutting
        const nk = toKey(nx, ny);
        const ng = cg + cost;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng);
          came.set(nk, cur);
          heap.push(nk, ng + h(nx, ny));
        }
      }
    }
    return null;
  }

  private rebuild(came: Map<number, number>, end: number, g: TileGrid): Point[] {
    const pts: Point[] = [];
    for (let k: number | undefined = end; k !== undefined; k = came.get(k)) {
      const x = (k % g.w) + g.ox;
      const y = Math.floor(k / g.w) + g.oy;
      pts.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 + 2 });
    }
    return pts.reverse();
  }

  /** String-pulling: skip every waypoint that can be reached in a straight, clear line. */
  private smooth(pts: Point[], sx: number, sy: number, tx: number, ty: number, hw: number): Point[] {
    pts[pts.length - 1] = { x: tx, y: ty };
    const out: Point[] = [];
    let from = { x: sx, y: sy };
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(from.x, from.y, pts[j].x, pts[j].y, hw)) j--;
      out.push(pts[j]);
      from = pts[j];
      i = j + 1;
    }
    return out;
  }
}
