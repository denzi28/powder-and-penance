import { describe, expect, it } from 'vitest';
import { shapeHitsRect, type HitShape } from '../src/combat/shapes';
import { Poise } from '../src/actors/Poise';
import { AttackRunner, turnToward } from '../src/combat/AttackRunner';
import { CombatSystem, type HitSource } from '../src/combat/CombatSystem';
import { Projectiles } from '../src/combat/Projectiles';
import { EventBus, type GameEvents } from '../src/core/EventBus';
import { RoomData, StrikeDef } from '../src/data/schemas';
import { buildGrid } from '../src/world/TileGrid';
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
    parried: 0,
    stamina: 100,
    guarding: null as null | { facing: number; arcDeg: number; parry: boolean; stability: number; absorption: number },
    ctx: { bus, combat },
    guard() {
      return this.guarding;
    },
    spendGuardStamina(cost: number) {
      this.stamina = Math.max(0, this.stamina - cost);
      return this.stamina <= 0;
    },
    onParried() {
      this.parried++;
    },
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

  const src = (owner: Actor, over: Partial<HitSource> = {}): HitSource => ({
    owner,
    kind: 'melee',
    damage: 20,
    poise: 10,
    knockback: 0,
    hitstop: 0,
    shake: 0,
    angle: 0,
    unblockable: false,
    unparryable: false,
    ...over,
  });

  it('a raised guard facing the attacker blocks: chip damage + stamina cost, no poise damage', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const atk = stub('enemy', 0, 20, combat, bus);
    const tgt = stub('player', 20, 20, combat, bus);
    tgt.guarding = { facing: Math.PI, arcDeg: 140, parry: false, stability: 0.5, absorption: 0.8 };
    const info = combat.applyHit(src(atk), tgt, bus)!;
    expect(info.blocked).toBe(true);
    expect(tgt.hp).toBe(96); // 20% chip
    expect(tgt.stamina).toBe(100 - 20 * 0.5 * 2); // damage x (1 - stability) x blockStaminaMult(2)
    expect(tgt.poise.damage).toBe(0);
  });

  it('guard break when a block empties stamina; hits from behind ignore the guard', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const atk = stub('enemy', 0, 20, combat, bus);
    const tgt = stub('player', 20, 20, combat, bus);
    tgt.guarding = { facing: Math.PI, arcDeg: 140, parry: false, stability: 0.5, absorption: 0.8 };
    tgt.stamina = 5;
    expect(combat.applyHit(src(atk), tgt, bus)!.guardBroken).toBe(true);
    tgt.guarding = { ...tgt.guarding, facing: 0 }; // turned away
    expect(combat.applyHit(src(atk), tgt, bus)!.blocked).toBe(false);
  });

  it('parry window: melee is parried (no damage), projectiles and unparryable strikes are not', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    let parries = 0;
    bus.on('parry', () => parries++);
    const atk = stub('enemy', 0, 20, combat, bus);
    const tgt = stub('player', 20, 20, combat, bus);
    tgt.guarding = { facing: Math.PI, arcDeg: 140, parry: true, stability: 0.5, absorption: 0.8 };
    expect(combat.applyHit(src(atk), tgt, bus)).toBeNull();
    expect(atk.parried).toBe(1);
    expect(parries).toBe(1);
    expect(tgt.hp).toBe(100);
    expect(combat.applyHit(src(atk, { kind: 'projectile', angle: 0, unparryable: true }), tgt, bus)!.blocked).toBe(true);
    expect(combat.applyHit(src(atk, { unparryable: true }), tgt, bus)!.blocked).toBe(true);
  });

  it('projectiles pierce up to `pierce` targets and stop at walls', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const grid = buildGrid([
      RoomData.parse({ id: 'r', origin: [0, 0], legend: { '#': 'wall', '.': 'floor' }, tiles: ['##########', '#........#', '##########'] }),
    ]);
    const shooter = stub('player', 20, 28, combat, bus);
    const a = stub('enemy', 60, 28, combat, bus);
    const b = stub('enemy', 90, 28, combat, bus);
    const c = stub('enemy', 120, 28, combat, bus);
    const proj = new Projectiles();
    const def = { sprite: 'bolt', speed: 300, range: 400, damage: 10, poise: 0, pierce: 1, knockback: 0, hitstop: 0, shake: 0, radius: 2, spreadDeg: 0, count: 1, ring: false, bounces: 0, returns: false, spin: 0 };
    proj.spawn(shooter, 24, 28, 0, def);
    for (let i = 0; i < 60 && proj.list.length; i++) proj.tick([shooter, a, b, c], grid, combat, bus);
    expect([a.hp, b.hp, c.hp]).toEqual([90, 90, 100]); // pierced one, stopped in the second
    let wall = false;
    bus.on('projectileEnd', e => (wall = e.wall));
    proj.spawn(shooter, 24, 28, 0, { ...def, pierce: 99 });
    for (let i = 0; i < 60 && proj.list.length; i++) proj.tick([shooter], grid, combat, bus);
    expect(wall).toBe(true);
  });

  it('windup tracking turns at most trackDegPerTick', () => {
    const next = turnToward(0, Math.PI, (10 * Math.PI) / 180);
    expect(next).toBeCloseTo((10 * Math.PI) / 180);
  });

  it('a thrown strike throws `count` shots in an even fan `spreadDeg` wide', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const atk = stub('enemy', 0, 20, combat, bus);
    const proj = new Projectiles();
    (atk.ctx as unknown as { projectiles: Projectiles }).projectiles = proj;
    const throwStrike = StrikeDef.parse({
      damage: 0, poise: 0, windup: 2, active: 1, recovery: 1,
      hitbox: { shape: 'circle', radius: 1 },
      projectile: { sprite: 'x', speed: 100, range: 100, damage: 5, poise: 0, radius: 2, count: 3, spreadDeg: 40 },
    });
    const r = new AttackRunner(atk, throwStrike, 0);
    while (r.phase !== 'done') r.tick();
    const deg = proj.list.map(p => Math.round((p.angle * 180) / Math.PI)).sort((a, b) => a - b);
    expect(deg).toEqual([-20, 0, 20]);
  });
});

