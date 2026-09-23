// Doors in wall gaps. A closed door turns its grid cell into a wall (blocks movement, sight, projectiles,
// paths); opening it restores the floor for good (world flag "door:<id>").
// A shortcut door (entity field `opensFrom`: N/S/E/W) only opens from that side; from the other side it is
// "barred from beyond" until opened.
import Phaser from 'phaser';
import { DEPTH } from '../render/depth';
import { Cell, TILE, type TileGrid } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export type Side = 'N' | 'S' | 'E' | 'W';

export interface Door {
  id: string;
  tx: number;
  ty: number;
  /** h = in a horizontal wall (seen face-on); v = in a vertical wall (seen from above). */
  orient: 'h' | 'v';
  open: boolean;
  opensFrom: Side | null;
  sprite: Phaser.GameObjects.Sprite;
}

const REACH = 30;

export class Doors {
  list: Door[] = [];

  constructor(private lib: SpriteLib) {}

  /** Call after the grid is built and rendered: closed doors are written into the grid as walls. */
  build(rooms: RoomData[], grid: TileGrid, isOpen: (id: string) => boolean) {
    this.list.forEach(d => d.sprite.destroy());
    this.list = [];
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'door' || !en.id) continue;
        const tx = r.origin[0] + en.at[0];
        const ty = r.origin[1] + en.at[1];
        if (this.list.some(d => d.tx === tx && d.ty === ty)) continue; // same door listed by both rooms
        const orient = grid.get(tx - 1, ty) === Cell.Wall && grid.get(tx + 1, ty) === Cell.Wall ? 'h' : 'v';
        const sprite = this.lib
          .sprite('door')
          .setFrame(orient === 'h' ? 0 : 1)
          .setPosition(tx * TILE + TILE / 2, ty * TILE + TILE)
          .setDepth(orient === 'h' ? DEPTH.actor(ty * TILE + TILE) : DEPTH.floor + 2);
        const door: Door = { id: en.id, tx, ty, orient, open: false, opensFrom: (en.opensFrom as Side) ?? null, sprite };
        this.list.push(door);
        this.setOpen(door, grid, isOpen(en.id));
      }
  }

  setOpen(d: Door, grid: TileGrid, open: boolean) {
    d.open = open;
    grid.set(d.tx, d.ty, open ? Cell.Floor : Cell.Wall);
    d.sprite.setVisible(!open);
  }

  /** Nearest closed door within reach. */
  nearest(x: number, y: number): Door | null {
    let best: Door | null = null;
    let bd = REACH;
    for (const d of this.list) {
      if (d.open) continue;
      const dist = Math.hypot(d.tx * TILE + TILE / 2 - x, d.ty * TILE + TILE / 2 - y);
      if (dist <= bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /** Is (x, y) on the side a one-way door opens from? */
  canOpenFrom(d: Door, x: number, y: number): boolean {
    if (!d.opensFrom) return true;
    const cx = d.tx * TILE + TILE / 2;
    const cy = d.ty * TILE + TILE / 2;
    switch (d.opensFrom) {
      case 'N':
        return y < cy;
      case 'S':
        return y > cy;
      case 'W':
        return x < cx;
      case 'E':
        return x > cx;
    }
  }
}
