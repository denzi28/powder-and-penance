// Small loot that pops out of broken props (Tallow drops, powder) and is collected by walking over it.
// Transient: anything left on the floor vanishes when the world resets (rest / death).
import Phaser from 'phaser';
import { DEPTH } from '../render/depth';
import type { SpriteLib } from '../anim/SpriteLib';
import { DATA } from '../data/config';
import type { LootEntry } from '../data/schemas';

export interface LootDrop {
  kind: 'tallow' | 'ammo' | 'item';
  amount: number;
  /** A consumable (kind "item"). */
  item?: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sprite: Phaser.GameObjects.Sprite;
}

const PICKUP_RADIUS = 12;
const GRAVITY = 0.35;

/** Weighted pick from a loot table (an entry with no tallow, ammo or item means "nothing"). */
export function rollLoot(table: LootEntry[], rng: () => number): LootEntry {
  let roll = rng() * table.reduce((s, e) => s + e.weight, 0);
  for (const e of table) if ((roll -= e.weight) <= 0) return e;
  return table[table.length - 1];
}

export class LootDrops {
  list: LootDrop[] = [];

  constructor(private lib: SpriteLib) {}

  spawn(entry: LootEntry, x: number, y: number, rng: () => number) {
    const add = (kind: LootDrop['kind'], amount: number, frame: number, item?: string) => {
      const a = rng() * Math.PI * 2;
      // consumables drop as their own icon, small
      const sprite = item ? this.lib.sprite('icons').setFrame(frame).setScale(0.625).setOrigin(0.5, 0.85) : this.lib.sprite('loot').setFrame(frame);
      this.list.push({ kind, amount, item, x, y, z: 6, vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.5, vz: 2.2, sprite });
    };
    if (entry.tallow) add('tallow', Math.round(entry.tallow[0] + (entry.tallow[1] - entry.tallow[0]) * rng()), 0);
    if (entry.ammo) add('ammo', entry.ammo, 1);
    if (entry.item && DATA.consumables[entry.item]) add('item', entry.count, DATA.consumables[entry.item].icon, entry.item);
  }

  /** Per tick: fly, land, and hand back the drops the player walked over. */
  tick(px: number, py: number): LootDrop[] {
    const got: LootDrop[] = [];
    for (const d of this.list) {
      if (d.z > 0 || d.vz > 0) {
        d.x += d.vx;
        d.y += d.vy;
        d.vz -= GRAVITY;
        d.z = Math.max(0, d.z + d.vz);
        if (d.z === 0) d.vz = d.vz < -1 ? -d.vz * 0.35 : 0; // one small bounce
      } else if (Math.hypot(d.x - px, d.y - py) < PICKUP_RADIUS) got.push(d);
    }
    for (const d of got) this.remove(d);
    return got;
  }

  render() {
    for (const d of this.list)
      d.sprite.setPosition(Math.round(d.x), Math.round(d.y - d.z)).setDepth(DEPTH.actor(d.y) - 0.2);
  }

  remove(d: LootDrop) {
    d.sprite.destroy();
    this.list = this.list.filter(x => x !== d);
  }

  clear() {
    this.list.forEach(d => d.sprite.destroy());
    this.list = [];
  }
}

