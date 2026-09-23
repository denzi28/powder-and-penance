// Characters standing in the world. Room entity:
//   { "type": "npc", "id": "<placement>", "npc": "<character id>", "talk": "<script id>", "when": <Cond> }
// A placement is shown only while its `when` holds (so Oskar is in the cage until freed, then at his stall).
// NPCs breathe, turn toward the player, move their mouth while speaking, and are solid.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { TILE } from '../world/TileGrid';
import { check } from './conditions';
import type { Actor } from '../actors/Actor';
import type { Cond, RoomData } from '../data/schemas';
import type { SpriteLib } from '../anim/SpriteLib';

export interface Npc {
  /** Placement id (unique in the world). */
  id: string;
  /** Character id (data/npcs.json). */
  npc: string;
  talk: string | null;
  when: Cond | undefined;
  x: number;
  y: number;
  visible: boolean;
  sprite: Phaser.GameObjects.Sprite;
}

/** Talking range; generous so you can talk across a counter or through cage bars. */
const REACH = 34;
const RADIUS = 6;

export class Npcs {
  list: Npc[] = [];
  /** Character currently speaking (mouth moves). */
  speaking: string | null = null;
  private t = 0;

  constructor(private lib: SpriteLib) {}

  build(rooms: RoomData[], flags: ReadonlySet<string>) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'npc' || !en.id) continue;
        const def = DATA.npcs.npcs[String(en.npc)];
        const x = (r.origin[0] + en.at[0]) * TILE + TILE / 2;
        const y = (r.origin[1] + en.at[1]) * TILE + TILE - 2;
        const sprite = this.lib.sprite(def.sprite).setPosition(x, y).setDepth(DEPTH.actor(y));
        this.list.push({
          id: en.id,
          npc: String(en.npc),
          talk: en.talk === undefined ? null : String(en.talk),
          when: en.when as Cond | undefined,
          x,
          y,
          visible: true,
          sprite,
        });
      }
    this.refresh(flags);
  }

  /** Re-evaluate who is present (after a script changes flags). */
  refresh(flags: ReadonlySet<string>) {
    for (const n of this.list) {
      n.visible = check(flags, n.when);
      n.sprite.setVisible(n.visible);
    }
  }

  get(id: string) {
    return this.list.find(n => n.id === id) ?? null;
  }

  /** Nearest visible NPC you can talk to. */
  nearest(x: number, y: number): Npc | null {
    let best: Npc | null = null;
    let bd = REACH;
    for (const n of this.list) {
      if (!n.visible || !n.talk) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** NPCs are immovable: push actors out of them. */
  pushOut(a: Actor) {
    for (const n of this.list) {
      if (!n.visible) continue;
      const dx = a.x - n.x;
      const dy = a.y - n.y;
      const min = a.bodyRadius + RADIUS;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 0.001) continue;
      a.moveBy((dx / d) * (min - d), (dy / d) * (min - d));
    }
  }

  update(deltaMs: number, playerX: number) {
    this.t += deltaMs;
    const idle = Math.floor(this.t / 700) % 2;
    const talk = Math.floor(this.t / 130) % 2;
    for (const n of this.list) {
      if (!n.visible) continue;
      n.sprite.setFrame(this.speaking === n.npc ? 2 + talk : idle);
      n.sprite.setFlipX(playerX < n.x - 4); // turn toward the player
    }
  }

  clear() {
    this.list.forEach(n => n.sprite.destroy());
    this.list = [];
  }
}
