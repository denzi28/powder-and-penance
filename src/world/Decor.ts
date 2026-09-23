// Static scenery (data/decor.json): wrecks, boulders, corpses, trees. Purely visual, except that a decor's
// `blocks` tiles become Block cells: solid for movement and bullets, see-through for perception.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { Cell, TILE, type TileGrid } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export class Decor {
  private sprites: Phaser.GameObjects.Sprite[] = [];

  constructor(private lib: SpriteLib) {}

  /** Anchor = bottom-centre of the entity's tile; the sprite's pivot sits there. */
  build(rooms: RoomData[], grid: TileGrid) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'decor') continue;
        const def = DATA.decor.decor[String(en.kind)];
        const tx = r.origin[0] + en.at[0];
        const ty = r.origin[1] + en.at[1];
        const x = tx * TILE + TILE / 2;
        const y = ty * TILE + TILE;
        const s = this.lib
          .sprite(def.sprite)
          .setFrame(def.frame)
          .setPosition(x, y)
          .setFlipX(en.flip === true)
          .setDepth(def.flat ? DEPTH.floor + 1 : DEPTH.actor(y));
        this.sprites.push(s);
        for (const [dx, dy] of def.blocks) {
          const bx = tx + (en.flip === true ? -dx : dx);
          if (grid.get(bx, ty + dy) === Cell.Floor) grid.set(bx, ty + dy, Cell.Block);
        }
      }
  }

  clear() {
    this.sprites.forEach(s => s.destroy());
    this.sprites = [];
  }
}
