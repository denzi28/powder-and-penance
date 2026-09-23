// Area connections: every exit lands on a real spawn point that is open floor and not itself inside an exit,
// and within each area every exit can be walked to from every spawn point (doors counted as open).
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';
import { TILE } from '../src/world/TileGrid';
import { Pathfinder } from '../src/world/Pathfinder';
import { Exits, findSpawn } from '../src/world/Exits';

const areas = [...new Set(Object.values(DATA.rooms).map(r => r.area))];
const roomsOf = (area: string) => Object.values(DATA.rooms).filter(r => r.area === area);

describe('area exits', () => {
  for (const area of areas) {
    const rooms = roomsOf(area);
    const exits = new Exits();
    exits.build(rooms);
    if (!exits.list.length) continue;

    it(`${area}: every exit lands on an open spawn point outside any exit`, () => {
      for (const e of exits.list) {
        const target = roomsOf(e.to.area);
        if (!target.length) continue; // area not built yet: the exit says so in game
        const s = findSpawn(target, e.to.spawn);
        expect(s, `${e.id} -> ${e.to.area}/${e.to.spawn}`).not.toBeNull();
        const grid = levelGrid(target);
        const tx = Math.floor(s!.x / TILE);
        const ty = Math.floor(s!.y / TILE);
        expect(grid.isSolid(tx, ty), `${e.id}: spawn ${e.to.spawn} is solid`).toBe(false);
        const there = new Exits();
        there.build(target);
        expect(there.list.some(x => tx >= x.x0 && tx < x.x1 && ty >= x.y0 && ty < x.y1), `${e.id}: lands inside an exit`).toBe(false);
      }
    });

    it(`${area}: every exit is reachable from every spawn point`, () => {
      const grid = levelGrid(rooms);
      const pf = new Pathfinder(() => grid);
      const spawns = rooms.flatMap(r => r.entities.filter(en => en.type === 'spawn').map(en => findSpawn([r], en.id!)!));
      for (const s of spawns)
        for (const e of exits.list) {
          // Aim for the exit's first tile; the pathfinder needs an open goal, which exit tiles are.
          const gx = e.x0 * TILE + TILE / 2;
          const gy = e.y0 * TILE + TILE / 2;
          expect(pf.find(s.x, s.y, gx, gy, 5, 80000), `${area}: ${e.id} from (${s.x},${s.y})`).not.toBeNull();
        }
    });
  }
});
