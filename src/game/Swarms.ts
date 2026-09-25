// Bees. A swarm is a cloud with one quarry: it chases that creature and stings everything inside it, so a
// swarm hunting you stings the enemies you lead it through too. Weapons pass through a swarm; smoke settles it.
//
// Where swarms come from:
// - a hive (prop `hive`): struck, a swarm pours out after whoever struck it; broken, a bigger one;
// - a Drone Swarm (room entity "swarm"): it hovers over its flowers and rises at whoever comes within `sense`;
// - a strike's `swarm` (the Hive Queen sends hers out after you).
// Released swarms fly home when their anger is spent (or their quarry gets away) and are gone; placed ones
// settle back over their flowers. The world reset clears the released ones and puts the placed ones back.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { Actor } from '../actors/Actor';
import { Poise } from '../actors/Poise';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';
import { TILE } from '../world/TileGrid';
import { Enemy } from '../enemies/Enemy';
import type { WorldCtx } from '../core/World';
import type { SwarmDef, RoomData } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

/** Who a swarm's stings count as coming from: never hit, never listed among the actors. */
class SwarmBody extends Actor {
  readonly team = 'prop' as const;
  readonly poise = new Poise(() => ({ max: 1e9, resetTicks: 0 }));
  get maxHp() {
    return 1;
  }
  get collider() {
    return { w: 2, h: 2 };
  }
  get hurtbox() {
    return { w: 1, h: 1, offsetY: 0 };
  }
  get bodyRadius() {
    return 0;
  }
  get bloodColor() {
    return 'flame2';
  }
  get stateName() {
    return 'swarm';
  }
  get stateTick() {
    return 0;
  }
  tick() {}
  onHit() {}
}

interface Bee {
  /** Orbit angle, radius (0..1 of the cloud) and speed; phase for its bob. */
  a: number;
  r: number;
  s: number;
  ph: number;
}

export interface Swarm {
  def: SwarmDef;
  kind: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  /** The creature it's after (null = going home, or settled). */
  target: Actor | null;
  anger: number;
  /** Ticks left settled after smoke (won't rise). */
  calm: number;
  /** Released from a hive or by a strike: gone once it's home. */
  released: boolean;
  /** Per creature: ticks until it can be stung again. */
  stingCd: Map<Actor, number>;
  body: SwarmBody;
  bees: Bee[];
  /** How roused it looks (0 settled .. 1 hunting): the cloud spreads and the bees speed up. */
  rouse: number;
  t: number;
  /** A released swarm fades out as it gets home. */
  fade: number;
}

/** Height above the feet a swarm flies at. */
const FLY = 10;

export class Swarms {
  list: Swarm[] = [];
  private g: Phaser.GameObjects.Graphics | null = null;
  private placed: { kind: string; x: number; y: number }[] = [];

  /** Drone swarms placed in the rooms (entity "swarm"): hovering over their flowers. */
  build(ctx: WorldCtx, rooms: RoomData[]) {
    this.placed = [];
    for (const r of rooms)
      for (const en of r.entities)
        if (en.type === 'swarm')
          this.placed.push({ kind: String(en.swarm), x: (r.origin[0] + en.at[0]) * TILE + TILE / 2, y: (r.origin[1] + en.at[1]) * TILE + TILE - 2 });
    this.reset(ctx);
  }

  /** The world reset: released swarms are gone, placed ones are back home and settled. */
  reset(ctx: WorldCtx) {
    this.list = this.placed.map(p => this.make(ctx, p.kind, p.x, p.y, false));
  }

  clear() {
    this.list = [];
    this.g?.clear();
  }

  private make(ctx: WorldCtx, kind: string, x: number, y: number, released: boolean): Swarm {
    const def = DATA.swarms.swarms[kind];
    const bees: Bee[] = [];
    for (let i = 0; i < def.bees; i++) bees.push({ a: ctx.rng() * Math.PI * 2, r: Math.sqrt(ctx.rng()), s: (0.03 + ctx.rng() * 0.05) * (ctx.rng() < 0.5 ? -1 : 1), ph: ctx.rng() * 6 });
    return { def, kind, x, y, homeX: x, homeY: y, vx: 0, vy: 0, target: null, anger: 0, calm: 0, released, stingCd: new Map(), body: new SwarmBody(ctx, x, y), bees, rouse: 0, t: 0, fade: 1 };
  }

  /** A swarm pours out of (x, y) after `target`. */
  release(ctx: WorldCtx, kind: string, x: number, y: number, target: Actor | null) {
    const s = this.make(ctx, kind, x, y, true);
    s.target = target;
    s.anger = s.def.angerTicks;
    s.rouse = 1;
    this.list.push(s);
    ctx.bus.emit('sfx', { id: 'e_swarm_rise', x, y });
    return s;
  }

  /** Smoke at (x, y): every swarm within reach settles (and a released one goes home). */
  calm(x: number, y: number, radius: number, gs: GameScene) {
    let any = false;
    for (const s of this.list) {
      if (Math.hypot(s.x - x, s.y - FLY - (y - FLY)) > radius + s.def.radius) continue;
      if (!s.target && s.calm > 0) continue;
      s.target = null;
      s.anger = 0;
      s.calm = s.def.calmTicks;
      any = true;
    }
    if (any) gs.bus.emit('sfx', { id: 'e_swarm_calm', x, y });
  }

  /** A swarm is hunting (the player is in a fight, bees make the whole room restless). */
  get hunting() {
    return this.list.some(s => !!s.target);
  }

