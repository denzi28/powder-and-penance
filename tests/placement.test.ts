// Every placed entity (enemy, decor, prop, item, weapon, spawn, shrine) stands on open ground: not in a wall
// and not on the floor strip hidden under a wall's top cap (which is solid and drawn over whatever is there).
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { buildGrid, TILE } from '../src/world/TileGrid';

/** Entities that sit in wall gaps or are markers, not things standing on the floor. */
const SKIP = new Set(['door', 'exit', 'cutscene', 'npc', 'weapon_rack', 'shield_rack']);

describe('entity placement', () => {
  const areas = [...new Set(Object.values(DATA.rooms).map(r => r.area))];
  for (const area of areas)
    it(`area "${area}": nothing stands in a wall or under a wall cap`, () => {
      const rooms = Object.values(DATA.rooms).filter(r => r.area === area);
      const grid = buildGrid(rooms);
      const bad: string[] = [];
      for (const r of rooms)
        for (const en of r.entities) {
          if (SKIP.has(en.type)) continue;
          const tx = r.origin[0] + en.at[0];
          const ty = r.origin[1] + en.at[1];
          if (grid.isSolid(tx, ty)) bad.push(`${r.id}: ${en.type} ${String(en.kind ?? en.id ?? '')} at [${en.at}]`);
          if (en.type === 'shrine') {
            // You respawn here after death or a rest: it must be open floor.
            const [ox, oy] = DATA.shrine.spawnOffset;
            const sx = Math.floor((tx * TILE + TILE / 2 + ox) / TILE);
            const sy = Math.floor((ty * TILE + TILE - 2 + oy) / TILE);
            if (grid.isSolid(sx, sy)) bad.push(`${r.id}: shrine ${en.id} respawn point is inside a wall`);
          }
        }
      expect(bad).toEqual([]);
    });
});
