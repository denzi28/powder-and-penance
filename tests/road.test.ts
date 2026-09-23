// Level integrity for the Penance Road: from the start, the east exit of every room is reachable.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { buildGrid, TILE } from '../src/world/TileGrid';
import { Pathfinder } from '../src/world/Pathfinder';

const rooms = Object.values(DATA.rooms).filter(r => r.area === 'road');

describe('Penance Road', () => {
  it('is the start of a new game', () => {
    expect(DATA.rooms[DATA.game.startRoom].area).toBe('road');
  });

  it('every room has an open east edge reachable from its spawn or west edge', () => {
    const grid = buildGrid(rooms);
    const pf = new Pathfinder(() => grid);
    for (const r of rooms) {
      const w = r.tiles[0].length;
      const exitY = r.tiles.findIndex(row => row[w - 1] !== '#');
      expect(exitY, `${r.id} east exit`).toBeGreaterThan(0);
      const spawn = r.entities.find(e => e.type === 'spawn');
      const [sx, sy] = spawn ? spawn.at : [1, r.tiles.findIndex(row => row[0] !== '#')];
      const from = { x: (r.origin[0] + sx) * TILE + 8, y: (r.origin[1] + sy) * TILE + 10 };
      const to = { x: (r.origin[0] + w - 2) * TILE + 8, y: (r.origin[1] + exitY) * TILE + 10 };
      expect(pf.find(from.x, from.y, to.x, to.y, 5, 60000), r.id).not.toBeNull();
    }
  });
});
