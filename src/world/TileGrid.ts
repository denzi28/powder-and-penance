// Rooms (data/rooms/*.json) are stitched into one grid per area, in world tile coordinates.
import type { RoomData } from '../data/schemas';
import { hash2 } from '../core/math';

export const TILE = 16;
export const Cell = { Void: 0, Floor: 1, Wall: 2 } as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

export class TileGrid {
  readonly cells: Uint8Array;
  readonly moss: Uint8Array;

  /** ox/oy: world tile coordinate of cell (0,0). */
  constructor(readonly w: number, readonly h: number, readonly ox: number, readonly oy: number) {
    this.cells = new Uint8Array(w * h);
    this.moss = new Uint8Array(w * h);
  }

  get(tx: number, ty: number): Cell {
    const x = tx - this.ox;
    const y = ty - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Cell.Void;
    return this.cells[y * this.w + x] as Cell;
  }

  isMoss(tx: number, ty: number) {
    const x = tx - this.ox;
    const y = ty - this.oy;
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.moss[y * this.w + x] === 1;
  }

  /**
   * Walls block their whole visual footprint: the wall cell itself, plus the floor cell just above a
   * brick front face, where the wall's top cap is drawn. Otherwise you could stand "inside" the cap.
   */
  isSolid(tx: number, ty: number) {
    if (this.get(tx, ty) !== Cell.Floor) return true;
    return this.get(tx, ty + 1) === Cell.Wall && this.get(tx, ty + 2) === Cell.Floor;
  }

  set(tx: number, ty: number, c: Cell, moss = false) {
    const i = (ty - this.oy) * this.w + (tx - this.ox);
    this.cells[i] = c;
    this.moss[i] = moss ? 1 : 0;
  }
}

export function buildGrid(rooms: RoomData[], pad = 2): TileGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.origin[0]);
    minY = Math.min(minY, r.origin[1]);
    maxX = Math.max(maxX, r.origin[0] + r.tiles[0].length);
    maxY = Math.max(maxY, r.origin[1] + r.tiles.length);
  }
  const g = new TileGrid(maxX - minX + pad * 2, maxY - minY + pad * 2, minX - pad, minY - pad);
  for (const r of rooms) {
    r.tiles.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const kind = r.legend[ch];
        if (kind === 'void') return;
        const cell = kind === 'wall' ? Cell.Wall : Cell.Floor;
        g.set(r.origin[0] + x, r.origin[1] + y, cell, kind === 'floor_moss');
      });
    });
  }
  return g;
}

export interface TileSet {
  floor: number[];
  floor_moss: number[];
  wall_front: number[];
  wall_cap: number[];
}
export interface PlacedTile {
  tx: number;
  ty: number;
  index: number;
}

/**
 * 3/4-view wall autotiling. Authors only place walls; for each wall with floor directly south we draw a
 * brick front face on that cell and a top cap on the cell above it. Caps that land on walkable floor are
 * returned as `overhang` so they can be depth-sorted above actors standing "behind" the wall.
 * Cap tiles are picked by a 4-bit mask of which sides border open space (N=1, E=2, S=4, W=8).
 */
export function autotile(g: TileGrid, ts: TileSet): { statics: PlacedTile[]; overhang: PlacedTile[] } {
  const wall = (x: number, y: number) => g.get(x, y) === Cell.Wall;
  const floor = (x: number, y: number) => g.get(x, y) === Cell.Floor;
  const front = (x: number, y: number) => wall(x, y) && floor(x, y + 1);
  const cap = (x: number, y: number) => (wall(x, y) && !front(x, y)) || (!wall(x, y) && front(x, y + 1));
  const closed = (x: number, y: number) => cap(x, y) || front(x, y);
  const mask = (x: number, y: number) =>
    (closed(x, y - 1) ? 0 : 1) | (closed(x + 1, y) ? 0 : 2) | (closed(x, y + 1) ? 0 : 4) | (closed(x - 1, y) ? 0 : 8);
  const pick = (list: number[], x: number, y: number) => list[hash2(x, y) % list.length];

  const statics: PlacedTile[] = [];
  const overhang: PlacedTile[] = [];
  for (let y = g.oy; y < g.oy + g.h; y++) {
    for (let x = g.ox; x < g.ox + g.w; x++) {
      if (floor(x, y)) {
        statics.push({ tx: x, ty: y, index: pick(g.isMoss(x, y) ? ts.floor_moss : ts.floor, x, y) });
        if (front(x, y + 1)) overhang.push({ tx: x, ty: y, index: ts.wall_cap[mask(x, y)] });
      } else if (front(x, y)) {
        statics.push({ tx: x, ty: y, index: pick(ts.wall_front, x, y) });
      } else if (cap(x, y)) {
        statics.push({ tx: x, ty: y, index: ts.wall_cap[mask(x, y)] });
      }
    }
  }
  return { statics, overhang };
}
