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

/** States in which the enemy is actively fighting (knows where you are). */
export const COMBAT_STATES: ReadonlySet<string> = new Set(['approach', 'strafe', 'attack']);
/** States in which it is not expecting you: backstabs allowed from behind. */
const UNAWARE_STATES: ReadonlySet<string> = new Set(['idle', 'suspicious', 'return', 'stagger', 'parried']);

export class Enemy extends Actor {
  readonly team = 'enemy' as const;
  readonly poise: Poise;
  readonly anim: AnimPlayer;
  readonly sm: StateMachine<Enemy>;
  dir: Dir8 = 'S';
  readonly homeX: number;
  readonly homeY: number;
  readonly homeFacing: number;
  /** Room this enemy belongs to (alerts spread through it). */
  readonly room: string | null;

  move: MoveDef | null = null;
  strikeIndex = 0;
  readonly cooldowns = new Map<string, number>();
  attackGap = 0;
  age = 0;
  reactTicks = 0;
  strafeDir = 1;
  strafeLeft = 0;

  // Stealth / awareness
  /** 0 = unaware, >= suspicionAt = suspicious, 1 = certain. */
  awareness = 0;
  /** Could see the player this tick (line of sight + cone; cone ignored in combat). */
  visible = false;
  lastSeen = -Infinity;
  lastSeenX = 0;
  lastSeenY = 0;
  searchLeft = 0;
  critTicks = 0;

  /** Ticks left to show the overhead health bar. */
  barTicks = 0;
  /** Training-target readout. */
  lastHit: { damage: number; poise: number; staggered: boolean; age: number } | null = null;
  /** Set once the corpse has faded; the scene removes the enemy. */
  remove = false;
  alpha = 1;

