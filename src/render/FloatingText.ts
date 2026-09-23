// Rising, fading pixel-font numbers (damage readouts).
import Phaser from 'phaser';
import { DEPTH } from './depth';

interface Item {
  t: Phaser.GameObjects.BitmapText;
  x: number;
  y: number;
  age: number;
}

const LIFE_MS = 800;

export class FloatingText {
  private items: Item[] = [];

  constructor(private scene: Phaser.Scene) {}

  add(text: string, x: number, y: number, tint: number) {
    const t = this.scene.add.bitmapText(0, 0, 'pixel', text).setTint(tint).setDepth(DEPTH.overlay - 2);
    this.items.push({ t, x: x - Math.floor(t.width / 2), y, age: 0 });
  }

  update(dtMs: number) {
    this.items = this.items.filter(i => {
      i.age += dtMs;
      const k = i.age / LIFE_MS;
      if (k >= 1) {
        i.t.destroy();
        return false;
      }
      i.t.setPosition(Math.round(i.x), Math.round(i.y - 14 * Math.sqrt(k))).setAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      return true;
    });
  }

  clear() {
    this.items.forEach(i => i.t.destroy());
    this.items = [];
  }
}
