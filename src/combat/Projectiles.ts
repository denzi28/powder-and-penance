// Projectile simulation. Positions are on the ground plane (for wall collision); straight shots fly at
// PROJECTILE_HEIGHT px above it, which is where they are drawn and tested against hurtboxes. Sub-stepped so
// fast shots can't tunnel. Lobbed projectiles (def.lob) arc over everything to a target point and burst there
// (scattering `shards`, if any). Straight shots may home in on a foe, glance off walls (`bounces`), or come back
// to the thrower like a boomerang (`returns`).
import { DATA } from '../data/config';
import { shapeHitsRect } from './shapes';
import { TILE, type TileGrid } from '../world/TileGrid';
import type { Actor } from '../actors/Actor';
import type { CombatSystem, HitSource } from './CombatSystem';
import type { EventBus, GameEvents } from '../core/EventBus';
import { ProjectileDef, type ShardsDef } from '../data/schemas';

export const PROJECTILE_HEIGHT = 10;

export interface Projectile {
  owner: Actor;
  def: ProjectileDef;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  angle: number;
  traveled: number;
  pierceLeft: number;
  hitSet: Set<Actor>;
  alive: boolean;
  /** Current draw height above the ground (px). */
  height: number;
  prevHeight: number;
  /** The weapon that fired it (its upgrade and scaling count); none for thrown consumables. */
  weapon?: string;
  /** Lobbed flight: start, landing point and elapsed ticks. */
  lob?: { sx: number; sy: number; tx: number; ty: number; t: number };
  /** Ticks in flight. */
  age: number;
  bouncesLeft: number;
  /** A boomerang on its way back. */
  returning: boolean;
}

/** Shards as full projectile defs (parsed once, with the schema's defaults). */
const shardDefs = new WeakMap<ShardsDef, ProjectileDef>();
function shardDef(s: ShardsDef): ProjectileDef {
  let d = shardDefs.get(s);
  if (!d) {
    d = ProjectileDef.parse({ sprite: s.sprite, speed: s.speed, range: s.range, damage: s.damage, poise: s.poise, knockback: s.knockback, radius: s.radius });
    shardDefs.set(s, d);
  }
  return d;
}

export class Projectiles {
  list: Projectile[] = [];

  spawn(owner: Actor, x: number, y: number, angle: number, def: ProjectileDef, target?: { x: number; y: number }, weapon?: string) {
    const p: Projectile = {
      owner, def, x, y, prevX: x, prevY: y, angle, traveled: 0, pierceLeft: def.pierce,
      hitSet: new Set(), alive: true, height: PROJECTILE_HEIGHT, prevHeight: PROJECTILE_HEIGHT, weapon,
      age: 0, bouncesLeft: def.bounces, returning: false,
    };
    if (def.lob && target) p.lob = { sx: x, sy: y, tx: target.x, ty: target.y, t: 0 };
    this.list.push(p);
  }

  clear() {
    this.list = [];
  }

  /** Is this thrower's weapon out on a boomerang throw (so it isn't in their hand)? */
  weaponOut(owner: Actor) {
    return this.list.some(p => p.owner === owner && p.def.returns && p.alive);
  }

  tick(actors: readonly Actor[], grid: TileGrid, combat: CombatSystem, bus: EventBus<GameEvents>) {
    for (const p of this.list) {
      p.prevX = p.x;
      p.prevY = p.y;
      p.prevHeight = p.height;
      p.age++;
      if (p.lob) this.tickLob(p, actors, combat, bus);
      else this.tickStraight(p, actors, grid, combat, bus);
    }
    this.list = this.list.filter(p => p.alive);
  }