  constructor(ctx: WorldCtx, readonly kind: string, x: number, y: number, facing: number) {
    super(ctx, x, y);
    this.homeX = x;
    this.homeY = y;
    this.facing = this.homeFacing = facing;
    this.room = ctx.roomAt(x, y);
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
  /** Can be riposted right now. */
  get critOpen() {
    return this.sm.name === 'parried';
  }
  get backstabbable() {
    return !this.dead && UNAWARE_STATES.has(this.sm.name);
  }
  /** State to fall back to after a stagger/parry/critical. */
  get recoverState() {
    return this.def.ai === 'melee' ? 'approach' : 'idle';
  }

  tick() {
    this.beginTick();
    this.age++;
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - 1);
    if (this.attackGap > 0) this.attackGap--;
    if (this.barTicks > 0) this.barTicks--;

    if (this.def.ai === 'melee' && !this.dead && this.sm.name !== 'critVictim') this.perceive();
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
    } else if (st === 'attack' || st === 'stagger' || st === 'dead' || st === 'parried' || st === 'critVictim') {
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

  /**
   * Sight has no range limit; walls and the facing cone hide you. While seen, awareness rises faster the
   * closer you are. Out of combat, awareness slowly fades while you are unseen.
   */
  private perceive() {
    const p = this.player;
    const per = this.def.perception;
    const inCombat = COMBAT_STATES.has(this.sm.name);
    this.visible =
      !p.dead &&
      canSee(this.ctx.grid(), this.x, this.chestY, this.facing, p.x, p.chestY, Infinity, inCombat ? Math.PI : per.halfAngleDeg * DEG);
    if (this.visible) {
      this.noteSighting();
      if (this.awareness < 1) {
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        const k = Math.max(0, Math.min(1, (d - per.nearDistance) / Math.max(1, per.farDistance - per.nearDistance)));
        this.awareness = Math.min(1, this.awareness + 1 / (per.detectTicksNear + (per.detectTicksFar - per.detectTicksNear) * k));
      }
    } else if (!inCombat) {
      this.awareness = Math.max(0, this.awareness - per.forgetPerTick);
    }
  }

  private noteSighting() {
    this.lastSeen = this.age;
    this.lastSeenX = this.player.x;
    this.lastSeenY = this.player.y;
  }

  /** In combat: do we know where the player is? Seen directly, or they are inside our (alerted) room. */
  trackPlayer(): boolean {
    const p = this.player;
    if (p.dead) return false;
    const known = this.visible || (this.room !== null && this.ctx.roomAt(p.x, p.y) === this.room);
    if (known) this.noteSighting();
    return known;
  }

  onHit(h: HitInfo) {
    this.barTicks = DATA.juice.enemyBarTicks;
    if (this.def.immortal) {
      this.lastHit = { damage: h.damage, poise: h.poiseDamage, staggered: h.staggered, age: this.age };
      this.hp = this.maxHp;
    }
    const st = this.sm.name;
    if (this.def.ai === 'dummy') {
      this.anim.play('hit', { restart: true });
      this.ctx.bus.emit('sfx', { id: 'dummy_hit', x: this.x, y: this.y });
      if (h.staggered && st !== 'critVictim') this.sm.change('stagger', true);
      return;
    }
    if (h.killed) this.sm.change('dead');
    else if (st === 'critVictim') return; // locked in the paired animation
    else if (h.staggered) this.sm.change('stagger', true);
    else {
      this.squash.set(DATA.juice.squash.hit);
      this.aggro();
    }
  }

  onParried() {
    if (!this.dead) this.sm.change('parried', true);
  }

  beginCritVictim(_by: Actor, ticks: number) {
    this.critTicks = ticks;
    this.sm.change('critVictim', true);
  }

  /** Become certain and fight immediately (hit, or alerted by the room). */
  aggro() {
    if (this.def.ai !== 'melee' || this.dead || COMBAT_STATES.has(this.sm.name)) return;
    this.awareness = 1;
    this.noteSighting();
    this.sm.change('approach');
    this.alertRoom();
  }

  /** Everyone in our room learns where the player is, even behind walls. */
  alertRoom() {
    if (this.room === null) return;
    for (const o of this.ctx.enemies()) {
      if (o === this || o.dead || o.room !== this.room || o.def.ai !== 'melee') continue;
      const st = o.sm.name;
      if (st === 'idle' || st === 'suspicious' || st === 'return') {
        o.awareness = 1;
        o.noteSighting();
        o.sm.change('notice');
      }
    }
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

  turnTo(angle: number, degPerTick = this.def.turnDegPerTick) {
    this.facing = turnToward(this.facing, angle, degPerTick * DEG);
  }

  /** Accelerate toward a velocity and move. */
  steer(tvx: number, tvy: number) {
    this.accelerate(tvx, tvy, Math.max(1, this.def.speed), this.def.accelTicks);
    this.integrate();
  }

  private path: { x: number; y: number }[] = [];
  private pathGoal = { x: NaN, y: NaN };
  private repathIn = 0;

  /**
   * Walk toward a point: straight when the way is clear, otherwise along an A* path around walls
   * (re-planned every ~1/3 s or when the goal moves). Returns the heading used (for facing).
   */
  navigateTo(tx: number, ty: number, speed: number): number {
    const hw = this.collider.w / 2 + 1;
    const nav = this.ctx.nav;
    let gx = tx;
    let gy = ty;
    if (!nav.clearLine(this.x, this.y, tx, ty, hw)) {
      const goalMoved = Math.hypot(tx - this.pathGoal.x, ty - this.pathGoal.y) > 16;
      if (--this.repathIn <= 0 || goalMoved || !this.path.length) {
        this.path = nav.find(this.x, this.y, tx, ty, hw) ?? [];
        this.pathGoal = { x: tx, y: ty };
        this.repathIn = 20;
      }
      while (this.path.length > 1 && Math.hypot(this.path[0].x - this.x, this.path[0].y - this.y) < 6) this.path.shift();
      if (this.path.length) [gx, gy] = [this.path[0].x, this.path[0].y];
    } else this.path = [];
    const d = Math.hypot(gx - this.x, gy - this.y);
    const a = Math.atan2(gy - this.y, gx - this.x);
    if (d > 1) this.steer((Math.cos(a) * speed * Math.min(1, d / 6)), (Math.sin(a) * speed * Math.min(1, d / 6)));
    else this.steer(0, 0);
    return a;
  }

  /** Current planned route (debug overlay). */
  get debugPath() {
    return this.path;
  }

  outsideLeash(): boolean {
    return Math.hypot(this.x - this.homeX, this.y - this.homeY) > this.def.leash.distance;
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
    const a = this.angleToPlayer();
    if (Math.abs(Math.atan2(Math.sin(a - this.facing), Math.cos(a - this.facing))) > 70 * DEG) return false;
    const options = this.def.moves.filter(m => d >= m.range[0] && d <= m.range[1] && !(this.cooldowns.get(m.id) ?? 0));
    if (!options.length || !this.ctx.tokens.acquire(this)) return false;
    let roll = this.ctx.rng() * options.reduce((s, m) => s + m.weight, 0);
    this.move = options[options.length - 1];
    for (const m of options)
      if ((roll -= m.weight) <= 0) {
        this.move = m;
        break;
      }
    return true;
  }

  startStrike() {
    const s = this.move!.strikes[this.strikeIndex];
    this.vx = this.vy = 0;
    this.runner = new AttackRunner(this, s, this.facing, this.def.weaponRestDeg * DEG);
    const anim = s.anim && this.anim.has(s.anim) ? s.anim : 'attack';
    this.anim.play(anim, { restart: true, phases: { windup: s.windup, active: s.active, recovery: s.recovery } });
  }

  randRange([a, b]: readonly [number, number]) {
    return Math.round(a + (b - a) * this.ctx.rng());
  }

  kill() {
    if (this.dead || this.def.immortal) return;
    this.hp = 0;
    this.sm.change('dead');
  }
}
