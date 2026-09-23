// Pixel-stable camera. Scroll = snapped player position + snapped, smoothed aim-lead offset + shake.
// Smoothing is applied only to the offset, so while walking the player never jitters against the world.
import type Phaser from 'phaser';
import { DATA } from '../data/config';
import { lerp } from '../core/math';

export class CameraRig {
  private ox = 0;
  private oy = 0;
  private pox = 0;
  private poy = 0;
  private trauma = 0;

  addTrauma(t: number) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  /** Per gameplay tick: ease the lead offset toward its target. */
  tick(targetX: number, targetY: number) {
    this.pox = this.ox;
    this.poy = this.oy;
    const k = DATA.camera.leadLerp;
    this.ox += (targetX - this.ox) * k;
    this.oy += (targetY - this.oy) * k;
  }

  /** Per tick, also during hit-stop, so shakes still settle. */
  tickShake() {
    this.trauma = Math.max(0, this.trauma - DATA.juice.shake.decayPerTick);
  }

  apply(cam: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number, alpha: number) {
    const g = DATA.game;
    let sx = playerX + Math.round(lerp(this.pox, this.ox, alpha)) - Math.floor(g.width / 2);
    let sy = playerY + DATA.camera.centerOffsetY + Math.round(lerp(this.poy, this.oy, alpha)) - Math.floor(g.height / 2);
    const amp = this.trauma * this.trauma * DATA.juice.shake.maxOffset;
    if (amp > 0) {
      sx += Math.round((Math.random() * 2 - 1) * amp);
      sy += Math.round((Math.random() * 2 - 1) * amp);
    }
    cam.setScroll(sx, sy);
  }
}
