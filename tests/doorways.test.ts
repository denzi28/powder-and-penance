// Every doorway leads somewhere you can walk: nothing solid stands on the tile just inside it, and no chest or
// prop two tiles in, where the player standing in the doorway is drawn over it and can't see what's in the way.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';

describe('doorways', () => {
  for (const r of Object.values(DATA.rooms)) {
    it(`${r.id}: the way in through each doorway is clear`, () => {
      const g = levelGrid([r], true);
      const h = r.tiles.length;
      const w = r.tiles[0].length;
      const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !g.isSolid(r.origin[0] + x, r.origin[1] + y);
      // chests and breakable props: things you can't see past when you're standing in the doorway
      const pickups = new Set(r.entities.filter(e => e.type === 'item' || e.type === 'prop').map(e => `${e.at[0]},${e.at[1]}`));
      const blocked: string[] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!(x === 0 || y === 0 || x === w - 1 || y === h - 1) || !open(x, y)) continue;
          const [dx, dy] = x === 0 ? [1, 0] : x === w - 1 ? [-1, 0] : y === 0 ? [0, 1] : [0, -1];
          if (!open(x + dx, y + dy) && r.tiles[y + dy]?.[x + dx] !== '#') blocked.push(`${x + dx},${y + dy} (inside ${x},${y})`);
          if (pickups.has(`${x + dx * 2},${y + dy * 2}`)) blocked.push(`${x + dx * 2},${y + dy * 2} (a chest or prop two in from ${x},${y})`);
        }
      expect(blocked).toEqual([]);
    });
  }
});
