// Enemy simulation: an Actor driven by a data-defined archetype (data/enemies/*.json) and a brain
// state machine (EnemyBrain.ts). Stats are read live from DATA so tuning hot-reloads.
import { DATA } from '../data/config';
import { SPRITES } from '../data/assets';
import { Actor } from '../actors/Actor';
import { Poise } from '../actors/Poise';
import { StateMachine } from '../actors/StateMachine';
import { AnimPlayer } from '../anim/AnimPlayer';
import { AttackRunner, turnToward } from '../combat/AttackRunner';
import { DEG, dir8FromAngle, type Dir8 } from '../core/math';
import { canSee } from './perception';
import { BRAINS } from './EnemyBrain';
import type { WorldCtx } from '../core/World';
import type { HitInfo } from '../combat/CombatSystem';
import type { MoveDef } from '../data/schemas';

export class Enemy extends Actor {
  readonly team = 'enemy' as const;
  readonly poise: Poise;
  readonly anim: AnimPlayer;
  readonly sm: StateMachine<Enemy>;
  dir: Dir8 = 'S';
  readonly homeX: number;
  readonly homeY: number;
  readonly homeFacing: number;

  move: MoveDef | null = null;
  strikeIndex = 0;
  readonly cooldowns = new Map<string, number>();
  attackGap = 0;
  age = 0;
  lastSeen = -Infinity;
  reactTicks = 0;
  strafeDir = 1;
  strafeLeft = 0;
  /** Ticks left to show the overhead health bar. */
  barTicks = 0;
  /** Dummy readout. */
  lastHit: { damage: number; poise: number; staggered: boolean; age: number } | null = null;
  /** Set once the corpse has faded; the scene removes the enemy. */
  remove = false;
  alpha = 1;

  constructor(ctx: WorldCtx, readonly kind: string, x: number, y: number, facing: number) {
    super(ctx, x, y);
    this.homeX = x;
    this.homeY = y;
    this.facing = this.homeFacing = facing;
    this.poise = new Poise(() => this.def.poise);
    this.hp = this.def.hp;
    this.anim = new AnimPlayer(SPRITES[this.def.sprite].animations);
    this.anim.play('idle');
    this.dir = dir8FromAngle(facing);
    this.sm = new StateMachine<Enemy>(this, BRAINS[this.def.ai], 'idle');
    this.sm.start();
  }

  get def() {
    return DATA.enemies[this.kind];
  }
  get maxHp() {
    return this.def.hp;
  }
  get collider() {
    return this.def.collider;
  }
  get hurtbox() {
    return this.def.hurtbox;
  }
  get bodyRadius() {
    return this.def.bodyRadius;
  }
  get bloodColor() {
    return this.def.blood;
  }
  get knockbackResist() {
    return this.def.knockbackResist;
  }
  get stateName() {
    return this.sm.name;
  }
  get stateTick() {
    return this.sm.t;
  }

  tick() {
    this.beginTick();
    this.age++;
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - 1);
    if (this.attackGap > 0) this.attackGap--;
    if (this.barTicks > 0) this.barTicks--;

    this.sm.tick();
    this.applyKnockback();
    this.hyperArmor = this.runner?.hyperArmor ?? 0;
    if (this.runner) {
      const pose = this.runner.pose();
      this.weaponAngle = pose.angle;
      this.weaponReach = pose.reach;
    } else {
      this.weaponAngle = this.facing + this.def.weaponRestDeg * DEG * (Math.cos(this.facing) < 0 ? -1 : 1);
      this.weaponReach = 0;
    }
    this.dir = dir8FromAngle(this.facing);

