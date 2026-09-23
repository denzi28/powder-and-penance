// Common simulation state for everything that fights: position, velocity, knockback, HP, poise, flash.
import { DATA } from '../data/config';
import { moveBox } from '../world/collision';
import { Squash } from './Squash';
import type { Poise } from './Poise';
import type { WorldCtx } from '../core/World';
import type { Rect } from '../combat/shapes';
import type { AttackRunner } from '../combat/AttackRunner';
import type { Guard, HitInfo } from '../combat/CombatSystem';

/** 'prop' = breakable scenery: anyone's attacks can hit it. */
export type Team = 'player' | 'enemy' | 'prop';
export interface HurtBox {
  w: number;
  h: number;
  offsetY: number;
}

let nextId = 1;

export abstract class Actor {
  readonly id = nextId++;
  abstract readonly team: Team;
  abstract readonly poise: Poise;

  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx = 0;
  vy = 0;
  kbx = 0;
  kby = 0;
  /** Direction the body faces (radians, screen space). */
  facing = Math.PI / 2;
  hp = 1;
  dead = false;
  invulnerable = false;
  god = false;
  /** Temporary poise buffer (hyper-armor) granted by the current attack. */
  hyperArmor = 0;
  flash = 0;
  /** Absolute weapon angle while attacking (null = view decides, e.g. follow aim). */
  weaponAngle: number | null = null;
  prevWeaponAngle: number | null = null;
  weaponReach = 0;
  runner: AttackRunner | null = null;
  readonly squash = new Squash();
  /** Visual-only recoil offset (px) pushed away from a hit; decays each tick. */
  flinchX = 0;
  flinchY = 0;

  constructor(readonly ctx: WorldCtx, x: number, y: number) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
  }

  abstract get maxHp(): number;
  abstract get collider(): { w: number; h: number };
  abstract get hurtbox(): HurtBox;
  abstract get bodyRadius(): number;
  /** Palette key for hit particles. */
  abstract get bloodColor(): string;
  /** 0 = full knockback, 1 = immovable. */
  get knockbackResist() {
    return 0;
  }
  abstract get stateName(): string;
  abstract get stateTick(): number;
  abstract tick(): void;
  abstract onHit(hit: HitInfo): void;

  /** Active guard (raised shield), if any. */
  guard(): Guard | null {
    return null;
  }
  /** Pay stamina for a blocked hit; returns true if that broke the guard. */
  spendGuardStamina(_cost: number): boolean {
    return false;
  }
  /** This actor's melee attack was parried by `_by`. */
  onParried(_by: Actor) {}
  /** Caught by a grab strike (only the player reacts). */
  onGrabbed(_by: Actor, _grab: { holdTicks: number; damage: number; throwKnockback: number }) {}

  protected beginTick() {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevWeaponAngle = this.weaponAngle;
    if (this.flash > 0) this.flash--;
    this.poise.tick();
    this.flinchX = Math.abs(this.flinchX) < 0.3 ? 0 : this.flinchX * 0.6;
    this.flinchY = Math.abs(this.flinchY) < 0.3 ? 0 : this.flinchY * 0.6;
  }

  /** Visual jolt away from a hit (does not move the actor). */
  flinch(angle: number, px: number) {
    this.flinchX = Math.cos(angle) * px;
    this.flinchY = Math.sin(angle) * px * 0.6;
  }

  moveBy(dx: number, dy: number) {
    const c = this.collider;
    const r = moveBox(this.ctx.grid(), this.x, this.y, c.w / 2, c.h, dx, dy);
    this.x = r.x;
    this.y = r.y;
    return r;
  }

  /** Approach a target velocity at `speedRef / accelTicks` per tick (braking uses decelTicks). */
  accelerate(tx: number, ty: number, speedRef: number, accelTicks: number, decelTicks = accelTicks) {
    const braking = (tx === 0 && ty === 0) || tx * this.vx + ty * this.vy < 0;
    const rate = speedRef / (braking ? decelTicks : accelTicks);
    const dx = tx - this.vx;
    const dy = ty - this.vy;
    const len = Math.hypot(dx, dy);
    if (len <= rate) {
      this.vx = tx;
      this.vy = ty;
    } else {
      this.vx += (dx / len) * rate;
      this.vy += (dy / len) * rate;
    }
  }

  integrate() {
    const r = this.moveBy(this.vx / DATA.game.tickRate, this.vy / DATA.game.tickRate);
    if (r.hitX) this.vx = 0;
    if (r.hitY) this.vy = 0;
  }

  knock(angle: number, impulse: number) {
    this.kbx += Math.cos(angle) * impulse;
    this.kby += Math.sin(angle) * impulse;
  }

  protected applyKnockback() {
    if (Math.abs(this.kbx) + Math.abs(this.kby) < 2) {
      this.kbx = this.kby = 0;
      return;
    }
    const r = this.moveBy(this.kbx / DATA.game.tickRate, this.kby / DATA.game.tickRate);
    if (r.hitX) this.kbx = 0;
    if (r.hitY) this.kby = 0;
    this.kbx *= DATA.combat.knockbackDecay;
    this.kby *= DATA.combat.knockbackDecay;
  }

  hurtRect(): Rect {
    const h = this.hurtbox;
    return { x: this.x - h.w / 2, y: this.y + h.offsetY - h.h / 2, w: h.w, h: h.h };
  }

  /** Point at chest height, used for aiming/particles. */
  get chestY() {
    return this.y + this.hurtbox.offsetY;
  }
}
