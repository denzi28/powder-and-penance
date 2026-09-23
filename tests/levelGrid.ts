// The walkable map exactly as the game builds it: room tiles plus solid decor and chests.
import { buildGrid } from '../src/world/TileGrid';
import { markObstacles } from '../src/world/Obstacles';
import type { RoomData } from '../src/data/schemas';

export function levelGrid(rooms: RoomData[]) {
  const g = buildGrid(rooms);
  markObstacles(g, rooms);
  return g;
}
