// Resolves hits in a fixed order. Melee hitboxes registered this tick are checked against every hurtbox;
// projectiles and criticals call applyHit() directly. Per hit:
//   i-frames -> guard (parry / block / guard break) -> damage, poise, knockback -> events.
import { DATA } from '../data/config';
import { DEG } from '../core/math';
import { shapeHitsRect, type HitShape } from './shapes';
import type { Actor } from '../actors/Actor';
import type { StrikeDef } from '../data/schemas';
import type { EventBus, GameEvents } from '../core/EventBus';

export interface ActiveHitbox {
  owner: Actor;
  strike: StrikeDef;
  angle: number;
  /** Targets already hit by this attack activation (each target is hit at most once). */
  hitSet: Set<Actor>;
  damageMult: number;
  poiseMult: number;
  shape: HitShape;
}

/** Everything that can hurt: a melee strike, a projectile, or a critical. */
export interface HitSource {
  owner: Actor;
  kind: 'melee' | 'projectile' | 'critical';
  damage: number;
  poise: number;
  knockback: number;
  hitstop: number;
  shake: number;
  /** Direction the attack travels (swing direction / projectile velocity). */
  angle: number;
  unblockable: boolean;
  unparryable: boolean;
  grab?: { holdTicks: number; damage: number; throwKnockback: number };
  /** Knockback drags the target toward the attacker instead of away (hooks). */
  pull?: boolean;
}

/** An actor's active guard (raised shield). */
export interface Guard {
  facing: number;
  arcDeg: number;
  parry: boolean;
  stability: number;
  absorption: number;
}

export interface HitInfo {
  source: HitSource;
  attacker: Actor;
  target: Actor;
  /** Damage actually dealt (chip damage when blocked). */
  damage: number;
  poiseDamage: number;
  staggered: boolean;
  killed: boolean;
  blocked: boolean;
  guardBroken: boolean;
  /** Knockback direction. */
  angle: number;
  x: number;
  y: number;
}

function angleDiff(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

export function sourceFromStrike(owner: Actor, s: StrikeDef, angle: number, damageMult = 1, poiseMult = 1): HitSource {
  return {
    owner,
    kind: 'melee',
    damage: Math.round(s.damage * damageMult),
    poise: s.poise * poiseMult,
    knockback: s.knockback,
    hitstop: s.hitstop,
    shake: s.shake,
    angle,
    unblockable: s.unblockable,
    unparryable: s.unparryable,
    grab: s.grab,
    pull: s.pull,
  };
}

export class CombatSystem {
  private boxes: ActiveHitbox[] = [];
  /** Shapes active during the last resolve, for the debug overlay. */
  debugShapes: HitShape[] = [];

  add(b: ActiveHitbox) {
    this.boxes.push(b);
  }

  clear() {
    this.boxes = [];
    this.debugShapes = [];
  }

  resolve(actors: readonly Actor[], bus: EventBus<GameEvents>) {
    this.debugShapes = this.boxes.map(b => b.shape);
    if (!this.boxes.length) return;
    for (const target of actors) {
      if (target.dead) continue;
      const rect = target.hurtRect();
      let best: ActiveHitbox | null = null;
      for (const b of this.boxes) {
        if (b.owner.team === target.team || b.owner.dead || b.hitSet.has(target)) continue;
        if (target.team === 'prop' && b.strike.grab) continue; // grabs only catch creatures
        if (!shapeHitsRect(b.shape, rect)) continue;
        if (!best || b.strike.damage * b.damageMult > best.strike.damage * best.damageMult) best = b;
      }
      if (!best) continue;
      // I-frames: ignored entirely and NOT marked as hit, so a lingering active window can still land later.
      if (target.invulnerable || target.god) continue;
      best.hitSet.add(target);
      this.applyHit(sourceFromStrike(best.owner, best.strike, best.angle, best.damageMult, best.poiseMult), target, bus);
    }
    this.boxes = [];
  }

  /** Apply one hit. Returns null when it was parried or ignored (i-frames). */
  applyHit(src: HitSource, target: Actor, bus: EventBus<GameEvents>): HitInfo | null {
    if (target.dead || target.invulnerable || target.god) return null;
    const attacker = src.owner;

    const guard = src.kind === 'critical' ? null : target.guard();
    if (guard) {
      // Where the hit comes from: the attacker's position for melee, the reverse of travel for projectiles.
      const from = src.kind === 'projectile' ? src.angle + Math.PI : Math.atan2(attacker.y - target.y, attacker.x - target.x);
      if (angleDiff(from, guard.facing) <= (guard.arcDeg * DEG) / 2) {
        if (guard.parry && src.kind === 'melee' && !src.unparryable) {
          attacker.onParried(target);
          bus.emit('parry', { parrier: target, attacker });
          return null;
        }
        if (!src.unblockable) return this.applyBlocked(src, target, guard, bus);
      }
    }

    target.hp = Math.max(0, target.hp - src.damage);
    const killed = target.hp <= 0;
    const staggered = !killed && src.kind !== 'critical' && target.poise.hit(src.poise, target.hyperArmor);
    const angle = this.knockAngle(src, target);
    target.knock(angle, src.knockback * (1 - target.knockbackResist));
    target.flash = DATA.juice.flashTicks;
    const info: HitInfo = {
      source: src,
      attacker,
      target,
      damage: src.damage,
      poiseDamage: src.poise,
      staggered,
      killed,
      blocked: false,
      guardBroken: false,
      angle,
      x: target.x,
      y: target.chestY,
    };
    target.onHit(info);
    bus.emit('hit', info);
    if (src.grab && !killed && !target.dead) target.onGrabbed(attacker, src.grab);
    return info;
  }

  private applyBlocked(src: HitSource, target: Actor, guard: Guard, bus: EventBus<GameEvents>): HitInfo {
    const cost = src.damage * (1 - guard.stability) * DATA.combat.blockStaminaMult;
    const guardBroken = target.spendGuardStamina(cost);
    const chip = Math.round(src.damage * (1 - guard.absorption));
    target.hp = Math.max(0, target.hp - chip);
    const angle = this.knockAngle(src, target);
    target.knock(angle, src.knockback * 0.5 * (1 - target.knockbackResist));
    const info: HitInfo = {
      source: src,
      attacker: src.owner,
      target,
      damage: chip,
      poiseDamage: 0,
      staggered: false,
      killed: target.hp <= 0,
      blocked: true,
      guardBroken,
      angle,
      x: target.x,
      y: target.chestY,
    };
    target.onHit(info);
    bus.emit('hit', info);
    return info;
  }

  private knockAngle(src: HitSource, target: Actor) {
    if (src.kind === 'projectile') return src.angle;
    const dx = target.x - src.owner.x;
    const dy = target.y - src.owner.y;
    const away = dx === 0 && dy === 0 ? src.angle : Math.atan2(dy, dx);
    return src.pull ? away + Math.PI : away;
  }
}
