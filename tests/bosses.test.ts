// Boss rules: every boss arena gets a shrine once its boss falls, and multi-phase bosses are wired up.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';
import { Cell, TILE } from '../src/world/TileGrid';
import { arenaWakesAt } from '../src/game/arenaWake';
import { Enemy } from '../src/enemies/Enemy';
import { EventBus, type GameEvents } from '../src/core/EventBus';
import { CombatSystem } from '../src/combat/CombatSystem';
import { Projectiles } from '../src/combat/Projectiles';
import { AttackTokens } from '../src/enemies/AttackTokens';
import { Pathfinder } from '../src/world/Pathfinder';
import { mulberry32, type WorldCtx } from '../src/core/World';
import { WaxPools } from '../src/world/WaxPools';
import type { Player } from '../src/player/Player';

describe('bosses', () => {
  const arenas = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'arena').map(e => ({ r, e })));
  const shrines = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'shrine').map(e => ({ r, e })));

  it('every boss arena has a shrine that appears when its boss falls, in the same area', () => {
    expect(arenas.length).toBeGreaterThan(0);
    for (const { r, e } of arenas) {
      const s = shrines.find(x => x.e.when === `boss:${String(e.boss)}`);
      expect(s, `shrine for ${String(e.boss)}`).toBeDefined();
      expect(s!.r.area, `shrine for ${String(e.boss)}`).toBe(r.area);
    }
  });

  it('a boss with a next phase names a boss, and a chest spot inside its arena room', () => {
    for (const { r, e } of arenas) {
      const next = DATA.enemies[String(e.boss)].boss?.next;
      if (!next) continue;
      expect(DATA.enemies[next.kind].boss, next.kind).toBeDefined();
      const [x, y] = next.chest.at;
      expect(r.tiles[y]?.[x], `chest at [${x},${y}] in ${r.id}`).not.toBe('#');
    }
  });

  it("sealing an arena never shuts the player into solid ground (wherever it can wake)", () => {
    for (const { r, e } of arenas) {
      const grid = levelGrid(Object.values(DATA.rooms).filter(x => x.area === r.area));
      const seals = (e.seals as [number, number][]).map(([x, y]) => ({ tx: r.origin[0] + x, ty: r.origin[1] + y }));
      const walkable = new Set<string>();
      let wakeTiles = 0;
      for (let ty = r.origin[1]; ty < r.origin[1] + r.tiles.length; ty++)
        for (let tx = r.origin[0]; tx < r.origin[0] + r.tiles[0].length; tx++)
          if (arenaWakesAt(r, seals, tx, ty) && !grid.isSolid(tx, ty)) walkable.add(`${tx},${ty}`);
      for (const s of seals) grid.set(s.tx, s.ty, Cell.Wall);
      for (const k of walkable) {
        const [tx, ty] = k.split(',').map(Number);
        expect(grid.isSolid(tx, ty), `${r.id}: tile ${tx},${ty} wakes the arena but is solid once sealed`).toBe(false);
        wakeTiles++;
      }
      expect(wakeTiles, `${r.id} can be woken`).toBeGreaterThan(0);
    }
  });

  it("a boss that turns has an altar spot it can stand on, inside its arena", () => {
    for (const { r, e } of arenas) {
      const turn = DATA.enemies[String(e.boss)].boss?.turn;
      if (!turn) continue;
      const grid = levelGrid(Object.values(DATA.rooms).filter(x => x.area === r.area));
      const [x, y] = turn.altar;
      expect(grid.isSolid(r.origin[0] + x, r.origin[1] + y), `altar spot [${x},${y}] in ${r.id}`).toBe(false);
      expect(DATA.enemies[turn.kind].boss, turn.kind).toBeDefined();
    }
  });
});

describe('the Nave', () => {
  it('its great door needs both Seals', () => {
    const door = Object.values(DATA.rooms)
      .flatMap(r => r.entities)
      .find(e => e.id === 'abbey_door_nave');
    expect(door?.requires).toEqual(['seal_of_tallow', 'seal_of_the_mire']);
  });

  it("the Chandler doesn't die when his health runs out: he walks to the altar and turns", () => {
    const rooms = Object.values(DATA.rooms).filter(r => r.area === 'abbey');
    const grid = levelGrid(rooms);
    const nave = DATA.rooms.abbey_12_nave;
    const roomAt = (x: number, y: number) => {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      return rooms.find(r => tx >= r.origin[0] && ty >= r.origin[1] && tx < r.origin[0] + r.tiles[0].length && ty < r.origin[1] + r.tiles.length)?.id ?? null;
    };
    const at = (x: number, y: number) => ({ x: (nave.origin[0] + x) * TILE + TILE / 2, y: (nave.origin[1] + y) * TILE + TILE - 2 });
    const pp = at(10, 15);
    const player = { ...pp, chestY: pp.y - 10, dead: false, bodyRadius: 5 } as unknown as Player;
    const bus = new EventBus<GameEvents>();
    const combat = new CombatSystem();
    let boss: Enemy;
    const ctx: WorldCtx = {
      input: null as never,
      bus,
      grid: () => grid,
      combat,
      projectiles: new Projectiles(),
      tokens: new AttackTokens(),
      nav: new Pathfinder(() => grid),
      rng: mulberry32(7),
      player: () => player,
      enemies: () => [boss],
      roomAt,
    };
    const start = at(4, 13);
    boss = new Enemy(ctx, 'chandler', start.x, start.y, 0);
    const blow = { owner: player, kind: 'melee', damage: 99999, poise: 0, knockback: 0, hitstop: 0, shake: 0, angle: 0, unblockable: true, unparryable: true } as const;
    combat.applyHit(blow, boss, bus);
    expect(boss.dead).toBe(false);
    expect(boss.stateName).toBe('turn');
    let t = 0;
    for (; t < 800 && !boss.turned; t++) {
      boss.tick();
      expect(boss.invulnerable).toBe(true);
    }
    expect(boss.turned, 'finished the turn').toBe(true);
    const spot = boss.altarSpot();
    expect(Math.hypot(boss.x - spot.x, boss.y - spot.y)).toBeLessThan(6);
  });
});

describe('wax pools', () => {
  it('slow whoever stands in one, and set after their time', () => {
    const pools = new WaxPools();
    pools.add(100, 100, 20, 60, 0.5);
    for (let i = 0; i < 20; i++) pools.tick(); // spread out
    expect(pools.mult(100, 100)).toBe(0.5);
    expect(pools.mult(115, 100)).toBe(0.5);
    expect(pools.mult(100, 115)).toBe(1); // flattened: not as tall as it is wide
    expect(pools.mult(130, 100)).toBe(1);
    for (let i = 0; i < 60; i++) pools.tick();
    expect(pools.list).toHaveLength(0);
    expect(pools.mult(100, 100)).toBe(1);
  });
});
