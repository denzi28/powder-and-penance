// Player state machine. Every action is a committed state; cancels happen only at data-defined ticks.
import { DATA } from '../data/config';
import { DEG, dir8FromAngle } from '../core/math';
import { AttackRunner } from '../combat/AttackRunner';
import type { State } from '../actors/StateMachine';
import type { StrikeDef } from '../data/schemas';
import type { Player } from './Player';

/** Actions available from free movement. Returns the state to enter, if any. */
function tryStartAction(p: Player): string | undefined {
  const inp = p.input;
  if (!p.stamina.canAct()) return;
  if (inp.consume('roll')) return 'roll';
  const w = p.weapon;
  if (w.kind !== 'melee') return; // ranged weapons arrive in M3
  if (w.light.length && inp.consume('light')) {
    p.comboIndex = 0;
    return 'attack';
  }
  if (w.heavy && inp.consume('heavy')) return 'heavy';
}

/** Shared by idle / move / sprint. */
function locomotion(p: Player): string {
  const action = tryStartAction(p);
  if (action) return action;
  const inp = p.input;
  if (inp.consume('swap')) p.swapWeapon();

  const cfg = DATA.player;
  const moving = p.moveMag > 0.1;
  if (!inp.held('sprint')) p.sprintNeedsRepress = false;
  const wasSprinting = p.sm.name === 'sprint';
  const sprint =
    moving && inp.held('sprint') && !p.sprintNeedsRepress && (wasSprinting ? p.stamina.value > 0 : p.stamina.canAct());
  if (wasSprinting && !sprint && p.stamina.value <= 0) p.sprintNeedsRepress = true;

  const speed = cfg.walkSpeed * (sprint ? cfg.sprintMult : 1);
  p.accelerate(p.moveX * speed, p.moveY * speed, cfg.walkSpeed, cfg.accelTicks, cfg.decelTicks);
  if (sprint) p.stamina.spend(DATA.stamina.sprintPerSec / DATA.game.tickRate);
  p.integrate();

  return sprint ? 'sprint' : moving ? 'move' : 'idle';
}

function startStrike(p: Player, s: StrikeDef) {
  p.stamina.spend(s.stamina);
  p.vx = p.vy = 0;
  p.runner = new AttackRunner(p, s, p.aimAngle, p.weapon.view.restAngleOffsetDeg * DEG);
  p.body.play('attack', { restart: true, phases: { windup: s.windup, active: s.active, recovery: s.recovery } });
  p.squash.set(DATA.juice.squash.attack);
}

function endStrike(p: Player) {
  p.runner = null;
  p.hyperArmor = 0;
  p.animHold = false;
  p.body.play('idle');
}

/** Roll-cancel check shared by attack states. */
function rollCancel(p: Player, s: StrikeDef, t: number) {
  return s.rollCancelFrom !== undefined && t >= s.rollCancelFrom && p.stamina.canAct() && p.input.consume('roll');
}

const attack: State<Player> = {
  enter(p) {
    startStrike(p, p.weapon.light[p.comboIndex % p.weapon.light.length]);
  },
  tick(p) {
    const r = p.runner!;
    const s = r.strike;
    r.tick(p.aimAngle);
    if (s.comboFrom !== undefined && r.t >= s.comboFrom && p.stamina.canAct()) {
      if (p.input.consume('light')) {
        p.comboIndex = (p.comboIndex + 1) % p.weapon.light.length;
        p.sm.change('attack', true);
        return;
      }
      if (p.weapon.heavy && p.input.consume('heavy')) return 'heavy';
    }
    if (rollCancel(p, s, r.t)) return 'roll';
    if (r.phase === 'done') return 'idle';
  },
  exit: endStrike,
};

