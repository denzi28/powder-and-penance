import Phaser from 'phaser';
import { FONT_URL, SMALL_FONT_URL, SPRITES, SPRITE_URLS } from '../data/assets';

/** Font atlas layout: see ASSETS.md ("Pixel font"). */
export const FONT = { cellW: 6, cellH: 8, charsPerRow: 16 };
/** The small 3x5 font ('pixel_small') used for item descriptions. */
export const SMALL_FONT = { cellW: 4, cellH: 6, charsPerRow: 16 };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    for (const [name, m] of Object.entries(SPRITES)) {
      this.load.spritesheet(name, SPRITE_URLS[m.image], { frameWidth: m.cell[0], frameHeight: m.cell[1] });
    }
    this.load.image('font', FONT_URL);
    this.load.image('font_small', SMALL_FONT_URL);
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
    const small = Phaser.GameObjects.RetroFont.Parse(this, {
      image: 'font_small',
      width: SMALL_FONT.cellW,
      height: SMALL_FONT.cellH,
      chars: Phaser.GameObjects.RetroFont.TEXT_SET1,
      charsPerRow: SMALL_FONT.charsPerRow,
      'spacing.x': 0,
      'spacing.y': 0,
      'offset.x': 0,
      'offset.y': 0,
      lineSpacing: 0, // the 6 px cell already leaves a blank row under the 5 px letters
    });
    this.cache.bitmapFont.add('pixel_small', small);
    this.scene.start('title');
  }
}
