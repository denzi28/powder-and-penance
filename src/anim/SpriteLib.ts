// Resolves (sheet, animation, direction, frame) to a Phaser frame index + mirroring, per the manifests.
import Phaser from 'phaser';
import { SPRITES } from '../data/assets';
import type { SpriteManifest } from '../data/schemas';
import { resolveDir, type Dir8 } from '../core/math';

export interface ResolvedFrame {
  frame: number;
  flip: boolean;
  authoredDir: Dir8;
}

export class SpriteLib {
  private cols = new Map<string, number>();

  constructor(private scene: Phaser.Scene) {}

  manifest(name: string): SpriteManifest {
    const m = SPRITES[name];
    if (!m) throw new Error(`No sprite manifest "${name}" in assets/sprites`);
    return m;
  }

  columns(name: string): number {
    let c = this.cols.get(name);
    if (c === undefined) {
      const img = this.scene.textures.get(name).getSourceImage() as { width: number };
      c = Math.max(1, Math.floor(img.width / this.manifest(name).cell[0]));
      this.cols.set(name, c);
    }
    return c;
  }

  frame(name: string, anim: string, dir: Dir8, frameIndex: number): ResolvedFrame {
    const m = this.manifest(name);
    const a = m.animations[anim];
    if (!a) throw new Error(`Sprite "${name}" has no animation "${anim}"`);
    const r = resolveDir(dir, a.dirs);
    const row = a.row + a.dirs.indexOf(r.dir);
    const col = a.frames[frameIndex]?.col ?? frameIndex;
    return { frame: row * this.columns(name) + col, flip: r.flip, authoredDir: r.dir };
  }

  /** Create a sprite whose origin is the manifest pivot. */
  sprite(name: string): Phaser.GameObjects.Sprite {
    const s = this.scene.add.sprite(0, 0, name, 0);
    this.applyOrigin(s, name);
    return s;
  }

  applyOrigin(s: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, name: string) {
    const m = this.manifest(name);
    s.setOrigin(m.pivot[0] / m.cell[0], m.pivot[1] / m.cell[1]);
  }
}
