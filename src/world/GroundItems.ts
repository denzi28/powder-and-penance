// Weapons lying on the floor (dropped by the player). Interact to pick one up.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import type { SpriteLib } from '../anim/SpriteLib';

export interface GroundItem {
  weapon: string;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Sprite;
}

const REACH = 16;

export class GroundItems {
  list: GroundItem[] = [];

  constructor(private lib: SpriteLib) {}

  add(weapon: string, x: number, y: number) {
    const shadow = this.lib.sprite('shadow').setPosition(Math.round(x), Math.round(y)).setDepth(DEPTH.shadow);
    const sprite = this.lib
      .sprite(DATA.weapons[weapon].view.sprite)
      .setPosition(Math.round(x), Math.round(y - 3))
      .setRotation(-0.35)
      .setDepth(DEPTH.actor(y) - 1);
    this.list.push({ weapon, x, y, sprite, shadow });
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
      const d = Math.hypot(i.x - x, i.y - y);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}
