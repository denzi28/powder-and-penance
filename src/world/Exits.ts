// Area exits: tiles (usually a gap in a room's outer wall) that take you to another area when you walk into
// them. Entity: { "type": "exit", "id", "at": [x, y], "size": [w, h] (tiles, default 1x1),
//                 "to": { "area", "spawn" } } where "spawn" names a spawn entity in the target area.
import { TILE } from './TileGrid';
import type { RoomData } from '../data/schemas';

export interface Exit {
  id: string;
  /** Tile rectangle, inclusive-exclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  to: { area: string; spawn: string };
}

export class Exits {
  list: Exit[] = [];
  /** After arriving, an exit only works once you have stepped off every exit (no bouncing straight back). */
  private armed = false;

  build(rooms: RoomData[]) {
    this.list = [];
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'exit' || !en.id) continue;
        const [w, h] = (en.size as [number, number] | undefined) ?? [1, 1];
        const x0 = r.origin[0] + en.at[0];
        const y0 = r.origin[1] + en.at[1];
        this.list.push({ id: en.id, x0, y0, x1: x0 + w, y1: y0 + h, to: en.to as Exit['to'] });
      }
    this.armed = false;
  }

  /** Ignore exits until the player has stepped off them (after arriving, or after a refused exit). */
  disarm() {
    this.armed = false;
  }

  /** The exit the player just walked into, if any. */
  check(x: number, y: number): Exit | null {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const hit = this.list.find(e => tx >= e.x0 && tx < e.x1 && ty >= e.y0 && ty < e.y1) ?? null;
    if (!hit) {
      this.armed = true;
      return null;
    }
    return this.armed ? hit : null;
  }
}

/** World position of a named spawn point among these rooms (feet position), or null. */
export function findSpawn(rooms: RoomData[], id: string): { x: number; y: number } | null {
  for (const r of rooms)
    for (const en of r.entities)
      if (en.type === 'spawn' && en.id === id)
        return { x: (r.origin[0] + en.at[0]) * TILE + TILE / 2, y: (r.origin[1] + en.at[1]) * TILE + TILE - 2 };
  return null;
}
