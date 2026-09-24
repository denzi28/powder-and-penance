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
  const speed = cfg.walkSpeed * mult * p.loadTier.move;
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
    pull: false,
    sfx: 'swing_heavy',
  };
}

// ------------------------------------------------------------------ action starts
/** Actions available from free movement (and from block). Returns the state to enter, if any. */
function tryStartAction(p: Player): string | undefined {
  const inp = p.input;
  if (p.stamina.canAct() && inp.consume('roll')) return 'roll';
  if (inp.consume('heal')) {
    if (p.phials.charges > 0) return 'heal';
    p.ctx.bus.emit('sfx', { id: 'phial_empty' });
  }
  if (inp.consume('useItem')) {
    if (p.belt && p.count(p.belt) > 0) {
      p.using = p.belt;
      return 'useItem';
    }
    p.ctx.bus.emit('sfx', { id: 'phial_empty' });
  }
  // Left click uses the right hand; right click the left hand's weapon (a shield blocks instead: locomotion).
  if (inp.peek('light')) {
    const crit = findCritical(p);
    if (crit) {
      inp.consume('light');
      p.slot = 0;
      p.crit = crit;
      return 'critical';
    }
  }
  const right = useHand(p, 0);
  if (right) return right;
  if (p.leftWeapon) {
    const left = useHand(p, 1);
    if (left) return left;
  }
  if (inp.consume('reload')) {
    // the gun in use first, then the one in the other hand
    for (const i of [p.slot, 1 - p.slot]) {
      const r = DATA.weapons[p.slots[i]]?.ranged;
      const a = r && p.ammoFor(p.slots[i]);
      if (r && a && a.clip < r.clip && a.reserve > 0) {
        p.slot = i;
        return 'reload';
      }
    }
  }
  const rw = DATA.weapons[p.slots[0]];
  if (rw.heavy && p.stamina.canAct() && inp.consume('heavy')) {
    p.slot = 0; // the heavy attack is the right hand's
    return 'heavy';
  }
}

/** The button that uses a hand: left click for the right hand, right click for the left. */
const handButton = (i: number) => (i === 0 ? 'light' : 'block');

/** Swing or fire the weapon in hand i if its button was pressed (it becomes the hand in use). */
function useHand(p: Player, i: 0 | 1): string | undefined {
  const inp = p.input;
  const button = handButton(i);
  const id = p.slots[i];
  const w = DATA.weapons[id];
  if (w.kind === 'ranged') {
    if (!inp.consume(button)) return;
    p.slot = i;
    const a = p.ammoFor(id);
    if (a.clip > 0) return p.stamina.canAct() ? 'fire' : undefined;
    if (a.reserve > 0) return 'reload';
    p.ctx.bus.emit('sfx', { id: 'dry_fire' });
    return;
  }
  if (p.stamina.canAct() && w.light.length && inp.consume(button)) {
    p.slot = i;
    p.comboIndex = 0;
    return 'attack';
  }
}

/** How long the drop key must be held to drop the weapon in use (ticks). */
export const DROP_HOLD_TICKS = 30;

