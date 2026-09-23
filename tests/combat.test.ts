import { describe, expect, it } from 'vitest';
import { shapeHitsRect, type HitShape } from '../src/combat/shapes';
import { Poise } from '../src/actors/Poise';
import { AttackRunner, turnToward } from '../src/combat/AttackRunner';
import { CombatSystem } from '../src/combat/CombatSystem';
import { EventBus, type GameEvents } from '../src/core/EventBus';
import { StrikeDef } from '../src/data/schemas';
import type { Actor } from '../src/actors/Actor';

const arc = (angleDeg: number): HitShape => ({ kind: 'arc', cx: 0, cy: 0, angle: (angleDeg * Math.PI) / 180, radius: 20, halfAngle: Math.PI / 4, inner: 0 });

describe('shapes', () => {
  const box = { x: 10, y: -3, w: 6, h: 6 }; // straight east of the origin
  it('arc hits a box inside its sector and range', () => {
    expect(shapeHitsRect(arc(0), box)).toBe(true);
  });
  it('arc misses a box behind it or out of range', () => {
    expect(shapeHitsRect(arc(180), box)).toBe(false);
    expect(shapeHitsRect(arc(0), { x: 30, y: -3, w: 6, h: 6 })).toBe(false);
  });
  it('arc catches a box that only overlaps the sector edge', () => {
    expect(shapeHitsRect(arc(50), box)).toBe(true); // box spans ~ -17..+17 deg; sector 5..95 deg
  });
  it('circle hits by closest point', () => {
    expect(shapeHitsRect({ kind: 'circle', cx: 0, cy: 0, radius: 11 }, box)).toBe(true);
    expect(shapeHitsRect({ kind: 'circle', cx: 0, cy: 0, radius: 9 }, box)).toBe(false);
  });
});

describe('Poise', () => {
  it('staggers when accumulated damage reaches max (+hyper-armor buffer), then resets', () => {
    const p = new Poise(() => ({ max: 20, resetTicks: 10 }));
    expect(p.hit(12)).toBe(false);
    expect(p.hit(12, 10)).toBe(false); // 24 < 20 + 10 armor
    expect(p.hit(12)).toBe(true);
    expect(p.damage).toBe(0);
  });
  it('forgets poise damage after resetTicks without hits', () => {
    const p = new Poise(() => ({ max: 20, resetTicks: 3 }));
    p.hit(15);
    for (let i = 0; i < 3; i++) p.tick();
    expect(p.hit(15)).toBe(false);
  });
});

// Minimal actor stub: enough surface for AttackRunner and CombatSystem.
function stub(team: 'player' | 'enemy', x: number, y: number, combat: CombatSystem, bus: EventBus<GameEvents>) {
  const a = {
    team,
    x,
    y,
    hp: 100,
    dead: false,
    invulnerable: false,
    god: false,
    hyperArmor: 0,
    flash: 0,
    knockbackResist: 0,
    kbx: 0,
    kby: 0,
    hurtbox: { w: 10, h: 16, offsetY: -9 },
    poise: new Poise(() => ({ max: 25, resetTicks: 60 })),
    hits: 0,
    ctx: { bus, combat },
    get chestY() {
      return this.y - 9;
    },
    hurtRect() {
      return { x: this.x - 5, y: this.y - 17, w: 10, h: 16 };
    },
    moveBy(dx: number, dy: number) {
      this.x += dx;
      this.y += dy;
    },
    knock(ang: number, imp: number) {
      this.kbx += Math.cos(ang) * imp;
      this.kby += Math.sin(ang) * imp;
    },
    onHit() {
      this.hits++;
    },
  };
  return a as typeof a & Actor;
}

const strike = StrikeDef.parse({
  damage: 20,
  poise: 12,
  windup: 5,
  active: 3,
  recovery: 6,
  hitbox: { shape: 'arc', radius: 24, halfAngle: 60 },
  lunge: { distance: 6, startTick: 3, ticks: 3 },
  telegraph: { tick: 1, kind: 'normal' },
});

describe('AttackRunner + CombatSystem', () => {
  it('runs windup/active/recovery with lunge and events, hitting each target once', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const events: string[] = [];
    bus.on('telegraph', () => events.push('telegraph'));
    bus.on('swing', () => events.push('swing'));
    bus.on('hit', () => events.push('hit'));
    const atk = stub('enemy', 0, 20, combat, bus);
    const tgt = stub('player', 20, 20, combat, bus);
    const r = new AttackRunner(atk, strike, 0);
    const phases: string[] = [];
    while (r.phase !== 'done') {
      phases.push(r.phase[0]);
      r.tick();
      combat.resolve([atk, tgt], bus);
    }
    expect(phases.join('')).toBe('wwwwwaaarrrrrr');
    expect(atk.x).toBeCloseTo(6); // full lunge distance
    expect(events).toEqual(['telegraph', 'swing', 'hit']);
    expect(tgt.hp).toBe(80);
    expect(tgt.hits).toBe(1);
    expect(tgt.kbx).toBeGreaterThanOrEqual(0);
  });

  it('i-frames skip the hit without consuming it, so a later active tick can still land', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const atk = stub('enemy', 0, 20, combat, bus);
    const tgt = stub('player', 20, 20, combat, bus);
    const r = new AttackRunner(atk, { ...strike, lunge: undefined }, 0);
    for (let i = 0; i < 6; i++) {
      tgt.invulnerable = i <= 5; // invulnerable through the first active tick (t=5)
      r.tick();
      combat.resolve([atk, tgt], bus);
    }
    expect(tgt.hp).toBe(100);
    tgt.invulnerable = false;
    r.tick();
    combat.resolve([atk, tgt], bus);
    expect(tgt.hp).toBe(80);
  });

  it('ignores same-team targets', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const a = stub('enemy', 0, 20, combat, bus);
    const b = stub('enemy', 20, 20, combat, bus);
    const r = new AttackRunner(a, strike, 0);
    while (r.phase !== 'done') {
      r.tick();
      combat.resolve([a, b], bus);
    }
    expect(b.hp).toBe(100);
  });

  it('windup tracking turns at most trackDegPerTick', () => {
    const next = turnToward(0, Math.PI, (10 * Math.PI) / 180);
    expect(next).toBeCloseTo((10 * Math.PI) / 180);
  });
});
