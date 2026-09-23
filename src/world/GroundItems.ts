// Weapons lying on the floor (dropped by the player). Interact to pick one up.
// Items remember their area; only the current area's items are shown and reachable.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import type { SpriteLib } from '../anim/SpriteLib';

export interface GroundItem {
  weapon: string;
  x: number;
  y: number;
  area: string;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Sprite;
}

const REACH = 16;

export class GroundItems {
  list: GroundItem[] = [];
  private area = '';

  constructor(private lib: SpriteLib) {}

  add(weapon: string, x: number, y: number, area = this.area) {
    const shadow = this.lib.sprite('shadow').setPosition(Math.round(x), Math.round(y)).setDepth(DEPTH.shadow);
    const sprite = this.lib
      .sprite(DATA.weapons[weapon].view.sprite)
      .setPosition(Math.round(x), Math.round(y - 3))
      .setRotation(-0.35)
      .setDepth(DEPTH.actor(y) - 1);
    const item = { weapon, x, y, area, sprite, shadow };
    this.list.push(item);
    this.show(item);
  }

  setArea(area: string) {
    this.area = area;
    this.list.forEach(i => this.show(i));
  }

  remove(item: GroundItem) {
    item.sprite.destroy();
    item.shadow.destroy();
    this.list = this.list.filter(i => i !== item);
  }

  nearest(x: number, y: number): GroundItem | null {
    let best: GroundItem | null = null;
    let bd = REACH;
    for (const i of this.list) {
      if (i.area !== this.area) continue;
      const d = Math.hypot(i.x - x, i.y - y);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private show(i: GroundItem) {
    const v = i.area === this.area;
    i.sprite.setVisible(v);
    i.shadow.setVisible(v);
  }
}