/** Shared by idle / move / sprint. */
function locomotion(p: Player): string {
  const action = tryStartAction(p);
  if (action) return action;
  const inp = p.input;
  // dropping a weapon takes a held press (a tap only says so): one slip shouldn't cost an upgraded weapon
  if (inp.held('drop')) {
    if (++p.dropHold === DROP_HOLD_TICKS) {
      const id = p.dropActive();
      if (id) p.ctx.bus.emit('weaponDropped', { id, x: p.x, y: p.y });
    }
  } else {
    if (p.dropHold > 0 && p.dropHold < DROP_HOLD_TICKS && p.weaponId !== 'fists') p.ctx.bus.emit('hint', { id: 'drop' });
    p.dropHold = 0;
  }
  if (inp.consume('swap')) p.ctx.bus.emit('hint', { id: 'swap' }); // Tab used to swap weapons
  if (inp.held('block') && p.shield) return 'block';

  const cfg = DATA.player;
  const moving = p.moveMag > 0.1;
  if (!inp.held('sprint')) p.sprintNeedsRepress = false;
  const wasSprinting = p.sm.name === 'sprint';
  const tier = p.loadTier;
  const sprint =
    tier.sprint && moving && inp.held('sprint') && !p.sprintNeedsRepress && (wasSprinting ? p.stamina.value > 0 : p.stamina.canAct());
  if (wasSprinting && !sprint && p.stamina.value <= 0) p.sprintNeedsRepress = true;

  const speed = cfg.walkSpeed * (sprint ? cfg.sprintMult : 1) * tier.move;
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
  const thrust = s.sweep.fromDeg === s.sweep.toDeg;
  const anim = s.anim && p.body.has(s.anim) ? s.anim : thrust ? 'thrust' : 'attack';
  p.body.play(anim, { restart: true, phases: { windup: s.windup, active: s.active, recovery: s.recovery } });
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
      // the same hand's button carries the combo on; the other hand can cut in
      if (p.input.consume(handButton(p.slot))) {
        p.comboIndex = (p.comboIndex + 1) % p.weapon.light.length;
        p.sm.change('attack', true);
        return;
      }
      const other = (1 - p.slot) as 0 | 1;
      if (other === 0 || p.leftWeapon) {
        const next = useHand(p, other);
        if (next) {
          p.sm.change(next, true);
          return;
        }
      }
      if (DATA.weapons[p.slots[0]].heavy && p.input.consume('heavy')) {
        p.slot = 0;
        p.sm.change('heavy', true);
        return;
      }
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
      if (p.charge === 1) p.ctx.bus.emit('sfx', { id: p.weapon.sounds.charge ?? 'p_charge' }); // drawing back for a big one
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
    p.ctx.projectiles.spawn(p, x, y, p.aimAngle + spread, r.projectile, undefined, p.weaponId);
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

/** Reload length (a Gunner's Band shortens it). */
function reloadTicks(p: Player) {
  return Math.max(1, Math.round(p.weapon.ranged!.reload.ticks * p.mods.reload));
}

// Committed: no cancel. Getting staggered interrupts it and the rounds are not loaded.
const reload: State<Player> = {
  enter(p) {
    p.stamina.spend(p.weapon.ranged!.reload.stamina);
    p.reloadProgress = 0;
    p.weaponLowered = true;
    if (!p.weapon.sounds.reload) p.ctx.bus.emit('sfx', { id: 'reload_start' });
  },
  tick(p, t) {
    const r = p.weapon.ranged!;
    moveFree(p, r.reload.moveMult);
    const total = reloadTicks(p);
    p.reloadProgress = t / total;
    // the reload's own steps: a cylinder swung out, rounds in, a ramrod, a windlass cranked...
    for (const [at, id] of p.weapon.sounds.reload ?? []) if (t === Math.floor(at * total)) p.ctx.bus.emit('sfx', { id });
    if (t >= total) {
      const a = p.ammoFor(p.weaponId);
      const n = Math.min(r.clip - a.clip, a.reserve);
      a.clip += n;
      a.reserve -= n;
      if (!p.weapon.sounds.reload) p.ctx.bus.emit('sfx', { id: 'reload_end' });
      return 'idle';
    }
  },
  exit(p) {
    p.reloadProgress = -1;
    p.weaponLowered = false;
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
/** The roll's sound by load: a light tumble, a normal roll, a heavy thud, a clumsy fall. */
const ROLL_SFX: Record<string, string> = { light: 'p_roll_light', medium: 'p_roll', heavy: 'p_roll_heavy', over: 'p_roll_flop' };

const easeOut = (t: number, power: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** power;

const roll: State<Player> = {
  enter(p) {
    const c = (p.rollCfg = p.rollParams()); // the equip load shapes the roll
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
    p.ctx.bus.emit('sfx', { id: ROLL_SFX[c.tier] ?? 'roll' });
  },
  tick(p, t) {
    const c = p.rollCfg!;
    p.invulnerable = t >= c.iframeStart && t <= c.iframeEnd;
    if (t < c.travelTicks) {
      const d =
        c.distance * (easeOut((t + 1) / c.travelTicks, c.curvePower) - easeOut(t / c.travelTicks, c.curvePower)) * p.terrainMult(); // wax drags
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
    p.body.play('thrust', { restart: true, phases: { windup: c.hitTick, active: 4, recovery: c.ticks - c.hitTick } });
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

// ------------------------------------------------------------------ healing & shrines
// Committed ~1 s drink at reduced speed. The charge is spent up front; the heal lands at healApplyTick.
const heal: State<Player> = {
  enter(p) {
    const c = DATA.phial;
    p.phials.charges--;
    p.healApplied = false;
    p.weaponLowered = true;
    p.body.play('drink', {
      restart: true,
      phases: { raise: c.raiseTicks, drink: c.healApplyTick - c.raiseTicks, lower: c.totalTicks - c.healApplyTick },
    });
    p.ctx.bus.emit('sfx', { id: 'p_drink' });
  },
  tick(p, t) {
    const c = DATA.phial;
    moveFree(p, c.moveMult);
    if (t === c.healApplyTick) {
      p.hp = Math.min(p.maxHp, p.hp + p.healAmount);
      p.healApplied = true;
      p.ctx.bus.emit('healed', { actor: p });
    }
    if (t >= c.totalTicks) return 'idle';
  },
  exit(p) {
    p.weaponLowered = false;
    p.body.play('idle');
    if (!p.healApplied) p.ctx.bus.emit('healFailed', { actor: p });
  },
};

// Using a consumable: a quick throw, or a short committed eat/drink/strike at half speed. It is only spent
// (and takes effect) at USE_AT; a hit before then keeps it.
const USE = { throw: { at: 8, total: 22, cancel: 14 }, other: { at: 24, total: 36, cancel: 30 } };
const useItem: State<Player> = {
  enter(p) {
    const c = DATA.consumables[p.using!];
    p.weaponLowered = true;
    if (c.use.type === 'throw') p.body.play('attack', { restart: true, phases: { windup: 6, active: 3, recovery: 12 } });
    else p.body.play('drink', { restart: true, phases: { raise: 12, drink: 14, lower: 10 } });
  },
  tick(p, t) {
    const id = p.using;
    const c = id ? DATA.consumables[id] : null;
    if (!id || !c) return 'idle';
    const u = c.use.type === 'throw' ? USE.throw : USE.other;
    moveFree(p, c.use.type === 'throw' ? 0.6 : 0.45);
    if (t === u.at) p.applyConsumable(id);
    if (t >= u.cancel && p.stamina.canAct() && p.input.consume('roll')) return 'roll';
    if (t >= u.total) return 'idle';
  },
  exit(p) {
    p.weaponLowered = false;
    p.using = null;
    p.body.play('idle');
  },
};

/** Kneeling at a shrine (kindling or resting). The scene decides when to stand up again. */
const rest: State<Player> = {
  enter(p) {
    p.vx = p.vy = 0;
    p.legsVisible = false;
    p.weaponVisible = false;
    p.body.play('kneel', { restart: true });
  },
  tick() {},
  exit(p) {
    p.legsVisible = true;
    p.weaponVisible = true;
    p.body.play('idle');
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

/** Held by a grab: helpless, pinned in front of the grabber, then slammed and thrown. */
const grabbed: State<Player> = {
  enter(p) {
    p.vx = p.vy = p.kbx = p.kby = 0;
    p.invulnerable = true; // only the grab itself hurts while held
    p.weaponVisible = false;
    p.body.play('stagger', { restart: true });
    p.ctx.bus.emit('grabbed', { by: p.grabbedBy!.by });
  },
  tick(p, t) {
    const g = p.grabbedBy!;
    const by = g.by;
    // Released early if the grabber is interrupted (killed, staggered, parried...).
    if (by.dead || by.stateName !== 'attack') return 'idle';
    const reach = by.bodyRadius + p.bodyRadius + 2;
    p.moveBy(by.x + Math.cos(by.facing) * reach - p.x, by.y + Math.sin(by.facing) * reach - p.y);
    if (t < g.holdTicks) return;
    p.invulnerable = false;
    p.ctx.combat.applyHit(
      {
        owner: by,
        kind: 'critical',
        damage: g.damage,
        poise: 0,
        knockback: g.throwKnockback,
        hitstop: 6,
        shake: 0.45,
        angle: by.facing,
        unblockable: true,
        unparryable: true,
      },
      p,
      p.ctx.bus,
    );
    if (!p.dead) return 'stagger';
  },
  exit(p) {
    p.invulnerable = false;
    p.weaponVisible = true;
    p.grabbedBy = null;
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
    p.ctx.bus.emit('sfx', { id: 'p_die' });
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
  block,
  heal,
  useItem,
  rest,
  critical,
  stagger,
  guardBroken,
  grabbed,
  dead,
};
