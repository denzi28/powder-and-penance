import { describe, expect, it } from 'vitest';
import { buildGrid, TILE } from '../src/world/TileGrid';
import { Pathfinder } from '../src/world/Pathfinder';
import { RoomData } from '../src/data/schemas';

// A room split by a wall with a single gap at the bottom.
const room = RoomData.parse({
  id: 'r',
  origin: [0, 0],
  legend: { '#': 'wall', '.': 'floor' },
  tiles: [
    '##########',
    '#...#....#',
    '#...#....#',
    '#...#....#',
    '#...#....#',
    '#........#',
    '##########',
  ],
});
const at = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 + 2 });

describe('Pathfinder', () => {
  const grid = buildGrid([room]);
  const pf = new Pathfinder(() => grid);

  it('sees a clear straight line in open floor, and a blocked one through the wall', () => {
    const a = at(1, 5);
    const b = at(8, 5);
    expect(pf.clearLine(a.x, a.y, b.x, b.y, 5)).toBe(true);
    const c = at(2, 2);
    const d = at(7, 2);
    expect(pf.clearLine(c.x, c.y, d.x, d.y, 5)).toBe(false);
  });

  it('routes around the wall through the gap, ending at the goal', () => {
    const s = at(2, 2);
    const g = at(7, 2);
    const path = pf.find(s.x, s.y, g.x, g.y, 5)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual(g);
    // Must dip down to the gap row (y = 5) to get past the wall at x = 4.
    expect(path.some(p => Math.floor(p.y / TILE) === 5)).toBe(true);
    // Every leg of the smoothed path is walkable.
    let from = s;
    for (const p of path) {
      expect(pf.clearLine(from.x, from.y, p.x, p.y, 5)).toBe(true);
      from = p;
    }
  });

  it('returns null for unreachable goals', () => {
    const s = at(2, 2);
    expect(pf.find(s.x, s.y, 4 * TILE + 8, 2 * TILE + 10, 5)).toBeNull(); // goal inside the wall
  });
});
