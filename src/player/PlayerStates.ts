// Player state machine. Every action is a committed state; cancels happen only at data-defined ticks.
import { DATA } from '../data/config';
import { SPRITES } from '../data/assets';
import { DEG, dir8FromAngle } from '../core/math';
import { AttackRunner } from '../combat/AttackRunner';
import type { State } from '../actors/StateMachine';
import type { StrikeDef } from '../data/schemas';
import type { Enemy } from '../enemies/Enemy';
import type { Player } from './Player';

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Move freely at a fraction of walk speed (used while blocking, shooting, reloading, swapping). */
function moveFree(p: Player, mult: number) {
  const cfg = DATA.player;
  const speed = cfg.walkSpeed * mult;
  p.accelerate(p.moveX * speed, p.moveY * speed, cfg.walkSpeed, cfg.accelTicks, cfg.decelTicks);
  p.integrate();
}

// ------------------------------------------------------------------ criticals
/** A riposte (parried enemy in front) or backstab (unaware/staggered enemy, from behind) in reach. */
function findCritical(p: Player): { victim: Enemy; kind: 'riposte' | 'backstab' } | null {
  const c = DATA.combat;
  let best: { victim: Enemy; kind: 'riposte' | 'backstab'; d: number } | null = null;
  for (const e of p.ctx.enemies()) {
    if (e.dead || e.stateName === 'critVictim') continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const toEnemy = Math.atan2(e.y - p.y, e.x - p.x);
    if (angleDiff(p.aimAngle, toEnemy) > c.critFacingDeg * DEG) continue;
    let kind: 'riposte' | 'backstab' | null = null;
    if (e.critOpen && d <= c.riposte.range) kind = 'riposte';
    // Behind it = we look at it along the same direction it faces.
    else if (d <= c.backstab.range && e.backstabbable && angleDiff(toEnemy, e.facing) <= (c.backstab.arcDeg * DEG) / 2)
      kind = 'backstab';
    if (kind && (!best || d < best.d)) best = { victim: e, kind, d };
  }
  return best ? { victim: best.victim, kind: best.kind } : null;
}

/** Visual-only strike used to animate a critical thrust. */
function critStrike(ticks: number, hitTick: number): StrikeDef {
  return {
    damage: 0,
    poise: 0,
    stamina: 0,
    windup: Math.max(1, hitTick - 2),
    active: 4,
    recovery: Math.max(0, ticks - hitTick - 2),
    hitbox: { shape: 'circle', radius: 1, offset: 0 },
    originY: -8,
    sweep: { fromDeg: 0, toDeg: 0, reach: 10 },
    trackDegPerTick: 0,
    knockback: 0,
    hitstop: 0,
    shake: 0,
    hyperArmor: 0,
    unblockable: true,
    unparryable: true,
    sfx: 'swing_heavy',
  };
}

// ------------------------------------------------------------------ action starts
/** Actions available from free movement (and from block). Returns the state to enter, if any. */
function tryStartAction(p: Player): string | undefined {
  const inp = p.input;
  if (p.stamina.canAct() && inp.consume('roll')) return 'roll';
  const w = p.weapon;
  if (inp.peek('light')) {
    const crit = findCritical(p);
    if (crit) {
      inp.consume('light');
      p.crit = crit;
      return 'critical';
    }
  }
  if (w.kind === 'ranged') {
    const a = p.ammoFor(p.weaponId);
    const r = w.ranged!;
    if (inp.consume('light')) {
      if (a.clip > 0) return p.stamina.canAct() ? 'fire' : undefined;
      if (a.reserve > 0) return 'reload';
      p.ctx.bus.emit('sfx', { id: 'dry_fire' });
    }
    if (inp.consume('reload') && a.clip < r.clip && a.reserve > 0) return 'reload';
  } else if (p.stamina.canAct() && w.light.length && inp.consume('light')) {
    p.comboIndex = 0;
    return 'attack';
  }
  if (w.heavy && p.stamina.canAct() && inp.consume('heavy')) return 'heavy';
}

