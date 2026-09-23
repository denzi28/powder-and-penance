// The Guttered Candle: where you last died, holding the Tallow you carried. Touch it to recover.
// Dying again before that replaces it (the old Tallow is gone for good).
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { DEPTH } from '../render/depth';
import type { SpriteLib } from '../anim/SpriteLib';

export interface MarkerData {
  x: number;
  y: number;
  tallow: number;
  area?: string;
}

export class DeathMarker {
  data: MarkerData | null = null;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private anim: AnimPlayer;
  private area = '';

  constructor(private lib: SpriteLib) {
    this.anim = new AnimPlayer(lib.manifest('guttered').animations);
    this.anim.play('flicker');
  }

  set(m: MarkerData | null) {
    this.data = m;
    this.refresh();
  }

  setArea(area: string) {
    this.area = area;
    this.refresh();
  }

  private here() {
    return !!this.data && (this.data.area ?? this.area) === this.area;
  }

  private refresh() {
    this.sprite?.destroy();
    const m = this.data;
    this.sprite = m && this.here() ? this.lib.sprite('guttered').setPosition(Math.round(m.x), Math.round(m.y)).setDepth(DEPTH.actor(m.y)) : null;
  }

  /** Returns the recovered Tallow if (x, y) touches the marker. */
  tryRecover(x: number, y: number): number {
    const m = this.data;
    if (!m || !this.here() || Math.hypot(m.x - x, m.y - y) > DATA.shrine.markerPickupRadius) return 0;
    this.set(null);
    return m.tallow;
  }

  update(deltaMs: number) {
    if (!this.sprite) return;
    this.anim.tick(deltaMs / (1000 / DATA.game.tickRate));
    this.sprite.setFrame(this.lib.frame('guttered', 'flicker', 'S', this.anim.index).frame);
  }
}
