// Pixel-stable camera. Scroll = snapped player position + snapped, smoothed aim-lead offset, clamped to the
// current room (rooms smaller than the screen are centred), then shake. Smoothing is applied only to the
// offset, so while walking the player never jitters against the world. Changing rooms blends the clamp.
import type Phaser from 'phaser';
import { DATA } from '../data/config';
import { SETTINGS } from '../game/Settings';
import { lerp } from '../core/math';

export interface Bounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class CameraRig {
  private ox = 0;
  private oy = 0;
  private pox = 0;
  private poy = 0;
  private trauma = 0;
  private roomId: string | null = null;
  private last: { x: number; y: number } | null = null;
  private blend: { fromX: number; fromY: number; ms: number } | null = null;

  addTrauma(t: number) {
    this.trauma = Math.min(1, this.trauma + t * SETTINGS.shake); // the shake setting (0 = none)
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

  /** Jump without blending (spawn, respawn, load). */
  snap() {
    this.last = null;
    this.blend = null;
    this.ox = this.oy = this.pox = this.poy = 0;
  }

  apply(cam: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number, alpha: number, room: Bounds | null, deltaMs: number) {
    const g = DATA.game;
    const c = DATA.camera;
    let sx = playerX + Math.round(lerp(this.pox, this.ox, alpha)) - Math.floor(g.width / 2);
    let sy = playerY + c.centerOffsetY + Math.round(lerp(this.poy, this.oy, alpha)) - Math.floor(g.height / 2);

    if (c.clampToRoom && room) {
      sx = room.w <= g.width ? room.x + Math.floor((room.w - g.width) / 2) : Math.min(Math.max(sx, room.x), room.x + room.w - g.width);
      sy = room.h <= g.height ? room.y + Math.floor((room.h - g.height) / 2) : Math.min(Math.max(sy, room.y), room.y + room.h - g.height);
      if (room.id !== this.roomId) {
        if (this.last && this.roomId !== null && c.roomBlendMs > 0) this.blend = { fromX: this.last.x, fromY: this.last.y, ms: 0 };
        this.roomId = room.id;
      }
    }
    if (this.blend) {
      this.blend.ms += deltaMs;
      const k = Math.min(1, this.blend.ms / c.roomBlendMs);
      const e = 1 - (1 - k) ** 3;
      sx = Math.round(lerp(this.blend.fromX, sx, e));
      sy = Math.round(lerp(this.blend.fromY, sy, e));
      if (k >= 1) this.blend = null;
    }
    this.last = { x: sx, y: sy };

    const amp = this.trauma * this.trauma * DATA.juice.shake.maxOffset;
    if (amp > 0) {
      sx += Math.round((Math.random() * 2 - 1) * amp);
      sy += Math.round((Math.random() * 2 - 1) * amp);
    }
    cam.setScroll(sx, sy);
  }
}
