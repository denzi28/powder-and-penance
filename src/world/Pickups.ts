// Placed items (data/items), each inside a chest. Press E to open it: the lid rises over OPEN_TICKS while
// the player keeps full control, and the item pops out at POP_TICK. Opening sets the world flag
// "item:<id>"; opened chests stay open (and empty) for good. Chests are solid.
import Phaser from 'phaser';
import { DEPTH } from '../render/depth';
import { Cell, TILE, type TileGrid } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export interface Chest {
  id: string;
  item: string;
  x: number;
  y: number;
  state: 'closed' | 'opening' | 'open';
  /** Ticks since opening started. */
  t: number;
  sprite: Phaser.GameObjects.Sprite;
  glint: Phaser.GameObjects.Sprite;
  /** Half-buried (a chest that rose out of the ground mid-fight); uses the sheet's buried frames. */
  buried: boolean;
  /** Pixels still sunk below the floor while rising (0 = risen). */
  rise: number;
  /** Placed at runtime (not from room data); its tile is released again when removed. */
  dynamic: { tx: number; ty: number } | null;
}

/** Reach from the player's feet to the chest's base (the chest is solid, so you stand beside it). */
const REACH = 22;
export const OPEN_TICKS = 25;
export const POP_TICK = 10;
/** Frame by opening tick: lid lifting (1), light spilling (2, 3), then open and empty (4). */
const OPEN_FRAMES: [number, number][] = [
  [0, 1],
  [4, 2],
  [10, 3],
  [OPEN_TICKS, 4],
];

export class Pickups {
  list: Chest[] = [];
  private glintT = 0;

  constructor(private lib: SpriteLib) {}

  /** Chest tiles are made solid by markObstacles (world/Obstacles.ts). */
  build(rooms: RoomData[], taken: (id: string) => boolean) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'item' || !en.id) continue;
        const tx = r.origin[0] + en.at[0];
        const ty = r.origin[1] + en.at[1];
        const x = tx * TILE + TILE / 2;
        const y = ty * TILE + TILE - 2;
        const open = taken(en.id);
        const sprite = this.lib.sprite('chest').setFrame(open ? 4 : 0).setPosition(x, y).setDepth(DEPTH.actor(y));
        const glint = this.lib.sprite('item_glint').setPosition(x + 4, y - 11).setDepth(DEPTH.actor(y) + 0.1).setVisible(!open);
        this.list.push({ id: en.id, item: String(en.item), x, y, state: open ? 'open' : 'closed', t: 0, sprite, glint, buried: false, rise: 0, dynamic: null });
      }
  }

  /** A chest that rises half-buried out of the floor at a tile (e.g. after a boss's first phase). */
  addDynamic(id: string, item: string, tx: number, ty: number, taken: boolean, grid: TileGrid) {
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE + TILE - 2;
    const sprite = this.lib.sprite('chest').setPosition(x, y).setDepth(DEPTH.actor(y));
    const glint = this.lib.sprite('item_glint').setPosition(x + 4, y - 7).setDepth(DEPTH.actor(y) + 0.1).setVisible(false);
    this.list.push({ id, item, x, y, state: taken ? 'open' : 'closed', t: 0, sprite, glint, buried: true, rise: 14, dynamic: { tx, ty } });
    if (grid.get(tx, ty) === Cell.Floor) grid.set(tx, ty, Cell.Block);
  }

  /** Remove every runtime chest (the fight that raised it was reset). */
  removeDynamic(grid: TileGrid) {
    for (const c of this.list.filter(c => c.dynamic)) {
      if (grid.get(c.dynamic!.tx, c.dynamic!.ty) === Cell.Block) grid.set(c.dynamic!.tx, c.dynamic!.ty, Cell.Floor);
      c.sprite.destroy();
      c.glint.destroy();
    }
    this.list = this.list.filter(c => !c.dynamic);
  }

  /** Nearest closed chest within reach. */
  nearest(x: number, y: number): Chest | null {
    let best: Chest | null = null;
    let bd = REACH;
    for (const c of this.list) {
      if (c.state !== 'closed') continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  open(c: Chest) {
    c.state = 'opening';
    c.t = 0;
    c.glint.setVisible(false);
  }

  /** Per sim tick: advance opening chests. Returns the chests whose item pops out this tick. */
  tick(): Chest[] {
    const popped: Chest[] = [];
    for (const c of this.list) {
      if (c.state !== 'opening') continue;
      c.t++;
      if (c.t === POP_TICK) popped.push(c);
      if (c.t >= OPEN_TICKS) c.state = 'open';
    }
    return popped;
  }

  update(deltaMs: number) {
    this.glintT += deltaMs;
    // The glint twinkles now and then so closed chests catch the eye without constant noise.
    const cycle = this.glintT % 1600;
    const glintFrame = cycle < 400 ? Math.floor(cycle / 100) % 4 : -1;
    for (const c of this.list) {
      const base = c.buried ? 5 : 0; // frames 5-9: the same chest, half sunk in the floor
      if (c.rise > 0) c.rise = Math.max(0, c.rise - deltaMs / 50);
      c.sprite.setY(Math.round(c.y + c.rise));
      if (c.state === 'closed') {
        c.sprite.setFrame(base);
        c.glint.setVisible(glintFrame >= 0 && c.rise === 0);
        if (glintFrame >= 0) c.glint.setFrame(this.lib.frame('item_glint', 'shine', 'S', glintFrame).frame);
      } else {
        let f = 4;
        if (c.state === 'opening') for (const [at, frame] of OPEN_FRAMES) if (c.t >= at) f = frame;
        c.sprite.setFrame(base + f);
      }
    }
  }

  clear() {
    for (const c of this.list) {
      c.sprite.destroy();
      c.glint.destroy();
    }
    this.list = [];
  }
}