    const st = this.sm.name;
    const speed = Math.hypot(this.vx, this.vy);
    if (this.def.ai === 'dummy') {
      if (this.anim.name === 'hit' && this.anim.done) this.anim.play('idle');
      this.anim.tick();
    } else if (st === 'attack' || st === 'stagger' || st === 'dead') {
      this.anim.tick();
    } else if (speed > 4) {
      this.anim.play('walk');
      this.anim.tick(speed / Math.max(1, this.def.speed));
    } else {
      this.anim.play('idle');
      this.anim.tick();
    }
    this.squash.tick();
  }

  onHit(h: HitInfo) {
    this.barTicks = DATA.juice.enemyBarTicks;
    if (this.def.ai === 'dummy') {
      this.lastHit = { damage: h.damage, poise: h.poiseDamage, staggered: h.staggered, age: this.age };
      this.hp = this.maxHp;
      this.anim.play('hit', { restart: true });
      this.ctx.bus.emit('sfx', { id: 'dummy_hit', x: this.x, y: this.y });
      if (h.staggered) this.sm.change('stagger', true);
      return;
    }
    if (h.killed) this.sm.change('dead');
    else if (h.staggered) this.sm.change('stagger', true);
    else {
      this.squash.set(DATA.juice.squash.hit);
      this.aggro();
    }
  }

  /** Enter combat immediately (hit, or alerted by an ally). */
  aggro() {
    const st = this.sm.name;
    if (st === 'idle' || st === 'notice' || st === 'return') {
      this.lastSeen = this.age;
      this.sm.change('approach');
      this.alertAllies();
    }
  }

  alertAllies() {
    const r = this.def.perception.alertShareRadius;
    for (const o of this.ctx.enemies())
      if (o !== this && !o.dead && o.def.ai !== 'dummy' && o.sm.name === 'idle' && Math.hypot(o.x - this.x, o.y - this.y) <= r)
        o.sm.change('notice');
  }

  get player() {
    return this.ctx.player();
  }
  distToPlayer() {
    const p = this.player;
    return Math.hypot(p.x - this.x, p.y - this.y);
  }
  angleToPlayer() {
    const p = this.player;
    return Math.atan2(p.y - this.y, p.x - this.x);
  }

  /** Vision check. In combat the cone is ignored and range extended (they track you, not scan for you). */
  seesPlayer(inCombat: boolean): boolean {
    const p = this.player;
    if (p.dead) return false;
    const per = this.def.perception;
    const ok = canSee(
      this.ctx.grid(),
      this.x,
      this.chestY,
      this.facing,
      p.x,
      p.chestY,
      inCombat ? per.range * 1.6 : per.range,
      inCombat ? Math.PI : per.halfAngleDeg * DEG,
    );
    if (ok) this.lastSeen = this.age;
    return ok;
  }

  turnTo(angle: number) {
    this.facing = turnToward(this.facing, angle, this.def.turnDegPerTick * DEG);
  }

  /** Accelerate toward a velocity and move. */
  steer(tvx: number, tvy: number) {
    this.accelerate(tvx, tvy, Math.max(1, this.def.speed), this.def.accelTicks);
    this.integrate();
  }

  shouldLeash(): boolean {
    const l = this.def.leash;
    return (
      this.player.dead ||
      Math.hypot(this.x - this.homeX, this.y - this.homeY) > l.distance ||
      this.age - this.lastSeen > this.def.perception.loseTicks
    );
  }

  /** Off the post-attack gap, has a move off cooldown, and a token is free: close in to attack. */
  readyToAttack(): boolean {
    return (
      this.attackGap <= 0 &&
      !this.player.dead &&
      this.def.moves.some(m => !(this.cooldowns.get(m.id) ?? 0)) &&
      this.ctx.tokens.available(this)
    );
  }

  /** Pick an in-range, off-cooldown move by weight and take an attack token. */
  tryAttack(): boolean {
    if (this.attackGap > 0 || this.player.dead) return false;
    const d = this.distToPlayer();
    const facingErr = Math.abs(Math.atan2(Math.sin(this.angleToPlayer() - this.facing), Math.cos(this.angleToPlayer() - this.facing)));
    if (facingErr > 70 * DEG) return false;
    const options = this.def.moves.filter(m => d >= m.range[0] && d <= m.range[1] && !(this.cooldowns.get(m.id) ?? 0));
    if (!options.length || !this.ctx.tokens.acquire(this)) return false;
    let roll = this.ctx.rng() * options.reduce((s, m) => s + m.weight, 0);
    this.move = options[options.length - 1];
    for (const m of options) if ((roll -= m.weight) <= 0) {
      this.move = m;
      break;
    }
    return true;
  }

  startStrike() {
    const s = this.move!.strikes[this.strikeIndex];
    this.vx = this.vy = 0;
    this.runner = new AttackRunner(this, s, this.facing, this.def.weaponRestDeg * DEG);
    this.anim.play('attack', { restart: true, phases: { windup: s.windup, active: s.active, recovery: s.recovery } });
  }

  randRange([a, b]: readonly [number, number]) {
    return Math.round(a + (b - a) * this.ctx.rng());
  }

  kill() {
    if (this.dead || this.def.ai === 'dummy') return;
    this.hp = 0;
    this.sm.change('dead');
  }
}
