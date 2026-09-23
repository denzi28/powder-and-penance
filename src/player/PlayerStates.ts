// Player state machine. Every action is a committed state; cancels happen only at data-defined ticks.
import { DATA } from '../data/config';
import { dir8FromAngle } from '../core/math';
import type { State } from '../actors/StateMachine';
import type { Player } from './Player';

/** Shared by idle / move / sprint: free movement, can start actions. */
function locomotion(p: Player): string {
  const inp = p.input;
  if (p.stamina.canAct() && inp.consume('roll')) return 'roll';
  if (inp.consume('swap')) p.swapWeapon();

  const cfg = DATA.player;
  const moving = p.moveMag > 0.1;
  if (!inp.held('sprint')) p.sprintNeedsRepress = false;
  const wasSprinting = p.sm.name === 'sprint';
  const sprint =
    moving && inp.held('sprint') && !p.sprintNeedsRepress && (wasSprinting ? p.stamina.value > 0 : p.stamina.canAct());
  if (wasSprinting && !sprint && p.stamina.value <= 0) p.sprintNeedsRepress = true;

  const speed = cfg.walkSpeed * (sprint ? cfg.sprintMult : 1);
  p.accelerate(p.moveX * speed, p.moveY * speed);
  if (sprint) p.stamina.spend(DATA.stamina.sprintPerSec / DATA.game.tickRate);
  p.integrate();

  return sprint ? 'sprint' : moving ? 'move' : 'idle';
}

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
  },
  tick(p, t) {
    const c = DATA.roll;
    p.invulnerable = t >= c.iframeStart && t <= c.iframeEnd;
    if (t < c.travelTicks) {
      const d = c.distance * (easeOut((t + 1) / c.travelTicks, c.curvePower) - easeOut(t / c.travelTicks, c.curvePower));
      p.moveBy(p.rollDirX * d, p.rollDirY * d);
    }
    if (t === c.travelTicks) p.squash.set(DATA.juice.squash.rollLand);
    if (t >= c.cancelFrom && p.stamina.canAct() && p.input.consume('roll')) {
      p.sm.change('roll', true);
      return;
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

export const PLAYER_STATES: Record<string, State<Player>> = {
  idle: { tick: locomotion },
  move: { tick: locomotion },
  sprint: { tick: locomotion },
  roll,
};
