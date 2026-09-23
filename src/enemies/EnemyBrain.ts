// Enemy AI state machines.
// melee: idle -> notice (reaction delay) -> approach <-> strafe -> attack (move = 1..n strikes) -> strafe ...
//        stagger interrupts; leaving the leash (or losing sight) -> return (heal) -> idle.
import { DATA } from '../data/config';
import type { State } from '../actors/StateMachine';
import type { Enemy } from './Enemy';

const idle: State<Enemy> = {
  tick(e) {
    e.steer(0, 0);
    e.turnTo(e.homeFacing);
    if (e.seesPlayer(false)) return 'notice';
  },
};

const notice: State<Enemy> = {
  enter(e) {
    e.reactTicks = e.randRange(e.def.perception.reactionTicks);
    e.lastSeen = e.age;
    e.ctx.bus.emit('notice', { actor: e });
    e.ctx.bus.emit('sfx', { id: 'notice', x: e.x, y: e.y });
  },
  tick(e, t) {
    e.steer(0, 0);
    e.turnTo(e.angleToPlayer());
    if (t >= e.reactTicks) {
      e.alertAllies();
      return 'approach';
    }
  },
};

const approach: State<Enemy> = {
  tick(e) {
    e.seesPlayer(true);
    if (e.shouldLeash()) return 'return';
    const a = e.angleToPlayer();
    e.turnTo(a);
    if (e.tryAttack()) return 'attack';
    const d = e.distToPlayer();
    // Not ready to attack: hold at the preferred spacing and circle. Ready: keep closing until in range.
    if (!e.readyToAttack() && d <= e.def.spacing.preferred) return 'strafe';
    if (d > e.bodyRadius + e.player.bodyRadius + 2) e.steer(Math.cos(a) * e.def.speed, Math.sin(a) * e.def.speed);
    else e.steer(0, 0);
  },
};

const strafe: State<Enemy> = {
  enter(e) {
    e.strafeLeft = e.randRange(e.def.spacing.strafeTicks);
    e.strafeDir = e.ctx.rng() < 0.5 ? -1 : 1;
  },
  tick(e) {
    e.seesPlayer(true);
    if (e.shouldLeash()) return 'return';
    const a = e.angleToPlayer();
    e.turnTo(a);
    if (e.tryAttack()) return 'attack';
    const d = e.distToPlayer();
    const pref = e.def.spacing.preferred;
    if (d > pref + 24 || e.readyToAttack()) return 'approach';
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
    r.tick(e.angleToPlayer());
    e.facing = r.angle;
    if (r.phase !== 'done') return;
    if (++e.strikeIndex < e.move!.strikes.length) {
      e.startStrike();
      return;
    }
    e.cooldowns.set(e.move!.id, e.move!.cooldown);
    e.attackGap = e.randRange(e.def.attackGapTicks);
    return 'strafe';
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
      return 'approach';
    }
  },
};

const ret: State<Enemy> = {
  tick(e) {
    if (!e.player.dead && e.seesPlayer(false) && Math.hypot(e.player.x - e.homeX, e.player.y - e.homeY) < e.def.leash.distance)
      return 'approach';
    const dx = e.homeX - e.x;
    const dy = e.homeY - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
      if (e.def.leash.healOnReturn) e.hp = e.maxHp;
      e.vx = e.vy = 0;
      return 'idle';
    }
    const a = Math.atan2(dy, dx);
    e.turnTo(a);
    e.steer((dx / d) * e.def.speed, (dy / d) * e.def.speed);
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

const dummyStagger: State<Enemy> = {
  enter(e) {
    e.anim.play('hit', { restart: true });
  },
  tick(e, t) {
    if (t >= e.def.staggerTicks) return 'idle';
  },
};

export const BRAINS: Record<'melee' | 'dummy', Record<string, State<Enemy>>> = {
  melee: { idle, notice, approach, strafe, attack, stagger, return: ret, dead },
  dummy: { idle: { tick: () => {} }, stagger: dummyStagger },
};
