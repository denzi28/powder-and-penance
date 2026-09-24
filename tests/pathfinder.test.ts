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

  it('heads for the nearest open tile when the goal is inside a wall; null when nothing near is open', () => {
    const s = at(2, 2);
    const p = pf.find(s.x, s.y, 4 * TILE + 8, 2 * TILE + 10, 5); // goal inside the dividing wall
    expect(p).not.toBeNull();
    expect(pf.find(s.x, s.y, 40 * TILE, 2 * TILE, 5)).toBeNull(); // far outside the room
  });

  it('plans a wide body around a one-tile gap it cannot fit, and still finds a way for a narrow one', () => {
    // a wall with a one-tile gap at the top and a three-tile opening at the bottom
    const r2 = RoomData.parse({
      id: 'r2',
      origin: [0, 0],
      legend: { '#': 'wall', '.': 'floor' },
      tiles: ['###########', '#.........#', '#####.#####', '#.........#', '#.........#', '#.........#', '###...#####', '#.........#', '###########'],
    });
    const g2 = buildGrid([r2]);
    const pf2 = new Pathfinder(() => g2);
    const s = { x: 5 * TILE + 8, y: 4 * TILE + 10 };
    const t = { x: 5 * TILE + 8, y: 1 * TILE + 10 };
    // narrow: straight up through the one-tile gap; wide (a boss): the gap won't take it, and there's no other way
    expect(pf2.fits(5, 2, 5)).toBe(true);
    expect(pf2.fits(5, 2, 13)).toBe(false);
    const narrow = pf2.find(s.x, s.y, t.x, t.y, 5);
    expect(narrow).not.toBeNull();
    // down instead: the wide body goes through the three-tile opening
    const down = { x: 4 * TILE + 8, y: 7 * TILE + 10 };
    const wide = pf2.find(s.x, s.y, down.x, down.y, 13)!;
    expect(wide).not.toBeNull();
    expect(wide.every(q => pf2.fits(Math.floor(q.x / TILE), Math.floor((q.y - 2) / TILE), 13) || q === wide[wide.length - 1])).toBe(true);
  });
});
