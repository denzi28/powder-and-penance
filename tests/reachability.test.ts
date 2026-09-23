// Everything the player needs to reach can be walked to, on the map exactly as the game builds it (solid
// decor and chests included; doors counted as open): chests, placed weapons, shrines, spawns and exits.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';
import { TILE } from '../src/world/TileGrid';
import { Pathfinder } from '../src/world/Pathfinder';

const areas = [...new Set(Object.values(DATA.rooms).map(r => r.area))];

describe('reachability', () => {
  for (const area of areas) {
    const rooms = Object.values(DATA.rooms).filter(r => r.area === area);
    const start = rooms.flatMap(r => r.entities.filter(e => e.type === 'spawn').map(e => ({ r, e })))[0];
    if (!start) continue;

    it(`${area}: chests, weapons, shrines, spawns and exits can all be walked to`, () => {
      const grid = levelGrid(rooms);
      const pf = new Pathfinder(() => grid);
      const sx = (start.r.origin[0] + start.e.at[0]) * TILE + 8;
      const sy = (start.r.origin[1] + start.e.at[1]) * TILE + 10;
      /** Reachable if the tile itself, or (for solid things like chests) any tile next to it, can be reached. */
      const reach = (tx: number, ty: number) =>
        [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]].some(
          ([dx, dy]) => !grid.isSolid(tx + dx, ty + dy) && pf.find(sx, sy, (tx + dx) * TILE + 8, (ty + dy) * TILE + 8, 5, 80000) !== null,
        );
      const bad: string[] = [];
      for (const r of rooms)
        for (const e of r.entities) {
          if (!['item', 'weapon', 'shrine', 'spawn', 'exit'].includes(e.type)) continue;
          if (!reach(r.origin[0] + e.at[0], r.origin[1] + e.at[1])) bad.push(`${r.id}: ${e.type} ${e.id ?? ''} at [${e.at}]`);
        }
      expect(bad).toEqual([]);
    });
  }
});
