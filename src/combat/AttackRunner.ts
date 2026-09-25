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
  /** Where thrown strikes (strike.projectile) aim; set by the owner each tick. */
  target: { x: number; y: number } | null = null;
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
    if (this.t === 0 && s.windupSfx) bus.emit('sfx', { id: s.windupSfx, x: o.x, y: o.y });
    if (s.telegraph && this.t === s.telegraph.tick) bus.emit('telegraph', { actor: o, kind: s.telegraph.kind });
    if (s.lunge) {
      const l = s.lunge;
      if (this.t >= l.startTick && this.t < l.startTick + l.ticks)
        o.moveBy((Math.cos(this.angle) * l.distance) / l.ticks, (Math.sin(this.angle) * l.distance) / l.ticks);
    }
    if (this.t === s.windup) {
      if (s.pools) bus.emit('pools', { actor: o, strike: s, target: this.target });
      if (s.eruptions) bus.emit('eruptions', { actor: o, strike: s, target: this.target, angle: this.angle });
      if (s.smoke) bus.emit('smoke', { actor: o, strike: s, angle: this.angle });
      if (s.swarm) bus.emit('swarm', { actor: o, strike: s });
      if (s.summon) bus.emit('summon', { actor: o, strike: s });
      else if (s.vanish) bus.emit('vanish', { actor: o, strike: s });
      else if (s.projectile) {
        this.volley(0);
        bus.emit('thrown', { actor: o, strike: s });
      } else if (!s.smoke) bus.emit('swing', { actor: o, strike: s, angle: this.angle, mirror: this.mirror }); // (a puff of smoke is no swing)
    }
    // more volleys through the active frames (a barrage, a spiral)
    const v = s.projectile?.volleys;
    if (v && this.t > s.windup && this.phase === 'active' && (this.t - s.windup) % v.everyTicks === 0) {
      const i = (this.t - s.windup) / v.everyTicks;
      if (i < v.count) {
        this.volley(i);
        bus.emit('thrown', { actor: o, strike: s });
      }
    }
    // a spin can catch you more than once
    if (s.rehitTicks && this.phase === 'active' && this.t > s.windup && (this.t - s.windup) % s.rehitTicks === 0) this.hitSet.clear();
    const spellOnly = s.summon || s.vanish || ((s.pools || s.eruptions || s.smoke || s.swarm) && s.damage === 0);
    if (this.phase === 'active' && !this.visualOnly && !s.projectile && !spellOnly)
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

  /**
   * Throw volley `i`: `count` shots in an even fan `spreadDeg` wide around the aim, or all the way round
   * (`ring`); lobs land at the target's distance, swung round the thrower, so a volley reads the same every
   * time. Later volleys turn by `turnDeg` each (a spiral) or aim afresh (`reaim`).
   */
  private volley(i: number) {
    const s = this.strike;
    const o = this.owner;
    const pr = s.projectile!;
    let t = this.target ?? { x: o.x + Math.cos(this.angle) * 80, y: o.y + Math.sin(this.angle) * 80 };
    if (i === 0) {
      // a Fuse-Runner's spark goes for the keg beside you, if there is one
      const keg = s.aimAtKeg ? o.ctx.kegNear?.(t.x, t.y, s.aimAtKeg) : null;
      if (keg) {
        t = keg;
        this.angle = Math.atan2(keg.y - o.y, keg.x - o.x);
      }
    }
    const v = pr.volleys;
    let aim = this.angle;
    if (i > 0 && v) aim = v.reaim && this.target ? Math.atan2(t.y - o.y, t.x - o.x) : this.angle + i * v.turnDeg * DEG * this.mirror;
    const dist = Math.hypot(t.x - o.x, t.y - o.y);
    for (let k = 0; k < pr.count; k++) {
      const a = pr.ring ? aim + (k / pr.count) * Math.PI * 2 : aim + (pr.count > 1 ? (k / (pr.count - 1) - 0.5) * pr.spreadDeg * DEG : 0);
      const land = pr.count > 1 || i > 0 ? { x: o.x + Math.cos(a) * dist, y: o.y + Math.sin(a) * dist } : t;
      o.ctx.projectiles.spawn(o, o.x + Math.cos(a) * 8, o.y + Math.sin(a) * 4, a, pr, v?.reaim && pr.lob ? t : land);
    }
  }

  shape(): HitShape {
    const s = this.strike;
    const hb = s.hitbox;
    let angle = this.angle;
    let half = hb.shape === 'arc' ? hb.halfAngle * DEG : 0;
    if (s.followSweep && hb.shape === 'arc') {
      // centred on the weapon, widened to cover where it swept since the last tick (fast spins can't skip you)
      const now = this.pose().angle;
      this.t--;
      const before = this.pose().angle;
      this.t++;
      const d = Math.atan2(Math.sin(now - before), Math.cos(now - before));
      angle = now - d / 2;
      half = Math.min(Math.PI, half + Math.abs(d) / 2);
    }
    const cx = this.owner.x + Math.cos(angle) * hb.offset;
    const cy = this.owner.y + s.originY + Math.sin(angle) * hb.offset;
    return hb.shape === 'arc'
      ? { kind: 'arc', cx, cy, angle, radius: hb.radius, halfAngle: half, inner: hb.inner }
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