  tick(gs: GameScene) {
    const p = gs.player;
    for (const s of this.list) {
      s.t++;
      const d = s.def;
      if (s.calm > 0) s.calm--;
      // lose the quarry: dead, out of anger, too far, or you've slipped away in smoke
      if (s.target) {
        const tg = s.target;
        const far = Math.hypot(tg.x - s.x, tg.y - s.y) > d.giveUp;
        const lost = tg === p && p.buffs.some(b => DATA.consumables[b.id]?.use.type === 'buff' && (DATA.consumables[b.id].use as { lose?: boolean }).lose);
        if (tg.dead || --s.anger <= 0 || far || lost) s.target = null;
      }
      // a settled swarm over its flowers rises at whoever comes too near
      if (!s.target && !s.released && s.calm <= 0 && d.sense > 0 && !p.dead && Math.hypot(p.x - s.x, p.y - s.y) <= d.sense) {
        s.target = p;
        s.anger = d.angerTicks;
        gs.bus.emit('sfx', { id: 'e_swarm_rise', x: s.x, y: s.y, volume: 0.7 });
      }
      // fly: after the quarry, or home
      const goal = s.target ? { x: s.target.x, y: s.target.y } : { x: s.homeX, y: s.homeY };
      const dx = goal.x - s.x;
      const dy = goal.y - s.y;
      const dist = Math.hypot(dx, dy);
      const speed = (s.target ? d.speed : d.speed * 0.6) / DATA.game.tickRate;
      const want = dist > 1 ? Math.min(speed, dist) : 0;
      // a swarm weaves: it overshoots, drifts, swings back
      const wob = s.target ? Math.sin(s.t * 0.09) * 0.35 : 0;
      const ax = dist > 0 ? dx / dist : 0;
      const ay = dist > 0 ? dy / dist : 0;
      const tvx = (ax - ay * wob) * want;
      const tvy = (ay + ax * wob) * want;
      s.vx += (tvx - s.vx) * 0.12;
      s.vy += (tvy - s.vy) * 0.12;
      s.x += s.vx;
      s.y += s.vy;
      s.body.x = s.x;
      s.body.y = s.y;
      s.rouse += ((s.target ? 1 : s.calm > 0 ? 0 : 0.25) - s.rouse) * 0.05;
      if (s.released && !s.target && dist < 6) s.fade -= 0.05; // home: back into the hive
      // stings: everyone in the cloud (bar beekeepers and the rolling)
      for (const [a, cd] of s.stingCd) if (cd > 0) s.stingCd.set(a, cd - 1);
      if (s.target || (s.rouse > 0.6 && !s.calm)) this.sting(s, gs);
      if (s.target && s.t % 45 === 0 && Math.hypot(p.x - s.x, p.y - s.y) < 200) gs.bus.emit('sfx', { id: 'e_buzz', x: s.x, y: s.y, volume: 0.8 });
    }
    this.list = this.list.filter(s => s.fade > 0);
  }

  private sting(s: Swarm, gs: GameScene) {
    const d = s.def;
    for (const a of gs.actors) {
      if (a.dead || a.team === 'prop') continue;
      if (a instanceof Enemy && (a.def.beeproof || a.stateName === 'submerged')) continue;
      if ((s.stingCd.get(a) ?? 0) > 0) continue;
      if (Math.hypot(a.x - s.x, a.chestY - (s.y - FLY)) > d.radius + 4) continue;
      const dmg = a === gs.player ? d.damage * gs.player.mods.stings : d.damage;
      const hit = gs.combat.applyHit(
        { owner: s.body, kind: 'projectile', damage: dmg, poise: d.poise, knockback: 0, hitstop: 0, shake: 0.03, angle: Math.atan2(a.y - s.y, a.x - s.x), unblockable: true, unparryable: true, quiet: true },
        a,
        gs.bus,
      );
      s.stingCd.set(a, d.everyTicks);
      if (hit) gs.bus.emit('sfx', { id: 'e_sting', x: a.x, y: a.y, volume: 0.8 });
    }
  }

  /** Bees: dark specks orbiting the cloud's heart, catching the light, a shadow on the ground. */
  draw(scene: Phaser.Scene, time: number) {
    this.g ??= scene.add.graphics();
    const g = this.g.clear();
    const body = hexToInt(DATA.palette.ink);
    const gold = hexToInt(DATA.palette.flame2);
    const amber = hexToInt(DATA.palette.flame1);
    const wing = hexToInt(DATA.palette.wax2);
    let deepest = DEPTH.shadow + 1;
    for (const s of this.list) {
      const R = s.def.radius * (0.35 + 0.65 * s.rouse);
      const cy = s.y - FLY;
      deepest = Math.max(deepest, DEPTH.actor(s.y + 6));
      g.fillStyle(body, 0.12 * s.fade * (0.4 + s.rouse)).fillEllipse(s.x, s.y + 2, R * 1.6, R * 0.5); // the cloud's shadow
      for (const b of s.bees) {
        b.a += b.s * (1 + s.rouse * 2);
        const rr = R * b.r;
        const bx = Math.round(s.x + Math.cos(b.a) * rr);
        const by = Math.round(cy + Math.sin(b.a) * rr * 0.7 + Math.sin(time * 0.012 + b.ph) * 2);
        const flick = Math.sin(time * 0.05 + b.ph) > 0;
        g.fillStyle(flick ? gold : amber, s.fade).fillRect(bx, by, 2, 1);
        g.fillStyle(body, s.fade).fillRect(bx + (Math.cos(b.a) > 0 ? 1 : 0), by, 1, 1);
        if (flick) g.fillStyle(wing, 0.7 * s.fade).fillRect(bx, by - 1, 1, 1);
      }
    }
    g.setDepth(deepest);
  }
}
