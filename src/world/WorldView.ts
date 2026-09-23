import Phaser from 'phaser';
import { autotile, TILE, type TileGrid, type TileSet } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import { DEPTH } from '../render/depth';

export class WorldView {
  private map: Phaser.Tilemaps.Tilemap | null = null;
  private overhangs: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene, private lib: SpriteLib) {}

  /** @param tileset sprite sheet name of the area's tileset (data/areas.json) */
  build(grid: TileGrid, tileset: string) {
    this.destroy();
    const tiles = this.lib.manifest(tileset).tiles as unknown as TileSet;
    const { statics, overhang } = autotile(grid, tiles);

    const map = this.scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: grid.w, height: grid.h });
    const ts = map.addTilesetImage(tileset, tileset, TILE, TILE, 0, 0);
    if (!ts) throw new Error(`Failed to create tileset from assets/sprites/${tileset}.png`);
    const layer = map.createBlankLayer('static', ts, grid.ox * TILE, grid.oy * TILE);
    if (!layer) throw new Error('Failed to create tile layer');
    for (const t of statics) layer.putTileAt(t.index, t.tx - grid.ox, t.ty - grid.oy);
    layer.setDepth(DEPTH.floor);
    this.map = map;

    for (const t of overhang) {
      const img = this.scene.add.image(t.tx * TILE, t.ty * TILE, tileset, t.index).setOrigin(0, 0);
      img.setDepth(DEPTH.actor((t.ty + 1) * TILE));
      this.overhangs.push(img);
    }
  }

  destroy() {
    this.map?.destroy();
    this.map = null;
    this.overhangs.forEach(o => o.destroy());
    this.overhangs = [];
  }
}
