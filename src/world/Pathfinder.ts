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

  /** Waypoints (world px, tile centres, smoothed) from (sx,sy) to (tx,ty), or null if unreachable. */
  find(sx: number, sy: number, tx: number, ty: number, hw: number, maxNodes = 4000): Point[] | null {
    const g = this.grid();
    const W = g.w;
    const toKey = (x: number, y: number) => (y - g.oy) * W + (x - g.ox);
    const open = (x: number, y: number) => !g.isSolid(x, y);
    let s = { x: Math.floor(sx / TILE), y: Math.floor((sy - 2) / TILE) };
    const t = { x: Math.floor(tx / TILE), y: Math.floor((ty - 2) / TILE) };
    if (!open(s.x, s.y)) {
      // Nudged into a wall edge (knockback, separation): start from the nearest open neighbour.
      const n = DIRS.map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy })).find(p => open(p.x, p.y));
      if (!n) return null;
      s = n;
    }
    if (!open(t.x, t.y)) return null;

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
