// Lore notes lying on the floor. Room entity: { "type": "note", "note": "<data/notes id>", "at": [x, y] }.
// Read one (E) and it is kept for good (world flag "note:<id>", listed under INVENTORY > NOTES) and gone
// from the floor. A slow glint marks the ones still lying there.
import Phaser from 'phaser';
import { DEPTH } from '../render/depth';
import { TILE } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { RoomData } from '../data/schemas';

export interface FloorNote {
  note: string;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  glint: Phaser.GameObjects.Sprite;
}

const REACH = 18;

export class Notes {
  list: FloorNote[] = [];
  private t = 0;

  constructor(private lib: SpriteLib) {}

  build(rooms: RoomData[], read: (id: string) => boolean) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'note' || read(String(en.note))) continue;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE / 2 + 2;
        const sprite = this.lib.sprite('note').setPosition(x, y).setDepth(DEPTH.actor(y) - 1);
        const glint = this.lib.sprite('item_glint').setPosition(x + 3, y - 4).setDepth(DEPTH.actor(y)).setVisible(false);
        this.list.push({ note: String(en.note), x, y, sprite, glint });
      }
  }

  nearest(x: number, y: number): FloorNote | null {
    let best: FloorNote | null = null;
    let bd = REACH;
    for (const n of this.list) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  take(n: FloorNote) {
    n.sprite.destroy();
    n.glint.destroy();
    this.list = this.list.filter(x => x !== n);
  }

  /** The glint twinkles now and then, each note on its own beat. */
  update(deltaMs: number) {
    this.t += deltaMs;
    this.list.forEach((n, i) => {
      const k = ((this.t + i * 700) % 2600) / 2600;
      n.glint.setVisible(k < 0.16).setFrame(Math.min(3, Math.floor((k / 0.16) * 4)));
    });
  }

  clear() {
    this.list.forEach(n => {
      n.sprite.destroy();
      n.glint.destroy();
    });
    this.list = [];
  }
}
