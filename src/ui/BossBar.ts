// Boss name and health bar along the bottom of the screen, shown while a boss fight is on
// (GameScene.arena.active). Fades in with the entrance; a pale trail shows recent damage.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from './colors';
import { TrailBar } from './TrailBar';
import type { GameScene } from '../scenes/GameScene';
import type { Enemy } from '../enemies/Enemy';

const WIDTH = 260;
const HEIGHT = 5;

export class BossBar {
  private g: Phaser.GameObjects.Graphics;
  private name: Phaser.GameObjects.BitmapText;
  private trail: TrailBar | null = null;
  private boss: Enemy | null = null;
  private alpha = 0;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
    this.name = scene.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.wax2)).setDepth(5);
  }

  update(gs: GameScene, deltaMs: number) {
    const a = gs.story.active || gs.mapOpen ? null : gs.arena.active;
    if (a && a.enemy !== this.boss) {
      this.boss = a.enemy;
      this.trail = new TrailBar(a.enemy.hp);
    }
    this.alpha = Phaser.Math.Clamp(this.alpha + (a ? 1 : -1) * (deltaMs / 500), 0, 1);
    this.g.clear();
    this.name.setVisible(this.alpha > 0 && !!this.boss);
    if (this.alpha <= 0 || !this.boss) return;

    const pal = DATA.palette;
    const W = DATA.game.width;
    const H = DATA.game.height;
    const b = this.boss;
    const fb = DATA.juice.hitFeedback;
    this.trail!.update(Math.max(0, b.hp), b.maxHp, deltaMs, fb.trailHoldMs, fb.trailDrainPerSec);
    const x = Math.round((W - WIDTH) / 2);
    const y = H - 20;
    const px = (v: number) => Math.round(WIDTH * Phaser.Math.Clamp(v / b.maxHp, 0, 1));

    this.name.setText((gs.arena.active?.title ?? b.def.boss?.title ?? b.def.name).toUpperCase()).setAlpha(this.alpha);
    this.name.setPosition(x, y - 10);
    this.g.fillStyle(hexToInt(pal.ink), 0.85 * this.alpha).fillRect(x - 1, y - 1, WIDTH + 2, HEIGHT + 2);
    this.g.fillStyle(hexToInt(pal.dark2), this.alpha).fillRect(x, y, WIDTH, HEIGHT);
    this.g.fillStyle(hexToInt(pal.wax2), this.alpha).fillRect(x, y, px(this.trail!.value), HEIGHT);
    this.g.fillStyle(hexToInt(pal.blood2), this.alpha).fillRect(x, y, px(Math.max(0, b.hp)), HEIGHT);
    this.g.fillStyle(hexToInt(pal.flame1), this.alpha).fillRect(x, y, WIDTH, 1); // a thin gilt edge
  }
}
