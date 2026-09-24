// Integer scaling in *physical* pixels. On a 125%/150% Windows display, CSS-pixel integer scaling would
// still land on fractional device pixels, so we pick an integer device-pixel scale and convert back.
import Phaser from 'phaser';
import { FINE } from './FineText';

export function installPixelScaler(game: Phaser.Game, w: number, h: number) {
  const apply = () => {
    const dpr = window.devicePixelRatio || 1;
    const physW = Math.floor(window.innerWidth * dpr);
    const physH = Math.floor(window.innerHeight * dpr);
    const z = Math.max(1, Math.floor(Math.min(physW / w, physH / h)));
    game.scale.setZoom(z / dpr);
    const c = game.canvas;
    c.style.position = 'absolute';
    c.style.left = `${Math.floor((physW - w * z) / 2) / dpr}px`;
    c.style.top = `${Math.floor((physH - h * z) / 2) / dpr}px`;
    game.scale.updateBounds();
    FINE.place(c, w, h, z, dpr);
  };
  if (game.isBooted) apply();
  else game.events.once(Phaser.Core.Events.READY, apply);
  window.addEventListener('resize', apply);
}
