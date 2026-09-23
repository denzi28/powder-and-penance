// Levers: pull once (E), and they stay pulled for good (world flag "lever:<id>"). Room entity:
//   { "type": "lever", "id", "at": [x, y], "script"?: "<script id>" }
// The flag is what things check (e.g. a lift exit's `when`); the optional script tells the player what moved.
import Phaser from 'phaser';
import { DEPTH } from '../render/depth';
import { TILE } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export interface Lever {
  id: string;
  x: number;
  y: number;
  script: string | null;
  sprite: Phaser.GameObjects.Sprite;
}

const REACH = 22;

export class Levers {
  list: Lever[] = [];

  constructor(private lib: SpriteLib) {}

  build(rooms: RoomData[], pulled: (id: string) => boolean) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'lever' || !en.id) continue;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 2;
        const sprite = this.lib.sprite('lever').setPosition(x, y).setDepth(DEPTH.actor(y)).setFrame(pulled(en.id) ? 1 : 0);
        this.list.push({ id: en.id, x, y, script: en.script === undefined ? null : String(en.script), sprite });
      }
  }

  /** Nearest unpulled lever within reach. */
  nearest(x: number, y: number, pulled: (id: string) => boolean): Lever | null {
    let best: Lever | null = null;
    let bd = REACH;
    for (const l of this.list) {
      if (pulled(l.id)) continue;
      const d = Math.hypot(l.x - x, l.y - y);
      if (d <= bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  refresh(pulled: (id: string) => boolean) {
    for (const l of this.list) l.sprite.setFrame(pulled(l.id) ? 1 : 0);
  }

  clear() {
    this.list.forEach(l => l.sprite.destroy());
    this.list = [];
  }
}
