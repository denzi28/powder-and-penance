// The walkable map exactly as the game builds it: room tiles plus solid decor and chests.
// `secretWallsBroken`: count cracked walls as already smashed (they can be; reachability tests want that).
import { buildGrid } from '../src/world/TileGrid';
import { markObstacles } from '../src/world/Obstacles';
import type { RoomData } from '../src/data/schemas';

export function levelGrid(rooms: RoomData[], secretWallsBroken = false) {
  const g = buildGrid(rooms);
  markObstacles(g, rooms, () => secretWallsBroken);
  return g;
}
