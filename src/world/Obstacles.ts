// Solid things standing on the floor: decor with `blocks` (low, or tall = also blocks sight) and chests.
// Pure grid logic (no sprites), shared by the game and the level tests so both see the same walkable map.
import { DATA } from '../data/config';
import { Cell, type TileGrid } from './TileGrid';
import type { RoomData } from '../data/schemas';

export function markObstacles(grid: TileGrid, rooms: RoomData[]) {
  const mark = (tx: number, ty: number, tall: boolean) => {
    if (grid.get(tx, ty) === Cell.Floor) grid.set(tx, ty, tall ? Cell.Tall : Cell.Block);
  };
  for (const r of rooms)
    for (const en of r.entities) {
      const tx = r.origin[0] + en.at[0];
      const ty = r.origin[1] + en.at[1];
      if (en.type === 'item') mark(tx, ty, false); // chests
      if (en.type !== 'decor') continue;
      const def = DATA.decor.decor[String(en.kind)];
      for (const [dx, dy] of def.blocks) mark(tx + (en.flip === true ? -dx : dx), ty + dy, def.tall);
    }
}
