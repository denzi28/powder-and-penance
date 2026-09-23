// Placed items (data/items). Each is picked up once, ever: taking it sets the world flag "item:<id>".
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { DEPTH } from '../render/depth';
import { TILE } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export interface Pickup {
  id: string;
  item: string;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  anim: AnimPlayer;
}

const REACH = 16;

export class Pickups {
  list: Pickup[] = [];

  constructor(private lib: SpriteLib) {}

  build(rooms: RoomData[], taken: (id: string) => boolean) {
    this.list.forEach(p => p.sprite.destroy());
    this.list = [];
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'item' || !en.id || taken(en.id)) continue;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 4;
        const anim = new AnimPlayer(this.lib.manifest('item_glint').animations);
        anim.play('shine');
        const sprite = this.lib.sprite('item_glint').setPosition(x, y).setDepth(DEPTH.actor(y));
        this.list.push({ id: en.id, item: String(en.item), x, y, sprite, anim });
      }
  }

  nearest(x: number, y: number): Pickup | null {
    let best: Pickup | null = null;
    let bd = REACH;
    for (const p of this.list) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  remove(p: Pickup) {
    p.sprite.destroy();
    this.list = this.list.filter(i => i !== p);
  }

  update(deltaMs: number) {
    const speed = deltaMs / (1000 / DATA.game.tickRate);
    for (const p of this.list) {
      p.anim.tick(speed);
      p.sprite.setFrame(this.lib.frame('item_glint', 'shine', 'S', p.anim.index).frame);
    }
  }
}
