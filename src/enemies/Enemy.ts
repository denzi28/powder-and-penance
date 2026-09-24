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
import { TILE } from '../world/TileGrid';
import { BRAINS } from './EnemyBrain';
import type { WorldCtx } from '../core/World';
import type { HitInfo } from '../combat/CombatSystem';
import type { MinibossPlacement, MoveDef } from '../data/schemas';

/** States in which the enemy is actively fighting (knows where you are). */
export const COMBAT_STATES: ReadonlySet<string> = new Set(['approach', 'strafe', 'attack']);
/** States in which it is not expecting you: backstabs allowed from behind. */
const UNAWARE_STATES: ReadonlySet<string> = new Set(['idle', 'suspicious', 'return', 'stagger', 'parried', 'guardBroken']);

/** Ticks of trying to move without getting anywhere before an enemy counts as stuck. */
const STUCK_TICKS = 30;

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
  /** Stable id of the room placement this enemy came from ("<room>#<index>"); null for debug spawns. */
  spawnId: string | null = null;
  /** Stuck detection for navigateTo: where it was, for how long, and the spot it's stepping out to. */
  private stuckX = 0;
  private stuckY = 0;
  private stuckTicks = 0;
  private unstick: { x: number; y: number; t: number } | null = null;
  /** Set when its room placement makes it a miniboss (a name bar, more health, a drop, dead for good). */
  miniboss: MinibossPlacement | null = null;
  /** A miniboss has made its entrance (banner, cry) this life. */
  announced = false;
  /** Called up by a boss: drops no Tallow or loot. */
  summoned = false;
  /** Lost the player in smoke: it walks back without healing (smoke isn't a way to reset a fight). */
  noHealOnReturn = false;
  /** Enemies this one has summoned (strike.summon). */
  summons: Enemy[] = [];
  /** Sitting in a summoning bubble: invulnerable until every summon is dead. */
  bubble = false;
  /** Ticks left half-seen in its own smoke (strike.vanish). */
  veiled = 0;
  /** Boss turning into its next phase (boss.turn): ticks spent performing at the altar (-1 = still walking there). */
  turnT = -1;
  /** The turn is complete: the arena swaps in the next phase. */
  turned = false;

  /** Where a turning boss stands to perform (boss.turn.altar, in its room). */
  altarSpot(): { x: number; y: number } {
    const t = this.def.boss?.turn;
    const r = this.room ? DATA.rooms[this.room] : null;
    if (!t || !r) return { x: this.x, y: this.y };
    return { x: (r.origin[0] + t.altar[0]) * TILE + TILE / 2, y: (r.origin[1] + t.altar[1]) * TILE + TILE - 2 };
  }
  get ignoresTerrain() {
    return this.def.wader;
  }

  /** Where it waits out its bubble (the "channel" state). */
  channelSpot: { x: number; y: number } | null = null;

  /** An open spot on the side of its room away from the player, level with the room's middle. */
  sideSpot(): { x: number; y: number } {
    const r = this.room ? DATA.rooms[this.room] : null;
    if (!r) return { x: this.x, y: this.y };
    const w = r.tiles[0].length;
    const h = r.tiles.length;
    const midX = (r.origin[0] + w / 2) * TILE;
    const tx = this.player.x < midX ? r.origin[0] + w - 4 : r.origin[0] + 3;
    const ty = r.origin[1] + Math.floor(h / 2);
    const grid = this.ctx.grid();
    for (let d = 0; d < 6; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++)
          if (!grid.isSolid(tx + dx, ty + dy)) return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE - 2 };
    return { x: this.x, y: this.y };
  }
  alpha = 1;

  constructor(ctx: WorldCtx, readonly kind: string, x: number, y: number, facing: number) {
    super(ctx, x, y);
    this.homeX = x;
    this.homeY = y;
    this.facing = this.homeFacing = facing;
    this.room = ctx.roomAt(x, y);
    this.poise = new Poise(() => this.def.poise);
    this.hp = this.def.hp;
    this.guardPoints = this.def.guard?.max ?? 0;
    this.anim = new AnimPlayer(SPRITES[this.def.sprite].animations);
    this.anim.play('idle');
    this.dir = dir8FromAngle(facing);
    this.sm = new StateMachine<Enemy>(this, BRAINS[this.def.ai], this.def.ambush ? 'submerged' : 'idle');
    this.sm.start();
  }

  get def() {
    return DATA.enemies[this.kind];
  }
  get maxHp() {
    return Math.round(this.def.hp * (this.miniboss?.hpMult ?? 1));
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
  /** Can be riposted right now (parried, or reeling from a broken guard). */
  get critOpen() {
    return this.sm.name === 'parried' || this.sm.name === 'guardBroken';
  }
  /** Has the full combat AI (perception, room alerts, health bar). */
  get isFighter() {
    return this.def.ai === 'melee' || this.def.ai === 'ranged' || this.def.ai === 'boss';
  }
  /** A boss that hasn't begun its fight yet (dormant or performing its entrance). */
  get bossWaiting() {
    return !!this.def.boss && (this.sm.name === 'idle' || this.sm.name === 'intro');
  }
  /** Begin the entrance (the arena calls this when the player walks in). */
  startIntro() {
    if (!this.dead && this.sm.name === 'idle') this.sm.change('intro');
  }

  // Shield guard
  guardPoints = 0;
  private guardDelay = 0;
  private static readonly GUARD_STATES: ReadonlySet<string> = new Set(['idle', 'suspicious', 'notice', 'approach', 'strafe', 'return']);

  guard() {
    const g = this.def.guard;
    if (!g || this.dead || !Enemy.GUARD_STATES.has(this.sm.name)) return null;
    return { facing: this.facing, arcDeg: g.arcDeg, parry: false, stability: g.stability, absorption: g.absorption };
  }

  spendGuardStamina(cost: number): boolean {
    const g = this.def.guard;
    if (!g) return false;
    this.guardPoints = Math.max(0, this.guardPoints - cost);
    this.guardDelay = g.regenDelayTicks;
    return this.guardPoints <= 0;
  }
  get backstabbable() {
    return !this.dead && !this.def.boss && UNAWARE_STATES.has(this.sm.name);
  }
  /** State to fall back to after a stagger/parry/critical. */
  get recoverState() {
    return this.isFighter ? 'approach' : 'idle';
  }

  tick() {
    this.beginTick();
    this.age++;
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - 1);
    if (this.attackGap > 0) this.attackGap--;
    if (this.barTicks > 0) this.barTicks--;
    const g = this.def.guard;
    if (g) {
      if (this.guardDelay > 0) this.guardDelay--;
      else this.guardPoints = Math.min(g.max, this.guardPoints + g.regenPerSec / DATA.game.tickRate);
    }

    if (this.isFighter && !this.dead && this.sm.name !== 'critVictim') this.perceive();
    if (this.bubble && !this.summons.some(s => !s.dead)) {
      this.bubble = false; // the last summon fell: the bubble bursts
      this.ctx.bus.emit('sfx', { id: 'break_pot', x: this.x, y: this.y });
      this.ctx.bus.emit('shake', { trauma: 0.25 });
    }
    if (this.veiled > 0 && --this.veiled === 0 && !this.dead) {
      this.alpha = 1; // steps out of the smoke
      this.ctx.bus.emit('dust', { x: this.x, y: this.y, kind: 'roll' });
    }
    this.invulnerable = (this.bubble || this.sm.name === 'submerged' || this.sm.name === 'turn') && !this.dead;
    this.sm.tick();
    this.applyKnockback();
    this.hyperArmor = this.runner?.hyperArmor ?? 0;
    if (this.runner) {
      const pose = this.runner.pose();
      this.weaponAngle = pose.angle;
      this.weaponReach = pose.reach;
    } else if (this.sm.name === 'intro') {
      this.weaponAngle = this.introWeaponAngle();
      this.weaponReach = 0;
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
    } else if (
      st === 'attack' || st === 'stagger' || st === 'dead' || st === 'parried' || st === 'critVictim' || st === 'guardBroken' || st === 'intro' || st === 'rise' ||
      (st === 'turn' && (this.turnT >= 0 || this.sm.t < 30))
    ) {
      this.anim.tick();
    } else if (st === 'channel' && speed <= 4 && this.anim.has('channel')) {
      this.anim.play('channel'); // holding the summoning pose
      this.anim.tick();
    } else if (speed > 4) {
      this.anim.play('walk');
      const was = this.anim.index;
      this.anim.tick(speed / Math.max(1, this.def.speed));
      // footfalls: on the walk cycle's contact frames (every other frame)
      const steps = this.def.steps;
      if (steps && this.anim.index !== was && this.anim.index % 2 === 0)
        this.ctx.bus.emit('sfx', { id: steps.sfx, x: this.x, y: this.y, volume: steps.volume });
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
        this.awareness = Math.min(1, this.awareness + (p.mods?.notice ?? 1) / (per.detectTicksNear + (per.detectTicksFar - per.detectTicksNear) * k));
      }
    } else if (!inCombat) {
      this.awareness = Math.max(0, this.awareness - per.forgetPerTick);
    }
  }

  /** A boss fighting you always knows where you are: its arena is sealed, there's nowhere to hide. */
  hunt() {
    if (!this.player.dead) this.noteSighting();
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
    if (h.killed && this.def.boss?.turn) {
      // Not a death: this phase is spent, and the boss goes to make its turn.
      this.hp = 1;
      this.sm.change('turn', true);
    } else if (h.killed) this.sm.change('dead');
    else if (st === 'critVictim') return; // locked in the paired animation
    else if (h.guardBroken) this.sm.change('guardBroken', true);
    else if (h.blocked) {
      this.squash.set(DATA.juice.squash.hit);
      this.aggro();
    } else if (h.staggered) this.sm.change('stagger', true);
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

  /**
   * During a boss entrance the weapon is raised over 20 ticks before each slam, driven into the ground on
   * the slam, held there briefly, then returned to rest.
   */
  private introWeaponAngle() {
    const t = this.sm.t;
    const rest = this.facing + this.def.weaponRestDeg * DEG * (Math.cos(this.facing) < 0 ? -1 : 1);
    const up = -Math.PI / 2;
    const down = this.facing + 0.35 * (Math.cos(this.facing) < 0 ? -1 : 1);
    for (const s of this.def.boss?.slams ?? []) {
      if (t >= s - 20 && t < s) return rest + (up - rest) * ((t - (s - 20)) / 20);
      if (t >= s && t < s + 14) return down;
    }
    return rest;
  }

  /** Become certain and fight immediately (hit, or alerted by the room). */
  aggro() {
    if (!this.isFighter || this.dead || COMBAT_STATES.has(this.sm.name) || this.bossWaiting) return;
    if (this.sm.name === 'submerged' || this.sm.name === 'rise') return; // it comes up in its own time
    this.awareness = 1;
    this.noteSighting();
    this.sm.change('approach');
    this.alertRoom();
  }

  /** Lose the player (smoke): stop hunting and go back to the post. Bosses and minibosses aren't fooled. */
  loseTrack() {
    if (this.dead || !this.isFighter || this.def.boss || this.miniboss) return;
    const st = this.sm.name;
    if (!COMBAT_STATES.has(st) && st !== 'notice' && st !== 'suspicious') return;
    this.awareness = 0;
    this.noHealOnReturn = true;
    this.sm.change('return');
  }

  /** Everyone in our room learns where the player is, even behind walls. */
  alertRoom() {
    if (this.room === null) return;
    for (const o of this.ctx.enemies()) {
      if (o === this || o.dead || o.room !== this.room || !o.isFighter || o.def.boss) continue;
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
    // Stuck: trying to move, but it has hardly budged for a while (wedged on a corner, in a gap too narrow for
    // it). Step out to the nearest open spot it fits, then plan afresh.
    const moved = Math.hypot(this.x - this.stuckX, this.y - this.stuckY);
    if (moved > 6 || speed <= 0 || Math.hypot(tx - this.x, ty - this.y) < 12) {
      this.stuckX = this.x;
      this.stuckY = this.y;
      this.stuckTicks = 0;
    } else if (++this.stuckTicks > STUCK_TICKS && !this.unstick) {
      const spot = nav.nearestFit(this.x, this.y, hw, 3);
      if (spot) this.unstick = { x: spot.x, y: spot.y, t: 30 };
      this.stuckTicks = 0;
      this.path = [];
      this.repathIn = 0;
    }
    if (this.unstick) {
      const u = this.unstick;
      if (--u.t <= 0 || Math.hypot(u.x - this.x, u.y - this.y) < 2) this.unstick = null;
      const a = Math.atan2(u.y - this.y, u.x - this.x);
      this.steer(Math.cos(a) * speed, Math.sin(a) * speed);
      return a;
    }
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
    const facing = Math.abs(Math.atan2(Math.sin(a - this.facing), Math.cos(a - this.facing))) <= 70 * DEG;
    // A boss can lob over what's in the way, turning as it throws: a nook it can't reach or see into is no
    // hiding place from an arcing pot.
    const lobs = (m: MoveDef) => !!this.def.boss && !!m.strikes[0].projectile?.lob;
    const options = this.def.moves.filter(
      m =>
        (facing || lobs(m)) &&
        d >= m.range[0] &&
        d <= m.range[1] &&
        !(this.cooldowns.get(m.id) ?? 0) &&
        (!m.strikes[0].projectile || this.visible || lobs(m)) && // throwing straight needs a clear view
        (!m.strikes.some(s => s.summon) || !this.summons.some(s => !s.dead)), // one brood at a time
    );
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
    if (this.def.boss?.turn) {
      if (this.sm.name !== 'turn') {
        this.hp = 1;
        this.sm.change('turn');
      }
      return;
    }
    this.hp = 0;
    this.sm.change('dead');
  }
}