  private tickStraight(p: Projectile, actors: readonly Actor[], grid: TileGrid, combat: CombatSystem, bus: EventBus<GameEvents>) {
    const def = p.def;
    if (p.returning) {
      // a boomerang heads home, through walls, and is caught when it gets there
      p.angle = Math.atan2(p.owner.y - p.y, p.owner.x - p.x);
      if (p.owner.dead || Math.hypot(p.owner.x - p.x, p.owner.y - p.y) < 10) {
        p.alive = false;
        return;
      }
    } else if (def.homing && p.age <= def.homing.ticks) {
      const foe = this.nearestFoe(p, actors);
      if (foe) {
        const want = Math.atan2(foe.y - p.y, foe.x - p.x);
        const d = Math.atan2(Math.sin(want - p.angle), Math.cos(want - p.angle));
        const max = (def.homing.degPerTick * Math.PI) / 180;
        p.angle += Math.max(-max, Math.min(max, d));
      }
    }
    const step = def.speed / DATA.game.tickRate;
    const subs = Math.max(1, Math.ceil(step / 3));
    for (let i = 0; i < subs && p.alive; i++) {
      const ox = p.x;
      const oy = p.y;
      p.x += (Math.cos(p.angle) * step) / subs;
      p.y += (Math.sin(p.angle) * step) / subs;
      if (!p.returning && grid.isSolid(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) {
        if (p.bouncesLeft > 0) {
          // glance off: flip whichever direction ran into the wall
          p.bouncesLeft--;
          const hitX = grid.isSolid(Math.floor(p.x / TILE), Math.floor(oy / TILE));
          const hitY = grid.isSolid(Math.floor(ox / TILE), Math.floor(p.y / TILE));
          let vx = Math.cos(p.angle);
          let vy = Math.sin(p.angle);
          if (hitX || !hitY) vx = -vx;
          if (hitY || !hitX) vy = -vy;
          p.angle = Math.atan2(vy, vx);
          p.x = ox;
          p.y = oy;
          p.hitSet.clear();
          bus.emit('projectileEnd', { x: p.x, y: p.y - PROJECTILE_HEIGHT, angle: p.angle, wall: true, bounce: true });
          continue;
        }
        if (def.returns) {
          this.turnBack(p);
          break;
        }
        p.alive = false;
        bus.emit('projectileEnd', { x: p.x, y: p.y - PROJECTILE_HEIGHT, angle: p.angle, wall: true });
        break;
      }
      this.hitActors(p, actors, combat, bus);
    }
    p.traveled += step;
    if (p.alive && !p.returning && p.traveled >= def.range) {
      if (def.returns) this.turnBack(p);
      else {
        p.alive = false;
        bus.emit('projectileEnd', { x: p.x, y: p.y - PROJECTILE_HEIGHT, angle: p.angle, wall: false });
      }
    }
  }

  private turnBack(p: Projectile) {
    p.returning = true;
    p.hitSet.clear(); // it can catch you again on the way back
  }

  private nearestFoe(p: Projectile, actors: readonly Actor[]): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of actors) {
      if (a.dead || a.team === p.owner.team || a.team === 'prop') continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  private tickLob(p: Projectile, actors: readonly Actor[], combat: CombatSystem, bus: EventBus<GameEvents>) {
    const l = p.lob!;
    const lob = p.def.lob!;
    l.t++;
    const k = Math.min(1, l.t / lob.flightTicks);
    p.x = l.sx + (l.tx - l.sx) * k;
    p.y = l.sy + (l.ty - l.sy) * k;
    p.height = 6 + 4 * lob.arcHeight * k * (1 - k);
    if (k < 1) return;
    // Burst: area damage to everyone (not the thrower's team) whose hurtbox touches the blast circle.
    p.alive = false;
    bus.emit('blast', { x: l.tx, y: l.ty, radius: lob.blastRadius, sfx: lob.sfx });
    const sh = p.def.shards;
    if (sh) {
      const d = shardDef(sh);
      const turn = Math.random() * Math.PI * 2;
      for (let i = 0; i < sh.count; i++) this.spawn(p.owner, l.tx, l.ty, turn + (i / sh.count) * Math.PI * 2, d);
    }
    const shape = { kind: 'circle' as const, cx: l.tx, cy: l.ty - 6, radius: lob.blastRadius };
    for (const a of actors) {
      if (a.dead || a.team === p.owner.team || !shapeHitsRect(shape, a.hurtRect())) continue;
      combat.applyHit(
        {
          owner: p.owner,
          kind: 'projectile',
          damage: p.def.damage,
          poise: p.def.poise,
          knockback: p.def.knockback,
          hitstop: p.def.hitstop,
          shake: p.def.shake,
          angle: Math.atan2(a.y - l.ty, a.x - l.tx),
          weapon: p.weapon,
          unblockable: true, // it's an explosion: shields don't help, rolling does
          unparryable: true,
        },
        a,
        bus,
      );
    }
  }

  private hitActors(p: Projectile, actors: readonly Actor[], combat: CombatSystem, bus: EventBus<GameEvents>) {
    const shape = { kind: 'circle' as const, cx: p.x, cy: p.y - PROJECTILE_HEIGHT, radius: p.def.radius };
    for (const a of actors) {
      if (a.dead || a.team === p.owner.team || p.hitSet.has(a) || a.invulnerable || a.god) continue;
      if (!shapeHitsRect(shape, a.hurtRect())) continue;
      p.hitSet.add(a);
      const src: HitSource = {
        owner: p.owner,
        kind: 'projectile',
        damage: p.def.damage,
        poise: p.def.poise,
        knockback: p.def.knockback,
        hitstop: p.def.hitstop,
        shake: p.def.shake,
        angle: p.angle,
        weapon: p.weapon,
        unblockable: false,
        unparryable: true,
      };
      const info = combat.applyHit(src, a, bus);
      if (info?.blocked || p.pierceLeft-- <= 0) {
        p.alive = false;
        return;
      }
    }
  }
}
