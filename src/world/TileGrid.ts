// Rooms (data/rooms/*.json) are stitched into one grid per area, in world tile coordinates.
import type { RoomData } from '../data/schemas';
import { hash2 } from '../core/math';

export const TILE = 16;
/** Block: floor under solid decor. Stops movement and bullets like a wall, but not sight, and draws as floor. */
export const Cell = { Void: 0, Floor: 1, Wall: 2, Block: 3 } as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

/** Floor variant names ("floor", "floor_moss"...) share one global index so grids stay plain byte arrays. */
const VARIANTS = ['floor'];
const variantIndex = (name: string) => {
  const i = VARIANTS.indexOf(name);
  return i >= 0 ? i : VARIANTS.push(name) - 1;
};

export class TileGrid {
  readonly cells: Uint8Array;
  readonly variants: Uint8Array;

  /** ox/oy: world tile coordinate of cell (0,0). */
  constructor(readonly w: number, readonly h: number, readonly ox: number, readonly oy: number) {
    this.cells = new Uint8Array(w * h);
    this.variants = new Uint8Array(w * h);
  }

  get(tx: number, ty: number): Cell {
    const x = tx - this.ox;
    const y = ty - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Cell.Void;
    return this.cells[y * this.w + x] as Cell;
  }

  /** Floor variant name of a cell ("floor" for plain floor and anything that isn't floor). */
  variant(tx: number, ty: number): string {
    const x = tx - this.ox;
    const y = ty - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 'floor';
    return VARIANTS[this.variants[y * this.w + x]];
  }

  /** Walkable ground, drawn as floor (plain floor or floor under decor). */
  isGround(tx: number, ty: number) {
    const c = this.get(tx, ty);
    return c === Cell.Floor || c === Cell.Block;
  }

  /**
   * Walls block their whole visual footprint: the wall cell itself, plus the floor cell just above a
   * brick front face, where the wall's top cap is drawn. Otherwise you could stand "inside" the cap.
   */
  isSolid(tx: number, ty: number) {
    if (this.get(tx, ty) !== Cell.Floor) return true;
    return this.get(tx, ty + 1) === Cell.Wall && this.isGround(tx, ty + 2);
  }

  /** Change a cell's type; the floor variant is kept unless given. */
  set(tx: number, ty: number, c: Cell, variant?: string) {
    const i = (ty - this.oy) * this.w + (tx - this.ox);
    this.cells[i] = c;
    if (variant !== undefined) this.variants[i] = variantIndex(variant);
  }
}

/** pad: rock margin (tiles) around the rooms; enough to fill the screen when a small room is centred. */
export function buildGrid(rooms: RoomData[], pad = 12): TileGrid {
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
        g.set(r.origin[0] + x, r.origin[1] + y, cell, kind === 'wall' ? 'floor' : kind);
      });
    });
  }
  return g;
}

/** A tileset manifest's `tiles` block. Floor variants ("floor_moss"...) are extra keys; missing ones fall back to floor. */
export interface TileSet {
  floor: number[];
  wall_front: number[];
  wall_cap: number[];
  /** Solid rock filling the void outside rooms (falls back to a closed wall cap). */
  rock?: number[];
  [variant: string]: number[] | undefined;
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
 * Cap tiles are picked by a 4-bit mask of which sides border open floor (N=1, E=2, S=4, W=8).
 * Void (outside every room) is filled with solid rock, which walls merge into seamlessly.
 */
export function autotile(g: TileGrid, ts: TileSet): { statics: PlacedTile[]; overhang: PlacedTile[] } {
  const wall = (x: number, y: number) => g.get(x, y) === Cell.Wall;
  const floor = (x: number, y: number) => g.isGround(x, y);
  const front = (x: number, y: number) => wall(x, y) && floor(x, y + 1);
  const cap = (x: number, y: number) => (wall(x, y) && !front(x, y)) || (!wall(x, y) && front(x, y + 1));
  const closed = (x: number, y: number) => !floor(x, y) || cap(x, y);
  const rock = ts.rock ?? [ts.wall_cap[0]];
  const mask = (x: number, y: number) =>
    (closed(x, y - 1) ? 0 : 1) | (closed(x + 1, y) ? 0 : 2) | (closed(x, y + 1) ? 0 : 4) | (closed(x - 1, y) ? 0 : 8);
  const pick = (list: number[], x: number, y: number) => list[hash2(x, y) % list.length];

  const statics: PlacedTile[] = [];
  const overhang: PlacedTile[] = [];
  for (let y = g.oy; y < g.oy + g.h; y++) {
    for (let x = g.ox; x < g.ox + g.w; x++) {
      if (floor(x, y)) {
        statics.push({ tx: x, ty: y, index: pick(ts[g.variant(x, y)] ?? ts.floor, x, y) });
        if (front(x, y + 1)) overhang.push({ tx: x, ty: y, index: ts.wall_cap[mask(x, y)] });
      } else if (front(x, y)) {
        statics.push({ tx: x, ty: y, index: pick(ts.wall_front, x, y) });
      } else if (cap(x, y)) {
        statics.push({ tx: x, ty: y, index: ts.wall_cap[mask(x, y)] });
      } else {
        statics.push({ tx: x, ty: y, index: pick(rock, x, y) });
      }
    }
  }
  return { statics, overhang };
}
