// Characters standing in the world. Room entity:
//   { "type": "npc", "id": "<placement>", "npc": "<character id>", "talk": "<script id>", "when": <Cond>,
//     "pose": "sit" | "kneel" | "work", "face": -1 | 1, "routine": [<stop>, ...] }
// A placement is shown only while its `when` holds (so Oskar is in the cage until freed, then at his stall).
// NPCs breathe, turn toward the player, move their mouth while speaking, and are solid.
//
// A routine makes an NPC live a little: it walks from stop to stop (straight lines through any `via` points,
// in room tiles) and at each stop does something for a while (idle, work, sit, kneel), then moves on, looping.
// Sprite sheets with 12 frames have: 0-1 idle, 2-3 talk, 4-7 walk, 8-9 work, 10 sit, 11 kneel. Older 4-frame
// sheets only idle and talk, so they should not be given routines.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { TILE } from '../world/TileGrid';
import { check } from './conditions';
import type { Actor } from '../actors/Actor';
import type { Cond, NpcStop, RoomData } from '../data/schemas';
import { NpcStop as NpcStopSchema } from '../data/schemas';
import type { SpriteLib } from '../anim/SpriteLib';

export type NpcPose = 'idle' | 'work' | 'sit' | 'kneel';

interface Stop {
  x: number;
  y: number;
  path: { x: number; y: number }[];
  do: NpcPose;
  ms: number;
  face: number | null;
}

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
  /** 12-frame sheet: can walk and work. */
  full: boolean;
  /** What it is doing when standing still. */
  pose: NpcPose;
  facing: number;
  routine: Stop[];
  step: number;
  /** Walking toward routine[step] along its path, or doing its thing there. */
  walking: boolean;
  path: { x: number; y: number }[];
  timer: number;
  /** Held in place (talking with the player, or chatting with another NPC). */
  held: boolean;
  /** Face this x while held (whoever it is talking to). */
  lookAt: number | null;
  /** Previous work frame, to fire a work sound on the swing. */
  lastWork: number;
  /** How long it has been waiting for the player to get out of its way. */
  waited: number;
}

/** Talking range; generous so you can talk across a counter or through cage bars. */
const REACH = 34;
const RADIUS = 6;
/** Walking speed in px per second: an unhurried stroll. */
const SPEED = 26;
const POSE_FRAME: Record<Exclude<NpcPose, 'idle' | 'work'>, number> = { sit: 10, kneel: 11 };

export class Npcs {
  list: Npc[] = [];
  /** Character currently speaking (mouth moves). */
  speaking: string | null = null;
  /** Placement ids speaking in a chatter bubble (their mouths move too). */
  chattering = new Set<string>();
  /** Work sounds: character id -> sfx id, played on the work stroke when the player is near. */
  onWorkStroke: ((n: Npc) => void) | null = null;
  private t = 0;

  constructor(private lib: SpriteLib) {}

  build(rooms: RoomData[], flags: ReadonlySet<string>) {
    this.clear();
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'npc' || !en.id) continue;
        const def = DATA.npcs.npcs[String(en.npc)];
        const toPx = ([tx, ty]: readonly number[]) => ({ x: (r.origin[0] + tx) * TILE + TILE / 2, y: (r.origin[1] + ty) * TILE + TILE - 2 });
        const { x, y } = toPx(en.at);
        const sprite = this.lib.sprite(def.sprite).setPosition(x, y).setDepth(DEPTH.actor(y));
        const full = sprite.texture.frameTotal - 1 >= 12;
        const stops = ((en.routine as unknown[] | undefined) ?? []).map(s => NpcStopSchema.parse(s) as NpcStop);
        const routine: Stop[] = stops.map(s => ({
          ...toPx(s.at),
          path: [...(s.via ?? []).map(toPx), toPx(s.at)],
          do: s.do,
          ms: (s.ticks * 1000) / 60,
          face: s.face ?? null,
        }));
        const pose = (en.pose as NpcPose | undefined) ?? 'idle';
        this.list.push({
          id: en.id,
          npc: String(en.npc),
          talk: en.talk === undefined ? null : String(en.talk),
          when: en.when as Cond | undefined,
          x,
          y,
          visible: true,
          sprite,
          full,
          pose: full ? pose : 'idle',
          facing: typeof en.face === 'number' ? Math.sign(en.face) || 1 : 1,
          routine: full ? routine : [],
          step: 0,
          walking: false,
          path: [],
          timer: routine.length ? routine[0].ms : 0,
          held: false,
          lookAt: null,
          lastWork: 0,
          waited: 0,
        });
        // Start at the first stop, doing its thing.
        const n = this.list[this.list.length - 1];
        if (n.routine.length) this.arrive(n);
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

