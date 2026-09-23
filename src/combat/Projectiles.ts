// Projectile simulation. Positions are on the ground plane (for wall collision); they fly at HEIGHT px above
// it, which is where they are drawn and tested against hurtboxes. Sub-stepped so fast shots can't tunnel.
import { DATA } from '../data/config';
import { shapeHitsRect } from './shapes';
import { TILE, type TileGrid } from '../world/TileGrid';
import type { Actor } from '../actors/Actor';
import type { CombatSystem, HitSource } from './CombatSystem';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { WeaponDef } from '../data/schemas';

export const PROJECTILE_HEIGHT = 10;
type ProjectileDef = NonNullable<WeaponDef['ranged']>['projectile'];

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
}

export class Projectiles {
  list: Projectile[] = [];

  spawn(owner: Actor, x: number, y: number, angle: number, def: ProjectileDef) {
    this.list.push({ owner, def, x, y, prevX: x, prevY: y, angle, traveled: 0, pierceLeft: def.pierce, hitSet: new Set(), alive: true });
  }

  clear() {
    this.list = [];
  }

  tick(actors: readonly Actor[], grid: TileGrid, combat: CombatSystem, bus: EventBus<GameEvents>) {
    for (const p of this.list) {
      p.prevX = p.x;
      p.prevY = p.y;
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
    this.list = this.list.filter(p => p.alive);
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