// Heavy: the windup's last tick is held while the button is held, up to chargeTicks. Release (or full
// charge) continues into the active frames with damage/poise scaled by the charge fraction.
const heavy: State<Player> = {
  enter(p) {
    p.charge = 0;
    startStrike(p, p.weapon.heavy!.strike);
  },
  tick(p) {
    const h = p.weapon.heavy!;
    const r = p.runner!;
    const atHoldPoint = r.t === r.strike.windup - 1;
    if (atHoldPoint && p.input.held('heavy') && p.charge < h.chargeTicks) {
      r.track(p.aimAngle);
      p.charge++;
      p.animHold = true;
      if (p.charge === h.chargeTicks) p.ctx.bus.emit('chargeFull', { actor: p });
      return;
    }
    if (p.animHold) {
      p.animHold = false;
      const k = h.chargeTicks ? p.charge / h.chargeTicks : 0;
      r.damageMult = 1 + (h.chargeDamageMult - 1) * k;
      r.poiseMult = 1 + (h.chargePoiseMult - 1) * k;
    }
    r.tick(p.aimAngle);
    if (rollCancel(p, r.strike, r.t)) return 'roll';
    if (r.phase === 'done') return 'idle';
  },
  exit: endStrike,
};

const easeOut = (t: number, power: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** power;

const roll: State<Player> = {
  enter(p) {
    const c = DATA.roll;
    p.stamina.spend(c.stamina);
    if (p.moveMag > 0.1) {
      p.rollDirX = p.moveX / p.moveMag;
      p.rollDirY = p.moveY / p.moveMag;
    } else {
      p.rollDirX = Math.cos(p.aimAngle);
      p.rollDirY = Math.sin(p.aimAngle);
    }
    p.vx = p.vy = 0;
    p.bodyDir = dir8FromAngle(Math.atan2(p.rollDirY, p.rollDirX));
    p.body.play('roll', { restart: true, phases: { roll: c.travelTicks, recover: c.totalTicks - c.travelTicks } });
    p.legsVisible = false;
    p.weaponVisible = false;
    p.squash.set(DATA.juice.squash.rollStart);
    p.ctx.bus.emit('dust', { x: p.x - p.rollDirX * 4, y: p.y - p.rollDirY * 2, kind: 'roll' });
    p.ctx.bus.emit('sfx', { id: 'roll' });
  },
  tick(p, t) {
    const c = DATA.roll;
    p.invulnerable = t >= c.iframeStart && t <= c.iframeEnd;
    if (t < c.travelTicks) {
      const d = c.distance * (easeOut((t + 1) / c.travelTicks, c.curvePower) - easeOut(t / c.travelTicks, c.curvePower));
      p.moveBy(p.rollDirX * d, p.rollDirY * d);
    }
    if (t === c.travelTicks) p.squash.set(DATA.juice.squash.rollLand);
    if (t >= c.cancelFrom) {
      if (p.stamina.canAct() && p.input.consume('roll')) {
        p.sm.change('roll', true);
        return;
      }
      const w = p.weapon;
      if (w.kind === 'melee' && p.stamina.canAct()) {
        if (w.light.length && p.input.consume('light')) {
          p.comboIndex = 0;
          return 'attack';
        }
        if (w.heavy && p.input.consume('heavy')) return 'heavy';
      }
    }
    if (t >= c.moveCancelFrom && p.moveMag > 0.1) return 'move';
    if (t >= c.totalTicks - 1) return 'idle';
  },
  exit(p) {
    p.invulnerable = false;
    p.legsVisible = true;
    p.weaponVisible = true;
    p.body.play('idle');
  },
};

const stagger: State<Player> = {
  enter(p) {
    p.vx = p.vy = 0;
    p.body.play('stagger', { restart: true });
    p.squash.set(DATA.juice.squash.hit);
    p.ctx.bus.emit('sfx', { id: 'stagger' });
  },
  tick(_p, t) {
    if (t >= DATA.player.staggerTicks) return 'idle';
  },
};

const dead: State<Player> = {
  enter(p) {
    p.dead = true;
    p.vx = p.vy = 0;
    p.legsVisible = false;
    p.weaponVisible = false;
    p.body.play('death', { restart: true });
    p.ctx.bus.emit('sfx', { id: 'player_die' });
    p.ctx.bus.emit('died', { actor: p });
  },
  tick() {},
  exit(p) {
    p.legsVisible = true;
    p.weaponVisible = true;
    p.body.play('idle');
  },
};

export const PLAYER_STATES: Record<string, State<Player>> = {
  idle: { tick: locomotion },
  move: { tick: locomotion },
  sprint: { tick: locomotion },
  roll,
  attack,
  heavy,
  stagger,
  dead,
};
