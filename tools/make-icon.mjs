// The desktop app's icon (build/icon.png, 512x512): the game's lit candle icon, scaled up pixel-crisp on a dark tile.
// Run: node tools/make-icon.mjs
import fs from 'node:fs';
import { PNG } from 'pngjs';
const icons = PNG.sync.read(fs.readFileSync('assets/sprites/icons.png'));
const CELL = 16;
const INDEX = 61; // the lit beeswax candle
const S = 512;
const out = new PNG({ width: S, height: S });
const scale = 28;
const off = Math.round((S - CELL * scale) / 2);
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const j = (y * S + x) * 4;
    const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const bg = [Math.round(38 - 20 * d), Math.round(22 - 12 * d), Math.round(26 - 14 * d)]; // a warm dark vignette
    let c = [...bg, 255];
    const sx = Math.floor((x - off) / scale);
    const sy = Math.floor((y - off) / scale);
    if (sx >= 0 && sy >= 0 && sx < CELL && sy < CELL) {
      const i = (sy * icons.width + INDEX * CELL + sx) * 4;
      if (icons.data[i + 3] > 0) c = [icons.data[i], icons.data[i + 1], icons.data[i + 2], 255];
    }
    out.data.set(c, j);
  }
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', PNG.sync.write(out));
console.log('wrote build/icon.png');
