// Enemy AI state machines.
// melee:  idle --(awareness >= suspicionAt)--> suspicious ("?": stares, then searches the last seen spot)
//              --(awareness 1)--> notice ("!", reaction delay, alerts the room) -> approach <-> strafe -> attack
//         Combat ends when the player is lost for loseTicks (-> suspicious) or leaves the leash (-> return).
//         stagger / parried / critVictim interrupt anything.
// rhythm: stands, faces the player and repeats its first move every rhythmIntervalTicks (parry practice).
// dummy:  does nothing; can be staggered and backstabbed.
// boss:   dormant until its arena wakes it -> intro (entrance, player keeps control) -> the fighter's combat
//         states, without searching, leashing or giving up.
import { DATA } from '../data/config';
import { DEG } from '../core/math';
import type { State } from '../actors/StateMachine';
import type { Enemy } from './Enemy';

const idle: State<Enemy> = {
  tick(e) {
    e.steer(0, 0);
    e.turnTo(e.homeFacing);
    if (e.awareness >= 1) return 'notice';
    if (e.awareness >= e.def.perception.suspicionAt) return 'suspicious';
  },
};

const suspicious: State<Enemy> = {
  enter(e) {
    e.searchLeft = e.def.perception.investigateTicks;
    e.strafeDir = e.ctx.rng() < 0.5 ? -1 : 1;
    e.ctx.bus.emit('suspicious', { actor: e });
    e.ctx.bus.emit('sfx', { id: 'suspicious', x: e.x, y: e.y });
  },
  tick(e) {
    const per = e.def.perception;
    if (e.awareness >= 1) return 'notice';
    if (e.visible) {
      // "Was that something?" — freeze and stare while awareness builds.
      e.steer(0, 0);
      e.turnTo(e.angleToPlayer());
      e.searchLeft = per.investigateTicks;
      return;
    }
    const d = Math.hypot(e.lastSeenX - e.x, e.lastSeenY - e.y);
    if (d > 8) {
      e.turnTo(e.navigateTo(e.lastSeenX, e.lastSeenY, e.def.speed * 0.5));
    } else {
      e.steer(0, 0);
      e.facing += 1.5 * DEG * e.strafeDir; // look around
    }
    if (--e.searchLeft <= 0) {
      e.awareness = Math.min(e.awareness, per.suspicionAt * 0.5);
      return 'return';
    }
  },
};

const notice: State<Enemy> = {
  enter(e) {
    e.awareness = 1;
    e.reactTicks = e.randRange(e.def.perception.reactionTicks);
    e.ctx.bus.emit('notice', { actor: e });
    e.ctx.bus.emit('sfx', { id: 'notice', x: e.x, y: e.y });
    e.alertRoom();
  },
  tick(e, t) {
    e.steer(0, 0);
    e.turnTo(e.angleToPlayer());
    if (t >= e.reactTicks) return 'approach';
  },
};

/** Shared combat checks: lost the player, or dragged too far from home. */
function combatExit(e: Enemy): string | undefined {
  // A boss never gives up or wanders home: its arena is sealed until one of you falls.
  if (e.def.boss) return e.player.dead ? 'idle' : undefined;
  if (e.player.dead || e.outsideLeash()) {
    e.awareness = 0;
    return 'return';
  }
  if (!e.trackPlayer() && e.age - e.lastSeen > e.def.perception.loseTicks) {
    e.awareness = e.def.perception.suspicionAt + 0.2;
    return 'suspicious';
  }
}

/** Ranged enemies back away (while facing you) when you get closer than spacing.retreatBelow. */
function retreat(e: Enemy, d: number): boolean {
  const r = e.def.spacing.retreatBelow;
  if (!r || d >= r) return false;
  const away = Math.atan2(e.y - e.player.y, e.x - e.player.x);
  e.navigateTo(e.x + Math.cos(away) * 48, e.y + Math.sin(away) * 48, e.def.speed);
  e.turnTo(e.angleToPlayer());
  return true;
}

