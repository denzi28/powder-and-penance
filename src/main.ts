import Phaser from 'phaser';
import { DATA, DATA_ERROR } from './data/config';
import { ASSET_ERRORS, SPRITES } from './data/assets';
import { showFatal } from './core/fatal';
import { installPixelScaler } from './render/PixelScaler';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

const errors = [DATA_ERROR, ...ASSET_ERRORS].filter(Boolean);
if (!DATA_ERROR) {
  const need = (sprite: string, where: string) => {
    if (!SPRITES[sprite]) errors.push(`${where}: sprite "${sprite}" has no assets/sprites/${sprite}.anim.json`);
  };
  for (const w of Object.values(DATA.weapons)) {
    need(w.view.sprite, `data/weapons/${w.id}.json`);
    if (w.ranged) need(w.ranged.projectile.sprite, `data/weapons/${w.id}.json`);
  }
  for (const s of Object.values(DATA.shields)) need(s.sprite, `data/shields/${s.id}.json`);
  for (const pr of Object.values(DATA.props)) need(pr.sprite, `data/props/${pr.id}.json`);
  for (const e of Object.values(DATA.enemies))
    for (const m of e.moves) for (const s of m.strikes) if (s.projectile) need(s.projectile.sprite, `data/enemies/${e.id}.json`);
  for (const e of Object.values(DATA.enemies)) {
    need(e.sprite, `data/enemies/${e.id}.json`);
    if (e.weaponSprite) need(e.weaponSprite, `data/enemies/${e.id}.json`);
  }
}
if (errors.length) {
  showFatal(errors.join('\n\n'));
} else {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: DATA.game.width,
    height: DATA.game.height,
    backgroundColor: '#000000',
    pixelArt: true,
    roundPixels: true,
    banner: false,
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
    fps: { smoothStep: false },
    scene: [BootScene, TitleScene, GameScene, UIScene],
  });
  installPixelScaler(game, DATA.game.width, DATA.game.height);
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game; // console debugging
}
