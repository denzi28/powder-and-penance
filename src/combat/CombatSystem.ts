// Resolves hitboxes registered this tick against every actor's hurtbox, in a fixed order:
// collect overlaps -> strongest hit per target -> i-frame check -> damage, poise, knockback -> events.
import { DATA } from '../data/config';
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

export interface HitInfo {
  attacker: Actor;
  target: Actor;
  strike: StrikeDef;
  damage: number;
  poiseDamage: number;
  staggered: boolean;
  killed: boolean;
  /** Direction from attacker to target (knockback direction). */
  angle: number;
  x: number;
  y: number;
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
        if (!shapeHitsRect(b.shape, rect)) continue;
        if (!best || b.strike.damage * b.damageMult > best.strike.damage * best.damageMult) best = b;
      }
      if (!best) continue;
      // I-frames: ignored entirely and NOT marked as hit, so a lingering active window can still land later.
      if (target.invulnerable || target.god) continue;
      best.hitSet.add(target);
      this.apply(best, target, bus);
    }
    this.boxes = [];
  }

  private apply(b: ActiveHitbox, target: Actor, bus: EventBus<GameEvents>) {
    const s = b.strike;
    const damage = Math.round(s.damage * b.damageMult);
    const poiseDamage = s.poise * b.poiseMult;
    target.hp = Math.max(0, target.hp - damage);
    const killed = target.hp <= 0;
    const staggered = !killed && target.poise.hit(poiseDamage, target.hyperArmor);
    const dx = target.x - b.owner.x;
    const dy = target.y - b.owner.y;
    const angle = dx === 0 && dy === 0 ? b.angle : Math.atan2(dy, dx);
    target.knock(angle, s.knockback * (1 - target.knockbackResist));
    target.flash = DATA.juice.flashTicks;
    const info: HitInfo = {
      attacker: b.owner,
      target,
      strike: s,
      damage,
      poiseDamage,
      staggered,
      killed,
      angle,
      x: target.x,
      y: target.chestY,
    };
    target.onHit(info);
    bus.emit('hit', info);
  }
}
