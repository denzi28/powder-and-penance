// The ground erupting under a strike (game/Eruptions): where each pattern lays its points, the warning before
// the burst, and who gets hit.
import { describe, expect, it } from 'vitest';
import { Eruptions } from '../src/game/Eruptions';
import { CombatSystem } from '../src/combat/CombatSystem';
import { EventBus, type GameEvents } from '../src/core/EventBus';
import { StrikeDef } from '../src/data/schemas';
import { Poise } from '../src/actors/Poise';
import type { GameScene } from '../src/scenes/GameScene';

function body(team: string, x: number, y: number) {
  return {
    team, x, y, hp: 100, dead: false, invulnerable: false, god: false, hyperArmor: 0, knockbackResist: 1, flash: 0,
    poise: new Poise(() => ({ max: 25, resetTicks: 60 })),
    guard: () => null,
    moveBy() {},
    hurtRect() { return { x: this.x - 5, y: this.y - 16, w: 10, h: 16 }; },
    knock() {},
    onHit() {},
    ctx: {},
  };
}

function scene() {
  const bus = new EventBus<GameEvents>();
  const boss = body('enemy', 100, 100);
  const player = body('player', 200, 100);
  const bursts: { x: number; y: number }[] = [];
  bus.on('erupted', e => bursts.push({ x: Math.round(e.x), y: Math.round(e.y) }));
  const gs = { bus, player, actors: [boss, player], combat: new CombatSystem(), grid: { isSolid: () => false } };
  return { gs: gs as unknown as GameScene, boss, player, bursts };
}
const erupt = (e: Record<string, unknown>) =>
  StrikeDef.parse({ damage: 0, poise: 0, windup: 1, active: 1, recovery: 1, hitbox: { shape: 'circle', radius: 1 }, eruptions: { radius: 10, damage: 20, fx: 'spikes', ...e } }).eruptions!;

describe('eruptions', () => {
  it('a line marches from the attacker to the target, one point at a time, each after its warning', () => {
    const { gs, boss, bursts } = scene();
    const er = new Eruptions();
    er.start(boss as never, erupt({ pattern: 'line', count: 4, spacing: 25, stepTicks: 3, warnTicks: 10 }), { x: 200, y: 100 }, 0, gs);
    for (let i = 0; i < 9; i++) er.tick(gs);
    expect(bursts.length).toBe(0); // still warning
    for (let i = 0; i < 30; i++) er.tick(gs);
    expect(bursts.map(b => b.x)).toEqual([125, 150, 175, 200]);
  });

  it('follow puts each point where the target stands when its turn comes, and hits it there', () => {
    const { gs, boss, player, bursts } = scene();
    const er = new Eruptions();
    er.start(boss as never, erupt({ pattern: 'follow', count: 2, stepTicks: 20, warnTicks: 5 }), null, 0, gs);
    for (let i = 0; i < 2; i++) er.tick(gs);
    player.x = 260; // ran off during the warning: the first one missed, the second one comes up under the new spot
    for (let i = 0; i < 30; i++) er.tick(gs);
    expect(bursts.map(b => b.x)).toEqual([200, 260]);
    expect(player.hp).toBe(80);
  });

  it('a ring closes round the target and the centre goes last; the attacker is never hit', () => {
    const { gs, boss, player, bursts } = scene();
    const er = new Eruptions();
    player.x = boss.x; // standing on the boss: only the target side's team is hurt
    er.start(boss as never, erupt({ pattern: 'ring', count: 6, spacing: 40, centre: true, stepTicks: 1, warnTicks: 3 }), { x: 100, y: 100 }, 0, gs);
    for (let i = 0; i < 20; i++) er.tick(gs);
    expect(bursts.length).toBe(7);
    expect(bursts[6]).toEqual({ x: 100, y: 100 });
    expect(boss.hp).toBe(100);
    expect(player.hp).toBe(80);
  });

  it('everything still to come is called off when the attacker dies', () => {
    const { gs, boss, bursts } = scene();
    const er = new Eruptions();
    er.start(boss as never, erupt({ pattern: 'star', lines: 4, count: 3, stepTicks: 5, warnTicks: 5 }), { x: 200, y: 100 }, 0, gs);
    boss.dead = true;
    for (let i = 0; i < 40; i++) er.tick(gs);
    expect(bursts.length).toBe(0);
  });
});
