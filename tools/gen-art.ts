// Placeholder art generator. Writes PNG sprite sheets + .anim.json manifests into assets/ following ASSETS.md.
//   npm run gen:art              -> only writes files that don't exist yet (never clobbers your replacement art)
//   npm run gen:art -- --force   -> regenerate everything
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPRITES = path.join(ROOT, 'assets/sprites');
const FONTS = path.join(ROOT, 'assets/fonts');
const FORCE = process.argv.includes('--force');

type RGBA = readonly [number, number, number, number];
const paletteHex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/palette.json'), 'utf8')) as Record<string, string>;
const P = Object.fromEntries(
  Object.entries(paletteHex).map(([k, h]) => [k, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).concat(255) as unknown as RGBA]),
) as Record<string, RGBA>;
const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

// ---------------------------------------------------------------- image helper
class Img {
  readonly px: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.px = new Uint8Array(w * h * 4);
  }
  set(x: number, y: number, c: RGBA | null) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (!c) this.px[i + 3] = 0;
    else this.px.set(c, i);
  }
  alpha(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[(y * this.w + x) * 4 + 3];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  hline(x: number, y: number, len: number, c: RGBA) {
    this.rect(x, y, len, 1, c);
  }
  vline(x: number, y: number, len: number, c: RGBA) {
    this.rect(x, y, 1, len, c);
  }
  /** Filled ellipse sampled at pixel centers. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA, test?: (x: number, y: number) => boolean) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!test || test(x, y))) this.set(x, y, c);
      }
  }
  disc(cx: number, cy: number, r: number, c: RGBA) {
    this.ellipse(cx, cy, r, r, c);
  }
  /** 1px outline around all opaque pixels — the main readability trick for tiny sprites. */
  outline(c: RGBA) {
    const src = Uint8Array.from(this.px);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : src[(y * this.w + x) * 4 + 3]);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (a(x, y) === 0 && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) this.set(x, y, c);
  }
  blit(src: Img, dx: number, dy: number, flipX = false) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.px[i + 3] === 0) continue;
        this.set(dx + (flipX ? src.w - 1 - x : x), dy + y, [src.px[i], src.px[i + 1], src.px[i + 2], src.px[i + 3]]);
      }
  }
  toBuffer() {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.px);
    return PNG.sync.write(png);
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let written = 0;
let skipped = 0;
function write(file: string, data: Buffer | string) {
  if (fs.existsSync(file) && !FORCE) {
    skipped++;
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  written++;
}
function sheet(name: string, img: Img, manifest: object) {
  write(path.join(SPRITES, `${name}.png`), img.toBuffer());
  write(path.join(SPRITES, `${name}.anim.json`), JSON.stringify({ image: `${name}.png`, ...manifest }, null, 2) + '\n');
}

// ---------------------------------------------------------------- player
type Dir5 = 'S' | 'SE' | 'E' | 'NE' | 'N';
const DIR5: Dir5[] = ['S', 'SE', 'E', 'NE', 'N'];
const CELL = 32;
const PIVOT: [number, number] = [16, 28];
/** Weapon hand position in cell pixels, per authored direction. */
const HAND: Record<Dir5, [number, number]> = { S: [20, 17], SE: [20, 16], E: [18, 16], NE: [19, 15], N: [19, 15] };

function drawTorso(c: Img, dir: Dir5, breath: number) {
  // Cloak
  c.rect(12, 13, 8, 1, P.teal2);
  c.rect(11, 14, 10, 8, P.teal2);
  c.vline(11, 14, 7, P.teal3);
  c.vline(20, 14, 8, P.teal1);
  c.hline(11, 21, 10, P.teal1);
  c.hline(11, 18, 10, P.dark2); // belt
  if (dir === 'S') {
    c.set(15, 18, P.flame1);
    c.vline(16, 19, 2, P.teal1);
  }
  if (dir === 'SE') c.set(16, 18, P.flame1);
  // Lantern on the off-hand hip
  if (dir === 'S') {
    c.rect(12, 19, 2, 2, P.flame2);
    c.set(12, 19, P.flame1);
  }
  if (dir === 'SE') {
    c.rect(13, 19, 2, 2, P.flame2);
    c.set(13, 19, P.flame1);
  }

  // Hood
  const hy = 5 + breath;
  c.rect(13, hy, 6, 1, P.teal1);
  c.rect(12, hy + 1, 8, 6, P.teal1);
  c.rect(13, hy + 7, 6, 1, P.teal1);
  c.hline(13, hy + 1, 4, P.teal2);
  c.set(12, hy + 2, P.teal2);
  const tipX = dir === 'S' || dir === 'N' ? 15 : dir === 'E' ? 13 : 14;
  c.rect(tipX, hy - 1, 2, 1, P.teal1);

  // Face opening with glowing eyes (the character's readable "front")
  switch (dir) {
    case 'S':
      c.rect(13, hy + 3, 6, 3, P.ink);
      c.set(14, hy + 4, P.flame2);
      c.set(17, hy + 4, P.flame2);
      break;
    case 'SE':
      c.rect(14, hy + 3, 5, 3, P.ink);
      c.set(15, hy + 4, P.flame2);
      c.set(18, hy + 4, P.flame2);
      break;
    case 'E':
      c.rect(16, hy + 3, 4, 3, P.ink);
      c.set(18, hy + 4, P.flame2);
      break;
    case 'NE':
      c.rect(18, hy + 3, 2, 2, P.dark1);
      break;
    case 'N':
      c.vline(16, hy + 1, 6, P.dark2);
      break;
  }

  // Glove (weapon hand) — must match HAND anchors
  const [hx, hy2] = HAND[dir];
  c.rect(hx - 1, hy2 - 1, 2, 2, P.wood2);
}

function drawLegs(c: Img, dir: 'S' | 'E' | 'N', f: number) {
  // f: -1 = idle, 0..3 = walk cycle
  const leg = (x: number, lift: number, color: RGBA, bootX: number) => {
    const bootY = 26 - lift;
    c.rect(x, 21, 2, bootY - 21, color);
    c.rect(bootX, bootY, 3, 2, dir === 'N' ? P.dark1 : P.wood1);
  };
  if (dir !== 'E') {
    const liftL = f === 1 ? 2 : 0;
    const liftR = f === 3 ? 2 : 0;
    leg(13, liftL, P.dark2, 12);
    leg(17, liftR, P.dark2, 17);
  } else {
    let back = 14;
    let front = 16;
    if (f === 1) [back, front] = [12, 18];
    if (f === 3) [back, front] = [17, 13];
    leg(back, f === 3 ? 1 : 0, P.dark1, back);
    leg(front, f === 1 ? 1 : 0, P.dark2, front);
  }
}

function drawRoll(c: Img, dir: Dir5, f: number) {
  const off = DIR5.indexOf(dir) * (Math.PI / 4);
  const ball = (cx: number, cy: number, rx: number, ry: number, a: number) => {
    c.ellipse(cx, cy, rx, ry, P.teal2);
    c.ellipse(cx, cy, rx, ry, P.teal1, (x, y) => x + 0.5 - cx + (y + 0.5 - cy) > rx * 0.55);
    c.disc(cx + Math.cos(a) * (rx - 2.5), cy + Math.sin(a) * (ry - 2.5), 2, P.teal1);
    c.set(cx - Math.cos(a) * (rx - 2), cy - Math.sin(a) * (ry - 2), P.flame2);
  };
  const crouch = (headY: number) => {
    c.rect(12, 26, 3, 2, P.wood1);
    c.rect(17, 26, 3, 2, P.wood1);
    c.ellipse(16, 22.5, 6, 5, P.teal2);
    c.hline(11, 25, 10, P.teal1);
    c.disc(16, headY, 3.5, P.teal1);
    if (dir === 'S' || dir === 'SE') {
      c.set(15, headY, P.flame2);
      c.set(17, headY, P.flame2);
    }
  };
  switch (f) {
    case 0:
      crouch(18);
      break;
    case 1:
    case 2:
    case 3:
      ball(16, 21, 6.5, 6.5, off + (f - 1) * (Math.PI / 2));
      break;
    case 4:
      ball(16, 22, 7.5, 5.5, off + 3 * (Math.PI / 2));
      break;
    case 5:
      crouch(17);
      break;
    case 6: {
      c.rect(13, 23, 2, 3, P.dark2);
      c.rect(17, 23, 2, 3, P.dark2);
      c.rect(12, 26, 3, 2, P.wood1);
      c.rect(17, 26, 3, 2, P.wood1);
      const t = new Img(CELL, CELL);
      drawTorso(t, dir, 0);
      c.blit(t, 0, 2);
      break;
    }
  }
}

function genPlayer() {
  const body = new Img(CELL * 8, CELL * 10);
  DIR5.forEach((d, row) => {
    for (let f = 0; f < 2; f++) {
      const c = new Img(CELL, CELL);
      drawTorso(c, d, f);
      c.outline(P.ink);
      body.blit(c, f * CELL, row * CELL);
    }
    for (let f = 0; f < 7; f++) {
      const c = new Img(CELL, CELL);
      drawRoll(c, d, f);
      c.outline(P.ink);
      body.blit(c, f * CELL, (5 + row) * CELL);
    }
  });
  const toPivot = ([x, y]: [number, number]) => [x - PIVOT[0], y - PIVOT[1]];
  sheet('player_body', body, {
    cell: [CELL, CELL],
    pivot: PIVOT,
    layer: 'torso',
    handAnchors: Object.fromEntries(DIR5.map(d => [d, toPivot(HAND[d])])),
    animations: {
      idle: { row: 0, dirs: DIR5, loop: true, frames: [{ ticks: 36 }, { ticks: 36 }] },
      roll: {
        row: 5,
        dirs: DIR5,
        loop: false,
        frames: [
          { ticks: 3, phase: 'roll' },
          { ticks: 4, phase: 'roll' },
          { ticks: 4, phase: 'roll' },
          { ticks: 4, phase: 'roll' },
          { ticks: 5, phase: 'roll' },
          { ticks: 5, phase: 'recover' },
          { ticks: 5, phase: 'recover' },
        ],
      },
    },
  });

  const LEG_DIRS = ['S', 'E', 'N'] as const;
  const legs = new Img(CELL * 4, CELL * 6);
  LEG_DIRS.forEach((d, row) => {
    const idle = new Img(CELL, CELL);
    drawLegs(idle, d, -1);
    idle.outline(P.ink);
    legs.blit(idle, 0, row * CELL);
    for (let f = 0; f < 4; f++) {
      const c = new Img(CELL, CELL);
      drawLegs(c, d, f);
      c.outline(P.ink);
      legs.blit(c, f * CELL, (3 + row) * CELL);
    }
  });
  sheet('player_legs', legs, {
    cell: [CELL, CELL],
    pivot: PIVOT,
    layer: 'legs',
    animations: {
      idle: { row: 0, dirs: LEG_DIRS, loop: true, frames: [{ ticks: 60 }] },
      walk: {
        row: 3,
        dirs: LEG_DIRS,
        loop: true,
        frames: [
          { ticks: 6, torsoDy: 0, events: ['footstep'] },
          { ticks: 6, torsoDy: -1 },
          { ticks: 6, torsoDy: 0, events: ['footstep'] },
          { ticks: 6, torsoDy: -1 },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------- weapons, shadow, fx, ui
function genWeapons() {
  const sword = new Img(22, 9);
  sword.set(1, 4, P.steel2); // pommel
  sword.hline(2, 4, 3, P.wood2); // grip
  sword.vline(5, 2, 5, P.steel1); // guard
  sword.rect(6, 3, 13, 2, P.steel2); // blade
  sword.hline(6, 4, 13, P.steel1);
  sword.set(19, 3, P.steel2); // tip
  sword.outline(P.ink);
  sheet('sword', sword, { cell: [22, 9], pivot: [3, 4], layer: 'weapon', points: { tip: [20, 3] } });

  const rev = new Img(15, 10);
  rev.rect(6, 2, 7, 2, P.steel1); // barrel
  rev.hline(6, 2, 7, P.steel2);
  rev.rect(4, 2, 3, 3, P.steel1); // cylinder
  rev.set(5, 3, P.dark2);
  rev.vline(3, 2, 3, P.dark2); // frame
  rev.set(3, 1, P.steel1); // hammer
  rev.rect(2, 4, 3, 2, P.wood2); // grip
  rev.rect(1, 6, 3, 2, P.wood1);
  rev.set(5, 5, P.dark2); // trigger
  rev.outline(P.ink);
  sheet('revolver', rev, { cell: [15, 10], pivot: [3, 5], layer: 'weapon', points: { muzzle: [13, 2] } });
}

function genMisc() {
  const shadow = new Img(12, 5);
  shadow.ellipse(6, 2.5, 6, 2.5, withAlpha(P.ink, 110));
  sheet('shadow', shadow, { cell: [12, 5], pivot: [6, 2], layer: 'fx' });

  const dust = new Img(40, 10);
  const radii = [1.5, 2.5, 3.5, 4.2];
  radii.forEach((r, f) => {
    const c = new Img(10, 10);
    const keep = (x: number, y: number) => (f < 2 ? true : f === 2 ? (x + y) % 2 === 0 : x % 2 === 0 && y % 2 === 0);
    c.ellipse(5, 6, r, r * 0.8, f === 0 ? P.wax1 : P.stone4, keep);
    if (f === 1) c.set(5, 6, P.wax1);
    dust.blit(c, f * 10, 0);
  });
  sheet('dust', dust, {
    cell: [10, 10],
    pivot: [5, 8],
    layer: 'fx',
    animations: {
      puff: { row: 0, dirs: ['S'], loop: false, frames: [{ ticks: 3 }, { ticks: 4 }, { ticks: 5 }, { ticks: 6 }] },
      step: { row: 0, dirs: ['S'], loop: false, frames: [{ ticks: 3, col: 0 }, { ticks: 4, col: 1 }, { ticks: 4, col: 3 }] },
    },
  });

  const cross = new Img(13, 13);
  for (const [x, y] of [[6, 1], [6, 2], [6, 3], [6, 9], [6, 10], [6, 11], [1, 6], [2, 6], [3, 6], [9, 6], [10, 6], [11, 6]])
    cross.set(x, y, P.wax2);
  cross.set(6, 6, P.flame2);
  cross.outline(P.ink);
  sheet('crosshair', cross, { cell: [13, 13], pivot: [6, 6], layer: 'ui' });
}

// ---------------------------------------------------------------- tiles
function genTiles() {
  const T = 16;
  const img = new Img(T * 8, T * 4);
  const at = (idx: number) => [(idx % 8) * T, Math.floor(idx / 8) * T] as const;

  const floor = (idx: number, v: number, moss: boolean) => {
    const [ox, oy] = at(idx);
    const r = rng(1000 + idx);
    img.rect(ox, oy, T, T, P.stone2);
    img.hline(ox, oy + 15, T, P.stone1);
    img.vline(ox + 15, oy, T, P.stone1);
    for (let i = 0; i < 8; i++) img.set(ox + Math.floor(r() * 15), oy + Math.floor(r() * 15), P.stone3);
    for (let i = 0; i < 6; i++) img.set(ox + Math.floor(r() * 15), oy + Math.floor(r() * 15), P.stone1);
    if (v === 2) img.vline(ox + 7, oy, 15, P.stone1);
    if (v === 3) for (const [x, y] of [[3, 4], [4, 5], [5, 5], [6, 6], [7, 8], [8, 9], [8, 10]]) img.set(ox + x, oy + y, P.dark2);
    if (moss) {
      for (let i = 0; i < 4; i++) {
        const cx = ox + 2 + r() * 12;
        const cy = oy + 2 + r() * 12;
        img.ellipse(cx, cy, 1.5 + r() * 2.5, 1 + r() * 2, P.moss1);
        img.set(cx, cy - 1, P.moss2);
      }
    }
  };
  for (let v = 0; v < 4; v++) floor(v, v, false);
  floor(4, 0, true);
  floor(5, 2, true);

  const front = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    img.rect(ox, oy, T, T, P.stone3);
    for (const y of [4, 9]) img.hline(ox, oy + y, T, P.stone1);
    for (const [x, y, h] of [[7, 0, 4], [15, 0, 4], [3, 5, 4], [11, 5, 4], [7, 10, 3], [15, 10, 3]]) img.vline(ox + x, oy + y, h, P.stone1);
    if (v === 1) {
      img.rect(ox + 4, oy + 5, 7, 4, P.stone2);
      img.rect(ox + 8, oy + 10, 7, 3, P.stone2);
    }
    img.hline(ox, oy, T, P.stone4);
    img.hline(ox, oy + 13, T, P.stone1);
    img.rect(ox, oy + 14, T, 2, P.dark2);
  };
  front(8, 0);
  front(9, 1);

  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(77 + mask);
    img.rect(ox, oy, T, T, P.dark1);
    for (let i = 0; i < 6; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), P.dark2);
    if (mask & 1) img.hline(ox, oy, T, P.stone3);
    if (mask & 2) img.vline(ox + 15, oy, T, P.stone3);
    if (mask & 4) {
      img.hline(ox, oy + 14, T, P.stone3);
      img.hline(ox, oy + 15, T, P.stone2);
    }
    if (mask & 8) img.vline(ox, oy, T, P.stone3);
  }

  sheet('tiles', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 0, 0, 0, 0, 1, 1, 2, 3],
      floor_moss: [4, 5],
      wall_front: [8, 8, 8, 9],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
    },
  });
}

// ---------------------------------------------------------------- font (original 5x7, ASCII 32..126, 16 per row)
const GLYPHS: Record<string, string> = {
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '"': '.#.#.|.#.#.|.....|.....|.....|.....|.....',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  $: '..#..|.####|#.#..|.###.|..#.#|####.|..#..',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
  "'": '..#..|..#..|.....|.....|.....|.....|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  ',': '.....|.....|.....|.....|..##.|..#..|.#...',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  ';': '.....|.##..|.##..|.....|.##..|..#..|.#...',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.###.',
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '[': '.###.|.#...|.#...|.#...|.#...|.#...|.###.',
  '\\': '#....|#....|.#...|..#..|...#.|....#|....#',
  ']': '.###.|...#.|...#.|...#.|...#.|...#.|.###.',
  '^': '..#..|.#.#.|#...#|.....|.....|.....|.....',
  _: '.....|.....|.....|.....|.....|.....|#####',
  '`': '.#...|..#..|.....|.....|.....|.....|.....',
  '{': '...#.|..#..|..#..|.#...|..#..|..#..|...#.',
  '|': '..#..|..#..|..#..|..#..|..#..|..#..|..#..',
  '}': '.#...|..#..|..#..|...#.|..#..|..#..|.#...',
  '~': '.....|.....|.#...|#.#.#|...#.|.....|.....',
};

function genFont() {
  const img = new Img(96, 48);
  for (let code = 32; code <= 126; code++) {
    const ch = String.fromCharCode(code);
    const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
    const i = code - 32;
    const ox = (i % 16) * 6;
    const oy = Math.floor(i / 16) * 8;
    g.split('|').forEach((row, y) => [...row].forEach((p, x) => p === '#' && img.set(ox + x, oy + y, P.white)));
  }
  write(path.join(FONTS, 'pixel5x7.png'), img.toBuffer());
}

genPlayer();
genWeapons();
genMisc();
genTiles();
genFont();
console.log(`gen-art: wrote ${written} file(s), skipped ${skipped} existing${skipped && !FORCE ? ' (use --force to overwrite)' : ''}`);
