// Solid things standing on the floor: decor with `blocks` (low, or tall = also blocks sight), chests, and
// unbroken secret walls (part of the wall until smashed). Pure grid logic (no sprites), shared by the game
// and the level tests so both see the same walkable map.
import { DATA } from '../data/config';
import { Cell, type TileGrid } from './TileGrid';
import type { RoomData } from '../data/schemas';

/** @param brokenWall secret walls already broken ("wall:<room>#<index>"); tests pass none (all intact) */
export function markObstacles(grid: TileGrid, rooms: RoomData[], brokenWall: (uid: string) => boolean = () => false) {
  const mark = (tx: number, ty: number, tall: boolean) => {
    if (grid.get(tx, ty) === Cell.Floor) grid.set(tx, ty, tall ? Cell.Tall : Cell.Block);
  };
  for (const r of rooms)
    r.entities.forEach((en, i) => {
      const tx = r.origin[0] + en.at[0];
      const ty = r.origin[1] + en.at[1];
      if (en.type === 'item') mark(tx, ty, false); // chests
      if (en.type === 'prop' && DATA.props[String(en.kind)]?.secretWall) {
        grid.set(tx, ty, brokenWall(`${r.id}#${i}`) ? Cell.Floor : Cell.Wall);
        return;
      }
      if (en.type !== 'decor') return;
      const def = DATA.decor.decor[String(en.kind)];
      for (const [dx, dy] of def.blocks) mark(tx + (en.flip === true ? -dx : dx), ty + dy, def.tall);
    });
}
