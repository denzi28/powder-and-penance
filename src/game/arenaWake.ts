// When a boss arena wakes (kept free of Phaser so the level tests can check every arena).
import type { RoomData } from '../data/schemas';

/**
 * Does the player standing on tile (tx, ty) wake this arena? Inside its room, and at least 2 tiles clear of
 * every seal (world tiles). A seal turns its doorway into a wall, which also makes the floor tile above it
 * solid (the wall's cap). Anyone still that close could be shut into solid ground.
 */
export function arenaWakesAt(room: RoomData, seals: readonly { tx: number; ty: number }[], tx: number, ty: number): boolean {
  const [ox, oy] = room.origin;
  const inside = tx > ox && ty > oy && tx < ox + room.tiles[0].length - 1 && ty < oy + room.tiles.length - 1;
  return inside && seals.every(s => Math.max(Math.abs(s.tx - tx), Math.abs(s.ty - ty)) >= 2);
}
