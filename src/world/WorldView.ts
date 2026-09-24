import Phaser from 'phaser';
import { autotile, TILE, type TileGrid, type TileSet } from './TileGrid';
import type { SpriteLib } from '../anim/SpriteLib';
import { DEPTH } from '../render/depth';
import { hash2 } from '../core/math';

export class WorldView {
  private map: Phaser.Tilemaps.Tilemap | null = null;
  private overhangs: Phaser.GameObjects.Image[] = [];
  private lights: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene, private lib: SpriteLib) {}

  /** @param tileset sprite sheet name of the area's tileset (data/areas.json) */
  build(grid: TileGrid, tileset: string) {
    this.destroy();
    const tiles = this.lib.manifest(tileset).tiles as unknown as TileSet;
    const { statics, overhang, shade, fringe } = autotile(grid, tiles);

    const map = this.scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: grid.w, height: grid.h });
    const ts = map.addTilesetImage(tileset, tileset, TILE, TILE, 0, 0);
    if (!ts) throw new Error(`Failed to create tileset from assets/sprites/${tileset}.png`);
    const layer = map.createBlankLayer('static', ts, grid.ox * TILE, grid.oy * TILE);
    if (!layer) throw new Error('Failed to create tile layer');
    for (const t of statics) layer.putTileAt(t.index, t.tx - grid.ox, t.ty - grid.oy);
    layer.setDepth(DEPTH.floor);
    // Overlays on the floor: soft edges between floor kinds, then wall shadows over everything.
    const overlay = (name: string, placed: typeof statics, depth: number) => {
      if (!placed.length) return;
      const l = map.createBlankLayer(name, ts, grid.ox * TILE, grid.oy * TILE);
      if (!l) throw new Error(`Failed to create ${name} layer`);
      for (const t of placed) l.putTileAt(t.index, t.tx - grid.ox, t.ty - grid.oy);
      l.setDepth(depth);
    };
    overlay('fringe', fringe, DEPTH.floor + 0.25);
    overlay('shade', shade, DEPTH.floor + 0.5);
    this.map = map;

    // Tiles listed under `glow` (candle niches) cast a flickering warm light over the wall and floor.
    const glow = new Set(tiles.glow ?? []);
    if (glow.size && this.scene.textures.exists('light_glow'))
      for (const t of statics) {
        if (!glow.has(t.index)) continue;
        const light = this.scene.add
          .image(t.tx * TILE + TILE / 2, t.ty * TILE + 7, 'light_glow')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.floor + 1);
        const h = hash2(t.tx, t.ty);
        this.scene.tweens.add({ targets: light, alpha: 0.7, duration: 110 + (h % 90), yoyo: true, repeat: -1, delay: h % 200 });
        this.lights.push(light);
      }

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
    this.lights.forEach(l => l.destroy());
    this.lights = [];
  }
}
