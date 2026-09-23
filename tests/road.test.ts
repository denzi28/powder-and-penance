// Level integrity for the Penance Road: one connected ravine from the Wreck to the hub exit.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';
import { TILE } from '../src/world/TileGrid';
import { Pathfinder } from '../src/world/Pathfinder';

const rooms = Object.values(DATA.rooms).filter(r => r.area === 'road');
const grid = levelGrid(rooms);
const pf = new Pathfinder(() => grid);
const centre = (tx: number, ty: number) => ({ x: tx * TILE + 8, y: ty * TILE + 10 });

/** Nearest walkable tile to a room's centre. */
function roomCentre(id: string) {
  const r = DATA.rooms[id];
  const cx = r.origin[0] + Math.floor(r.tiles[0].length / 2);
  const cy = r.origin[1] + Math.floor(r.tiles.length / 2);
  for (let d = 0; d < 12; d++)
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++) if (!grid.isSolid(cx + dx, cy + dy)) return centre(cx + dx, cy + dy);
  throw new Error(`no floor in ${id}`);
}

describe('Penance Road', () => {
  const start = DATA.rooms[DATA.game.startRoom];
  const spawn = start.entities.find(e => e.type === 'spawn')!;
  const from = centre(start.origin[0] + spawn.at[0], start.origin[1] + spawn.at[1]);

  it('is the start of a new game, with 5 rooms', () => {
    expect(start.area).toBe('road');
    expect(rooms).toHaveLength(5);
  });

  it('every room is reachable from the start', () => {
    for (const r of rooms) {
      const to = roomCentre(r.id);
      expect(pf.find(from.x, from.y, to.x, to.y, 5, 60000), r.id).not.toBeNull();
    }
  });

  it('the hub exit at the top of the Hill of Candles is reachable', () => {
    const hill = DATA.rooms['road_05_hill_of_candles'];
    const exit = hill.entities.find(e => e.type === 'exit')!;
    const to = centre(hill.origin[0] + exit.at[0], hill.origin[1] + exit.at[1] + 1);
    expect(pf.find(from.x, from.y, to.x, to.y, 5, 60000)).not.toBeNull();
  });
});