const approach: State<Enemy> = {
  tick(e) {
    const exit = combatExit(e);
    if (exit) return exit;
    // Face the player when they're in sight; otherwise face where we're walking.
    if (e.visible) e.turnTo(e.angleToPlayer());
    if (e.tryAttack()) return 'attack';
    const d = e.distToPlayer();
    if (retreat(e, d)) return;
    // Not ready to attack: hold at the preferred spacing and circle. Ready: keep closing until in range.
    if (!e.readyToAttack() && d <= e.def.spacing.preferred && e.visible) return 'strafe';
    if (d > e.bodyRadius + e.player.bodyRadius + 2) {
      const heading = e.navigateTo(e.lastSeenX, e.lastSeenY, e.def.speed);
      if (!e.visible) e.turnTo(heading);
    } else e.steer(0, 0);
  },
};

const strafe: State<Enemy> = {
  enter(e) {
    e.strafeLeft = e.randRange(e.def.spacing.strafeTicks);
    e.strafeDir = e.ctx.rng() < 0.5 ? -1 : 1;
  },
  tick(e) {
    const exit = combatExit(e);
    if (exit) return exit;
    const a = e.angleToPlayer();
    e.turnTo(a);
    if (e.tryAttack()) return 'attack';
    const d = e.distToPlayer();
    if (retreat(e, d)) return;
    const pref = e.def.spacing.preferred;
    if (d > pref + 24 || !e.visible || e.readyToAttack()) return 'approach';
    if (--e.strafeLeft <= 0) {
      e.strafeLeft = e.randRange(e.def.spacing.strafeTicks);
      e.strafeDir = -e.strafeDir;
    }
    // Circle the player while holding the preferred distance.
    const tangent = a + (e.strafeDir * Math.PI) / 2;
    const radial = Math.max(-1, Math.min(1, (d - pref) / 12));
    const vx = Math.cos(tangent) * e.def.strafeSpeed + Math.cos(a) * radial * e.def.speed;
    const vy = Math.sin(tangent) * e.def.strafeSpeed + Math.sin(a) * radial * e.def.speed;
    e.steer(vx, vy);
  },
};

const attack: State<Enemy> = {
  enter(e) {
    e.strikeIndex = 0;
    e.startStrike();
  },
  tick(e) {
    const r = e.runner!;
    r.target = { x: e.player.x, y: e.player.y }; // thrown strikes land where you stand at release
    r.tick(e.angleToPlayer());
    e.facing = r.angle;
    if (r.phase !== 'done') return;
    if (++e.strikeIndex < e.move!.strikes.length) {
      e.startStrike();
      return;
    }
    e.cooldowns.set(e.move!.id, e.move!.cooldown);
    e.attackGap = e.randRange(e.def.attackGapTicks);
    return e.isFighter ? 'strafe' : 'idle';
  },
  exit(e) {
    e.runner = null;
    e.ctx.tokens.release(e);
  },
};

const stagger: State<Enemy> = {
  enter(e) {
    e.vx = e.vy = 0;
    e.anim.play('stagger', { restart: true });
    e.squash.set(DATA.juice.squash.hit);
    e.ctx.bus.emit('sfx', { id: 'stagger', x: e.x, y: e.y });
  },
  tick(e, t) {
    if (t >= e.def.staggerTicks) {
      e.attackGap = Math.max(e.attackGap, 10);
      if (e.isFighter) e.aggro();
      return e.recoverState;
    }
  },
};

/** Parried: long stagger, open to a riposte. */
const parried: State<Enemy> = {
  enter(e) {
    e.vx = e.vy = 0;
    e.anim.play('stagger', { restart: true });
    e.squash.set(DATA.juice.squash.hit);
  },
  tick(e, t) {
    if (t >= e.def.parriedTicks) {
      if (e.isFighter) e.aggro();
      return e.recoverState;
    }
  },
};

/** Shield guard broken: reels for guard.breakTicks, open to a riposte; the guard comes back full. */
const guardBroken: State<Enemy> = {
  enter(e) {
    e.vx = e.vy = 0;
    e.anim.play('stagger', { restart: true });
    e.squash.set(DATA.juice.squash.hit);
    e.ctx.bus.emit('sfx', { id: 'guard_break', x: e.x, y: e.y });
  },
  tick(e, t) {
    if (t >= (e.def.guard?.breakTicks ?? 60)) {
      e.guardPoints = e.def.guard?.max ?? 0;
      e.aggro();
      return e.recoverState;
    }
  },
};

