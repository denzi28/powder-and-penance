import Phaser from 'phaser';
import { FONT_URL, SPRITES, SPRITE_URLS } from '../data/assets';

/** Font atlas layout: see ASSETS.md ("Pixel font"). */
export const FONT = { cellW: 6, cellH: 8, charsPerRow: 16 };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    for (const [name, m] of Object.entries(SPRITES)) {
      this.load.spritesheet(name, SPRITE_URLS[m.image], { frameWidth: m.cell[0], frameHeight: m.cell[1] });
    }
    this.load.image('font', FONT_URL);
  }

  create() {
    const font = Phaser.GameObjects.RetroFont.Parse(this, {
      image: 'font',
      width: FONT.cellW,
      height: FONT.cellH,
      chars: Phaser.GameObjects.RetroFont.TEXT_SET1,
      charsPerRow: FONT.charsPerRow,
      'spacing.x': 0,
      'spacing.y': 0,
      'offset.x': 0,
      'offset.y': 0,
      lineSpacing: 1,
    });
    this.cache.bitmapFont.add('pixel', font);
    this.scene.start('title');
  }
}
