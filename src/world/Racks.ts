// Weapon / shield racks (test arena). Interact to put the rack's item in the active slot (racks never run out).
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { TILE } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export interface Rack {
  kind: 'weapon' | 'shield';
  /** Weapon/shield id; null on a shield rack = "take off shield". */
  id: string | null;
  x: number;
  y: number;
}

const REACH = 20;

export class Racks {
  list: Rack[] = [];
  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(private lib: SpriteLib) {}

  build(rooms: RoomData[]) {
    this.objs.forEach(o => o.destroy());
    this.objs = [];
    this.list = [];
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'weapon_rack' && en.type !== 'shield_rack') continue;
        const kind = en.type === 'weapon_rack' ? 'weapon' : 'shield';
        const id = (kind === 'weapon' ? en.weapon : en.shield) as string | null;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 2;
        this.list.push({ kind, id, x, y });

        const stand = this.lib.sprite('rack').setPosition(x, y).setDepth(DEPTH.actor(y));
        this.objs.push(stand);
        const sprite = id ? (kind === 'weapon' ? DATA.weapons[id]?.view.sprite : DATA.shields[id]?.sprite) : null;
        if (sprite) {
          const item = this.lib.sprite(sprite).setPosition(x, y - 10).setDepth(DEPTH.actor(y) + 0.1);
          if (kind === 'weapon') item.setRotation(-Math.PI / 2);
          this.objs.push(item);
        }
      }
  }

  nearest(x: number, y: number): Rack | null {
    let best: Rack | null = null;
    let bd = REACH;
    for (const r of this.list) {
      const d = Math.hypot(r.x - x, r.y - y);
      if (d <= bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }
}
