// Pixel particles with a fake height axis (z). Blood/wax droplets that land leave a stain on the floor.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from './depth';
import { hexToInt } from '../ui/colors';

interface Pt {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: number;
  size: number;
  stain: boolean;
}

const GRAVITY = 420;

export class Particles {
  private list: Pt[] = [];
  private g: Phaser.GameObjects.Graphics;
  private stains: Phaser.GameObjects.Graphics;
  private stainCount = 0;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.overlay - 10);
    this.stains = scene.add.graphics().setDepth(DEPTH.floor + 1);
  }

  /** Spray `count` particles in a cone around `angle`. */
  burst(x: number, y: number, z: number, angle: number, spread: number, count: number, speed: number, color: string, stain: boolean, rng = Math.random) {
    const c = hexToInt(DATA.palette[color] ?? '#ffffff');
    for (let i = 0; i < count; i++) {
      const a = angle + (rng() - 0.5) * spread;
      const s = speed * (0.4 + rng() * 0.8);
      this.list.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.7,
        vz: 40 + rng() * 90,
        life: stain ? 2 : 0.15 + rng() * 0.25,
        color: c,
        size: stain && rng() < 0.4 ? 2 : 1,
        stain,
      });
    }
  }

  update(dtMs: number) {
    const dt = dtMs / 1000;
    const maxStains = DATA.juice.particles.maxStains;
    this.g.clear();
    this.list = this.list.filter(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= GRAVITY * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        if (p.stain) {
          if (this.stainCount >= maxStains) this.clearStains();
          this.stains.fillStyle(p.color, 0.85).fillRect(Math.round(p.x), Math.round(p.y), p.size, 1);
          this.stainCount++;
        }
        return false;
      }
      if (p.life <= 0) return false;
      this.g.fillStyle(p.color, 1).fillRect(Math.round(p.x), Math.round(p.y - p.z), p.size, p.size);
      return true;
    });
  }

  clearStains() {
    this.stains.clear();
    this.stainCount = 0;
  }

  clear() {
    this.list = [];
    this.g.clear();
    this.clearStains();
  }
}
