// Boss name and health bar along the bottom of the screen, shown while a boss fight is on
// (GameScene.arena.active), or a shorter one while a miniboss is fighting you. Fades in and out; a pale
// trail shows recent damage.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from './colors';
import { TrailBar } from './TrailBar';
import type { GameScene } from '../scenes/GameScene';
import type { Enemy } from '../enemies/Enemy';

const WIDTH = 260;
const MINI_WIDTH = 180;
const HEIGHT = 5;
const MINI_HEIGHT = 4;

/** A living miniboss that is fighting the player (and near enough to matter). */
function activeMiniboss(gs: GameScene): Enemy | null {
  const p = gs.player;
  for (const e of gs.enemies)
    if (e.miniboss && !e.dead && e.awareness >= 1 && Math.hypot(e.x - p.x, e.y - p.y) < 260) return e;
  return null;
}

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
    const hidden = gs.story.active || gs.mapOpen;
    const target = hidden ? null : (gs.arena.active?.enemy ?? activeMiniboss(gs));
    if (target && target !== this.boss) {
      this.boss = target;
      this.trail = new TrailBar(target.hp);
    }
    this.alpha = Phaser.Math.Clamp(this.alpha + (target ? 1 : -1) * (deltaMs / 500), 0, 1);
    this.g.clear();
    this.name.setVisible(this.alpha > 0 && !!this.boss);
    if (this.alpha <= 0 || !this.boss) return;

    const pal = DATA.palette;
    const W = DATA.game.width;
    const H = DATA.game.height;
    const b = this.boss;
    const fb = DATA.juice.hitFeedback;
    this.trail!.update(Math.max(0, b.hp), b.maxHp, deltaMs, fb.trailHoldMs, fb.trailDrainPerSec);
    const mini = !!b.miniboss && gs.arena.active?.enemy !== b;
    const w = mini ? MINI_WIDTH : WIDTH;
    const h = mini ? MINI_HEIGHT : HEIGHT;
    const x = Math.round((W - w) / 2);
    const y = H - 20;
    const px = (v: number) => Math.round(w * Phaser.Math.Clamp(v / b.maxHp, 0, 1));

    const title = mini ? b.miniboss!.title : (gs.arena.active?.title ?? b.def.boss?.title ?? b.def.name);
    this.name.setText(title.toUpperCase()).setAlpha(this.alpha);
    this.name.setPosition(x, y - 10);
    this.g.fillStyle(hexToInt(pal.ink), 0.85 * this.alpha).fillRect(x - 1, y - 1, w + 2, h + 2);
    this.g.fillStyle(hexToInt(pal.dark2), this.alpha).fillRect(x, y, w, h);
    this.g.fillStyle(hexToInt(pal.wax2), this.alpha).fillRect(x, y, px(this.trail!.value), h);
    this.g.fillStyle(hexToInt(pal.blood2), this.alpha).fillRect(x, y, px(Math.max(0, b.hp)), h);
    this.g.fillStyle(hexToInt(mini ? pal.stone3 : pal.flame1), this.alpha).fillRect(x, y, w, 1); // a thin edge: gilt for bosses, iron for minibosses
  }
}