/** Locked in a riposte/backstab animation driven by the attacker. */
const critVictim: State<Enemy> = {
  enter(e) {
    e.vx = e.vy = 0;
    e.anim.play(e.def.ai === 'dummy' ? 'hit' : 'stagger', { restart: true });
  },
  tick(e, t) {
    if (t >= e.critTicks) {
      if (e.isFighter) e.aggro();
      return e.recoverState;
    }
  },
};

const ret: State<Enemy> = {
  tick(e) {
    if (e.awareness >= 1) return 'notice';
    if (e.awareness >= e.def.perception.suspicionAt) return 'suspicious';
    if (Math.hypot(e.homeX - e.x, e.homeY - e.y) < 3) {
      if (e.def.leash.healOnReturn) e.hp = e.maxHp;
      e.vx = e.vy = 0;
      return 'idle';
    }
    e.turnTo(e.navigateTo(e.homeX, e.homeY, e.def.speed));
  },
};

const dead: State<Enemy> = {
  enter(e) {
    e.dead = true;
    e.runner = null;
    e.vx = e.vy = 0;
    e.ctx.tokens.release(e);
    e.anim.play('death', { restart: true });
    e.ctx.bus.emit('sfx', { id: 'enemy_die', x: e.x, y: e.y });
    e.ctx.bus.emit('died', { actor: e });
  },
  tick(e, t) {
    const fadeStart = e.def.deathTicks + e.def.corpseTicks;
    if (t >= fadeStart) e.alpha = Math.max(0, 1 - (t - fadeStart) / 30);
    if (t >= fadeStart + 30) e.remove = true;
  },
};

const rhythmIdle: State<Enemy> = {
  tick(e, t) {
    e.steer(0, 0);
    const d = e.distToPlayer();
    const move = e.def.moves[0];
    if (!move || e.player.dead) return;
    if (d <= move.range[1] * 2.5) e.turnTo(e.angleToPlayer());
    if (t >= e.def.rhythmIntervalTicks && d <= move.range[1]) {
      e.move = move;
      return 'attack';
    }
  },
};

const dummyStagger: State<Enemy> = {
  enter(e) {
    e.anim.play('hit', { restart: true });
  },
  tick(e, t) {
    if (t >= e.def.staggerTicks) return 'idle';
  },
};

/** Boss, before its fight: stands at its post and ignores everything until the arena wakes it. */
const dormant: State<Enemy> = {
  tick(e) {
    e.steer(0, 0);
    e.turnTo(e.homeFacing);
  },
};

/**
 * Boss entrance: it turns to the player and performs (introAnim, weapon raised and slammed down on each
 * slam tick, the screen shaking), then the fight starts. The player can act the whole time.
 */
const intro: State<Enemy> = {
  enter(e) {
    const b = e.def.boss!;
    e.vx = e.vy = 0;
    e.anim.play(b.introAnim, { restart: true });
    if (b.roarSfx) e.ctx.bus.emit('sfx', { id: b.roarSfx, x: e.x, y: e.y });
  },
  tick(e, t) {
    const b = e.def.boss!;
    e.steer(0, 0);
    e.turnTo(e.angleToPlayer());
    if (b.slams.includes(t)) {
      e.ctx.bus.emit('shake', { trauma: b.slamShake });
      e.ctx.bus.emit('sfx', { id: b.slamSfx, x: e.x, y: e.y });
      e.ctx.bus.emit('dust', { x: e.x + Math.cos(e.facing) * 14, y: e.y + Math.sin(e.facing) * 8, kind: 'roll' });
    }
    if (t >= b.introTicks) {
      e.awareness = 1;
      e.trackPlayer(); // it knows exactly where you are: you're in its sealed arena
      e.attackGap = 20;
      return 'approach';
    }
  },
};

const FIGHTER = { idle, suspicious, notice, approach, strafe, attack, stagger, parried, guardBroken, critVictim, return: ret, dead };
const BOSS = { idle: dormant, intro, approach, strafe, attack, stagger, parried, guardBroken, critVictim, dead };

export const BRAINS: Record<'melee' | 'ranged' | 'dummy' | 'rhythm' | 'boss', Record<string, State<Enemy>>> = {
  // Ranged differs only through data: spacing.retreatBelow and moves whose strikes throw projectiles.
  melee: FIGHTER,
  ranged: FIGHTER,
  boss: BOSS,
  rhythm: { idle: rhythmIdle, attack, stagger, parried, critVictim },
  dummy: { idle: { tick: () => {} }, stagger: dummyStagger, critVictim },
};