  private arrive(n: Npc) {
    const s = n.routine[n.step];
    n.x = s.x;
    n.y = s.y;
    n.walking = false;
    n.pose = s.do;
    n.timer = s.ms;
    if (s.face !== null) n.facing = s.face;
  }

  private depart(n: Npc) {
    n.step = (n.step + 1) % n.routine.length;
    n.path = n.routine[n.step].path.map(p => ({ ...p }));
    n.walking = true;
    n.pose = 'idle';
  }

  /**
   * @param paused a script or menu is up: everyone stands still (the one being talked to faces you).
   */
  update(deltaMs: number, player: { x: number; y: number }, paused: boolean) {
    this.t += deltaMs;
    const idle = Math.floor(this.t / 700) % 2;
    const talk = Math.floor(this.t / 130) % 2;
    const walk = Math.floor(this.t / 150) % 4;
    for (const n of this.list) {
      if (!n.visible) continue;
      const speaking = this.speaking === n.npc || this.chattering.has(n.id);
      const talkingToPlayer = this.speaking === n.npc;
      const near = Math.hypot(player.x - n.x, player.y - n.y) < 44;
      // Routine: walk, or count down at a stop. Held while talking or chatting.
      if (!paused && !n.held && n.routine.length) {
        if (n.walking) {
          const p = n.path[0];
          const dx = p.x - n.x;
          const dy = p.y - n.y;
          const d = Math.hypot(dx, dy);
          const stepPx = (SPEED * deltaMs) / 1000;
          // wait politely if the player is standing right in the way; after a moment, squeeze past
          const blocked = Math.hypot(player.x - (n.x + (dx / (d || 1)) * 8), player.y - (n.y + (dy / (d || 1)) * 8)) < 10;
          n.waited = blocked ? n.waited + deltaMs : 0;
          if (!blocked || n.waited > 1200) {
            if (d <= stepPx) {
              n.x = p.x;
              n.y = p.y;
              n.path.shift();
              if (!n.path.length) this.arrive(n);
            } else {
              n.x += (dx / d) * stepPx;
              n.y += (dy / d) * stepPx;
            }
            if (Math.abs(dx) > 0.5) n.facing = dx < 0 ? -1 : 1;
          }
        } else {
          n.timer -= deltaMs;
          if (n.timer <= 0) this.depart(n);
        }
      }
      // Frame
      let frame: number;
      const walkingNow = n.walking && !paused && !n.held;
      if (speaking && (!n.full || n.pose === 'idle' || n.walking)) frame = 2 + talk;
      else if (walkingNow) frame = 4 + walk;
      else if (!n.full || n.pose === 'idle') frame = idle;
      else if (n.pose === 'work') {
        const w = Math.floor(this.t / 380) % 2;
        if (w === 1 && n.lastWork === 0 && near) this.onWorkStroke?.(n);
        n.lastWork = w;
        frame = 8 + w;
      } else frame = POSE_FRAME[n.pose];
      n.sprite.setFrame(frame);
      // Facing: toward whoever it is talking to; toward the player when idle and near; else its own way.
      if (n.held && n.lookAt !== null) n.facing = n.lookAt < n.x ? -1 : 1;
      else if ((talkingToPlayer || (near && !n.walking && n.pose === 'idle')) && Math.abs(player.x - n.x) > 4) n.facing = player.x < n.x ? -1 : 1;
      n.sprite.setFlipX(n.facing < 0);
      n.sprite.setPosition(Math.round(n.x), Math.round(n.y)).setDepth(DEPTH.actor(n.y));
    }
  }

  clear() {
    this.list.forEach(n => n.sprite.destroy());
    this.list = [];
    this.chattering.clear();
  }
}
