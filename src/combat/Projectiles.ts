// Projectile simulation. Positions are on the ground plane (for wall collision); straight shots fly at
// PROJECTILE_HEIGHT px above it, which is where they are drawn and tested against hurtboxes. Sub-stepped so
// fast shots can't tunnel. Lobbed projectiles (def.lob) arc over everything to a target point and burst there.
import { DATA } from '../data/config';
import { shapeHitsRect } from './shapes';
import { TILE, type TileGrid } from '../world/TileGrid';
import type { Actor } from '../actors/Actor';
import type { CombatSystem, HitSource } from './CombatSystem';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { ProjectileDef } from '../data/schemas';

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
}

export class Projectiles {
  list: Projectile[] = [];

  spawn(owner: Actor, x: number, y: number, angle: number, def: ProjectileDef, target?: { x: number; y: number }, weapon?: string) {
    const p: Projectile = {
      owner, def, x, y, prevX: x, prevY: y, angle, traveled: 0, pierceLeft: def.pierce,
      hitSet: new Set(), alive: true, height: PROJECTILE_HEIGHT, prevHeight: PROJECTILE_HEIGHT, weapon,
    };
    if (def.lob && target) p.lob = { sx: x, sy: y, tx: target.x, ty: target.y, t: 0 };
    this.list.push(p);
  }

  clear() {
    this.list = [];
  }

  tick(actors: readonly Actor[], grid: TileGrid, combat: CombatSystem, bus: EventBus<GameEvents>) {
    for (const p of this.list) {
      p.prevX = p.x;
      p.prevY = p.y;
      p.prevHeight = p.height;
      if (p.lob) this.tickLob(p, actors, combat, bus);
      else this.tickStraight(p, actors, grid, combat, bus);
    }
    this.list = this.list.filter(p => p.alive);
  }

  private tickStraight(p: Projectile, actors: readonly Actor[], grid: TileGrid, combat: CombatSystem, bus: EventBus<GameEvents>) {
    const step = p.def.speed / DATA.game.tickRate;
    const subs = Math.max(1, Math.ceil(step / 3));
    const dx = (Math.cos(p.angle) * step) / subs;
    const dy = (Math.sin(p.angle) * step) / subs;
    for (let i = 0; i < subs && p.alive; i++) {
      p.x += dx;
      p.y += dy;
      if (grid.isSolid(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) {
        p.alive = false;
        bus.emit('projectileEnd', { x: p.x, y: p.y - PROJECTILE_HEIGHT, angle: p.angle, wall: true });
        break;
      }
      this.hitActors(p, actors, combat, bus);
    }
    p.traveled += step;
    if (p.alive && p.traveled >= p.def.range) {
      p.alive = false;
      bus.emit('projectileEnd', { x: p.x, y: p.y - PROJECTILE_HEIGHT, angle: p.angle, wall: false });
    }
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