/** Shared by idle / move / sprint. */
function locomotion(p: Player): string {
  const action = tryStartAction(p);
  if (action) return action;
  const inp = p.input;
  if (inp.consume('swap')) return 'swap';
  if (inp.held('block') && p.shield) return 'block';

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

// ------------------------------------------------------------------ melee
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
// For ranged weapons this is the (uncharged) weapon bash.
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

// ------------------------------------------------------------------ ranged
function shoot(p: Player) {
  const w = p.weapon;
  const r = w.ranged!;
  const a = p.ammoFor(p.weaponId);
  a.clip--;
  const m = SPRITES[w.view.sprite];
  const muzzle = m.points?.muzzle ?? [m.cell[0], m.pivot[1]];
  const len = muzzle[0] - m.pivot[0] + 4;
  const x = p.x + Math.cos(p.aimAngle) * len;
  const y = p.y + Math.sin(p.aimAngle) * len;
  for (let i = 0; i < r.projectile.count; i++) {
    const spread = (p.ctx.rng() - 0.5) * r.projectile.spreadDeg * DEG;
    p.ctx.projectiles.spawn(p, x, y, p.aimAngle + spread, r.projectile);
  }
  p.recoil = 1;
  p.ctx.bus.emit('shot', { actor: p, weapon: w, x, y, angle: p.aimAngle });
  p.ctx.bus.emit('sfx', { id: r.fire.sfx });
  if (r.fire.shake) p.ctx.bus.emit('shake', { trauma: r.fire.shake });
}

const fire: State<Player> = {
  enter(p) {
    p.stamina.spend(p.weapon.ranged!.fire.stamina);
  },
  tick(p, t) {
    const f = p.weapon.ranged!.fire;
    moveFree(p, f.moveMult);
    if (t === f.windup) shoot(p);
    // The back half of the recovery can be rolled out of.
    if (t > f.windup + f.recovery * 0.6 && p.stamina.canAct() && p.input.consume('roll')) return 'roll';
    if (t >= f.windup + f.recovery) return 'idle';
  },
};

/** Reload length; Dexterity scaling hooks in here in M7. */
function reloadTicks(p: Player) {
  return p.weapon.ranged!.reload.ticks;
}

// Committed: no cancel. Getting staggered interrupts it and the rounds are not loaded.
const reload: State<Player> = {
  enter(p) {
    p.stamina.spend(p.weapon.ranged!.reload.stamina);
    p.reloadProgress = 0;
    p.weaponLowered = true;
    p.ctx.bus.emit('sfx', { id: 'reload_start' });
  },
  tick(p, t) {
    const r = p.weapon.ranged!;
    moveFree(p, r.reload.moveMult);
    const total = reloadTicks(p);
    p.reloadProgress = t / total;
    if (t >= total) {
      const a = p.ammoFor(p.weaponId);
      const n = Math.min(r.clip - a.clip, a.reserve);
      a.clip += n;
      a.reserve -= n;
      p.ctx.bus.emit('sfx', { id: 'reload_end' });
      return 'idle';
    }
  },
  exit(p) {
    p.reloadProgress = -1;
    p.weaponLowered = false;
  },
};

// ------------------------------------------------------------------ swap
const swap: State<Player> = {
  enter(p) {
    p.weaponLowered = true;
    p.ctx.bus.emit('sfx', { id: 'swap' });
  },
  tick(p, t) {
    const total = DATA.player.swapTicks;
    moveFree(p, 0.7);
    if (t === Math.floor(total / 2)) p.swapWeapon();
    p.weaponVisible = t >= Math.floor(total / 2) - 3;
    if (t >= total) return 'idle';
  },
  exit(p) {
    p.weaponLowered = false;
    p.weaponVisible = true;
  },
};

// ------------------------------------------------------------------ shield
const block: State<Player> = {
  enter(p) {
    const sh = p.shield!;
    // A fresh press only parries if the guard was released long enough ago (no parry mashing).
    p.parryActive = p.age - p.blockReleasedAt >= sh.parryRearmTicks;
    p.ctx.bus.emit('sfx', { id: 'swap', volume: 0.6 });
  },
  tick(p, t) {
    const sh = p.shield;
    if (!sh || !p.input.held('block')) return 'idle';
    if (t >= sh.parryWindowTicks) p.parryActive = false;
    const action = tryStartAction(p);
    if (action) return action;
    p.stamina.regenMult = sh.blockRegenMult;
    moveFree(p, sh.blockMoveMult);
  },
  exit(p) {
    p.blockReleasedAt = p.age;
    p.parryActive = false;
    p.stamina.regenMult = 1;
  },
};

// ------------------------------------------------------------------ roll
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
      const action = tryStartAction(p);
      if (action) return action;
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

// ------------------------------------------------------------------ critical (paired animation)
const critical: State<Player> = {
  enter(p) {
    const { victim, kind } = p.crit!;
    const c = DATA.combat[kind];
    // Snap into position: in front of a riposted enemy, behind a backstabbed one.
    const side = kind === 'riposte' ? Math.atan2(p.y - victim.y, p.x - victim.x) : victim.facing + Math.PI;
    const gap = victim.bodyRadius + p.bodyRadius + 4;
    p.moveBy(victim.x + Math.cos(side) * gap - p.x, victim.y + Math.sin(side) * gap - p.y);
    const angle = Math.atan2(victim.y - p.y, victim.x - p.x);
    p.vx = p.vy = 0;
    p.invulnerable = true;
    p.runner = new AttackRunner(p, critStrike(c.ticks, c.hitTick), angle, p.weapon.view.restAngleOffsetDeg * DEG, true);
    p.body.play('attack', { restart: true, phases: { windup: c.hitTick, active: 4, recovery: c.ticks - c.hitTick } });
    victim.beginCritVictim(p, c.ticks + c.victimExtraTicks);
  },
  tick(p, t) {
    const { victim, kind } = p.crit!;
    const c = DATA.combat[kind];
    p.runner!.tick();
    if (t === c.hitTick) {
      const w = p.weapon;
      const base = w.kind === 'melee' ? w.light[0].damage : (w.heavy?.strike.damage ?? 10);
      p.ctx.combat.applyHit(
        {
          owner: p,
          kind: 'critical',
          damage: Math.round(base * w.crit[kind]),
          poise: 0,
          knockback: 40,
          hitstop: c.hitstop,
          shake: c.shake,
          angle: p.runner!.angle,
          unblockable: true,
          unparryable: true,
        },
        victim,
        p.ctx.bus,
      );
      p.ctx.bus.emit('critical', { attacker: p, victim, kind });
    }
    if (t >= c.ticks) return 'idle';
  },
  exit(p) {
    p.invulnerable = false;
    p.crit = null;
    endStrike(p);
  },
};

// ------------------------------------------------------------------ being hit
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

const guardBroken: State<Player> = {
  enter(p) {
    p.vx = p.vy = 0;
    p.body.play('stagger', { restart: true });
    p.squash.set(DATA.juice.squash.hit);
    p.ctx.bus.emit('sfx', { id: 'guard_break' });
  },
  tick(_p, t) {
    if (t >= DATA.player.guardBreakTicks) return 'idle';
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
  fire,
  reload,
  swap,
  block,
  critical,
  stagger,
  guardBroken,
  dead,
};
