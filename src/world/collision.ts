// Axis-separated box-vs-tile collision. The box's bottom edge sits on the actor's feet (pivot):
// x in [px - hw, px + hw], y in [py - h, py].
import { TILE, type TileGrid } from './TileGrid';

const EPS = 1e-4;

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

export function moveBox(g: TileGrid, x: number, y: number, hw: number, h: number, dx: number, dy: number): MoveResult {
  let hitX = false;
  let hitY = false;

  if (dx !== 0) {
    let nx = x + dx;
    const top = Math.floor((y - h) / TILE);
    const bot = Math.floor((y - EPS) / TILE);
    const col = dx > 0 ? Math.floor((nx + hw - EPS) / TILE) : Math.floor((nx - hw) / TILE);
    for (let ty = top; ty <= bot; ty++) {
      if (g.isSolid(col, ty)) {
        nx = dx > 0 ? col * TILE - hw : (col + 1) * TILE + hw;
        hitX = true;
        break;
      }
    }
    x = nx;
  }

  if (dy !== 0) {
    let ny = y + dy;
    const left = Math.floor((x - hw) / TILE);
    const right = Math.floor((x + hw - EPS) / TILE);
    const row = dy > 0 ? Math.floor((ny - EPS) / TILE) : Math.floor((ny - h) / TILE);
    for (let tx = left; tx <= right; tx++) {
      if (g.isSolid(tx, row)) {
        ny = dy > 0 ? row * TILE : (row + 1) * TILE + h;
        hitY = true;
        break;
      }
    }
    y = ny;
  }

  return { x, y, hitX, hitY };
}