describe('signature boss attacks', () => {
  const open = () =>
    buildGrid([
      RoomData.parse({
        id: 'r',
        origin: [0, 0],
        legend: { '#': 'wall', '.': 'floor' },
        tiles: ['##############', ...Array.from({ length: 8 }, () => '#............#'), '##############'],
      }),
    ]);
  const proj = (over: Record<string, unknown>) =>
    StrikeDef.parse({
      damage: 0, poise: 0, windup: 2, active: 12, recovery: 1,
      hitbox: { shape: 'circle', radius: 1 },
      projectile: { sprite: 'x', speed: 100, range: 100, damage: 10, poise: 0, radius: 3, ...over },
    });
  const deg = (a: number) => ((Math.round((a * 180) / Math.PI) % 360) + 360) % 360;

  it('a ring throws all the way round, and volleys turn into a spiral', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const atk = stub('enemy', 100, 80, combat, bus);
    const list = new Projectiles();
    (atk.ctx as unknown as { projectiles: Projectiles }).projectiles = list;
    const r = new AttackRunner(atk, proj({ count: 4, ring: true, volleys: { count: 3, everyTicks: 4, turnDeg: 10 } }), 0);
    while (r.phase !== 'done') r.tick();
    expect(list.list.map(p => deg(p.angle)).sort((a, b) => a - b)).toEqual([0, 10, 20, 90, 100, 110, 180, 190, 200, 270, 280, 290]);
  });

  it('homing shots bend round to a foe off to the side; straight ones fly past', () => {
    const grid = open();
    for (const homing of [undefined, { degPerTick: 4 }]) {
      const combat = new CombatSystem();
      const bus = new EventBus<GameEvents>();
      const me = stub('enemy', 30, 40, combat, bus);
      const you = stub('player', 150, 110, combat, bus);
      const list = new Projectiles();
      const def = proj({ range: 400, homing }).projectile!;
      list.spawn(me, 30, 40, 0, def);
      for (let i = 0; i < 200 && list.list.length; i++) list.tick([me, you], grid, combat, bus);
      expect(you.hp).toBe(homing ? 90 : 100);
    }
  });

  it('a bouncing shot glances off the wall and keeps flying', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const me = stub('enemy', 100, 60, combat, bus);
    const list = new Projectiles();
    let bounced = 0;
    bus.on('projectileEnd', e => (bounced += e.bounce ? 1 : 0));
    list.spawn(me, 100, 60, 0, proj({ range: 400, bounces: 1 }).projectile!);
    for (let i = 0; i < 90; i++) list.tick([me], open(), combat, bus);
    expect(bounced).toBe(1);
    expect(list.list.length).toBe(1);
    expect(Math.cos(list.list[0].angle)).toBeLessThan(0); // coming back the other way
  });

  it('a boomerang hits on the way out and on the way back, then is caught', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const me = stub('enemy', 40, 60, combat, bus);
    const you = stub('player', 90, 60, combat, bus);
    const list = new Projectiles();
    list.spawn(me, 40, 60, 0, proj({ range: 110, returns: true, pierce: 5 }).projectile!);
    expect(list.weaponOut(me)).toBe(true);
    for (let i = 0; i < 300 && list.list.length; i++) list.tick([me, you], open(), combat, bus);
    expect(you.hp).toBe(80);
    expect(list.list.length).toBe(0);
  });

  it('a lob bursts into a ring of shards', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const me = stub('enemy', 40, 60, combat, bus);
    const list = new Projectiles();
    const def = proj({ lob: { flightTicks: 10, arcHeight: 20, blastRadius: 10 }, shards: { sprite: 'x', count: 6, speed: 80, range: 40, damage: 5 } }).projectile!;
    list.spawn(me, 40, 60, 0, def, { x: 120, y: 60 });
    for (let i = 0; i < 11; i++) list.tick([me], open(), combat, bus);
    expect(list.list.length).toBe(6);
    expect(list.list.every(p => !p.lob && Math.abs(p.x - 120) < 3)).toBe(true);
  });

  it('a followSweep spin catches you behind the attacker, and again after rehitTicks', () => {
    const combat = new CombatSystem();
    const bus = new EventBus<GameEvents>();
    const atk = stub('enemy', 100, 60, combat, bus);
    const behind = stub('player', 70, 60, combat, bus); // west, facing east
    const spin = StrikeDef.parse({
      damage: 10, poise: 0, windup: 2, active: 24, recovery: 1,
      hitbox: { shape: 'arc', radius: 40, halfAngle: 20 },
      sweep: { fromDeg: -90, toDeg: 630 },
      followSweep: true,
      rehitTicks: 12,
    });
    const r = new AttackRunner(atk, spin, 0);
    while (r.phase !== 'done') {
      r.tick();
      combat.resolve([atk, behind], bus);
    }
    expect(behind.hp).toBe(80); // two turns, two hits
    // the same arc without followSweep points east the whole time and never reaches behind
    const still = stub('player', 70, 60, combat, bus);
    const r2 = new AttackRunner(atk, { ...spin, followSweep: false }, 0);
    while (r2.phase !== 'done') {
      r2.tick();
      combat.resolve([atk, still], bus);
    }
    expect(still.hp).toBe(100);
  });
});
