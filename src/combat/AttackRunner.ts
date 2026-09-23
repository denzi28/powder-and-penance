// Runs one strike's timeline (windup -> active -> recovery) for any actor: aim tracking during windup,
// lunge, telegraph/swing events, hitbox registration while active, and the weapon pose for rendering.
import { DEG } from '../core/math';
import type { StrikeDef } from '../data/schemas';
import type { Actor } from '../actors/Actor';
import type { HitShape } from './shapes';

export type Phase = 'windup' | 'active' | 'recovery' | 'done';

const easeOut = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 2;

export function turnToward(from: number, to: number, maxStep: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

export class AttackRunner {
  /** Ticks elapsed (index of the next tick to run). */
  t = 0;
  angle: number;
  damageMult = 1;
  poiseMult = 1;
  readonly hitSet = new Set<Actor>();
  /** -1 when attacking toward the left half, so swings mirror and always read top-to-bottom. */
  readonly mirror: number;

  /**
   * @param restRel weapon angle (rad, relative to the attack direction) before/after the swing
   * @param visualOnly animate and emit events but register no hitbox (criticals apply damage directly)
   */
  constructor(
    readonly owner: Actor,
    readonly strike: StrikeDef,
    angle: number,
    private restRel = 0,
    private visualOnly = false,
  ) {
    this.angle = angle;
    this.mirror = Math.cos(angle) < 0 ? -1 : 1;
    this.restRel *= this.mirror;
  }

  get total() {
    const s = this.strike;
    return s.windup + s.active + s.recovery;
  }

  get phase(): Phase {
    const s = this.strike;
    if (this.t < s.windup) return 'windup';
    if (this.t < s.windup + s.active) return 'active';
    if (this.t < this.total) return 'recovery';
    return 'done';
  }

  get hyperArmor() {
    const p = this.phase;
    return p === 'windup' || p === 'active' ? this.strike.hyperArmor : 0;
  }

  track(to: number) {
    this.angle = turnToward(this.angle, to, this.strike.trackDegPerTick * DEG);
  }

  tick(trackTo?: number) {
    const s = this.strike;
    const o = this.owner;
    const bus = o.ctx.bus;
    if (this.phase === 'windup' && trackTo !== undefined) this.track(trackTo);
    if (s.telegraph && this.t === s.telegraph.tick) bus.emit('telegraph', { actor: o, kind: s.telegraph.kind });
    if (s.lunge) {
      const l = s.lunge;
      if (this.t >= l.startTick && this.t < l.startTick + l.ticks)
        o.moveBy((Math.cos(this.angle) * l.distance) / l.ticks, (Math.sin(this.angle) * l.distance) / l.ticks);
    }
    if (this.t === s.windup) bus.emit('swing', { actor: o, strike: s, angle: this.angle, mirror: this.mirror });
    if (this.phase === 'active' && !this.visualOnly)
      o.ctx.combat.add({
        owner: o,
        strike: s,
        angle: this.angle,
        hitSet: this.hitSet,
        damageMult: this.damageMult,
        poiseMult: this.poiseMult,
        shape: this.shape(),
      });
    this.t++;
  }

  shape(): HitShape {
    const s = this.strike;
    const hb = s.hitbox;
    const cx = this.owner.x + Math.cos(this.angle) * hb.offset;
    const cy = this.owner.y + s.originY + Math.sin(this.angle) * hb.offset;
    return hb.shape === 'arc'
      ? { kind: 'arc', cx, cy, angle: this.angle, radius: hb.radius, halfAngle: hb.halfAngle * DEG, inner: hb.inner }
      : { kind: 'circle', cx, cy, radius: hb.radius };
  }

  /** Absolute weapon angle and forward reach (px) for rendering, at the current tick. */
  pose(): { angle: number; reach: number } {
    const s = this.strike;
    const sw = s.sweep;
    const from = sw.fromDeg * DEG * this.mirror;
    const to = sw.toDeg * DEG * this.mirror;
    const t = this.t;
    let rel: number;
    let reach: number;
    if (t < s.windup) {
      const k = easeOut(t / Math.max(1, s.windup));
      rel = this.restRel + (from - this.restRel) * k;
      reach = -sw.reach * 0.5 * k;
    } else if (t < s.windup + s.active) {
      const k = easeOut((t - s.windup + 1) / s.active);
      rel = from + (to - from) * k;
      reach = -sw.reach * 0.5 + sw.reach * 1.5 * k;
    } else {
      const k = (t - s.windup - s.active) / Math.max(1, s.recovery);
      const back = k < 0.6 ? 0 : easeOut((k - 0.6) / 0.4);
      rel = to + (this.restRel - to) * back;
      reach = sw.reach * (1 - back);
    }
    return { angle: this.angle + rel, reach };
  }
}
