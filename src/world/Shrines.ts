// Wick Shrines: checkpoints. Kindle once (discovery), then rest to heal, refill, respawn enemies and save.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { DEPTH } from '../render/depth';
import { TILE } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import type { Cond, RoomData } from '../data/schemas';
import { check } from '../story/conditions';

export interface Shrine {
  id: string;
  name: string;
  x: number;
  y: number;
  lit: boolean;
  sprite: Phaser.GameObjects.Sprite;
  anim: AnimPlayer;
}

/** Shrines block movement as a small circle. */
export const SHRINE_RADIUS = 6;

export class Shrines {
  list: Shrine[] = [];

  constructor(private lib: SpriteLib) {}

  /** A shrine with a `when` condition (e.g. "boss:tollwarden") only exists once it holds. */
  build(rooms: RoomData[], litIds: (id: string) => boolean, flags: ReadonlySet<string> = new Set()) {
    this.list.forEach(s => s.sprite.destroy());
    this.list = [];
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'shrine' || !en.id) continue;
        if (!check(flags, en.when as Cond | undefined)) continue;
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 2;
        const sprite = this.lib.sprite('shrine').setPosition(x, y).setDepth(DEPTH.actor(y));
        const anim = new AnimPlayer(this.lib.manifest('shrine').animations);
        const lit = litIds(en.id);
        anim.play(lit ? 'lit' : 'unlit');
        this.list.push({ id: en.id, name: String(en.name ?? en.id), x, y, lit, sprite, anim });
      }
  }

  get(id: string | null) {
    return this.list.find(s => s.id === id) ?? null;
  }

  light(s: Shrine) {
    s.lit = true;
    s.anim.play('lit', { restart: true });
  }

  nearest(x: number, y: number): Shrine | null {
    let best: Shrine | null = null;
    let bd = DATA.shrine.reach;
    for (const s of this.list) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Where the player appears when resting/respawning here. */
  spawnPoint(s: Shrine) {
    const [ox, oy] = DATA.shrine.spawnOffset;
    return { x: s.x + ox, y: s.y + oy };
  }

  /** Real-time animation (flame flicker). */
  update(deltaMs: number) {
    const speed = deltaMs / (1000 / DATA.game.tickRate);
    for (const s of this.list) {
      s.anim.tick(speed);
      s.sprite.setFrame(this.lib.frame('shrine', s.anim.name, 'S', s.anim.index).frame);
    }
  }
}
