// Pooled one-shot cosmetic sprites (dust puffs now; sparks, casings, blood later). Runs on real time.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { DEPTH } from './depth';
import type { SpriteLib } from '../anim/SpriteLib';

interface Inst {
  spr: Phaser.GameObjects.Sprite;
  sheet: string;
  anim: AnimPlayer;
  alive: boolean;
}

const MAX = 96;

export class Fx {
  private pool: Inst[] = [];

  constructor(private scene: Phaser.Scene, private lib: SpriteLib) {}

  spawn(sheet: string, anim: string, x: number, y: number) {
    let inst = this.pool.find(i => !i.alive);
    if (!inst) {
      if (this.pool.length >= MAX) return;
      inst = { spr: this.scene.add.sprite(0, 0, sheet), sheet: '', anim: new AnimPlayer({}), alive: false };
      this.pool.push(inst);
    }
    if (inst.sheet !== sheet) {
      inst.sheet = sheet;
      inst.spr.setTexture(sheet, 0);
      this.lib.applyOrigin(inst.spr, sheet);
      inst.anim = new AnimPlayer(this.lib.manifest(sheet).animations);
    }
    inst.anim.play(anim, { restart: true });
    inst.alive = true;
    inst.spr.setVisible(true).setPosition(Math.round(x), Math.round(y)).setDepth(DEPTH.actor(y) - 0.5);
    this.show(inst);
  }

  update(deltaMs: number) {
    const speed = deltaMs / (1000 / DATA.game.tickRate);
    for (const i of this.pool) {
      if (!i.alive) continue;
      i.anim.tick(speed);
      if (i.anim.done) {
        i.alive = false;
        i.spr.setVisible(false);
      } else this.show(i);
    }
  }

  private show(i: Inst) {
    i.spr.setFrame(this.lib.frame(i.sheet, i.anim.name, 'S', i.anim.index).frame);
  }
}
