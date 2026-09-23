// Level integrity for The Guttering Abbey: every room is reachable from the start, and the shortcut gate
// really is the only short way between the Undercroft and the Porch.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';
import { Cell, TILE } from '../src/world/TileGrid';
import { Pathfinder } from '../src/world/Pathfinder';

const rooms = Object.values(DATA.rooms).filter(r => r.area === 'abbey');
const centreOf = (id: string, grid: ReturnType<typeof levelGrid>) => {
  const r = DATA.rooms[id];
  const cx = r.origin[0] + Math.floor(r.tiles[0].length / 2);
  const cy = r.origin[1] + Math.floor(r.tiles.length / 2);
  for (let d = 0; d < 10; d++)
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++)
        if (!grid.isSolid(cx + dx, cy + dy)) return { x: (cx + dx) * TILE + 8, y: (cy + dy) * TILE + 10 };
  throw new Error(`no floor in ${id}`);
};
const gate = () => {
  for (const r of rooms)
    for (const e of r.entities) if (e.id === 'abbey_gate_undercroft') return { x: r.origin[0] + e.at[0], y: r.origin[1] + e.at[1] };
  throw new Error('gate missing');
};

describe('The Guttering Abbey', () => {
  it('has 12+ rooms, two shrines and a one-way shortcut', () => {
    expect(rooms.length).toBeGreaterThanOrEqual(12);
    const shrines = rooms.flatMap(r => r.entities.filter(e => e.type === 'shrine'));
    expect(shrines.filter(s => s.when === undefined)).toHaveLength(2); // there from the start
    expect(shrines.filter(s => s.when === 'boss:tollwarden')).toHaveLength(1); // appears after the Tollwarden
    const oneWay = rooms.flatMap(r => r.entities.filter(e => e.type === 'door' && e.opensFrom));
    expect(oneWay).toHaveLength(1);
  });

  it('every room is reachable from the start with doors open', () => {
    const grid = levelGrid(rooms);
    const pf = new Pathfinder(() => grid);
    const start = centreOf('abbey_01_porch', grid);
    for (const r of rooms) {
      const goal = centreOf(r.id, grid);
      expect(pf.find(start.x, start.y, goal.x, goal.y, 5, 60000), r.id).not.toBeNull();
    }
  });

  it('with the shortcut gate closed, Porch -> Undercroft is the long way round', () => {
    const grid = levelGrid(rooms);
    const pf = new Pathfinder(() => grid);
    const a = centreOf('abbey_01_porch', grid);
    const b = centreOf('abbey_10_undercroft', grid);
    const open = pf.find(a.x, a.y, b.x, b.y, 5, 60000)!;
    const g = gate();
    grid.set(g.x, g.y, Cell.Wall);
    const closed = pf.find(a.x, a.y, b.x, b.y, 5, 60000)!;
    const len = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => s + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    expect(closed).not.toBeNull();
    expect(len(closed)).toBeGreaterThan(len(open) * 5);
  });
});
