// Enemy AI state machines.
// melee:  idle --(awareness >= suspicionAt)--> suspicious ("?": stares, then searches the last seen spot)
//              --(awareness 1)--> notice ("!", reaction delay, alerts the room) -> approach <-> strafe -> attack
//         Combat ends when the player is lost for loseTicks (-> suspicious) or leaves the leash (-> return).
//         stagger / parried / critVictim interrupt anything.
// rhythm: stands, faces the player and repeats its first move every rhythmIntervalTicks (parry practice).
// dummy:  does nothing; can be staggered and backstabbed.
// boss:   dormant until its arena wakes it -> intro (entrance, player keeps control) -> the fighter's combat
//         states, without searching, leashing or giving up. A boss with a `turn` goes to `turn` instead of
//         dying: it walks to its altar and performs until its arena swaps in the next phase.
import { DATA } from '../data/config';
import { DEG } from '../core/math';
import type { State } from '../actors/StateMachine';
import type { Enemy } from './Enemy';

const idle: State<Enemy> = {
  tick(e) {
    e.steer(0, 0);
    const scan = e.def.scan;
    // A lantern sweeps its gaze to and fro across its post; everyone else just faces their post.
    if (scan) e.turnTo(e.homeFacing + Math.sin((e.age * scan.degPerTick) / scan.arcDeg) * scan.arcDeg * DEG);
    else e.turnTo(e.homeFacing);
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
    if (e.def.voice?.alert) e.ctx.bus.emit('sfx', { id: e.def.voice.alert, x: e.x, y: e.y });
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
  if (e.def.boss) {
    if (e.player.dead) return 'idle';
    e.hunt(); // it always knows where you are
    return undefined;
  }
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
    if (e.blind > 0) return 'blinded';
    const exit = combatExit(e);
    if (exit) return exit;
    if (e.bubble) return 'channel';
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
    if (e.blind > 0) return 'blinded';
    const exit = combatExit(e);
    if (exit) return exit;
    if (e.bubble) return 'channel';
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
    if (e.bubble) return 'channel'; // just summoned: step back and let the brood fight
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
      if (e.def.leash.healOnReturn && !e.noHealOnReturn) e.hp = e.maxHp;
      e.noHealOnReturn = false;
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
    e.ctx.bus.emit('sfx', { id: 'enemy_die', x: e.x, y: e.y, volume: e.def.voice?.die ? 0.5 : 1 });
    if (e.def.voice?.die) e.ctx.bus.emit('sfx', { id: e.def.voice.die, x: e.x, y: e.y });
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

/**
 * Ambusher, waiting under the surface: unseen and untouchable, ignoring everything but distance. Now and
 * then a bubble breaks the wax above it (the only tell). It rises when the player comes within `radius`.
 */
const submerged: State<Enemy> = {
  enter(e) {
    const hidden = e.def.ambush?.hidden !== false;
    e.alpha = hidden ? 0 : 1;
    if (!hidden) e.anim.play(e.anim.has('dormant') ? 'dormant' : 'idle', { restart: true }); // stock still, like scenery
  },
  tick(e, t) {
    e.steer(0, 0);
    if (e.def.ambush?.hidden === false) e.turnTo(e.homeFacing);
    else if (t % 110 === 55) e.ctx.bus.emit('dust', { x: e.x, y: e.y, kind: 'step' });
    if (!e.player.dead && e.distToPlayer() <= e.def.ambush!.radius) return 'rise';
  },
};

const rise: State<Enemy> = {
  enter(e) {
    e.alpha = 1;
    e.vx = e.vy = 0;
    e.turnTo(e.angleToPlayer());
    e.anim.play(e.anim.has('rise') ? 'rise' : 'idle', { restart: true });
    e.ctx.bus.emit('sfx', { id: e.def.voice?.rise ?? 'break_pot', x: e.x, y: e.y });
    e.ctx.bus.emit('dust', { x: e.x, y: e.y, kind: 'roll' });
  },
  tick(e, t) {
    e.steer(0, 0);
    e.turnTo(e.angleToPlayer());
    if (t >= e.def.ambush!.riseTicks) {
      e.awareness = 1;
      e.trackPlayer();
      e.alertRoom();
      return 'approach';
    }
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

/**
 * Sheltering in a summoning bubble: no attacks. It walks to the side of its room away from the player,
 * then holds its channelling pose (anim "channel") facing them, until the last summon dies.
 */
const channel: State<Enemy> = {
  enter(e) {
    e.channelSpot = e.sideSpot();
    e.ctx.tokens.release(e);
  },
  tick(e) {
    if (!e.bubble || e.player.dead) {
      e.attackGap = Math.max(e.attackGap, 20);
      return e.player.dead ? 'idle' : 'approach';
    }
    const s = e.channelSpot!;
    if (Math.hypot(s.x - e.x, s.y - e.y) > 6) e.turnTo(e.navigateTo(s.x, s.y, e.def.speed));
    else {
      e.steer(0, 0);
      e.turnTo(e.angleToPlayer());
    }
  },
};

/**
 * A boss whose health ran out, making its turn (boss.turn): untouchable, it walks to its altar, faces it and
 * performs (turn.anim) for turn.ticks. Then `turned` is set and its arena swaps in the next phase.
 */
const turn: State<Enemy> = {
  enter(e) {
    e.vx = e.vy = 0;
    e.runner = null;
    e.bubble = false;
    e.veiled = 0;
    e.alpha = 1;
    e.turnT = -1;
    e.ctx.tokens.release(e);
    e.anim.play('stagger', { restart: true });
  },
  tick(e, t) {
    const tr = e.def.boss!.turn!;
    if (e.turnT < 0) {
      if (t < 30) return e.steer(0, 0); // reels from the last blow first
      const spot = e.altarSpot();
      // Strides there with purpose; if something keeps it from arriving, it performs where it stands.
      if (Math.hypot(spot.x - e.x, spot.y - e.y) > 4 && t < 600) {
        e.turnTo(e.navigateTo(spot.x, spot.y, Math.max(e.def.speed * 1.6, 40)));
        return;
      }
      e.steer(0, 0);
      e.turnT = 0;
      e.anim.play(e.anim.has(tr.anim) ? tr.anim : 'idle', { restart: true });
    }
    e.steer(0, 0);
    e.turnTo(-Math.PI / 2, 12); // to the altar
    if (++e.turnT >= tr.ticks) e.turned = true;
  },
};

/**
 * Smoke in its eyes (Enemy.setBlind): it can't fight. It reels, coughs and paws at its face, stumbling in small
 * aimless loops, until it can see again; then it comes for where it last saw you.
 */
const blinded: State<Enemy> = {
  enter(e) {
    e.runner = null;
    e.ctx.tokens.release(e);
    e.strafeDir = e.ctx.rng() < 0.5 ? -1 : 1;
    e.anim.play('stagger', { restart: true });
    e.ctx.bus.emit('sfx', { id: e.def.voice?.hurt ?? 'stagger', x: e.x, y: e.y, volume: 0.6 });
  },
  tick(e, t) {
    if (e.blind <= 0) {
      e.attackGap = Math.max(e.attackGap, 20);
      if (e.isFighter) {
        e.awareness = 1;
        return 'approach';
      }
      return 'idle';
    }
    // a slow stagger in circles, turning this way and that
    if (t % 40 === 0) e.strafeDir = e.ctx.rng() < 0.5 ? -1 : 1;
    e.facing += 2.2 * DEG * e.strafeDir;
    const sp = e.def.speed * 0.25;
    e.steer(Math.cos(e.facing) * sp, Math.sin(e.facing) * sp);
    if (t % 50 === 25) e.ctx.bus.emit('dust', { x: e.x, y: e.y, kind: 'step' });
  },
};

const FIGHTER = { idle, suspicious, notice, approach, strafe, attack, stagger, parried, guardBroken, critVictim, return: ret, dead, channel, submerged, rise, blinded };
const BOSS = { idle: dormant, intro, approach, strafe, attack, stagger, parried, guardBroken, critVictim, dead, channel, turn, blinded };

export const BRAINS: Record<'melee' | 'ranged' | 'dummy' | 'rhythm' | 'boss', Record<string, State<Enemy>>> = {
  // Ranged differs only through data: spacing.retreatBelow and moves whose strikes throw projectiles.
  melee: FIGHTER,
  ranged: FIGHTER,
  boss: BOSS,
  rhythm: { idle: rhythmIdle, attack, stagger, parried, critVictim, blinded },
  dummy: { idle: { tick: () => {} }, stagger: dummyStagger, critVictim, blinded: { tick: e => (e.blind > 0 ? undefined : 'idle') } },
};
