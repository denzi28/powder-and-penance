// Placeholder art generator. Writes PNG sprite sheets + .anim.json manifests into assets/ following ASSETS.md.
//   npm run gen:art              -> only writes files that don't exist yet (never clobbers your replacement art)
//   npm run gen:art -- --force   -> regenerate everything
//   npm run gen:art -- --only=tiles,player_body   -> regenerate just these sheets
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { PORTRAIT, renderPortraits } from './portraits';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPRITES = path.join(ROOT, 'assets/sprites');
const FONTS = path.join(ROOT, 'assets/fonts');
const FORCE = process.argv.includes('--force');
/** --only a,b: write just these sheets (implies --force for them). */
const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');

type RGBA = readonly [number, number, number, number];
const paletteHex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/palette.json'), 'utf8')) as Record<string, string>;
const P = Object.fromEntries(
  Object.entries(paletteHex).map(([k, h]) => [k, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).concat(255) as unknown as RGBA]),
) as Record<string, RGBA>;
const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];
const hex = (h: string): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
/** Blend two colours (t = 0 gives a, 1 gives b). */
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)).concat(255) as unknown as RGBA;

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
  if (ONLY) {
    if (!ONLY.includes(path.basename(file).replace(/\.(anim\.json|png)$/, ''))) return;
  } else if (fs.existsSync(file) && !FORCE) {
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

// ---------------------------------------------------------------- phased attack timing
// Relative frame weights inside each phase; the game stretches each phase to the strike's data ticks.
/** Player swing/thrust: 2 anticipation, 2 strike, 2 follow-through frames. */
const phased6 = () => [
  { ticks: 1, phase: 'windup' },
  { ticks: 2, phase: 'windup' },
  { ticks: 1, phase: 'active' },
  { ticks: 1, phase: 'active' },
  { ticks: 1, phase: 'recovery' },
  { ticks: 2, phase: 'recovery' },
];
/** Enemy attacks: 3 anticipation frames (the last one, the held "tense" pose, is longest), 2 strike, 2 recovery. */
const phased7 = () => [
  { ticks: 1, phase: 'windup' },
  { ticks: 2, phase: 'windup' },
  { ticks: 2, phase: 'windup' },
  { ticks: 1, phase: 'active' },
  { ticks: 1, phase: 'active' },
  { ticks: 2, phase: 'recovery' },
  { ticks: 1, phase: 'recovery' },
];

// ---------------------------------------------------------------- player
type Dir5 = 'S' | 'SE' | 'E' | 'NE' | 'N';
const DIR5: Dir5[] = ['S', 'SE', 'E', 'NE', 'N'];
const CELL = 32;
const PIVOT: [number, number] = [16, 28];
/** Weapon hand position in cell pixels, per authored direction. */
const HAND: Record<Dir5, [number, number]> = { S: [20, 17], SE: [20, 16], E: [18, 16], NE: [19, 15], N: [19, 15] };

type TorsoPose = 'idle' | 'windup' | 'windup2' | 'active' | 'follow' | 'flinch' | 'flinch2';

/** The penitent's cloth and leather ramps (light from the top left). */
const CLOAK = {
  c0: hex('#10262a'),
  c1: P.teal1,
  c2: P.teal2,
  c3: P.teal3,
  rim: hex('#7dbfa6'),
  l0: hex('#3b271f'),
  l1: P.wood1,
  l2: P.wood2,
  brass: hex('#c89a45'),
};

function drawTorso(c: Img, dir: Dir5, breath: number, pose: TorsoPose = 'idle') {
  if (pose === 'windup' || pose === 'windup2') breath = 1;
  if (pose === 'active' || pose === 'flinch' || pose === 'flinch2') breath = -1;
  const K = CLOAK;
  const back = dir === 'N' || dir === 'NE';
  const flare = pose === 'active' ? 1 : 0;

  // Cloak body: dark cloth under the mantle, flaring toward a ragged hem
  for (let y = 15; y <= 22; y++) {
    const spread = y >= 21 ? 1 + flare : y >= 19 ? flare : 0;
    c.hline(11 - spread, y, 10 + spread * 2, K.c1);
    c.set(11 - spread, y, K.c2); // lit left edge
    c.set(20 + spread, y, K.c0); // shaded right edge
  }
  // folds: a crease and the light catching the cloth beside it
  for (const fx of back ? [13, 16, 19] : [14, 18]) {
    c.vline(fx, 18, 5, K.c0);
    c.vline(fx - 1, 19, 3, K.c2);
  }
  // ragged hem: bite a few pixels out of the bottom row
  for (const x of [12, 15, 19]) c.set(x + (flare ? 1 : 0), 22, null);
  if (pose === 'follow') {
    // follow-through: the hem swirls out to one side
    c.hline(17, 23, 5, K.c1);
    c.set(22, 22, K.c0);
    c.set(21, 21, K.c1);
  }
  if (pose === 'flinch2') c.hline(9, 22, 4, K.c1); // cloak snaps back

  // Mantle: a short shoulder cape over the cloak, wider at the shoulders
  const wide = pose === 'windup' || pose === 'windup2' ? 1 : 0;
  const mantle: [number, number, number][] = [
    [12, 12, 8],
    [11, 13, 10],
    [10 - wide, 14, 12 + wide * 2],
    [10 - wide, 15, 12 + wide * 2],
    [11, 16, 10],
  ];
  for (const [x, y, w] of mantle) {
    c.hline(x, y, w, K.c2);
    c.set(x, y, K.c3);
    c.set(x + 1, y, K.c3);
    c.set(x + w - 1, y, K.c1);
    c.set(x + w - 2, y, mix(K.c2, K.c1, 0.5));
  }
  c.set(11, 13, K.rim);
  c.set(10 - wide, 14, K.rim);
  c.hline(11, 16, 10, K.c1);
  for (let x = 11; x <= 20; x += 2) c.set(x, 17, K.c0); // scalloped lower edge, shadowed on the cloak below
  if (pose === 'windup2') {
    // coiled deeper: shoulders hunch up, hem pulls in
    c.vline(9, 15, 3, K.c2);
    c.vline(22, 15, 3, K.c1);
    c.hline(12, 22, 8, K.c0);
  }
  // Belt, buckle, bandolier of powder charges, lantern on the off hip
  c.hline(11, 18, 10, K.l0);
  c.hline(12, 18, 8, K.l1);
  if (!back) {
    const bx = dir === 'S' ? 15 : dir === 'SE' ? 16 : 18;
    c.rect(bx, 18, 2, 1, K.brass);
    if (dir !== 'E') {
      // bandolier from the far shoulder down to the hip, three charges in it
      line(c, dir === 'S' ? 13 : 14, 13, 19, 18, K.l1);
      line(c, dir === 'S' ? 14 : 15, 13, 19, 17, K.l0);
      for (const [x, y] of dir === 'S' ? [[14, 13], [16, 15]] : [[15, 13], [17, 15]]) c.set(x, y, K.brass);
    }
  } else {
    line(c, 13, 18, 19, 13, K.l0); // bandolier strap across the back
  }
  if (dir === 'S' || dir === 'SE') {
    const lx = dir === 'S' ? 11 : 12;
    c.set(lx + 1, 18, K.l0); // hook
    c.rect(lx, 19, 3, 3, K.l0); // frame
    c.set(lx + 1, 20, P.flame2);
    c.set(lx + 1, 19, P.flame1);
    c.set(lx + 1, 21, P.ember);
    c.set(lx + 3, 20, mix(K.c1, P.flame1, 0.45)); // light spilling on the cloak
    c.set(lx + 3, 21, mix(K.c1, P.flame1, 0.25));
  }

  if (back) {
    // stitched flame on the back of the mantle
    const sx = dir === 'N' ? 15 : 14;
    c.set(sx + 1, 12, P.flame1);
    c.rect(sx, 13, 2, 2, P.ember);
    c.set(sx + 1, 13, P.flame1);
    c.set(sx, 15, mix(P.ember, K.c2, 0.4));
    c.set(sx + 1, 15, mix(P.ember, K.c2, 0.4));
  }

  // Hood: tall and pointed, the penitent's hood
  const hy = 5 + breath;
  const tipX = dir === 'S' || dir === 'N' ? 15 : dir === 'E' ? 13 : 14;
  c.set(tipX, hy - 3, K.c2);
  c.rect(tipX, hy - 2, 2, 1, K.c2);
  c.rect(tipX - 1, hy - 1, 4, 1, K.c2);
  c.set(tipX - 1, hy - 1, K.c3);
  c.set(tipX, hy - 3, K.rim);
  c.rect(13, hy, 6, 1, K.c2);
  c.rect(12, hy + 1, 8, 6, K.c2);
  c.rect(13, hy + 7, 6, 1, K.c1);
  c.vline(12, hy + 1, 5, K.c3); // lit side
  c.hline(13, hy, 3, K.c3);
  c.set(12, hy + 1, K.rim);
  c.set(13, hy, K.rim);
  c.vline(19, hy + 1, 6, K.c1); // shaded side
  c.set(18, hy, K.c1);
  c.hline(13, hy + 8, 6, mix(K.c2, K.c0, 0.6)); // the hood's shadow on the mantle
  c.set(12, hy + 7, K.c1);
  c.set(19, hy + 7, K.c0);

  // Face: a dark opening with two ember eyes, the character's readable "front"
  const eye = pose === 'flinch' || pose === 'flinch2' ? P.ember : P.flame2;
  const glow = mix(P.ink, P.flame1, 0.3);
  switch (dir) {
    case 'S':
      c.rect(13, hy + 3, 6, 3, P.ink);
      c.hline(14, hy + 2, 4, K.c0);
      c.set(13, hy + 3, K.c0);
      c.set(18, hy + 3, K.c0);
      c.set(14, hy + 4, eye);
      c.set(17, hy + 4, eye);
      c.set(14, hy + 5, glow);
      c.set(17, hy + 5, glow);
      break;
    case 'SE':
      c.rect(14, hy + 3, 5, 3, P.ink);
      c.hline(15, hy + 2, 4, K.c0);
      c.set(14, hy + 3, K.c0);
      c.set(15, hy + 4, eye);
      c.set(18, hy + 4, eye);
      c.set(15, hy + 5, glow);
      break;
    case 'E':
      c.rect(16, hy + 3, 4, 3, P.ink);
      c.hline(16, hy + 2, 3, K.c0);
      c.set(16, hy + 3, K.c0);
      c.set(18, hy + 4, eye);
      c.set(18, hy + 5, glow);
      c.vline(15, hy + 2, 5, K.c1); // the hood's rim in profile
      break;
    case 'NE':
      c.rect(18, hy + 3, 2, 2, P.dark1);
      c.vline(15, hy + 1, 6, K.c1);
      break;
    case 'N':
      c.vline(16, hy + 1, 6, K.c1); // seam
      c.vline(17, hy + 2, 4, mix(K.c2, K.c1, 0.5));
      break;
  }

  // Glove (weapon hand) — must match HAND anchors
  const [hx, hy2] = HAND[dir];
  c.rect(hx - 1, hy2 - 1, 2, 2, K.l2);
  c.set(hx, hy2, K.l1);
}

function drawLegs(c: Img, dir: 'S' | 'E' | 'N', f: number) {
  // f: -1 = idle, 0..3 = walk cycle
  const K = CLOAK;
  const leg = (x: number, lift: number, cloth: RGBA, bootX: number, far: boolean) => {
    const bootY = 25 - lift;
    c.rect(x, 21, 2, bootY - 21, cloth);
    c.set(x, 21, mix(cloth, P.stone1, 0.4));
    c.rect(bootX, bootY, 3, 3, far ? K.l0 : K.l1);
    c.hline(bootX, bootY, 3, far ? K.l1 : K.l2); // cuff
    if (dir !== 'N') c.set(bootX + (dir === 'E' ? 2 : 0), bootY + 1, far ? K.l1 : K.l2); // toe cap
  };
  if (dir !== 'E') {
    const liftL = f === 1 ? 2 : 0;
    const liftR = f === 3 ? 2 : 0;
    leg(13, liftL, P.dark2, 12, false);
    leg(17, liftR, mix(P.dark2, P.dark1, 0.5), 17, true);
  } else {
    let back = 14;
    let front = 16;
    if (f === 1) [back, front] = [12, 18];
    if (f === 3) [back, front] = [17, 13];
    leg(back, f === 3 ? 1 : 0, P.dark1, back, true);
    leg(front, f === 1 ? 1 : 0, P.dark2, front, false);
  }
}

function drawRoll(c: Img, dir: Dir5, f: number) {
  const K = CLOAK;
  const off = DIR5.indexOf(dir) * (Math.PI / 4);
  const ball = (cx: number, cy: number, rx: number, ry: number, a: number) => {
    c.ellipse(cx, cy, rx, ry, K.c2);
    c.ellipse(cx, cy, rx, ry, K.c1, (x, y) => x + 0.5 - cx + (y + 0.5 - cy) > rx * 0.55);
    c.ellipse(cx, cy, rx, ry, K.c3, (x, y) => x + 0.5 - cx + (y + 0.5 - cy) < -rx * 0.9);
    c.disc(cx + Math.cos(a) * (rx - 2.5), cy + Math.sin(a) * (ry - 2.5), 2, K.c1); // the hood tumbling round
    c.set(cx + Math.cos(a + 0.8) * (rx - 1.5), cy + Math.sin(a + 0.8) * (ry - 1.5), K.l1); // a boot
    c.set(cx - Math.cos(a) * (rx - 2), cy - Math.sin(a) * (ry - 2), P.flame2); // the lantern
  };
  const crouch = (headY: number) => {
    c.rect(12, 25, 3, 3, K.l1);
    c.rect(17, 25, 3, 3, K.l0);
    c.ellipse(16, 22.5, 6, 5, K.c1);
    c.ellipse(15, 21.5, 4.5, 3.5, K.c2);
    c.hline(11, 25, 10, K.c0);
    c.disc(16, headY, 3.5, K.c2);
    c.set(14, headY - 2, K.rim);
    c.set(16, headY - 4, K.c2); // hood point
    if (dir === 'S' || dir === 'SE') {
      c.hline(15, headY, 3, P.ink);
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
      c.rect(13, 23, 2, 2, P.dark2);
      c.rect(17, 23, 2, 2, P.dark2);
      c.rect(12, 25, 3, 3, K.l1);
      c.rect(17, 25, 3, 3, K.l0);
      const t = new Img(CELL, CELL);
      drawTorso(t, dir, 0);
      c.blit(t, 0, 2);
      break;
    }
  }
}

/** Full-body collapse (legs layer hidden). Authored facing S only. */
function drawPlayerDeath(c: Img, f: number) {
  const K = CLOAK;
  switch (f) {
    case 0:
      c.rect(12, 25, 3, 3, K.l1);
      c.rect(17, 25, 3, 3, K.l0);
      c.ellipse(16, 22.5, 6, 5, K.c1);
      c.ellipse(15, 21.5, 4.5, 3.5, K.c2);
      c.disc(16, 18, 3.5, K.c2);
      c.hline(15, 18, 3, P.ink);
      c.set(15, 18, P.flame1);
      c.set(17, 18, P.flame1);
      break;
    case 1:
      c.ellipse(16, 24, 7, 4, K.c1);
      c.ellipse(15, 23, 5, 2.5, K.c2);
      c.disc(12, 21, 3, K.c2);
      c.set(10, 19, K.c2);
      break;
    case 2:
      c.ellipse(16, 25, 8, 3, K.c1);
      c.ellipse(16, 24.5, 6, 1.8, K.c2);
      c.disc(10, 24, 3, K.c2);
      c.set(21, 25, P.flame2);
      break;
    default:
      c.ellipse(16, 26, 9, 2.5, K.c0);
      c.ellipse(15, 25.5, 6, 1.5, K.c1);
      c.set(22, 26, f === 3 ? P.flame2 : P.flame1);
      if (f === 4) c.set(22, 24, P.dark2);
  }
}

/** Drinking from the Mending Phial (off hand). f: 0 raise, 1 drink (at the mouth), 2 lower. */
function drawDrink(c: Img, dir: Dir5, f: number) {
  drawTorso(c, dir, 0, f === 1 ? 'active' : 'idle'); // head tips back while drinking
  const mouth: Partial<Record<Dir5, [number, number]>> = { S: [15, 9], SE: [16, 9], E: [19, 8] };
  const hip: Record<Dir5, [number, number]> = { S: [11, 16], SE: [12, 16], E: [14, 16], NE: [12, 16], N: [12, 16] };
  const at = f === 1 ? mouth[dir] : hip[dir];
  if (!at || ((dir === 'N' || dir === 'NE') && f !== 1)) return; // flask hidden behind the body
  const [x, y] = at;
  c.rect(x, y, 2, 3, P.flame2);
  c.set(x, y + 2, P.flame1);
  c.set(x, y - 1, P.wax1); // cork
}

function genPlayer() {
  const body = new Img(CELL * 8, CELL * 36);
  const cell = (draw: (c: Img) => void, col: number, row: number) => {
    const c = new Img(CELL, CELL);
    draw(c);
    c.outline(P.ink);
    body.blit(c, col * CELL, row * CELL);
  };
  DIR5.forEach((d, row) => {
    for (let f = 0; f < 2; f++) cell(c => drawTorso(c, d, f), f, row);
    for (let f = 0; f < 7; f++) cell(c => drawRoll(c, d, f), f, 5 + row);
    // Swing: anticipation (2) -> strike (2) -> follow-through / settle (2)
    (['windup', 'windup2', 'active', 'follow', 'follow', 'idle'] as const).forEach((pose, f) =>
      cell(c => drawTorso(c, d, 0, pose), f, 10 + row),
    );
    (['flinch', 'flinch2', 'idle'] as const).forEach((pose, f) => cell(c => drawTorso(c, d, 0, pose), f, 15 + row));
    // Thrust: lean back (2) -> lunge (2) -> recover (2)
    (['windup', 'windup2', 'active', 'active', 'follow', 'idle'] as const).forEach((pose, f) =>
      cell(c => drawTorso(c, d, 0, pose), f, 31 + row),
    );
    cell(c => drawRoll(c, d, 5), 0, 21 + row); // kneel (full body)
    for (let f = 0; f < 3; f++) cell(c => drawDrink(c, d, f), f, 26 + row);
  });
  for (let f = 0; f < 5; f++) cell(c => drawPlayerDeath(c, f), f, 20);
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
      attack: { row: 10, dirs: DIR5, loop: false, frames: phased6() },
      thrust: { row: 31, dirs: DIR5, loop: false, frames: phased6() },
      stagger: { row: 15, dirs: DIR5, loop: false, frames: [{ ticks: 6 }, { ticks: 8 }, { ticks: 12 }] },
      death: {
        row: 20,
        dirs: ['S'],
        loop: false,
        frames: [{ ticks: 8 }, { ticks: 8 }, { ticks: 10 }, { ticks: 30 }, { ticks: 60 }],
      },
      kneel: { row: 21, dirs: DIR5, loop: false, frames: [{ ticks: 60 }] },
      drink: {
        row: 26,
        dirs: DIR5,
        loop: false,
        frames: [
          { ticks: 1, phase: 'raise' },
          { ticks: 1, phase: 'drink' },
          { ticks: 1, phase: 'lower' },
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
  // A pilgrim's arming sword: brass pommel and cross, a leather-wrapped grip, a fullered blade lit along its top edge
  const sword = new Img(22, 9);
  sword.set(0, 4, BRASS); // pommel
  sword.vline(1, 3, 3, GOLD0);
  sword.set(1, 3, mix(GOLD0, P.wax2, 0.4));
  for (let x = 2; x <= 4; x++) {
    sword.set(x, 4, x % 2 ? WOOD.c1 : WOOD.c2); // the wrap
    sword.set(x, 3, x % 2 ? WOOD.c2 : WOOD.c3);
  }
  sword.vline(5, 1, 7, BRASS); // the cross, its ends curled
  sword.set(5, 1, mix(GOLD0, P.wax2, 0.4));
  sword.set(5, 2, GOLD0);
  sword.set(4, 1, BRASS);
  sword.set(4, 7, WOOD.c0);
  sword.rect(6, 3, 12, 3, IRON.c2); // the blade
  sword.hline(6, 3, 12, IRON.c3); // lit edge
  sword.hline(7, 4, 9, IRON.c1); // the fuller
  sword.hline(6, 5, 12, mix(IRON.c1, IRON.c2, 0.5)); // lower edge in shade
  sword.rect(6, 3, 1, 3, IRON.c1); // ricasso
  sword.hline(18, 3, 1, IRON.c3); // the point
  sword.set(18, 4, IRON.c2);
  sword.set(19, 3, IRON.c3);
  sword.set(12, 3, P.white); // a glint
  sword.outline(P.ink);
  sheet('sword', sword, { cell: [22, 9], pivot: [3, 4], layer: 'weapon', points: { tip: [20, 3] } });

  // The Parish Revolver: blued Works steel, a fluted cylinder, a brass guard and butt cap on a walnut grip
  const rev = new Img(15, 10);
  rev.rect(7, 2, 6, 2, IRON.c1); // barrel
  rev.hline(7, 2, 6, IRON.c3);
  rev.set(12, 1, IRON.c2); // front sight
  rev.hline(8, 4, 4, IRON.c0); // ejector rod
  rev.rect(4, 2, 3, 3, IRON.c1); // cylinder
  rev.set(4, 2, IRON.c3);
  rev.set(5, 2, IRON.c2);
  rev.vline(5, 3, 2, IRON.c0); // flutes
  rev.set(6, 4, IRON.c0);
  rev.vline(3, 2, 3, IRON.c0); // frame
  rev.set(3, 1, IRON.c2); // hammer
  rev.set(2, 1, IRON.c1);
  rev.set(4, 6, GOLD0); // trigger guard
  rev.set(5, 6, BRASS);
  rev.set(6, 5, BRASS);
  rev.set(5, 5, IRON.c0); // trigger
  rev.rect(2, 5, 2, 2, WOOD.c2); // grip
  rev.rect(1, 6, 2, 2, WOOD.c1);
  rev.set(2, 5, WOOD.c3);
  rev.set(1, 6, WOOD.c2);
  rev.hline(1, 8, 2, BRASS); // butt cap
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

// ---------------------------------------------------------------- enemies
/** Wickling: a hunched, wax-headed acolyte with a candle stub burning on its crown. */
const WICK_HAND: Record<Dir5, [number, number]> = { S: [21, 20], SE: [21, 19], E: [19, 19], NE: [20, 18], N: [20, 18] };
type WickPose = { bob?: number; hunch?: number; flame?: number; sway?: number; lean?: number; flinch?: boolean };
/** Screen direction the body faces, per authored direction (for leaning into / away from an attack). */
const FACE_VEC: Record<Dir5, [number, number]> = { S: [0, 1], SE: [0.7, 0.7], E: [1, 0], NE: [0.7, -0.7], N: [0, -1] };

/** Shared enemy ramps (light from the top left, like the player). */
const EN = {
  robe0: hex('#2a1b18'),
  robe1: mix(P.wood1, P.dark2, 0.35),
  robe2: P.wood1,
  robe3: hex('#7a5238'),
  rope: mix(P.wax1, P.wood2, 0.45),
  wax0: mix(P.wax1, P.wood2, 0.5),
  wax1: mix(P.wax1, P.wood2, 0.2),
  wax2: P.wax1,
  wax3: P.wax2,
  steel0: hex('#3c4350'),
  steel1: hex('#5d6776'),
  steel2: P.steel1,
  steel3: P.steel2,
};

/** A robe row [y, x, w] shaded from a lit left edge to a dark right edge. */
function shadedRow(c: Img, x: number, y: number, w: number, r0: RGBA, r1: RGBA, r2: RGBA, r3: RGBA) {
  c.hline(x, y, w, r2);
  c.set(x, y, r3);
  if (w > 4) c.set(x + 1, y, mix(r2, r3, 0.5));
  c.set(x + w - 1, y, r0);
  if (w > 3) c.set(x + w - 2, y, r1);
}

function drawWickling(c: Img, dir: Dir5, pose: WickPose) {
  const o = { bob: 0, hunch: 0, flame: 0, sway: 0, lean: 0, ...pose };
  const b = o.bob;
  const E = EN;
  // Lean: head and shoulders shift toward the facing (positive) or away from it (negative, anticipation).
  const [fx, fy] = FACE_VEC[dir];
  const lx = Math.round(o.lean * fx);
  const ly = Math.round(o.lean * fy * 0.7);
  const shoulders = Math.round(o.lean * fx * 0.5);
  const back = dir === 'N' || dir === 'NE';
  // Robe: a ragged bell shape
  const rows: [number, number, number][] = [
    [17, 13, 6],
    [18, 12, 8],
    [19, 12, 8],
    [20, 12, 8],
    [21, 11, 10],
    [22, 11, 10],
    [23, 11, 10],
    [24, 11, 10],
    [25, 10, 12],
    [26, 10, 12],
  ];
  for (const [y, x, w] of rows) {
    const sway = y >= 24 ? o.sway : y <= 20 ? shoulders : 0;
    shadedRow(c, x + sway, y + b, w, E.robe0, E.robe1, E.robe2, E.robe3);
  }
  // folds that open toward the hem
  for (const [x0, x1] of [[14, 13], [18, 19]]) line(c, x0 + shoulders, 21 + b, x1 + o.sway, 26 + b, E.robe1);
  for (let x = 10; x < 22; x += 2) c.set(x + o.sway, 27 + b, E.robe0); // ragged hem
  // rope belt with a knot and a hanging end
  c.hline(12 + shoulders, 21 + b, 8, E.rope);
  c.hline(12 + shoulders, 22 + b, 8, E.robe1);
  if (!back) c.set(15 + shoulders, 22 + b, E.rope); // the knot
  // cowl collar gathered around the neck
  c.hline(13 + shoulders, 17 + b, 6, E.robe1);
  c.set(13 + shoulders, 17 + b, E.robe3);

  // Wax head, drooping, melting down over the collar
  const hx = 16 + (o.flinch ? -1 : 0) + lx;
  const hy = 13 + b + o.hunch + ly;
  // the cowl the face sits in
  c.ellipse(hx, hy + 0.5, 4.8, 4.4, E.robe1);
  c.ellipse(hx - 0.6, hy, 4, 3.8, E.robe2, (x, y) => x + 0.5 - hx + (y + 0.5 - hy) < 1.5);
  c.set(hx - 4, hy - 1, E.robe3);
  c.set(hx - 3, hy - 3, E.robe3);
  if (back) {
    c.ellipse(hx, hy + 0.5, 3.6, 3.4, E.robe1); // the back of the cowl, a wax crown showing above it
    c.hline(hx - 2, hy - 3, 4, E.wax1);
    c.set(hx - 1, hy - 4, E.wax3);
  } else c.disc(hx + (dir === 'E' ? 1 : 0), hy + 0.4, 3.2, E.wax1);
  if (!back) {
    const fx0 = hx + (dir === 'E' ? 1 : 0);
    c.ellipse(fx0 + 1, hy + 1.2, 2.4, 2.2, E.wax0, (x, y) => x + 0.5 - fx0 + (y + 0.5 - hy) > 1.4); // shaded lower right
    c.set(fx0 - 2, hy - 2, E.wax3);
    c.set(fx0 - 1, hy - 2, E.wax2);
  }
  // drips running off the head onto the robe
  c.vline(hx - 2, hy + 3, 3, E.wax1);
  c.set(hx - 2, hy + 6, E.wax2);
  c.vline(hx + 2, hy + 3, 2, E.wax0);
  const eye = o.flinch ? P.ember : P.blood2;
  const socket = mix(E.wax0, P.dark2, 0.55);
  const face = (ex: number[]) => {
    for (const x of ex) {
      c.set(x, hy - 1, socket); // sunken brow
      c.set(x, hy, eye);
    }
  };
  if (dir === 'S') {
    face([hx - 2, hx + 1]);
    c.set(hx - 2, hy + 1, E.wax3); // a tear of wax
    c.hline(hx - 1, hy + 2, 2, socket); // slack mouth
  } else if (dir === 'SE') {
    face([hx - 1, hx + 2]);
    c.set(hx, hy + 2, socket);
  } else if (dir === 'E') face([hx + 2]);
  // Candle stub + flame
  c.rect(hx - 1, hy - 6, 2, 3, E.wax3);
  c.vline(hx, hy - 6, 3, E.wax2);
  c.set(hx - 2, hy - 4, E.wax2); // wax pooled at its foot
  c.set(hx + 1, hy - 4, E.wax1);
  c.set(hx, hy - 7, P.ink);
  c.set(hx + (o.flame ? -1 : 0), hy - 8, P.flame2);
  c.set(hx, hy - 9, o.flame ? P.flame2 : P.flame1);
  if (o.flame) c.set(hx, hy - 10, mix(P.flame1, P.ember, 0.5));
  // Pale hand (weapon grip) — must match WICK_HAND
  const [ax, ay] = WICK_HAND[dir];
  c.rect(ax - 1, ay - 1 + b, 2, 2, E.wax1);
  c.set(ax, ay + b, E.wax0);
}

/**
 * A body going down (death frames 2-4): the figure as `draw` paints it standing, tipped over about its middle
 * (frame 2 half way, 3 and 4 flat on the ground) so it lies along the floor with its feet where they were; a
 * pool of `pool` spreads under it, and by the last frame it has gone dark and still.
 */
function bodyDown(c: Img, draw: (c: Img) => void, f: number, pool: RGBA, dir = 1) {
  const src = new Img(c.w, c.h);
  draw(src);
  let x0 = c.w, x1 = -1, y0 = c.h, y1 = -1;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++)
      if (src.alpha(x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return;
  const a = (f === 2 ? 60 : 90) * (Math.PI / 180) * dir;
  const sw = (x1 - x0 + 1) / 2;
  const shh = (y1 - y0 + 1) / 2;
  const scx = (x0 + x1 + 1) / 2;
  const scy = (y0 + y1 + 1) / 2;
  const flat = f >= 3 ? 0.72 : 0.88; // seen from above, a body on the floor is foreshortened
  const halfH = (shh * Math.abs(Math.sin(a)) + sw * Math.abs(Math.cos(a))) * flat; // how tall it is once tipped
  const dcx = scx + dir * (f === 2 ? 2 : 1);
  const dcy = y1 + 1 - halfH;
  if (f >= 3) {
    const len = shh * 2;
    c.ellipse(dcx, y1 - 1, len * (0.45 + (f - 3) * 0.15), 2.5 + (f - 3), mix(pool, P.ink, 0.35));
    c.ellipse(dcx - 1, y1 - 1.5, len * (0.3 + (f - 3) * 0.12), 1.5 + (f - 3) * 0.6, pool);
  }
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const dx = x + 0.5 - dcx;
      const dy = (y + 0.5 - dcy) / flat;
      const sx = Math.floor(scx + dx * cos + dy * sin);
      const sy = Math.floor(scy - dx * sin + dy * cos);
      if (!src.alpha(sx, sy)) continue;
      const i = (sy * src.w + sx) * 4;
      const col: RGBA = [src.px[i], src.px[i + 1], src.px[i + 2], 255];
      c.set(x, y, f >= 4 ? mix(col, P.ink, 0.22) : col);
    }
}

function drawWicklingDeath(c: Img, f: number) {
  if (f < 2) {
    drawWickling(c, 'S', { bob: f + 1, hunch: f + 2, flame: f, sway: 0, flinch: true });
    return;
  }
  // it topples, its candle guttering out, and its wax runs out across the floor
  bodyDown(c, cc => drawWickling(cc, 'S', { hunch: 2, flame: f < 4 ? 1 : 0, sway: 0, flinch: true }), f, P.wax1);
}

function drawDummy(c: Img, lean: number) {
  c.rect(12, 26, 8, 2, P.dark1); // base
  c.rect(15, 18, 2, 9, P.wood1); // post
  c.rect(10 + lean, 14, 12, 2, P.wood2); // crossbar arms
  c.ellipse(16 + lean, 15, 5, 6, P.wood2); // straw sack
  c.hline(12 + lean, 12, 8, P.dark2);
  c.hline(12 + lean, 18, 8, P.dark2);
  c.set(14 + lean, 15, P.wood1);
  c.set(18 + lean, 16, P.wood1);
  c.disc(16 + lean, 7, 3, P.wood2); // head
  c.set(15 + lean, 7, P.ink);
  c.set(17 + lean, 7, P.ink);
}

/**
 * Wickling attack poses, 7 frames each (see phased7): 3 anticipation frames (the last is the held, trembling
 * "tense" pose the player should learn to read), 2 strike frames, 2 recovery frames.
 * Each attack has its own silhouette so the windup itself tells you which attack is coming.
 */
const WICK_ATTACKS: Record<string, WickPose[]> = {
  // Rears up and back, candle flaring, then crashes forward and down.
  overhead: [
    { lean: -1, bob: -1, hunch: -1 },
    { lean: -2, bob: -1, hunch: -2, flame: 1 },
    { lean: -2, bob: -1, hunch: -2, flame: 1, sway: 1 },
    { lean: 2, bob: 1, hunch: 1 },
    { lean: 2, bob: 1, hunch: 2, sway: -1 },
    { lean: 1, bob: 1, hunch: 2 },
    { lean: 0 },
  ],
  // Twists the whole body to one side, then whips across.
  swipe: [
    { sway: -1, lean: -1 },
    { sway: -1, lean: -1, hunch: 1 },
    { sway: -1, lean: -1, hunch: 1, flame: 1 },
    { sway: 1, lean: 1 },
    { sway: 1, lean: 2 },
    { sway: 1, lean: 1, bob: 1 },
    {},
  ],
  // Crouches low, then springs its whole weight forward.
  shove: [
    { bob: 1, hunch: 1 },
    { bob: 1, hunch: 2, lean: -1 },
    { bob: 1, hunch: 2, lean: -1, flame: 1 },
    { lean: 2, hunch: -1 },
    { lean: 3, hunch: -1 },
    { lean: 1 },
    {},
  ],
};

function genEnemies() {
  const COLS = 7;
  const wick = new Img(CELL * COLS, CELL * 31);
  const cell = (draw: (c: Img) => void, col: number, row: number) => {
    const c = new Img(CELL, CELL);
    draw(c);
    c.outline(P.ink);
    wick.blit(c, col * CELL, row * CELL);
  };
  const attackNames = Object.keys(WICK_ATTACKS);
  DIR5.forEach((d, r) => {
    for (let f = 0; f < 2; f++) cell(c => drawWickling(c, d, { flame: f }), f, r);
    for (let f = 0; f < 4; f++)
      cell(c => drawWickling(c, d, { bob: f % 2 ? -1 : 0, flame: f % 2, sway: f === 1 ? 1 : f === 3 ? -1 : 0 }), f, 5 + r);
    attackNames.forEach((name, a) => WICK_ATTACKS[name].forEach((pose, f) => cell(c => drawWickling(c, d, pose), f, 10 + a * 5 + r)));
    cell(c => drawWickling(c, d, { hunch: -1, lean: -2, sway: -1, flinch: true }), 0, 25 + r);
    cell(c => drawWickling(c, d, { bob: 1, lean: -1, flame: 1, flinch: true }), 1, 25 + r);
    cell(c => drawWickling(c, d, { bob: 1, hunch: 1, flinch: true }), 2, 25 + r);
  });
  for (let f = 0; f < 5; f++) cell(c => drawWicklingDeath(c, f), f, 30);
  const toPivot = ([x, y]: [number, number]) => [x - PIVOT[0], y - PIVOT[1]];
  sheet('wickling', wick, {
    cell: [CELL, CELL],
    pivot: PIVOT,
    layer: 'single',
    handAnchors: Object.fromEntries(DIR5.map(d => [d, toPivot(WICK_HAND[d])])),
    animations: {
      idle: { row: 0, dirs: DIR5, loop: true, frames: [{ ticks: 14 }, { ticks: 14 }] },
      walk: {
        row: 5,
        dirs: DIR5,
        loop: true,
        frames: [{ ticks: 8 }, { ticks: 8, events: ['footstep'] }, { ticks: 8 }, { ticks: 8, events: ['footstep'] }],
      },
      // One phased animation per attack; "attack" is the fallback for strikes without an `anim`.
      ...Object.fromEntries(attackNames.map((name, a) => [name, { row: 10 + a * 5, dirs: DIR5, loop: false, frames: phased7() }])),
      attack: { row: 10, dirs: DIR5, loop: false, frames: phased7() },
      stagger: { row: 25, dirs: DIR5, loop: false, frames: [{ ticks: 6 }, { ticks: 10 }, { ticks: 30 }] },
      death: { row: 30, dirs: ['S'], loop: false, frames: [{ ticks: 8 }, { ticks: 10 }, { ticks: 12 }, { ticks: 30 }, { ticks: 60 }] },
    },
  });

  const cleaver = new Img(17, 10);
  cleaver.hline(1, 6, 4, P.wood1); // handle
  cleaver.set(1, 6, P.wood2);
  cleaver.rect(5, 2, 9, 5, P.steel1); // blade
  cleaver.hline(5, 6, 9, P.steel2); // edge
  cleaver.set(12, 3, P.dark2); // hanging hole
  cleaver.outline(P.ink);
  sheet('cleaver', cleaver, { cell: [17, 10], pivot: [3, 6], layer: 'weapon', points: { tip: [15, 4] } });

  const dummy = new Img(CELL * 3, CELL);
  [0, -1, 1].forEach((lean, f) => {
    const c = new Img(CELL, CELL);
    drawDummy(c, lean);
    c.outline(P.ink);
    dummy.blit(c, f * CELL, 0);
  });
  sheet('dummy', dummy, {
    cell: [CELL, CELL],
    pivot: PIVOT,
    layer: 'single',
    animations: {
      idle: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 60, col: 0 }] },
      hit: { row: 0, dirs: ['S'], loop: false, frames: [{ ticks: 4, col: 1 }, { ticks: 4, col: 2 }, { ticks: 4, col: 1 }, { ticks: 4, col: 0 }] },
    },
  });
}

// ---------------------------------------------------------------- combat fx
function genCombatFx() {
  // Glint: telegraph / full-charge star. Row 0 = normal (warm white), row 1 = danger (red).
  const glint = new Img(11 * 4, 11 * 2);
  [
    [P.wax2, P.flame2],
    [P.wax2, P.blood2],
  ].forEach(([core, arm], row) => {
    [1, 3, 5, 2].forEach((r, f) => {
      const c = new Img(11, 11);
      for (let i = 1; i <= r; i++) for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) c.set(5 + dx, 5 + dy, arm);
      if (f === 2) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.set(5 + dx, 5 + dy, arm);
      c.set(5, 5, core);
      glint.blit(c, f * 11, row * 11);
    });
  });
  const glintFrames = [{ ticks: 2 }, { ticks: 3 }, { ticks: 5 }, { ticks: 5 }];
  sheet('glint', glint, {
    cell: [11, 11],
    pivot: [5, 5],
    layer: 'fx',
    animations: {
      normal: { row: 0, dirs: ['S'], loop: false, frames: glintFrames },
      danger: { row: 1, dirs: ['S'], loop: false, frames: glintFrames },
    },
  });

  // Slash: a crescent pointing right (east), drawn around the attacker; rotated/scaled at runtime.
  const S = 48;
  const slash = new Img(S * 3, S * 2);
  for (let f = 0; f < 3; f++) {
    const c = new Img(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - 24;
        const dy = y + 0.5 - 24;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        if (Math.abs(a) > 1.35) continue;
        const thick = (f === 0 ? 7 : f === 1 ? 4 : 2) * Math.cos(a * 1.1);
        if (r > 22 || r < 22 - thick) continue;
        if (f === 2 && (x + y) % 2) continue;
        c.set(x, y, r > 20.5 ? P.wax2 : P.steel2);
      }
    slash.blit(c, f * S, 0);
    // Thrust streak (row 1)
    const t = new Img(S, S);
    const th = f === 0 ? 1 : 0;
    for (let x = 32; x <= 46 - f * 2; x++)
      for (let dy = -th; dy <= th; dy++) if (f < 2 || x % 2) t.set(x, 24 + dy, dy === 0 ? P.wax2 : P.steel2);
    slash.blit(t, f * S, S);
  }
  const slashFrames = [{ ticks: 2 }, { ticks: 3 }, { ticks: 3 }];
  sheet('slash', slash, {
    cell: [S, S],
    pivot: [24, 24],
    layer: 'fx',
    animations: {
      swing: { row: 0, dirs: ['S'], loop: false, frames: slashFrames },
      thrust: { row: 1, dirs: ['S'], loop: false, frames: slashFrames },
    },
  });

  const ex = new Img(7, 11);
  ex.rect(3, 1, 1, 6, P.flame2);
  ex.set(3, 8, P.flame2);
  ex.outline(P.ink);
  sheet('exclaim', ex, { cell: [7, 11], pivot: [3, 10], layer: 'fx' });
}

// ---------------------------------------------------------------- arsenal (M3)
function genArsenal() {
  const outlined = (w: number, h: number, draw: (c: Img) => void) => {
    const c = new Img(w, h);
    draw(c);
    c.outline(P.ink);
    return c;
  };

  // Weapons are drawn pointing right; pivot = grip.
  sheet(
    'dagger',
    outlined(14, 8, c => {
      // a rondel: iron disc guard and pommel, a cord-wound grip, a narrow stiff blade
      c.set(0, 4, IRON.c2); // pommel disc
      c.vline(0, 3, 3, IRON.c1);
      for (let x = 1; x <= 3; x++) c.set(x, 4, x % 2 ? WOOD.c2 : WOOD.c1);
      c.vline(4, 2, 5, IRON.c1); // guard disc
      c.set(4, 2, IRON.c3);
      c.rect(5, 3, 6, 2, IRON.c2);
      c.hline(5, 3, 6, IRON.c3);
      c.hline(5, 4, 6, IRON.c1);
      c.set(11, 3, IRON.c3);
      c.set(8, 3, P.white);
    }),
    { cell: [14, 8], pivot: [2, 4], layer: 'weapon', points: { tip: [12, 3] } },
  );

  sheet(
    'greataxe',
    outlined(31, 17, c => {
      // an ash haft bound in iron, a leather grip; a bearded head with a hooked back spike and a bright bevel
      c.hline(1, 8, 21, WOOD.c2); // haft
      c.hline(1, 9, 21, WOOD.c1);
      for (let x = 4; x < 21; x += 5) c.set(x, 8, WOOD.c3); // grain
      c.rect(0, 8, 1, 2, IRON.c2); // butt cap
      c.rect(3, 8, 5, 2, DWOOD.c1); // leather grip
      for (let x = 3; x < 8; x += 2) c.set(x, 8, DWOOD.c2);
      c.rect(13, 8, 1, 2, IRON.c2); // bands
      c.rect(17, 8, 1, 2, IRON.c2);
      c.rect(18, 6, 3, 6, IRON.c1); // socket
      c.vline(18, 6, 6, IRON.c2);
      c.set(18, 6, IRON.c3);
      c.hline(15, 8, 3, IRON.c1); // back spike, hooked down
      c.set(14, 9, IRON.c1);
      c.set(15, 7, IRON.c2);
      for (let y = 1; y <= 16; y++) {
        const w = Math.max(1, Math.round(1 + 5.5 * Math.sin((Math.PI * (y - 0.5)) / 16) + (y > 10 ? 1 : 0))); // a beard on the lower half
        const x0 = 21;
        c.hline(x0, y, w, IRON.c1);
        if (w > 2) c.set(x0 + w - 2, y, IRON.c2); // the bevel
        c.set(x0 + w - 1, y, IRON.c3); // the edge
        if (y < 5) c.set(x0, y, IRON.c2);
      }
      c.set(23, 6, IRON.c0); // a nick, and a mark from the forge
      c.set(22, 11, IRON.c0);
      c.set(26, 5, P.white);
    }),
    { cell: [31, 17], pivot: [5, 8], layer: 'weapon', points: { tip: [27, 8] } },
  );

  sheet(
    'crossbow',
    outlined(21, 15, c => {
      // a heavy crossbow: an oak tiller, a steel prod bent back at the tips, a windlass hook at the butt
      c.rect(2, 6, 11, 3, WOOD.c2); // tiller
      c.hline(2, 6, 11, WOOD.c3);
      c.hline(2, 8, 11, WOOD.c1);
      c.rect(0, 5, 3, 5, WOOD.c1); // butt
      c.vline(0, 5, 5, WOOD.c2);
      c.set(1, 4, IRON.c2); // windlass hook
      c.set(1, 3, IRON.c1);
      c.rect(6, 9, 2, 2, IRON.c1); // trigger lever
      c.set(7, 11, IRON.c0);
      c.rect(12, 5, 2, 5, IRON.c1); // the stirrup-plate that holds the prod
      for (let y = 0; y <= 14; y++) {
        const k = (y - 7) / 7;
        const x = 15 - Math.round(2 * k * k); // bent back toward the tips
        c.set(x, y, IRON.c2);
        if (y < 7) c.set(x - 1, y, IRON.c3);
      }
      for (let y = 1; y <= 13; y++) c.set(Math.round(13 - (1 - Math.abs(y - 7) / 6) * 3), y, P.wax1); // the string, drawn back
      c.hline(9, 7, 9, WOOD.c2); // the bolt
      c.set(9, 6, P.blood2); // fletching
      c.set(9, 8, P.blood2);
      c.hline(18, 7, 2, IRON.c3);
    }),
    { cell: [21, 15], pivot: [5, 7], layer: 'weapon', points: { muzzle: [19, 7] } },
  );

  sheet(
    'flintlock',
    outlined(20, 10, c => {
      // the Chapel Flintlock: a long octagonal barrel pinned in a walnut stock, brass bands, lock and furniture
      c.rect(7, 2, 11, 2, IRON.c1); // barrel
      c.hline(7, 2, 11, IRON.c3);
      c.set(17, 2, IRON.c3);
      c.set(17, 3, IRON.c2); // muzzle ring
      c.hline(7, 4, 8, WOOD.c2); // the fore-stock under it
      c.hline(8, 5, 6, WOOD.c1); // ramrod
      c.set(14, 5, BRASS);
      c.vline(14, 2, 3, BRASS); // the barrel band
      c.rect(3, 3, 5, 2, WOOD.c2); // wrist
      c.hline(3, 3, 5, WOOD.c3);
      c.rect(1, 5, 3, 2, WOOD.c2); // grip, curving down
      c.set(1, 5, WOOD.c3);
      c.rect(1, 7, 2, 1, WOOD.c1);
      c.hline(1, 8, 2, BRASS); // butt cap
      c.rect(5, 3, 2, 2, IRON.c1); // lock plate
      c.set(7, 2, GOLD0); // the pan
      c.set(5, 1, IRON.c2); // the cock, and its flint
      c.set(6, 1, IRON.c1);
      c.set(6, 0, P.stone3);
      c.set(5, 6, GOLD0); // trigger guard
      c.set(6, 6, BRASS);
      c.set(7, 5, BRASS);
      c.set(6, 5, IRON.c0);
    }),
    { cell: [20, 10], pivot: [3, 5], layer: 'weapon', points: { muzzle: [18, 2] } },
  );

  sheet(
    'buckler',
    outlined(11, 11, c => {
      c.disc(5.5, 5.5, 4.6, P.steel1);
      c.disc(5.5, 5.5, 3.2, P.stone3);
      c.rect(5, 5, 2, 2, P.steel2); // boss
      c.set(3, 3, P.steel2);
    }),
    { cell: [11, 11], pivot: [5, 5], layer: 'weapon' },
  );

  // Projectiles (no outline: they read as streaks). Drawn pointing right.
  const bullet = new Img(6, 3);
  bullet.hline(0, 1, 3, P.flame1);
  bullet.rect(3, 0, 2, 3, P.flame2);
  bullet.set(5, 1, P.wax2);
  sheet('bullet', bullet, { cell: [6, 3], pivot: [4, 1], layer: 'fx' });
  const bolt = new Img(12, 3);
  bolt.hline(1, 1, 9, P.wood2);
  bolt.set(10, 1, P.steel2);
  bolt.set(11, 1, P.steel2);
  bolt.set(0, 0, P.wax1);
  bolt.set(0, 2, P.wax1);
  sheet('bolt', bolt, { cell: [12, 3], pivot: [8, 1], layer: 'fx' });
  const ball = new Img(5, 5);
  ball.disc(2.5, 2.5, 2, P.steel2);
  ball.set(1, 1, P.wax2);
  sheet('ball', ball, { cell: [5, 5], pivot: [2, 2], layer: 'fx' });

  // Muzzle flash: row 0 small, row 1 large. Pivot at the muzzle (left edge), flame extends right.
  const muzzle = new Img(20 * 3, 16 * 2);
  [1, 1.5].forEach((s, row) => {
    for (let f = 0; f < 3; f++) {
      const c = new Img(20, 16);
      if (f === 0) {
        c.ellipse(2 + 5 * s, 8, 5 * s, 3 * s, P.flame2);
        c.ellipse(1 + 2 * s, 8, 2 * s, 1.5 * s, P.wax2);
      } else if (f === 1) {
        c.ellipse(3 + 5 * s, 8, 5 * s, 2 * s, P.flame1);
        c.ellipse(2 + 2 * s, 8, 2 * s, 1, P.flame2);
      } else {
        c.ellipse(6 + 3 * s, 8, 3 * s, 2 * s, P.stone4, (x, y) => (x + y) % 2 === 0);
      }
      muzzle.blit(c, f * 20, row * 16);
    }
  });
  const flash = [{ ticks: 2 }, { ticks: 2 }, { ticks: 4 }];
  sheet('muzzle', muzzle, {
    cell: [20, 16],
    pivot: [0, 8],
    layer: 'fx',
    animations: {
      small: { row: 0, dirs: ['S'], loop: false, frames: flash },
      large: { row: 1, dirs: ['S'], loop: false, frames: flash },
    },
  });

  // Rack: a wooden stand; the rack's item is drawn on top at runtime.
  sheet(
    'rack',
    outlined(18, 22, c => {
      // an armoury stand: two turned posts with finials, a notched top bar with pegs, a lower rail, a plinth
      for (const px of [3, 13]) {
        c.rect(px, 5, 2, 14, WOOD.c2);
        c.vline(px, 5, 14, WOOD.c3);
        c.vline(px + 1, 5, 14, WOOD.c1);
        c.rect(px - 1, 3, 4, 2, WOOD.c2); // finial
        c.hline(px - 1, 3, 4, WOOD.c3);
        c.set(px, 2, WOOD.c2);
        c.set(px + 1, 2, WOOD.c1);
        c.hline(px, 11, 2, IRON.c2); // an iron bracket
      }
      c.rect(2, 7, 14, 2, WOOD.c2); // top bar
      c.hline(2, 7, 14, WOOD.c3);
      c.hline(2, 8, 14, WOOD.c1);
      for (const x of [6, 9, 12]) c.set(x, 6, IRON.c3); // pegs
      c.hline(2, 15, 14, WOOD.c1); // lower rail
      c.hline(2, 14, 14, WOOD.c2);
      c.rect(1, 19, 16, 2, P.stone2); // plinth
      c.hline(1, 19, 16, P.stone3);
      c.hline(1, 20, 16, P.stone1);
    }),
    { cell: [18, 22], pivot: [9, 20], layer: 'single' },
  );

  // Sparring post: the training dummy with a stick arm. Frames: 0 rest, 1 wind back, 2 swing through.
  const spar = new Img(CELL * 3, CELL);
  [0, -1, 1].forEach((lean, f) => {
    const c = new Img(CELL, CELL);
    drawDummy(c, lean);
    c.rect(20 + lean, 15, 2, 2, P.wax1); // hand
    c.outline(P.ink);
    spar.blit(c, f * CELL, 0);
  });
  sheet('sparring', spar, {
    cell: [CELL, CELL],
    pivot: PIVOT,
    layer: 'single',
    handAnchors: { S: [5, -12] },
    animations: {
      idle: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 60, col: 0 }] },
      walk: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 60, col: 0 }] },
      attack: {
        row: 0,
        dirs: ['S'],
        loop: false,
        frames: [
          { ticks: 1, phase: 'windup', col: 1 },
          { ticks: 1, phase: 'active', col: 2 },
          { ticks: 1, phase: 'recovery', col: 0 },
        ],
      },
      stagger: { row: 0, dirs: ['S'], loop: false, frames: [{ ticks: 6, col: 1 }, { ticks: 6, col: 2 }, { ticks: 30, col: 0 }] },
    },
  });
  sheet(
    'stick',
    outlined(18, 5, c => {
      c.hline(1, 2, 15, P.wood2);
      c.set(1, 2, P.wood1);
    }),
    { cell: [18, 5], pivot: [2, 2], layer: 'weapon', points: { tip: [16, 2] } },
  );

  // Bare hands: not drawn in the world (view.hidden), only exists so the empty slot has a texture.
  sheet(
    'fist',
    outlined(5, 5, c => c.rect(1, 1, 3, 3, P.wood2)),
    { cell: [5, 5], pivot: [2, 2], layer: 'weapon', points: { tip: [4, 2] } },
  );

  const q = new Img(7, 11);
  for (const [x, y] of [[2, 1], [3, 1], [4, 1], [1, 2], [5, 2], [5, 3], [4, 4], [3, 5], [3, 6], [3, 8]]) q.set(x, y, P.wax2);
  q.outline(P.ink);
  sheet('question', q, { cell: [7, 11], pivot: [3, 10], layer: 'fx' });
}

// ---------------------------------------------------------------- shrines & resources (M4)
function genShrine() {
  // Wick Shrine: an iron candelabrum with one tall candle. Col 0 = unlit, cols 1..3 = lit flicker.
  const W = 24;
  const H = 44;
  const img = new Img(W * 4, H);
  for (let f = 0; f < 4; f++) {
    const c = new Img(W, H);
    // A stone plinth with the Abbey's flame carved in it; offerings left at its foot
    box(c, 4, 36, 16, 6, STN);
    c.set(12, 38, STN.c0);
    c.hline(11, 39, 3, STN.c0);
    c.set(12, 40, STN.c0);
    // an iron stem with two knops, a wide dish
    c.vline(11, 18, 18, IRON.c2);
    c.vline(12, 18, 18, IRON.c0);
    c.set(11, 20, IRON.c3);
    box(c, 9, 25, 6, 2, IRON);
    box(c, 10, 31, 4, 2, IRON);
    box(c, 5, 16, 14, 2, IRON); // dish
    c.hline(5, 16, 14, IRON.c3);
    // the shrine candle: thick, wax cascading over the dish
    c.rect(9, 6, 6, 10, P.wax1);
    c.vline(9, 6, 10, P.wax2);
    c.vline(10, 6, 10, mix(P.wax1, P.wax2, 0.5));
    c.vline(14, 6, 10, mix(P.wax1, P.wood2, 0.3));
    c.hline(9, 6, 6, P.wax2);
    for (const [x, y, l] of [[6, 17, 3], [8, 17, 5], [16, 17, 4], [18, 17, 2], [15, 12, 3]] as const) {
      c.vline(x, y, l, P.wax2);
      c.set(x, y + l, P.wax1);
    }
    c.set(12, 5, P.ink); // wick
    // stubs and a coin left by pilgrims
    for (const x of [5, 17]) {
      c.vline(x, 33, 3, P.wax2);
      if (f > 0) c.set(x, 32, f % 2 ? P.flame2 : P.flame1);
    }
    c.set(8, 35, P.flame1);
    if (f > 0) {
      const sway = f === 2 ? 1 : 0;
      c.ellipse(12 + sway, 2.5, 2.2, 3 + (f === 3 ? 0.5 : 0), P.ember);
      c.ellipse(12 + sway, 3, 1.8, 2.4, P.flame1);
      c.ellipse(12 + sway, 3.5, 1, 1.6, P.flame2);
      c.set(12 + sway, 4, P.white);
    } else {
      c.set(12, 3, withAlpha(P.stone4, 170)); // unlit: a thread of smoke
      c.set(13, 1, withAlpha(P.stone4, 120));
    }
    c.outline(P.ink);
    finish(c, 12, 42, 9, 1.8);
    img.blit(c, f * W, 0);
  }
  sheet('shrine', img, {
    cell: [W, H],
    pivot: [12, 42],
    layer: 'single',
    animations: {
      unlit: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 60, col: 0 }] },
      lit: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 8, col: 1 }, { ticks: 7, col: 2 }, { ticks: 9, col: 3 }] },
    },
  });

  // Guttered Candle (death marker): a melted stub with a pale, cold flame.
  const g = new Img(12 * 3, 14);
  for (let f = 0; f < 3; f++) {
    const c = new Img(12, 14);
    c.ellipse(6, 11.5, 5, 2, P.wax1);
    c.rect(4, 7, 4, 4, P.wax1);
    c.vline(4, 7, 4, P.wax2);
    c.set(6, 6, P.ink);
    const h = [2, 3, 2][f];
    for (let i = 1; i <= h; i++) c.set(6 + (f === 1 && i === h ? 1 : 0), 6 - i, i === 1 ? P.white : P.cyan);
    c.outline(P.ink);
    g.blit(c, f * 12, 0);
  }
  sheet('guttered', g, {
    cell: [12, 14],
    pivot: [6, 12],
    layer: 'single',
    animations: { flicker: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 7 }, { ticks: 6 }, { ticks: 8 }] } },
  });

  // Item glint: a twinkle marking a pickup on the floor.
  const it = new Img(9 * 4, 9);
  [1, 2, 3, 1].forEach((r, f) => {
    const c = new Img(9, 9);
    for (let i = 1; i <= r; i++) for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) c.set(4 + dx, 4 + dy, i === r ? P.flame1 : P.flame2);
    c.set(4, 4, P.wax2);
    it.blit(c, f * 9, 0);
  });
  sheet('item_glint', it, {
    cell: [9, 9],
    pivot: [4, 6],
    layer: 'fx',
    animations: { shine: { row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 24 }] } },
  });

  // HUD icons
  const ph = new Img(8 * 2, 10);
  [true, false].forEach((full, f) => {
    const c = new Img(8, 10);
    c.set(3, 1, P.wax1); // cork
    c.set(4, 1, P.wax1);
    c.rect(3, 2, 2, 1, P.stone3); // neck
    c.rect(1, 3, 6, 6, full ? P.flame2 : P.dark2);
    if (full) {
      c.hline(1, 8, 6, P.flame1);
      c.set(2, 4, P.wax2);
    }
    c.outline(P.ink);
    ph.blit(c, f * 8, 0);
  });
  sheet('phial_icon', ph, { cell: [8, 10], pivot: [0, 0], layer: 'ui' });
  const tw = new Img(8, 9);
  tw.disc(4, 5.5, 2.6, P.wax1);
  tw.set(4, 2, P.wax1);
  tw.set(4, 3, P.wax1);
  tw.set(3, 4, P.wax2);
  tw.outline(P.ink);
  sheet('tallow_icon', tw, { cell: [8, 9], pivot: [0, 0], layer: 'ui' });
}

// ---------------------------------------------------------------- roster (M5)
type BodyPose = { bob?: number; lean?: number; hunch?: number; step?: number; flinch?: boolean; sway?: number };
const leanOffsets = (dir: Dir5, lean: number) => {
  const [fx, fy] = FACE_VEC[dir];
  return { lx: Math.round(lean * fx), ly: Math.round(lean * fy * 0.7), sh: Math.round(lean * fx * 0.5) };
};

/** Build a sheet: named 5-direction animations of `cols` frames, plus a 5-frame S-only death row. */
function rosterSheet(
  name: string,
  cell: number,
  pivot: [number, number],
  cols: number,
  anims: {
    name: string;
    frames: ((c: Img, d: Dir5) => void)[];
    timing: { ticks: number; phase?: string; events?: string[] }[];
    loop: boolean;
    /** Weapon hand per direction and frame (cell pixels), when the arm moves during the animation. */
    hand?: (d: Dir5, frame: number) => [number, number];
  }[],
  death: ((c: Img) => void)[],
  hand: Record<Dir5, [number, number]> | null,
) {
  const img = new Img(cell * cols, cell * (anims.length * 5 + 1));
  const put = (draw: (c: Img) => void, col: number, row: number) => {
    const c = new Img(cell, cell);
    draw(c);
    c.outline(P.ink);
    img.blit(c, col * cell, row * cell);
  };
  const animations: Record<string, object> = {};
  anims.forEach((a, i) => {
    DIR5.forEach((d, r) => a.frames.forEach((f, col) => put(c => f(c, d), col, i * 5 + r)));
    const frames = a.hand
      ? a.timing.map((t, f) => ({
          ...t,
          hands: Object.fromEntries(DIR5.map(d => [d, [a.hand!(d, f)[0] - pivot[0], a.hand!(d, f)[1] - pivot[1]]])),
        }))
      : a.timing;
    animations[a.name] = { row: i * 5, dirs: DIR5, loop: a.loop, frames };
  });
  const deathRow = anims.length * 5;
  death.forEach((f, col) => put(f, col, deathRow));
  animations.death = { row: deathRow, dirs: ['S'], loop: false, frames: [{ ticks: 8 }, { ticks: 10 }, { ticks: 12 }, { ticks: 30 }, { ticks: 60 }] };
  const manifest: Record<string, unknown> = { cell: [cell, cell], pivot, layer: 'single', animations };
  if (hand) manifest.handAnchors = Object.fromEntries(DIR5.map(d => [d, [hand[d][0] - pivot[0], hand[d][1] - pivot[1]]]));
  sheet(name, img, manifest);
}

const idleT = [{ ticks: 16 }, { ticks: 16 }];
const walkT = (fps = 8) => [{ ticks: fps }, { ticks: fps, events: ['footstep'] }, { ticks: fps }, { ticks: fps, events: ['footstep'] }];
const staggerT = [{ ticks: 6 }, { ticks: 10 }, { ticks: 30 }];

// --- Bulwark Warden: plate armour, red tabard, tower shield, spear.
const WARDEN_HAND: Record<Dir5, [number, number]> = { S: [21, 18], SE: [21, 17], E: [16, 17], NE: [20, 16], N: [20, 16] };

function drawWarden(c: Img, dir: Dir5, pose: BodyPose & { shield?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, shield: 0, flinch: false, ...pose };
  const b = o.bob;
  const E = EN;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const towerShield = (sx: number, sy: number, w: number) => {
    // oak planks bound in iron, the Abbey's flame painted on it
    c.rect(sx, sy, w, 14, P.wood2);
    for (let x = sx + 2; x < sx + w - 1; x += 2) c.vline(x, sy + 1, 12, P.wood1);
    c.vline(sx, sy, 14, E.steel3);
    c.vline(sx + w - 1, sy, 14, E.steel1);
    c.hline(sx, sy, w, E.steel3);
    c.hline(sx, sy + 13, w, E.steel1);
    c.hline(sx, sy + 7, w, E.steel2); // iron band
    if (w >= 4) {
      const m = sx + Math.floor(w / 2);
      c.set(m, sy + 2, P.flame2);
      c.rect(m - 1, sy + 3, 2, 3, P.blood2);
      c.set(m - 1, sy + 3, P.blood1);
      c.set(m, sy + 7, E.steel3); // boss
    }
  };
  if (dir === 'N') towerShield(9, 13 + b, 3); // carried in front, mostly hidden by the body
  // Legs: greaves and dark boots
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  c.rect(13, 22 + b, 2, 4 - liftL, E.steel2);
  c.set(13, 22 + b, E.steel3);
  c.rect(12, 26 - liftL, 3, 2, E.steel0);
  c.rect(17, 22 + b, 2, 4 - liftR, E.steel1);
  c.rect(17, 26 - liftR, 3, 2, E.steel0);
  // Torso: breastplate over mail, pauldrons
  c.rect(11 + sh, 13 + b, 10, 10, E.steel2);
  c.vline(11 + sh, 13 + b, 10, E.steel3);
  c.vline(12 + sh, 14 + b, 8, mix(E.steel2, E.steel3, 0.4));
  c.vline(20 + sh, 13 + b, 10, E.steel0);
  c.vline(19 + sh, 13 + b, 10, E.steel1);
  c.hline(11 + sh, 21 + b, 10, E.steel1); // mail skirt
  for (let x = 11; x < 21; x += 2) c.set(x + sh, 22 + b, E.steel0);
  c.rect(10 + sh, 13 + b, 3, 2, E.steel3); // pauldrons
  c.set(10 + sh, 14 + b, E.steel2);
  c.rect(19 + sh, 13 + b, 3, 2, E.steel1);
  c.hline(11 + sh, 19 + b, 10, P.wood1); // sword belt
  if (!back) {
    const tx = 14 + sh + (dir === 'SE' ? 1 : dir === 'E' ? 3 : 0);
    const tw = dir === 'E' ? 3 : 4;
    c.rect(tx, 14 + b, tw, 9, P.blood1); // tabard
    c.vline(tx, 14 + b, 9, P.blood2);
    c.hline(tx, 14 + b, tw, P.flame1); // gilt trim
    c.hline(tx, 22 + b, tw, mix(P.blood1, P.ink, 0.4));
    if (dir !== 'E') c.set(tx + 1, 17 + b, P.flame2); // flame badge
    c.hline(tx, 19 + b, tw, mix(P.wood1, P.blood1, 0.5));
  } else {
    for (const y of [15, 17]) c.hline(12 + sh, y + b, 8, E.steel1); // backplate lames
    c.rect(14 + sh, 20 + b, 4, 3, P.blood1); // tabard tail
  }
  // Helm: great helm with a red plume; cold cyan eyes behind the visor slit
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 5 + b + o.hunch + ly;
  c.rect(hx - 3, hy, 6, 1, E.steel2);
  c.rect(hx - 4, hy + 1, 8, 7, E.steel2);
  c.vline(hx - 4, hy + 1, 7, E.steel3);
  c.hline(hx - 3, hy + 1, 3, E.steel3);
  c.vline(hx + 3, hy + 1, 7, E.steel0);
  c.vline(hx + 2, hy + 2, 6, E.steel1);
  c.hline(hx - 4, hy + 7, 8, E.steel1); // gorget line
  // plume
  c.rect(hx - 1, hy - 3, 2, 3, P.blood2);
  c.set(hx - 1, hy - 3, mix(P.blood2, P.wax2, 0.3));
  c.set(hx + 1, hy - 2, P.blood1);
  c.set(hx + 1, hy - 1, P.blood1);
  const eye = o.flinch ? P.ember : P.cyan;
  if (dir === 'S') {
    c.hline(hx - 3, hy + 4, 6, P.ink);
    c.set(hx - 2, hy + 4, eye);
    c.set(hx + 1, hy + 4, eye);
    c.vline(hx, hy + 5, 2, E.steel1); // nasal ridge
  } else if (dir === 'SE') {
    c.hline(hx - 2, hy + 4, 5, P.ink);
    c.set(hx - 1, hy + 4, eye);
    c.set(hx + 2, hy + 4, eye);
  } else if (dir === 'E') {
    c.hline(hx, hy + 4, 4, P.ink);
    c.set(hx + 2, hy + 4, eye);
  } else if (dir === 'NE') c.hline(hx + 2, hy + 4, 2, P.dark1);
  // Tower shield on the guard side (faces where the warden faces; pushed forward for a bash)
  const push = Math.round(o.shield * fx);
  if (dir === 'S') towerShield(6 - Math.max(0, -o.shield), 12 + b + Math.max(0, o.shield), 5);
  else if (dir === 'SE') towerShield(17 + push, 12 + b, 4);
  else if (dir === 'E') towerShield(21 + push, 12 + b, 2);
  else if (dir === 'NE') towerShield(18 + push, 11 + b, 3);
  const [ax, ay] = WARDEN_HAND[dir];
  c.rect(ax - 1, ay - 1 + b, 2, 2, E.steel3);
  c.set(ax, ay + b, E.steel1);
}

function wardenDeath(c: Img, f: number) {
  if (f < 2) {
    drawWarden(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true });
    return;
  }
  bodyDown(c, cc => drawWarden(cc, 'S', { hunch: 1, flinch: true }), f, P.blood1);
}

// --- Powder Acolyte: dark robe, porcelain mask, bandolier of little pots; throws firepots.
type PotPos = 'hip' | 'raised' | 'forward' | 'none';
function drawAcolyte(c: Img, dir: Dir5, pose: BodyPose & { pot?: PotPos }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, pot: 'hip' as PotPos, flinch: false, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx, fy] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const r0 = mix(P.dark1, P.ink, 0.4);
  const r1 = P.dark1;
  const r2 = P.dark2;
  const r3 = mix(P.dark2, P.stone2, 0.5);
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  c.rect(13, 25 - liftL + b, 2, 2, P.wood1);
  c.rect(17, 25 - liftR + b, 2, 2, mix(P.wood1, P.dark1, 0.5));
  // Robe, scorched at the hem
  for (let y = 13; y <= 25; y++) {
    const w = 6 + Math.floor((y - 13) / 2);
    const x = 16 - Math.floor(w / 2) + (y < 19 ? sh : 0);
    shadedRow(c, x, y + b, w, r0, r1, r2, r3);
  }
  for (let x = 10; x < 22; x += 2) c.set(x, 25 + b, mix(P.ember, r1, 0.5)); // singed hem
  line(c, 16 + sh, 20 + b, 15, 25 + b, r1); // fold
  // Ember sash, and a bandolier of tiny clay pots across the chest
  c.hline(11 + sh, 20 + b, 10, P.ember);
  c.hline(11 + sh, 21 + b, 10, mix(P.ember, P.dark1, 0.5));
  if (!back)
    for (let i = 0; i < 4; i++) {
      const px = 12 + i * 2 + sh;
      const py = 15 + i + b;
      c.set(px, py, P.wood2);
      c.set(px + 1, py, P.wood1);
      c.set(px, py - 1, P.flame2);
    }
  else line(c, 12 + sh, 19 + b, 19 + sh, 14 + b, P.wood1);
  // Hood and porcelain mask
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 6 + b + o.hunch + ly;
  c.disc(hx, hy + 3, 4, r1);
  c.ellipse(hx - 1, hy + 2, 3, 3, r2, (x, y) => x + 0.5 - hx + (y + 0.5 - hy - 3) < 0.5);
  c.set(hx - 3, hy + 1, r3);
  c.set(hx, hy - 2, r1);
  c.set(hx, hy - 1, r2);
  if (!back) {
    const mx = dir === 'S' ? hx - 2 : dir === 'SE' ? hx - 1 : hx;
    const mw = dir === 'E' ? 3 : 4;
    c.rect(mx, hy + 2, mw, 4, P.wax2);
    c.vline(mx + mw - 1, hy + 2, 4, P.wax1); // the mask's shaded side
    c.hline(mx, hy + 5, mw, mix(P.wax1, P.stone2, 0.4));
    const eye = o.flinch ? P.ember : P.ink;
    c.set(mx + 1, hy + 3, eye);
    if (dir !== 'E') {
      c.set(mx + 3, hy + 3, eye);
      c.set(mx + 3, hy + 4, P.blood2); // a painted tear
    } else c.set(mx + 1, hy + 4, P.blood2);
  }
  // The pot in hand
  const pot = (px: number, py: number) => {
    c.rect(px - 1, py - 1, 3, 3, P.wood2);
    c.set(px - 1, py - 1, mix(P.wood2, P.wax1, 0.4));
    c.vline(px + 1, py - 1, 3, P.wood1);
    c.set(px, py - 2, P.dark2); // fuse
    c.set(px, py - 3, P.flame2); // lit
  };
  if (o.pot === 'hip') pot(21, 19 + b);
  else if (o.pot === 'raised') pot(hx + 3, hy - 3);
  else if (o.pot === 'forward') pot(16 + Math.round(fx * 8), 14 + Math.round(fy * 6) + b);
  else c.rect(20, 18 + b, 2, 2, P.wax1); // empty hand
}

function acolyteDeath(c: Img, f: number) {
  if (f < 2) {
    drawAcolyte(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true, pot: 'none' });
    return;
  }
  bodyDown(c, cc => drawAcolyte(cc, 'S', { hunch: 1, flinch: true, pot: 'none' }), f, mix(P.blood1, P.dark1, 0.3), -1);
  if (f < 4) c.set(24, 26, P.flame2); // a firepot rolled clear, still lit
  c.disc(24, 27, 1.5, P.wood1);
}

// --- Taper Hound: lean black dog with a lit taper candle on its back.
function drawHound(c: Img, dir: Dir5, pose: { crouch?: number; stretch?: number; head?: number; step?: number; flinch?: boolean }) {
  const o = { crouch: 0, stretch: 0, head: 0, step: -1, flinch: false, ...pose };
  const cr = o.crouch;
  const fur0 = mix(P.ink, P.dark1, 0.5);
  const fur1 = P.dark1;
  const fur2 = mix(P.dark1, P.dark2, 0.7);
  const fur3 = mix(P.dark2, P.stone2, 0.5); // the sheen along the back
  const candle = (x: number, y: number) => {
    c.rect(x, y, 2, 4, P.wax2);
    c.vline(x + 1, y + 1, 3, P.wax1);
    c.set(x - 1, y + 3, P.wax1); // wax run down its flank
    c.set(x + 2, y + 4, P.wax1);
    c.set(x, y - 1, P.ink);
    c.set(x, y - 2, P.flame2);
    c.set(x + 1, y - 3, P.flame1);
  };
  const eye = o.flinch ? P.wax2 : P.ember;
  if (dir === 'S' || dir === 'N') {
    const legs = [13, 18];
    legs.forEach((x, i) => {
      const h = 5 - cr - (o.step === (i ? 3 : 1) ? 1 : 0);
      c.rect(x, 22 + cr, 2, h, i ? fur0 : fur1);
      c.set(x, 22 + cr + h - 1, fur2); // paw
    });
    c.ellipse(16, 20 + cr, 5, 3.5, fur1);
    c.ellipse(15, 19 + cr, 3.5, 2, fur2);
    for (const x of [13, 15, 17]) c.set(x, 21 + cr, fur0); // ribs
    if (dir === 'S') {
      const hy = 16 + cr + (o.head > 0 ? 2 : 0);
      c.disc(16, hy, 3.5, fur1);
      c.ellipse(15, hy - 1, 2.4, 2, fur2);
      c.set(13, hy - 3, fur1); // ears
      c.set(12, hy - 4, fur1);
      c.set(19, hy - 3, fur1);
      c.set(20, hy - 4, fur0);
      c.set(14, hy - 1, eye);
      c.set(17, hy - 1, eye);
      c.rect(15, hy + 2, 2, 2, P.stone1); // muzzle
      c.set(15, hy + 3, P.ink);
      if (o.head > 1) c.hline(14, hy + 5, 4, P.wax2); // bared teeth
    } else {
      c.vline(16, 23 + cr, 3, fur1); // tail
      c.set(16, 26 + cr, fur2);
      c.disc(16, 16 + cr, 3, fur1);
      c.set(14, 13 + cr, fur1);
      c.set(18, 13 + cr, fur1);
      c.hline(15, 17 + cr, 3, fur3);
    }
    candle(15, 12 + cr);
    return;
  }
  // Side views (E / SE / NE), facing right.
  const s = o.stretch;
  const bodyX = 15;
  const bodyY = 20 + cr;
  // Legs: back pair and front pair, alternating stride (far legs darker)
  const stride = o.step === 1 ? 1 : o.step === 3 ? -1 : 0;
  const legTop = bodyY + 2;
  const legLen = Math.max(2, 27 - legTop);
  const legs = [[bodyX - 5 - Math.max(0, s), stride, fur1], [bodyX - 3 - Math.max(0, s), -stride, fur0], [bodyX + 4 + s, -stride, fur0], [bodyX + 6 + s, stride, fur1]] as const;
  for (const [x, d, col] of legs) c.vline(x + d, legTop, s > 1 ? legLen - 2 : legLen, col);
  c.ellipse(bodyX, bodyY, 7 + s, 3, fur1);
  c.ellipse(bodyX - 1, bodyY - 1, 5 + s, 1.6, fur2);
  c.hline(bodyX - 5, bodyY - 2, 9 + s, fur3); // sheen along the spine
  for (const x of [-2, 0, 2]) c.vline(bodyX + x, bodyY + 1, 2, fur0); // ribs
  c.set(bodyX - 8 - s, bodyY - 2, fur1); // tail
  c.set(bodyX - 9 - s, bodyY - 3, fur1);
  c.set(bodyX - 10 - s, bodyY - 3, fur2);
  // Head + snout
  const hx = bodyX + 8 + s + o.head;
  const hy = bodyY - 3 + (dir === 'NE' ? -1 : 0) + (o.head < 0 ? 1 : 0);
  c.disc(hx, hy, 2.6, fur1);
  c.set(hx - 1, hy - 1, fur2);
  c.rect(hx + 2, hy, 3, 2, fur1);
  c.hline(hx + 2, hy, 2, fur2);
  c.set(hx + 4, hy, P.ink);
  c.set(hx - 1, hy - 3, fur1); // ear
  c.set(hx - 2, hy - 4, fur1);
  c.set(hx + 1, hy - 1, eye);
  if (o.head > 1) {
    c.hline(hx + 2, hy + 2, 3, P.wax2); // open jaws
    c.set(hx + 3, hy + 3, P.blood1);
  }
  candle(bodyX - 1, bodyY - 7);
}

function houndDeath(c: Img, f: number) {
  if (f < 2) {
    drawHound(c, 'E', { crouch: 1 + f, flinch: true });
    return;
  }
  c.ellipse(16, 25, 8, 2.5, P.dark1);
  c.disc(24, 24, 2.5, P.dark1);
  c.rect(11, 22, 2, 3, P.wax2);
  if (f < 4) c.set(11, 21, P.flame1);
}

// --- Belfry Brute (48x48): a hulking bell-ringer wearing a bronze bell as a helm.
const BRUTE_HAND: Record<Dir5, [number, number]> = { S: [36, 30], SE: [35, 29], E: [32, 29], NE: [34, 27], N: [34, 27] };

function drawBrute(c: Img, dir: Dir5, pose: BodyPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const skin0 = mix(P.wax1, P.wood1, 0.55);
  const skin1 = mix(P.wax1, P.wood2, 0.35);
  const skin2 = P.wax1;
  const skin3 = P.wax2;
  const br0 = mix(P.ember, P.wood1, 0.5);
  const br1 = P.ember;
  const br2 = P.flame1;
  const br3 = P.flame2;
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  // Legs: wrapped in rags, heavy boots
  c.rect(16, 34 + b, 6, 7 - liftL, P.dark2);
  c.vline(16, 34 + b, 7 - liftL, mix(P.dark2, P.stone2, 0.4));
  for (let y = 35; y < 40; y += 2) c.hline(16, y + b - liftL, 6, P.dark1);
  c.rect(15, 41 - liftL, 7, 3, P.wood1);
  c.hline(15, 41 - liftL, 7, P.wood2);
  c.rect(26, 34 + b, 6, 7 - liftR, mix(P.dark2, P.dark1, 0.5));
  for (let y = 35; y < 40; y += 2) c.hline(26, y + b - liftR, 6, P.dark1);
  c.rect(26, 41 - liftR, 7, 3, mix(P.wood1, P.dark1, 0.4));
  // Barrel chest, shaded; leather apron with straps; huge arms
  c.ellipse(24 + sh, 26 + b, 12, 10, skin1);
  c.ellipse(21 + sh, 24 + b, 8, 7, skin2);
  c.ellipse(19 + sh, 22 + b, 4, 3, skin3);
  c.ellipse(29 + sh, 29 + b, 6, 6, skin0, (x, y) => x - (24 + sh) + (y - 26 - b) > 6);
  c.rect(17 + sh, 29 + b, 14, 7, P.wood1);
  c.hline(17 + sh, 29 + b, 14, P.wood2);
  c.vline(17 + sh, 29 + b, 7, P.wood2);
  c.vline(30 + sh, 29 + b, 7, mix(P.wood1, P.dark1, 0.5));
  if (!back) {
    line(c, 18 + sh, 18 + b, 20 + sh, 29 + b, P.wood1); // apron straps
    line(c, 30 + sh, 18 + b, 28 + sh, 29 + b, P.wood1);
    c.set(24 + sh, 32 + b, EN.steel3); // a bell-rope ring on the apron
  } else line(c, 17 + sh, 20 + b, 31 + sh, 27 + b, P.wood1); // strap across the back
  const arm = (ax: number, lit: boolean) => {
    c.ellipse(ax, 28 + b, 3.5, 7, lit ? skin1 : skin0);
    c.ellipse(ax - 1, 26 + b, 2, 4, lit ? skin2 : skin1);
    for (const y of [30, 32]) c.hline(ax - 3, y + b, 7, P.wood1); // rope wrapped round the forearm
  };
  arm(11 + sh + o.sway, true);
  arm(37 + sh + o.sway, false);
  // Bronze bell helm, banded, with a verdigris line at the rim
  const hx = 24 + lx + (o.flinch ? -2 : 0);
  const top = 6 + b + o.hunch + ly;
  for (let y = 0; y <= 13; y++) {
    const half = Math.round(4 + y * 0.45);
    const x0 = hx - half;
    const w = half * 2;
    c.hline(x0, top + y, w, br2);
    c.hline(x0 + w - 3, top + y, 3, br1);
    c.set(x0 + w - 1, top + y, br0);
    c.hline(x0 + 1, top + y, 2, br3);
    c.set(x0, top + y, br2);
  }
  for (const y of [4, 9]) {
    const half = Math.round(4 + y * 0.45);
    c.hline(hx - half, top + y, half * 2, br1); // cast bands
  }
  c.hline(hx - 10, top + 14, 20, P.dark2); // rim
  c.hline(hx - 9, top + 13, 18, mix(br1, P.teal2, 0.5)); // verdigris
  c.rect(hx - 1, top - 2, 2, 2, br1); // crown loop
  c.set(hx - 1, top - 2, br3);
  if (!back) {
    const sx = dir === 'S' ? hx - 3 : dir === 'SE' ? hx - 1 : hx + 2;
    c.hline(sx, top + 10, dir === 'E' ? 4 : 6, P.ink);
    c.hline(sx, top + 11, dir === 'E' ? 4 : 6, br0);
    c.set(sx + 1, top + 10, o.flinch ? P.wax2 : P.flame2);
    if (dir !== 'E') c.set(sx + 4, top + 10, o.flinch ? P.wax2 : P.flame2);
  }
  const [ax, ay] = BRUTE_HAND[dir];
  c.rect(ax - 2, ay - 2 + b, 4, 4, skin2);
  c.hline(ax - 2, ay + 1 + b, 4, skin0);
}

function bruteDeath(c: Img, f: number) {
  if (f < 2) {
    drawBrute(c, 'S', { bob: 3 + f * 2, hunch: 3 + f, flinch: true });
    return;
  }
  bodyDown(c, cc => drawBrute(cc, 'S', { hunch: 2, flinch: true }), f, P.blood1);
}

// --- The Tollwarden (48x48): the Abbey's gatekeeper. Tall iron barbute with a coin-slot visor and pale
// candle eyes, a long toll-collector's coat in old red, gilt buttons, a ring of keys at the hip, a halberd.
const TOLL_HAND: Record<Dir5, [number, number]> = { S: [34, 27], SE: [33, 26], E: [30, 26], NE: [32, 24], N: [32, 24] };

/** arm: halberd hand raised overhead (0..1); reach: hand drawn back (-) or driven forward (+); toss: off hand flung out. */
type TollPose = BodyPose & { kneel?: boolean; arm?: number; reach?: number; toss?: number; flick?: number };

/** Where the weapon hand is for a pose (cell pixels). Drawing and the manifest both use it, so the halberd follows the arm. */
function tollHand(dir: Dir5, p: TollPose): [number, number] {
  const [hx, hy] = TOLL_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const arm = p.arm ?? 0;
  const reach = p.reach ?? 0;
  return [
    Math.round(hx + lx + reach * 6 * fx - arm * 3 * fx - (dir === 'S' ? arm * 3 : 0)),
    Math.round(hy + (p.bob ?? 0) + ly + reach * 4 * fy - arm * 15),
  ];
}

function drawTollwarden(c: Img, dir: Dir5, pose: TollPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, kneel: false, arm: 0, reach: 0, toss: 0, flick: 0, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx, fy] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const E = EN;
  const coat = { c0: hex('#3a0d14'), c1: P.blood1, c2: P.blood2, c3: hex('#cf5058') };
  const gold0 = mix(P.flame1, P.wood1, 0.45);
  // Legs: armoured greaves under the coat (or folded, kneeling)
  if (o.kneel) {
    c.rect(15, 40, 9, 3, E.steel2);
    c.hline(15, 40, 9, E.steel3);
    c.rect(26, 38, 3, 5, E.steel1);
    c.rect(24, 42, 8, 2, E.steel0);
  } else {
    const liftL = o.step === 1 ? 2 : 0;
    const liftR = o.step === 3 ? 2 : 0;
    for (const [x, lift, lit] of [[18, liftL, true], [27, liftR, false]] as const) {
      c.rect(x, 34 + b, 4, 8 - lift, lit ? E.steel2 : E.steel1);
      c.vline(x, 34 + b, 8 - lift, lit ? E.steel3 : E.steel2);
      c.hline(x, 37 + b, 4, E.steel0); // knee plate
      c.rect(x - 1, 42 - lift, 6, 2, E.steel0);
      c.hline(x - 1, 42 - lift, 6, E.steel1);
    }
  }
  // The long coat: widening from the shoulders to the knees, tails flaring as he turns
  for (let y = 17; y <= 38; y++) {
    const half = Math.round(7 + (y - 17) * 0.28);
    const flare = y > 29 ? Math.round((o.sway * (y - 29)) / 6) : 0;
    shadedRow(c, 24 + sh - half + flare, y + b, half * 2, coat.c0, coat.c1, coat.c2, coat.c3);
  }
  const hemL = 24 + sh - 13 + Math.round((o.sway * 9) / 6);
  c.hline(hemL, 38 + b, 26, P.flame1); // gilt hem
  c.hline(hemL, 39 + b, 26, gold0);
  if (!back) {
    // the coat hangs open below the belt: dark under-tunic in the slit, gilt edging either side
    for (let y = 29; y <= 38; y++) {
      const w = Math.round((y - 29) / 4);
      c.hline(24 + sh - w + Math.round((o.sway * (y - 29)) / 6), y + b, w * 2 + 1, coat.c0);
    }
    line(c, 23 + sh, 29 + b, 20 + sh + o.sway, 38 + b, P.flame1);
    line(c, 25 + sh, 29 + b, 28 + sh + o.sway, 38 + b, gold0);
  } else {
    c.vline(24 + sh, 29 + b, 10, coat.c0); // the vent at the back
    for (const x of [18, 30]) line(c, x + sh, 20 + b, x + sh + o.sway, 37 + b, coat.c1); // back seams
  }
  // Breastplate with brass studs; belt with the ring of keys and the toll purse
  if (!back) {
    c.rect(19 + sh, 18 + b, 10, 10, E.steel2);
    c.vline(19 + sh, 18 + b, 10, E.steel3);
    c.vline(20 + sh, 19 + b, 8, mix(E.steel2, E.steel3, 0.4));
    c.vline(28 + sh, 18 + b, 10, E.steel0);
    for (const y of [22, 25]) c.hline(19 + sh, y + b, 10, E.steel1); // lames
    const bx = 24 + sh + (dir === 'E' ? 2 : 0);
    for (const y of [20, 23, 26]) {
      c.set(bx, y + b, P.flame2);
      c.set(bx, y + b + 1, gold0);
    }
  }
  c.hline(16 + sh, 28 + b, 16, P.dark1);
  c.hline(16 + sh, 29 + b, 16, P.wood1);
  if (!back) c.rect(23 + sh + (dir === 'E' ? 2 : 0), 28 + b, 2, 2, P.flame1); // buckle
  // ring of keys at the left hip
  c.disc(17 + sh, 31 + b, 2, gold0);
  c.disc(17 + sh, 31 + b, 1, coat.c1);
  c.set(16 + sh, 30 + b, P.flame2);
  for (const [x, l] of [[16, 3], [18, 2]]) {
    c.vline(x + sh, 33 + b, l, gold0);
    c.set(x + sh, 33 + b + l, P.flame1);
  }
  // the toll purse at the right hip, a coin winking at its mouth
  if (dir !== 'N') {
    c.ellipse(30 + sh, 32 + b, 2.5, 2.5, P.wood1);
    c.set(29 + sh, 31 + b, P.wood2);
    c.hline(29 + sh, 30 + b, 3, P.dark1);
    c.set(31 + sh, 30 + b, P.flame2);
  }
  // Off-hand arm: hangs at his side, or flung out to toss the coins
  const lsx = 16 + sh;
  const lsy = 20 + b;
  const lh: [number, number] =
    o.toss > 0 ? [Math.round(24 + sh + fx * 11 * o.toss - (dir === 'S' ? 7 : 0)), Math.round(22 + b + fy * 5 * o.toss - o.toss * 6)] : [14 + sh + o.sway, 30 + b];
  for (let t = 0; t <= 1; t++) line(c, lsx + t, lsy, lh[0] + t, lh[1] - 2, t ? coat.c1 : coat.c2);
  c.rect(lh[0] - 1, lh[1] - 2, 3, 3, E.steel2);
  c.set(lh[0] - 1, lh[1] - 2, E.steel3);
  if (o.toss > 0.9) for (const [dx, dy] of [[2, -2], [3, 0], [1, -3]]) c.set(lh[0] + dx * (fx < 0 ? -1 : 1), lh[1] + dy, P.flame2); // coins leaving the hand
  // Pauldrons: two lames each, lit from the left
  for (const [x, lit] of [[15, true], [33, false]] as const) {
    c.ellipse(x + sh, 19 + b, 4, 3, lit ? E.steel2 : E.steel1);
    c.hline(x + sh - 3, 18 + b, 4, lit ? E.steel3 : E.steel2);
    c.hline(x + sh - 3, 21 + b, 7, E.steel0);
    c.set(x + sh, 19 + b, P.flame1); // rivet
  }
  // Weapon arm: sleeve from the shoulder to the halberd hand
  const [ax, ay] = tollHand(dir, o);
  for (let t = 0; t <= 1; t++) line(c, 32 + sh + t, 20 + b, ax + t, ay - 1, t ? coat.c1 : coat.c2);
  // Tall barbute: a T-shaped visor with a coin slot below it, and a brass toll bell for a crest
  const hx = 24 + lx + (o.flinch ? -2 : 0);
  const hy = Math.max(1, 5 + b + o.hunch + ly);
  c.rect(hx - 5, hy, 10, 13, E.steel2);
  c.rect(hx - 4, hy - 1, 8, 1, E.steel2);
  c.vline(hx - 5, hy, 13, E.steel3);
  c.vline(hx - 4, hy - 1, 12, mix(E.steel2, E.steel3, 0.5));
  c.hline(hx - 3, hy - 1, 4, E.steel3);
  c.vline(hx + 4, hy, 13, E.steel0);
  c.vline(hx + 3, hy + 1, 11, E.steel1);
  c.hline(hx - 5, hy + 12, 10, E.steel0);
  for (const y of [2, 10]) {
    c.set(hx - 4, hy + y, P.flame1); // rivets
    c.set(hx + 3, hy + y, P.flame1);
  }
  // the bell (kept inside the cell even when he rears back)
  const by = Math.max(hy, 4);
  c.hline(hx - 1, by - 4, 2, P.flame1);
  c.set(hx - 1, by - 4, P.flame2);
  c.hline(hx - 2, by - 3, 4, P.flame1);
  c.set(hx - 2, by - 3, P.flame2);
  c.hline(hx - 2, by - 2, 5, gold0);
  c.set(hx, by - 1, P.dark2); // clapper
  if (!back) {
    const eye = o.flinch ? P.ember : o.flick ? P.flame2 : P.wax2;
    const vx = dir === 'S' ? hx - 4 : dir === 'SE' ? hx - 2 : hx;
    const vw = dir === 'E' ? 5 : 8;
    c.hline(vx, hy + 5, vw, P.ink);
    c.hline(vx, hy + 4, vw, E.steel1); // brow over the slit
    c.set(vx + 2, hy + 5, eye);
    if (dir !== 'E') c.set(vx + 5, hy + 5, eye);
    const sx = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 2;
    c.vline(sx, hy + 6, 5, P.ink); // the coin slot
    c.vline(sx + 1, hy + 7, 3, E.steel3);
  } else c.vline(hx, hy + 1, 11, E.steel1); // crest ridge
  // Gauntlet at the weapon hand
  c.rect(ax - 2, ay - 2, 4, 4, E.steel2);
  c.hline(ax - 2, ay - 2, 4, E.steel3);
  c.set(ax + 1, ay + 1, E.steel0);
}

function tollwardenDeath(c: Img, f: number) {
  // He doesn't fall: he sinks to his knees and stays there, head bowed, for his last words.
  if (f < 2) drawTollwarden(c, 'S', { bob: 1 + f, hunch: 1 + f, lean: -1, flinch: true });
  else drawTollwarden(c, 'S', { bob: 5, hunch: 2 + Math.min(f - 2, 2), kneel: true });
}

function genTollwarden() {
  const P7 = phased7();
  type Anim = { name: string; poses: TollPose[]; timing: { ticks: number; phase?: string; events?: string[] }[]; loop: boolean };
  const anim = (a: Anim) => ({
    name: a.name,
    frames: a.poses.map(p => (c: Img, d: Dir5) => drawTollwarden(c, d, p)),
    timing: a.timing,
    loop: a.loop,
    hand: (d: Dir5, f: number) => tollHand(d, a.poses[f]),
  });
  rosterSheet(
    'tollwarden',
    48,
    [24, 44],
    7,
    [
      anim({ name: 'idle', poses: [{}, { flick: 1 }, { bob: 1 }, { bob: 1, flick: 1 }], timing: [{ ticks: 16 }, { ticks: 10 }, { ticks: 16 }, { ticks: 10 }], loop: true }),
      anim({ name: 'walk', poses: [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(11), loop: true }),
      // Toll sweep: the halberd hauled back past his hip, then swept across the whole front
      anim({
        name: 'sweep',
        poses: [
          { reach: -0.6, sway: -1, lean: -1 },
          { reach: -1, sway: -2, lean: -2, arm: 0.3 },
          { reach: -1.1, sway: -2, lean: -2, arm: 0.3, bob: 1 },
          { reach: 1, sway: 2, lean: 3 },
          { reach: 1.2, sway: 2, lean: 3 },
          { reach: 0.5, sway: 1, lean: 1 },
          {},
        ],
        timing: P7,
        loop: false,
      }),
      // Last call: drawn far back and held (the delayed thrust), then driven through
      anim({
        name: 'thrust',
        poses: [
          { reach: -0.5, lean: -1 },
          { reach: -1.2, lean: -3, hunch: 1 },
          { reach: -1.4, lean: -3, hunch: 1, bob: 1 },
          { reach: 1.7, lean: 4, sway: 1 },
          { reach: 1.7, lean: 4, bob: 1, sway: 1 },
          { reach: 0.8, lean: 2 },
          {},
        ],
        timing: P7,
        loop: false,
      }),
      // Gate drop: raised high over the helm, then brought down like a portcullis
      anim({
        name: 'slam',
        poses: [
          { arm: 0.5, bob: -1, lean: -1 },
          { arm: 1, bob: -2, hunch: -2, lean: -2 },
          { arm: 1.1, bob: -2, hunch: -2, lean: -3 },
          { reach: 1.2, bob: 2, hunch: 2, lean: 3 },
          { reach: 1.2, bob: 3, hunch: 2, lean: 3, sway: 1 },
          { reach: 0.5, bob: 2, lean: 2 },
          {},
        ],
        timing: P7,
        loop: false,
      }),
      // The entrance: rears back with the halberd raised, drives it into the stones (the slam lands on the
      // third frame, 20 ticks into each 40-tick cycle), straightens.
      anim({
        name: 'intro',
        poses: [{ arm: 0.7, lean: -2, bob: -1, hunch: -1 }, { arm: 1.1, lean: -3, bob: -2, hunch: -2 }, { reach: 1.2, lean: 3, bob: 2, hunch: 2 }, { reach: 0.3, lean: 1 }],
        timing: [{ ticks: 12 }, { ticks: 8 }, { ticks: 4 }, { ticks: 16 }],
        loop: true,
      }),
      // Toll: a hand into the purse, and a fistful of coins flung at you
      anim({
        name: 'toss',
        poses: [{ toss: 0.2 }, { toss: 0.5, lean: -1 }, { toss: 0.5, lean: -2, hunch: 1 }, { toss: 1.1, lean: 2 }, { toss: 1.1, lean: 2 }, { toss: 0.5, lean: 1 }, {}],
        timing: P7,
        loop: false,
      }),
      anim({ name: 'stagger', poses: [{ lean: -2, flinch: true, arm: 0.3 }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], timing: staggerT, loop: false }),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => tollwardenDeath(c, f)),
    TOLL_HAND,
  );

  // The halberd: ash haft bound in iron, crescent axe, a spike at the tip, a hook behind
  const hal = new Img(46, 13);
  hal.hline(1, 6, 36, P.wood2);
  hal.hline(1, 7, 36, P.wood1);
  for (const x of [8, 20]) hal.vline(x, 6, 2, EN.steel1); // iron bands
  hal.rect(0, 5, 2, 4, P.flame1); // butt cap
  for (let y = 1; y <= 11; y++) {
    const w = Math.round(4 - Math.abs(y - 6) * 0.5);
    hal.hline(33, y, w, y < 6 ? EN.steel3 : EN.steel2);
    hal.set(33 + w - 1, y, P.steel2); // the edge
  }
  hal.vline(33, 1, 11, EN.steel1);
  hal.hline(37, 6, 7, EN.steel3);
  hal.hline(37, 7, 6, EN.steel1);
  hal.set(44, 6, P.steel2);
  hal.rect(29, 4, 2, 2, EN.steel1); // back hook
  hal.set(28, 3, EN.steel2);
  hal.outline(P.ink);
  sheet('toll_halberd', hal, { cell: [46, 13], pivot: [9, 6], layer: 'weapon', points: { tip: [44, 6] } });

  // A toll coin, spinning (thrown by the Toll attack)
  const coin = new Img(7, 7);
  coin.disc(3.5, 3.5, 3, P.flame1);
  coin.disc(3, 3, 1.8, P.flame2);
  coin.set(4, 4, mix(P.flame1, P.wood1, 0.5));
  coin.set(2, 2, P.white);
  coin.outline(P.ink);
  sheet('toll_coin', coin, { cell: [7, 7], pivot: [3, 3], layer: 'fx' });

  // Smoke veil (16x32, pivot 8,32): pale smoke rolling up through a sealed doorway, 4 looping frames
  const veil = new Img(16 * 4, 32);
  for (let f = 0; f < 4; f++) {
    const r = rng(7000);
    for (let i = 0; i < 14; i++) {
      const x = f * 16 + 2 + r() * 12;
      const y = (r() * 32 - f * 5 + 64) % 30;
      veil.ellipse(x, y + 1, 2 + r() * 2.5, 2 + r() * 2, withAlpha(i % 3 ? P.stone3 : P.stone4, 150));
    }
    for (let i = 0; i < 5; i++) veil.set(f * 16 + 2 + Math.floor(r() * 12), Math.floor((r() * 30 - f * 7 + 60) % 30), withAlpha(P.wax2, 200));
  }
  sheet('smoke_veil', veil, { cell: [16, 32], pivot: [8, 32], layer: 'fx' });
}

// =============================================================== THE TALLOW WORKS
// --- Renderer: a gaunt worker in a leather apron and hood, a hook on a chain.
const RENDER_HAND: Record<Dir5, [number, number]> = { S: [21, 18], SE: [21, 17], E: [18, 17], NE: [20, 16], N: [20, 16] };

function drawRenderer(c: Img, dir: Dir5, pose: BodyPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const cl0 = mix(P.stone1, P.ink, 0.45);
  const cl1 = P.stone1;
  const cl2 = mix(P.stone1, P.stone2, 0.5);
  const lea1 = mix(P.wood1, P.dark2, 0.3);
  const lea2 = P.wood2;
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  c.rect(13, 22 + b, 2, 5 - liftL, P.dark2); // thin legs
  c.rect(12, 27 - liftL, 3, 1, P.dark1);
  c.rect(17, 22 + b, 2, 5 - liftR, P.dark1);
  c.rect(17, 27 - liftR, 3, 1, P.dark1);
  // Tall narrow body under a greasy leather apron
  c.rect(12 + sh, 12 + b, 8, 11, cl1);
  c.vline(12 + sh, 12 + b, 11, cl2);
  c.vline(19 + sh, 12 + b, 11, cl0);
  if (!back) {
    c.rect(13 + sh, 14 + b, 6, 9, lea2);
    c.vline(13 + sh, 14 + b, 9, mix(lea2, P.wax1, 0.3));
    c.vline(18 + sh, 14 + b, 9, lea1);
    c.hline(13 + sh, 14 + b, 6, lea1); // bib edge
    // tallow smeared down the front
    for (const [x, y] of [[15, 16], [15, 17], [16, 20], [17, 18]]) c.set(x + sh, y + b, P.wax1);
    c.set(14 + sh, 21 + b, P.blood1);
  } else {
    line(c, 12 + sh, 13 + b, 19 + sh, 19 + b, lea1); // apron strings crossing the back
    line(c, 19 + sh, 13 + b, 12 + sh, 19 + b, lea1);
  }
  c.hline(12 + sh, 20 + b, 8, P.dark1); // belt, a spare hook hanging from it
  c.set(19 + sh, 21 + b, EN.steel3);
  c.set(19 + sh, 22 + b, EN.steel2);
  // long arms, gloved
  c.rect(10 + sh + o.sway, 13 + b, 2, 8, cl1);
  c.set(10 + sh + o.sway, 13 + b, cl2);
  c.rect(10 + sh + o.sway, 20 + b, 2, 2, lea1);
  c.rect(20 + sh + o.sway, 13 + b, 2, 8, cl0);
  c.rect(20 + sh + o.sway, 20 + b, 2, 2, lea1);
  // Hood, a pale face half hidden behind a mouth-cloth
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 4 + b + o.hunch + ly;
  c.rect(hx - 3, hy, 6, 8, P.dark2);
  c.rect(hx - 2, hy - 1, 4, 1, P.dark2);
  c.vline(hx - 3, hy, 8, mix(P.dark2, P.stone2, 0.4));
  c.vline(hx + 2, hy, 8, P.dark1);
  c.set(hx - 1, hy - 2, P.dark2); // hood point
  if (!back) {
    const fx = dir === 'S' ? hx - 2 : dir === 'SE' ? hx - 1 : hx;
    const fw = dir === 'E' ? 3 : 4;
    c.rect(fx, hy + 3, fw, 3, P.wax1);
    c.hline(fx, hy + 3, fw, mix(P.wax1, P.dark2, 0.4)); // brow in the hood's shadow
    c.hline(fx, hy + 5, fw, P.stone3); // mouth-cloth
    c.hline(fx, hy + 6, fw, P.stone2);
    c.set(fx + 1, hy + 4, o.flinch ? P.ember : P.ink);
    if (dir !== 'E') c.set(fx + 3, hy + 4, o.flinch ? P.ember : P.ink);
  }
}
function rendererDeath(c: Img, f: number) {
  if (f < 2) {
    drawRenderer(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true });
    return;
  }
  bodyDown(c, cc => drawRenderer(cc, 'S', { hunch: 1, flinch: true }), f, mix(P.wax1, P.wood1, 0.45)); // grease, not blood
}

// --- Vat Crawler: a heap of half-rendered wax that drags itself along; a guttering wick on top.
function drawCrawler(c: Img, _dir: Dir5, pose: BodyPose & { size?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, size: 1, ...pose };
  const s = o.size;
  const sq = o.bob * 0.6; // squash: wider and lower as it gathers itself
  const w = 9 * s + sq;
  const h = 6 * s - sq * 0.6;
  const cx = 16 + o.lean;
  const cy = 26 - h;
  const w0 = mix(P.wax1, P.wood1, 0.45);
  const w1 = mix(P.wax1, P.wood2, 0.2);
  c.ellipse(cx, cy + h * 0.4, w, h, w1);
  c.ellipse(cx + w * 0.25, cy + h * 0.75, w * 0.75, h * 0.55, w0, (_x, y) => y > cy + h * 0.5); // heavy, shaded underside
  c.ellipse(cx - w * 0.2, cy + h * 0.1, w * 0.62, h * 0.7, P.wax1);
  c.ellipse(cx - w * 0.35, cy - h * 0.1, w * 0.3, h * 0.35, P.wax2); // gloss
  c.set(Math.round(cx - w * 0.45), Math.round(cy - h * 0.25), P.white);
  // half-rendered things still inside it: a rib, a knuckle
  if (s >= 1) {
    c.hline(Math.round(cx + 2), Math.round(cy + h * 0.5), 3, mix(P.wax1, P.stone3, 0.5));
    c.set(Math.round(cx - 4), Math.round(cy + h * 0.6), mix(P.wax2, P.stone3, 0.4));
  }
  for (const d of [-0.6, 0.1, 0.7]) {
    const dx = Math.round(cx + w * d);
    c.vline(dx, Math.round(cy + h * 0.9), 2, w1); // drips
    c.set(dx, Math.round(cy + h * 0.9) + 2, w0);
  }
  const eye = o.flinch ? P.ember : P.ink;
  for (const ex of [cx - 2 * s, cx + 2 * s]) {
    c.set(Math.round(ex), Math.round(cy) - 1, w0); // sunken sockets
    c.set(Math.round(ex), Math.round(cy), eye);
  }
  c.hline(Math.round(cx - 1), Math.round(cy + 2 * s), 2, w0); // slack mouth
  c.vline(Math.round(cx + 1), Math.round(cy - h - 1), 2, P.dark2); // wick
  if (!o.flinch) {
    c.set(Math.round(cx + 1), Math.round(cy - h - 2), P.flame2);
    c.set(Math.round(cx + 1), Math.round(cy - h - 3), P.flame1);
  }
}
function crawlerDeath(c: Img, f: number, size: number) {
  if (f < 2) {
    drawCrawler(c, 'S', { bob: 3 + f * 2, flinch: true, size });
    return;
  }
  c.ellipse(16, 26, 9 * size + f, 2.5, P.wax1);
  c.ellipse(13, 25, 3 * size, 1.5, P.wax2);
}

// --- Mother Tallow (64x64): the Works' keeper, drowned in her own vat long ago and never stopped working.
// A vast shape of wax in a rendering-woman's smock, a dozen guttering wicks along her shoulders, a ladle.
const MOTHER_HAND: Record<Dir5, [number, number]> = { S: [48, 36], SE: [47, 35], E: [43, 35], NE: [46, 33], N: [46, 33] };

/** rise: sunk into her pool; arm: ladle hand raised; reach: hand swung back (-) or out (+); both: both arms up (the crush);
 * mouth: open (spitting); tip: ladle tipped out over you (spilling); flick: the wick flames' other frame. */
type MotherPose = BodyPose & { rise?: number; arm?: number; reach?: number; both?: number; mouth?: number; tip?: number; flick?: number };

const WAXR = {
  w0: mix(P.wax1, P.wood1, 0.55),
  w1: mix(P.wax1, P.wood2, 0.25),
  w2: P.wax1,
  w3: P.wax2,
};

function motherHand(dir: Dir5, p: MotherPose): [number, number] {
  const [hx, hy] = MOTHER_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const up = Math.max(p.arm ?? 0, p.both ?? 0) + (p.tip ?? 0) * 0.6;
  const reach = (p.reach ?? 0) + (p.tip ?? 0) * 0.8;
  const y = hy + (p.bob ?? 0) + (p.rise ?? 0) + ly + reach * 5 * fy - up * 16;
  return [Math.round(hx + lx + (p.sway ?? 0) + reach * 8 * fx - up * 4 * fx), Math.round(Math.min(54, y))];
}

function drawMother(c: Img, dir: Dir5, pose: MotherPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, arm: 0, reach: 0, both: 0, mouth: 0, tip: 0, flick: 0, ...pose };
  const b = o.bob + o.rise; // rise: sunk into her wax pool (intro), 0 = full height
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const W = WAXR;
  const smock = { s0: mix(P.stone1, P.wood1, 0.35), s1: mix(P.stone2, P.wood1, 0.25), s2: mix(P.stone3, P.wood2, 0.25), s3: mix(P.stone3, P.wax1, 0.3) };
  // Her pool of wax, always around her: a pale rim, a sheen, slow ripples
  c.ellipse(32, 58, 23, 5.5, W.w0);
  c.ellipse(32, 57.5, 22, 4.5, W.w2);
  c.ellipse(25, 56.5, 9, 1.6, W.w3);
  c.hline(40, 59, 8, W.w1);
  c.hline(14, 58, 5, W.w1);
  // Body: a great bell of wax under a stained smock; the wax runs out of the smock's hem in a ragged curtain
  const shadeAt = (t: number, r: { c0: RGBA; c1: RGBA; c2: RGBA; c3: RGBA }) => (t < 0.1 ? r.c3 : t < 0.2 ? mix(r.c2, r.c3, 0.5) : t > 0.93 ? r.c0 : t > 0.8 ? r.c1 : r.c2);
  const wr = { c0: W.w0, c1: W.w1, c2: W.w2, c3: W.w3 };
  const sr = { c0: smock.s0, c1: smock.s1, c2: smock.s2, c3: smock.s3 };
  const curtain = (x: number) => 44 + ((x * 7) % 5) - ((x * 3) % 4) + (x % 6 === 0 ? 3 : 0);
  for (let y = 22; y <= 56; y++) {
    if (y + b > 57) continue;
    const half = Math.round(10 + (y - 22) * 0.38);
    const x0 = 32 + sh - half;
    for (let x = x0; x < x0 + half * 2; x++) {
      const t = (x - x0) / Math.max(1, half * 2 - 1);
      c.set(x, y + b, shadeAt(t, y > curtain(x - sh) ? wr : sr));
    }
  }
  if (!back) {
    // the bib: a tapered apron hung from her neck, stained with what she renders
    for (let y = 30; y <= 43; y++) {
      const hw = 5 + Math.round((y - 30) * 0.25);
      c.hline(32 + sh - hw, y + b, hw * 2, smock.s3);
      c.set(32 + sh - hw, y + b, mix(smock.s3, P.wax2, 0.4));
      c.set(32 + sh + hw - 1, y + b, smock.s2);
    }
    line(c, 27 + sh, 30 + b, 29 + sh, 24 + b, smock.s2); // neck strap
    line(c, 37 + sh, 30 + b, 35 + sh, 24 + b, smock.s1);
    c.rect(29 + sh, 36 + b, 6, 4, smock.s2); // pocket
    c.hline(29 + sh, 36 + b, 6, smock.s1);
    for (const [x, y, col] of [[28, 33, P.blood1], [35, 38, P.blood1], [31, 32, W.w1], [36, 34, W.w0], [28, 41, W.w1], [33, 42, W.w1]] as const) c.set(x + sh, y + b, col);
  } else {
    line(c, 23 + sh, 28 + b, 41 + sh, 40 + b, smock.s1); // apron strings
    c.rect(30 + sh, 38 + b, 4, 3, smock.s1); // the bow
  }
  // wicks growing from her shoulders, like candles on a cake
  for (const [x, y] of [[-12, 25], [-9, 23], [10, 23], [13, 25]]) {
    c.vline(32 + sh + x, y + b - 2, 2, P.dark2);
    c.set(32 + sh + x, y + b - 3, o.flinch ? P.ember : (x + o.flick) % 2 ? P.flame1 : P.flame2);
  }
  // Arms: thick wax, the smock sleeves rolled to the elbow. The right hand holds the ladle.
  const [ax, ay] = motherHand(dir, o);
  const lUp = o.both;
  const lHand: [number, number] = [Math.round(17 + sh + o.sway - lUp * 2 - (o.tip > 0 ? 0 : 0)), Math.round(Math.min(54, 42 + b - lUp * 18))];
  const arm = (sx: number, hand: [number, number], lit: boolean) => {
    const sy = 26 + b;
    for (let t = -3; t <= 3; t++) line(c, sx + t, sy, hand[0] + Math.round(t * 0.7), hand[1] - 2, t < -1 && lit ? W.w2 : t > 1 ? W.w0 : W.w1);
    const mx = Math.round((sx + hand[0]) / 2);
    const my = Math.round((sy + hand[1]) / 2);
    c.hline(mx - 3, my - 3, 7, smock.s2); // rolled sleeve at the elbow
    c.hline(mx - 3, my - 2, 7, smock.s1);
    c.ellipse(hand[0], hand[1], 3, 2.6, W.w1); // a big soft hand
    c.ellipse(hand[0] - 0.8, hand[1] - 0.8, 1.8, 1.4, W.w2);
    c.set(hand[0] - 2, hand[1] - 2, W.w3);
  };
  arm(22 + sh, lHand, true);
  arm(42 + sh, [ax, ay], false);
  if (o.tip > 0.5) for (const k of [1, 2, 3]) c.set(ax + Math.round(fx * 4), ay + 2 + k * 3, W.w2); // spilling
  // Head: half melted, the face slid to one side; hair of lit wicks
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 10 + b + o.hunch + ly;
  c.ellipse(hx, hy + 7, 8, 9, W.w1);
  c.ellipse(hx - 1.5, hy + 5, 6, 6.5, W.w2);
  c.ellipse(hx - 3, hy + 2, 2.5, 2, W.w3);
  c.ellipse(hx + 3, hy + 13, 5, 4, W.w1); // the slid-down cheek
  c.hline(hx + 1, hy + 16, 6, W.w0);
  if (!back) {
    const f0 = dir === 'S' ? hx : dir === 'SE' ? hx + 2 : hx + 4;
    c.rect(f0 - 4, hy + 5, 3, 2, W.w0); // sockets
    c.set(f0 - 3, hy + 6, P.ink);
    c.rect(f0 + 1, hy + 6, 3, 2, W.w0);
    c.set(f0 + 2, hy + 7, P.ink);
    c.set(f0 + 2, hy + 8, W.w3); // the eye weeping wax
    const mh = 1 + Math.round(o.mouth * 3);
    c.rect(f0 - 2, hy + 11, 4, mh, o.flinch ? P.ember : P.dark2); // a humming mouth, or wide open to spit
    if (o.mouth > 0.5) c.rect(f0 - 1, hy + 12, 2, mh - 1, P.flame1); // the molten wax in her throat
  }
  for (const [x, y] of [[-7, 0], [-4, -3], [0, -4], [4, -3], [7, 0]]) {
    c.vline(hx + x, hy + y, 2, P.dark2);
    c.set(hx + x, hy + y - 1, o.flinch ? P.ember : (x + o.flick) % 2 ? P.flame1 : P.flame2);
    if (!o.flinch && (x + o.flick) % 2 === 0) c.set(hx + x, hy + y - 2, mix(P.flame1, P.ember, 0.4));
  }
}
function motherDeath(c: Img, f: number) {
  // She sinks back into her wax and the wicks go out one by one.
  const rise = [2, 6, 14, 22, 30][f];
  drawMother(c, 'S', { rise, flinch: f < 2, hunch: f });
}

// --- The Bones of Mother Tallow (64x64): what is left when the wax burns away. A tall, stooped skeleton
// with embers smouldering in the ribs and eye sockets, still holding the ladle.
type BonePose = BodyPose & { rise?: number; spread?: number; reach?: number; flick?: number };
const BONE = { b0: mix(P.stone3, P.dark2, 0.3), b1: P.stone4, b2: mix(P.wax1, P.stone4, 0.3), b3: P.wax2, char: mix(P.dark1, P.wood1, 0.3) };

/** Right (ladle) hand for a pose, in cell pixels. */
function boneHandAt(dir: Dir5, p: BonePose): [number, number] {
  const s = p.spread ?? 0;
  const { sh } = leanOffsets(dir, p.lean ?? 0);
  const [fx, fy] = FACE_VEC[dir];
  const reach = p.reach ?? 0;
  const armY = 22 + (p.bob ?? 0) + (p.rise ?? 0) - s * 6;
  return [Math.round(32 + sh + (p.sway ?? 0) + 16 + s * 6 + reach * 8 * fx), Math.round(Math.min(56, armY + 18 - s * 12 + reach * 5 * fy))];
}

/** A limb bone: 2 px thick, lit side and shadow side, knobbed ends. */
function boneLine(c: Img, x0: number, y0: number, x1: number, y1: number) {
  line(c, x0 + 1, y0 + 1, x1 + 1, y1 + 1, BONE.b0);
  line(c, x0, y0, x1, y1, BONE.b2);
  c.set(x0, y0, BONE.b3);
  c.disc(x1, y1, 1.2, BONE.b2);
}

function drawBones(c: Img, dir: Dir5, pose: BonePose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, spread: 0, reach: 0, flick: 0, ...pose };
  const b = o.bob + o.rise;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const ember = (x: number, y: number, k: number) => c.set(x, y, (k + o.flick) % 3 === 0 ? P.flame2 : (k + o.flick) % 3 === 1 ? P.flame1 : P.ember);
  // Scorched floor, embers still in it where she rose
  c.ellipse(32, 58, 16, 3.5, P.dark1);
  c.ellipse(32, 58, 11, 2.2, mix(P.dark1, P.ember, 0.25));
  if (o.rise > 0) for (const x of [22, 30, 38, 44]) c.set(x, 56, P.flame1);
  // Legs: femur and shin, knobbed knees
  const liftL = o.step === 1 ? 3 : 0;
  const liftR = o.step === 3 ? 3 : 0;
  if (44 + b < 57) {
    for (const [x, lift] of [[27, liftL], [37, liftR]] as const) {
      const bottom = 57 - lift;
      if (bottom - (44 + b) > 2) {
        boneLine(c, x + (x < 32 ? 1 : -1), 43 + b, x, 50 + b - Math.round(lift / 2));
        boneLine(c, x, 50 + b - Math.round(lift / 2), x, bottom - 1);
      }
      c.hline(x - 2, bottom, 5, BONE.b1); // foot
      c.hline(x - 2, bottom + 1, 5, BONE.b0);
    }
  }
  // Pelvis
  if (42 + b < 58) {
    c.ellipse(32 + sh, 42 + b, 7, 2.5, BONE.b1);
    c.ellipse(31 + sh, 41.5 + b, 5, 1.5, BONE.b2);
    c.rect(30 + sh, 42 + b, 4, 2, P.ink);
  }
  // Spine and ribs, the embers of her smouldering inside
  for (let y = 20; y < 42; y += 2) {
    c.rect(31 + sh, y + b, 2, 1, BONE.b2);
    c.set(32 + sh, y + b + 1, BONE.b0);
  }
  c.ellipse(32 + sh, 29 + b, 5, 6, mix(P.ink, P.ember, 0.35)); // the glow inside the ribcage
  c.ellipse(32 + sh, 30 + b, 3, 3.5, mix(P.ember, P.flame1, 0.4));
  for (let i = 0; i < 5; i++) {
    const y = 23 + b + i * 3;
    const w = 7 - Math.abs(i - 1);
    // each rib curves round from the spine, lit on top
    c.hline(32 + sh - w, y, w * 2 + 1, BONE.b2);
    c.set(32 + sh - w, y + 1, BONE.b1);
    c.set(32 + sh + w, y + 1, BONE.b0);
    c.hline(32 + sh - w + 1, y + 1, w * 2 - 1, back ? BONE.b0 : mix(P.ink, P.ember, 0.3));
    if (i < 4 && !back) ember(32 + sh - 2 + i, y + 1, i);
  }
  c.hline(25 + sh, 21 + b, 15, BONE.b2); // collarbones
  c.hline(25 + sh, 22 + b, 15, BONE.b0);
  // charred wax still clinging to her
  for (const [x, y] of [[-6, 22], [5, 26], [-4, 36], [6, 38], [-7, 30]]) c.set(32 + sh + x, y + b, BONE.char);
  // Arms (spread = the summoning pose, arms raised wide). Upper arm then forearm on both sides, mirrored
  // around the spine, so they're always the same length. `reach` sends the ladle arm forward (the jab).
  const armY = 22 + b - o.spread * 6;
  const elbowOut = 15 + o.spread * 4;
  const handOut = 16 + o.spread * 6;
  const handY = armY + 18 - o.spread * 12;
  const [rhx, rhy] = boneHandAt(dir, o);
  for (const side of [-1, 1]) {
    const x0 = 32 + sh + side * 7; // shoulder
    const hx2 = side === 1 ? rhx : 32 + sh + o.sway - handOut;
    const hy2 = side === 1 ? rhy : Math.min(56, handY);
    const ex = side === 1 ? Math.round((x0 + hx2) / 2 + 4) : 32 + sh + o.sway - elbowOut;
    const ey = side === 1 ? Math.round((22 + b + hy2) / 2 + (o.reach ? -2 : 2)) : armY + 10;
    boneLine(c, x0, 22 + b, ex, ey);
    boneLine(c, ex, ey, hx2, hy2);
    // small flames licking along the arm bones
    if (!o.flinch) {
      c.set(ex, ey - 2, (side + o.flick) % 2 ? P.flame1 : P.flame2);
      c.set(ex, ey - 3, P.ember);
    }
  }
  if (o.spread > 0) {
    // wax gathering between her raised hands
    c.disc(32 + sh, armY - 4, 3 + o.spread, P.flame1);
    c.disc(32 + sh, armY - 4, 1.5 + o.spread, P.flame2);
    c.disc(32 + sh - 1, armY - 5, 0.8 + o.spread * 0.4, P.white);
  }
  // Skull: long, stooped forward, jaw hanging a little open
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 9 + b + o.hunch + ly;
  c.ellipse(hx, hy + 4, 6, 6, BONE.b1);
  c.ellipse(hx - 1.2, hy + 3, 4.5, 4.5, BONE.b2);
  c.set(hx - 3, hy, BONE.b3);
  c.set(hx - 2, hy - 1, BONE.b3);
  c.rect(hx - 3, hy + 9, 7, 2, BONE.b1); // jaw
  c.hline(hx - 3, hy + 11, 7, BONE.b0);
  if (!back) {
    const fx = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 3;
    c.rect(fx - 4, hy + 3, 3, 3, P.ink);
    c.rect(fx + 1, hy + 3, 3, 3, P.ink);
    const eye = o.flinch ? P.wax2 : P.flame2;
    c.set(fx - 3, hy + 4, eye); // ember eyes
    c.set(fx + 2, hy + 4, eye);
    c.set(fx - 3, hy + 5, P.ember);
    c.set(fx + 2, hy + 5, P.ember);
    c.set(fx, hy + 7, P.ink); // nose
    for (let x = fx - 2; x <= fx + 2; x += 2) c.set(x, hy + 9, P.ink); // teeth
    c.hline(fx - 5, hy + 6, 2, BONE.b0); // cheekbones
    c.hline(fx + 4, hy + 6, 2, BONE.b0);
  } else c.vline(hx, hy + 1, 7, BONE.b0);
  for (const [x, y] of [[-4, -2], [0, -3], [4, -2]]) {
    c.set(hx + x, hy + y, P.ink); // wick stumps, burnt down
    c.set(hx + x, hy + y - 1, (x + o.flick) % 2 ? P.ember : mix(P.ember, P.ink, 0.5));
  }
  // The ladle hand sits at the end of the right forearm (where the game holds the ladle).
  c.rect(rhx - 1, rhy - 1, 3, 3, BONE.b2);
}

const SUMMON_POSES: BonePose[] = [{ spread: 0.5 }, { spread: 1 }, { spread: 1.5, bob: -1 }, { spread: 2, bob: -2 }, { spread: 2, bob: -2, flick: 1 }, { spread: 1 }, {}];
const CHANNEL_POSES: BonePose[] = [{ spread: 2, bob: -2 }, { spread: 1.8, bob: -3, sway: 1, flick: 1 }, { spread: 2, bob: -2, flick: 2 }, { spread: 1.8, bob: -1, sway: -1 }];

function bonesDeath(c: Img, f: number) {
  // The bones come apart and settle into a heap; the heap itself is what blows away as dust.
  if (f === 0) {
    drawBones(c, 'S', { flinch: true, hunch: 2, bob: 2 });
    return;
  }
  const spread = f * 4;
  c.ellipse(32, 57, 12 + f * 2, 2, P.stone4); // bone dust
  for (const [x, y, len, dx] of [[20, 50, 10, 1], [34, 52, 12, -1], [26, 46, 8, 1], [40, 48, 9, 0], [30, 54, 14, 0]]) {
    const x0 = x - spread / 2;
    const x1 = x + len * dx + spread / 2;
    const y1 = y + f - (dx === 0 ? 0 : 3);
    line(c, x0, y + f + 1, x1, y1 + 1, BONE.b0);
    line(c, x0, y + f, x1, y1, BONE.b2);
  }
  if (f < 4) {
    c.ellipse(32, 50 + f, 5, 4, BONE.b1); // the skull
    c.ellipse(31, 49 + f, 3.5, 2.8, BONE.b2);
    c.rect(29, 49 + f, 2, 2, P.ink);
    c.rect(33, 49 + f, 2, 2, P.ink);
    if (f < 3) c.set(29, 49 + f, P.ember);
  }
}

function genWorks() {
  const T = 16;
  // ---- tileset: soot-black flagstones, iron grates, tallow spills, soot brick walls with iron tops
  const img = new Img(T * 8, T * 8);
  const at = tileAt;
  const speck = (ox: number, oy: number, r: () => number, n: number, col: RGBA) => {
    for (let i = 0; i < n; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), col);
  };
  const WK = {
    soot: mix(P.stone1, P.dark2, 0.75),
    brick0: hex('#2a1c1c'),
    brick1: mix(P.wood1, P.dark2, 0.45),
    brick2: mix(P.wood1, P.dark2, 0.15),
    brick3: hex('#80523a'),
    iron0: hex('#2b2d35'),
    iron1: hex('#4a4f5c'),
    iron2: P.steel1,
    iron3: P.steel2,
    grease: mix(P.stone1, P.wax1, 0.28),
  };
  const sootStone: SlabPal = { base: WK.soot, mortar: mix(P.dark1, P.ink, 0.5), hi: mix(WK.soot, P.stone2, 0.55), lo: mix(P.dark2, P.dark1, 0.5) };

  // 0-3, 40-41 floor: soot-blackened flagstones
  const floor = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(3000 + idx);
    switch (v) {
      case 0:
      case 1:
        flagstone(img, ox, oy, 0, 0, 16, 16, r, sootStone, v ? -0.3 : 0.1);
        break;
      case 2:
        flagstone(img, ox, oy, 0, 0, 16, 8, r, sootStone, 0.2);
        flagstone(img, ox, oy, 0, 8, 9, 8, r, sootStone, -0.2);
        flagstone(img, ox, oy, 9, 8, 7, 8, r, sootStone);
        break;
      case 3: // soot stain
        flagstone(img, ox, oy, 0, 0, 16, 16, r, sootStone);
        img.ellipse(ox + 8, oy + 9, 5, 3, mix(WK.soot, P.dark1, 0.5));
        img.ellipse(ox + 8, oy + 9, 3, 1.8, mix(WK.soot, P.dark1, 0.8));
        break;
      case 4: // cracked
        flagstone(img, ox, oy, 0, 0, 16, 16, r, sootStone, -0.1);
        line(img, ox + 3, oy + 2, ox + 7, oy + 8, sootStone.mortar);
        line(img, ox + 7, oy + 8, ox + 6, oy + 14, sootStone.mortar);
        line(img, ox + 7, oy + 8, ox + 12, oy + 10, sootStone.mortar);
        break;
      case 5: // a round iron drain cover
        flagstone(img, ox, oy, 0, 0, 16, 16, r, sootStone, 0.05);
        img.disc(ox + 8, oy + 8, 4, WK.iron0);
        img.disc(ox + 8, oy + 8, 3.2, WK.iron1);
        for (const y of [6, 8, 10]) img.hline(ox + 6, oy + y, 4, WK.iron0);
        img.set(ox + 6, oy + 5, WK.iron2);
        break;
    }
  };
  [0, 1, 2, 3].forEach(v => floor(v, v === 3 ? 3 : v));
  floor(40, 4);
  floor(41, 5);

  // 4-5 iron grate over the drains; one glows from the fires below
  for (const v of [4, 5]) {
    const [ox, oy] = at(v);
    img.rect(ox, oy, T, T, P.ink);
    if (v === 5) {
      img.ellipse(ox + 8, oy + 10, 6, 4, mix(P.ink, P.ember, 0.45));
      img.ellipse(ox + 8, oy + 10, 3, 2, mix(P.ember, P.flame1, 0.4));
    }
    for (let x = 1; x < T; x += 4) {
      img.vline(ox + x, oy, T, WK.iron1);
      img.vline(ox + x + 1, oy, T, WK.iron0);
      img.set(ox + x, oy + 1, WK.iron2);
    }
    for (const y of [0, 8]) {
      img.hline(ox, oy + y, T, WK.iron2);
      img.hline(ox, oy + y + 1, T, WK.iron0);
    }
  }
  // 6-7 rock: black, with the odd ember still glowing in the slag
  for (const idx of [6, 7]) {
    const [ox, oy] = at(idx);
    const r = rng(3100 + idx);
    img.rect(ox, oy, T, T, P.ink);
    for (let i = 0; i < 3; i++) img.ellipse(ox + 3 + r() * 10, oy + 3 + r() * 10, 1.5 + r() * 2, 1 + r() * 1.5, mix(P.ink, P.dark1, 0.6));
    speck(ox, oy, r, 5, P.dark1);
    if (idx === 7) {
      img.set(ox + 9, oy + 5, P.ember);
      img.set(ox + 3, oy + 12, mix(P.ember, P.ink, 0.5));
    }
  }
  // 10-11 tallow spilled on the stones: a flat, faint, greasy sheen across the whole tile (no blob shapes, which
  // would read as Vat Crawlers)
  for (const v of [10, 11]) {
    const [ox, oy] = at(v);
    const r = rng(3300 + v);
    img.rect(ox, oy, T, T, WK.grease);
    speck(ox, oy, r, 7, mix(P.stone1, P.wax2, 0.5)); // glints of grease (dots, so big spills don't stripe)
    speck(ox, oy, r, 5, mix(WK.grease, P.dark2, 0.5));
    img.hline(ox + 2 + r() * 6, oy + 4 + r() * 4, 3, mix(WK.grease, P.wax2, 0.35)); // sheen
    img.hline(ox + 6 + r() * 6, oy + 11 + r() * 3, 2, mix(WK.grease, P.wax2, 0.35));
  }
  // 12-13 planks: old, dark boards
  for (const v of [12, 13]) {
    const [ox, oy] = at(v);
    const r = rng(3400 + v);
    img.rect(ox, oy, T, T, P.wood1);
    for (let b = 0; b < 4; b++) {
      const y = oy + b * 4;
      const c = [P.wood1, mix(P.wood1, P.dark2, 0.35), mix(P.wood1, P.wood2, 0.3), mix(P.wood1, P.dark2, 0.15)][(b + v) % 4];
      img.rect(ox, y, T, 4, c);
      img.hline(ox, y, T, mix(c, P.wood2, 0.45));
      img.hline(ox, y + 3, T, P.dark1);
      img.hline(ox + r() * 10, y + 1 + Math.floor(r() * 2), 4, mix(c, P.dark2, 0.5));
      const j = (5 + b * 6 + v * 5) % 16;
      img.vline(ox + j, y, 3, P.dark1);
      img.set(ox + j + 1, y + 1, WK.iron2);
    }
  }

  // 8, 9, 14, 15 wall front: soot brick in running bond under an iron band
  const front = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(3200 + idx);
    img.rect(ox, oy, T, T, WK.brick0);
    for (let row = 0; row < 4; row++) {
      const y = oy + 2 + row * 3;
      const off = row % 2 ? 4 : 0;
      for (let x0 = -off; x0 < T; x0 += 8) {
        const tone = r();
        // soot darkens the bricks toward the top of the wall
        const c = mix(tone < 0.3 ? WK.brick1 : WK.brick2, WK.brick0, Math.max(0, 0.35 - row * 0.12));
        const x = Math.max(0, x0);
        const w = Math.min(x0 + 7, T) - x;
        if (w <= 0) continue;
        img.rect(ox + x, y, w, 2, c);
        img.hline(ox + x, y, w, mix(c, WK.brick3, 0.45)); // lit top
        if (r() < 0.4) img.set(ox + x + r() * w, y + 1, mix(c, WK.brick0, 0.6));
      }
    }
    img.hline(ox, oy, T, WK.iron2); // iron band along the top
    img.hline(ox, oy + 1, T, WK.iron0);
    for (const x of [3, 11]) img.set(ox + x, oy, WK.iron3);
    img.hline(ox, oy + 14, T, P.dark1);
    img.hline(ox, oy + 15, T, P.ink);
    if (v === 1) {
      // soot running down from the top
      for (const [x, len] of [[5, 9], [6, 12], [7, 6], [12, 8]]) for (let y = 2; y < 2 + len; y++) if (r() < 0.8) img.set(ox + x, oy + y, mix(WK.brick0, P.ink, 0.4));
    }
    if (v === 2) {
      // an iron pipe down the wall
      img.vline(ox + 10, oy + 1, 14, WK.iron1);
      img.vline(ox + 11, oy + 1, 14, WK.iron0);
      img.vline(ox + 9, oy + 1, 14, WK.iron2);
      for (const y of [4, 11]) {
        img.hline(ox + 8, oy + y, 5, WK.iron2);
        img.hline(ox + 8, oy + y + 1, 5, WK.iron0);
      }
    }
    if (v === 3) {
      // a furnace vent: a small iron hatch with fire behind the bars
      img.rect(ox + 4, oy + 5, 8, 7, WK.iron0);
      img.rect(ox + 5, oy + 6, 6, 5, P.ember);
      img.rect(ox + 6, oy + 8, 4, 3, P.flame1);
      img.hline(ox + 7, oy + 10, 2, P.flame2);
      for (const x of [6, 8, 10]) img.vline(ox + x, oy + 6, 5, WK.iron1);
      img.hline(ox + 4, oy + 5, 8, WK.iron2);
      img.hline(ox + 4, oy + 12, 8, WK.iron1);
    }
  };
  front(8, 0);
  front(9, 1);
  front(14, 2);
  front(15, 3);

  // 16-31 wall tops: dark iron plates, riveted along the edges open to the room
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(3500 + mask);
    img.rect(ox, oy, T, T, P.dark1);
    for (const [x, y, w, h] of [[0, 0, 8, 8], [8, 0, 8, 8], [0, 8, 8, 8], [8, 8, 8, 8]]) {
      img.hline(ox + x, oy + y, w, P.ink);
      img.vline(ox + x, oy + y, h, P.ink);
      img.hline(ox + x + 1, oy + y + 1, w - 2, mix(P.dark1, WK.iron0, 0.6));
    }
    speck(ox, oy, r, 4, P.ink);
    const N = mask & 1, E = mask & 2, S = mask & 4, Wt = mask & 8;
    if (N) {
      img.hline(ox, oy, T, WK.iron3);
      img.hline(ox, oy + 1, T, WK.iron2);
      img.hline(ox, oy + 2, T, WK.iron0);
      for (const x of [3, 11]) img.set(ox + x, oy + 1, WK.iron3);
    }
    if (S) {
      img.hline(ox, oy + 13, T, WK.iron0);
      img.hline(ox, oy + 14, T, WK.iron2);
      img.hline(ox, oy + 15, T, WK.iron1);
      for (const x of [3, 11]) img.set(ox + x, oy + 14, WK.iron3); // rivets
    }
    if (Wt) {
      img.vline(ox, oy, T, WK.iron3);
      img.vline(ox + 1, oy, T, WK.iron2);
    }
    if (E) {
      img.vline(ox + 15, oy, T, WK.iron1);
      img.vline(ox + 14, oy, T, WK.iron2);
    }
  }

  shadeTiles(img, 32, 1);
  // 48-63: grease seeping over the stones beside a spill
  fringeTiles(48, 3, 3600, (x, y, d, r) => {
    if (d > 0.6 && r() < 0.5) return;
    img.set(x, y, d < 0.5 ? WK.grease : mix(WK.grease, WK.soot, 0.45));
    if (r() < 0.08) img.set(x, y, mix(P.stone1, P.wax2, 0.5));
  });

  sheet('tiles_works', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [...Array(20).fill(0), ...Array(18).fill(1), ...Array(6).fill(2), 3, 40, 40, 41], // stains, cracks, drains: rare
      floor_grate: [4, 4, 4, 4, 5],
      floor_grease: [10, 11],
      floor_plank: [12, 13],
      wall_front: [8, 8, 8, 8, 9, 8, 14, 8, 9, 15],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [6, 6, 7],
      shade: Array.from({ length: 8 }, (_, i) => 32 + i),
      fringe_floor_grease: Array.from({ length: 16 }, (_, i) => 48 + i),
      glow: [15, 5],
    },
  });


  // ---- lever (16x24, pivot 8,23): frame 0 up (unpulled), 1 down
  const lever = new Img(32, 24);
  for (let f = 0; f < 2; f++) {
    const c = new Img(16, 24);
    // a dressed-stone block with an iron slot and a toothed quadrant; the arm is iron, the handle turned oak
    c.rect(3, 16, 10, 7, P.stone2);
    c.hline(3, 16, 10, P.stone4);
    c.vline(3, 16, 7, P.stone3);
    c.vline(12, 16, 7, P.stone1);
    c.hline(3, 22, 10, P.stone1);
    c.set(5, 19, P.stone1); // wear on the stone
    c.set(10, 20, P.stone3);
    c.rect(6, 16, 4, 2, IRON.c0); // the slot
    for (let a = 0; a < 5; a++) c.set(Math.round(8 + Math.cos(-Math.PI * 0.2 - a * 0.25) * 4), Math.round(17 + Math.sin(-Math.PI * 0.2 - a * 0.25) * 4), IRON.c2); // the quadrant's teeth
    const [ex, ey] = f === 0 ? [10, 5] : [14, 13];
    line(c, 8, 17, ex, ey, IRON.c1);
    line(c, 7, 17, ex - 1, ey, IRON.c2);
    c.set(8, 17, IRON.c3); // the pivot bolt
    const [hx, hy] = f === 0 ? [10, 3] : [14, 11];
    c.rect(hx - 1, hy - 1, 2, 3, WOOD.c2); // the handle
    c.set(hx - 1, hy - 1, WOOD.c3);
    c.set(hx, hy + 1, WOOD.c1);
    c.outline(P.ink);
    lever.blit(c, f * 16, 0);
  }
  sheet('lever', lever, { cell: [16, 24], pivot: [8, 23], layer: 'single' });

  // ---- cracked wall (16x16, pivot 8,16): frame 0 cracks over the brick face, frame 1 rubble
  const crack = new Img(32, 16);
  line(crack, 8, 2, 6, 7, P.ink);
  line(crack, 6, 7, 9, 11, P.ink);
  line(crack, 9, 11, 7, 15, P.ink);
  line(crack, 6, 7, 2, 9, P.ink);
  line(crack, 9, 11, 13, 10, P.ink);
  crack.set(10, 4, P.flame1); // a draught of warm air: something is behind it
  for (const [x, y, r] of [[20, 13, 2.5], [25, 14, 2], [28, 12, 1.5], [23, 11, 1.5]]) crack.ellipse(x, y, r, r * 0.7, P.wood1);
  sheet('prop_cracked_wall', crack, { cell: [16, 16], pivot: [8, 16], layer: 'single' });
  // ---- fallen gate rubble (16x24, pivot 8,24): frame 0 a heap of dressed stone and a charred beam piled higher
  // than a man can climb, frame 1 the stones thrown aside by a blast
  const rubble = new Img(32, 24);
  {
    const stone: Ramp = { c0: mix(P.stone1, P.ink, 0.35), c1: P.stone2, c2: mix(P.stone2, P.stone3, 0.5), c3: P.stone3 };
    const block = (c: Img, x: number, y: number, w: number, h: number) => {
      c.rect(x, y, w, h, stone.c1);
      c.hline(x, y, w, stone.c3);
      c.vline(x, y, h, stone.c2);
      c.hline(x, y + h - 1, w, stone.c0);
      c.vline(x + w - 1, y + 1, h - 1, stone.c0);
    };
    const heap = new Img(16, 24);
    for (const [x, y, w, h] of [[0, 18, 6, 6], [5, 19, 6, 5], [10, 18, 6, 6], [1, 13, 6, 6], [7, 12, 6, 7], [11, 14, 5, 5], [3, 7, 5, 6], [8, 6, 5, 6], [5, 2, 5, 5]]) block(heap, x, y, w, h);
    line(heap, 0, 16, 15, 9, mix(P.wood1, P.ink, 0.5)); // a charred beam across it
    line(heap, 0, 17, 15, 10, mix(P.wood1, P.ink, 0.3));
    heap.set(6, 14, P.ember);
    heap.set(2, 22, P.moss2); // weeds already through it
    heap.set(13, 21, P.moss1);
    heap.set(9, 8, P.moss2);
    heap.outline(P.ink);
    rubble.blit(heap, 0, 0);
    const left = new Img(16, 24);
    for (const [x, y, r] of [[3, 22, 2], [12, 21, 2.2], [8, 23, 1.4], [14, 18, 1.2]]) {
      left.ellipse(x, y, r, r * 0.7, stone.c1);
      left.set(Math.round(x - r * 0.4), Math.round(y - r * 0.4), stone.c3);
    }
    line(left, 1, 19, 6, 17, mix(P.wood1, P.ink, 0.5));
    left.outline(P.ink);
    rubble.blit(left, 16, 0);
  }
  sheet('prop_rubble', rubble, { cell: [16, 24], pivot: [8, 24], layer: 'single' });

  // ---- enemies
  const P7 = phased7();
  const frames2 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  rosterSheet(
    'renderer',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames2(drawRenderer, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawRenderer, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(9), loop: true },
      {
        name: 'throw',
        frames: frames2(drawRenderer, [{ lean: -1, sway: -1 }, { lean: -2, sway: -2 }, { lean: -2, sway: -2, bob: 1 }, { lean: 3, sway: 2 }, { lean: 2, sway: 1 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'swipe',
        frames: frames2(drawRenderer, [{ sway: -1 }, { sway: -2, lean: -1 }, { sway: -2, lean: -1, bob: 1 }, { sway: 2, lean: 2 }, { sway: 2, lean: 1 }, { sway: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames2(drawRenderer, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => rendererDeath(c, f)),
    RENDER_HAND,
  );
  for (const [name, size] of [['vat_crawler', 1], ['vat_spawn', 0.6]] as const) {
    const draw = (c: Img, d: Dir5, p: BodyPose) => drawCrawler(c, d, { ...p, size });
    rosterSheet(
      name,
      CELL,
      PIVOT,
      7,
      [
        { name: 'idle', frames: frames2(draw, [{}, { bob: 1 }]), timing: [{ ticks: 20 }, { ticks: 20 }], loop: true },
        { name: 'walk', frames: walk4(draw, f => ({ bob: f % 2 ? 2 : 0, lean: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(8), loop: true },
        {
          name: 'engulf',
          frames: frames2(draw, [{ bob: 2 }, { bob: 3 }, { bob: 4 }, { bob: -3, lean: 2 }, { bob: -2, lean: 2 }, { bob: 1 }, {}]),
          timing: P7,
          loop: false,
        },
        { name: 'stagger', frames: frames2(draw, [{ bob: 3, flinch: true }, { bob: 2, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
      ],
      [0, 1, 2, 3, 4].map(f => (c: Img) => crawlerDeath(c, f, size)),
      null,
    );
  }
  const motherAnim = (name: string, poses: MotherPose[], timing: { ticks: number; phase?: string }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => drawMother(c, d, p)),
    timing,
    loop,
    hand: (d: Dir5, f: number) => motherHand(d, poses[f]),
  });
  rosterSheet(
    'mother_tallow',
    64,
    [32, 58],
    7,
    [
      motherAnim('idle', [{}, { flick: 1 }, { bob: 1 }, { bob: 1, flick: 1 }], [{ ticks: 16 }, { ticks: 14 }, { ticks: 16 }, { ticks: 14 }], true),
      motherAnim('walk', [0, 1, 2, 3].map(f => ({ bob: f % 2 ? 1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0, flick: f % 2 })), walkT(14), true),
      // Ladle sweep (and the stir): swung back behind her, then out across the front
      motherAnim(
        'sweep',
        [
          { reach: -0.6, sway: -2, lean: -1 },
          { reach: -1, sway: -3, lean: -2, arm: 0.2 },
          { reach: -1.1, sway: -3, lean: -2, arm: 0.2, bob: 1 },
          { reach: 1.1, sway: 3, lean: 3 },
          { reach: 1.2, sway: 3, lean: 2, flick: 1 },
          { reach: 0.5, sway: 1, lean: 1 },
          {},
        ],
        P7,
        false,
      ),
      // Wax spit: head thrown back, throat glowing, then the globs
      motherAnim(
        'spit',
        [{ hunch: -1, mouth: 0.3 }, { hunch: -2, lean: -2, mouth: 0.6 }, { hunch: -3, lean: -2, bob: -1, mouth: 1 }, { hunch: 1, lean: 3, mouth: 1 }, { lean: 2, mouth: 0.6 }, { lean: 1, mouth: 0.2 }, {}],
        P7,
        false,
      ),
      // Crush: both arms up, and the whole weight of her brought down (unblockable)
      motherAnim(
        'crush',
        [
          { both: 0.5, bob: -1, hunch: -1 },
          { both: 1, bob: -3, hunch: -3 },
          { both: 1.1, bob: -3, hunch: -3, sway: 1, mouth: 0.5 },
          { reach: 1, bob: 3, hunch: 3, lean: 2 },
          { reach: 1, bob: 4, hunch: 3, lean: 2 },
          { reach: 0.4, bob: 2 },
          {},
        ],
        P7,
        false,
      ),
      // Spill: the ladle lifted high and tipped out over you
      motherAnim(
        'tip',
        [{ arm: 0.4 }, { arm: 0.8, lean: -1 }, { arm: 1, lean: -1, bob: -1 }, { tip: 1, lean: 2 }, { tip: 1.1, lean: 2, flick: 1 }, { tip: 0.5, lean: 1 }, {}],
        P7,
        false,
      ),
      // The entrance: she rises out of her vat's pool, the wicks on her shoulders catching one by one.
      motherAnim(
        'intro',
        [{ rise: 26 }, { rise: 18 }, { rise: 10, flick: 1 }, { rise: 3 }, { rise: 0, sway: -1, arm: 0.5 }, { rise: 0, sway: 1, arm: 0.3, flick: 1 }],
        [{ ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 15 }, { ticks: 15 }, { ticks: 30 }],
        false,
      ),
      motherAnim('stagger', [{ lean: -2, flinch: true, arm: 0.3 }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => motherDeath(c, f)),
    MOTHER_HAND,
  );

  const boneAnim = (name: string, poses: BonePose[], timing: { ticks: number; phase?: string }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => drawBones(c, d, p)),
    timing,
    loop,
    hand: (d: Dir5, f: number) => boneHandAt(d, poses[f]),
  });
  rosterSheet(
    'mother_bones',
    64,
    [32, 58],
    7,
    [
      boneAnim('idle', [{}, { flick: 1 }, { bob: 1, sway: 1 }, { bob: 1, sway: 1, flick: 2 }], [{ ticks: 8 }, { ticks: 8 }, { ticks: 8 }, { ticks: 8 }], true),
      boneAnim('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1, flick: f })), walkT(7), true),
      boneAnim(
        'sweep',
        [{ sway: -3, lean: -2, reach: -0.5 }, { sway: -4, lean: -3, reach: -0.8 }, { sway: -4, lean: -3, bob: 1, reach: -0.8 }, { sway: 4, lean: 4, reach: 1 }, { sway: 3, lean: 3, reach: 1, flick: 1 }, { sway: 1, lean: 1, reach: 0.4 }, {}],
        P7,
        false,
      ),
      // Triple jab: coiled back, then the ladle arm snaps out to full length
      boneAnim('jab', [{ lean: -1, reach: -0.4 }, { lean: -3, hunch: 1, reach: -0.9 }, { lean: -3, hunch: 1, reach: -0.9, flick: 1 }, { lean: 5, reach: 1.6 }, { lean: 4, reach: 1.4 }, { lean: 2, reach: 0.6 }, {}], P7, false),
      boneAnim('spit', [{ hunch: -1 }, { hunch: -2, lean: -2 }, { hunch: -3, lean: -2, bob: -1, flick: 1 }, { hunch: 2, lean: 3 }, { lean: 2 }, { lean: 1 }, {}], P7, false),
      // Leap crush: crouched low, arms flung up at the top of the jump, down onto you
      boneAnim(
        'leap',
        [{ bob: 3, hunch: 2 }, { bob: 4, hunch: 3 }, { bob: -6, hunch: -2, spread: 1.4 }, { bob: 4, hunch: 3, lean: 3, reach: 1 }, { bob: 3, hunch: 2, lean: 2, reach: 1 }, { bob: 1, reach: 0.4 }, {}],
        P7,
        false,
      ),
      // Raised-arm poses carry their own hand position, so the ladle goes up with the arm.
      boneAnim('summon', SUMMON_POSES, P7, false),
      // Held while her summons live: arms raised, wax gathering between her hands, swaying slightly.
      boneAnim('channel', CHANNEL_POSES, CHANNEL_POSES.map(() => ({ ticks: 10 })), true),
      // Rising out of her own burning wax.
      boneAnim(
        'intro',
        [{ rise: 30 }, { rise: 20, flick: 1 }, { rise: 12 }, { rise: 5, flick: 1 }, { rise: 0, hunch: 3 }, { rise: 0, spread: 1 }],
        [{ ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 30 }],
        false,
      ),
      boneAnim('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => bonesDeath(c, f)),
    MOTHER_HAND,
  );
  // Wax slime: molten, glowing, summoned wax
  const slimeDraw = (c: Img, d: Dir5, p: BodyPose) => {
    drawCrawler(c, d, { ...p, size: 0.75 });
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        if (c.px[i + 3] === 0) continue;
        // recolour the pale wax to molten orange, keeping its shading (by brightness)
        const [r, g, bl] = [c.px[i], c.px[i + 1], c.px[i + 2]];
        if (r < 150 || r < bl) continue; // outline, eyes, wick
        const l = (r + g + bl) / 3;
        c.set(x, y, l > 225 ? P.white : l > 200 ? P.flame2 : l > 170 ? P.flame1 : P.ember);
      }
  };
  rosterSheet(
    'wax_slime',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames2(slimeDraw, [{}, { bob: 1 }]), timing: [{ ticks: 10 }, { ticks: 10 }], loop: true },
      { name: 'walk', frames: walk4(slimeDraw, f => ({ bob: f % 2 ? 2 : 0, lean: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(6), loop: true },
      {
        name: 'engulf',
        frames: frames2(slimeDraw, [{ bob: 2 }, { bob: 3 }, { bob: 4 }, { bob: -3, lean: 2 }, { bob: -2, lean: 2 }, { bob: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames2(slimeDraw, [{ bob: 3, flinch: true }, { bob: 2, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => crawlerDeath(c, f, 0.75)),
    null,
  );

  // ---- weapons and projectiles
  const ember = new Img(8, 8);
  ember.disc(4, 4.5, 3, P.flame1);
  ember.disc(4, 4, 1.5, P.flame2);
  ember.set(4, 1, P.ember);
  ember.outline(P.ink);
  sheet('ember_glob', ember, { cell: [8, 8], pivot: [4, 4], layer: 'fx' });

  const hook = new Img(40, 9);
  for (let x = 1; x < 30; x += 3) hook.rect(x, 4, 2, 1, P.steel1); // chain
  hook.rect(30, 3, 3, 3, P.steel2);
  line(hook, 33, 4, 37, 1, P.steel2);
  line(hook, 37, 1, 38, 5, P.steel2);
  line(hook, 38, 5, 35, 7, P.steel2);
  hook.outline(P.ink);
  sheet('renderer_hook', hook, { cell: [40, 9], pivot: [3, 4], layer: 'weapon', points: { tip: [37, 4] } });

  // The great ladle: a long wooden handle bound in iron, a dented iron bowl brimming with hot tallow
  const ladle = new Img(48, 16);
  ladle.hline(1, 7, 34, P.wood2);
  ladle.hline(1, 8, 34, P.wood1);
  for (const x of [4, 5]) ladle.vline(x, 7, 2, P.dark2); // grip wrapping
  ladle.rect(30, 6, 4, 4, EN.steel1); // iron collar
  ladle.hline(30, 6, 4, EN.steel3);
  ladle.ellipse(40, 8.5, 7, 6, EN.steel1);
  ladle.ellipse(39, 7.5, 6, 5, EN.steel2);
  ladle.set(35, 5, EN.steel3);
  ladle.set(44, 12, EN.steel0); // a dent
  ladle.ellipse(40, 6.5, 5, 2.6, P.wax1);
  ladle.hline(37, 5, 4, P.wax2);
  ladle.set(42, 7, P.flame1); // still hot
  ladle.vline(45, 9, 3, P.wax1); // running over the lip
  ladle.outline(P.ink);
  sheet('mother_ladle', ladle, { cell: [48, 16], pivot: [8, 8], layer: 'weapon', points: { tip: [46, 8] } });

  const glob = new Img(8, 8);
  glob.disc(4, 4.5, 3, P.wax1);
  glob.set(3, 3, P.wax2);
  glob.set(5, 6, P.flame1);
  glob.outline(P.ink);
  sheet('wax_glob', glob, { cell: [8, 8], pivot: [4, 4], layer: 'fx' });
}

// =============================================================== THE WAXMIRE
// --- Drowned Pilgrim: a pilgrim who went into the wax and came back up. Sodden robe, wax dripping from the
// hood, arms too long. Rises out of the pools to ambush.
function drawDrowned(c: Img, dir: Dir5, pose: BodyPose & { sink?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, sink: 0, ...pose };
  const b = o.bob + o.sink;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const cut = 28; // nothing is drawn below the wax surface line
  const put = (x: number, y: number, w: number, h: number, col: RGBA) => {
    for (let j = 0; j < h; j++) if (y + j < cut) c.hline(x, y + j, w, col);
  };
  const r0 = mix(P.stone1, P.teal1, 0.4);
  const r1 = mix(P.stone1, P.teal1, 0.15);
  const r2 = mix(P.stone2, P.teal2, 0.2);
  const r3 = mix(P.stone3, P.teal3, 0.3);
  const skin = mix(P.wax2, P.teal3, 0.25);
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  put(13, 22 + b, 2, 5 - liftL, r1);
  put(17, 22 + b, 2, 5 - liftR, r0);
  // sodden robe, darker where it is soaked, wax clotted at the hem
  put(11 + sh, 12 + b, 10, 12, r2);
  put(11 + sh, 12 + b, 1, 12, r3);
  put(19 + sh, 12 + b, 2, 12, r1);
  put(20 + sh, 12 + b, 1, 12, r0);
  put(14 + sh, 16 + b, 1, 6, r1); // clinging folds
  put(17 + sh, 15 + b, 1, 7, r1);
  put(12 + sh, 20 + b, 8, 4, P.wax1);
  put(12 + sh, 20 + b, 8, 1, P.wax2);
  put(18 + sh, 21 + b, 2, 3, mix(P.wax1, P.wood1, 0.35));
  for (const x of [12, 15, 19]) put(x + sh, 24 + b, 1, 2, P.wax1); // drips
  // long arms, hanging too low
  put(8 + sh + o.sway, 13 + b, 2, 11, r2);
  put(8 + sh + o.sway, 13 + b, 1, 11, r3);
  put(22 + sh + o.sway, 13 + b, 2, 11, r1);
  put(8 + sh + o.sway, 23 + b, 2, 2, skin); // pale hands, long fingers
  put(8 + sh + o.sway, 25 + b, 1, 1, skin);
  put(22 + sh + o.sway, 23 + b, 2, 2, skin);
  put(23 + sh + o.sway, 25 + b, 1, 1, skin);
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 4 + b + o.hunch + ly;
  put(hx - 4, hy, 8, 9, r1); // hood
  put(hx - 4, hy, 1, 9, r2);
  put(hx + 3, hy, 1, 9, r0);
  put(hx - 3, hy + 1, 6, 2, P.wax1); // wax running off the hood
  put(hx - 3, hy + 1, 3, 1, P.wax2);
  put(hx - 3, hy + 3, 1, 2, P.wax1);
  put(hx + 2, hy + 3, 1, 3, P.wax1);
  if (!back) {
    const fx = dir === 'S' ? hx - 2 : dir === 'SE' ? hx - 1 : hx;
    const fw = dir === 'E' ? 3 : 4;
    put(fx, hy + 4, fw, 4, skin);
    put(fx + fw - 1, hy + 4, 1, 4, mix(skin, r1, 0.4));
    put(fx + (dir === 'E' ? 1 : 0), hy + 5, 1, 1, o.flinch ? P.ember : P.ink);
    if (dir !== 'E') put(fx + 3, hy + 5, 1, 1, o.flinch ? P.ember : P.ink);
    put(fx + 1, hy + 7, 2, 1, mix(skin, P.ink, 0.5)); // open mouth
  }
  if (o.sink > 0) {
    c.ellipse(16, cut, 9, 2, P.wax1); // the pool it's coming out of
    c.hline(10, cut - 1, 4, P.wax2);
    c.ellipse(16, cut + 1, 6, 1, mix(P.wax1, P.wood1, 0.4));
  }
}
function drownedDeath(c: Img, f: number) {
  if (f < 2) drawDrowned(c, 'S', { sink: 3 + f * 4, flinch: true });
  else {
    c.ellipse(16, 27, 9 - f, 2, P.wax1);
    c.ellipse(14, 26, 3, 1, P.wax2);
    if (f < 4) c.rect(15, 25, 2, 1, P.stone2);
  }
}

// --- Mire Lantern: an iron cage lantern that floats on its own, a pale flame inside, wisps trailing.
function drawLantern(c: Img, _dir: Dir5, pose: BodyPose) {
  const o = { bob: 0, flinch: false, sway: 0, ...pose };
  const y0 = 8 + o.bob;
  const flame = o.flinch ? P.ember : P.cyan;
  c.ellipse(16, 27, 5, 1.5, withAlpha(P.ink, 90)); // its shadow far below
  c.vline(16, y0 - 4, 2, EN.steel3); // ring
  c.set(15, y0 - 3, EN.steel2);
  c.set(17, y0 - 3, EN.steel1);
  c.vline(16, y0 - 2, 2, EN.steel1);
  c.rect(13, y0 - 1, 7, 1, EN.steel1); // cap
  c.hline(14, y0 - 2, 5, EN.steel2);
  c.rect(12, y0, 9, 11, mix(P.dark1, P.teal1, 0.5));
  c.ellipse(16, y0 + 6, 3.8, 4.8, mix(P.teal1, P.cyan, 0.35)); // light filling the cage
  c.ellipse(16, y0 + 6, 2.5, 3.5, flame); // cold, pale flame
  c.ellipse(16, y0 + 5, 1.2, 2, P.white);
  for (const x of [12, 16, 20]) c.vline(x, y0, 11, EN.steel1);
  c.vline(12, y0, 11, EN.steel2);
  c.vline(20, y0, 11, EN.steel0);
  c.hline(12, y0, 9, EN.steel3);
  c.hline(12, y0 + 10, 9, EN.steel2);
  c.hline(13, y0 + 11, 7, EN.steel0);
  // wisps of cold light trailing below
  for (const [x, y, col] of [[13 + o.sway, y0 + 13, P.teal3], [18 - o.sway, y0 + 15, P.teal2], [15, y0 + 17, P.teal3], [16 + o.sway, y0 + 19, P.teal2]] as const) c.set(x, y, col);
}
function lanternDeath(c: Img, f: number) {
  if (f < 2) drawLantern(c, 'S', { bob: 4 + f * 6, flinch: true });
  else for (const [x, y] of [[10, 26], [14, 27], [19, 26], [22, 27]]) c.rect(x + (f - 2), y, 2, 1, P.steel1);
}

// --- Mire Matron (64x64): the Abbey's midwife, drowned with the ones she couldn't save, still singing to
// them. A tall veiled figure in a sodden habit, arms long as oars, her lower half gone into the wax.
const MATRON_HAND: Record<Dir5, [number, number]> = { S: [47, 36], SE: [46, 35], E: [42, 35], NE: [45, 33], N: [45, 33] };

/** spread: arms opened wide (singing); reach: both arms forward (the embrace); swing: one arm back (-) or across (+);
 * mouth: open to sing (0..1); wail: head thrown back, arms flung behind, mouth wide; flick: candle flames' other frame. */
type MatronPose = BodyPose & { rise?: number; spread?: number; reach?: number; swing?: number; mouth?: number; wail?: number; flick?: number };

function drawMatron(c: Img, dir: Dir5, pose: MatronPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, spread: 0, reach: 0, swing: 0, mouth: 0, wail: 0, flick: 0, ...pose };
  const b = o.bob + o.rise;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx, fy] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const W = WAXR;
  const hab = { c0: mix(P.teal1, P.ink, 0.45), c1: P.teal1, c2: mix(P.teal1, P.teal2, 0.6), c3: P.teal3 };
  const skin = mix(P.wax2, P.teal3, 0.15);
  const skinD = mix(P.wax1, P.teal2, 0.35);
  // Her pool, with drowned candles floating in it
  c.ellipse(32, 57.5, 21, 5, W.w0);
  c.ellipse(32, 57, 20, 4, W.w2);
  c.ellipse(24, 56, 7, 1.5, W.w3);
  for (const [x, y, k] of [[13, 57, 0], [49, 58, 1], [44, 55, 2], [19, 59, 1]] as const) {
    c.vline(x, y - 2, 2, P.wax2);
    c.set(x, y - 3, (k + o.flick) % 2 ? P.flame1 : P.flame2);
  }
  // Body: a long habit that melts into the pool in a ragged curtain of wax
  const shadeAt = (t: number, r: { c0: RGBA; c1: RGBA; c2: RGBA; c3: RGBA }) => (t < 0.1 ? r.c3 : t < 0.2 ? mix(r.c2, r.c3, 0.5) : t > 0.93 ? r.c0 : t > 0.8 ? r.c1 : r.c2);
  const wr = { c0: W.w0, c1: W.w1, c2: W.w2, c3: W.w3 };
  const curtain = (x: number) => 46 + ((x * 5) % 4) - ((x * 3) % 3) + (x % 5 === 0 ? 3 : 0);
  for (let y = 20; y <= 55; y++) {
    if (y + b > 56) continue;
    const half = Math.round(7 + (y - 20) * 0.2);
    const x0 = 32 + sh - half;
    for (let x = x0; x < x0 + half * 2; x++) c.set(x, y + b, shadeAt((x - x0) / Math.max(1, half * 2 - 1), y > curtain(x - sh) ? wr : hab));
  }
  if (!back) {
    // the scapular: a pale band down the front, stained where the wax has soaked up it
    for (let y = 24; y < 46; y++) if (y + b < 56) c.hline(30 + sh, y + b, 4, y > 40 ? W.w2 : mix(P.stone4, P.teal3, 0.25));
    c.vline(30 + sh, 24 + b, 22, mix(P.stone4, P.wax2, 0.5));
    // the bundle in its sling: a swaddled child of wax, its face turned in to her
    line(c, 27 + sh, 21 + b, 37 + sh, 31 + b, P.stone3);
    c.ellipse(33 + sh, 30 + b, 4.5, 3.5, P.wax1);
    c.ellipse(32 + sh, 29 + b, 3, 2.2, P.wax2);
    c.set(35 + sh, 29 + b, skinD); // the small face
    c.set(36 + sh, 30 + b, skinD);
    c.hline(30 + sh, 31 + b, 5, W.w0); // swaddling folds
  } else {
    line(c, 27 + sh, 31 + b, 37 + sh, 21 + b, P.stone3); // the sling's strap across her back
  }
  // Arms: long as oars; wide teal sleeves to the elbow, then pale wet forearms and long fingers
  const aY = 22 + b - o.spread * 3;
  const hand = (side: number): [number, number] => {
    if (o.wail > 0) return [Math.round(32 + sh + side * (14 + o.wail * 6)), Math.round(26 + b + o.wail * 4)];
    if (o.reach > 0) return [Math.round(32 + sh + fx * (10 + o.reach * 9) + side * (6 - o.reach * 2)), Math.round(32 + b + fy * o.reach * 5 - o.reach * 3)];
    const swing = side === 1 ? o.swing : 0;
    if (o.spread > 0 || swing === 0)
      return [Math.round(32 + sh + o.sway + side * (15 + o.spread * 9) + swing), Math.round(aY + 24 - o.spread * 8)];
    return [Math.round(32 + sh + o.sway + side * 15 + swing * 9 * (fx || 1)), Math.round(aY + 22 - Math.abs(swing) * 6)];
  };
  for (const side of [-1, 1]) {
    const sx = 32 + sh + side * 6;
    if (22 + b > 52) continue; // still under the wax
    const [hx2, hy2r] = hand(side);
    const hy2 = Math.min(53, hy2r);
    const ex = Math.round((sx + hx2) / 2 + side * 2);
    const ey = Math.min(52, Math.round((22 + b + hy2) / 2 + 2));
    for (let t = -1; t <= 1; t++) line(c, sx + t, 22 + b, ex + t, ey, t === -side ? hab.c2 : t === side ? hab.c0 : hab.c1);
    c.hline(ex - 2, ey, 5, hab.c1); // the sleeve's wide mouth
    c.hline(ex - 2, ey + 1, 5, hab.c0);
    line(c, ex, ey + 1, hx2, hy2, skin);
    line(c, ex + 1, ey + 1, hx2 + 1, hy2, skinD);
    for (const d of [-1, 0, 1]) c.set(hx2 + d, hy2 + 1 + (d === 0 ? 1 : 0), skin); // fingers
    c.set(hx2, hy2 + 3, W.w2); // wax dripping from them
  }
  // Veiled head: black veil, white wimple, a pale calm face
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 7 + b + o.hunch + ly - Math.round(o.wail * 2);
  c.rect(hx - 6, hy, 12, 15, hab.c0); // veil
  c.vline(hx - 6, hy + 1, 13, hab.c1);
  c.hline(hx - 5, hy - 1, 10, hab.c0);
  c.rect(hx - 5, hy + 15, 10, 3, hab.c0); // veil falling to the shoulders
  c.set(hx - 6, hy, null); // rounded crown
  c.set(hx + 5, hy, null);
  c.set(hx - 5, hy - 1, null);
  c.set(hx + 4, hy - 1, null);
  c.rect(hx - 5, hy + 1, 10, 4, P.wax2); // coif band
  c.hline(hx - 5, hy + 4, 10, mix(P.wax2, P.stone3, 0.4));
  if (!back) {
    const f0 = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 3;
    c.rect(f0 - 4, hy + 5, 8, 10, P.wax2); // wimple framing the face
    c.rect(f0 - 3, hy + 5, 6, 7, skin);
    c.vline(f0 + 2, hy + 5, 7, skinD);
    const up = o.wail > 0.5 ? -1 : 0;
    c.hline(f0 - 2, hy + 7 + up, 2, P.ink); // closed eyes
    c.hline(f0 + 1, hy + 7 + up, 2, P.ink);
    c.set(f0 - 2, hy + 8 + up, W.w1); // wax tear tracks
    c.vline(f0 - 2, hy + 9 + up, 2, W.w2);
    const mouthH = o.wail > 0 ? 3 : o.mouth > 0 ? 1 + Math.round(o.mouth) : 1;
    const mouthW = o.wail > 0 ? 3 : 2;
    c.rect(f0 - 1, hy + 10, mouthW, mouthH, o.flinch ? P.ember : o.wail > 0 ? P.ink : P.dark2);
  } else c.rect(hx - 5, hy + 5, 10, 10, hab.c0);
}
function matronDeath(c: Img, f: number) {
  // She lies back into the pool, still, and it closes over her face last.
  drawMatron(c, 'S', { rise: [2, 8, 16, 26, 34][f], flinch: f < 2, hunch: -f });
}

function genMire() {
  const T = 16;
  const img = new Img(T * 8, T * 10);
  const at = tileAt;
  const speck = (ox: number, oy: number, r: () => number, n: number, col: RGBA, m = 0) => {
    for (let i = 0; i < n; i++) img.set(ox + m + Math.floor(r() * (16 - m * 2)), oy + m + Math.floor(r() * (16 - m * 2)), col);
  };
  const M = {
    mud: mix(P.wood1, P.dark2, 0.55),
    mudDark: mix(P.wood1, P.dark1, 0.75),
    mudLight: mix(P.wood1, P.dark2, 0.2),
    wet: mix(mix(P.wood1, P.dark2, 0.55), P.teal3, 0.35),
    earth: mix(P.wood1, P.dark2, 0.35),
    root: mix(P.wax1, P.wood1, 0.35),
    grass0: mix(P.moss1, P.dark2, 0.55),
    grass1: mix(P.moss1, P.dark2, 0.25),
    grass2: P.moss1,
    grass3: mix(P.moss2, P.teal2, 0.3),
    wax: mix(P.wax1, P.wood1, 0.38),
    waxDark: mix(P.wax1, P.wood1, 0.58),
    waxHi: mix(P.wax1, P.wax2, 0.3),
    water: P.ink,
  };
  /** A small shine on wet ground: two lit pixels over a darker dip. */
  const shine = (x: number, y: number) => {
    img.hline(x, y + 1, 3, M.mudDark);
    img.hline(x, y, 2, M.wet);
  };
  // 0-3 wet mud: dark, glistening here and there
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(v);
    const r = rng(4000 + v);
    img.rect(ox, oy, T, T, M.mud);
    speck(ox, oy, r, 12, M.mudDark);
    speck(ox, oy, r, 6, M.mudLight);
    for (let i = 0; i < 2; i++) shine(ox + 1 + r() * 11, oy + 1 + r() * 12);
    if (v === 2) {
      // a puddle holding a little sky
      img.ellipse(ox + 8, oy + 9, 3.5, 1.8, P.teal1);
      img.hline(ox + 6, oy + 8, 2, P.teal2);
      img.hline(ox + 5, oy + 11, 6, M.mudLight);
    }
    if (v === 3) for (const x of [4, 9, 12]) {
      img.vline(ox + x, oy + 10, 3, M.grass2);
      img.set(ox + x, oy + 10, M.grass3);
    }
  }
  // 4-5, 42-43 swamp grass: tall dark blades over sodden turf
  const swampGrass = (idx: number, seed: number) => {
    const [ox, oy] = at(idx);
    const r = rng(seed);
    img.rect(ox, oy, T, T, M.grass1);
    speck(ox, oy, r, 6, M.grass0);
    for (let i = 0; i < 5; i++) {
      const x = ox + 1 + Math.floor(r() * 14);
      const y = oy + 4 + Math.floor(r() * 11);
      const h = 2 + Math.floor(r() * 3);
      img.set(x, y, M.grass0);
      img.vline(x, y - h, h, i % 4 ? M.grass2 : mix(M.grass2, P.teal2, 0.5));
      img.set(x + (r() < 0.5 ? -1 : 1), y - h, M.grass3); // tip bending
    }
  };
  swampGrass(4, 4100);
  swampGrass(5, 4101);
  swampGrass(42, 4102);
  swampGrass(43, 4103);
  // 6-7, 44 black water outside the paths: faint ripples, the odd lily pad
  for (const idx of [6, 7, 44]) {
    const [ox, oy] = at(idx);
    const r = rng(4200 + idx);
    img.rect(ox, oy, T, T, M.water);
    for (let i = 0; i < 2; i++) {
      const x = ox + 2 + Math.floor(r() * 9);
      const y = oy + 2 + Math.floor(r() * 12);
      img.hline(x, y, 4, P.teal1);
      img.set(x + 1, y, mix(P.teal1, P.teal2, 0.6));
      img.hline(x + 1, y + 1, 2, mix(P.ink, P.teal1, 0.5));
    }
    if (idx === 44) {
      img.ellipse(ox + 9, oy + 9, 2.5, 1.5, P.moss1);
      img.set(ox + 8, oy + 8, P.moss2);
      img.set(ox + 10, oy + 9, P.ink); // the notch in the pad
    }
  }
  // 8-9, 40-41 bank of earth held together by pale roots, moss hanging over the lip
  const bank = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(4300 + idx);
    img.rect(ox, oy, T, T, M.earth);
    for (const [y, c] of [[5, M.mud], [10, M.mudDark]] as const) img.rect(ox, oy + y, T, 3, c);
    speck(ox, oy + 2, r, 10, M.mudDark);
    speck(ox, oy + 2, r, 4, M.mudLight);
    // pale roots, a different tangle on every bank tile
    const rootA = mix(M.root, M.earth, 0.35);
    const x0 = 1 + Math.floor(r() * 5);
    line(img, ox + x0, oy + 2, ox + x0 + 1 + Math.floor(r() * 3), oy + 7 + Math.floor(r() * 5), rootA);
    if (r() < 0.6) {
      const x1 = 9 + Math.floor(r() * 5);
      line(img, ox + x1, oy + 2, ox + x1 - 1 - Math.floor(r() * 3), oy + 6 + Math.floor(r() * 4), mix(M.root, M.earth, 0.6));
    }
    img.hline(ox, oy + 14, T, P.dark1);
    img.hline(ox, oy + 15, T, P.ink);
    // moss lip, drooping over the edge
    img.hline(ox, oy, T, P.moss2);
    img.hline(ox, oy + 1, T, P.moss1);
    for (let x = 0; x < T; x++) if (r() < 0.4) img.vline(ox + x, oy + 2, 1 + Math.floor(r() * 3), r() < 0.6 ? P.moss1 : M.grass0);
    if (v === 2) {
      // a stone angel's broken wing half-buried in the bank
      img.ellipse(ox + 10, oy + 9, 3, 2, P.stone1);
      img.hline(ox + 8, oy + 8, 4, P.stone3);
      img.set(ox + 8, oy + 9, P.stone2);
    }
    if (v === 3) {
      // drowned-candle offerings on a root ledge
      img.hline(ox + 4, oy + 10, 9, M.root);
      img.hline(ox + 4, oy + 11, 9, M.mudDark);
      for (const [x, h] of [[6, 3], [9, 4], [11, 2]]) {
        img.vline(ox + x, oy + 10 - h, h, P.wax2);
        img.set(ox + x, oy + 9, P.wax1);
        img.set(ox + x, oy + 9 - h, P.flame2);
        img.set(ox + x, oy + 8 - h, mix(P.flame1, M.earth, 0.4));
      }
    }
  };
  bank(8, 0);
  bank(9, 1);
  bank(40, 2);
  bank(41, 3);
  bank(45, 0);
  bank(46, 1);
  // 10-13 WAX POOL: thick old wax, clearly paler than the mud, with a wrinkled skin and a dull sheen (it slows you)
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(10 + v);
    const r = rng(4400 + v);
    img.rect(ox, oy, T, T, M.wax);
    speck(ox, oy, r, 5, mix(M.wax, M.waxDark, 0.35));
    // skin wrinkles: short curved folds, dark underneath, lit on top
    const fold = mix(M.wax, M.waxHi, 0.35);
    const crease = mix(M.wax, M.waxDark, 0.3);
    for (let i = 0; i < (v === 0 ? 0 : 1); i++) {
      const x = ox + 1 + Math.floor(r() * 10);
      const y = oy + 2 + Math.floor(r() * 11);
      const w = 3 + Math.floor(r() * 3);
      img.hline(x, y, w, fold);
      img.hline(x + 1, y + 1, w - 1, crease);
      img.set(x + w, y + 1, crease);
    }
    if (v === 1) {
      img.disc(ox + 11, oy + 5, 1.4, M.waxDark); // a bubble
      img.set(ox + 11, oy + 4, P.wax2);
      img.set(ox + 10, oy + 5, M.waxHi);
    }
    if (v === 2) img.set(ox + 5, oy + 11, M.waxDark); // a popped bubble
  }
  // 14-15 sunken flagstones (the drowned chapel): stones gone green, water standing in the joints
  const drowned: SlabPal = { base: mix(P.stone1, P.teal1, 0.3), mortar: mix(P.ink, P.teal1, 0.45), hi: mix(P.stone2, P.teal2, 0.3), lo: P.dark1 };
  for (const v of [14, 15]) {
    const [ox, oy] = at(v);
    const r = rng(4500 + v);
    if (v === 14) {
      flagstone(img, ox, oy, 0, 0, 16, 8, r, drowned, 0.1);
      flagstone(img, ox, oy, 0, 8, 7, 8, r, drowned, -0.2);
      flagstone(img, ox, oy, 7, 8, 9, 8, r, drowned);
    } else {
      flagstone(img, ox, oy, 0, 0, 10, 16, r, drowned, -0.1);
      flagstone(img, ox, oy, 10, 0, 6, 9, r, drowned, 0.2);
      flagstone(img, ox, oy, 10, 9, 6, 7, r, drowned);
    }
    for (let i = 0; i < 4; i++) img.set(ox + r() * 16, oy + (r() < 0.5 ? 0 : 8), P.moss1); // moss in the joints
  }
  // 16-31 bank tops: tangled roots and reeds, dark; a mossy rim where the bank meets the path
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(4600 + mask);
    img.rect(ox, oy, T, T, mix(P.dark1, P.teal1, 0.3));
    for (let i = 0; i < 3; i++) {
      const x0 = ox + 1 + r() * 14, y0 = oy + 1 + r() * 14;
      const x1 = ox + 1 + r() * 14, y1 = oy + 1 + r() * 14;
      line(img, x0, y0 + 1, x1, y1 + 1, mix(P.ink, P.dark1, 0.5));
      line(img, x0, y0, x1, y1, i ? mix(P.dark2, P.dark1, 0.4) : mix(M.root, P.dark2, 0.65)); // roots over roots
    }
    for (let i = 0; i < 3; i++) {
      // reeds
      const x = ox + 3 + Math.floor(r() * 10);
      const y = oy + 4 + Math.floor(r() * 8);
      img.vline(x, y, 3, M.grass2);
      img.set(x, y, M.grass3);
      img.set(x + 1, y + 2, M.grass0);
    }
    const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
    if (N) {
      img.hline(ox, oy, T, P.moss2);
      img.hline(ox, oy + 1, T, P.moss1);
    }
    if (S) {
      img.hline(ox, oy + 14, T, P.moss1);
      img.hline(ox, oy + 15, T, P.moss2);
    }
    if (W) {
      img.vline(ox, oy, T, P.moss2);
      img.vline(ox + 1, oy, T, P.moss1);
    }
    if (E) {
      img.vline(ox + 15, oy, T, P.moss1);
      img.vline(ox + 14, oy, T, mix(P.moss1, P.dark1, 0.4));
    }
  }

  shadeTiles(img, 32, 1);
  // 48-63: the wax pool's rounded lip spreading onto the mud, with a wet dark rim around it
  fringeTiles(48, 4, 4700, (x, y, d, r) => {
    if (d < 0.55) img.set(x, y, d < 0.2 && r() < 0.15 ? M.waxHi : M.wax);
    else if (d < 0.8) img.set(x, y, M.waxDark);
    else img.set(x, y, M.mudDark);
  });
  // 64-79: swamp grass creeping over the mud
  fringeTiles(64, 4, 4800, (x, y, d, r) => {
    if (d > 0.7 ? r() < 0.55 : r() < 0.15) return;
    img.set(x, y, d < 0.35 ? M.grass1 : r() < 0.5 ? M.grass2 : M.grass0);
  });

  sheet('tiles_mire', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 0, 0, 1, 1, 1, 2, 3],
      floor_grass: [4, 5, 42, 43],
      floor_wax: [10, 10, 10, 11, 12, 13],
      floor_stone: [14, 15],
      wall_front: [8, 9, 45, 46, 8, 9, 45, 46, 40, 8, 9, 45, 46, 41],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [6, 6, 7, 6, 44],
      shade: Array.from({ length: 8 }, (_, i) => 32 + i),
      fringe_floor_wax: Array.from({ length: 16 }, (_, i) => 48 + i),
      fringe_floor_grass: Array.from({ length: 16 }, (_, i) => 64 + i),
      glow: [41],
    },
  });


  // ---- creatures
  const P7 = phased7();
  const frames2 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  rosterSheet(
    'drowned_pilgrim',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames2(drawDrowned, [{}, { bob: 1, sway: 1 }]), timing: [{ ticks: 22 }, { ticks: 22 }], loop: true },
      { name: 'walk', frames: walk4(drawDrowned, f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1 })), timing: walkT(10), loop: true },
      {
        // Up out of the wax: head first, then shoulders, then it's standing.
        name: 'rise',
        frames: frames2(drawDrowned, [{ sink: 20 }, { sink: 14 }, { sink: 9 }, { sink: 5 }, { sink: 2, hunch: 2 }, { hunch: 1 }, {}]),
        timing: [{ ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 6 }],
        loop: false,
      },
      {
        name: 'claw',
        frames: frames2(drawDrowned, [{ sway: -1, lean: -1 }, { sway: -2, lean: -2 }, { sway: -2, lean: -2, bob: 1 }, { sway: 2, lean: 3 }, { sway: 2, lean: 2 }, { sway: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames2(drawDrowned, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => drownedDeath(c, f)),
    null,
  );
  rosterSheet(
    'mire_lantern',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames2(drawLantern, [{}, { bob: 1, sway: 1 }, { bob: 2 }, { bob: 1, sway: -1 }]), timing: [{ ticks: 14 }, { ticks: 14 }, { ticks: 14 }, { ticks: 14 }], loop: true },
      { name: 'walk', frames: frames2(drawLantern, [{}, { bob: 1, sway: 1 }, { bob: 2 }, { bob: 1, sway: -1 }]), timing: walkT(8), loop: true },
      { name: 'stagger', frames: frames2(drawLantern, [{ flinch: true, bob: 2 }, { flinch: true, bob: 3 }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => lanternDeath(c, f)),
    null,
  );
  const matronAnim = (name: string, poses: MatronPose[], timing: { ticks: number; phase?: string }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => drawMatron(c, d, p)),
    timing,
    loop,
  });
  rosterSheet(
    'mire_matron',
    64,
    [32, 58],
    7,
    [
      matronAnim('idle', [{ mouth: 0.4 }, { bob: 1, sway: 1, flick: 1 }, { bob: 1, sway: 1, mouth: 0.4 }, { flick: 1 }], [{ ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }], true),
      matronAnim('walk', [0, 1, 2, 3].map(f => ({ bob: f % 2 ? 1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0, flick: f % 2 })), walkT(12), true),
      // Drowning sweep: one long arm drawn back, then raked across the front
      matronAnim(
        'sweep',
        [{ swing: -0.6, sway: -2, lean: -1 }, { swing: -1, sway: -3, lean: -2 }, { swing: -1.1, sway: -3, lean: -2, bob: 1 }, { swing: 1.2, sway: 3, lean: 3 }, { swing: 1.2, sway: 3, lean: 2, flick: 1 }, { swing: 0.4, sway: 1 }, {}],
        P7,
        false,
      ),
      // Embrace (a grab): arms opened wide to take you in, then closing
      matronAnim(
        'embrace',
        [{ spread: 0.5, mouth: 0.4 }, { spread: 1, lean: -1, mouth: 0.6 }, { spread: 1.3, lean: -1, mouth: 0.6 }, { reach: 1, lean: 4 }, { reach: 1.1, lean: 4 }, { reach: 0.5, lean: 2 }, {}],
        P7,
        false,
      ),
      // Lullaby and calling the drowned: arms rising, singing
      matronAnim(
        'sing',
        [{ spread: 0.5, mouth: 0.5 }, { spread: 1, bob: -1, mouth: 1 }, { spread: 1.5, bob: -2, mouth: 1 }, { spread: 2, bob: -2, mouth: 1, flick: 1 }, { spread: 2, bob: -1, mouth: 1 }, { spread: 1, mouth: 0.5 }, {}],
        P7,
        false,
      ),
      // The wail (unblockable): she rears back, arms flung behind her, mouth wide, then screams
      matronAnim(
        'wail',
        [{ wail: 0.3, bob: -1 }, { wail: 0.7, bob: -2, lean: -2 }, { wail: 1, bob: -2, lean: -2, hunch: -1 }, { wail: 1, lean: 2, bob: 1, flick: 1 }, { wail: 1, lean: 2, bob: 1 }, { wail: 0.4, lean: 1 }, {}],
        P7,
        false,
      ),
      matronAnim(
        'intro',
        [{ rise: 30 }, { rise: 22, flick: 1 }, { rise: 14 }, { rise: 6, flick: 1 }, { spread: 1, mouth: 1 }, { spread: 2, bob: -1, mouth: 1 }],
        [{ ticks: 18 }, { ticks: 18 }, { ticks: 18 }, { ticks: 18 }, { ticks: 20 }, { ticks: 40 }],
        false,
      ),
      matronAnim('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => matronDeath(c, f)),
    MATRON_HAND,
  );

  const glob = new Img(8, 8);
  glob.disc(4, 4.5, 3, P.stone3);
  glob.disc(4, 4, 1.5, P.wax1);
  glob.set(3, 2, P.wax2);
  glob.outline(P.ink);
  sheet('mire_glob', glob, { cell: [8, 8], pivot: [4, 4], layer: 'fx' });
}

/**
 * Wax over a finished figure (before its outline): `level` 1 is a man going to wax (the helm and a shoulder coated,
 * the plume melted, runs down the front), 2 is gone (everything but the shield's wood, eyes gone to embers). The
 * pattern is fixed per pixel, so a pose doesn't flicker.
 */
function waxCoat(c: Img, level: number) {
  if (level <= 0) return;
  const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663) ^ 0x5bd1e995) >>> 0) % 1000 / 1000;
  const lum = (i: number) => (c.px[i] * 0.3 + c.px[i + 1] * 0.59 + c.px[i + 2] * 0.11) / 255;
  const near = (a: RGBA, i: number) => Math.abs(c.px[i] - a[0]) + Math.abs(c.px[i + 1] - a[1]) + Math.abs(c.px[i + 2] - a[2]) < 40;
  const coated = new Set<number>();
  let top = c.h;
  for (let i = 3; i < c.px.length; i += 4) if (c.px[i]) top = Math.min(top, Math.floor((i - 3) / 4 / c.w));
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 4;
      if (!c.px[i + 3]) continue;
      const wood = near(P.wood1, i) || near(P.wood2, i);
      const eye = near(P.cyan, i);
      if (eye) {
        if (level >= 2) c.set(x, y, P.ember);
        continue;
      }
      const red = near(P.blood1, i) || near(P.blood2, i);
      const rel = y - top; // rows down from the top of the head
      let chance: number;
      if (level === 1) chance = rel < 3 && red ? 1 : rel < 8 ? 0.55 : rel < 11 ? (x < c.w / 2 ? 0.5 : 0.1) : 0.08;
      else chance = wood ? 0.08 : rel < 9 ? 0.95 : 0.7;
      if (hash(x, y) >= chance) continue;
      const l = lum(i);
      c.set(x, y, l < 0.25 ? mix(P.wax1, P.ink, 0.45) : l < 0.45 ? mix(P.wax1, P.stone2, 0.3) : l < 0.65 ? P.wax1 : P.wax2);
      coated.add(y * c.w + x);
    }
  // runs: from coated pixels, wax creeps a few pixels down over what's beneath
  for (const k of [...coated]) {
    const x = k % c.w;
    const y = Math.floor(k / c.w);
    if (hash(x + 17, y) > (level === 1 ? 0.18 : 0.35)) continue;
    const len = 1 + Math.floor(hash(x, y + 5) * (level === 1 ? 3 : 5));
    for (let d = 1; d <= len; d++) {
      if (!c.alpha(x, y + d)) break;
      c.set(x, y + d, d === len ? mix(P.wax1, P.stone2, 0.35) : P.wax1);
    }
  }
}

/** The Warden's sheet (and his waxed kin): `wax` 0 plain, 1 going to wax, 2 gone. */
function wardenSheet(name: string, wax: number) {
  const P7 = phased7();
  const draw = (c: Img, d: Dir5, p: BodyPose & { shield?: number }) => {
    drawWarden(c, d, p);
    waxCoat(c, wax);
  };
  const walk4 = <T,>(dr: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => dr(c, d, mk(f)));
  const frames = <T,>(dr: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => dr(c, d, p));
  rosterSheet(
    name,
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(draw, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(draw, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(9), loop: true },
      {
        name: 'bash',
        frames: frames(draw, [
          { lean: -1, shield: -1 }, { lean: -2, shield: -1 }, { lean: -2, shield: -1, bob: 1 },
          { lean: 2, shield: 3 }, { lean: 2, shield: 3 }, { lean: 1, shield: 1 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      {
        name: 'thrust',
        frames: frames(draw, [{ lean: -1 }, { lean: -2 }, { lean: -2, bob: 1 }, { lean: 2 }, { lean: 3 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'overhead',
        frames: frames(draw, [
          { lean: -1, hunch: -1, bob: -1 }, { lean: -2, hunch: -2, bob: -1 }, { lean: -2, hunch: -2, bob: -1, flinch: false },
          { lean: 2, bob: 1, hunch: 1 }, { lean: 2, bob: 1, hunch: 2 }, { lean: 1, bob: 1 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames(draw, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => {
      wardenDeath(c, f);
      waxCoat(c, wax);
    }),
    WARDEN_HAND,
  );
}

function genRoster() {
  const P7 = phased7();
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  const frames = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));

  wardenSheet('warden', 0);
  // Brother Aldous, a Warden deserter going to wax (his plume already gone to it), and what he becomes if nobody
  // slows it: the same armour, the same shield, wax all the way through
  wardenSheet('aldous', 1);
  wardenSheet('aldous_unmade', 2);

  rosterSheet(
    'acolyte',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(drawAcolyte, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawAcolyte, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(8), loop: true },
      {
        name: 'throw',
        frames: frames(drawAcolyte, [
          { lean: -1, pot: 'hip' as PotPos }, { lean: -1, pot: 'raised' as PotPos }, { lean: -2, bob: -1, pot: 'raised' as PotPos },
          { lean: 2, pot: 'forward' as PotPos }, { lean: 2, pot: 'none' as PotPos }, { lean: 1, pot: 'none' as PotPos }, { pot: 'hip' as PotPos },
        ]),
        timing: P7,
        loop: false,
      },
      {
        name: 'shove',
        frames: frames(drawAcolyte, [{ bob: 1, hunch: 1 }, { bob: 1, hunch: 2, lean: -1 }, { bob: 1, hunch: 2, lean: -1 }, { lean: 2 }, { lean: 3 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames(drawAcolyte, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => acolyteDeath(c, f)),
    null,
  );

  rosterSheet(
    'hound',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(drawHound, [{}, { crouch: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawHound, f => ({ step: f })), timing: walkT(5), loop: true },
      {
        name: 'lunge',
        frames: frames(drawHound, [
          { crouch: 1, stretch: -1, head: -1 }, { crouch: 2, stretch: -1, head: -1 }, { crouch: 3, stretch: -1, head: -1 },
          { crouch: -1, stretch: 3, head: 2 }, { stretch: 2, head: 2 }, { stretch: 1 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      {
        name: 'bite',
        frames: frames(drawHound, [{ head: -1 }, { head: -2, crouch: 1 }, { head: -2, crouch: 1 }, { head: 3 }, { head: 2 }, { head: 0 }, {}]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames(drawHound, [{ crouch: 1, head: -1, flinch: true }, { crouch: 2, flinch: true }, { crouch: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => houndDeath(c, f)),
    null,
  );

  const BIG = 48;
  rosterSheet(
    'brute',
    BIG,
    [24, 44],
    7,
    [
      { name: 'idle', frames: frames(drawBrute, [{}, { bob: 1 }]), timing: [{ ticks: 24 }, { ticks: 24 }], loop: true },
      { name: 'walk', frames: walk4(drawBrute, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(12), loop: true },
      {
        name: 'slam',
        frames: frames(drawBrute, [
          { lean: -2, bob: -2, hunch: -2 }, { lean: -3, bob: -2, hunch: -2 }, { lean: -3, bob: -2, hunch: -2, sway: 1 },
          { lean: 3, bob: 2, hunch: 2 }, { lean: 3, bob: 3, hunch: 2 }, { lean: 2, bob: 2 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      {
        name: 'sweep',
        frames: frames(drawBrute, [{ sway: -2, lean: -1 }, { sway: -2, lean: -2 }, { sway: -2, lean: -2, bob: 1 }, { sway: 2, lean: 2 }, { sway: 2, lean: 2 }, { sway: 1, lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'grab',
        frames: frames(drawBrute, [{ lean: -1 }, { lean: 1, bob: 1, hunch: 1 }, { lean: 1, bob: 1, hunch: 1 }, { lean: 3 }, { lean: 3 }, { lean: 2 }, { lean: 2 }]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames(drawBrute, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => bruteDeath(c, f)),
    BRUTE_HAND,
  );

  // Weapons / thrown pot
  const spear = new Img(29, 7);
  spear.hline(1, 3, 21, P.wood2);
  spear.hline(1, 4, 21, P.wood1);
  spear.rect(22, 2, 4, 3, P.steel2);
  spear.set(26, 3, P.steel2);
  spear.set(22, 4, P.steel1);
  spear.outline(P.ink);
  sheet('warden_spear', spear, { cell: [29, 7], pivot: [6, 3], layer: 'weapon', points: { tip: [27, 3] } });

  const hammer = new Img(32, 16);
  hammer.hline(1, 8, 22, P.wood1);
  hammer.hline(1, 7, 22, P.wood2);
  for (let x = 22; x <= 29; x++) {
    const half = Math.round(2 + (x - 22) * 0.7);
    hammer.vline(x, 8 - half, half * 2, P.flame1);
    hammer.set(x, 8 - half, P.flame2);
    hammer.set(x, 8 + half - 1, P.ember);
  }
  hammer.vline(30, 2, 12, P.dark2);
  hammer.outline(P.ink);
  sheet('bell_hammer', hammer, { cell: [32, 16], pivot: [4, 8], layer: 'weapon', points: { tip: [30, 8] } });

  const firepot = new Img(8, 8);
  firepot.disc(4, 4.5, 3, P.wood2);
  firepot.hline(1, 4, 6, P.dark2);
  firepot.set(4, 1, P.flame2);
  firepot.set(3, 0, P.flame1);
  firepot.outline(P.ink);
  sheet('firepot', firepot, { cell: [8, 8], pivot: [4, 4], layer: 'fx' });
}

// ---------------------------------------------------------------- world bits (M5)
function genWorldBits() {
  // Props: frame 0 intact, frame 1 rubble. Pivot = base centre.
  const prop = (name: string, intact: (c: Img) => void, rubble: (c: Img) => void) => {
    const img = new Img(32, 16);
    [intact, rubble].forEach((draw, f) => {
      const c = new Img(16, 16);
      draw(c);
      c.outline(P.ink);
      img.blit(c, f * 16, 0);
    });
    sheet(name, img, { cell: [16, 16], pivot: [8, 14], layer: 'single' });
  };
  prop(
    'prop_crate',
    c => {
      boards(c, 2, 5, 12, 9, WOOD, false, 3, 7);
      box(c, 2, 3, 12, 3, WOOD); // lid
      c.vline(2, 3, 11, WOOD.c3); // corner posts
      c.vline(13, 3, 11, WOOD.c0);
      line(c, 3, 13, 12, 6, WOOD.c2); // cross brace
      c.set(12, 9, IRON.c3); // nail heads
      c.set(3, 9, IRON.c2);
      c.set(7, 4, P.dark2); // a stencilled mark
      c.set(8, 4, P.dark2);
    },
    c => {
      c.rect(2, 12, 5, 2, WOOD.c1);
      c.hline(2, 12, 5, WOOD.c3);
      c.rect(8, 11, 6, 2, WOOD.c2);
      line(c, 4, 10, 7, 12, WOOD.c2); // splinters
      c.rect(5, 13, 4, 1, P.dark2);
      c.set(12, 10, IRON.c2);
    },
  );
  prop(
    'prop_pot',
    c => {
      blob(c, 8, 9.5, 5, 4.5, WOOD);
      c.hline(4, 9, 9, P.flame1); // glazed band
      c.set(5, 9, P.flame2);
      c.rect(6, 3, 4, 2, WOOD.c2); // neck
      c.hline(5, 3, 6, WOOD.c3);
      c.hline(6, 4, 4, WOOD.c0);
      c.hline(4, 13, 8, WOOD.c0);
      c.set(10, 7, P.ink); // a chip
    },
    c => {
      blob(c, 5, 12, 2.5, 1.5, WOOD);
      blob(c, 11, 12, 3, 1.5, WOOD);
      c.set(8, 13, P.flame1);
      c.set(7, 13, WOOD.c0);
    },
  );
  prop(
    'prop_candles',
    c => {
      c.ellipse(8, 13, 6, 2, P.wax1);
      c.ellipse(7, 12.5, 4.5, 1.2, P.wax2);
      for (const [x, h] of [[4, 5], [7, 8], [11, 6]] as const) candleAt(c, x, 13, h);
    },
    c => {
      c.ellipse(8, 13, 6, 2, P.wax1);
      c.rect(5, 11, 5, 2, P.wax2);
      c.hline(5, 12, 5, P.wax1);
      c.set(11, 12, P.wax2); // a snapped stub
    },
  );

  // Door: frame 0 = in a horizontal wall (face-on, with the wall cap above), frame 1 = in a vertical wall
  // (seen from above). Cell 16x32, pivot at the bottom of the door's tile.
  const door = new Img(32, 32);
  {
    const c = new Img(16, 32);
    c.rect(0, 0, 16, 16, P.dark1); // cap above
    c.hline(0, 0, 16, P.stone4);
    c.hline(0, 1, 16, P.stone3);
    box(c, 0, 16, 16, 16, STN); // stone frame
    c.hline(1, 16, 14, P.stone4); // arch keystone line
    boards(c, 2, 18, 12, 12, DWOOD, true, 3, 17); // planks
    c.rect(2, 17, 12, 1, P.ink);
    for (const y of [20, 26]) {
      c.hline(2, y, 12, IRON.c1); // iron bands
      c.set(2, y, IRON.c3);
      c.set(13, y, IRON.c3);
    }
    c.disc(11, 23, 1.2, BRONZE.c1); // ring handle
    c.set(11, 23, P.ink);
    c.rect(0, 30, 16, 2, P.dark2);
    door.blit(c, 0, 0);
  }
  {
    const c = new Img(16, 32);
    c.rect(0, 16, 16, 16, P.dark1);
    box(c, 4, 16, 8, 16, DWOOD);
    for (const y of [19, 28]) {
      c.hline(4, y, 8, IRON.c1);
      c.set(4, y, IRON.c3);
    }
    c.set(10, 24, BRONZE.c2);
    door.blit(c, 16, 0);
  }
  sheet('door', door, { cell: [16, 32], pivot: [8, 32], layer: 'single' });

  // Loot drops: frame 0 tallow, frame 1 powder pouch
  const loot = new Img(14, 7);
  loot.disc(3.5, 4, 2, P.wax1);
  loot.set(3, 1, P.wax1);
  loot.set(3, 2, P.wax1);
  loot.set(2, 3, P.wax2);
  loot.rect(8, 2, 4, 4, P.wood2);
  loot.hline(8, 2, 4, P.dark2);
  loot.outline(P.ink);
  sheet('loot', loot, { cell: [7, 7], pivot: [3, 5], layer: 'fx' });

  // Explosion burst
  const R = 40;
  const blast = new Img(R * 4, R);
  [8, 13, 17, 19].forEach((r, f) => {
    const c = new Img(R, R);
    if (f === 0) {
      c.disc(20, 24, r, P.flame2);
      c.disc(20, 24, r - 4, P.wax2);
    } else if (f === 1) {
      c.disc(20, 24, r, P.flame1);
      c.disc(20, 24, r - 5, P.flame2);
    } else if (f === 2) c.ellipse(20, 24, r, r * 0.8, P.ember, (x, y) => (x + y) % 2 === 0);
    else c.ellipse(20, 22, r, r * 0.7, P.stone4, (x, y) => x % 2 === 0 && y % 2 === 0);
    blast.blit(c, f * R, 0);
  });
  sheet('blast', blast, {
    cell: [R, R],
    pivot: [20, 24],
    layer: 'fx',
    animations: { burst: { row: 0, dirs: ['S'], loop: false, frames: [{ ticks: 3 }, { ticks: 4 }, { ticks: 5 }, { ticks: 8 }] } },
  });
}

// ---------------------------------------------------------------- tiles
// ---------------------------------------------------------------- shared tileset helpers
/** Top-left pixel of tile `idx` in an 8-column, 16 px tileset. */
const tileAt = (idx: number) => [(idx % 8) * 16, Math.floor(idx / 8) * 16] as const;

/** Blend `col` over whatever is already at (x, y), keeping transparency (for overlay tiles). */
function over(img: Img, x: number, y: number, col: RGBA, a: number) {
  const i = (Math.floor(y) * img.w + Math.floor(x)) * 4;
  const prev = img.px[i + 3] / 255;
  const out = 1 - (1 - prev) * (1 - a / 255);
  if (!prev) return img.set(x, y, withAlpha(col, Math.round(a)));
  const k = a / 255 / out;
  const old: RGBA = [img.px[i], img.px[i + 1], img.px[i + 2], 255];
  img.set(x, y, withAlpha(mix(old, col, k), Math.round(out * 255)));
}

/** 8 wall-shadow overlay tiles from index `start` (mask of closed sides N=1 E=2 W=4). `k` scales the darkness. */
function shadeTiles(img: Img, start: number, k: number) {
  for (let m = 1; m < 8; m++) {
    const [ox, oy] = tileAt(start + m);
    if (m & 1) [120, 80, 50, 26, 10].forEach((a, y) => { for (let x = 0; x < 16; x++) over(img, ox + x, oy + y, P.ink, a * k); });
    if (m & 2) [70, 40, 16].forEach((a, x) => { for (let y = 0; y < 16; y++) over(img, ox + 15 - x, oy + y, P.ink, a * k); });
    if (m & 4) [90, 55, 28, 10].forEach((a, x) => { for (let y = 0; y < 16; y++) over(img, ox + x, oy + y, P.ink, a * k); });
  }
}

type Side = 'N' | 'E' | 'S' | 'W';
/**
 * 16 soft-edge overlay tiles from index `start` (mask of neighbouring sides that hold the variant: N=1 E=2 S=4 W=8).
 * `edge(x, y, depth)` is called for every pixel within `reach` of a marked side; `depth` is 0 at the border.
 * The reach wobbles along the edge (but is the same at both ends of each side, so neighbours line up).
 */
function fringeTiles(start: number, reach: number, seed: number, edge: (x: number, y: number, depth: number, r: () => number) => void) {
  for (let m = 1; m < 16; m++) {
    const [ox, oy] = tileAt(start + m);
    const r = rng(seed + m);
    const sides: [Side, number][] = [['N', 1], ['E', 2], ['S', 4], ['W', 8]];
    for (const [side, bit] of sides) {
      if (!(m & bit)) continue;
      const wob = [r(), r(), r()];
      for (let t = 0; t < 16; t++) {
        // wobble: zero at both ends, bulging in between
        const env = Math.sin((t / 15) * Math.PI);
        const len = Math.max(1, Math.round(reach * (0.55 + 0.45 * env * (0.6 + 0.4 * Math.sin(t * 0.9 + wob[0] * 6)) + (wob[1] - 0.5) * env)));
        for (let d = 0; d < len; d++) {
          const [x, y] = side === 'N' ? [t, d] : side === 'S' ? [t, 15 - d] : side === 'W' ? [d, t] : [15 - d, t];
          edge(ox + x, oy + y, d / len, r);
        }
      }
    }
  }
}

interface SlabPal {
  base: RGBA;
  mortar: RGBA;
  hi: RGBA;
  lo: RGBA;
}
/** A flagstone filling [x, y, w, h] of a tile, its mortar joint along its top and left edges (lit from the top left). */
function flagstone(img: Img, ox: number, oy: number, x: number, y: number, w: number, h: number, r: () => number, p: SlabPal, tone = 0) {
  const base = tone < 0 ? mix(p.base, p.lo, -tone) : mix(p.base, p.hi, tone);
  img.rect(ox + x, oy + y, w, h, base);
  img.hline(ox + x, oy + y, w, p.mortar);
  img.vline(ox + x, oy + y, h, p.mortar);
  img.hline(ox + x + 2, oy + y + 1, w - 4, mix(base, p.hi, 0.5));
  img.vline(ox + x + 1, oy + y + 2, h - 4, mix(base, p.hi, 0.3));
  img.hline(ox + x + 1, oy + y + h - 1, w - 1, mix(base, p.mortar, 0.35));
  for (let i = 0; i < (w * h) / 22; i++)
    img.set(ox + x + 2 + r() * (w - 4), oy + y + 2 + r() * (h - 4), r() < 0.6 ? mix(base, p.lo, 0.6) : mix(base, p.hi, 0.45));
  if (r() < 0.3) img.set(ox + x + w - 1, oy + y + h - 1, p.mortar);
}

// ---------------------------------------------------------------- Abbey tileset
// Light comes from the top left: slab and block edges facing up/left catch a highlight, edges facing
// down/right fall into shadow. Everything shares the palette's cool abbey-stone ramp plus a few in-betweens.
const STONE = {
  mortar: hex('#3d3544'),
  s15: hex('#4e4a59'),
  s25: hex('#67637a'),
  s35: hex('#8b869d'),
  grime: hex('#2f2935'),
  moss3: hex('#7f9f55'),
  mossDark: hex('#2b3d28'),
};

function genTiles() {
  const T = 16;
  const img = new Img(T * 8, T * 7);
  const at = (idx: number) => [(idx % 8) * T, Math.floor(idx / 8) * T] as const;

  /** One flagstone occupying [x, y, w, h] of a tile, its mortar joint on its top and left edges. */
  const FLOOR = mix(P.stone1, P.stone2, 0.55);
  const slab = (ox: number, oy: number, x: number, y: number, w: number, h: number, r: () => number, tone = 0) => {
    const base = tone < 0 ? mix(FLOOR, P.stone1, -tone) : mix(FLOOR, P.stone2, tone);
    img.rect(ox + x, oy + y, w, h, base);
    img.hline(ox + x, oy + y, w, STONE.mortar);
    img.vline(ox + x, oy + y, h, STONE.mortar);
    img.hline(ox + x + 2, oy + y + 1, w - 4, mix(base, STONE.s25, 0.5)); // lit top edge
    img.vline(ox + x + 1, oy + y + 2, h - 4, mix(base, STONE.s25, 0.3)); // lit left edge
    img.hline(ox + x + 1, oy + y + h - 1, w - 1, mix(base, STONE.mortar, 0.35)); // shaded bottom edge
    // worn surface: faint speckle, the odd scuff
    for (let i = 0; i < (w * h) / 22; i++)
      img.set(ox + x + 2 + r() * (w - 4), oy + y + 2 + r() * (h - 4), r() < 0.6 ? mix(base, P.stone1, 0.6) : mix(base, STONE.s25, 0.45));
    if (r() < 0.3) img.set(ox + x + w - 1, oy + y + h - 1, STONE.mortar); // chipped corner
  };
  const crack = (ox: number, oy: number, pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) line(img, ox + pts[i - 1][0], oy + pts[i - 1][1], ox + pts[i][0], oy + pts[i][1], STONE.mortar);
  };
  const waxSpill = (ox: number, oy: number, x: number, y: number) => {
    img.ellipse(ox + x + 0.5, oy + y + 1, 4.5, 2.5, mix(FLOOR, P.dark2, 0.3)); // soot
    for (const [dx, dy, rx, ry] of [[0, 0, 2.2, 1.3], [2, 1, 1.4, 1], [-2, 1, 1, 0.8]]) img.ellipse(ox + x + dx, oy + y + dy, rx, ry, mix(P.wax1, FLOOR, 0.5));
    img.set(ox + x - 1, oy + y - 1, mix(P.wax1, FLOOR, 0.2));
  };
  const floor = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(1000 + idx * 7);
    switch (v) {
      case 0:
      case 1:
      case 2: // plain slabs, three slightly different stones
        slab(ox, oy, 0, 0, 16, 16, r, [0, -0.25, 0.2][v]);
        break;
      case 3:
        slab(ox, oy, 0, 0, 16, 7, r, 0.15);
        slab(ox, oy, 0, 7, 6, 9, r, -0.2);
        slab(ox, oy, 6, 7, 10, 9, r);
        break;
      case 4:
        slab(ox, oy, 0, 0, 9, 16, r, -0.15);
        slab(ox, oy, 9, 0, 7, 9, r, 0.2);
        slab(ox, oy, 9, 9, 7, 7, r);
        break;
      case 5: // old cobbles
        slab(ox, oy, 0, 0, 8, 8, r, 0.15);
        slab(ox, oy, 8, 0, 8, 8, r, -0.25);
        slab(ox, oy, 0, 8, 8, 8, r, -0.1);
        slab(ox, oy, 8, 8, 8, 8, r, 0.2);
        break;
      case 6:
        slab(ox, oy, 0, 0, 16, 16, r, -0.1);
        crack(ox, oy, [[4, 1], [6, 5], [5, 8], [8, 12], [9, 15]]);
        crack(ox, oy, [[5, 8], [2, 10]]);
        break;
      case 7: // wax spilled from some long-gone candle, and its soot
        slab(ox, oy, 0, 0, 16, 16, r, 0.1);
        waxSpill(ox, oy, 8, 8);
        break;
      case 8: {
        // a grave slab worn almost smooth: a carved flame over a bar
        slab(ox, oy, 0, 0, 16, 16, r, 0.05);
        const carve = mix(FLOOR, STONE.mortar, 0.6);
        const lip = mix(FLOOR, STONE.s25, 0.5);
        for (const [x, y] of [[8, 4], [7, 5], [8, 5], [7, 6], [8, 6], [9, 6], [7, 7], [8, 7]]) {
          img.set(ox + x, oy + y, carve);
          img.set(ox + x, oy + y + 1, lip);
        }
        img.hline(ox + 5, oy + 10, 6, carve);
        img.hline(ox + 5, oy + 11, 6, lip);
        break;
      }
      case 9:
        slab(ox, oy, 0, 0, 16, 9, r, -0.2);
        slab(ox, oy, 0, 9, 10, 7, r, 0.1);
        slab(ox, oy, 10, 9, 6, 7, r, -0.05);
        break;
    }
  };
  // Floor variants live in row 0 and row 5 (indices 40+).
  const FLOOR_AT = [0, 1, 2, 3, 4, 5, 6, 7, 40, 41];
  FLOOR_AT.forEach((idx, v) => floor(idx, v));

  // Moss grows out of the joints first, then spreads over the slabs in soft clumps.
  const mossy = (idx: number, v: number, seed: number, clumps: number) => {
    floor(idx, v);
    const [ox, oy] = at(idx);
    const r = rng(seed);
    // short runs along the joints, never a full edge (full edges would draw the tile grid)
    for (let i = 0; i < 2; i++) {
      const a = 2 + Math.floor(r() * 8);
      for (let k = 0; k < 3 + r() * 3; k++) img.set(ox + a + k, oy, P.moss1);
      const b = 2 + Math.floor(r() * 8);
      for (let k = 0; k < 3 + r() * 3; k++) img.set(ox, oy + b + k, P.moss1);
    }
    for (let i = 0; i < clumps; i++) {
      const cx = ox + 3 + r() * 10;
      const cy = oy + 3 + r() * 10;
      const rx = 1.5 + r() * 2;
      const ry = 1.2 + r() * 1.3;
      img.ellipse(cx, cy + 0.7, rx, ry, STONE.mossDark);
      img.ellipse(cx, cy, rx, ry, P.moss1);
      img.ellipse(cx - 0.4, cy - 0.5, rx * 0.55, ry * 0.5, P.moss2);
      img.set(cx - 1, cy - 1, STONE.moss3);
    }
    for (let i = 0; i < 4 + (3 - clumps) * 3; i++) img.set(ox + 1 + r() * 14, oy + 1 + r() * 14, r() < 0.6 ? P.moss1 : P.moss2); // loose tufts
  };
  mossy(8, 0, 31, 3);
  mossy(9, 3, 47, 2);
  mossy(42, 1, 59, 3);
  mossy(43, 2, 71, 1);
  mossy(44, 5, 83, 0);

  // Rock: the solid mass outside every room. Almost black, with big soft lumps so it isn't a flat void.
  for (const idx of [10, 11]) {
    const [ox, oy] = at(idx);
    const r = rng(500 + idx);
    img.rect(ox, oy, T, T, P.ink);
    for (let i = 0; i < 3; i++) {
      const cx = ox + 3 + r() * 10;
      const cy = oy + 3 + r() * 10;
      img.ellipse(cx, cy, 2 + r() * 2, 1.5 + r() * 1.5, mix(P.ink, P.dark1, 0.6));
      img.set(cx - 1, cy - 1, P.dark1);
    }
    for (let i = 0; i < 5; i++) img.set(ox + 1 + r() * 14, oy + 1 + r() * 14, mix(P.ink, P.dark1, 0.5));
  }

  // Wall front: three courses of ashlar under a lit lip, darkening toward the floor.
  const front = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(900 + idx);
    img.rect(ox, oy, T, T, P.stone2);
    const courses: [number, number, number[], number][] = [
      [1, 4, [7, 15], 0],
      [6, 4, [3, 11], -0.15],
      [11, 3, [7, 15], -0.35],
    ];
    for (const [y, h, joints, dim] of courses) {
      const face = mix(P.stone3, P.stone2, -dim);
      let x0 = 0;
      for (const j of [...joints, 16]) {
        const w = j - x0;
        const tone = (r() - 0.5) * 0.25;
        const c = tone > 0 ? mix(face, STONE.s35, tone) : mix(face, P.stone2, -tone);
        img.rect(ox + x0, oy + y, w, h, c);
        img.hline(ox + x0, oy + y, w, mix(c, P.stone4, 0.45)); // top edge catches the light
        img.vline(ox + x0, oy + y + 1, h - 1, mix(c, STONE.s35, 0.3));
        img.hline(ox + x0, oy + y + h - 1, w, mix(c, P.stone2, 0.6));
        if (r() < 0.6) img.set(ox + x0 + 1 + r() * (w - 2), oy + y + 1 + r() * (h - 2), mix(c, P.stone2, 0.7)); // pit
        if (j < 16) img.vline(ox + j, oy + y, h, STONE.mortar);
        x0 = j + 1;
      }
    }
    img.hline(ox, oy + 5, T, STONE.mortar);
    img.hline(ox, oy + 10, T, STONE.mortar);
    img.hline(ox, oy, T, P.stone4); // the lip under the wall top
    img.hline(ox, oy + 14, T, P.dark2); // plinth in shadow
    img.hline(ox, oy + 15, T, STONE.grime);
    if (v === 1) {
      // a broken block, and moss where the damp gets in
      img.rect(ox + 4, oy + 6, 6, 4, P.dark2);
      img.hline(ox + 4, oy + 6, 6, P.dark1);
      img.set(ox + 9, oy + 9, P.stone2);
      img.hline(ox + 5, oy + 10, 3, STONE.mortar);
      for (const x of [1, 2, 3, 11, 12]) img.set(ox + x, oy + 13, P.moss1);
      img.set(ox + 2, oy + 12, P.moss2);
      img.set(ox + 12, oy + 12, P.moss2);
    }
    if (v === 2) {
      // candle niche: a small arch with a lit stub; its light warms the niche walls
      const glow = mix(P.dark2, P.ember, 0.35);
      img.rect(ox + 5, oy + 4, 6, 7, P.dark1);
      img.hline(ox + 6, oy + 3, 4, P.dark1);
      img.hline(ox + 6, oy + 2, 4, P.stone4);
      img.set(ox + 5, oy + 3, P.stone4);
      img.set(ox + 10, oy + 3, P.stone4);
      img.vline(ox + 5, oy + 5, 5, glow);
      img.vline(ox + 10, oy + 5, 5, glow);
      img.hline(ox + 5, oy + 11, 6, P.stone4); // sill
      img.rect(ox + 7, oy + 8, 2, 3, P.wax2);
      img.set(ox + 8, oy + 10, P.wax1);
      img.set(ox + 7, oy + 7, P.flame1);
      img.set(ox + 8, oy + 6, P.flame2);
      img.set(ox + 8, oy + 7, P.flame2);
      img.set(ox + 7, oy + 5, mix(P.dark1, P.flame1, 0.4));
      img.set(ox + 8, oy + 5, mix(P.dark1, P.flame1, 0.4));
    }
    if (v === 3) {
      // wax that ran down from the wall top and set
      for (const [x, len] of [[3, 6], [4, 9], [11, 4], [12, 7]]) {
        img.vline(ox + x, oy + 1, len, P.wax1);
        img.set(ox + x, oy + len, P.wax2);
        img.set(ox + x, oy + len + 1, mix(P.wax1, P.stone2, 0.5));
      }
      img.vline(ox + 3, oy + 1, 3, P.wax2);
      img.vline(ox + 11, oy + 1, 2, P.wax2);
    }
  };
  front(12, 0);
  front(13, 1);
  front(14, 2);
  front(15, 3);

  // 48-51: the same wall where it's damp: ivy hanging down from the wall top, moss grown up its foot
  const ivyFront = (idx: number, v: number, vines: [number, number][], seed: number) => {
    front(idx, v);
    const [ox, oy] = at(idx);
    const r = rng(seed);
    for (let x = 0; x < T; x++) {
      if (r() < 0.55) img.set(ox + x, oy, r() < 0.5 ? P.moss2 : P.moss1); // leaves spilling over the lip
      if (r() < 0.3) img.set(ox + x, oy + 1, P.moss1);
      if (r() < 0.45) img.set(ox + x, oy + 13, r() < 0.5 ? P.moss1 : STONE.mossDark); // moss at the foot
      if (r() < 0.3) img.set(ox + x, oy + 12, P.moss1);
    }
    for (const [x, len] of vines) ivy(img, ox + x, oy + 1, len, seed + x);
  };
  ivyFront(48, 0, [[3, 10], [11, 7]], 4801);
  ivyFront(49, 0, [[1, 12], [4, 8], [6, 13], [13, 9]], 4901);
  ivyFront(50, 1, [[12, 11], [14, 6]], 5001);
  ivyFront(51, 0, [[8, 13]], 5101);

  // Wall tops (16 masks: which sides border open floor, N=1 E=2 S=4 W=8). A dark flagged walkway,
  // with a pale coping stone wherever the wall edge meets the room.
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(77 + mask);
    img.rect(ox, oy, T, T, P.dark2);
    // big slabs along the wall top
    for (const [x, y, w, h] of [[0, 0, 9, 8], [9, 0, 7, 8], [0, 8, 5, 8], [5, 8, 11, 8]]) {
      img.hline(ox + x, oy + y, w, P.dark1);
      img.vline(ox + x, oy + y, h, P.dark1);
      img.hline(ox + x + 1, oy + y + 1, w - 2, mix(P.dark2, P.stone1, 0.55));
    }
    for (let i = 0; i < 6; i++) img.set(ox + r() * 16, oy + r() * 16, r() < 0.5 ? P.dark1 : P.stone1);
    const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
    if (N) {
      img.hline(ox, oy, T, P.stone4);
      img.hline(ox, oy + 1, T, P.stone3);
      img.hline(ox, oy + 2, T, P.stone1);
    }
    if (S) {
      img.hline(ox, oy + 13, T, P.stone1);
      img.hline(ox, oy + 14, T, P.stone3);
      img.hline(ox, oy + 15, T, P.stone3);
    }
    if (W) {
      img.vline(ox, oy, T, P.stone4);
      img.vline(ox + 1, oy, T, P.stone3);
      img.vline(ox + 2, oy + (N ? 3 : 0), T - (N ? 3 : 0) - (S ? 3 : 0), P.stone1);
    }
    if (E) {
      img.vline(ox + 15, oy, T, P.stone2);
      img.vline(ox + 14, oy, T, P.stone3);
      img.vline(ox + 13, oy + (N ? 3 : 0), T - (N ? 3 : 0) - (S ? 3 : 0), P.stone1);
    }
    // rounded outer corners
    if (N && W) img.set(ox, oy, P.stone3);
    if (N && E) img.set(ox + 15, oy, P.stone3);
    if (S && W) img.set(ox, oy + 15, P.stone2);
    if (S && E) img.set(ox + 15, oy + 15, P.stone2);
  }

  shadeTiles(img, 32, 1);

  sheet('tiles', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      // mostly plain slabs; split slabs now and then; cracks, wax and grave slabs are rare finds
      floor: [...Array(9).fill(0), ...Array(7).fill(1), ...Array(7).fill(2), 3, 3, 4, 4, 5, 41, 41, 6, 7, 40],
      floor_moss: [8, 9, 42, 43, 43, 44],
      wall_front: [12, 12, 12, 12, 12, 13, 12, 12, 14, 15, 12, 51],
      // walls with moss at their foot grow ivy (see TileGrid: wall faces by nearby floor)
      wall_front_floor_moss: [48, 49, 50, 49, 51],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [10, 10, 11],
      shade: Array.from({ length: 8 }, (_, i) => 32 + i),
      glow: [14], // candle niches light the wall and floor around them
    },
  });

  // Candle light: stepped rings with a dithered edge between steps, so it stays pixel art when added on top.
  const R = 28;
  const glowImg = new Img(R * 2, R * 2);
  const BAYER = [0, 0.5, 0.75, 0.25];
  const ALPHA = [0, 34, 62, 95, 135];
  const warm = mix(P.flame1, P.ember, 0.35);
  for (let y = 0; y < R * 2; y++)
    for (let x = 0; x < R * 2; x++) {
      const d = Math.hypot(x + 0.5 - R, (y + 0.5 - R) * 1.15) / R;
      if (d >= 1) continue;
      const v = (1 - d) * 4;
      const frac = v - Math.floor(v);
      // dither only in a thin band at each step, so the rings stay clean
      const level = Math.min(4, frac > 0.8 ? Math.floor(v + BAYER[(y % 2) * 2 + (x % 2)] - 0.3) : Math.floor(v));
      if (level > 0) glowImg.set(x, y, withAlpha(warm, ALPHA[level]));
    }
  sheet('light_glow', glowImg, { cell: [R * 2, R * 2], pivot: [R, R], layer: 'fx' });
}

/** 1px line (Bresenham). */
function line(img: Img, x0: number, y0: number, x1: number, y1: number, c: RGBA) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    img.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) (err += dy), (x0 += sx);
    if (e2 <= dx) (err += dx), (y0 += sy);
  }
}

// ---------------------------------------------------------------- Wick's Rest decor (64x64 cells, pivot 32,62)
// Multi-tile pieces are drawn so they cover exactly their blocking tiles (see data/decor.json).

// ---------------------------------------------------------------- NPCs (32x32, pivot 16,28); portraits (48x48) are painted in tools/portraits.ts
// NPC frames: 0-1 idle (breathing), 2-3 talking (mouth open / closed). Skin is pale wax: everyone here is
// half a candle already.




function genNpcs() {
  genTownsfolk();
  const who = ['oskar', 'maudlin', 'pip', 'tollwarden', 'matron', 'chandler', 'tomas', 'hedda', 'bede', 'agnes', 'ulla', 'jost', 'lome', 'wenna', 'fennick', 'cuthwin', 'hobb', 'wren', 'gunner', 'hild', 'queen', 'scarecrow', 'aldous'] as const;
  // painted head-and-shoulders portraits for the dialogue box (tools/portraits.ts)
  const pr = renderPortraits(who);
  const portraits = new Img(pr.w, pr.h);
  portraits.px.set(pr.px);
  sheet('portraits', portraits, { cell: [PORTRAIT, PORTRAIT], pivot: [0, 0], layer: 'ui' });
}

// ---------------------------------------------------------------- chest (20x18 cells, pivot = ground centre)
// Frames: 0 closed, 1-3 opening (lid rising, light spilling out), 4 open and empty.
function genChest() {
  const W = 20;
  const H = 18;
  const body = (c: Img) => {
    boards(c, 2, 9, 16, 7, WOOD, false, 3, 5);
    for (const x of [5, 14]) {
      c.vline(x, 9, 7, IRON.c2); // iron straps
      c.set(x, 10, IRON.c3);
    }
    c.vline(2, 9, 7, WOOD.c3);
    c.vline(17, 9, 7, WOOD.c0);
    c.hline(2, 15, 16, WOOD.c0);
  };
  const frames: Img[] = [];
  for (let f = 0; f < 5; f++) {
    const c = new Img(W, H);
    body(c);
    if (f === 0) {
      box(c, 2, 5, 16, 4, WOOD); // lid, rounded
      c.hline(3, 4, 14, WOOD.c3);
      for (const x of [5, 14]) {
        c.vline(x, 4, 5, IRON.c2);
        c.set(x, 4, IRON.c3);
      }
      box(c, 9, 8, 2, 3, BRONZE); // lock
      c.set(9, 9, P.ink);
    } else {
      const lift = [0, 2, 4, 5, 5][f];
      const inside = f === 4 ? P.dark1 : f === 1 ? P.flame1 : P.flame2;
      c.rect(3, 9, 14, 2, inside); // the open mouth of the chest
      c.rect(2, 8 - lift, 16, Math.max(1, 5 - lift), WOOD.c1); // lid tipping back: seen from below, shorter
      c.hline(3, 7 - lift, 14, WOOD.c3);
      c.hline(2, 8 - lift + Math.max(1, 5 - lift) - 1, 16, WOOD.c0);
      if (f >= 2 && f <= 3) {
        c.rect(5, 6 - lift, 10, lift + 2, withAlpha(P.wax2, 150)); // light spilling up
        c.set(10, 1, P.wax2);
        c.set(7, 2, P.flame2);
        c.set(13, 3, P.flame2);
      }
    }
    c.outline(P.ink);
    finish(c, 10, 16, 9, 1.5);
    frames.push(c);
  }
  // Frames 5-9: the same five, half-buried: sunk 4 px, with a mound of broken floor over the bottom.
  for (let f = 0; f < 5; f++) {
    const c = new Img(W, H);
    c.blit(frames[f], 0, 4);
    for (let x = 0; x < W; x++) for (let y = 14; y < H; y++) c.set(x, y, null);
    c.ellipse(10, 15, 10, 3, P.dark2);
    c.ellipse(10, 14, 9, 2, P.stone2);
    for (const x of [3, 8, 14, 17]) c.set(x, 13, P.stone3);
    frames.push(c);
  }
  const img = new Img(W * frames.length, H);
  frames.forEach((f, i) => img.blit(f, i * W, 0));
  sheet('chest', img, {
    cell: [W, H],
    pivot: [10, 16],
    layer: 'single',
    animations: {
      open: { row: 0, dirs: ['S'], loop: false, frames: [{ ticks: 4, col: 1 }, { ticks: 6, col: 2 }, { ticks: 14, col: 3 }, { ticks: 1, col: 4 }] },
    },
  });
}

// ---------------------------------------------------------------- Penance Road tileset (same index layout as `tiles`)
// Dirt floor, grass, a packed cart road, earth cliffs with grassy tops, and dark forest outside the ravine.
function genRoadTiles() {
  const T = 16;
  const img = new Img(T * 8, T * 10);
  const at = tileAt;
  const E = {
    d0: hex('#2c1f1b'),
    d1: mix(P.wood1, P.dark2, 0.2),
    d2: P.wood1,
    d3: hex('#6d4a33'),
    d4: P.wood2,
    d5: hex('#9b7550'),
    g0: hex('#1f2e1d'),
    g1: P.moss1,
    g2: P.moss2,
    g3: hex('#7f9f55'),
    g4: hex('#a2bd6c'),
    leaf0: hex('#0d1c1d'),
  };
  const speck = (ox: number, oy: number, r: () => number, n: number, c: RGBA, m = 0) => {
    for (let i = 0; i < n; i++) img.set(ox + m + Math.floor(r() * (16 - m * 2)), oy + m + Math.floor(r() * (16 - m * 2)), c);
  };
  /** A small clod or stone, lit from the top left. */
  const clod = (x: number, y: number, w: number, base: RGBA, hi: RGBA, lo: RGBA) => {
    img.rect(x, y, w, 2, base);
    img.set(x, y, hi);
    img.hline(x, y + 2, w, lo);
  };
  /** A tuft of grass blades rooted at (x, y). */
  const tuft = (x: number, y: number, r: () => number, tall = 3) => {
    img.set(x, y, E.g0);
    img.set(x + 1, y, E.g0);
    const blades: [number, number][] = [[0, tall], [1, tall - 1], [-1, tall - 2], [2, tall - 2]];
    for (const [dx, h] of blades) {
      if (h <= 0 || r() < 0.2) continue;
      img.vline(x + dx, y - h, h, E.g2);
      img.set(x + dx, y - h, E.g3);
    }
  };

  // 0-3 dirt: dusk-brown earth, clods and pebbles
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(v);
    const r = rng(2000 + v);
    img.rect(ox, oy, T, T, E.d2);
    speck(ox, oy, r, 16, E.d1);
    speck(ox, oy, r, 8, E.d3);
    speck(ox, oy, r, 4, E.d0, 1);
    for (let i = 0; i < 2 + v; i++) clod(ox + 1 + r() * 12, oy + 1 + r() * 12, 2, E.d3, E.d4, E.d1);
    if (v === 1) clod(ox + 9, oy + 5, 2, P.stone2, P.stone3, E.d0); // pebble
    if (v === 2) {
      clod(ox + 4, oy + 9, 3, P.stone2, P.stone3, E.d0);
      img.set(ox + 11, oy + 3, P.stone3);
    }
    if (v === 3) {
      img.set(ox + 6, oy + 6, E.g1); // a stray blade
      img.set(ox + 6, oy + 5, E.g2);
      line(img, ox + 9, oy + 11, ox + 13, oy + 12, E.d0); // a dead twig
      img.set(ox + 9, oy + 11, E.d3);
    }
  }
  // 4-7 grass: tufts over dark turf, a few pale flowers
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(4 + v);
    const r = rng(2100 + v);
    img.rect(ox, oy, T, T, E.g1);
    speck(ox, oy, r, 10, E.g0);
    speck(ox, oy, r, 6, mix(E.g1, E.g2, 0.5));
    for (let i = 0; i < 5; i++) tuft(ox + 1 + r() * 13, oy + 4 + r() * 11, r, 2 + Math.floor(r() * 2));
    if (v === 2) for (const [x, y] of [[4, 5], [11, 11]]) {
      img.set(ox + x, oy + y, P.wax2);
      img.set(ox + x, oy + y + 1, E.g0);
    }
    if (v === 3) {
      img.set(ox + 9, oy + 6, P.flame2);
      img.set(ox + 9, oy + 7, E.g0);
    }
  }
  // 8-9, 47 forest outside the ravine: dense dark brush, the same growth as the cliff tops
  const brush = (ox: number, oy: number, r: () => number, n: number, bg: RGBA) => {
    img.rect(ox, oy, T, T, bg);
    speck(ox, oy, r, 6, E.leaf0);
    for (let i = 0; i < n; i++) {
      const cx = ox + 4 + r() * 8;
      const cy = oy + 4 + r() * 7;
      const rad = 2 + r() * 1.2;
      img.disc(cx, cy + 0.7, rad, E.leaf0);
      img.disc(cx, cy, rad, mix(P.teal1, E.g1, 0.4));
      img.set(cx - 1, cy - 1, E.g1);
    }
  };
  for (const idx of [8, 9, 47]) {
    const [ox, oy] = at(idx);
    brush(ox, oy, rng(2200 + idx), idx === 9 ? 2 : 3, mix(P.dark1, P.ink, 0.5));
  }
  // 10-13 cart road: packed pale earth, worn smooth (no ruts: roads run every way through the hub)
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(10 + v);
    const r = rng(2400 + v);
    img.rect(ox, oy, T, T, E.d4);
    speck(ox, oy, r, 9, E.d3);
    speck(ox, oy, r, 6, mix(E.d4, E.d5, 0.6));
    for (let i = 0; i < 2; i++) {
      // worn, flattened patches
      const x = ox + 2 + r() * 9;
      const y = oy + 2 + r() * 11;
      img.hline(x, y, 3 + r() * 3, mix(E.d4, E.d5, 0.4));
    }
    if (v === 1) clod(ox + 6, oy + 6, 2, P.stone2, P.stone3, E.d3);
    if (v === 2) {
      img.set(ox + 4, oy + 11, P.stone3);
      img.set(ox + 11, oy + 4, P.stone2);
      img.set(ox + 12, oy + 4, E.d3);
    }
    if (v === 3) {
      // a hoof print and a shallow puddle stain
      img.hline(ox + 5, oy + 5, 2, E.d3);
      img.set(ox + 4, oy + 6, E.d3);
      img.set(ox + 7, oy + 6, E.d3);
      img.ellipse(ox + 10, oy + 11, 2.5, 1.2, mix(E.d4, E.d3, 0.6));
    }
  }
  // 14-15, 46 wooden planks (inside buildings): boards with grain, gaps and nails
  const planks = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(2600 + idx);
    img.rect(ox, oy, T, T, E.d4);
    for (let b = 0; b < 4; b++) {
      const y = oy + b * 4;
      const tone = [0, -0.2, 0.15, -0.1][(b + v) % 4];
      const c = tone < 0 ? mix(E.d4, E.d3, -tone * 2) : mix(E.d4, E.d5, tone);
      img.rect(ox, y, T, 4, c);
      img.hline(ox, y, T, mix(c, E.d5, 0.5)); // lit top edge
      img.hline(ox, y + 3, T, E.d1); // gap
      for (let i = 0; i < 2; i++) img.hline(ox + r() * 10, y + 1 + Math.floor(r() * 2), 3 + r() * 3, mix(c, E.d3, 0.6)); // grain
      const joint = (3 + b * 5 + v * 7) % 16;
      img.vline(ox + joint, y, 3, E.d1);
      img.set(ox + joint + 1, y + 1, P.stone3); // nail
    }
  };
  planks(14, 0);
  planks(15, 1);
  planks(46, 2);
  // 44-45 flagstones (the chapel floor), warmer than the Abbey's
  const warmStone: SlabPal = { base: mix(P.stone2, P.wood1, 0.18), mortar: mix(P.dark2, P.wood1, 0.3), hi: P.stone3, lo: P.stone1 };
  {
    const [ox, oy] = at(44);
    const r = rng(2700);
    flagstone(img, ox, oy, 0, 0, 16, 9, r, warmStone, 0.1);
    flagstone(img, ox, oy, 0, 9, 7, 7, r, warmStone, -0.2);
    flagstone(img, ox, oy, 7, 9, 9, 7, r, warmStone);
  }
  {
    const [ox, oy] = at(45);
    const r = rng(2701);
    flagstone(img, ox, oy, 0, 0, 10, 16, r, warmStone, -0.1);
    flagstone(img, ox, oy, 10, 0, 6, 8, r, warmStone, 0.2);
    flagstone(img, ox, oy, 10, 8, 6, 8, r, warmStone);
  }

  // 40-43 cliff face: a grass lip hanging over bands of earth, stones and roots in it
  const cliff = (idx: number, v: number) => {
    const [ox, oy] = at(idx);
    const r = rng(2300 + idx);
    const bands: [number, number, RGBA][] = [[2, 4, E.d3], [6, 3, E.d2], [9, 3, E.d3], [12, 2, E.d1]];
    for (const [y, h, c] of bands) {
      img.rect(ox, oy + y, T, h, c);
      img.hline(ox, oy + y, T, mix(c, E.d5, 0.35)); // each band's lit top
    }
    speck(ox, oy + 2, r, 10, E.d1);
    for (let i = 0; i < 4; i++) img.set(ox + r() * 16, oy + 3 + r() * 10, E.d4);
    img.rect(ox, oy + 14, T, 1, E.d0);
    img.rect(ox, oy + 15, T, 1, mix(E.d0, P.ink, 0.5));
    // grass lip, with blades hanging over the edge
    img.hline(ox, oy, T, E.g3);
    img.hline(ox, oy + 1, T, E.g1);
    for (let x = 0; x < T; x++) if (r() < 0.45) img.vline(ox + x, oy + 2, 1 + Math.floor(r() * 2), r() < 0.5 ? E.g1 : E.g0);
    if (v === 1) {
      line(img, ox + 4, oy + 2, ox + 6, oy + 10, E.d0); // roots
      line(img, ox + 6, oy + 10, ox + 5, oy + 13, E.d0);
      line(img, ox + 11, oy + 3, ox + 12, oy + 8, E.d1);
      img.set(ox + 5, oy + 5, E.d4);
    }
    if (v === 2) {
      img.ellipse(ox + 9, oy + 9, 3, 2, P.stone1); // a boulder bedded in the earth
      img.ellipse(ox + 8.5, oy + 8.5, 2.2, 1.3, P.stone2);
      img.set(ox + 7, oy + 8, P.stone3);
    }
    if (v === 3) {
      // an iron hook with a lantern hung on it
      img.hline(ox + 6, oy + 4, 4, E.d0);
      img.vline(ox + 9, oy + 4, 2, E.d0);
      img.rect(ox + 8, oy + 6, 3, 4, E.d0);
      img.set(ox + 9, oy + 7, P.flame2);
      img.set(ox + 9, oy + 8, P.flame1);
      img.hline(ox + 8, oy + 10, 3, E.d0);
    }
  };
  cliff(40, 0);
  cliff(41, 1);
  cliff(42, 2);
  cliff(43, 3);

  // 16-31 cliff tops: thick brush (clearly not walkable), a grass rim on the sides open to the path
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(2500 + mask);
    brush(ox, oy, r, 4, P.dark1);
    const N = mask & 1, Ea = mask & 2, S = mask & 4, W = mask & 8;
    if (N) {
      img.hline(ox, oy, T, E.g3);
      img.hline(ox, oy + 1, T, E.g2);
      for (let x = 0; x < T; x += 2) img.set(ox + x + (r() < 0.5 ? 1 : 0), oy + 2, E.g1);
    }
    if (S) {
      img.hline(ox, oy + 14, T, E.g2);
      img.hline(ox, oy + 15, T, E.g3);
      for (let x = 0; x < T; x += 2) img.set(ox + x + (r() < 0.5 ? 1 : 0), oy + 13, E.g1);
    }
    if (W) {
      img.vline(ox, oy, T, E.g3);
      img.vline(ox + 1, oy, T, E.g2);
    }
    if (Ea) {
      img.vline(ox + 15, oy, T, E.g1);
      img.vline(ox + 14, oy, T, E.g2);
    }
  }

  shadeTiles(img, 32, 0.9);
  // 48-63: grass creeping over the ground beside it
  fringeTiles(48, 4, 2800, (x, y, d, r) => {
    if (d > 0.75 ? r() < 0.55 : r() < 0.12) return; // ragged edge
    img.set(x, y, d < 0.3 ? E.g1 : r() < 0.5 ? E.g2 : E.g1);
    if (r() < 0.12) img.set(x, y, E.g3);
  });

  // 64-79: the pale road's packed edge spreading into the dirt beside it
  fringeTiles(64, 3, 2900, (x, y, d, r) => {
    if (d > 0.6 && r() < 0.5) return;
    img.set(x, y, d < 0.4 ? mix(E.d4, E.d3, 0.3) : mix(E.d3, E.d4, 0.4));
  });

  sheet('tiles_road', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 0, 0, 1, 1, 1, 2, 3],
      floor_grass: [4, 4, 5, 5, 6, 7],
      floor_road: [10, 10, 10, 10, 11, 12, 13],
      floor_plank: [14, 15, 46],
      floor_stone: [44, 45],
      wall_front: [40, 40, 40, 41, 41, 42, 40, 40, 41, 43],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [8, 9, 47],
      shade: Array.from({ length: 8 }, (_, i) => 32 + i),
      fringe_floor_grass: Array.from({ length: 16 }, (_, i) => 48 + i),
      fringe_floor_road: Array.from({ length: 16 }, (_, i) => 64 + i),
      glow: [43],
    },
  });
}


// =============================================================== THE NAVE: THE CHANDLER
// --- The Chandler (64x64): head of the Abbey. Tall and gaunt in heavy cream-and-red vestments with gold
// trim, a crown of lit tapers like a halo, a thin grey face with tired eyes. His weapon is a great
// candle-snuffer on an iron staff.
const CHANDLER_HAND: Record<Dir5, [number, number]> = { S: [42, 39], SE: [41, 38], E: [37, 38], NE: [40, 36], N: [40, 36] };

/** kneel 0..1; reach: both hands forward and up (pouring); lift: the free hand up to the crown (plucking a taper); smoke: censer cloud;
 * drip: wax running off him; arm: snuffer raised overhead; swing: snuffer hand back (-) or out (+); censer: the censer swung out (0..1);
 * flick: the candle flames' other frame. */
type PriestPose = BodyPose & { kneel?: number; reach?: number; lift?: number; smoke?: number; drip?: number; arm?: number; swing?: number; censer?: number; flick?: number };

function chandlerHand(dir: Dir5, p: PriestPose): [number, number] {
  const [hx, hy] = CHANDLER_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { sh } = leanOffsets(dir, p.lean ?? 0);
  const b = (p.bob ?? 0) + Math.round((p.kneel ?? 0) * 9);
  const up = p.arm ?? 0;
  const sw = p.swing ?? 0;
  if ((p.reach ?? 0) > 0) return [32 + sh + 5, Math.round(21 + b + 10 - (p.reach ?? 0) * 7)];
  return [Math.round(hx + sh + sw * 8 * fx - up * 4 * fx - (dir === 'S' ? up * 5 : 0)), Math.round(Math.max(6, hy + b + sw * 4 * fy - up * 20))];
}

function drawChandler(c: Img, dir: Dir5, pose: PriestPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, kneel: 0, reach: 0, lift: 0, smoke: 0, drip: 0, arm: 0, swing: 0, censer: 0, flick: 0, ...pose };
  const b = o.bob + Math.round(o.kneel * 9);
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const cx = 32 + sh;
  const top = 21 + b; // shoulders
  const hem = 57;
  const red = { c0: hex('#3a0d14'), c1: P.blood1, c2: P.blood2, c3: hex('#cf5058') };
  const cream = { c0: mix(P.wax1, P.stone3, 0.5), c1: P.wax1, c2: P.wax2, c3: mix(P.wax2, P.white, 0.5) };
  const gold0 = mix(P.flame1, P.wood1, 0.45);
  // Round shading, light from the upper left, with an ordered dither where two tones meet
  const shadeAt = (t: number, r: { c0: RGBA; c1: RGBA; c2: RGBA; c3: RGBA }, x = 0, y = 0) => {
    const d = t + ((x + y) % 2 ? 0.035 : -0.035);
    return d < 0.1 ? r.c3 : d < 0.2 ? mix(r.c2, r.c3, 0.5) : d > 0.92 ? r.c0 : d > 0.76 ? r.c1 : d > 0.64 ? mix(r.c1, r.c2, 0.5) : r.c2;
  };
  // Red under-robe: a long bell to the floor, pooled wide when he kneels; the hem swings as he walks.
  for (let y = top; y <= hem; y++) {
    const k = (y - top) / Math.max(1, hem - top);
    const half = Math.round(5 + k * (7 + o.kneel * 5));
    const swing = y > hem - 6 && o.step >= 0 ? (o.step % 2 ? 1 : -1) : 0;
    const x0 = cx - half + swing;
    for (let x = x0; x <= x0 + half * 2; x++) c.set(x, y, y >= hem - 1 ? (y === hem ? gold0 : P.flame1) : shadeAt((x - x0) / (half * 2), red, x, y));
  }
  for (const x of [-5, 4]) line(c, cx + x, top + 26, cx + x * 1.6, hem - 2, red.c1); // folds of the under-robe
  // Cream chasuble over it, to the knees, edged in gold
  const chasBot = Math.min(hem - 5, top + 25);
  for (let y = top; y <= chasBot; y++) {
    const k = (y - top) / Math.max(1, chasBot - top);
    const half = Math.round(6 + k * 4);
    for (let x = cx - half; x <= cx + half; x++) {
      const t = (x - cx + half) / (half * 2);
      let col = shadeAt(t, cream, x, y);
      // a damask of little gold flames woven into the cream
      if ((x - cx + 99) % 4 === 2 && (y - top) % 4 === 2 && t > 0.08 && t < 0.9) col = mix(col, P.flame1, t > 0.6 ? 0.35 : 0.5);
      c.set(x, y, col);
    }
    c.set(cx - half, y, P.flame1);
    c.set(cx + half, y, gold0);
  }
  c.hline(cx - 10, chasBot, 21, P.flame1);
  c.hline(cx - 10, chasBot + 1, 21, gold0);
  for (const x of [-7, 6]) line(c, cx + x, top + 12, cx + x * 1.3, chasBot - 1, cream.c1); // folds
  // The orphrey: an embroidered gold band down the front, a gold cross on the back
  if (!back) {
    c.vline(cx - 1, top, chasBot - top, P.flame1);
    c.vline(cx, top, chasBot - top, P.flame2);
    c.vline(cx + 1, top, chasBot - top, gold0);
    for (let y = top + 3; y < chasBot; y += 4) {
      c.set(cx, y, P.blood2); // stitched flames
      c.set(cx, y + 1, P.blood1);
    }
  } else {
    c.vline(cx, top + 2, 18, P.flame1);
    c.vline(cx + 1, top + 2, 18, gold0);
    c.hline(cx - 4, top + 7, 9, P.flame1);
    c.hline(cx - 4, top + 8, 9, gold0);
  }
  // Wax stains running down under the gold: the Drip had him all along
  for (const [x, y, l] of [[-5, 10, 5], [4, 14, 4], [-3, 20, 3]]) {
    c.vline(cx + x, top + y, l + o.drip, P.wax1);
    c.set(cx + x, top + y + l + o.drip, cream.c0);
  }
  // Stiff red stole at the collar, gold at its ends
  c.hline(cx - 5, top, 11, red.c2);
  c.hline(cx - 4, top - 1, 9, red.c3);
  if (!back) {
    c.vline(cx - 4, top + 1, 5, red.c2);
    c.vline(cx + 4, top + 1, 5, red.c1);
    c.set(cx - 4, top + 6, P.flame1);
    c.set(cx + 4, top + 6, P.flame1);
  }

  // Arms: red alb sleeves under the chasuble, gold cuffs, grey hands. The right hand holds the staff.
  const rHand = chandlerHand(dir, o);
  const lHand: [number, number] =
    o.reach > 0
      ? [cx - 5, Math.round(top + 10 - o.reach * 7)]
      : o.lift > 0
        ? [Math.round(cx - 6 + (o.lift > 1.5 ? fx * 8 : 0)), Math.round(top - 3 - Math.min(o.lift, 1.2) * 5 + (o.lift > 1.5 ? 8 : 0))]
        : o.censer > 0
          ? [Math.round(cx - 10 - o.censer * 4 + fx * o.censer * 6), Math.round(top + 12 - o.censer * 4)]
          : [cx - 10 + o.sway, top + 17];
  for (const [side, hand] of [[1, rHand], [-1, lHand]] as const) {
    for (let t = -1; t <= 1; t++) line(c, cx + side * 7 + t, top + 1, hand[0] + t, hand[1] - 2, t === -1 ? red.c3 : t === 1 ? red.c1 : red.c2);
    c.hline(hand[0] - 1, hand[1] - 2, 3, P.flame1);
    c.rect(hand[0] - 1, hand[1] - 1, 3, 3, P.stone4);
    c.set(hand[0] + 1, hand[1] + 1, P.stone3);
  }
  if (o.drip > 0) for (const h of [rHand, lHand]) c.vline(h[0], h[1] + 2, o.drip * 3, P.wax1); // pouring himself out
  // The censer on its chain from his free hand (not while that hand is busy)
  if (o.reach === 0 && o.lift === 0) {
    const [chx, chy] = lHand;
    const bx = Math.round(chx - 1 + o.censer * 5 * (fx || -1));
    const by = chy + 7 - Math.round(o.censer * 3);
    line(c, chx, chy + 1, bx, by - 2, gold0);
    c.disc(bx, by, 2.2, P.flame1);
    c.set(bx - 1, by - 1, P.flame2);
    c.hline(bx - 2, by, 5, gold0);
    c.set(bx, by + 2, P.ember); // coals glowing through its holes
    c.set(bx, by - 3, withAlpha(P.stone4, 160)); // a thread of smoke
    c.set(bx + 1, by - 4, withAlpha(P.stone4, 110));
  }

  // Head: long, thin and grey, grey hair at the temples
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 12 + b + o.hunch + ly;
  const skin = { c0: P.stone3, c1: mix(P.stone3, P.stone4, 0.5), c2: P.stone4, c3: mix(P.stone4, P.wax2, 0.4) };
  c.ellipse(hx, hy + 1, 4, 5.5, back ? P.stone2 : skin.c1);
  if (!back) {
    c.ellipse(hx - 0.8, hy, 3, 4.5, skin.c2);
    c.set(hx - 2, hy - 3, skin.c3);
    const f0 = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 2;
    c.hline(f0 - 3, hy, 2, P.dark2); // deep-set eyes under a heavy brow
    c.hline(f0 + 1, hy, 2, P.dark2);
    c.hline(f0 - 3, hy - 1, 6, skin.c0);
    c.set(f0 - 2, hy + 1, o.flinch ? P.ember : P.ink);
    c.set(f0 + 2, hy + 1, o.flinch ? P.ember : P.ink);
    c.vline(f0 - 3, hy + 2, 3, skin.c0); // hollow cheeks
    c.vline(f0 + 3, hy + 2, 3, skin.c0);
    c.set(f0, hy + 2, skin.c0); // nose
    c.hline(f0 - 1, hy + 4, 3, P.dark2); // a thin mouth
    c.set(hx - 4, hy - 1, P.stone3); // grey hair at the temples
    c.set(hx + 4, hy - 1, P.stone3);
  } else {
    c.ellipse(hx, hy + 1, 3.5, 4.5, P.stone3);
    c.hline(hx - 2, hy - 2, 4, P.stone2);
  }
  // Warm light from the crown on his scalp and shoulders
  if (!back) {
    c.set(hx - 1, hy - 4, mix(skin.c3, P.flame2, 0.35));
    c.set(hx + 1, hy - 4, mix(skin.c2, P.flame1, 0.3));
  }
  for (const dx of [-6, -5, 5, 6]) c.set(cx + dx, top - 1 + (Math.abs(dx) === 6 ? 1 : 0), mix(red.c3, P.flame2, 0.3));
  // Crown of lit tapers on a gold band, like a halo
  const cy = hy - 4;
  c.hline(hx - 4, cy, 9, P.flame1);
  c.hline(hx - 4, cy + 1, 9, gold0);
  if (!back) c.set(hx, cy, P.blood2);
  (back ? [-3, -1, 1, 3] : [-4, -2, 0, 2, 4]).forEach((dx, i) => {
    if (o.lift > 1.2 && dx === -2) return; // plucked, to throw
    const h = 3 + (i % 2) + (dx === 0 ? 1 : 0);
    c.vline(hx + dx, cy - h, h, P.wax2);
    c.set(hx + dx, cy - 1, P.wax1);
    c.set(hx + dx, cy - h - 1, P.ink);
    c.set(hx + dx, cy - h - 2, (i + o.flick) % 2 ? P.flame1 : P.flame2);
    if (!o.flinch && (i + o.flick) % 2 === 0) c.set(hx + dx, cy - h - 3, mix(P.flame1, P.ember, 0.4));
  });
  if (o.lift > 1.5) {
    // the plucked taper, alight in his hand
    c.vline(lHand[0], lHand[1] - 4, 3, P.wax2);
    c.set(lHand[0], lHand[1] - 5, P.flame2);
  }
  // Censer smoke curling around him
  if (o.smoke > 0) {
    const r = rng(900 + Math.round(o.smoke * 10));
    for (let i = 0; i < 90 * o.smoke; i++) {
      const a = r() * Math.PI * 2;
      const d = 8 + r() * 16;
      const x = 32 + Math.cos(a) * d;
      const y = 46 + Math.sin(a) * d * 0.6 - r() * 16;
      c.set(x, y, r() < 0.5 ? P.stone3 : P.stone4);
      if (r() < 0.3) c.set(x + 1, y, P.stone3);
    }
  }
}

function chandlerDeath(c: Img, f: number) {
  // (He never falls here: his turn takes him to the altar. Kept for completeness: he sinks to his knees.)
  drawChandler(c, 'S', { kneel: Math.min(1, f / 2), hunch: f, flinch: f < 2 });
}

// --- The Chandler, Last Candle (64x64): he poured himself onto the altar and got up as a candle. A column of
// melting wax, half flame, rags of burnt vestment at the hips, a melted face with one ember eye, and one
// wick rising from his head that burns with a black flame.
const CANDLE_HAND: Record<Dir5, [number, number]> = { S: [43, 44], SE: [42, 43], E: [38, 43], NE: [41, 41], N: [41, 41] };

/** arm: snuffer raised overhead; swing: snuffer hand back (-) or out (+); flick: the fires' other frame. */
type CandlePose = BodyPose & { rise?: number; spread?: number; flare?: number; melt?: number; out?: boolean; arm?: number; swing?: number; flick?: number };

function candleHand(dir: Dir5, p: CandlePose): [number, number] {
  const [hx, hy] = CANDLE_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { sh } = leanOffsets(dir, p.lean ?? 0);
  const up = p.arm ?? 0;
  const sw = p.swing ?? 0;
  const b = (p.bob ?? 0) + (p.rise ?? 0);
  return [Math.round(hx + sh + sw * 8 * fx - up * 4 * fx - (dir === 'S' ? up * 5 : 0)), Math.round(Math.min(53, Math.max(8, hy + b + sw * 4 * fy - up * 20)))];
}

/** A teardrop of darkness with a pale rim: a flame that burns and gives no light. `base` = y of its root. */
function blackFlame(c: Img, x: number, base: number, size: number, sway: number) {
  const h = Math.max(4, Math.min(base - 1, Math.round(5 + size * 3))); // never taller than the cell allows
  for (let i = 0; i < h; i++) {
    const k = i / Math.max(1, h - 1); // 0 at the tip, 1 at the root
    const half = Math.round(Math.sin(k * Math.PI * 0.85) * (1.2 + size * 1.3));
    const xo = Math.round(sway * (1 - k));
    const y = base - h + i;
    c.hline(x - half + xo, y, half * 2 + 1, i % 3 === 1 ? P.dark1 : P.ink);
    c.set(x - half + xo - 1, y, P.stone3);
    c.set(x + half + xo + 1, y, P.stone3);
  }
  c.set(x + Math.round(sway), base - h - 1, P.stone4);
}

function drawCandleMan(c: Img, dir: Dir5, pose: CandlePose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, spread: 0, flare: 1, melt: 0, out: false, arm: 0, swing: 0, flick: 0, ...pose };
  const b = o.bob + o.rise;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const cx = 32 + sh;
  const W = WAXR;
  // five tones of wax across the body, a warm core where the fire inside shows through
  const tone = [mix(W.w0, P.ink, 0.25), W.w0, W.w1, W.w2, W.w3];
  const core = mix(P.wax2, P.flame1, 0.5);
  const hot = mix(P.flame1, P.flame2, 0.4);
  // His own wax, pooling where he stands: a glossy puddle with a bright rim
  const pr = 12 + o.melt * 4;
  c.ellipse(32, 57.5, pr + 1, 3.8 + o.melt * 0.5, tone[0]);
  c.ellipse(32, 57, pr, 3.2 + o.melt * 0.5, W.w1);
  c.ellipse(31, 56.8, pr - 3, 2.2, W.w2);
  c.hline(26 - o.melt, 56, 6, W.w3);
  c.set(38 + o.melt * 2, 58, W.w3);
  // The body: broad wax shoulders, a slumped middle, and a skirt that has run out into the pool. The outline
  // wobbles where the wax has sagged.
  const top = 28 + b;
  const bottom = 56;
  const wob = rng(419);
  const wobble: number[] = [];
  for (let y = 0; y <= 40; y++) wobble.push(wob() < 0.3 ? 1 : 0);
  for (let y = top; y <= bottom; y++) {
    const r = y - top;
    const k = r / Math.max(1, bottom - top);
    let half = r < 5 ? 8 + Math.min(2, r) : 10 - Math.min(2, (r - 5) * 0.35) + Math.max(0, (k - 0.55) * 11);
    half = Math.round(half + wobble[r % 40]);
    for (let x = cx - half; x <= cx + half; x++) {
      const t = (x - (cx - half)) / Math.max(1, half * 2); // 0 lit left edge .. 1 dark right edge
      const dither = (x + y) % 2 ? 0.04 : -0.04;
      let i = t + dither < 0.1 ? 4 : t + dither < 0.3 ? 3 : t + dither < 0.62 ? 2 : t + dither < 0.85 ? 1 : 0;
      if (k > 0.8 && i > 1) i--; // the skirt is in his own shadow
      let col = tone[i];
      if (!back && Math.abs(t - 0.42) < 0.13 && k > 0.08 && k < 0.75) col = (x + y) % 3 ? core : mix(core, W.w2, 0.5); // the core
      c.set(x, y, col);
    }
  }
  // Runs of wax: down the front, and off the edges of the silhouette in fat drops
  const run = rng(88);
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const y0 = top + 3 + Math.floor(run() * 22);
    if (y0 > bottom - 3) continue;
    const r0 = y0 - top;
    const half = r0 < 5 ? 8 + Math.min(2, r0) : 10 - Math.min(2, (r0 - 5) * 0.35);
    const x = Math.round(cx + side * (half + (i < 4 ? 1 : -2 - Math.floor(run() * 4))));
    const l = 2 + Math.floor(run() * 5);
    c.vline(x, y0, l, side < 0 ? W.w3 : W.w1);
    c.set(x, y0 + l, side < 0 ? W.w2 : tone[0]);
    if (i < 4) c.set(x, y0 + l + 1, side < 0 ? W.w2 : tone[0]); // a drop about to fall
  }
  // Rags of burnt vestment at the hips: red scorched black at the edges, a gilt hem half melted in, the stole
  const rag = rng(77);
  const hip = top + 13;
  if (hip < bottom - 2) {
    for (let x = -9; x <= 9; x++) {
      const l = Math.min(3 + Math.floor(rag() * 6), bottom - hip - 1);
      const red = x % 4 === 0 ? mix(P.blood1, P.dark1, 0.3) : x % 4 === 2 ? P.blood2 : P.blood1;
      c.vline(cx + x, hip, l, x > 5 ? mix(red, P.ink, 0.35) : red);
      c.set(cx + x, hip + l - 1, x % 2 ? P.ink : P.dark1); // burnt edge
      if (l > 4 && x % 3 === 0) c.set(cx + x, hip + l - 2, P.ember); // still smouldering
    }
    c.hline(cx - 9, hip, 19, GOLD0); // the gilt hem
    for (let x = -9; x <= 9; x += 3) c.set(cx + x, hip, mix(GOLD0, P.wax2, 0.4));
    if (!back)
      for (let y = top + 2; y < hip; y++) {
        c.set(cx - 3 + Math.round((y - top) * 0.15), y, P.blood1); // the stole, sunk into the wax
        c.set(cx + 3 - Math.round((y - top) * 0.15), y, P.blood2);
      }
  }
  // Fire licking up one flank, a warm rim on that side, and cracks glowing through the wax
  const fl = rng(31 + (o.sway + 3) * 7 + o.bob * 3 + o.flick * 11);
  for (let y = top + 2; y < bottom - 2; y++) {
    const r0 = y - top;
    const half = Math.round(r0 < 5 ? 8 + Math.min(2, r0) : 10 - Math.min(2, (r0 - 5) * 0.35) + Math.max(0, (r0 / (bottom - top) - 0.55) * 11));
    if ((y + o.flick) % 3) c.set(cx + half, y, mix(W.w1, P.flame1, 0.45));
  }
  for (let i = 0; i < 8; i++) {
    const y = top + 6 + Math.floor(fl() * 24);
    if (y > 54) continue;
    const x = cx + 8 + Math.floor(fl() * 3);
    const h = 2 + Math.floor(fl() * 4);
    c.vline(x, y - h, h, P.flame1);
    c.set(x, y - h, P.flame2);
    c.set(x - 1, y - 1, P.ember);
  }
  if (!back)
    for (const [x0, y0, x1, y1] of [[-3, 5, 1, 9], [1, 9, -1, 13], [-1, 13, 1, 16], [3, 17, 5, 22], [-6, 20, -4, 25], [5, 22, 4, 26]]) {
      if (top + y1 >= 55) continue;
      line(c, cx + x0, top + y0, cx + x1, top + y1, P.ember);
      line(c, cx + x0 + 1, top + y0, cx + x1 + 1, top + y1, (x0 + o.flick) % 2 ? hot : P.flame2); // the crack's hot lip
    }
  // Arms of wax (spread = raised wide), thick at the shoulder and thinning to the hand. The right hand holds the
  // snuffer unless spread.
  const armY = top + 2;
  for (const side of [-1, 1]) {
    const held = side === 1 && !o.spread;
    const [chx, chy] = candleHand(dir, o);
    const hx2 = held ? chx : Math.round(cx + side * (11 + o.spread * 5));
    const hy2 = Math.min(53, held ? chy : Math.round(armY + 15 - o.spread * 12)); // sunk in: arms stay above the pool
    if (armY > 52) continue;
    const sx = cx + side * 8;
    // five strands across the arm: the edge toward the body is a dark crease, so the arm stands off the torso
    for (let t = -2; t <= 2; t++) {
      const out = t * side; // + away from the body
      const col = out <= -2 ? tone[0] : out === -1 ? W.w1 : out === 0 ? W.w2 : out === 1 ? (side < 0 ? W.w3 : W.w1) : side < 0 ? W.w3 : tone[1];
      line(c, sx + t, armY, hx2 + Math.round(t * 0.6), hy2, col);
    }
    c.disc(hx2, hy2, 2.2, W.w2); // the hand, fingers run together
    c.set(hx2 - 1, hy2 - 1, W.w3);
    c.set(hx2 + 1, hy2 + 1, W.w1);
    c.vline(hx2 + side, hy2 + 2, 2 + (o.spread ? 3 : 1), W.w2); // dripping off his fingers
    c.set(hx2 + side, hy2 + 4 + (o.spread ? 3 : 1), W.w1);
    c.disc(sx, armY, 2.5, side < 0 ? W.w3 : W.w1); // the shoulder
  }
  // Head: a skull of wax sagging to one side, one ember eye in a hollow socket, a melted gash of a mouth, and the
  // stubs of his taper crown melted into the brow
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 18 + b + o.hunch + ly;
  c.ellipse(hx, hy + 2, 5.5, 6.5, tone[1]);
  c.ellipse(hx - 1, hy + 1, 4.5, 5.5, W.w2);
  c.ellipse(hx - 2, hy, 2.5, 3, W.w3);
  c.ellipse(hx + 3, hy + 8, 3.5, 2.2, W.w1); // the jaw, slid down to one side
  c.hline(hx + 1, hy + 10, 4, tone[0]);
  c.vline(hx + 5, hy + 9, 3, W.w1); // a string of wax off the chin
  for (const [dx, h] of [[-4, 3], [-2, 4], [2, 3], [4, 2]]) {
    c.vline(hx + dx, hy - 4 - h + 1, h, dx < 0 ? W.w3 : W.w1); // the crown's tapers, melted to stubs
    c.set(hx + dx, hy - 4 - h, P.dark2);
  }
  if (!back) {
    const f0 = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 2;
    c.rect(f0 - 4, hy, 3, 3, P.ink); // the socket
    c.set(f0 - 3, hy + 1, o.flinch ? P.wax2 : P.flame2);
    c.set(f0 - 2, hy + 2, o.flinch ? P.wax2 : P.ember);
    c.set(f0 - 4, hy + 3, W.w1); // a tear of wax under it
    c.set(f0 - 4, hy + 4, W.w1);
    c.hline(f0 + 1, hy + 2, 3, W.w3); // the other eye, melted shut
    c.hline(f0 + 1, hy + 3, 3, tone[0]);
    c.hline(f0 - 2, hy + 6, 4, o.flinch ? P.ember : P.ink); // the mouth
    c.set(f0 + 2, hy + 7, P.dark1);
  }
  // The wick, and its black flame
  c.vline(hx, hy - 6, 3, P.ink);
  c.set(hx, hy - 4, P.ember);
  if (!o.out) blackFlame(c, hx, hy - 6, o.flare + o.flick * 0.3, o.sway);
  // Rising out of the altar fire: flames around what hasn't come up yet
  if (o.rise > 0 && o.melt === 0) {
    const r = rng(600 + o.rise);
    for (let i = 0; i < 18; i++) {
      const x = 19 + Math.floor(r() * 27);
      const h = 3 + Math.floor(r() * 9);
      c.vline(x, 57 - h, h, i % 3 ? P.flame1 : P.ember);
      c.set(x, 57 - h, P.flame2);
    }
  }
}

function candleDeath(c: Img, f: number) {
  // He melts down into his own pool; the black flame shrinks and goes out.
  const poses: CandlePose[] = [
    { flinch: true, hunch: 2, flare: 1.5 },
    { rise: 7, melt: 1, flare: 0.6, flinch: true },
    { rise: 15, melt: 2, flare: 0 },
    { rise: 24, melt: 3, out: true },
    { rise: 32, melt: 4, out: true },
  ];
  drawCandleMan(c, 'S', poses[f]);
}

function drawSnuffer(img: Img, lit: boolean) {
  // Iron staff, brass pommel and collar, and the snuffer's bell at the end (mouth toward the tip)
  const gold0 = mix(P.flame1, P.wood1, 0.45);
  img.hline(2, 8, 44, EN.steel0);
  img.hline(2, 7, 44, EN.steel2);
  for (const x of [14, 28]) img.vline(x, 6, 4, gold0); // brass rings along the staff
  img.rect(0, 6, 3, 4, P.flame1);
  img.set(0, 6, P.flame2);
  img.rect(44, 5, 3, 6, P.flame1); // collar
  img.vline(44, 5, 6, P.flame2);
  img.vline(46, 5, 6, gold0);
  for (let x = 47; x <= 58; x++) {
    const half = Math.round(1 + (x - 47) * 0.45);
    img.vline(x, 8 - half, half * 2 + 1, EN.steel2);
    img.set(x, 8 - half, EN.steel3); // lit rim of the bell
    img.set(x, 8 - half + 1, mix(EN.steel2, EN.steel3, 0.5));
    img.set(x, 8 + half, EN.steel0);
  }
  img.vline(52, 6, 5, EN.steel1); // a seam in the bell
  img.vline(59, 3, 11, P.dark1); // the dark mouth of the bell
  if (lit) {
    // black flames lick out of the bell and along the staff; embers in the iron
    for (const [x, s] of [[50, 0.2], [54, 0.5], [58, 0.8]] as const) blackFlame(img, x, 6 - Math.round((x - 47) * 0.45), s, 1);
    for (const x of [12, 22, 31, 39]) img.set(x, 7, P.ember);
  }
  img.outline(P.ink);
}

function genNave() {
  const P7 = phased7();

  const priest = (name: string, poses: PriestPose[], timing: { ticks: number; phase?: string }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => drawChandler(c, d, p)),
    timing,
    loop,
    hand: (d: Dir5, f: number) => chandlerHand(d, poses[f]),
  });
  rosterSheet(
    'chandler',
    64,
    [32, 58],
    7,
    [
      priest('idle', [{}, { flick: 1 }, { bob: 1, censer: 0.2 }, { bob: 1, flick: 1, censer: 0.2 }], [{ ticks: 14 }, { ticks: 14 }, { ticks: 14 }, { ticks: 14 }], true),
      priest('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? 1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0, flick: f % 2, censer: f === 1 ? 0.3 : f === 3 ? -0.1 : 0.1 })), walkT(11), true),
      // Snuffer sweep (and vespers): hauled back past his hip, then swept wide
      priest(
        'sweep',
        [{ swing: -0.6, lean: -1 }, { swing: -1, lean: -2, sway: -1, arm: 0.2 }, { swing: -1.1, lean: -2, sway: -1, bob: 1, arm: 0.2 }, { swing: 1.1, lean: 3 }, { swing: 1.2, lean: 2, flick: 1 }, { swing: 0.5, lean: 1 }, {}],
        P7,
        false,
      ),
      // Extinguish: the bell raised high over his crown, up on his toes, then brought down over you
      priest(
        'slam',
        [{ arm: 0.5, hunch: -1, bob: -1 }, { arm: 1, hunch: -2, bob: -2 }, { arm: 1.1, hunch: -2, bob: -2, flick: 1 }, { swing: 1.2, hunch: 2, bob: 2, lean: 3 }, { swing: 1.2, hunch: 2, bob: 3, lean: 3 }, { swing: 0.5, bob: 1, lean: 1 }, {}],
        P7,
        false,
      ),
      // Stepping out of the smoke: a short, fast thrust
      priest('jab', [{ swing: -0.4, lean: -1 }, { swing: -0.8, lean: -2 }, { swing: -0.8, lean: -2, hunch: 1 }, { swing: 1.4, lean: 4 }, { swing: 1.3, lean: 3 }, { swing: 0.5, lean: 1 }, {}], P7, false),
      // Taper volley: plucks candles from his crown and flicks them
      priest('flick', [{ lift: 0.5 }, { lift: 1 }, { lift: 1.2, flick: 1 }, { lift: 1.8, lean: 2 }, { lift: 1.8, lean: 2 }, { lean: 1 }, {}], P7, false),
      // Censer smoke: he swings the censer out and the cloud swallows him
      priest(
        'censer',
        [{ censer: 0.6, smoke: 0.3, sway: 1 }, { censer: 1, smoke: 0.6 }, { censer: 1, smoke: 1, bob: 1 }, { censer: 0.4, smoke: 1.4, bob: 2 }, { smoke: 1.6, bob: 2 }, { smoke: 1 }, { smoke: 0.4 }],
        P7,
        false,
      ),
      // The entrance: kneeling at the altar, he finishes his prayer and rises
      priest(
        'intro',
        [{ kneel: 1 }, { kneel: 1, hunch: 1, flick: 1 }, { kneel: 0.6 }, { kneel: 0.2, flick: 1 }, {}, { hunch: -1, arm: 0.3 }],
        [{ ticks: 30 }, { ticks: 30 }, { ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 40 }],
        false,
      ),
      // His turn: hands over the altar fire, pouring out the wax he is made of
      priest('pour', [{ reach: 1.5, drip: 1 }, { reach: 1.6, drip: 2, bob: 1, flick: 1 }, { reach: 1.5, drip: 3 }, { reach: 1.4, drip: 2, bob: 1, flick: 1 }], [{ ticks: 12 }, { ticks: 12 }, { ticks: 12 }, { ticks: 12 }], true),
      priest('stagger', [{ lean: -2, flinch: true, arm: 0.2 }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => chandlerDeath(c, f)),
    CHANDLER_HAND,
  );

  const candle = (name: string, poses: CandlePose[], timing: { ticks: number; phase?: string }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => drawCandleMan(c, d, p)),
    timing,
    loop,
    hand: (d: Dir5, f: number) => candleHand(d, poses[f]),
  });
  rosterSheet(
    'chandler_wick',
    64,
    [32, 58],
    7,
    [
      candle('idle', [{ flare: 1 }, { flare: 1.3, flick: 1 }, { flare: 1.4, bob: 1, sway: 1 }, { flare: 1.1, bob: 1, sway: 1, flick: 1 }], [{ ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 6 }], true),
      candle('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1, sway: f === 1 ? 1 : f === 3 ? -1 : 0, flare: 1 + (f % 2) * 0.4, flick: f % 2 })), walkT(7), true),
      candle(
        'sweep',
        [{ swing: -0.6, sway: -2, lean: -2 }, { swing: -1, sway: -3, lean: -3 }, { swing: -1.1, sway: -3, lean: -3, bob: 1, flick: 1 }, { swing: 1.2, sway: 3, lean: 4, flare: 1.6 }, { swing: 1.2, sway: 2, lean: 3 }, { swing: 0.5, sway: 1, lean: 1 }, {}],
        P7,
        false,
      ),
      candle('jab', [{ swing: -0.4, lean: -1 }, { swing: -0.9, lean: -3, hunch: 1 }, { swing: -0.9, lean: -3, hunch: 1, flick: 1 }, { swing: 1.5, lean: 5, sway: -2 }, { swing: 1.4, lean: 4 }, { swing: 0.6, lean: 2 }, {}], P7, false),
      candle(
        'slam',
        [{ arm: 0.5, hunch: -1, bob: -2 }, { arm: 1, hunch: -2, bob: -3, flare: 2 }, { arm: 1.1, hunch: -2, bob: -3, flare: 2, flick: 1 }, { swing: 1.2, hunch: 2, bob: 2, lean: 3 }, { swing: 1.2, hunch: 2, bob: 3, lean: 3 }, { swing: 0.5, bob: 1 }, {}],
        P7,
        false,
      ),
      candle(
        'leap',
        [{ bob: 3, hunch: 2, swing: -0.5 }, { bob: 4, hunch: 3, swing: -0.5 }, { bob: -7, hunch: -2, flare: 2.5, arm: 1 }, { bob: 4, hunch: 3, lean: 3, swing: 1.2 }, { bob: 3, hunch: 2, lean: 2, swing: 1.2 }, { bob: 1, swing: 0.4 }, {}],
        P7,
        false,
      ),
      // Flame volley: the black flame on his head swells and flings burning wax
      candle(
        'volley',
        [{ flare: 1.5 }, { flare: 2, hunch: -1 }, { flare: 2.6, hunch: -2, bob: -1, flick: 1 }, { flare: 1, lean: 3, sway: 2 }, { flare: 1.2, lean: 2 }, { lean: 1 }, {}],
        P7,
        false,
      ),
      // Wax flood: arms thrown wide, his wax running out across the floor
      candle(
        'flood',
        [{ spread: 0.5 }, { spread: 1 }, { spread: 1.5, bob: -1, flick: 1 }, { spread: 2, bob: -2, melt: 1, flare: 2 }, { spread: 2, melt: 1, flare: 2, flick: 1 }, { spread: 1, melt: 1 }, {}],
        P7,
        false,
      ),
      // Rising out of the altar fire, arms opening
      candle(
        'intro',
        [{ rise: 26, flare: 2.5 }, { rise: 18, flare: 2.5, flick: 1 }, { rise: 10, flare: 2 }, { rise: 4, flare: 2, flick: 1 }, { spread: 1.5, flare: 3 }, { spread: 1, flare: 2 }],
        [{ ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 26 }, { ticks: 20 }],
        false,
      ),
      candle('stagger', [{ lean: -2, flinch: true, arm: 0.2 }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => candleDeath(c, f)),
    CANDLE_HAND,
  );

  // ---- weapons and projectiles
  for (const lit of [false, true]) {
    const s = new Img(64, 16);
    drawSnuffer(s, lit);
    sheet(lit ? 'chandler_snuffer_lit' : 'chandler_snuffer', s, { cell: [64, 16], pivot: [8, 8], layer: 'weapon', points: { tip: [58, 8] } });
  }
  const taper = new Img(12, 6);
  taper.rect(1, 2, 7, 2, P.wax2); // a lit taper, flying flame-first
  taper.hline(1, 3, 7, P.wax1);
  taper.set(8, 2, P.ink);
  taper.rect(9, 2, 2, 2, P.flame2);
  taper.set(11, 2, P.flame1);
  taper.outline(P.ink);
  sheet('taper_shot', taper, { cell: [12, 6], pivot: [6, 3], layer: 'fx' });
  const bf = new Img(8, 10);
  blackFlame(bf, 4, 9, 0.4, 0);
  bf.outline(P.ink);
  sheet('black_flame', bf, { cell: [8, 10], pivot: [4, 6], layer: 'fx' });

}

// =============================================================== SCENERY (decor sheets)
// Every decor sheet is drawn here with one toolkit: shaded blocks and blobs lit from the top left, planks,
// flames, candles, moss and ivy, and a soft contact shadow under each object so it sits on the ground.
type Ramp = { c0: RGBA; c1: RGBA; c2: RGBA; c3: RGBA };
const WOOD: Ramp = { c0: hex('#2e1d17'), c1: P.wood1, c2: P.wood2, c3: hex('#a47a52') };
const DWOOD: Ramp = { c0: hex('#1f1512'), c1: mix(P.wood1, P.dark2, 0.4), c2: P.wood1, c3: P.wood2 };
const STN: Ramp = { c0: P.stone1, c1: P.stone2, c2: P.stone3, c3: P.stone4 };
const IRON: Ramp = { c0: hex('#3c4350'), c1: hex('#5d6776'), c2: P.steel1, c3: P.steel2 };
const BRONZE: Ramp = { c0: mix(P.ember, P.wood1, 0.5), c1: P.ember, c2: P.flame1, c3: P.flame2 };
const CLOTH_RED: Ramp = { c0: hex('#3a0d14'), c1: P.blood1, c2: P.blood2, c3: hex('#cf5058') };
const CANVAS: Ramp = { c0: mix(P.wax1, P.wood1, 0.55), c1: mix(P.wax1, P.wood2, 0.3), c2: P.wax1, c3: P.wax2 };
const BONE_R: Ramp = { c0: mix(P.stone3, P.wood1, 0.3), c1: mix(P.wax1, P.stone3, 0.4), c2: P.wax1, c3: P.wax2 };
const GOLD0 = mix(P.flame1, P.wood1, 0.45);

/** A block lit from the top left: fill, lit top and left edges, dark right and bottom edges. */
function box(c: Img, x: number, y: number, w: number, h: number, r: Ramp) {
  c.rect(x, y, w, h, r.c1);
  c.hline(x, y, w, r.c3);
  c.vline(x, y + 1, h - 1, r.c2);
  c.vline(x + w - 1, y + 1, h - 1, r.c0);
  c.hline(x + 1, y + h - 1, w - 1, r.c0);
}
/** A rounded mass lit from the top left. */
function blob(c: Img, cx: number, cy: number, rx: number, ry: number, r: Ramp) {
  c.ellipse(cx, cy, rx, ry, r.c0);
  c.ellipse(cx - rx * 0.12, cy - ry * 0.12, rx * 0.88, ry * 0.86, r.c1);
  c.ellipse(cx - rx * 0.3, cy - ry * 0.32, rx * 0.55, ry * 0.5, r.c2);
  c.ellipse(cx - rx * 0.45, cy - ry * 0.5, Math.max(0.8, rx * 0.18), Math.max(0.8, ry * 0.16), r.c3);
}
/** Boards: horizontal (default) or vertical, with gaps, grain and the odd nail. */
function boards(c: Img, x: number, y: number, w: number, h: number, r: Ramp, vertical = false, size = 4, seed = 1) {
  const rr = rng(seed);
  c.rect(x, y, w, h, r.c1);
  const n = Math.ceil((vertical ? w : h) / size);
  for (let i = 0; i < n; i++) {
    const t = [0, 0.25, -0.2, 0.1][(i + seed) % 4];
    const col = t >= 0 ? mix(r.c1, r.c2, t + 0.3) : mix(r.c1, r.c0, -t);
    if (vertical) {
      const bx = x + i * size;
      const bw = Math.min(size, x + w - bx);
      c.rect(bx, y, bw, h, col);
      c.vline(bx, y, h, mix(col, r.c3, 0.4));
      c.vline(bx + bw - 1, y, h, r.c0);
      for (let k = 0; k < 2; k++) c.vline(bx + 1 + Math.floor(rr() * Math.max(1, bw - 2)), y + 1 + rr() * (h - 4), 2 + rr() * 3, mix(col, r.c0, 0.5));
    } else {
      const by = y + i * size;
      const bh = Math.min(size, y + h - by);
      c.rect(x, by, w, bh, col);
      c.hline(x, by, w, mix(col, r.c3, 0.4));
      c.hline(x, by + bh - 1, w, r.c0);
      for (let k = 0; k < 2; k++) c.hline(x + 1 + rr() * (w - 5), by + 1 + Math.floor(rr() * Math.max(1, bh - 2)), 2 + rr() * 4, mix(col, r.c0, 0.5));
    }
  }
}
/** A small lit flame; size 1..3. */
function flameAt(c: Img, x: number, y: number, size = 1) {
  if (size >= 2) {
    c.vline(x, y - 3, 3, P.flame1);
    c.set(x - 1, y - 1, P.flame1);
    c.set(x + 1, y - 1, P.ember);
    c.vline(x, y - 2, 2, P.flame2);
    c.set(x, y - 4, mix(P.flame1, P.ember, 0.5));
    if (size >= 3) {
      c.set(x - 1, y - 2, P.flame2);
      c.set(x + 1, y - 3, P.flame1);
      c.set(x, y - 5, P.ember);
    }
  } else {
    c.set(x, y - 1, P.flame2);
    c.set(x, y - 2, P.flame1);
  }
}
/** A candle standing on `base`, h tall, lit. */
function candleAt(c: Img, x: number, base: number, h: number, lit = true) {
  c.vline(x, base - h, h, P.wax2);
  c.vline(x + 1, base - h, h, P.wax1);
  c.set(x - 1, base - 1, P.wax1); // wax pooled at the foot
  c.set(x + 2, base - 1, P.wax1);
  if (h > 3) c.set(x + 1, base - h + 1, P.wax2); // a run of wax
  c.set(x, base - h - 1, P.ink);
  if (lit) flameAt(c, x, base - h - 1);
}
/** Moss creeping along the top of something, from x to x+w at height y. */
function mossTop(c: Img, x: number, y: number, w: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < w; i++) {
    if (r() < 0.25) continue;
    c.set(x + i, y, r() < 0.5 ? P.moss1 : P.moss2);
    if (r() < 0.4) c.set(x + i, y + 1, P.moss1);
    if (r() < 0.15) c.set(x + i, y - 1, mix(P.moss2, P.wax1, 0.3));
  }
}
/** Ivy: a vine hanging from (x, y) down `len` px, heart-shaped leaves either side, lit on their upper edge. */
function ivy(c: Img, x: number, y: number, len: number, seed: number) {
  const r = rng(seed);
  const dark = mix(P.moss1, P.ink, 0.3);
  const lit = mix(P.moss2, P.wax1, 0.3);
  let vx = x;
  for (let i = 0; i < len; i++) {
    c.set(vx, y + i, dark);
    if (i % 2 === 1 && r() < 0.85) {
      const side = (i >> 1) % 2 ? -1 : 1;
      c.set(vx + side, y + i, P.moss2);
      c.set(vx + side * 2, y + i, P.moss1);
      c.set(vx + side, y + i + 1, P.moss1);
      c.set(vx + side, y + i - 1, lit);
    }
    if (r() < 0.18) vx += r() < 0.5 ? -1 : 1;
  }
  c.set(vx, y + len, P.moss2); // the growing tip
}
/** Lay a soft contact shadow on the ground under an (already outlined) object, only where nothing is drawn. */
function finish(c: Img, cx: number, gy: number, rx: number, ry = 2.5) {
  for (let y = Math.floor(gy - ry); y <= Math.ceil(gy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - gy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1 || c.alpha(x, y)) continue;
      c.set(x, y, withAlpha(P.ink, d < 0.45 ? 90 : 55));
    }
}
function packSheet(name: string, frames: Img[], W: number, H: number, B: number) {
  const img = new Img(W * frames.length, H);
  frames.forEach((f, i) => img.blit(f, i * W, 0));
  sheet(name, img, { cell: [W, H], pivot: [32, B], layer: 'single' });
}

// ---------------------------------------------------------------- Penance Road (64x48, ground line 46)
function genRoadDecor() {
  const W = 64;
  const H = 48;
  const B = 46;
  const f: Img[] = [];
  const cell = () => new Img(W, H);

  // 0: the prison wagon, overturned on its side. Floor boards face us, the barred side faces up; straw spilled out.
  {
    const c = cell();
    boards(c, 6, B - 20, 52, 20, WOOD, true, 6, 3);
    c.hline(6, B - 11, 52, WOOD.c0); // iron-shod rail
    c.hline(6, B - 12, 52, IRON.c1);
    c.rect(6, B - 32, 52, 12, P.dark1); // the cage side seen from above, dark inside
    c.rect(7, B - 31, 50, 10, mix(P.dark1, P.ink, 0.5));
    for (let x = 9; x < 57; x += 5) {
      c.vline(x, B - 32, 12, IRON.c2);
      c.set(x, B - 32, IRON.c3);
    }
    c.hline(6, B - 32, 52, WOOD.c3);
    c.hline(6, B - 33, 52, WOOD.c2);
    c.rect(40, B - 31, 10, 10, P.ink); // broken bars: the way you crawled out
    line(c, 41, B - 31, 45, B - 24, IRON.c2);
    line(c, 46, B - 31, 48, B - 27, IRON.c1);
    for (const [cx, cy] of [[16, B - 8], [48, B - 8]]) {
      c.disc(cx, cy, 7, WOOD.c2); // wheels, axle side toward us
      c.disc(cx, cy, 5.2, WOOD.c0);
      for (let a = 0; a < 6; a++) line(c, cx, cy, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, WOOD.c1);
      c.disc(cx, cy, 1.6, IRON.c2);
      c.set(cx - 1, cy - 1, IRON.c3);
      c.set(cx - 5, cy - 5, WOOD.c3);
    }
    for (const [x, y] of [[4, B - 1], [8, B], [58, B - 2], [60, B]]) line(c, x, y, x + 3, y - 1, P.wax1); // straw
    c.outline(P.ink);
    finish(c, 32, B, 28, 3);
    f.push(c);
  }
  // 1: dead horse: a crossbow bolt still in its flank (the ambush that wrecked the wagon)
  {
    const c = cell();
    blob(c, 33, B - 6, 15, 6, WOOD);
    c.ellipse(34, B - 3, 13, 2.5, WOOD.c0); // belly in shadow
    blob(c, 15, B - 5, 6, 4, WOOD); // head
    c.set(11, B - 5, P.ink); // eye
    c.hline(13, B - 9, 12, P.dark1); // mane
    c.hline(14, B - 10, 9, P.dark2);
    c.rect(26, B - 11, 12, 4, P.blood1); // saddle blanket
    c.hline(26, B - 11, 12, P.blood2);
    c.hline(26, B - 8, 12, GOLD0);
    for (const x of [38, 42, 46]) {
      line(c, x, B - 3, x + 5, B + 1, WOOD.c1); // legs
      c.set(x + 5, B + 1, P.dark1); // hooves
    }
    line(c, 40, B - 12, 45, B - 16, WOOD.c2); // the bolt
    c.set(46, B - 17, P.wax2); // fletching
    c.set(45, B - 17, P.wax1);
    c.set(40, B - 11, P.blood2);
    c.outline(P.ink);
    finish(c, 32, B, 20, 2.5);
    f.push(c);
  }
  // 2: dead guard (flat): face down, helm rolled away, spear under him
  {
    const c = cell();
    c.ellipse(34, B - 3, 12, 3, P.blood1);
    c.ellipse(31, B - 3.5, 7, 1.6, mix(P.blood1, P.ink, 0.35));
    line(c, 10, B - 8, 52, B - 5, WOOD.c2); // spear
    c.hline(52, B - 5, 3, IRON.c3);
    box(c, 24, B - 8, 12, 5, IRON); // breastplate
    c.rect(26, B - 7, 6, 3, P.blood1); // tabard
    c.rect(18, B - 7, 6, 3, P.dark2); // legs
    c.rect(15, B - 7, 3, 3, P.wood1); // boots
    blob(c, 43, B - 5, 3, 2.6, IRON); // helm, rolled away
    c.outline(P.ink);
    f.push(c);
  }
  // 3: boulder, lichen and a cap of moss
  {
    const c = cell();
    blob(c, 32, B - 8, 11, 9, STN);
    line(c, 30, B - 4, 34, B - 10, P.stone1); // crack
    c.set(35, B - 11, P.stone1);
    mossTop(c, 25, B - 16, 12, 3);
    for (const [x, y] of [[36, B - 7], [38, B - 9]]) c.set(x, y, mix(P.stone3, P.wax1, 0.4)); // lichen
    c.hline(22, B - 1, 20, P.stone1);
    c.outline(P.ink);
    finish(c, 32, B, 13);
    f.push(c);
  }
  // 4: dead tree: twisted trunk, bark lit on one side, roots gripping the ground
  {
    const c = cell();
    for (let y = B - 26; y <= B; y++) {
      const w = y > B - 4 ? 5 + (y - (B - 4)) : 4;
      const x0 = 30 + Math.round(Math.sin(y * 0.25) * 1.2);
      c.hline(x0, y, w, WOOD.c1);
      c.set(x0, y, WOOD.c3);
      c.set(x0 + w - 1, y, WOOD.c0);
    }
    for (let y = B - 24; y < B - 4; y += 5) c.set(31, y, WOOD.c0); // bark knots
    for (const [x0, y0, x1, y1] of [[31, B - 24, 20, B - 38], [33, B - 22, 44, B - 36], [26, B - 32, 18, B - 30], [40, B - 31, 46, B - 40], [22, B - 35, 24, B - 44]] as const) {
      line(c, x0, y0, x1, y1, WOOD.c1);
      line(c, x0 + 1, y0, x1 + 1, y1, WOOD.c0);
    }
    for (const [x, dx] of [[28, -5], [36, 5]]) line(c, x, B - 1, x + dx, B + 1, WOOD.c1); // roots
    c.set(19, B - 39, P.ink); // a crow on the high branch
    c.rect(20, B - 40, 2, 2, P.ink);
    c.outline(P.ink);
    finish(c, 32, B, 9);
    f.push(c);
  }
  // 5: wheel debris (flat): a broken wheel and splintered boards
  {
    const c = cell();
    c.ellipse(24, B - 4, 8, 3.5, WOOD.c2);
    c.ellipse(24, B - 4, 6, 2.4, WOOD.c0);
    for (let a = 0; a < 5; a++) line(c, 24, B - 4, 24 + Math.cos(a * 1.2) * 6, B - 4 + Math.sin(a * 1.2) * 2.4, WOOD.c1);
    c.disc(24, B - 4, 1.2, IRON.c2);
    boards(c, 36, B - 6, 14, 3, WOOD, false, 3, 7);
    line(c, 38, B - 1, 50, B - 3, WOOD.c2);
    c.set(51, B - 4, WOOD.c3); // splinter
    c.outline(P.ink);
    f.push(c);
  }
  // 6: signpost: two arrow boards with carved marks
  {
    const c = cell();
    box(c, 31, B - 26, 3, 26, WOOD);
    for (const [y, dir] of [[B - 24, 1], [B - 17, -1]] as const) {
      const x0 = dir > 0 ? 33 : 20;
      boards(c, x0, y, 12, 5, WOOD, false, 5, y);
      const tip = dir > 0 ? x0 + 12 : x0 - 1;
      c.vline(tip, y + 1, 3, WOOD.c1);
      c.set(tip + dir, y + 2, WOOD.c1);
      for (let x = x0 + 2; x < x0 + 10; x += 2) c.set(x, y + 2, WOOD.c0); // carved letters
    }
    mossTop(c, 30, B - 1, 5, 9);
    c.outline(P.ink);
    finish(c, 32, B, 5);
    f.push(c);
  }
  // 7: candle cairn: pilgrims' stacked stones, candles burning on them, wax run down the sides
  {
    const c = cell();
    blob(c, 32, B - 4, 8, 4, STN);
    blob(c, 31, B - 10, 6, 3.5, STN);
    blob(c, 32, B - 15, 4, 2.5, STN);
    for (const [x, y, h] of [[27, B - 12, 4], [36, B - 11, 3], [31, B - 17, 5], [24, B - 6, 3]] as const) candleAt(c, x, y, h);
    for (const [x, y, l] of [[29, B - 9, 3], [35, B - 8, 4], [33, B - 13, 2]] as const) c.vline(x, y, l, P.wax2);
    c.outline(P.ink);
    finish(c, 32, B, 10);
    f.push(c);
  }
  // 8: gibbet: post and arm, an iron cage with what is left of someone inside
  {
    const c = cell();
    box(c, 22, B - 38, 3, 38, WOOD);
    box(c, 22, B - 38, 20, 3, WOOD);
    line(c, 24, B - 30, 31, B - 36, WOOD.c1); // brace
    c.vline(38, B - 35, 5, IRON.c1); // chain
    const cy = B - 30;
    c.rect(33, cy, 10, 16, P.dark1);
    blob(c, 38, cy + 5, 2.5, 2.5, BONE_R); // skull
    c.set(37, cy + 5, P.ink);
    c.set(39, cy + 5, P.ink);
    c.vline(38, cy + 8, 5, BONE_R.c1); // spine and ribs
    for (const y of [9, 11]) c.hline(36, cy + y, 5, BONE_R.c1);
    for (let x = 33; x <= 43; x += 3) {
      c.vline(x, cy, 16, IRON.c2);
      c.set(x, cy, IRON.c3);
    }
    c.hline(33, cy, 11, IRON.c3);
    c.hline(33, cy + 15, 11, IRON.c1);
    c.outline(P.ink);
    finish(c, 26, B, 6);
    f.push(c);
  }
  // 9: large rock (2 tiles): a split outcrop, moss in the cleft, lichen on its face
  {
    const c = cell();
    blob(c, 24, B - 10, 11, 10, STN);
    blob(c, 39, B - 8, 9, 8, STN);
    line(c, 31, B - 16, 32, B - 1, P.stone1); // the cleft
    for (let y = B - 14; y < B - 2; y += 3) c.set(32, y, P.moss1);
    mossTop(c, 16, B - 19, 12, 11);
    mossTop(c, 34, B - 15, 8, 12);
    for (const [x, y] of [[20, B - 7], [42, B - 5], [26, B - 12]]) c.set(x, y, mix(P.stone3, P.wax1, 0.4));
    c.outline(P.ink);
    finish(c, 32, B, 21, 3);
    f.push(c);
  }
  // 10: ruined pillar, ivy climbing it, rubble at its foot
  {
    const c = cell();
    for (let y = B - 36; y <= B; y++) {
      c.hline(27, y, 10, STN.c1);
      c.set(27, y, STN.c3);
      c.set(28, y, STN.c2);
      c.set(36, y, STN.c0);
      c.set(35, y, mix(STN.c1, STN.c0, 0.5));
    }
    for (const y of [B - 28, B - 18, B - 8]) c.hline(27, y, 10, STN.c0); // drums
    // broken top: jagged
    for (const [x, d] of [[27, 3], [28, 2], [29, 0], [30, 1], [31, 4], [32, 2], [33, 0], [34, 1], [35, 3], [36, 5]] as const) for (let k = 0; k < d; k++) c.set(x, B - 36 + k, null);
    ivy(c, 29, B - 34, 30, 5);
    ivy(c, 34, B - 30, 22, 6);
    blob(c, 22, B - 2, 4, 2.5, STN);
    blob(c, 41, B - 2, 3, 2, STN);
    c.outline(P.ink);
    finish(c, 32, B, 11);
    f.push(c);
  }
  // 11: fallen lintel (3 tiles): the old toll arch, carved words worn away, moss along its top
  {
    const c = cell();
    box(c, 6, B - 10, 52, 9, STN);
    c.hline(7, B - 9, 50, STN.c3);
    for (let x = 12; x < 52; x += 4) c.hline(x, B - 6, 2, STN.c0); // carved words
    c.rect(25, B - 7, 8, 3, STN.c0); // a coin slot, the toll's mark
    c.set(29, B - 6, GOLD0);
    line(c, 44, B - 10, 47, B - 2, STN.c0); // crack
    mossTop(c, 6, B - 11, 52, 13);
    c.outline(P.ink);
    finish(c, 32, B, 28, 2);
    f.push(c);
  }
  // 12: grass tuft: tall grass with seed heads
  {
    const c = cell();
    const r = rng(12);
    for (let i = 0; i < 9; i++) {
      const x = 27 + Math.floor(r() * 10);
      const h = 5 + Math.floor(r() * 6);
      const lean = r() < 0.5 ? -1 : 1;
      line(c, x, B, x + lean * Math.floor(h / 4), B - h, i % 3 ? P.moss2 : P.moss1);
      if (i % 3 === 0) c.set(x + lean * Math.floor(h / 4), B - h - 1, mix(P.wax1, P.moss2, 0.4)); // seed head
    }
    c.outline(P.ink);
    f.push(c);
  }
  packSheet('decor_road', f, W, H, B);
}

// ---------------------------------------------------------------- Wick's Rest (64x64, ground line 62)
function genHubDecor() {
  const W = 64;
  const H = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, H);

  // 0: Oskar's stall (3 tiles): striped awning, a counter of powder kegs, pouches and bottles
  {
    const c = cell();
    for (const x of [8, 54]) box(c, x, B - 30, 3, 30, WOOD); // posts
    boards(c, 8, B - 14, 49, 13, WOOD, false, 4, 21); // counter front
    box(c, 7, B - 16, 51, 3, WOOD); // counter top
    // goods on the counter
    for (const x of [12, 19]) {
      box(c, x, B - 22, 6, 6, DWOOD); // powder kegs
      c.hline(x, B - 20, 6, IRON.c2);
      c.set(x + 2, B - 22, P.dark1);
    }
    for (const [x, col] of [[28, P.teal2], [31, P.blood2], [34, P.moss2]] as const) {
      c.rect(x, B - 21, 2, 5, col); // bottles
      c.set(x, B - 21, P.wax2);
      c.set(x, B - 22, P.wood1); // cork
    }
    blob(c, 41, B - 18, 3, 2.5, WOOD); // pouches
    blob(c, 47, B - 18, 3, 2.5, CANVAS);
    // striped awning with a scalloped edge
    for (let y = B - 34; y < B - 26; y++) {
      const inset = Math.round((B - 26 - y) * 0.5);
      for (let x = 5 + inset; x < 60 - inset; x++) {
        const stripe = Math.floor((x - 5) / 6) % 2;
        const base = stripe ? P.wax2 : P.blood2;
        c.set(x, y, y === B - 34 ? mix(base, P.white, 0.3) : x > 56 - inset ? mix(base, P.ink, 0.3) : base);
      }
    }
    for (let x = 5; x < 60; x++) if ((x - 5) % 6 < 4) c.set(x, B - 26, Math.floor((x - 5) / 6) % 2 ? P.wax1 : P.blood1);
    c.outline(P.ink);
    finish(c, 32, B, 28, 2.5);
    f.push(c);
  }
  // 1: campfire: a ring of stones, crossed logs, a tall flame and a pot on a hook
  {
    const c = cell();
    for (let a = 0; a < 8; a++) blob(c, 32 + Math.cos(a * 0.785) * 8, B - 3 + Math.sin(a * 0.785) * 3, 2.4, 1.8, STN);
    line(c, 25, B - 2, 39, B - 6, WOOD.c1);
    line(c, 25, B - 6, 39, B - 2, WOOD.c2);
    c.ellipse(32, B - 5, 5, 2, P.ember);
    for (const [x, h] of [[29, 8], [32, 12], [35, 9], [31, 6], [34, 7]] as const) {
      c.vline(x, B - 4 - h, h, P.flame1);
      c.vline(x, B - 4 - h + 2, h - 3, P.flame2);
      c.set(x, B - 5 - h, P.ember);
    }
    // a pot on a tripod
    line(c, 24, B - 1, 32, B - 22, WOOD.c0);
    line(c, 40, B - 1, 32, B - 22, WOOD.c0);
    c.vline(32, B - 21, 3, IRON.c1);
    c.ellipse(32, B - 16, 3.5, 2.5, IRON.c0);
    c.hline(29, B - 18, 7, IRON.c2);
    c.outline(P.ink);
    finish(c, 32, B, 12);
    f.push(c);
  }
  // 2: well: stone ring, a shingled roof on posts, bucket and rope, dark water
  {
    const c = cell();
    for (const x of [22, 40]) box(c, x, B - 34, 3, 26, WOOD);
    for (let y = B - 42; y < B - 34; y++) {
      const inset = B - 34 - y;
      boards(c, 18 + inset, y, 29 - inset * 2, 1, WOOD, false, 1, y);
    }
    c.hline(20, B - 34, 25, WOOD.c0);
    box(c, 22, B - 30, 21, 2, WOOD); // windlass
    c.vline(32, B - 28, 10, P.wax1); // rope
    box(c, 30, B - 19, 5, 4, WOOD); // bucket
    c.hline(30, B - 18, 5, IRON.c2);
    // stone ring
    for (let y = B - 14; y < B; y++) {
      c.hline(18, y, 29, STN.c1);
      c.set(18, y, STN.c3);
      c.set(46, y, STN.c0);
    }
    for (const y of [B - 10, B - 5]) c.hline(18, y, 29, STN.c0);
    for (const [x, y] of [[24, B - 13], [31, B - 9], [38, B - 13], [27, B - 4], [42, B - 4]]) c.vline(x, y, 3, STN.c0);
    c.ellipse(32, B - 14, 13, 3, STN.c2);
    c.ellipse(32, B - 14, 10, 2, P.ink); // the dark water
    c.hline(29, B - 14, 3, P.teal1);
    mossTop(c, 18, B - 14, 6, 21);
    c.outline(P.ink);
    finish(c, 32, B, 16);
    f.push(c);
  }
  // 3: tent (2 tiles): patched canvas, a dark flap, pegs and guy ropes
  {
    const c = cell();
    for (let y = B - 26; y < B; y++) {
      const half = Math.round((y - (B - 26)) * 0.95) + 2;
      for (let x = 32 - half; x <= 32 + half; x++) {
        const t = (x - 32 + half) / (half * 2);
        c.set(x, y, t < 0.45 ? (t < 0.08 ? CANVAS.c3 : CANVAS.c2) : t > 0.9 ? CANVAS.c0 : CANVAS.c1);
      }
    }
    c.vline(32, B - 26, 26, CANVAS.c0); // ridge seam
    for (let y = B - 12; y < B; y++) c.hline(32 - Math.round((y - (B - 12)) * 0.45), y, Math.round((y - (B - 12)) * 0.9) + 1, P.ink); // the open flap
    line(c, 32, B - 12, 25, B - 1, CANVAS.c3);
    c.rect(38, B - 18, 5, 4, mix(CANVAS.c1, P.teal2, 0.4)); // a patch
    c.set(38, B - 18, CANVAS.c3);
    c.vline(32, B - 30, 4, WOOD.c1); // pole tip
    for (const [x0, x1] of [[10, 14], [54, 50]]) line(c, x1, B - 6, x0, B, P.wax1); // guy ropes
    c.outline(P.ink);
    finish(c, 32, B, 26, 2.5);
    f.push(c);
  }
  // 4: fence: weathered posts and rails
  {
    const c = cell();
    for (const x of [22, 40]) box(c, x, B - 14, 3, 14, WOOD);
    for (const y of [B - 11, B - 6]) box(c, 18, y, 29, 2, WOOD);
    c.set(33, B - 11, WOOD.c0); // a split in the rail
    mossTop(c, 21, B - 1, 6, 31);
    c.outline(P.ink);
    finish(c, 32, B, 14, 2);
    f.push(c);
  }
  // 5: lantern post: iron hook, a lit lantern swinging on it
  {
    const c = cell();
    box(c, 30, B - 34, 3, 34, WOOD);
    box(c, 30, B - 34, 10, 2, IRON);
    c.vline(38, B - 32, 3, IRON.c1);
    box(c, 36, B - 29, 5, 7, IRON);
    c.rect(37, B - 28, 3, 5, P.flame1);
    c.rect(38, B - 27, 1, 3, P.flame2);
    c.hline(36, B - 22, 5, IRON.c0);
    c.outline(P.ink);
    finish(c, 32, B, 5);
    f.push(c);
  }
  // 6: hand cart (2 tiles): sacks of grain and a spade
  {
    const c = cell();
    boards(c, 16, B - 14, 28, 8, WOOD, false, 4, 61);
    c.disc(26, B - 5, 5, WOOD.c2);
    c.disc(26, B - 5, 3.6, WOOD.c0);
    for (let a = 0; a < 4; a++) line(c, 26, B - 5, 26 + Math.cos(a * 1.57) * 4, B - 5 + Math.sin(a * 1.57) * 4, WOOD.c1);
    line(c, 44, B - 12, 54, B - 4, WOOD.c1); // handles
    blob(c, 22, B - 17, 5, 3.5, CANVAS);
    blob(c, 32, B - 18, 5, 4, CANVAS);
    c.hline(30, B - 21, 4, WOOD.c0); // tied necks
    line(c, 38, B - 24, 42, B - 14, WOOD.c1); // spade
    box(c, 36, B - 27, 4, 4, IRON);
    c.outline(P.ink);
    finish(c, 32, B, 18);
    f.push(c);
  }
  // 7: altar (2 tiles): stone, a red cloth with gold trim, candles burning, wax run down its front
  {
    const c = cell();
    box(c, 18, B - 14, 28, 14, STN);
    for (let x = 22; x < 44; x += 6) c.vline(x, B - 12, 11, STN.c0); // panels
    c.rect(24, B - 16, 16, 9, CLOTH_RED.c1);
    c.hline(24, B - 16, 16, CLOTH_RED.c3);
    c.hline(24, B - 8, 16, P.flame1);
    c.set(31, B - 12, P.flame2);
    c.set(32, B - 12, P.flame2);
    c.set(31, B - 11, GOLD0);
    box(c, 17, B - 17, 30, 3, STN);
    for (const [x, h] of [[20, 7], [24, 5], [38, 6], [43, 8], [28, 4]] as const) candleAt(c, x, B - 17, h);
    for (const [x, l] of [[19, 5], [45, 7], [36, 3]] as const) c.vline(x, B - 14, l, P.wax2);
    c.outline(P.ink);
    finish(c, 32, B, 17);
    f.push(c);
  }
  // 8: prayer bench (2 tiles): a worn kneeler
  {
    const c = cell();
    boards(c, 16, B - 12, 32, 4, WOOD, false, 4, 81);
    box(c, 16, B - 12, 32, 2, WOOD);
    for (const x of [18, 44]) box(c, x, B - 10, 3, 10, WOOD);
    box(c, 17, B - 4, 30, 2, DWOOD); // the kneeling rail
    c.rect(26, B - 4, 12, 2, CLOTH_RED.c1); // a worn cushion
    c.outline(P.ink);
    finish(c, 32, B, 17, 2);
    f.push(c);
  }
  // 9: bedroll (flat): teal wool rolled up and strapped, a blanket half out
  {
    const c = cell();
    c.ellipse(30, B - 3, 10, 3, mix(P.teal1, P.stone2, 0.3));
    c.ellipse(29, B - 3.5, 8, 2, mix(P.teal2, P.stone3, 0.2));
    blob(c, 41, B - 4, 4, 4, { c0: P.teal1, c1: P.teal2, c2: P.teal3, c3: mix(P.teal3, P.wax2, 0.4) });
    c.vline(40, B - 8, 7, P.wood1); // strap
    c.outline(P.ink);
    f.push(c);
  }
  // 10: bookshelf (2 tiles): books of every colour, a skull, a candle
  {
    const c = cell();
    box(c, 18, B - 36, 28, 36, DWOOD);
    const r = rng(10);
    for (const sy of [B - 33, B - 23, B - 13]) {
      c.rect(20, sy, 24, 9, P.ink);
      let x = 20;
      while (x < 43) {
        const w = 2 + Math.floor(r() * 2);
        const h = 6 + Math.floor(r() * 3);
        const col = [P.blood1, P.teal2, P.wood2, P.moss1, P.stone2, P.blood2][Math.floor(r() * 6)];
        if (r() < 0.12) {
          x += 2;
          continue;
        }
        c.rect(x, sy + 9 - h, w, h, col);
        c.vline(x, sy + 9 - h, h, mix(col, P.white, 0.25));
        c.set(x, sy + 10 - h + 1, GOLD0); // gilt on the spine
        x += w;
      }
      c.hline(20, sy + 9, 24, DWOOD.c3); // shelf
    }
    blob(c, 40, B - 26, 2.5, 2.2, BONE_R); // skull
    c.set(39, B - 26, P.ink);
    candleAt(c, 24, B - 33 + 9, 4);
    c.outline(P.ink);
    finish(c, 32, B, 16, 2);
    f.push(c);
  }
  // 11: ruined wall (3 tiles): timber and plaster, broken open, ivy over it
  {
    const c = cell();
    box(c, 6, B - 34, 52, 34, CANVAS);
    for (const x of [6, 26, 55]) box(c, x, B - 36, 4, 36, DWOOD); // timber frame
    box(c, 6, B - 36, 53, 3, DWOOD);
    line(c, 10, B - 33, 25, B - 4, DWOOD.c2); // brace
    // a hole broken through, laths showing
    c.rect(34, B - 26, 16, 16, P.ink);
    for (let y = B - 25; y < B - 11; y += 3) c.hline(34, y, 16, DWOOD.c1);
    for (const [x, y] of [[33, B - 27], [50, B - 18], [40, B - 10]]) c.rect(x, y, 3, 2, CANVAS.c1);
    c.rect(44, B - 34, 8, 6, P.ink); // a window
    c.hline(44, B - 31, 8, DWOOD.c1);
    ivy(c, 12, B - 33, 26, 41);
    ivy(c, 30, B - 33, 18, 42);
    ivy(c, 53, B - 33, 30, 43);
    c.outline(P.ink);
    finish(c, 32, B, 28, 2);
    f.push(c);
  }
  // 12: notice board: pinned notices, one a wanted poster of a hooded convict
  {
    const c = cell();
    for (const x of [22, 40]) box(c, x, B - 26, 3, 26, WOOD);
    boards(c, 20, B - 28, 25, 14, WOOD, false, 4, 91);
    box(c, 19, B - 30, 27, 3, DWOOD); // little roof
    c.rect(22, B - 26, 8, 10, P.wax2); // the wanted poster
    c.hline(22, B - 26, 8, P.wax1);
    for (const [x, y] of [[25, B - 24], [26, B - 24], [24, B - 23], [25, B - 23], [26, B - 23], [27, B - 23], [24, B - 22], [27, B - 22], [24, B - 21], [25, B - 21], [26, B - 21], [27, B - 21]]) c.set(x, y, P.teal1); // your hood
    c.set(25, B - 22, P.flame2);
    c.set(26, B - 22, P.flame2);
    c.hline(23, B - 18, 6, P.dark2);
    c.rect(33, B - 25, 9, 7, mix(P.wax1, P.wood2, 0.3)); // a second notice
    for (const y of [B - 23, B - 21]) c.hline(34, y, 7, P.dark2);
    for (const [x, y] of [[25, B - 26], [37, B - 25]]) c.set(x, y, P.blood2); // pins
    c.outline(P.ink);
    finish(c, 32, B, 12, 2);
    f.push(c);
  }
  // 13: log seat (2 tiles): a split log to sit on by the fire, bark on the back, worn smooth on top
  {
    const c = cell();
    for (let x = 12; x < 38; x++) {
      c.vline(x, B - 7, 5, WOOD.c1);
      c.set(x, B - 7, WOOD.c3); // the flat, worn top
      c.set(x, B - 6, WOOD.c2);
      c.set(x, B - 3, WOOD.c0);
    }
    c.ellipse(12, B - 5, 2, 3, WOOD.c2); // cut end, with rings
    c.set(12, B - 5, WOOD.c0);
    c.set(22, B - 4, WOOD.c0); // a knot
    c.outline(P.ink);
    finish(c, 24, B, 15, 2);
    f.push(c);
  }
  // 14: woodpile (2 tiles): split logs stacked end-on under a scrap of canvas
  {
    const c = cell();
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 6 - (row > 1 ? 1 : 0); i++) {
        const x = 12 + i * 5 + (row % 2) * 2;
        const y = B - 4 - row * 4;
        c.disc(x, y, 2.4, WOOD.c2);
        c.disc(x, y, 1.4, mix(WOOD.c2, P.wax1, 0.35)); // pale split faces
        c.set(x, y, WOOD.c1);
      }
    for (let x = 10; x < 38; x++) c.set(x, B - 18 + (x % 5 === 0 ? 1 : 0), CANVAS.c1); // the canvas over the top
    c.hline(10, B - 19, 26, CANVAS.c2);
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 15: chopping block: a broad stump, chips around it, an axe notch
  {
    const c = cell();
    c.ellipse(32, B - 1, 9, 2.5, mix(WOOD.c2, P.wax1, 0.3)); // chips
    for (let y = B - 8; y < B; y++) {
      c.hline(27, y, 10, WOOD.c1);
      c.set(27, y, WOOD.c2);
      c.set(36, y, WOOD.c0);
    }
    c.ellipse(32, B - 8, 5, 2, mix(WOOD.c2, P.wax1, 0.4)); // the cut top
    c.set(32, B - 8, WOOD.c0);
    c.hline(30, B - 9, 3, WOOD.c0); // notch
    for (const [x, y] of [[24, B - 1], [40, B], [38, B - 2]]) c.set(x, y, P.wax1);
    c.outline(P.ink);
    finish(c, 32, B, 8, 2);
    f.push(c);
  }
  // 16: laundry line (3 tiles, posts at both ends): shirts and a blanket drying in the smoke
  {
    const c = cell();
    for (const x of [8, 55]) box(c, x, B - 22, 2, 22, WOOD);
    for (let x = 10; x < 55; x++) c.set(x, B - 21 + Math.round(Math.sin(((x - 10) / 45) * Math.PI) * 2), P.wax1);
    const hang = (x: number, w: number, h: number, r: Ramp) => {
      const top = B - 21 + Math.round(Math.sin(((x - 10) / 45) * Math.PI) * 2);
      box(c, x, top, w, h, r);
      c.set(x + 1, top, P.wood1); // peg
    };
    hang(13, 7, 8, CANVAS);
    hang(23, 6, 7, CLOTH_RED);
    hang(32, 10, 9, { c0: P.teal1, c1: P.teal2, c2: P.teal3, c3: mix(P.teal3, P.wax2, 0.4) });
    hang(45, 5, 6, CANVAS);
    c.outline(P.ink);
    finish(c, 32, B, 26, 1.5);
    f.push(c);
  }
  // 17: trestle table (2 tiles): bread, bowls, a jug
  {
    const c = cell();
    box(c, 10, B - 12, 28, 3, WOOD);
    for (const x of [12, 34]) {
      line(c, x - 2, B, x + 2, B - 9, WOOD.c0);
      line(c, x + 2, B, x - 2, B - 9, WOOD.c1);
    }
    blob(c, 17, B - 14, 3.5, 2, { c0: P.wood1, c1: P.wood2, c2: mix(P.wood2, P.flame1, 0.3), c3: P.wax1 }); // a loaf
    for (const x of [24, 29]) {
      c.ellipse(x, B - 13, 2.2, 1, WOOD.c2); // bowls
      c.hline(x - 1, B - 14, 3, P.wax1);
    }
    box(c, 33, B - 18, 3, 6, { c0: P.stone1, c1: P.stone2, c2: P.stone3, c3: P.stone4 }); // jug
    c.set(36, B - 16, P.stone2);
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 18: water barrel: a rain barrel by the well, full to the brim
  {
    const c = cell();
    for (let y = B - 12; y < B; y++) {
      const half = y < B - 11 || y > B - 2 ? 5 : 6;
      for (let x = 32 - half; x < 32 + half; x++) {
        const t = (x - (32 - half)) / (half * 2 - 1);
        c.set(x, y, t < 0.18 ? WOOD.c3 : t < 0.35 ? WOOD.c2 : t > 0.82 ? WOOD.c0 : WOOD.c1);
      }
    }
    for (const y of [B - 10, B - 3]) c.hline(26, y, 12, IRON.c1);
    c.ellipse(32, B - 12, 5, 1.5, P.teal1); // water
    c.hline(30, B - 12, 3, P.teal2);
    c.outline(P.ink);
    finish(c, 32, B, 7, 2);
    f.push(c);
  }
  packSheet('decor_hub', f, W, H, B);
}

// ---------------------------------------------------------------- Tallow Works (64x64, ground line 62)
function genWorksDecor() {
  const W = 64;
  const H = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, H);
  const TAL: Ramp = { c0: mix(P.wax1, P.wood1, 0.5), c1: mix(P.wax1, P.wood2, 0.2), c2: P.wax1, c3: P.wax2 };

  // 0: rendering vat (3 tiles wide, 2 deep): riveted iron, tallow bubbling at the brim, a fire under it
  {
    const c = cell();
    c.ellipse(32, B - 10, 23, 10, P.dark1);
    for (let y = B - 30; y < B - 8; y++) {
      for (let x = 9; x <= 54; x++) {
        const t = (x - 9) / 45;
        c.set(x, y, t < 0.08 ? IRON.c3 : t < 0.3 ? IRON.c2 : t > 0.9 ? IRON.c0 : IRON.c1);
      }
    }
    for (const y of [B - 26, B - 15]) {
      c.hline(9, y, 46, IRON.c0);
      c.hline(9, y - 1, 46, IRON.c3);
      for (let x = 12; x < 54; x += 6) c.set(x, y - 1, GOLD0); // rivets
    }
    for (const [x, l] of [[14, 9], [22, 5], [41, 12], [50, 6]] as const) {
      c.vline(x, B - 30, l, TAL.c2); // tallow run over the side
      c.set(x, B - 30 + l, TAL.c1);
    }
    c.ellipse(32, B - 31, 23, 6, IRON.c0); // rim
    c.ellipse(32, B - 31.5, 22, 5, IRON.c2);
    c.ellipse(32, B - 31, 20, 4.5, TAL.c2); // molten tallow
    c.ellipse(26, B - 32, 8, 2, TAL.c3);
    for (const [x, y] of [[38, B - 31], [43, B - 30], [31, B - 30]]) {
      c.disc(x, y, 1.2, TAL.c3); // bubbles
      c.set(x + 1, y + 1, TAL.c0);
    }
    c.rect(26, B - 9, 12, 7, P.ink); // firebox under it
    c.rect(27, B - 7, 10, 5, P.ember);
    c.rect(29, B - 6, 6, 4, P.flame1);
    c.rect(31, B - 5, 2, 3, P.flame2);
    c.outline(P.ink);
    finish(c, 32, B, 26, 3);
    f.push(c);
  }
  // 1: hook on a chain, hanging from above (no footprint)
  {
    const c = cell();
    for (let y = 0; y < 44; y += 3) {
      c.rect(31, y, 2, 2, IRON.c2);
      c.set(31, y, IRON.c3);
      c.set(32, y + 2, IRON.c0);
    }
    box(c, 30, 44, 4, 3, IRON);
    line(c, 33, 47, 35, 52, IRON.c3);
    line(c, 35, 52, 31, 54, IRON.c2);
    c.set(30, 52, IRON.c2);
    c.set(30, 51, IRON.c3); // the point
    c.set(34, 50, P.blood1);
    c.outline(P.ink);
    c.ellipse(32, B - 1, 3, 1, withAlpha(P.ink, 120)); // shadow on the floor
    f.push(c);
  }
  // 2: pilgrim cage (2 tiles): straw on the floor, a robe left behind, a name tag on the door
  {
    const c = cell();
    c.rect(9, B - 26, 30, 26, P.dark1);
    c.rect(10, B - 25, 28, 24, mix(P.dark1, P.ink, 0.5));
    for (const [x, y] of [[12, B - 3], [18, B - 2], [28, B - 3], [33, B - 2]]) line(c, x, y, x + 4, y - 1, mix(P.wax1, P.wood1, 0.4)); // straw
    blob(c, 22, B - 5, 5, 2.5, STN); // a dropped robe
    c.rect(20, B - 6, 3, 2, mix(P.wax1, P.stone3, 0.3)); // its tag
    for (let x = 9; x <= 38; x += 4) {
      c.vline(x, B - 26, 26, IRON.c2);
      c.set(x, B - 26, IRON.c3);
      c.vline(x + 1, B - 25, 25, IRON.c0);
    }
    box(c, 8, B - 27, 32, 2, IRON);
    box(c, 8, B - 2, 32, 2, IRON);
    box(c, 30, B - 16, 4, 4, IRON); // lock
    c.set(31, B - 15, P.ink);
    c.outline(P.ink);
    finish(c, 24, B, 17, 2);
    f.push(c);
  }
  // 3: tallow blocks stacked on a pallet, bound with twine and stamped
  {
    const c = cell();
    boards(c, 21, B - 3, 22, 3, WOOD, false, 3, 33);
    for (const [x, y] of [[22, 11], [32, 11], [27, 19]]) {
      box(c, x, B - y, 10, 8, TAL);
      c.vline(x + 5, B - y, 8, mix(TAL.c1, P.wood1, 0.4)); // twine
      c.hline(x, B - y + 4, 10, mix(TAL.c1, P.wood1, 0.4));
      c.rect(x + 2, B - y + 2, 2, 1, P.blood1); // stamp
    }
    c.outline(P.ink);
    finish(c, 32, B, 12);
    f.push(c);
  }
  // 4: furnace (2 tiles), tall: soot brick, an iron door on a glowing mouth, a flue into the dark
  {
    const c = cell();
    box(c, 9, B - 36, 30, 36, { c0: hex('#2a1c1c'), c1: mix(P.wood1, P.dark2, 0.35), c2: mix(P.wood1, P.dark2, 0.15), c3: hex('#80523a') });
    for (let row = 0; row < 11; row++) {
      const y = B - 34 + row * 3;
      c.hline(10, y, 28, hex('#2a1c1c'));
      for (let x = 10 + (row % 2) * 4; x < 38; x += 8) c.vline(x, y, 3, hex('#2a1c1c'));
    }
    box(c, 17, B - 44, 14, 9, IRON); // flue
    c.rect(14, B - 16, 20, 14, P.ink);
    c.rect(16, B - 13, 16, 11, P.ember); // the mouth
    c.rect(18, B - 11, 12, 9, P.flame1);
    c.rect(21, B - 9, 6, 7, P.flame2);
    box(c, 33, B - 17, 4, 15, IRON); // the door, swung open
    c.set(35, B - 10, GOLD0);
    c.outline(P.ink);
    finish(c, 24, B, 17, 2);
    f.push(c);
  }
  // 5: iron pipe rising into the dark, a valve wheel, a hiss of steam
  {
    const c = cell();
    for (let y = B - 46; y < B; y++) {
      c.hline(28, y, 8, IRON.c1);
      c.set(28, y, IRON.c3);
      c.set(29, y, IRON.c2);
      c.set(35, y, IRON.c0);
    }
    for (const y of [B - 34, B - 12]) box(c, 26, y, 12, 3, IRON);
    c.disc(40, B - 24, 3, IRON.c0); // valve wheel
    c.disc(40, B - 24, 2, P.blood1);
    c.set(39, B - 25, P.blood2);
    c.hline(36, B - 24, 3, IRON.c2);
    for (const [x, y] of [[26, B - 36], [24, B - 38], [25, B - 40]]) c.set(x, y, withAlpha(P.stone4, 170)); // steam
    c.outline(P.ink);
    finish(c, 32, B, 6);
    f.push(c);
  }
  // 6: robe rack (2 tiles): pilgrims' robes hung up with their name tags
  {
    const c = cell();
    for (const x of [9, 37]) box(c, x, B - 28, 3, 28, WOOD);
    box(c, 9, B - 29, 31, 2, WOOD);
    const cols: Ramp[] = [STN, { c0: P.teal1, c1: P.teal1, c2: P.teal2, c3: P.teal3 }, WOOD, STN, { c0: P.dark1, c1: P.dark2, c2: P.stone1, c3: P.stone2 }];
    cols.forEach((r, i) => {
      const x = 12 + i * 5;
      for (let y = B - 26; y < B - 8; y++) {
        const w = 4 + (y > B - 16 ? 1 : 0);
        c.hline(x, y, w, r.c1);
        c.set(x, y, r.c2);
        c.set(x + w - 1, y, r.c0);
      }
      c.hline(x + 1, B - 27, 2, IRON.c2); // hook
      c.rect(x + 1, B - 22, 2, 2, P.wax2); // name tag
      c.set(x + 1, B - 21, P.dark2);
    });
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 7: the foreman's desk (2 tiles): the Chandler's ledger open on it, a quill, a candle, a stack of coin
  {
    const c = cell();
    box(c, 9, B - 14, 30, 4, DWOOD);
    for (const x of [10, 35]) box(c, x, B - 10, 3, 10, DWOOD);
    boards(c, 13, B - 10, 22, 6, DWOOD, true, 5, 71);
    c.rect(16, B - 18, 12, 4, P.wax2); // the ledger
    c.vline(22, B - 18, 4, P.wax1);
    for (const y of [B - 17, B - 16]) {
      c.hline(17, y, 4, P.dark2);
      c.hline(23, y, 4, P.dark2);
    }
    c.rect(15, B - 15, 14, 1, P.blood1); // its binding
    line(c, 29, B - 20, 32, B - 15, P.wax2); // quill
    candleAt(c, 12, B - 14, 4);
    for (let i = 0; i < 3; i++) c.hline(33, B - 15 - i, 3, i % 2 ? P.flame2 : P.flame1); // coins
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 8: lift cage platform (flat, 2 tiles: anchor and east) with its chains
  {
    const c = cell();
    boards(c, 24, B - 6, 32, 6, WOOD, true, 5, 81);
    c.hline(24, B - 6, 32, IRON.c3);
    c.hline(24, B - 1, 32, IRON.c1);
    for (const x of [25, 54])
      for (let y = 0; y < B - 6; y += 3) {
        c.rect(x, y, 1, 2, IRON.c2);
        c.set(x, y, IRON.c3);
      }
    f.push(c);
  }
  // 9: heap of chain (flat)
  {
    const c = cell();
    for (let i = 0; i < 10; i++) {
      const x = 23 + (i % 4) * 5 + (i > 7 ? 2 : 0);
      const y = B - 2 - Math.floor(i / 4) * 2;
      c.ellipse(x, y, 2.5, 1.5, IRON.c1);
      c.ellipse(x, y, 1.2, 0.6, IRON.c0);
      c.set(x - 1, y - 1, IRON.c3);
    }
    c.outline(P.ink);
    f.push(c);
  }
  // 10: tallow cart (2 tiles): heaped high with rendered tallow, a robe thrown on top
  {
    const c = cell();
    boards(c, 10, B - 14, 28, 9, WOOD, false, 3, 101);
    box(c, 9, B - 15, 30, 2, WOOD);
    for (const x of [16, 32]) {
      c.disc(x, B - 4, 4, WOOD.c2);
      c.disc(x, B - 4, 2.8, WOOD.c0);
      c.disc(x, B - 4, 1, IRON.c2);
    }
    blob(c, 24, B - 19, 12, 5, TAL);
    blob(c, 17, B - 22, 5, 3, TAL);
    c.rect(26, B - 22, 6, 3, STN.c2); // a robe on the heap
    c.set(26, B - 22, STN.c3);
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 11: carters' toll booth (tall): a lit window, a price board, a bell to ring for the carter
  {
    const c = cell();
    boards(c, 22, B - 30, 20, 30, WOOD, true, 4, 111);
    for (let y = B - 36; y < B - 29; y++) {
      const inset = B - 29 - y;
      c.hline(19 + Math.floor(inset / 2), y, 26 - inset, y === B - 36 ? DWOOD.c3 : DWOOD.c1);
    }
    c.rect(26, B - 24, 12, 8, P.ink); // window
    c.rect(27, B - 23, 10, 6, mix(P.flame1, P.ink, 0.5));
    c.rect(29, B - 21, 2, 2, P.flame2);
    c.hline(25, B - 16, 14, DWOOD.c3); // sill
    c.rect(24, B - 12, 8, 5, P.wax1); // price board
    for (const y of [B - 11, B - 9]) c.hline(25, y, 6, P.dark2);
    c.vline(42, B - 30, 3, IRON.c1); // bell on a bracket
    blob(c, 43, B - 26, 2, 2, BRONZE);
    c.outline(P.ink);
    finish(c, 32, B, 12, 2);
    f.push(c);
  }
  packSheet('decor_works', f, W, H, B);
}

// ---------------------------------------------------------------- The Waxmire (64x64, ground line 62)
function genMireDecor() {
  const W = 64;
  const H = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, H);
  const WX: Ramp = { c0: mix(P.wax1, P.wood1, 0.55), c1: mix(P.wax1, P.wood2, 0.25), c2: P.wax1, c3: P.wax2 };
  const MSTN: Ramp = { c0: mix(P.stone1, P.teal1, 0.3), c1: mix(P.stone2, P.teal1, 0.2), c2: P.stone3, c3: P.stone4 };

  // 0: gravestone, sinking and leaning, moss on its shoulders, the name worn off
  {
    const c = cell();
    for (let y = B - 18; y < B; y++) {
      const top = y - (B - 18);
      const half = top < 3 ? [3, 5, 6][top] : 6;
      const lean = Math.round((B - y) * 0.12);
      for (let x = 32 - half + lean; x < 32 + half + lean; x++) {
        const t = (x - (32 - half + lean)) / (half * 2);
        c.set(x, y, t < 0.15 ? MSTN.c3 : t < 0.3 ? MSTN.c2 : t > 0.85 ? MSTN.c0 : MSTN.c1);
      }
    }
    for (const y of [B - 13, B - 11, B - 9]) c.hline(30, y, 5, MSTN.c0); // worn lettering
    c.hline(31, B - 15, 3, MSTN.c0); // a carved flame
    c.set(32, B - 16, MSTN.c0);
    mossTop(c, 27, B - 17, 7, 201);
    c.ellipse(32, B - 1, 9, 2, WX.c2); // the wax it is sinking into
    c.hline(26, B - 2, 5, WX.c3);
    c.outline(P.ink);
    f.push(c);
  }
  // 1: grave cross: a strip of cloth tied on, candle wax dripped on its arms
  {
    const c = cell();
    box(c, 31, B - 22, 3, 22, WOOD);
    box(c, 25, B - 18, 15, 3, WOOD);
    c.rect(34, B - 17, 2, 7, P.blood1); // a strip of cloth
    c.set(35, B - 10, P.blood2);
    for (const x of [26, 38]) {
      c.set(x, B - 19, P.wax2);
      c.vline(x, B - 15, 2, P.wax1);
    }
    c.ellipse(32, B - 1, 5, 1.5, WX.c2);
    c.outline(P.ink);
    finish(c, 32, B, 5, 1.5);
    f.push(c);
  }
  // 2: reeds (tall enough to hide in): cattails, lit from one side
  {
    const c = cell();
    const r = rng(202);
    for (let i = 0; i < 14; i++) {
      const x = 24 + Math.floor(r() * 16);
      const h = 18 + Math.floor(r() * 16);
      const lean = (r() - 0.5) * 4;
      line(c, x, B, x + lean, B - h, i % 3 ? P.moss1 : P.moss2);
      if (i % 3 === 0) {
        c.vline(Math.round(x + lean), B - h - 4, 4, P.wood1); // cattail head
        c.set(Math.round(x + lean), B - h - 4, P.wood2);
        c.set(Math.round(x + lean), B - h - 5, P.moss2);
      }
    }
    for (let i = 0; i < 5; i++) line(c, 26 + i * 3, B, 22 + i * 4, B - 10 - (i % 2) * 4, mix(P.moss2, P.wax1, 0.2)); // blades
    c.outline(P.ink);
    finish(c, 32, B, 10, 2);
    f.push(c);
  }
  // 3: root tangle (2 tiles, tall): pale roots rearing out of the wax
  {
    const c = cell();
    const r = rng(203);
    for (let i = 0; i < 12; i++) {
      const x0 = 10 + r() * 30;
      const x1 = x0 + (r() - 0.5) * 16;
      const y1 = B - 12 - r() * 22;
      line(c, x0 + 1, B, x1 + 1, y1, WOOD.c0);
      line(c, x0, B, x1, y1, i % 3 ? mix(P.wax1, P.wood1, 0.45) : P.wax1);
      if (i % 4 === 0) line(c, x1, y1, x1 + (r() < 0.5 ? -4 : 4), y1 + 3, mix(P.wax1, P.wood1, 0.3));
    }
    for (let i = 0; i < 6; i++) c.set(12 + r() * 28, B - 6 - r() * 20, P.moss1); // moss caught in them
    c.ellipse(24, B - 1, 15, 2.5, WX.c2);
    c.outline(P.ink);
    f.push(c);
  }
  // 4: stone angel (tall): weeping into its hands, wings folded, wax tears, moss on its shoulders
  {
    const c = cell();
    box(c, 26, B - 6, 12, 6, MSTN); // plinth
    for (let y = B - 30; y < B - 6; y++) {
      const half = 3 + Math.round((y - (B - 30)) * 0.12);
      for (let x = 32 - half; x <= 32 + half; x++) {
        const t = (x - 32 + half) / (half * 2);
        c.set(x, y, t < 0.2 ? MSTN.c3 : t > 0.8 ? MSTN.c0 : MSTN.c2);
      }
    }
    for (let y = B - 26; y < B - 10; y += 4) line(c, 31, y, 30, y + 3, MSTN.c1); // robe folds
    for (const side of [-1, 1]) {
      // folded wings rising behind
      for (let y = B - 36; y < B - 14; y++) {
        const w = Math.max(1, 4 - Math.floor(Math.abs(y - (B - 30)) / 5));
        c.hline(side < 0 ? 32 - 5 - w : 32 + 5, y, w, side < 0 ? MSTN.c2 : MSTN.c0);
      }
    }
    blob(c, 32, B - 32, 3.5, 3.5, MSTN); // bowed head
    c.rect(29, B - 30, 6, 3, MSTN.c3); // hands over the face
    c.vline(30, B - 27, 5, P.wax2); // wax tears running down
    c.vline(33, B - 27, 3, P.wax1);
    mossTop(c, 26, B - 30, 12, 204);
    c.outline(P.ink);
    finish(c, 32, B, 8, 2);
    f.push(c);
  }
  // 5: coffin (flat): half sunk, its lid knocked askew, something pale inside
  {
    const c = cell();
    c.ellipse(32, B - 2, 15, 3, WX.c2);
    boards(c, 20, B - 8, 24, 6, DWOOD, false, 3, 205);
    c.rect(22, B - 7, 12, 3, P.ink);
    c.rect(24, B - 6, 5, 2, P.wax2); // a pale hand
    box(c, 28, B - 11, 18, 4, WOOD); // the lid
    c.set(36, B - 10, GOLD0);
    c.outline(P.ink);
    f.push(c);
  }
  // 6: drowned candles (flat): a cluster burning on a raft of their own wax
  {
    const c = cell();
    c.ellipse(32, B - 2, 10, 2.5, WX.c1);
    c.ellipse(31, B - 2.5, 8, 1.6, WX.c2);
    for (const [x, h] of [[26, 4], [29, 6], [33, 3], [36, 5], [31, 2], [38, 3]] as const) candleAt(c, x, B - 2, h);
    c.outline(P.ink);
    f.push(c);
  }
  // 7: dead willow (tall): a twisted trunk and curtains of dead hanging strands
  {
    const c = cell();
    for (let y = B - 26; y <= B; y++) {
      const w = y > B - 4 ? 5 + (y - (B - 4)) : 4;
      const x0 = 30 + Math.round(Math.sin(y * 0.2) * 1.5);
      c.hline(x0, y, w, WOOD.c1);
      c.set(x0, y, WOOD.c3);
      c.set(x0 + w - 1, y, WOOD.c0);
    }
    for (const [x0, y0, x1, y1] of [[31, B - 24, 18, B - 40], [33, B - 24, 46, B - 40], [32, B - 26, 32, B - 44]] as const) {
      line(c, x0, y0, x1, y1, WOOD.c1);
      line(c, x0 + 1, y0, x1 + 1, y1, WOOD.c0);
    }
    const r = rng(207);
    for (let i = 0; i < 18; i++) {
      const x = 14 + Math.floor(r() * 36);
      const y = B - 42 + Math.floor(Math.abs(x - 32) * 0.3);
      const len = 10 + Math.floor(r() * 14);
      for (let k = 0; k < len; k++) c.set(x + (k > len / 2 ? (i % 2 ? 1 : 0) : 0), y + k, k % 4 === 0 ? P.moss2 : mix(P.moss1, P.wood1, 0.4));
    }
    c.outline(P.ink);
    finish(c, 32, B, 9);
    f.push(c);
  }
  // 8: sunken bell: the Abbey's old bell, rim above the wax, green with verdigris
  {
    const c = cell();
    for (let y = B - 14; y < B - 1; y++) {
      const half = Math.round(6 + (y - (B - 14)) * 0.5);
      for (let x = 32 - half; x <= 32 + half; x++) {
        const t = (x - 32 + half) / (half * 2);
        c.set(x, y, t < 0.15 ? BRONZE.c3 : t < 0.35 ? BRONZE.c2 : t > 0.85 ? BRONZE.c0 : BRONZE.c1);
      }
    }
    c.hline(24, B - 9, 17, BRONZE.c0); // cast band
    for (const [x, y] of [[27, B - 12], [36, B - 6], [30, B - 4], [39, B - 10]]) c.set(x, y, mix(P.teal2, P.teal3, 0.5)); // verdigris
    box(c, 30, B - 17, 4, 3, BRONZE);
    c.ellipse(32, B - 1, 14, 2.5, WX.c2);
    c.hline(22, B - 2, 6, WX.c3);
    c.outline(P.ink);
    f.push(c);
  }
  packSheet('decor_mire', f, W, H, B);
}

// ---------------------------------------------------------------- The Nave (64x64, ground line 62)
function genNaveDecor() {
  const W = 64;
  const H = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, H);

  // 0: the great altar (3 tiles): its fire burning high in a black iron bowl, the cloth, candles and wax
  {
    const c = cell();
    box(c, 9, B - 14, 46, 14, STN);
    for (const x of [15, 27, 37, 49]) {
      c.vline(x, B - 12, 10, STN.c0);
      c.vline(x + 1, B - 12, 10, STN.c2);
    }
    box(c, 8, B - 17, 48, 4, STN); // top slab
    c.rect(22, B - 17, 20, 12, CLOTH_RED.c1); // altar cloth
    c.vline(23, B - 16, 10, CLOTH_RED.c2);
    c.vline(40, B - 16, 10, CLOTH_RED.c0);
    c.hline(22, B - 6, 20, P.flame1);
    c.vline(22, B - 17, 12, P.flame1);
    c.vline(41, B - 17, 12, GOLD0);
    for (const [x, y] of [[31, B - 13], [32, B - 13], [31, B - 12], [32, B - 11], [30, B - 12], [33, B - 12]]) c.set(x, y, P.flame2); // the Abbey's flame, stitched
    for (const [x, l] of [[12, 6], [19, 9], [45, 7], [52, 5]] as const) {
      c.vline(x, B - 14, l, P.wax1); // wax running down the front
      c.set(x, B - 14 + l, P.wax2);
    }
    c.ellipse(32, B - 19, 8, 3, IRON.c0); // the fire bowl
    c.hline(25, B - 18, 15, IRON.c2);
    c.hline(25, B - 19, 15, IRON.c3);
    const r = rng(4242);
    for (let i = 0; i < 26; i++) {
      const x = 26 + Math.floor(r() * 13);
      const h = 4 + Math.floor(r() * (14 - Math.abs(x - 32) * 1.4));
      c.vline(x, B - 20 - h, h, i % 3 ? P.flame1 : P.flame2);
      c.set(x, B - 21 - h, i % 2 ? P.flame2 : P.ember);
    }
    c.vline(32, B - 40, 8, P.flame2);
    c.vline(31, B - 36, 4, P.white);
    for (const x of [12, 52]) candleAt(c, x - 1, B - 17, 5);
    for (const x of [16, 48]) candleAt(c, x, B - 17, 3);
    c.outline(P.ink);
    finish(c, 32, B, 26, 2.5);
    f.push(c);
  }
  // 1: candelabrum: tall wrought iron, three candles guttering
  {
    const c = cell();
    c.vline(32, B - 30, 30, IRON.c0);
    c.vline(31, B - 30, 30, IRON.c2);
    c.set(31, B - 20, IRON.c3); // a knop on the stem
    c.hline(30, B - 20, 4, IRON.c1);
    c.hline(27, B - 1, 10, IRON.c0); // feet
    c.hline(28, B - 2, 8, IRON.c2);
    line(c, 26, B - 26, 38, B - 26, IRON.c2); // the arms
    line(c, 26, B - 26, 26, B - 30, IRON.c2);
    line(c, 38, B - 26, 38, B - 30, IRON.c1);
    for (const [x, y] of [[26, 31], [32, 34], [38, 31]]) {
      c.hline(x - 2, B - y + 1, 4, IRON.c1); // drip pans
      candleAt(c, x - 1, B - y + 1, 4);
      c.vline(x + 1, B - y + 2, 3, P.wax1); // drips
    }
    c.outline(P.ink);
    finish(c, 32, B, 6, 2);
    f.push(c);
  }
  // 2, 3: a pew (anchor and west tile), whole or broken
  for (const broken of [false, true]) {
    const c = cell();
    const x0 = 9;
    const w = 31;
    if (!broken) {
      boards(c, x0, B - 17, w, 4, WOOD, false, 2, 32);
      box(c, x0, B - 10, w, 4, WOOD); // seat
      for (const x of [x0, x0 + w - 3]) box(c, x, B - 18, 3, 18, DWOOD); // carved ends
      c.set(x0 + 1, B - 18, DWOOD.c3);
      box(c, x0 + 13, B - 6, 3, 6, DWOOD);
      c.rect(x0 + 6, B - 9, 3, 1, P.blood1); // a hymn book left on the seat
    } else {
      line(c, x0, B - 14, x0 + 14, B - 10, WOOD.c1); // snapped backrest
      line(c, x0, B - 15, x0 + 14, B - 11, WOOD.c2);
      line(c, x0 + 17, B - 12, x0 + w, B - 17, WOOD.c1);
      box(c, x0, B - 8, 12, 3, WOOD);
      box(c, x0 + 18, B - 9, w - 18, 3, WOOD);
      for (const x of [x0, x0 + w - 3]) box(c, x, B - 12, 3, 12, DWOOD);
      for (const [x, y] of [[x0 + 14, 2], [x0 + 16, 4], [x0 + 12, 1], [x0 + 20, 1]]) c.rect(x, B - y, 2, 1, WOOD.c3); // splinters
    }
    c.outline(P.ink);
    finish(c, 24, B, 17, 2);
    f.push(c);
  }
  // 4: the lift gate in the wall: a dark shaft behind iron bars, a chain going up
  {
    const c = cell();
    c.rect(24, B - 30, 17, 30, P.ink);
    for (let y = B - 30; y < B; y += 5) c.hline(25, y, 15, mix(P.ink, P.dark1, 0.5)); // the shaft's depth
    box(c, 23, B - 33, 19, 3, IRON);
    for (let x = 25; x <= 39; x += 3) {
      c.vline(x, B - 30, 30, IRON.c2);
      c.set(x, B - 30, IRON.c3);
    }
    c.hline(24, B - 16, 17, IRON.c1);
    c.hline(24, B - 17, 17, IRON.c3);
    for (let y = B - 46; y < B - 33; y += 2) {
      c.set(32, y, IRON.c3);
      c.set(32, y + 1, IRON.c0);
    }
    c.outline(P.ink);
    f.push(c);
  }
  // 5: a length of the red runner down the aisle (flat, one tile): worn wool, a gilt border, a diamond pattern,
  // the odd spill of wax
  {
    const c = cell();
    const y0 = B - 16;
    for (let y = y0; y < B; y++) {
      for (let x = 26; x <= 37; x++) {
        let col = (x + y) % 2 ? CLOTH_RED.c1 : mix(CLOTH_RED.c1, CLOTH_RED.c2, 0.4);
        const dx = Math.abs(x - 31.5);
        const dy = Math.abs(((y - y0) % 8) - 3.5);
        if (Math.abs(dx + dy - 4) < 0.6) col = mix(CLOTH_RED.c2, P.flame1, 0.35); // the diamond
        if (x === 27 || x === 36) col = CLOTH_RED.c0;
        if (x === 26 || x === 37) col = y % 3 ? GOLD0 : mix(GOLD0, P.flame1, 0.5);
        c.set(x, y, col);
      }
    }
    for (const [x, y] of [[30, 3], [33, 9], [29, 12]]) c.set(x, y0 + y, mix(CLOTH_RED.c1, P.stone2, 0.5)); // worn through
    c.ellipse(34, y0 + 6, 1.8, 1.2, P.wax1); // a spill of wax
    c.set(34, y0 + 6, P.wax2);
    f.push(c);
  }
  // 6: a lancet window in the north wall: lead cames, the Abbey's flame in the glass, a stone sill
  {
    const c = cell();
    const x0 = 27;
    const w = 10;
    const topY = B - 34;
    const sill = B - 17;
    for (let y = topY; y < sill; y++) {
      const k = y - topY;
      const inset = k < 4 ? Math.round(4 - Math.sqrt(Math.max(0, 16 - (4 - k) * (4 - k))) + (4 - k) * 0.25) : 0; // the pointed head
      for (let x = x0 + inset; x < x0 + w - inset; x++) {
        const edge = x === x0 + inset || x === x0 + w - inset - 1;
        let col: RGBA = edge ? STN.c3 : (x - x0) % 3 === 0 || k % 5 === 0 ? P.dark1 : k < 7 ? mix(P.cyan, P.teal2, 0.4) : k < 12 ? P.blood2 : mix(P.moss2, P.teal2, 0.3);
        if (!edge && x > x0 + 3 && x < x0 + 6 && k > 5 && k < 13) col = k < 8 ? P.flame2 : P.flame1; // the flame
        c.set(x, y, col);
      }
    }
    c.set(x0 + 4, topY + 6, P.white); // light through the glass
    box(c, x0 - 1, sill, w + 2, 2, STN);
    c.outline(P.ink);
    f.push(c);
  }
  // 7: a reliquary on a plinth: a gilt house with a window, a saint's skull behind it, two candles
  {
    const c = cell();
    box(c, 25, B - 8, 14, 8, STN); // plinth
    c.hline(25, B - 8, 14, STN.c3);
    c.rect(26, B - 20, 12, 12, BRASS); // the house
    c.hline(26, B - 20, 12, mix(GOLD0, P.wax2, 0.4));
    c.vline(26, B - 20, 12, mix(GOLD0, P.wax2, 0.3));
    c.vline(37, B - 20, 12, mix(BRASS, P.wood1, 0.5));
    for (let i = 0; i < 6; i++) c.hline(26 + i, B - 21 - i, 12 - i * 2, i === 5 ? P.flame2 : BRASS); // the roof
    c.set(32, B - 27, P.flame2);
    c.rect(29, B - 17, 6, 7, P.ink); // the window
    c.ellipse(32, B - 14, 2.2, 2, P.wax1); // the skull
    c.set(31, B - 14, P.ink);
    c.set(33, B - 14, P.ink);
    c.hline(31, B - 12, 3, P.wax2);
    c.set(30, B - 17, mix(P.cyan, P.white, 0.5)); // glint on the glass
    for (const [x, y] of [[27, B - 11], [36, B - 11]]) c.set(x, y, P.blood2); // garnets
    candleAt(c, 23, B - 1, 5);
    candleAt(c, 40, B - 1, 4);
    c.outline(P.ink);
    finish(c, 32, B, 9, 2);
    f.push(c);
  }
  packSheet('decor_nave', f, W, H, B);
}

// ---------------------------------------------------------------- The Guttering Abbey (64x64, ground line 62)
// Scenery that tells each room's story: saints and banners at the doors, the fallen bell in the Bell Passage,
// sarcophagi on the Crypt Stair, skulls in the Ossuary, desks and scrolls in the Scriptorium, stores in the Undercroft.
function genAbbeyDecor() {
  const W = 64;
  const H = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, H);
  const skull = (c: Img, x: number, y: number, lit = false) => {
    blob(c, x, y, 2.4, 2.1, BONE_R);
    c.set(x - 1, y, P.ink);
    c.set(x + 1, y, P.ink);
    c.set(x, y + 2, BONE_R.c0);
    if (lit) c.set(x - 1, y, P.ember);
  };

  // 0: saint statue (tall): a hooded saint on a plinth, holding up a lit candle; wax run down the robe
  {
    const c = cell();
    box(c, 25, B - 7, 14, 7, STN); // plinth
    c.hline(27, B - 4, 10, STN.c0); // an inscription
    for (let y = B - 34; y < B - 7; y++) {
      const half = 4 + Math.round((y - (B - 34)) * 0.12);
      for (let x = 32 - half; x <= 32 + half; x++) {
        const t = (x - 32 + half) / (half * 2);
        c.set(x, y, t < 0.18 ? STN.c3 : t < 0.35 ? STN.c2 : t > 0.82 ? STN.c0 : STN.c1);
      }
    }
    for (const x of [30, 34]) line(c, x, B - 26, x + (x < 32 ? -1 : 1), B - 8, STN.c0); // robe folds
    blob(c, 32, B - 36, 4, 4, STN); // hood
    c.rect(30, B - 36, 4, 3, STN.c0); // the face in shadow
    line(c, 35, B - 30, 38, B - 38, STN.c2); // arm raised
    c.hline(37, B - 39, 3, STN.c2); // hand
    candleAt(c, 38, B - 39, 3);
    for (const [x, l] of [[37, 5], [35, 9], [30, 6]] as const) c.vline(x, B - 34, l, P.wax2); // wax run down
    mossTop(c, 25, B - 7, 14, 301);
    c.outline(P.ink);
    finish(c, 32, B, 9, 2);
    f.push(c);
  }
  // 1: stone bench (2 tiles): a slab on two legs, moss at its feet
  {
    const c = cell();
    box(c, 11, B - 11, 27, 4, STN);
    for (const x of [13, 32]) box(c, x, B - 8, 4, 8, STN);
    mossTop(c, 12, B - 1, 7, 302);
    c.set(22, B - 10, STN.c0); // a chip
    c.outline(P.ink);
    finish(c, 24, B, 15, 2);
    f.push(c);
  }
  // 2: dry fountain (2 tiles): a stone basin, cracked and dry, a carved flame on its spire, ivy over the rim
  {
    const c = cell();
    c.ellipse(24, B - 6, 15, 6, STN.c0);
    c.ellipse(24, B - 7, 14, 5, STN.c2);
    c.ellipse(24, B - 7, 11, 3.5, STN.c0); // the dry bowl
    c.ellipse(23, B - 7.5, 9, 2.5, mix(STN.c0, P.dark2, 0.5));
    line(c, 18, B - 8, 23, B - 6, P.dark1); // cracks in the dry bottom
    line(c, 26, B - 8, 30, B - 6, P.dark1);
    c.hline(11, B - 3, 27, STN.c1);
    c.hline(11, B - 2, 27, STN.c0);
    box(c, 22, B - 22, 5, 14, STN); // spire
    c.set(24, B - 25, STN.c2); // the stone flame
    c.hline(23, B - 24, 3, STN.c2);
    c.hline(23, B - 23, 3, STN.c1);
    ivy(c, 13, B - 9, 6, 303);
    ivy(c, 34, B - 9, 5, 304);
    mossTop(c, 12, B - 11, 24, 305);
    c.outline(P.ink);
    finish(c, 24, B, 17, 2.5);
    f.push(c);
  }
  // 3: rubble (flat): fallen stone and dust
  {
    const c = cell();
    c.ellipse(32, B - 1, 12, 2, mix(STN.c1, P.dark2, 0.4)); // dust
    for (const [x, y, rx, ry] of [[26, B - 3, 4, 2.5], [33, B - 2, 3, 2], [38, B - 3, 3.5, 2.2], [30, B - 5, 2.5, 1.8]] as const) blob(c, x, y, rx, ry, STN);
    c.set(22, B - 1, STN.c2);
    c.set(43, B - 1, STN.c2);
    c.outline(P.ink);
    f.push(c);
  }
  // 4: the fallen bell (2 tiles): bronze, on its side, cracked through, its clapper spilled out
  {
    const c = cell();
    for (let x = 10; x < 36; x++) {
      const k = (x - 10) / 25;
      const half = Math.round(4 + k * 7);
      for (let y = B - 12 - half; y <= B - 12 + half; y++) {
        const t = (y - (B - 12 - half)) / (half * 2);
        c.set(x, y, t < 0.15 ? BRONZE.c3 : t < 0.35 ? BRONZE.c2 : t > 0.82 ? BRONZE.c0 : BRONZE.c1);
      }
    }
    c.ellipse(36, B - 12, 2.5, 11, BRONZE.c0); // the mouth
    c.ellipse(37, B - 12, 1.8, 9.5, P.ink);
    for (const x of [16, 27]) c.vline(x, B - 12 - Math.round(4 + ((x - 10) / 25) * 7), Math.round(8 + ((x - 10) / 25) * 14), BRONZE.c0); // cast bands
    line(c, 22, B - 20, 26, B - 9, P.ink); // the crack
    line(c, 26, B - 9, 25, B - 4, P.ink);
    for (const [x, y] of [[14, B - 9], [20, B - 17], [31, B - 5], [29, B - 18]]) c.set(x, y, mix(P.teal2, P.teal3, 0.5)); // verdigris
    box(c, 7, B - 14, 4, 5, BRONZE); // crown loop
    blob(c, 42, B - 3, 3, 2.5, IRON); // clapper
    line(c, 39, B - 5, 36, B - 9, IRON.c1);
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 5: bell rope (hangs from above, no footprint): frayed at the end, a knot to pull on
  {
    const c = cell();
    for (let y = 0; y < B - 12; y++) {
      c.set(32, y, y % 3 === 0 ? mix(P.wax1, P.wood2, 0.5) : P.wax1);
      c.set(33, y, mix(P.wax1, P.wood1, 0.5));
    }
    blob(c, 32.5, B - 12, 2, 2, CANVAS); // the knot
    for (const x of [31, 32, 33, 34]) c.vline(x, B - 10, 2 + (x % 2), mix(P.wax1, P.wood1, 0.3)); // frayed end
    c.outline(P.ink);
    c.ellipse(32, B - 1, 2.5, 1, withAlpha(P.ink, 100));
    f.push(c);
  }
  // 6: sarcophagus (2 tiles): an effigy carved on the lid, hands folded; the lid shifted a finger's width
  {
    const c = cell();
    box(c, 9, B - 12, 30, 12, STN);
    for (const x of [15, 22, 29]) c.vline(x, B - 10, 8, STN.c0); // panels
    box(c, 8, B - 17, 32, 5, STN); // the lid
    c.hline(9, B - 16, 30, STN.c3);
    blob(c, 13, B - 15, 2.5, 2, STN); // effigy: head on a pillow
    c.rect(16, B - 16, 18, 3, STN.c2); // body
    c.hline(16, B - 14, 18, STN.c1);
    c.set(24, B - 15, STN.c0); // folded hands
    c.set(25, B - 15, STN.c0);
    line(c, 35, B - 17, 37, B - 14, STN.c3); // sword on the lid
    c.hline(38, B - 13, 2, P.ink); // the gap where the lid has moved
    mossTop(c, 9, B - 1, 8, 306);
    c.outline(P.ink);
    finish(c, 24, B, 17, 2);
    f.push(c);
  }
  // 7: bone pile (tall): skulls and long bones heaped against the wall
  {
    const c = cell();
    const r = rng(307);
    for (let i = 0; i < 12; i++) {
      const x = 22 + r() * 20;
      const y = B - 2 - r() * 10;
      line(c, x, y, x + (r() - 0.5) * 12, y - r() * 4, i % 2 ? BONE_R.c1 : BONE_R.c2);
    }
    for (const [x, y] of [[26, B - 5], [32, B - 7], [37, B - 4], [30, B - 13], [35, B - 12], [32, B - 18], [28, B - 9]] as const) skull(c, x, y);
    candleAt(c, 32, B - 20, 3); // someone left a candle on top
    c.outline(P.ink);
    finish(c, 32, B, 12, 2);
    f.push(c);
  }
  // 8: skull shelf (2 tiles, tall): stone niches, a skull in every one, a candle guttering in the middle
  {
    const c = cell();
    box(c, 9, B - 38, 30, 38, STN);
    for (let row = 0; row < 3; row++) {
      const y = B - 35 + row * 11;
      for (let col = 0; col < 4; col++) {
        const x = 12 + col * 7;
        c.rect(x, y, 5, 8, P.ink); // niche
        c.hline(x, y + 8, 5, STN.c3); // its sill
        if (row === 1 && col === 1) candleAt(c, x + 2, y + 8, 3);
        else skull(c, x + 2, y + 5, row === 0 && col === 3);
      }
    }
    mossTop(c, 9, B - 39, 30, 308);
    c.outline(P.ink);
    finish(c, 24, B, 16, 2);
    f.push(c);
  }
  // 9: bones (flat): scattered on the floor
  {
    const c = cell();
    for (const [x0, y0, x1, y1] of [[22, B - 2, 30, B - 4], [34, B - 1, 40, B - 3], [28, B - 5, 33, B - 5], [38, B - 5, 42, B - 6]] as const) {
      line(c, x0, y0 + 1, x1, y1 + 1, BONE_R.c0);
      line(c, x0, y0, x1, y1, BONE_R.c2);
      c.set(x0, y0, BONE_R.c3);
    }
    skull(c, 26, B - 5);
    c.outline(P.ink);
    f.push(c);
  }
  // 10: lectern: a great book open on it, a candle to read by
  {
    const c = cell();
    box(c, 29, B - 16, 5, 16, DWOOD);
    box(c, 26, B - 2, 11, 2, DWOOD);
    for (let y = 0; y < 5; y++) c.hline(24 + y, B - 22 + y, 16 - y, y === 0 ? DWOOD.c3 : DWOOD.c1); // sloped top
    c.rect(25, B - 25, 14, 4, P.wax2); // the open book
    c.vline(32, B - 25, 4, P.wax1);
    for (const y of [B - 24, B - 23]) {
      c.hline(26, y, 5, P.dark2);
      c.hline(33, y, 5, P.dark2);
    }
    c.rect(33, B - 24, 2, 1, P.blood2); // an illuminated capital
    c.vline(35, B - 21, 4, P.blood1); // ribbon marker
    candleAt(c, 40, B - 17, 4);
    c.outline(P.ink);
    finish(c, 32, B, 8, 2);
    f.push(c);
  }
  // 11: writing desk (2 tiles): a sloped copying desk, pages, an ink pot and quill, a candle, a stool
  {
    const c = cell();
    for (let y = 0; y < 5; y++) c.hline(10, B - 18 + y, 26, y === 0 ? DWOOD.c3 : y === 4 ? DWOOD.c0 : DWOOD.c1);
    for (const x of [11, 33]) box(c, x, B - 13, 3, 13, DWOOD);
    c.rect(14, B - 19, 8, 4, P.wax2); // pages
    c.rect(23, B - 19, 7, 4, mix(P.wax2, P.wax1, 0.5));
    for (const y of [B - 18, B - 17]) c.hline(15, y, 6, P.dark2);
    c.rect(31, B - 20, 2, 2, P.ink); // ink pot
    line(c, 32, B - 21, 35, B - 26, P.wax2); // quill
    candleAt(c, 12, B - 19, 3);
    box(c, 20, B - 7, 8, 3, WOOD); // stool
    for (const x of [21, 26]) c.vline(x, B - 4, 4, WOOD.c0);
    c.outline(P.ink);
    finish(c, 24, B, 15, 2);
    f.push(c);
  }
  // 12: scroll pile (flat): rolled scrolls and a loose page
  {
    const c = cell();
    for (const [x, y] of [[26, B - 3], [31, B - 2], [34, B - 4], [29, B - 5]] as const) {
      c.rect(x, y, 6, 2, P.wax2);
      c.hline(x, y + 1, 6, P.wax1);
      c.set(x + 5, y, CANVAS.c1); // the roll's end
      c.set(x + 2, y, P.blood1); // a seal
    }
    c.rect(38, B - 2, 4, 2, P.wax2);
    c.hline(38, B - 2, 4, P.dark2);
    c.outline(P.ink);
    f.push(c);
  }
  // 13: barrels (tall): a cask and a small keg on top, iron hoops, a tap
  {
    const c = cell();
    const cask = (cx: number, base: number, rx: number, h: number) => {
      for (let y = base - h; y < base; y++) {
        const k = (y - (base - h)) / h;
        const half = Math.round(rx * (0.85 + Math.sin(k * Math.PI) * 0.15));
        for (let x = cx - half; x <= cx + half; x++) {
          const t = (x - cx + half) / (half * 2);
          c.set(x, y, t < 0.18 ? WOOD.c3 : t < 0.35 ? WOOD.c2 : t > 0.82 ? WOOD.c0 : WOOD.c1);
        }
      }
      for (const k of [0.2, 0.8]) c.hline(cx - rx, Math.round(base - h + h * k), rx * 2 + 1, IRON.c1);
      c.ellipse(cx, base - h, rx - 1, 1.5, WOOD.c2); // the lid
    };
    cask(32, B, 8, 16);
    cask(32, B - 16, 5, 9);
    box(c, 30, B - 7, 3, 2, IRON); // tap
    c.outline(P.ink);
    finish(c, 32, B, 10, 2);
    f.push(c);
  }
  // 14: sacks: grain slumped against each other, one split
  {
    const c = cell();
    blob(c, 27, B - 6, 6, 6, CANVAS);
    blob(c, 36, B - 5, 5.5, 5, CANVAS);
    c.hline(25, B - 12, 4, WOOD.c0); // tied necks
    c.hline(34, B - 10, 4, WOOD.c0);
    for (const [x, y] of [[40, B - 1], [42, B], [41, B - 2]]) c.set(x, y, mix(P.wax1, P.wood2, 0.3)); // spilled grain
    c.outline(P.ink);
    finish(c, 32, B, 11, 2);
    f.push(c);
  }
  // 15: candle stand: a tall iron pricket, one thick candle, wax heaped at its foot
  {
    const c = cell();
    c.vline(32, B - 22, 22, IRON.c0);
    c.vline(31, B - 22, 22, IRON.c2);
    c.hline(28, B - 1, 8, IRON.c0);
    c.hline(29, B - 2, 6, IRON.c2);
    c.hline(28, B - 22, 8, IRON.c2); // drip pan
    c.hline(28, B - 21, 8, IRON.c0);
    c.rect(30, B - 28, 3, 6, P.wax2);
    c.vline(32, B - 28, 6, P.wax1);
    c.set(31, B - 29, P.ink);
    flameAt(c, 31, B - 29, 2);
    for (const x of [28, 35]) c.vline(x, B - 21, 3, P.wax2); // over the pan's edge
    c.ellipse(32, B - 1, 4, 1, P.wax1);
    c.outline(P.ink);
    finish(c, 32, B, 5, 1.5);
    f.push(c);
  }
  // 16: banner (hangs on the wall above, no footprint): the Abbey's red, a gold flame, frayed at the foot
  {
    const c = cell();
    box(c, 23, B - 36, 19, 2, WOOD); // pole
    c.set(22, B - 35, GOLD0);
    c.set(42, B - 35, GOLD0);
    for (let y = B - 34; y < B - 14; y++) {
      const inset = y > B - 18 ? y - (B - 18) : 0;
      for (let x = 25 + Math.min(inset, 7); x <= 39 - Math.min(inset, 7); x++) {
        const t = (x - 25) / 14;
        c.set(x, y, t < 0.15 ? CLOTH_RED.c3 : t < 0.3 ? CLOTH_RED.c2 : t > 0.85 ? CLOTH_RED.c0 : CLOTH_RED.c1);
      }
    }
    for (const x of [26, 38]) c.vline(x, B - 34, 17, P.flame1); // gilt edging
    // the flame
    c.set(32, B - 30, P.flame2);
    c.rect(31, B - 29, 3, 3, P.flame1);
    c.set(32, B - 28, P.flame2);
    c.hline(30, B - 25, 5, GOLD0);
    for (const x of [28, 31, 34, 36]) c.set(x, B - 15 - (x % 2), null); // frayed hem
    c.outline(P.ink);
    f.push(c);
  }
  packSheet('decor_abbey', f, W, H, B);
}

// ---------------------------------------------------------------- townsfolk (NPC sheets, 32x32, pivot 16,28)
// 12 frames: 0-1 idle (breathing), 2-3 talk (mouth, a gesture), 4-7 walk, 8-9 work (their job), 10 sit, 11 kneel.
// One body, dressed per character; a job draws its tools and moves the hands for the work frames.
type VFrame = { bob: number; mouth: boolean; step: number; pose: 'stand' | 'sit' | 'kneel'; kind: 'idle' | 'talk' | 'walk' | 'work' | 'sit' | 'kneel'; k: number };
interface VillagerSpec {
  cloth: Ramp; // coat, robe or habit
  long: boolean; // robe to the ankles (else a tunic over legs)
  legs: RGBA;
  skin: RGBA;
  head: 'bald' | 'hood' | 'kerchief' | 'veil' | 'cap' | 'hair';
  headCol: RGBA;
  beard?: RGBA;
  apron?: RGBA;
  child?: boolean;
  wide?: number; // extra shoulder width
  /** Pose for the work frames (a harper plays sitting down). */
  workPose?: 'stand' | 'sit';
  /** Hands for this frame (null: at the sides) and anything held or worn on top. */
  job?: (c: Img, f: VFrame, g: { cx: number; top: number; body: number; waist: number; feet: number }) => { l?: [number, number]; r?: [number, number] } | void;
}

function drawVillager(c: Img, s: VillagerSpec, f: VFrame) {
  const small = !!s.child;
  const cx = 16;
  const drop = f.pose === 'sit' ? 5 : f.pose === 'kneel' ? 4 : 0;
  const feet = 27;
  const top = (small ? 11 : 5) + f.bob + drop; // top of the head
  const body = top + (small ? 6 : 8); // shoulders
  const waist = body + (small ? 5 : 7);
  const half = (small ? 4 : 5) + (s.wide ?? 0);
  const sk = { c1: s.skin, c0: mix(s.skin, P.wood1, 0.35), c2: mix(s.skin, P.wax2, 0.35) };
  c.ellipse(16, 27.5, small ? 5 : 7, 1.5, withAlpha(P.ink, 80)); // feet shadow
  // legs / feet
  if (f.pose === 'stand') {
    const lift = (i: number) => (f.step === (i ? 3 : 1) ? 2 : 0);
    for (const [i, x] of [[0, cx - 3], [1, cx + 1]] as const) {
      const h = feet - waist;
      c.rect(x, waist + (s.long ? h - 3 : 0), 2, s.long ? 3 - lift(i) : h - lift(i), i ? mix(s.legs, P.ink, 0.3) : s.legs);
      c.rect(x - (i ? 0 : 1), feet - lift(i) - 1, 3, 2, i ? DWOOD.c0 : DWOOD.c1); // shoes
    }
  } else if (f.pose === 'sit') {
    c.rect(cx - 4, feet - 3, 9, 2, s.legs); // legs out in front
    c.rect(cx + 4, feet - 3, 2, 3, DWOOD.c1);
  } else {
    c.rect(cx - 4, feet - 2, 7, 2, s.legs); // folded, kneeling
    c.rect(cx - 5, feet - 2, 2, 2, DWOOD.c1);
  }
  // body: robe (a bell to the ankles) or tunic (to the hips)
  const bottom = s.long ? feet - (f.pose === 'stand' ? 3 : 1) : waist + 3;
  for (let y = body; y <= bottom; y++) {
    const k = (y - body) / Math.max(1, bottom - body);
    const w = half + Math.round(k * (s.long ? 2 : 1));
    const sway = y > waist && f.kind === 'walk' ? (f.step % 2 ? 1 : 0) : 0;
    for (let x = cx - w + sway; x < cx + w + sway; x++) {
      const t = (x - (cx - w + sway)) / (w * 2 - 1);
      c.set(x, y, t < 0.15 ? s.cloth.c3 : t < 0.3 ? s.cloth.c2 : t > 0.85 ? s.cloth.c0 : s.cloth.c1);
    }
  }
  c.hline(cx - half, waist, half * 2, mix(s.cloth.c0, P.wood1, 0.4)); // belt
  if (s.apron) {
    for (let y = waist - 3; y <= bottom - 1; y++) c.hline(cx - 3, y, 6, s.apron);
    c.vline(cx - 3, waist - 3, bottom - waist + 3, mix(s.apron, P.white, 0.25));
  }
  // job: hands and held things
  const hands = (s.job?.(c, f, { cx, top, body, waist, feet }) ?? {}) as { l?: [number, number]; r?: [number, number] };
  const swing = f.kind === 'walk' ? (f.step === 1 ? 2 : f.step === 3 ? -2 : 0) : 0;
  const talkWave = f.kind === 'talk' && f.k === 1 ? -3 : 0;
  const L: [number, number] = hands.l ?? [cx - half - 1, waist + 1 + swing];
  const R: [number, number] = hands.r ?? [cx + half, waist + 1 - swing + talkWave];
  for (const [side, h] of [[-1, L], [1, R]] as const) {
    const sx = cx + side * (half - 1);
    line(c, sx, body + 1, h[0], h[1] - 1, side < 0 ? s.cloth.c2 : s.cloth.c0);
    line(c, sx + (side < 0 ? 1 : -1), body + 1, h[0] + (side < 0 ? 1 : -1), h[1] - 1, s.cloth.c1);
    c.set(h[0], h[1], sk.c1);
  }
  // head
  const hr = small ? 3 : 3.6;
  const hy = top + hr;
  c.disc(cx, hy, hr, sk.c1);
  c.set(cx - 2, hy - 2, sk.c2);
  c.set(cx + 2, hy + 1, sk.c0);
  // hair / headwear
  switch (s.head) {
    case 'bald':
      c.set(cx - 1, top, sk.c2);
      break;
    case 'hair':
      c.hline(cx - 3, top, 6, s.headCol);
      c.hline(cx - 4, top + 1, 8, s.headCol);
      c.vline(cx - 4, top + 1, 3, s.headCol);
      c.vline(cx + 3, top + 1, 2, s.headCol);
      break;
    case 'cap':
      c.hline(cx - 3, top - 1, 6, s.headCol);
      c.hline(cx - 4, top, 9, s.headCol);
      c.set(cx + 4, top + 1, s.headCol); // brim
      c.set(cx - 2, top - 1, mix(s.headCol, P.white, 0.3));
      break;
    case 'kerchief':
      c.hline(cx - 3, top, 7, s.headCol);
      c.hline(cx - 4, top + 1, 9, s.headCol);
      c.set(cx - 3, top, mix(s.headCol, P.white, 0.3));
      c.set(cx + 4, top + 3, s.headCol); // knot
      c.set(cx + 5, top + 4, s.headCol);
      break;
    case 'hood':
    case 'veil': {
      const col = s.headCol;
      c.hline(cx - 3, top - 1, 7, col);
      c.vline(cx - 4, top, 7, col);
      c.vline(cx + 4, top, 7, mix(col, P.ink, 0.3));
      c.hline(cx - 3, top, 7, col);
      if (s.head === 'veil') {
        c.hline(cx - 3, top + 1, 7, P.wax2); // wimple band
        c.vline(cx - 3, top + 2, 5, P.wax2);
        c.vline(cx + 3, top + 2, 5, P.wax1);
        c.hline(cx - 2, top + 7, 5, P.wax2);
      }
      break;
    }
  }
  if (s.beard) {
    c.hline(cx - 3, hy + 1, 7, s.beard);
    c.hline(cx - 2, hy + 2, 5, s.beard);
    c.hline(cx - 1, hy + 3, 3, mix(s.beard, P.ink, 0.2));
  }
  // face: eyes, and the mouth when talking
  const ey = hy - (s.head === 'veil' ? 0 : 1);
  if (f.pose !== 'kneel' || f.kind !== 'kneel') {
    c.set(cx - 1, ey, P.ink);
    c.set(cx + 2, ey, P.ink);
  } else {
    c.set(cx - 1, ey, sk.c0); // eyes closed in prayer
    c.set(cx + 2, ey, sk.c0);
  }
  if (f.mouth) c.set(cx, hy + (s.beard ? 1 : 2), P.blood1);
  c.outline(P.ink);
}

function villagerSheet(name: string, s: VillagerSpec) {
  const frames: VFrame[] = [
    { bob: 0, mouth: false, step: -1, pose: 'stand', kind: 'idle', k: 0 },
    { bob: 1, mouth: false, step: -1, pose: 'stand', kind: 'idle', k: 1 },
    { bob: 0, mouth: true, step: -1, pose: 'stand', kind: 'talk', k: 0 },
    { bob: 0, mouth: false, step: -1, pose: 'stand', kind: 'talk', k: 1 },
    ...[0, 1, 2, 3].map(i => ({ bob: i % 2 ? -1 : 0, mouth: false, step: i, pose: 'stand' as const, kind: 'walk' as const, k: i })),
    { bob: 0, mouth: false, step: -1, pose: 'stand', kind: 'work', k: 0 },
    { bob: 0, mouth: false, step: -1, pose: 'stand', kind: 'work', k: 1 },
    { bob: 0, mouth: false, step: -1, pose: 'sit', kind: 'sit', k: 0 },
    { bob: 0, mouth: false, step: -1, pose: 'kneel', kind: 'kneel', k: 0 },
  ];
  const img = new Img(32 * frames.length, 32);
  frames.forEach((f, i) => {
    const c = new Img(32, 32);
    drawVillager(c, s, f.kind === 'work' && s.workPose ? { ...f, pose: s.workPose } : f);
    img.blit(c, i * 32, 0);
  });
  sheet(name, img, { cell: [32, 32], pivot: [16, 28], layer: 'single' });
}

function genTownsfolk() {
  const skin = mix(P.wax1, P.wood2, 0.35);
  const pale = mix(P.wax2, P.wax1, 0.5);
  const oldSkin = mix(P.wax1, P.stone3, 0.3);
  const grey: Ramp = { c0: P.stone1, c1: P.stone2, c2: P.stone3, c3: P.stone4 };
  const rags: Ramp = { c0: DWOOD.c0, c1: P.wood1, c2: P.wood2, c3: mix(P.wood2, P.wax1, 0.3) };
  const teal: Ramp = { c0: P.teal1, c1: mix(P.teal1, P.teal2, 0.5), c2: P.teal2, c3: P.teal3 };
  const moss: Ramp = { c0: mix(P.moss1, P.ink, 0.35), c1: P.moss1, c2: P.moss2, c3: mix(P.moss2, P.wax1, 0.35) };
  const black: Ramp = { c0: P.ink, c1: P.dark1, c2: P.dark2, c3: P.stone1 };

  // Oskar: a big convict in rags, broken shackles still on his wrists; he counts his takings at the stall.
  villagerSheet('npc_oskar', {
    cloth: rags, long: false, legs: P.dark2, skin, head: 'bald', headCol: skin, beard: P.dark2, wide: 1,
    job: (c, f, g) => {
      if (f.kind === 'work') {
        const l: [number, number] = [g.cx - 2, g.waist - 1];
        const r: [number, number] = [g.cx + 3, g.waist - 2 - f.k];
        c.set(r[0], r[1] - 1, P.flame2); // a coin held up to the light
        c.set(l[0] + 1, l[1], P.flame1);
        return { l, r };
      }
      for (const x of [g.cx - 7, g.cx + 6]) c.rect(x, g.waist, 2, 1, IRON.c2); // shackles
    },
  });
  // Sister Maudlin: grey habit and white wimple; she tends the shrine's candles with a taper.
  villagerSheet('npc_maudlin', {
    cloth: grey, long: true, legs: P.dark2, skin: pale, head: 'veil', headCol: P.dark1,
    job: (c, f, g) => {
      c.set(g.cx, g.body + 3, P.flame1); // a small flame on a cord at her breast
      if (f.kind === 'work') {
        const r: [number, number] = [g.cx + 8, g.body + 2 - f.k];
        line(c, r[0], r[1], r[0] + 2, r[1] - 3, P.wax2); // the taper
        c.set(r[0] + 2, r[1] - 4, P.flame2);
        c.set(r[0] + 2, r[1] - 5, P.flame1);
        return { r };
      }
    },
  });
  // Pip: small, a cloak too big for them, always a candle stub in hand.
  villagerSheet('npc_pip', {
    cloth: teal, long: true, legs: P.dark2, skin: pale, head: 'hood', headCol: P.teal1, child: true,
    job: (c, f, g) => {
      const r: [number, number] = f.kind === 'work' ? [g.cx + 3, g.body + 1 - f.k] : f.kind === 'sit' ? [g.cx + 2, g.waist - 1] : [g.cx + 5, g.waist];
      c.vline(r[0], r[1] - 3, 3, P.wax2);
      c.set(r[0], r[1] - 4, P.flame2);
      return { r };
    },
  });
  // Tomas the lamplighter: an old man in a long coat and cap, a pole with a little flame on its hook.
  villagerSheet('npc_tomas', {
    cloth: { c0: mix(P.moss1, P.ink, 0.5), c1: mix(P.moss1, P.stone1, 0.5), c2: mix(P.moss2, P.stone2, 0.5), c3: mix(P.moss2, P.stone3, 0.5) },
    long: true, legs: P.dark2, skin: oldSkin, head: 'cap', headCol: P.dark2, beard: P.stone4,
    job: (c, f, g) => {
      const up = f.kind === 'work';
      const r: [number, number] = up ? [g.cx + 6, g.body - 1 - f.k] : [g.cx + 6, g.waist];
      const tipY = up ? 0 : g.top - 6;
      const tipX = up ? r[0] + 3 : r[0] + 1;
      line(c, r[0] - (up ? 1 : 0), Math.min(g.feet - 1, r[1] + 5), tipX, tipY + 2, P.wood2); // the pole
      c.set(tipX + 1, tipY + 1, IRON.c2); // its hook
      c.set(tipX, tipY, up && f.k ? P.flame2 : P.flame1); // the wick
      if (up && f.k) c.set(tipX, tipY + 1, P.flame1);
      return { r };
    },
  });
  // Hedda the water-carrier: a red kerchief, a yoke across her shoulders and two buckets.
  villagerSheet('npc_hedda', {
    cloth: { c0: mix(P.teal1, P.ink, 0.3), c1: mix(P.teal1, P.stone2, 0.5), c2: mix(P.teal2, P.stone3, 0.5), c3: mix(P.teal3, P.stone4, 0.5) },
    long: true, legs: P.dark2, skin, head: 'kerchief', headCol: P.blood2, apron: mix(P.wax1, P.stone3, 0.3),
    job: (c, f, g) => {
      if (f.kind === 'work') {
        // drawing water: one bucket lowered and raised, the yoke set down
        const r: [number, number] = [g.cx + 6, g.waist + 3 - f.k * 4];
        box(c, r[0] - 1, r[1] + 1, 4, 4, WOOD);
        c.hline(r[0], r[1] + 1, 2, P.teal2);
        return { r, l: [g.cx - 6, g.waist + 1] };
      }
      if (f.pose !== 'stand') return;
      c.hline(g.cx - 9, g.body, 19, P.wood2); // the yoke
      c.hline(g.cx - 9, g.body + 1, 19, P.wood1);
      for (const x of [g.cx - 9, g.cx + 9]) {
        const sway = f.kind === 'walk' ? (f.step % 2 ? 1 : -1) * (x < g.cx ? 1 : -1) : 0;
        c.vline(x, g.body + 1, 4, P.wax1); // ropes
        box(c, x - 2 + sway, g.body + 5, 4, 5, WOOD);
        c.hline(x - 1 + sway, g.body + 5, 2, P.teal2); // water
      }
      return { l: [g.cx - 7, g.body + 1], r: [g.cx + 7, g.body + 1] };
    },
  });
  // Bede the woodcutter: broad, sleeves rolled, an axe on his shoulder; at the block he splits logs.
  villagerSheet('npc_bede', {
    cloth: moss, long: false, legs: P.wood1, skin, head: 'hair', headCol: P.wood1, beard: P.wood1, wide: 1,
    job: (c, f, g) => {
      if (f.kind === 'work') {
        // axe raised high, then brought down
        const r: [number, number] = f.k === 0 ? [g.cx + 3, g.top - 1] : [g.cx + 8, g.waist + 1];
        const head: [number, number] = f.k === 0 ? [g.cx + 1, g.top - 6] : [g.cx + 12, g.waist + 3];
        line(c, r[0], r[1], head[0], head[1], P.wood2);
        box(c, head[0] - 1, head[1] - 1, 3, 3, IRON);
        if (f.k === 1) {
          c.set(g.cx + 14, g.waist + 1, P.wax1); // chips flying
          c.set(g.cx + 11, g.waist, P.wood2);
        }
        return { r, l: [r[0] - 2, r[1] + 1] };
      }
      if (f.pose !== 'stand') return;
      const r: [number, number] = [g.cx + 6, g.body + 2];
      line(c, r[0], r[1] + 3, r[0] - 3, r[1] - 6, P.wood2); // axe on his shoulder
      box(c, r[0] - 5, r[1] - 8, 3, 3, IRON);
      return { r };
    },
  });
  // Ulla: a pilgrim wife in a brown shawl who keeps the west camp's fire going, poking it with a stick.
  villagerSheet('npc_ulla', {
    cloth: { c0: mix(P.wood1, P.ink, 0.3), c1: mix(P.wood1, P.stone2, 0.4), c2: mix(P.wood2, P.stone3, 0.4), c3: mix(P.wood2, P.wax1, 0.4) },
    long: true, legs: P.dark2, skin, head: 'kerchief', headCol: mix(P.moss1, P.stone2, 0.4), apron: mix(P.wax1, P.stone3, 0.4),
    job: (c, f, g) => {
      if (f.kind !== 'work') return;
      const r: [number, number] = [g.cx + 6, g.waist - 1 + f.k];
      line(c, r[0], r[1], r[0] + 5, r[1] + 5 - f.k * 2, P.wood1); // the poker
      if (f.k) c.set(r[0] + 6, r[1] + 4, P.ember);
      return { r };
    },
  });
  // Jost: her husband, an old pilgrim with a walking staff and a scallop badge, mostly sitting by the fire.
  villagerSheet('npc_jost', {
    cloth: { c0: mix(P.stone1, P.ink, 0.3), c1: P.stone2, c2: P.stone3, c3: mix(P.stone3, P.wax1, 0.4) },
    long: true, legs: P.dark2, skin: oldSkin, head: 'hood', headCol: mix(P.wood1, P.stone2, 0.3), beard: mix(P.stone4, P.wax1, 0.3),
    job: (c, f, g) => {
      c.set(g.cx - 2, g.body + 3, P.wax2); // scallop badge
      c.set(g.cx - 1, g.body + 3, P.wax1);
      if (f.kind === 'sit') {
        line(c, g.cx + 6, g.feet - 1, g.cx + 9, g.top - 1, P.wood2); // staff leaned on his shoulder
        return { r: [g.cx + 6, g.waist] };
      }
      c.vline(g.cx + 7, g.top + 1, g.feet - g.top - 1, P.wood2);
      return { r: [g.cx + 7, g.waist - 2] };
    },
  });
  // Old Agnes: a pilgrim in a black shawl who prays at the shrine.
  villagerSheet('npc_agnes', {
    cloth: black, long: true, legs: P.dark2, skin: oldSkin, head: 'hood', headCol: P.dark1,
    job: (c, f, g) => {
      if (f.kind === 'kneel' || f.kind === 'work') {
        const y = g.body + 3 - (f.kind === 'work' && f.k ? 2 : 0);
        c.set(g.cx + 1, y + 1, P.wood2); // prayer beads
        return { l: [g.cx - 1, y], r: [g.cx + 1, y] };
      }
      c.vline(g.cx + 7, g.waist - 3, g.feet - g.waist + 3, P.wood1); // walking stick
      return { r: [g.cx + 7, g.waist - 2] };
    },
  });

  // ---- keepers of the safe places out in the world
  // Brother Lome: a hermit in a patched brown habit who keeps the candle cairns on the Hill of Candles lit.
  villagerSheet('npc_lome', {
    cloth: { c0: mix(P.wood1, P.ink, 0.45), c1: mix(P.wood1, P.stone1, 0.3), c2: mix(P.wood2, P.stone2, 0.4), c3: mix(P.wood2, P.wax1, 0.3) },
    long: true, legs: P.dark2, skin: oldSkin, head: 'hood', headCol: mix(P.wood1, P.ink, 0.3), beard: P.stone3,
    job: (c, f, g) => {
      c.set(g.cx - 3, g.waist + 3, P.wax1); // a patch
      c.set(g.cx - 2, g.waist + 4, P.wax1);
      if (f.kind === 'work') {
        // stooping to set a candle and light it
        const r: [number, number] = [g.cx + 7, g.waist + 3];
        c.vline(r[0] + 1, r[1] - 3, 3, P.wax2);
        c.set(r[0] + 1, r[1] - 4, f.k ? P.flame2 : P.ember);
        if (f.k) c.set(r[0] + 1, r[1] - 5, P.flame1);
        return { r, l: [g.cx + 4, g.waist + 1] };
      }
      // a basket of candle stubs on his arm
      c.rect(g.cx - 8, g.waist, 4, 3, P.wood2);
      c.hline(g.cx - 8, g.waist, 4, P.wood1);
      c.set(g.cx - 7, g.waist - 1, P.wax2);
      c.set(g.cx - 5, g.waist - 1, P.wax1);
      return { l: [g.cx - 6, g.waist - 1] };
    },
  });
  // Wenna: a mire-woman in a moss-green shawl who fishes the chapel's wax pools for eels with a long rod.
  villagerSheet('npc_wenna', {
    cloth: moss, long: true, legs: P.dark2, skin: mix(skin, P.moss2, 0.15), head: 'hair', headCol: mix(P.dark2, P.moss1, 0.3),
    job: (c, f, g) => {
      c.rect(g.cx - 6, g.waist + 3, 3, 3, mix(P.wood1, P.moss1, 0.3)); // a creel at her hip
      if (f.kind === 'work' || f.kind === 'sit') {
        // the rod out over the water, the line bobbing
        const r: [number, number] = [g.cx + 5, g.waist - 1];
        const tip: [number, number] = [r[0] + 10, r[1] - 9];
        line(c, r[0] - 1, r[1] + 2, tip[0], tip[1], P.wood2);
        const bob = f.kind === 'work' ? f.k : 0;
        for (let y = tip[1] + 1; y < g.feet - 1 + bob; y++) c.set(tip[0], y, withAlpha(P.stone4, 170));
        c.set(tip[0], g.feet - 1 + bob, P.blood2); // the float
        return { r, l: [g.cx + 3, g.waist + 1] };
      }
    },
  });
  // Fennick: the Works' last clerk, bald, in a black coat and spectacles, still keeping the ledger.
  villagerSheet('npc_fennick', {
    cloth: black, long: true, legs: P.dark2, skin: pale, head: 'bald', headCol: pale,
    job: (c, f, g) => {
      const ey = g.top + 3;
      c.set(g.cx - 1, ey - 1, P.wax2); // spectacles glint
      c.set(g.cx + 2, ey - 1, P.wax2);
      c.hline(g.cx - 3, g.body + 1, 6, P.wax1); // a collar
      if (f.kind === 'work') {
        // writing: the ledger held open, the quill scratching
        c.rect(g.cx - 4, g.waist - 3, 7, 4, P.wax1);
        c.vline(g.cx - 1, g.waist - 3, 4, P.stone3);
        c.set(g.cx - 3 + f.k * 2, g.waist - 1, P.ink);
        const r: [number, number] = [g.cx + 1 + f.k, g.waist - 2];
        line(c, r[0], r[1], r[0] + 3, r[1] - 5, P.wax2); // the quill
        return { r, l: [g.cx - 5, g.waist - 1] };
      }
      c.rect(g.cx - 8, g.waist - 1, 3, 5, P.blood1); // the ledger under his arm
      c.vline(g.cx - 8, g.waist - 1, 5, P.blood2);
      return { l: [g.cx - 6, g.waist] };
    },
  });
  // Brother Aldous: a Warden who threw down his spear. Mail and a torn red tabard, no helm; the wax has his left
  // cheek and shoulder already. He hides in the Scriptorium with his back to the shelves, hugging his knees.
  villagerSheet('npc_aldous', {
    cloth: { c0: EN.steel0, c1: EN.steel1, c2: EN.steel2, c3: EN.steel3 },
    long: false, legs: EN.steel1, skin: pale, head: 'bald', headCol: pale, beard: mix(P.stone3, P.wax1, 0.3),
    job: (c, f, g) => {
      c.rect(g.cx - 2, g.body + 1, 4, g.waist - g.body + 2, P.blood1); // the tabard, torn at the hem
      c.vline(g.cx - 2, g.body + 1, g.waist - g.body + 2, P.blood2);
      c.set(g.cx + 1, g.waist + 2, null);
      c.set(g.cx, g.body + 3, P.flame1); // the Abbey's flame, half picked off
      // the wax: over the left of his face, down the neck, across the shoulder
      for (const [dx, dy] of [[-3, 1], [-3, 2], [-2, 2], [-3, 3], [-2, 3], [-3, 4], [-2, 5], [-4, 6], [-5, 7], [-4, 8], [-6, 8], [-5, 9]])
        c.set(g.cx + dx, g.top + dy, dy > 6 ? P.wax1 : P.wax2);
      c.vline(g.cx - 5, g.body + 2, 3, P.wax1); // a run down the arm
      if (f.kind === 'work') {
        // rubbing salt into the wax, shaking
        const l: [number, number] = [g.cx - 4 + f.k, g.top + 5];
        c.set(l[0], l[1] - 1, P.white);
        return { l };
      }
    },
  });
  // Brother Cuthwin: a young novice with a tonsure in an undyed habit, forever sweeping the Abbey porch.
  villagerSheet('npc_cuthwin', {
    cloth: { c0: mix(P.stone2, P.wood1, 0.4), c1: mix(P.stone3, P.wood2, 0.35), c2: mix(P.stone3, P.wax1, 0.35), c3: mix(P.stone4, P.wax1, 0.4) },
    long: true, legs: P.dark2, skin: pale, head: 'hair', headCol: mix(P.wood1, P.flame1, 0.25),
    job: (c, f, g) => {
      c.set(g.cx, g.top, pale); // the tonsure
      c.set(g.cx - 1, g.top, pale);
      c.hline(g.cx - 1, g.waist, 3, P.wood1); // a rope belt
      c.vline(g.cx + 1, g.waist + 1, 3, P.wood1);
      if (f.kind === 'walk' || f.kind === 'idle' || f.kind === 'talk') {
        // the broom carried upright
        c.vline(g.cx + 7, g.body - 3, g.feet - g.body + 1, P.wood2);
        c.rect(g.cx + 6, g.feet - 3, 3, 3, P.flame1);
        return { r: [g.cx + 6, g.waist] };
      }
      if (f.kind === 'work') {
        // sweeping: the broom head swings across the floor
        const sw = f.k ? 4 : -2;
        const r: [number, number] = [g.cx + 3, g.waist];
        line(c, r[0], r[1] - 4, g.cx + 6 + sw, g.feet - 2, P.wood2);
        c.rect(g.cx + 4 + sw, g.feet - 2, 5, 2, P.flame1);
        c.hline(g.cx + 4 + sw, g.feet, 5, mix(P.flame1, P.wood1, 0.5));
        if (f.k) c.set(g.cx + 11, g.feet - 1, P.stone3); // dust
        return { r, l: [g.cx + 1, g.waist - 3] };
      }
    },
  });
  // Wren: a travelling harper in a faded red cloak and a feathered cap, who sits by the south road and plays.
  villagerSheet('npc_wren', {
    cloth: { c0: mix(P.blood1, P.ink, 0.4), c1: mix(P.blood1, P.stone2, 0.35), c2: mix(P.blood2, P.stone3, 0.4), c3: mix(P.blood2, P.wax1, 0.35) },
    long: true, legs: P.dark2, skin, head: 'cap', headCol: mix(P.moss1, P.stone1, 0.3), workPose: 'sit',
    job: (c, f, g) => {
      c.set(g.cx - 3, g.top - 2, P.wax2); // a feather in the cap
      c.set(g.cx - 4, g.top - 3, P.wax1);
      c.set(g.cx - 5, g.top - 4, P.wax1);
      const harp = (x: number, y: number, h: number) => {
        // a small lap harp: a curved neck, a pillar, a sounding box, strings
        line(c, x, y, x, y - h, P.wood2); // pillar (front)
        line(c, x, y - h, x + 3, y - h + 1, P.wood2); // neck curving back
        line(c, x + 3, y - h + 1, x + 6, y - h + 3, P.wood1);
        line(c, x + 6, y - h + 3, x + 6, y, P.wood1); // sounding box
        c.vline(x + 7, y - h + 4, h - 4, mix(P.wood1, P.ink, 0.3));
        for (let sx = x + 1; sx <= x + 5; sx += 2) c.vline(sx, y - h + 2 + Math.floor((sx - x) / 2), h - 2 - Math.floor((sx - x) / 2), withAlpha(P.wax2, 200)); // strings
        c.hline(x, y, 7, P.wood1);
      };
      if (f.kind === 'work') {
        // seated, the harp on her knee, both hands in the strings
        harp(g.cx + 2, g.waist + 3, 11);
        const pl = f.k ? 1 : -1;
        return { l: [g.cx + 3, g.waist - 3 + pl], r: [g.cx + 6, g.waist - 1 - pl] };
      }
      // carried on her back when she walks or stands
      harp(g.cx - 9, g.waist + 1, 10);
    },
  });
  // Old Hobb: a beggar in rags and a battered cap who sits by the Abbey porch with a bowl.
  villagerSheet('npc_hobb', {
    cloth: rags, long: false, legs: mix(P.dark2, P.wood1, 0.3), skin: oldSkin, head: 'cap', headCol: mix(P.teal1, P.ink, 0.3), beard: mix(P.stone3, P.wood1, 0.3),
    job: (c, f, g) => {
      c.set(g.cx + 2, g.waist - 3, P.wax1); // a hole in his coat
      if (f.kind === 'work' || f.kind === 'sit') {
        // the bowl held out (rattled when he works)
        const up = f.kind === 'work' ? f.k : 0;
        const r: [number, number] = [g.cx + 6, g.waist - up];
        c.rect(r[0], r[1] - 2, 4, 2, P.wood2);
        c.hline(r[0] - 1, r[1] - 2, 6, P.wood1);
        if (up) c.set(r[0] + 2, r[1] - 3, P.flame2); // a coin jumps
        return { r };
      }
      c.vline(g.cx + 7, g.waist - 3, g.feet - g.waist + 3, P.wood1); // a crutch
      c.hline(g.cx + 6, g.waist - 3, 3, P.wood1);
      return { r: [g.cx + 7, g.waist - 2] };
    },
  });
}

// ---------------------------------------------------------------- critters (16x16 cells, pivot 8,14; facing right)
// Small life that wanders the world and flees from the player (world/Ambience.ts):
// 0-3 rat (idle, sniff, run a/b), 4-7 crow (idle, peck, fly a/b), 8-11 frog (sit, croak, hop a/b),
// 12-13 moth (wings up/down), 14-17 cat (sit, tail flick, walk a/b), 18-19 bat (wings up/down).
function genCritters() {
  const N = 20;
  const img = new Img(16 * N, 16);
  const cell = (i: number, draw: (c: Img) => void, shadow = true) => {
    const c = new Img(16, 16);
    if (shadow) c.ellipse(8, 14.5, 4, 1, withAlpha(P.ink, 70));
    draw(c);
    c.outline(P.ink);
    img.blit(c, i * 16, 0);
  };
  const fur = { c0: mix(P.stone1, P.wood1, 0.5), c1: mix(P.stone2, P.wood1, 0.4), c2: mix(P.stone3, P.wood2, 0.4) };
  // rat: a low grey-brown body, pink tail and nose
  const rat = (c: Img, k: 'idle' | 'sniff' | 'runA' | 'runB') => {
    const up = k === 'sniff' ? 1 : 0;
    const stretch = k === 'runA' ? 1 : k === 'runB' ? -1 : 0;
    c.ellipse(7, 12, 3.5 + stretch * 0.5, 2, fur.c1);
    c.hline(5, 10, 4, fur.c2);
    c.disc(11 + stretch, 11 - up, 1.6, fur.c1); // head
    c.set(13 + stretch, 11 - up, mix(P.blood1, P.wax1, 0.5)); // nose
    c.set(11 + stretch, 9 - up, mix(P.blood1, P.wax1, 0.4)); // ear
    c.set(11 + stretch, 10 - up, P.ink); // eye
    line(c, 3, 12, 1, 13 - (k === 'runB' ? 1 : 0), mix(P.blood1, P.wax1, 0.45)); // tail
    c.set(0, 12 + (k === 'runA' ? 1 : 0), mix(P.blood1, P.wax1, 0.45));
    const legs = k === 'runA' ? [5, 10] : k === 'runB' ? [7, 8] : [5, 9];
    for (const x of legs) c.set(x, 14, fur.c0);
  };
  cell(0, c => rat(c, 'idle'));
  cell(1, c => rat(c, 'sniff'));
  cell(2, c => rat(c, 'runA'));
  cell(3, c => rat(c, 'runB'));
  // crow: black with a blue-grey sheen, a dark beak
  const crowBody = (c: Img, peck: boolean) => {
    c.ellipse(7, 10, 3, 2.5, P.dark1);
    c.hline(5, 9, 4, P.stone1);
    line(c, 3, 10, 1, 12, P.dark1); // tail
    const hx = peck ? 11 : 10, hy = peck ? 11 : 7;
    c.disc(hx, hy, 1.6, P.dark1);
    c.set(hx, hy - 1, P.stone1);
    c.set(hx + 2, hy, P.stone2); // beak
    if (!peck) c.set(hx + 3, hy, P.stone2);
    c.set(hx, hy, P.flame2); // a bright eye
    for (const x of [6, 8]) c.vline(x, 12, 2, P.stone2);
  };
  cell(4, c => crowBody(c, false));
  cell(5, c => crowBody(c, true));
  const crowFly = (c: Img, up: boolean) => {
    c.ellipse(8, 7, 3, 1.6, P.dark1);
    c.disc(11, 6, 1.4, P.dark1);
    c.set(13, 6, P.stone2);
    line(c, 5, 7, 3, 8, P.dark1);
    if (up) {
      line(c, 7, 6, 4, 1, P.dark1);
      line(c, 8, 6, 6, 1, P.stone1);
    } else {
      line(c, 7, 8, 4, 12, P.dark1);
      line(c, 8, 8, 7, 12, P.stone1);
    }
  };
  cell(6, c => crowFly(c, true), false);
  cell(7, c => crowFly(c, false), false);
  // frog: squat and mottled green, a pale throat that swells when it croaks
  const frog = (c: Img, k: 'sit' | 'croak' | 'hopA' | 'hopB') => {
    const lift = k === 'hopA' ? 3 : k === 'hopB' ? 1 : 0;
    const g0 = mix(P.moss1, P.ink, 0.2);
    c.ellipse(8, 12 - lift, 3, 2, P.moss1);
    c.set(7, 11 - lift, P.moss2);
    c.set(9, 12 - lift, g0);
    c.set(10, 10 - lift, P.moss2); // eye bump
    c.set(10, 10 - lift, P.flame2);
    if (k === 'croak') c.disc(11, 13, 1.5, mix(P.wax1, P.moss2, 0.3));
    if (k === 'hopA') {
      line(c, 6, 13 - lift, 4, 13, g0); // legs trailing
    } else if (k === 'hopB') {
      line(c, 10, 13 - lift, 12, 14, g0);
    } else {
      c.hline(5, 14, 2, g0);
      c.hline(9, 14, 2, g0);
    }
  };
  cell(8, c => frog(c, 'sit'));
  cell(9, c => frog(c, 'croak'));
  cell(10, c => frog(c, 'hopA'));
  cell(11, c => frog(c, 'hopB'));
  // moth: a pale dusty speck with two wings
  cell(12, c => {
    c.set(8, 8, P.wood1);
    c.set(7, 7, P.wax1);
    c.set(9, 7, P.wax1);
    c.set(6, 6, P.wax2);
    c.set(10, 6, P.wax2);
  }, false);
  cell(13, c => {
    c.set(8, 8, P.wood1);
    c.hline(6, 8, 2, P.wax1);
    c.hline(9, 8, 2, P.wax1);
  }, false);
  // cat: a thin tabby
  const tabby = { c0: mix(P.wood1, P.ink, 0.3), c1: mix(P.wood2, P.flame1, 0.25), c2: mix(P.wood2, P.wax1, 0.35) };
  const catSit = (c: Img, flick: boolean) => {
    c.ellipse(7, 11, 3, 3, tabby.c1);
    c.vline(6, 9, 4, tabby.c0); // stripes
    c.disc(9, 6, 2.2, tabby.c1);
    c.set(8, 4, tabby.c1);
    c.set(8, 3, tabby.c0);
    c.set(10, 4, tabby.c1);
    c.set(10, 3, tabby.c0);
    c.set(10, 6, P.moss2);
    c.set(8, 6, P.moss2);
    c.hline(8, 13, 3, tabby.c2);
    if (flick) line(c, 4, 13, 2, 10, tabby.c1);
    else line(c, 4, 13, 1, 13, tabby.c1);
  };
  cell(14, c => catSit(c, false));
  cell(15, c => catSit(c, true));
  const catWalk = (c: Img, a: boolean) => {
    c.ellipse(7, 10, 4, 2, tabby.c1);
    c.vline(6, 9, 2, tabby.c0);
    c.vline(8, 9, 2, tabby.c0);
    c.disc(12, 8, 2, tabby.c1);
    c.set(11, 6, tabby.c0);
    c.set(13, 6, tabby.c0);
    c.set(13, 8, P.moss2);
    line(c, 3, 9, 1, 6, tabby.c1);
    for (const x of a ? [4, 10] : [6, 8]) c.vline(x, 12, 2, tabby.c0);
  };
  cell(16, c => catWalk(c, true));
  cell(17, c => catWalk(c, false));
  // bat: leathery wings
  const bat = (c: Img, up: boolean) => {
    c.ellipse(8, 7, 1.5, 2, P.dark2);
    c.set(7, 5, P.dark2);
    c.set(9, 5, P.dark2);
    c.set(8, 6, P.blood1);
    if (up) {
      line(c, 7, 7, 3, 3, P.dark2);
      line(c, 9, 7, 13, 3, P.dark2);
      line(c, 6, 6, 3, 5, P.dark1);
      line(c, 10, 6, 13, 5, P.dark1);
    } else {
      line(c, 7, 7, 3, 10, P.dark2);
      line(c, 9, 7, 13, 10, P.dark2);
      c.set(4, 9, P.dark1);
      c.set(12, 9, P.dark1);
    }
  };
  cell(18, c => bat(c, true), false);
  cell(19, c => bat(c, false), false);
  sheet('critters', img, { cell: [16, 16], pivot: [8, 14], layer: 'single' });
}

// ---------------------------------------------------------------- icons (16x16, inventory and equipment screens)
// 0 fists, 1 dagger, 2 straight sword, 3 greataxe, 4 revolver, 5 flintlock, 6 heavy crossbow, 7 buckler,
// 8 pilgrim's hood, 9 drowned veil, 10 gaoler's helm, 11 acolyte's robe, 12 renderer's apron, 13 warden's hauberk,
// 14 tallow lump, 15 powder pouch, 16 phial shard, 17 bitter salt, 18 cage key, 19 toll key, 20 igniter,
// 21 ledger, 22 seal of tallow, 23 seal of the mire, 24 mending phial, 25 empty slot.
function genIcons() {
  const N = 67;
  const img = new Img(16 * N, 16);
  const icon = (i: number, draw: (c: Img) => void, outline = true) => {
    const c = new Img(16, 16);
    draw(c);
    if (outline) c.outline(P.ink);
    img.blit(c, i * 16, 0);
  };
  const blade = (c: Img, x0: number, y0: number, x1: number, y1: number) => {
    line(c, x0, y0, x1, y1, IRON.c3);
    line(c, x0 + 1, y0, x1 + 1, y1, IRON.c2);
  };
  // 0 fists: a clenched hand
  icon(0, c => {
    c.rect(4, 5, 8, 7, mix(P.wax1, P.wood2, 0.35));
    for (const x of [4, 6, 8, 10]) c.vline(x + 1, 5, 3, mix(P.wax1, P.wood2, 0.6));
    c.rect(3, 9, 3, 3, mix(P.wax1, P.wood2, 0.35));
    c.rect(5, 12, 6, 2, DWOOD.c2);
  });
  // 1 dagger
  icon(1, c => {
    blade(c, 11, 2, 6, 9);
    c.hline(4, 10, 5, GOLD0);
    line(c, 5, 11, 3, 13, WOOD.c2);
  });
  // 2 straight sword
  icon(2, c => {
    blade(c, 13, 1, 5, 9);
    line(c, 3, 8, 7, 12, GOLD0);
    line(c, 4, 11, 2, 13, WOOD.c2);
    c.set(1, 14, GOLD0);
  });
  // 3 greataxe
  icon(3, c => {
    line(c, 4, 15, 9, 1, WOOD.c2);
    // a broad crescent blade on one side of the haft
    for (let y = 1; y < 11; y++) {
      const w = Math.round(Math.sin(((y - 1) / 9) * Math.PI) * 5);
      const x0 = 9 - Math.round((y - 1) * 0.35);
      if (w > 0) c.hline(x0, y, w, y % 3 === 0 ? IRON.c3 : IRON.c2);
    }
    c.vline(13, 3, 6, IRON.c3); // the edge
    c.set(6, 12, WOOD.c1);
  });
  // 4 revolver
  icon(4, c => {
    c.rect(4, 5, 10, 2, IRON.c2);
    c.rect(5, 7, 4, 3, IRON.c1);
    c.disc(7, 8, 1.6, IRON.c3);
    line(c, 5, 10, 3, 14, WOOD.c2);
    line(c, 6, 10, 4, 14, WOOD.c1);
  });
  // 5 flintlock
  icon(5, c => {
    c.rect(3, 6, 11, 2, IRON.c1);
    c.hline(3, 6, 11, IRON.c3);
    c.rect(5, 8, 5, 2, WOOD.c2);
    line(c, 5, 10, 3, 14, WOOD.c2);
    c.set(7, 5, IRON.c3); // the cock
    c.set(8, 4, IRON.c2);
  });
  // 6 heavy crossbow
  icon(6, c => {
    c.rect(7, 3, 2, 11, WOOD.c2);
    line(c, 2, 6, 14, 6, IRON.c2);
    line(c, 2, 6, 3, 9, IRON.c1);
    line(c, 14, 6, 13, 9, IRON.c1);
    line(c, 3, 9, 13, 9, P.wax1); // the string
    c.set(8, 2, IRON.c3);
  });
  // 7 buckler
  icon(7, c => {
    c.disc(8, 8, 6, IRON.c1);
    c.disc(8, 8, 5, IRON.c2);
    c.disc(8, 8, 2, IRON.c3);
    c.set(6, 5, P.white);
  });
  // 8 pilgrim's hood
  icon(8, c => {
    c.ellipse(8, 8, 6, 6, STN.c2);
    c.ellipse(8, 9, 3.5, 4, P.dark1);
    c.hline(3, 13, 10, STN.c1);
    c.set(5, 4, STN.c3);
  });
  // 9 drowned veil: a waxy mask-like veil
  icon(9, c => {
    c.ellipse(8, 8, 5.5, 6.5, mix(P.wax1, P.moss2, 0.35));
    c.set(6, 7, P.dark1);
    c.set(10, 7, P.dark1);
    for (let x = 3; x < 14; x += 2) c.vline(x, 12, 3, mix(P.wax1, P.moss2, 0.5)); // drips
  });
  // 10 gaoler's helm: iron with a barred face grille
  icon(10, c => {
    c.ellipse(8, 7, 6, 5.5, IRON.c1);
    c.ellipse(8, 6, 5, 4, IRON.c2);
    c.rect(4, 8, 8, 5, P.dark1);
    for (const x of [5, 7, 9, 11]) c.vline(x, 8, 5, IRON.c3);
    c.set(6, 3, IRON.c3);
  });
  // 11 acolyte's robe
  icon(11, c => {
    for (let y = 3; y < 15; y++) c.hline(8 - Math.floor(2 + y / 3), y, Math.floor(4 + (y / 3) * 2), y < 5 ? P.dark2 : P.dark1);
    c.hline(5, 8, 6, P.ember); // singed sash
    c.vline(8, 5, 9, P.stone1);
  });
  // 12 renderer's apron: stained leather
  icon(12, c => {
    c.rect(4, 4, 8, 11, mix(P.wood2, P.wax1, 0.2));
    c.rect(5, 2, 6, 2, mix(P.wood2, P.wax1, 0.2));
    c.hline(2, 6, 12, WOOD.c1); // ties
    c.set(7, 9, P.blood1);
    c.set(9, 11, P.blood1);
    c.set(8, 10, mix(P.blood1, P.wood2, 0.5));
  });
  // 13 warden's hauberk: mail
  icon(13, c => {
    c.rect(3, 3, 10, 11, IRON.c1);
    for (let y = 3; y < 14; y++) for (let x = 3 + (y % 2); x < 13; x += 2) c.set(x, y, IRON.c2);
    c.rect(6, 2, 4, 2, P.dark1); // neck
    c.hline(3, 13, 10, mix(P.blood1, P.wood1, 0.5)); // hem
  });
  // 14 tallow lump
  icon(14, c => {
    c.ellipse(8, 9, 5, 4, P.wax1);
    c.ellipse(7, 8, 3, 2, P.wax2);
  });
  // 15 powder pouch
  icon(15, c => {
    c.ellipse(8, 10, 5, 4, WOOD.c2);
    c.rect(6, 4, 4, 3, WOOD.c1);
    c.hline(5, 7, 6, P.wax1);
  });
  // 16 phial shard
  icon(16, c => {
    line(c, 5, 12, 10, 3, mix(P.teal3, P.white, 0.3));
    line(c, 6, 12, 11, 4, P.teal3);
    line(c, 5, 12, 11, 12, P.teal2);
    c.set(9, 5, P.white);
  });
  // 17 bitter salt
  icon(17, c => {
    c.ellipse(8, 11, 5, 2.5, P.wax2);
    c.ellipse(8, 9, 3, 2.5, P.white);
    c.set(6, 8, P.stone4);
  });
  // 18 cage key
  icon(18, c => {
    c.disc(5, 5, 2.5, IRON.c2);
    c.set(5, 5, P.dark1);
    line(c, 6, 6, 12, 12, IRON.c2);
    c.hline(10, 12, 3, IRON.c2);
  });
  // 19 toll key: heavy iron, worn bright
  icon(19, c => {
    c.disc(5, 5, 3, IRON.c3);
    c.disc(5, 5, 1.2, P.dark1);
    line(c, 7, 7, 13, 13, IRON.c3);
    c.rect(11, 12, 3, 2, IRON.c2);
    c.rect(9, 10, 2, 2, IRON.c2);
  });
  // 20 igniter: a striker and flint with a spark
  icon(20, c => {
    c.rect(3, 8, 7, 4, IRON.c2);
    c.rect(9, 9, 4, 3, STN.c3);
    c.set(12, 6, P.flame2);
    c.set(13, 5, P.flame1);
    c.set(11, 5, P.flame1);
  });
  // 21 ledger
  icon(21, c => {
    c.rect(3, 3, 10, 11, P.blood1);
    c.rect(4, 4, 8, 9, P.wax1);
    for (const y of [6, 8, 10]) c.hline(5, y, 6, P.stone2);
    c.vline(3, 3, 11, P.blood2);
  });
  // 22 seal of tallow: a wax seal, amber
  icon(22, c => {
    c.disc(8, 8, 5.5, P.flame1);
    c.disc(8, 8, 3.5, mix(P.flame1, P.wood1, 0.3));
    c.set(8, 8, P.flame2);
    c.set(6, 5, P.wax2);
  });
  // 23 seal of the mire: green-black wax
  icon(23, c => {
    c.disc(8, 8, 5.5, P.moss1);
    c.disc(8, 8, 3.5, mix(P.moss1, P.dark1, 0.5));
    c.set(8, 8, P.moss2);
    c.set(6, 5, P.wax1);
  });
  // 24 mending phial
  icon(24, c => {
    c.ellipse(8, 10, 4.5, 4, mix(P.teal2, P.dark1, 0.3));
    c.ellipse(8, 11, 3.5, 2.5, P.flame1);
    c.rect(7, 3, 3, 4, mix(P.teal2, P.dark1, 0.3));
    c.rect(7, 2, 3, 1, WOOD.c2);
    c.set(6, 9, P.white);
  });
  // 25 an empty slot: a faint dotted square
  icon(
    25,
    c => {
      for (let i = 2; i < 14; i += 2) {
        c.set(i, 2, P.stone1);
        c.set(i, 13, P.stone1);
        c.set(2, i, P.stone1);
        c.set(13, i, P.stone1);
      }
    },
    false,
  );
  // ---- consumables (26-36)
  // 26 firebomb: a clay pot with a lit rag
  icon(26, c => {
    c.disc(8, 10, 4.5, WOOD.c2);
    c.disc(7, 9, 2.5, WOOD.c3);
    c.hline(4, 10, 9, P.dark2);
    c.rect(7, 4, 3, 2, WOOD.c1);
    line(c, 8, 4, 10, 1, P.wax1); // the rag
    c.set(10, 1, P.flame2);
    c.set(11, 0, P.flame1);
    c.set(9, 1, P.flame1);
  });
  // 27 pilgrim's knife: a plain double-edged blade, point up-right
  icon(27, c => {
    line(c, 5, 11, 12, 4, IRON.c3);
    line(c, 5, 10, 11, 4, IRON.c2);
    c.set(12, 3, P.white);
    line(c, 3, 13, 5, 11, WOOD.c2); // wrapped grip
    c.set(4, 12, P.wax1);
    c.hline(4, 10, 3, IRON.c1);
  });
  // 28 wild honeycomb: amber cells
  icon(28, c => {
    for (const [x, y] of [[4, 5], [8, 5], [6, 8], [10, 8], [4, 11], [8, 11]] as const) {
      c.disc(x + 1, y + 1, 2, P.flame1);
      c.set(x + 1, y + 1, mix(P.flame2, P.wax2, 0.5));
    }
    c.set(12, 13, P.flame2); // a drip
    c.set(12, 14, P.flame1);
  });
  // 29 grey salt crust: a cracked grey slab
  icon(29, c => {
    c.rect(3, 6, 10, 6, STN.c2);
    c.hline(3, 6, 10, STN.c3);
    c.hline(3, 11, 10, STN.c1);
    line(c, 6, 6, 8, 11, STN.c0);
    line(c, 10, 7, 11, 11, STN.c0);
    c.set(5, 8, P.white);
    c.set(9, 7, P.white);
  });
  // 30 warding incense: a cone with a curl of teal smoke
  icon(30, c => {
    for (let y = 8; y < 14; y++) c.hline(8 - Math.floor((y - 8) / 2), y, 1 + Math.floor((y - 8) / 2) * 2, y < 10 ? P.ember : WOOD.c2);
    c.set(8, 7, P.flame2);
    for (const [x, y] of [[8, 6], [7, 5], [7, 4], [8, 3], [9, 2], [9, 1]] as const) c.set(x, y, P.teal3);
    c.set(6, 3, P.teal2);
  });
  // 31 paper cartridge: a twist of printed paper with a ball
  icon(31, c => {
    c.rect(5, 4, 5, 9, P.wax1);
    c.vline(5, 4, 9, P.wax2);
    for (const y of [6, 8, 10]) c.hline(6, y, 3, P.stone2); // the psalter's lines
    c.set(7, 3, P.wax1);
    c.set(8, 2, P.wax1);
    c.disc(8, 13, 1.5, IRON.c1);
    c.set(7, 12, IRON.c3);
  });
  // 32 chandler's oil: a stoppered bottle, amber-dark
  icon(32, c => {
    c.ellipse(8, 10, 4, 4, mix(P.flame1, P.dark1, 0.45));
    c.ellipse(8, 11, 3, 2.5, mix(P.ember, P.dark1, 0.3));
    c.rect(7, 3, 3, 4, mix(P.flame1, P.dark1, 0.45));
    c.rect(7, 2, 3, 1, WOOD.c2);
    c.set(6, 8, P.flame2);
  });
  // 33 stale wafer: a round host stamped with a cross
  icon(33, c => {
    c.disc(8, 8, 5, P.wax2);
    c.disc(8, 8, 4, P.wax1);
    c.hline(6, 8, 5, mix(P.wax1, P.wood2, 0.4));
    c.vline(8, 6, 5, mix(P.wax1, P.wood2, 0.4));
    c.set(12, 11, P.wax1); // a bite out of it
    c.set(11, 12, P.ink);
  });
  // 34 smoke pellet: a dark ball with a grey puff
  icon(34, c => {
    c.disc(7, 10, 3.5, P.dark2);
    c.set(6, 9, P.stone2);
    c.disc(11, 5, 2.2, P.stone3);
    c.disc(9, 4, 1.5, P.stone2);
    c.disc(12, 3, 1.2, P.stone4);
  });
  // 35 ringer's grog: a leather jack with froth
  icon(35, c => {
    c.rect(4, 5, 7, 9, WOOD.c1);
    c.vline(4, 5, 9, WOOD.c2);
    c.hline(4, 4, 7, P.wax2); // froth
    c.set(5, 3, P.wax2);
    c.set(8, 3, P.wax2);
    c.rect(11, 7, 2, 4, WOOD.c1); // handle
    c.set(11, 8, P.ink);
    c.set(12, 9, P.ink);
    c.hline(4, 10, 7, P.ember); // a peppered band
  });
  // 36 pilgrim's tallow candle: a thick candle, unlit
  icon(36, c => {
    c.rect(6, 5, 5, 9, P.wax1);
    c.vline(6, 5, 9, P.wax2);
    c.set(8, 3, P.dark2);
    c.set(8, 4, P.dark2);
    c.hline(5, 14, 7, WOOD.c1);
    c.set(10, 7, P.wax2); // a drip
    c.set(10, 8, P.wax2);
  });
  // ---- rings (37-46): a band seen at an angle, with its setting
  const band = (c: Img, metal: Ramp, setting: (c: Img) => void) => {
    c.ellipse(8, 10, 5, 3.5, metal.c2);
    c.ellipse(8, 10, 3.5, 2, P.ink);
    c.hline(5, 7, 6, metal.c3);
    c.hline(5, 13, 6, metal.c1);
    setting(c);
  };
  const JET: Ramp = { c0: P.ink, c1: P.dark1, c2: P.dark2, c3: P.stone1 };
  const SILVER: Ramp = { c0: P.stone2, c1: P.stone3, c2: P.steel2, c3: P.white };
  const ROPE: Ramp = { c0: WOOD.c0, c1: WOOD.c1, c2: WOOD.c2, c3: WOOD.c3 };
  // 37 band of steady breath: a bronze band with a tiny bell
  icon(37, c =>
    band(c, BRONZE, c => {
      c.disc(8, 4, 2.2, BRONZE.c3);
      c.set(8, 6, BRONZE.c1);
      c.set(8, 1, BRONZE.c2);
    }),
  );
  // 38 parish signet: gold with a flat red seal face
  icon(38, c =>
    band(c, BRONZE, c => {
      c.rect(6, 3, 5, 4, P.blood1);
      c.rect(7, 4, 3, 2, P.blood2);
      c.set(8, 4, P.wax2);
    }),
  );
  // 39 cutpurse's band: filed thin, dull iron
  icon(39, c => {
    c.ellipse(8, 9, 5, 3, IRON.c2);
    c.ellipse(8, 9, 4, 2, P.ink);
    c.set(4, 8, IRON.c3);
    c.set(12, 10, IRON.c1);
  });
  // 40 porter's knot: plaited rope with a knot
  icon(40, c =>
    band(c, ROPE, c => {
      for (let x = 4; x < 12; x += 2) c.set(x, 7, WOOD.c0);
      c.disc(8, 5, 2, WOOD.c3);
      c.set(8, 5, WOOD.c1);
    }),
  );
  // 41 miser's band: gold, with a coin set in it
  icon(41, c =>
    band(c, BRONZE, c => {
      c.disc(8, 4, 2.5, GOLD0);
      c.disc(8, 4, 1.5, P.flame2);
      c.set(8, 4, GOLD0);
    }),
  );
  // 42 ring of the last candle: silver with a lit flame
  icon(42, c =>
    band(c, SILVER, c => {
      c.rect(7, 4, 3, 3, P.wax2);
      c.set(8, 3, P.flame2);
      c.set(8, 2, P.flame1);
      c.set(9, 1, P.flame2);
    }),
  );
  // 43 mourner's ring: black jet
  icon(43, c =>
    band(c, JET, c => {
      c.ellipse(8, 4.5, 3, 2.2, P.dark2);
      c.set(7, 4, P.stone3);
    }),
  );
  // 44 ring of the quiet step: grey felt-lined band
  icon(44, c =>
    band(c, SILVER, c => {
      c.ellipse(8, 10, 3.5, 2, mix(P.stone2, P.teal1, 0.4));
      c.ellipse(8, 10, 2.5, 1.2, P.ink);
      c.set(8, 6, P.teal3);
    }),
  );
  // 45 powder-maker's ring: iron, blackened, with a speck of saltpetre
  icon(45, c =>
    band(c, IRON, c => {
      c.disc(8, 4.5, 2, P.dark2);
      c.set(8, 4, P.white);
      c.set(4, 10, P.ink);
      c.set(12, 9, P.ink);
    }),
  );
  // 46 warden's ward: a heavy iron band stamped with a gate
  icon(46, c =>
    band(c, IRON, c => {
      c.rect(6, 2, 5, 5, IRON.c1);
      c.vline(7, 3, 3, P.ink);
      c.vline(9, 3, 3, P.ink);
      c.hline(6, 2, 5, IRON.c3);
    }),
  );
  // 47 a lore note: a curled sheet with writing
  icon(47, c => {
    c.rect(4, 3, 8, 11, P.wax1);
    c.vline(4, 3, 11, P.wax2);
    c.hline(4, 13, 8, mix(P.wax1, P.wood2, 0.5));
    for (const y of [5, 7, 9, 11]) c.hline(5, y, y === 11 ? 3 : 6, P.stone1);
    c.set(11, 3, mix(P.wax1, P.wood2, 0.5)); // a torn corner
  });
  // ---- smith's materials and shop rings (48-51)
  // 48 tallow ingot: a pale bar with a stamped mark
  icon(48, c => {
    for (let y = 6; y < 12; y++) c.hline(3 + (11 - y) / 2, y, 10 - (11 - y) / 2 + (y > 8 ? 1 : 0), y < 8 ? P.wax2 : P.wax1);
    c.hline(3, 11, 11, mix(P.wax1, P.wood2, 0.4));
    c.set(7, 8, mix(P.wax1, P.wood2, 0.6)); // the stamp
    c.set(8, 8, mix(P.wax1, P.wood2, 0.6));
    c.set(6, 6, P.white);
  });
  // 49 ember salt: red crystals with a warm core
  icon(49, c => {
    line(c, 5, 12, 7, 4, P.blood2);
    line(c, 6, 12, 8, 4, P.ember);
    line(c, 9, 12, 11, 6, P.blood2);
    line(c, 10, 12, 12, 6, P.flame1);
    c.rect(4, 12, 9, 2, P.blood1);
    c.set(7, 5, P.flame2);
    c.set(11, 7, P.flame2);
  });
  // 50 hawker's ring: brass, thumb-worn, with a tiny coin stamp
  icon(50, c =>
    band(c, BRONZE, c => {
      c.rect(7, 4, 3, 3, BRONZE.c3);
      c.set(8, 5, BRONZE.c1);
    }),
  );
  // 51 gunner's band: spent cartridge brass, a dark primer
  icon(51, c =>
    band(c, BRONZE, c => {
      c.disc(8, 4.5, 2.2, GOLD0);
      c.disc(8, 4.5, 1, P.dark2);
      c.set(4, 9, P.ink); // powder-blackened
    }),
  );
  // ---- the Powder Vault (52-56)
  // 52 blunderbuss: a brass bell-mouthed gun
  icon(52, c => {
    line(c, 2, 12, 7, 9, WOOD.c2);
    line(c, 2, 13, 7, 10, WOOD.c1);
    line(c, 6, 9, 11, 6, BRONZE.c2);
    line(c, 7, 10, 12, 7, BRONZE.c1);
    c.disc(13, 5, 2.4, BRONZE.c3);
    c.disc(13, 5, 1, P.ink);
  });
  // 53 gunner's coat: long red coat with brass buttons
  icon(53, c => {
    for (let y = 3; y < 15; y++) c.hline(8 - Math.floor(2 + y / 3), y, Math.floor(4 + (y / 3) * 2), y < 5 ? mix(P.blood1, P.ink, 0.4) : P.blood1);
    c.vline(8, 5, 9, mix(P.blood2, P.wood2, 0.3));
    for (const y of [6, 9, 12]) c.set(7, y, GOLD0);
    c.hline(4, 9, 8, P.dark2);
  });
  // 54 ring of the steady hand: iron band with a tiny sighting bead
  icon(54, c =>
    band(c, IRON, c => {
      c.rect(7, 4, 3, 2, IRON.c3);
      c.set(8, 3, P.white);
    }),
  );
  // 55 keg charge: a small keg with a long lit fuse
  icon(55, c => {
    c.ellipse(8, 10, 4.5, 4, WOOD.c2);
    c.hline(4, 8, 9, IRON.c1);
    c.hline(4, 12, 9, IRON.c1);
    c.vline(8, 6, 3, WOOD.c3);
    line(c, 8, 5, 11, 2, P.wax1);
    c.set(12, 1, P.flame2);
  });
  // 56 oskar's strongbox: an iron-banded box with a heavy lock
  icon(56, c => {
    c.rect(3, 6, 10, 8, WOOD.c1);
    c.hline(3, 6, 10, WOOD.c3);
    c.vline(5, 6, 8, IRON.c2);
    c.vline(10, 6, 8, IRON.c2);
    c.rect(7, 8, 2, 3, GOLD0);
    c.set(7, 10, P.ink);
  });
  // ---- Bloomhollow (57-63)
  const straw: Ramp = { c0: mix(P.wood2, P.wood1, 0.35), c1: mix(P.wood2, P.flame1, 0.35), c2: mix(P.wax1, P.flame1, 0.35), c3: mix(P.wax1, P.flame2, 0.3) };
  // 57 the smoker: a tin can, its spout, the bellows, a wisp of smoke
  icon(57, c => {
    c.rect(2, 8, 4, 4, WOOD.c2);
    c.hline(2, 8, 4, WOOD.c3);
    c.rect(6, 5, 6, 8, IRON.c1);
    c.vline(6, 5, 8, IRON.c3);
    c.vline(11, 5, 8, IRON.c0);
    line(c, 11, 5, 13, 3, IRON.c2);
    c.set(8, 11, P.ember);
    c.set(13, 1, P.stone4);
    c.set(14, 0, P.stone3);
  });
  // 58 beekeeper's veil: a straw hat with its dark mesh
  icon(58, c => {
    c.hline(1, 6, 14, straw.c1);
    c.hline(1, 6, 5, straw.c3);
    c.rect(4, 3, 8, 3, straw.c2);
    c.hline(4, 3, 8, straw.c3);
    for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) c.set(x, y, (x + y) % 2 ? P.dark1 : P.dark2);
  });
  // 59 beekeeper's coat: cream linen, honey-stained, scorched at the hem
  icon(59, c => {
    c.rect(4, 3, 8, 11, mix(P.wax1, P.wax2, 0.3));
    c.vline(4, 3, 11, P.wax2);
    c.vline(11, 3, 11, mix(P.wax1, P.stone3, 0.4));
    c.rect(2, 4, 2, 7, mix(P.wax1, P.stone3, 0.2));
    c.rect(12, 4, 2, 7, mix(P.wax1, P.stone3, 0.4));
    c.vline(8, 4, 10, mix(P.wax1, P.stone3, 0.5));
    c.set(6, 8, P.honey);
    c.set(10, 6, P.honey);
    for (let x = 4; x < 12; x += 2) c.set(x, 13, P.dark1);
  });
  // 60 ring of the queen: a gold band set with a drop of amber, a bee in it
  icon(60, c => {
    c.ellipse(8, 9, 5, 4, P.flame1);
    c.ellipse(8, 9, 3, 2.2, null as unknown as RGBA); // the hole through the band
    c.set(5, 7, P.flame2);
    c.disc(8, 4.5, 2.4, P.honey);
    c.set(7, 4, P.wax2);
    c.set(8, 5, P.ink);
  });
  // 61 beeswax candle: a golden taper, lit, a comb pattern pressed into it
  icon(61, c => {
    c.rect(6, 6, 4, 9, mix(P.wax2, P.honey, 0.35));
    c.vline(6, 6, 9, mix(P.wax2, P.honey, 0.15));
    c.vline(9, 6, 9, mix(P.honey, P.wood2, 0.3));
    for (let y = 7; y < 15; y += 2) c.set(7 + (y % 4 === 1 ? 1 : 0), y, P.honey);
    c.set(7, 5, P.dark1);
    c.set(7, 4, P.flame2);
    c.set(7, 3, P.flame1);
    c.set(8, 3, P.wax2);
  });
  // 62 Hild's letter: folded, tied with twine, a pressed blossom under the knot
  icon(62, c => {
    c.rect(2, 4, 12, 8, P.wax2);
    c.hline(2, 4, 12, mix(P.wax2, P.white, 0.5));
    line(c, 2, 4, 8, 8, P.wax1);
    line(c, 13, 4, 8, 8, P.wax1);
    c.vline(8, 4, 8, EN.rope);
    c.set(8, 8, P.blossom);
    c.set(9, 8, P.poppy);
  });
  // 63 Maudlin's reply: a small sealed letter, grey wax with a candle stamped in it
  icon(63, c => {
    c.rect(2, 4, 12, 8, mix(P.wax1, P.stone3, 0.25));
    c.hline(2, 4, 12, P.wax2);
    line(c, 2, 11, 8, 7, P.wax1);
    line(c, 13, 11, 8, 7, P.wax1);
    c.disc(8, 7, 2.2, P.stone2);
    c.vline(8, 6, 2, P.flame2);
  });
  // 64 Seal of Powder: black wax pressed with the Abbey's candle, a grain of powder glinting in it
  icon(64, c => {
    c.disc(8, 8, 5.5, mix(P.dark1, P.stone1, 0.3));
    c.disc(8, 8, 3.5, P.ink);
    c.vline(8, 6, 4, P.stone3); // the candle stamped in it
    c.set(8, 5, P.ember);
    c.set(6, 5, P.stone4);
    c.set(11, 10, P.flame1);
  });
  // 65 Seal of the Hive: golden beeswax, a six-sided cell stamped in it
  icon(65, c => {
    c.disc(8, 8, 5.5, P.honey);
    c.disc(8, 8, 3.5, mix(P.honey, P.ember, 0.35));
    for (const [x, y] of [[7, 6], [9, 6], [10, 8], [9, 10], [7, 10], [6, 8]]) c.set(x, y, P.flame2);
    c.set(6, 5, P.wax2);
  });
  // 66 the Nave Watch oath-ring: an iron band with the Abbey's flame on a shield, wax run down over half of it
  icon(66, c =>
    band(c, IRON, c => {
      c.rect(6, 2, 5, 5, IRON.c1);
      c.hline(6, 2, 5, IRON.c3);
      c.vline(8, 3, 2, P.flame2);
      c.set(8, 5, P.blood2);
      for (const [x, y] of [[5, 3], [5, 4], [5, 5], [6, 6], [5, 7], [4, 8], [5, 9], [4, 10]]) c.set(x, y, y > 7 ? P.wax1 : P.wax2);
    }),
  );
  sheet('icons', img, { cell: [16, 16], pivot: [0, 0], layer: 'ui' });

  // A throwing knife in flight (pointing right), and a note lying on the floor
  const knife = new Img(9, 3);
  knife.hline(3, 1, 5, P.steel2);
  knife.set(8, 1, P.white);
  knife.hline(0, 1, 3, WOOD.c2);
  knife.set(3, 0, IRON.c1);
  knife.set(3, 2, IRON.c1);
  sheet('knife', knife, { cell: [9, 3], pivot: [4, 1], layer: 'fx' });
  const note = new Img(10, 7);
  note.rect(1, 1, 8, 5, P.wax1);
  note.hline(1, 1, 8, P.wax2);
  note.hline(2, 3, 5, P.stone2);
  note.hline(2, 4, 4, P.stone2);
  note.set(8, 5, mix(P.wax1, P.wood2, 0.5));
  note.outline(P.ink);
  sheet('note', note, { cell: [10, 7], pivot: [5, 4], layer: 'single' });
}

// ---------------------------------------------------------------- cutscene cast: the wagon's driver and its horse
// The driver: a hired carter in a brown coat and a low hat, a pipe, sitting up on the box (frame 10: sat).
// The cart horse: a tired bay with blinkers and harness, authored facing east (west is mirrored), 48x32 cells:
// walk (4), idle (2), rear (3: up on its hind legs, forelegs pawing), shy (1: flinching sideways).
function genCutsceneCast() {
  villagerSheet('npc_driver', {
    cloth: { c0: mix(P.wood1, P.ink, 0.5), c1: mix(P.wood1, P.dark2, 0.3), c2: P.wood1, c3: mix(P.wood2, P.stone3, 0.3) },
    long: true, legs: P.dark2, skin: mix(P.wax1, P.wood2, 0.45), head: 'cap', headCol: mix(P.dark2, P.wood1, 0.3), beard: P.stone3,
    job: (c, f, g) => {
      c.set(g.cx + 2, g.top + 7, P.wood2); // a clay pipe
      c.set(g.cx + 3, g.top + 7, P.wood1);
      c.set(g.cx + 4, g.top + 6, P.stone3);
      if (f.kind !== 'sit') return;
      const l: [number, number] = [g.cx - 4, g.waist - 1];
      const r: [number, number] = [g.cx + 4, g.waist - 1];
      c.hline(g.cx - 12, g.waist - 1, 8, P.wood1); // the reins, running forward
      return { l, r };
    },
  });

  const W = 48;
  const H = 32;
  const coat = { c0: hex('#2a1812'), c1: mix(P.wood1, P.ink, 0.25), c2: P.wood1, c3: P.wood2, c4: mix(P.wood2, P.wax1, 0.3) };
  const mane = mix(P.dark2, P.ink, 0.4);
  const hoof = P.ink;
  const leather = mix(P.dark2, P.wood1, 0.35);
  /** One horse pose into a fresh cell: `step` 0-3 walk phase (-1 standing), `lift` forelegs raised. */
  const horse = (step: number, breathe: number, lift = 0, shy = false): Img => {
    const c = new Img(W, H);
    const bodyY = 15 + breathe;
    // tail
    for (let i = 0; i < 9; i++) c.set(9 - Math.round(i * 0.3) + (step >= 0 ? (step % 2) : 0), bodyY - 2 + i, i < 2 ? coat.c1 : mane);
    c.set(10, bodyY - 3, mane);
    // legs: far pair darker, drawn first; the walk swings them in opposite pairs
    const swing = (phase: number) => (step < 0 ? 0 : [2, 0, -2, 0][(step + phase) % 4]);
    const leg = (x: number, phase: number, far: boolean, fore: boolean) => {
      const col = far ? coat.c1 : coat.c2;
      const dx = swing(phase);
      const up = fore ? lift : 0;
      const kneeY = bodyY + 5 - up;
      const footY = H - 3 - up * 1.4;
      const kx = x + Math.round(dx / 2) + (fore && lift ? 3 : 0);
      const fx = x + dx + (fore && lift ? 5 : 0);
      for (const o of [0, 1]) {
        line(c, x + o, bodyY + 2, kx + o, kneeY, o ? mix(col, P.ink, 0.2) : col); // a thick thigh
        line(c, kx + o, kneeY, fx + o, footY, far ? mix(coat.c1, P.ink, 0.3) : o ? mix(coat.c1, P.ink, 0.2) : coat.c1);
      }
      c.set(kx, kneeY, far ? coat.c1 : coat.c3); // the knee catching the light
      c.hline(fx - 1, footY + 1, 3, hoof);
    };
    leg(15, 2, true, false);
    leg(31, 0, true, true);
    // body: a barrel, lit from above
    c.ellipse(22, bodyY, 12, 6.5, coat.c2);
    c.ellipse(22, bodyY - 2, 10, 3.5, coat.c3);
    c.ellipse(19, bodyY - 3, 5, 1.5, coat.c4);
    c.ellipse(22, bodyY + 4, 10, 2, coat.c1); // belly shadow
    c.ellipse(12, bodyY - 1, 4.5, 5, coat.c2); // haunch
    c.ellipse(11, bodyY - 3, 3, 2, coat.c3);
    // neck and head, raised higher when it rears or shies
    const hx = 38 + (shy ? -2 : 0);
    const hy = 5 - lift * 0.4 + breathe + (shy ? -2 : 0);
    for (let i = 0; i <= 8; i++) {
      const x = Math.round(30 + (hx - 30) * (i / 8));
      const y = Math.round(bodyY - 3 + (hy + 3 - (bodyY - 3)) * (i / 8));
      c.rect(x - 2, y - 1, 5, 4, i < 6 ? coat.c2 : coat.c3);
      c.set(x - 2, y - 2, mane); // mane along the crest
      c.set(x - 1, y - 2, mane);
    }
    c.ellipse(hx + 2, hy + 2, 3.5, 2.6, coat.c2); // skull
    c.ellipse(hx + 5, hy + 4, 2.5, 2, coat.c3); // muzzle
    c.set(hx + 7, hy + 4, P.ink); // nostril
    c.set(hx, hy - 1, coat.c1); // ear
    c.set(hx, hy - 2, coat.c1);
    c.set(hx + 2, hy + 1, shy ? P.white : P.ink); // eye (white-rimmed with fright)
    if (shy) c.set(hx + 3, hy + 1, P.ink);
    c.rect(hx + 1, hy, 2, 2, leather); // blinker
    // harness: collar, a strap along the back, brass buckles, the traces running back
    for (let i = 0; i < 5; i++) c.set(30 + (i > 2 ? 1 : 0), bodyY - 5 + i * 2, leather);
    c.rect(29, bodyY - 5, 3, 9, leather);
    c.set(30, bodyY - 1, P.flame1);
    c.hline(14, bodyY - 5, 14, leather);
    c.set(21, bodyY - 5, P.flame1);
    c.hline(0, bodyY + 1, 12, leather); // traces to the cart behind
    // near legs over the body
    leg(18, 0, false, false);
    leg(34, 2, false, true);
    c.outline(hex('#140f14'));
    return c;
  };
  /** Rotate a cell about its hind hooves (for rearing). */
  const tilt = (src: Img, deg: number): Img => {
    const out = new Img(W, H);
    const a = (deg * Math.PI) / 180;
    const px = 16;
    const py = H - 2;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = x - px;
        const dy = y - py;
        const sx = Math.round(px + dx * Math.cos(a) + dy * Math.sin(a));
        const sy = Math.round(py - dx * Math.sin(a) + dy * Math.cos(a));
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const i = (sy * W + sx) * 4;
        if (src.px[i + 3]) out.set(x, y, [src.px[i], src.px[i + 1], src.px[i + 2], 255]);
      }
    return out;
  };
  const cells: Img[] = [
    horse(0, 0), horse(1, -1), horse(2, 0), horse(3, -1), // walk
    horse(-1, 0), horse(-1, 1), // idle
    tilt(horse(-1, 0, 4), -14), tilt(horse(-1, -1, 6), -24), tilt(horse(-1, 0, 5), -18), // rear
    horse(-1, 0, 0, true), // shy
  ];
  const img = new Img(W * cells.length, H);
  cells.forEach((c, i) => img.blit(c, i * W, 0));
  sheet('cart_horse', img, {
    cell: [W, H],
    pivot: [24, 30],
    layer: 'single',
    animations: {
      walk: { row: 0, dirs: ['E'], loop: true, frames: [0, 1, 2, 3].map(col => ({ col, ticks: 7 })) },
      idle: { row: 0, dirs: ['E'], loop: true, frames: [4, 5].map(col => ({ col, ticks: 30 })) },
      rear: { row: 0, dirs: ['E'], loop: false, frames: [{ col: 6, ticks: 5 }, { col: 7, ticks: 18 }, { col: 8, ticks: 8 }] },
      shy: { row: 0, dirs: ['E'], loop: false, frames: [{ col: 9, ticks: 12 }] },
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

// ---------------------------------------------------------------- the Powder Vault (expansion step 3)
// Powder Mule (a porter with a keg on his back), Fuse-Runner (a soot-black boy with a linstock), the Master
// Gunner on his cannon (64 cell) and on foot with his blunderbuss (48 cell), the keg, the vault's decor.
const SOOT = mix(P.dark1, P.ink, 0.35);
const POWDER = mix(P.dark2, P.stone1, 0.4);
const COAT: Ramp = { c0: hex('#3a0d14'), c1: P.blood1, c2: mix(P.blood1, P.blood2, 0.55), c3: P.blood2 };
const BRASS = mix(P.flame1, P.wood2, 0.35);
/** Buff leather and facings: the gunner's lapels, cuffs and crossbelt. */
const BUFF: Ramp = { c0: mix(P.wax1, P.wood2, 0.6), c1: mix(P.wax1, P.wood2, 0.3), c2: P.wax1, c3: P.wax2 };
/** Grey hair and beard. */
const GREY: Ramp = { c0: P.stone2, c1: P.stone3, c2: P.stone4, c3: mix(P.stone4, P.wax2, 0.5) };
/** Faded linen, patched sack-cloth, soot-grey rags. */
const LINEN: Ramp = { c0: mix(P.stone1, P.ink, 0.3), c1: P.stone1, c2: P.stone2, c3: P.stone3 };
const RAG: Ramp = { c0: mix(P.dark1, P.ink, 0.3), c1: P.dark2, c2: mix(P.dark2, P.stone2, 0.55), c3: P.stone3 };
const HAT: Ramp = { c0: P.ink, c1: mix(P.dark1, P.ink, 0.35), c2: P.dark1, c3: P.dark2 };
/** Skin: the porter's sunburnt hide, the boy's soot-rubbed face, the old gunner's weathered one. */
const SKIN_MULE: Ramp = { c0: mix(P.wood1, P.ember, 0.2), c1: mix(P.wood2, P.ember, 0.25), c2: mix(P.wax1, P.wood2, 0.5), c3: mix(P.wax1, P.wood2, 0.2) };
const SKIN_BOY: Ramp = { c0: mix(P.wood1, P.ink, 0.3), c1: P.wood1, c2: mix(P.wood2, P.wax1, 0.3), c3: mix(P.wax1, P.wood2, 0.35) };
const SKIN_OLD: Ramp = { c0: mix(P.wood1, P.ember, 0.2), c1: mix(P.wood2, P.ember, 0.2), c2: mix(P.wax1, P.wood2, 0.45), c3: mix(P.wax1, P.wood2, 0.15) };

/** Shade across a span: a lit left edge, a dark right edge (t = 0..1 across it). */
const shadeT = (t: number, r: Ramp) => (t < 0.12 ? r.c3 : t < 0.26 ? mix(r.c2, r.c3, 0.5) : t > 0.88 ? r.c0 : t > 0.7 ? r.c1 : r.c2);
/** A lit ellipse: dark base, a lit body up and to the left, one highlight pixel. */
function litBall(c: Img, x: number, y: number, rx: number, ry: number, r: Ramp) {
  c.ellipse(x, y, rx, ry, r.c1);
  c.ellipse(x - rx * 0.2, y - ry * 0.2, rx * 0.78, ry * 0.78, r.c2);
  c.set(x - rx * 0.45, y - ry * 0.5, r.c3);
  c.ellipse(x, y, rx, ry, r.c0, (px, py) => (px + 0.5 - x) / rx + (py + 0.5 - y) / ry > 1.05);
}
/** Where a face's features sit, per direction (the face turns toward the facing). */
const faceX = (dir: Dir5, hx: number) => hx + (dir === 'SE' ? 1 : dir === 'E' ? 2 : 0);

/** A keg drawn at (cx, base): staves, two iron hoops, a fuse; `lit` puts a spark on it. */
function kegAt(c: Img, cx: number, base: number, r: number, lit = false) {
  const h = Math.round(r * 2.2);
  const bulgeAt = (y: number) => r - Math.round((Math.abs(y - h / 2) / (h / 2)) * 1.5);
  for (let y = 0; y < h; y++) {
    const bulge = bulgeAt(y);
    for (let x = -bulge; x < bulge; x++) {
      const t = (x + bulge) / (bulge * 2);
      let col = t < 0.12 ? WOOD.c2 : t < 0.34 ? WOOD.c3 : t > 0.84 ? WOOD.c0 : t > 0.62 ? WOOD.c1 : WOOD.c2;
      if ((x + 99) % 3 === 0 && t > 0.1 && t < 0.86) col = mix(col, WOOD.c0, 0.45); // the seams between staves
      c.set(cx + x, base - y, col);
    }
  }
  for (const y of [Math.round(h * 0.22), Math.round(h * 0.78)]) {
    const bulge = bulgeAt(y);
    for (let x = -bulge; x < bulge; x++) {
      const t = (x + bulge) / (bulge * 2);
      c.set(cx + x, base - y, t < 0.3 ? IRON.c3 : t < 0.6 ? IRON.c2 : t < 0.85 ? IRON.c1 : IRON.c0);
    }
  }
  if (r >= 6) {
    // a stencilled powder mark between the hoops
    const my = base - Math.round(h / 2);
    for (const [dx, dy] of [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]) c.set(cx - 1 + dx, my + dy, mix(P.ink, WOOD.c1, 0.3));
  }
  c.ellipse(cx, base - h + 1, r - 1.5, 1.5, WOOD.c2); // the lid
  c.ellipse(cx - 1, base - h + 1, r - 3, 0.9, WOOD.c3);
  c.set(cx + 1, base - h - 1, P.wax1); // fuse
  c.set(cx + 2, base - h - 2, P.wax1);
  if (lit) {
    c.set(cx + 3, base - h - 3, P.flame2);
    c.set(cx + 2, base - h - 4, P.wax2);
    c.set(cx + 3, base - h - 2, P.ember);
  }
}

// --- Powder Mule: a hunched, barrel-chested porter, a keg lashed to his back with the fuse already trimmed short.
function drawMule(c: Img, dir: Dir5, pose: BodyPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const side = dir === 'E';
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  // stumpy legs: dark trousers, rag-wrapped shins, heavy boots
  for (const [x, lift, dark] of [[11, liftL, 0], [17, liftR, 1]] as const) {
    c.rect(x, 21 + b, 4, 3 - lift, dark ? LINEN.c0 : LINEN.c1);
    c.rect(x, 24 - lift + b, 4, 1, dark ? mix(P.wax1, P.stone2, 0.6) : mix(P.wax1, P.stone2, 0.35));
    c.rect(x, 25 - lift + b, 4, 2, dark ? WOOD.c0 : P.wood1);
    c.set(x, 25 - lift + b, dark ? P.wood1 : WOOD.c2);
  }
  // the keg, over the shoulders: its top above his head from the front, in full view from behind
  const kx = 16 + sh + (side ? -6 : dir === 'SE' ? -4 : 0);
  if (!back) kegAt(c, kx, 15 + b, 6, true);
  // barrel chest in faded linen, bent under the load
  for (let y = 13; y <= 22; y++) {
    const w = y === 13 ? 10 : y < 20 ? 14 : 12;
    const x0 = 16 - w / 2 + sh;
    for (let x = 0; x < w; x++) c.set(x0 + x, y + b, shadeT(x / (w - 1), LINEN));
  }
  line(c, 12 + sh, 15 + b, 13 + sh, 20 + b, LINEN.c1); // folds where the straps pull
  line(c, 20 + sh, 15 + b, 19 + sh, 20 + b, LINEN.c0);
  if (!back) {
    // leather apron, scorched, with a stitched pocket; the keg's harness straps over the shoulders
    for (let y = 18; y <= 24; y++) for (let x = 12; x <= 19; x++) c.set(x + sh, y + b, shadeT((x - 12) / 7, DWOOD));
    c.hline(12 + sh, 18 + b, 8, DWOOD.c3);
    c.rect(13 + sh, 21 + b, 3, 2, DWOOD.c1); // pocket
    c.set(13 + sh, 21 + b, DWOOD.c3);
    c.set(18 + sh, 22 + b, P.ember); // burns
    c.set(17 + sh, 23 + b, SOOT);
    c.set(18 + sh, 20 + b, SOOT);
    if (!side) {
      line(c, 11 + sh, 13 + b, 13 + sh, 18 + b, DWOOD.c2);
      line(c, 12 + sh, 13 + b, 14 + sh, 18 + b, DWOOD.c1);
      c.set(12 + sh, 15 + b, BRASS);
    }
    line(c, 20 + sh, 13 + b, 18 + sh, 18 + b, DWOOD.c1);
    line(c, 21 + sh, 13 + b, 19 + sh, 18 + b, DWOOD.c0);
    c.set(20 + sh, 15 + b, GOLD0);
  } else {
    // the harness crossing his back under the keg
    line(c, 10 + sh, 14 + b, 21 + sh, 21 + b, DWOOD.c1);
    line(c, 21 + sh, 14 + b, 10 + sh, 21 + b, DWOOD.c1);
  }
  for (let x = 9; x <= 22; x++) c.set(x + sh, 20 + b, x % 2 ? EN.rope : WOOD.c3); // rope belt
  // head, low and forward between the shoulders: leather skullcap with ear flaps, heavy brow, stubble
  const hx = 16 + lx + (o.flinch ? -1 : 0) + (side ? 3 : dir === 'SE' ? 2 : 0);
  const hy = 11 + b + o.hunch + ly;
  const S = SKIN_MULE;
  if (back) {
    c.ellipse(hx, hy, 3.8, 3.4, S.c1);
    c.hline(hx - 2, hy + 2, 5, S.c0); // neck folds
  } else {
    litBall(c, hx, hy, 3.8, 3.5, S);
    const f = faceX(dir, hx);
    c.hline(f - 2, hy, 5, S.c0); // brow
    c.set(f - 1, hy + 1, o.flinch ? P.ember : P.ink);
    if (!side) c.set(f + 1, hy + 1, o.flinch ? P.ember : P.ink);
    c.set(f, hy + 1, S.c3); // broad nose
    c.set(f, hy + 2, S.c0);
    c.hline(f - 2, hy + 3, 5, mix(S.c1, P.dark1, 0.45)); // stubble
    c.set(f, hy + 3, P.dark1); // mouth
    c.set(f + 1, hy + 3, SOOT);
  }
  c.ellipse(hx, hy - 1, 4, 3, DWOOD.c1, (_x, y) => y < hy - 1);
  c.hline(hx - 2, hy - 3, 2, DWOOD.c3);
  c.hline(hx - 4, hy - 1, 8, DWOOD.c2); // cap edge
  c.rect(hx - 4, hy, 1, 2, DWOOD.c1); // ear flaps
  c.rect(hx + 3, hy, 1, 2, DWOOD.c0);
  if (back) kegAt(c, kx, 22 + b, 6, true);
  // thick arms hanging to the knees: rolled sleeves, bare forearms, big hands
  const arm = (x: number, lit: boolean) => {
    c.rect(x + sh, 14 + b, 2, 4, lit ? LINEN.c3 : LINEN.c1);
    c.set(x + sh + (lit ? 1 : 0), 15 + b, lit ? LINEN.c2 : LINEN.c0);
    c.hline(x + sh, 18 + b, 2, lit ? LINEN.c2 : LINEN.c0); // the roll
    c.rect(x + sh, 19 + b, 2, 3, lit ? S.c2 : S.c1);
    c.vline(x + sh + (lit ? 0 : 1), 19 + b, 3, lit ? S.c3 : S.c0);
    c.rect(x + sh - (lit ? 1 : 0), 22 + b, 3, 3, lit ? S.c2 : S.c1);
    c.set(x + sh - (lit ? 1 : 0), 22 + b, lit ? S.c3 : S.c2);
    c.hline(x + sh - (lit ? 1 : 0), 24 + b, 3, S.c0);
  };
  if (side) arm(15, true);
  else {
    arm(7, true);
    arm(23, false);
  }
}
function muleDeath(c: Img, f: number) {
  if (f < 2) return drawMule(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true });
  c.ellipse(16, 25, 8, 3, LINEN.c1);
  c.ellipse(14, 24.5, 5, 1.8, LINEN.c2);
  c.ellipse(12, 24, 3, 1.5, SKIN_MULE.c1); // his head
  c.hline(10, 23, 4, DWOOD.c1);
  kegAt(c, 22, 26, 4, f < 4); // his keg, still fizzing, then scattered staves
  if (f === 4) {
    c.rect(18, 24, 7, 2, POWDER);
    c.set(20, 24, SOOT);
  }
}

// --- Fuse-Runner: a thin, soot-smeared boy in rags with a smoking linstock, running barefoot. A red rag at
// his throat, a coil of fuse at his hip, a band of soot across white eyes.
function drawRunner(c: Img, dir: Dir5, pose: BodyPose & { arm?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, arm: 0, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const [fx] = FACE_VEC[dir];
  const S = SKIN_BOY;
  const liftL = o.step === 1 ? 3 : 0;
  const liftR = o.step === 3 ? 3 : 0;
  // brown breeches to the knee, bare shins and feet
  for (const [x, lift, dark] of [[13, liftL, 0], [17, liftR, 1]] as const) {
    c.rect(x, 20 + b, 2, 3, dark ? WOOD.c0 : P.wood1);
    c.set(x, 20 + b, dark ? P.wood1 : WOOD.c2);
    c.rect(x, 23 + b, 2, 3 - lift, dark ? S.c0 : S.c1);
    c.rect(x - (dark ? 0 : 1), 26 - lift, 3, 1, dark ? S.c0 : S.c1);
  }
  // the red rag's tail flies out behind him
  const tail = fx > 0.3 ? -1 : 1;
  const flap = o.step % 2 ? 1 : 0;
  const tx = 16 + sh + tail * 4;
  c.set(tx, 13 + b, P.ember);
  c.set(tx + tail, 14 + b - flap, P.ember);
  c.set(tx + tail * 2, 14 + b, mix(P.ember, P.blood1, 0.5));
  // off arm (the far one in profile)
  const offX = dir === 'E' ? 13 + sh : 11 + sh;
  c.vline(offX, 14 + b, 4, dir === 'E' ? RAG.c0 : RAG.c3);
  c.set(offX, 18 + b, S.c1);
  // ragged shirt, too big for him, a patch on it
  for (let y = 13; y <= 20; y++) {
    const x0 = 12 + (y < 17 ? sh : 0);
    for (let x = 0; x < 8; x++) c.set(x0 + x, y + b, shadeT(x / 7, RAG));
  }
  for (const x of [13, 16, 18]) c.set(x, 20 + b, null); // tatters
  c.set(12, 21 + b, RAG.c2);
  c.set(15, 21 + b, RAG.c1);
  c.set(19, 21 + b, RAG.c0);
  line(c, 14 + sh, 15 + b, 14, 19 + b, RAG.c1); // a fold
  if (!back) {
    c.rect(17 + sh, 15 + b, 2, 2, mix(P.wood2, P.stone2, 0.5)); // patch
    c.set(17 + sh, 15 + b, mix(P.wood2, P.stone3, 0.5));
  }
  for (let x = 12; x < 20; x++) c.set(x, 18 + b, x % 2 ? EN.rope : WOOD.c3); // rope belt
  // a coil of spare fuse at the hip
  if (dir !== 'E') {
    const cx0 = back ? 19 : 12;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) c.set(cx0 + dx, 19 + dy + b, P.wax1);
    c.set(cx0, 19 + b, SOOT);
  }
  // the neck rag
  c.hline(13 + sh, 13 + b, 6, P.ember);
  c.set(13 + sh, 13 + b, mix(P.ember, P.flame1, 0.45));
  c.set(18 + sh, 13 + b, mix(P.ember, P.blood1, 0.5));
  if (!back) c.set(16 + sh, 14 + b, mix(P.ember, P.blood1, 0.4)); // the knot
  // head: soot-rubbed face, white eyes in a band of soot, a gap-toothed grin; a floppy knit cap
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 9 + b + o.hunch + ly;
  if (back) c.disc(hx, hy, 3.2, P.dark1);
  else {
    litBall(c, hx, hy, 3.3, 3.2, S);
    const f = faceX(dir, hx);
    c.hline(f - 2, hy, dir === 'E' ? 4 : 5, SOOT); // the soot band
    c.set(f - 1, hy, o.flinch ? P.ember : P.wax2);
    if (dir !== 'E') c.set(f + 1, hy, o.flinch ? P.ember : P.wax2);
    else c.set(f + 1, hy, P.ink);
    c.set(f - 1, hy + 2, P.ink); // grin
    c.set(f, hy + 2, P.wax2);
    c.set(f + 1, hy + 2, P.ink);
    c.set(hx - 2, hy + 1, S.c3); // a clean cheek
  }
  c.ellipse(hx, hy - 1.5, 3.7, 2.4, RAG.c2, (_x, y) => y < hy);
  c.ellipse(hx - 0.5, hy - 2, 2.5, 1.4, RAG.c3, (_x, y) => y < hy - 1);
  for (let x = -3; x <= 3; x++) c.set(hx + x, hy - 1, x % 2 ? RAG.c1 : RAG.c2); // ribbing
  const tipX = hx + (fx > 0.3 ? -4 : 4);
  c.set(tipX, hy - 3, RAG.c2); // the floppy end
  c.set(tipX + Math.sign(tipX - hx), hy - 2, RAG.c1);
  c.set(tipX + Math.sign(tipX - hx), hy - 1, P.ember); // a bobble
  c.set(hx - 3, hy, P.dark1); // hair sticking out
  c.set(hx + 3, hy + 1, P.dark1);
  // the linstock: a forked stick with a glowing slow-match, held out (arm 1 = thrust forward)
  const ax = 16 + sh + Math.round((6 + o.arm * 3) * (fx || 0.7));
  const ay = 16 + b - Math.round(o.arm * 4);
  const shx = dir === 'E' ? 17 + sh : 19 + sh;
  line(c, shx, 14 + b, ax, ay, back ? RAG.c1 : RAG.c2);
  line(c, shx + 1, 14 + b, ax + 1, ay, RAG.c0);
  line(c, ax, ay + 2, ax + 3, ay - 6, WOOD.c2);
  c.set(ax + 1, ay - 1, WOOD.c3);
  c.set(ax + 2, ay - 7, WOOD.c1); // the fork
  c.set(ax + 4, ay - 7, WOOD.c1);
  c.rect(ax, ay, 2, 2, S.c2); // his fist
  c.set(ax + 1, ay + 1, S.c1);
  c.set(ax + 3, ay - 7, P.ember);
  c.set(ax + 3, ay - 8, P.flame2);
  c.set(ax + 4, ay - 8, P.flame1);
  c.set(ax + 3, ay - 9, P.wax2);
  c.set(ax + 4, ay - 10, withAlpha(P.stone4, 170)); // a thread of smoke
  c.set(ax + 4, ay - 11, withAlpha(P.stone4, 110));
}
function runnerDeath(c: Img, f: number) {
  if (f < 2) return drawRunner(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true });
  c.ellipse(16, 25, 7, 2.5, RAG.c1);
  c.ellipse(15, 24.5, 4, 1.4, RAG.c2);
  c.disc(10, 24, 2, SKIN_BOY.c1);
  c.hline(12, 23, 4, P.ember);
  line(c, 18, 25, 24, 22, P.wood1);
  if (f < 4) {
    c.set(24, 21, P.flame2);
    c.set(25, 20, withAlpha(P.stone4, 150));
  }
}

// --- The Master Gunner on foot (48 cell): an old one-eyed gunner in a long red coat with buff facings and
// brass buttons, gold epaulettes, a crossbelt and cartridge box, a grey forked beard, a gold-laced tricorn.
type DuelPose = BodyPose & { aim?: number; club?: number; toss?: number; crouch?: number };
const DUEL_HAND: Record<Dir5, [number, number]> = { S: [31, 29], SE: [31, 28], E: [29, 28], NE: [30, 26], N: [30, 26] };
function duelHand(dir: Dir5, p: DuelPose): [number, number] {
  const [hx, hy] = DUEL_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const aim = p.aim ?? 0;
  const club = p.club ?? 0;
  return [Math.round(hx + lx + fx * aim * 3 - club * 4), Math.round(hy + ly + fy * aim * 2 - club * 8 + (p.bob ?? 0) + (p.crouch ?? 0) * 2)];
}
/** A coat arm from the shoulder to the hand: shaded sleeve, a big buff cuff, a leather gauntlet. */
function coatArm(c: Img, sx: number, sy: number, hx: number, hy: number, far: boolean, inner: -1 | 1 = 1) {
  for (let t = -1; t <= 1; t++)
    line(c, sx + t, sy, hx + t, hy - 3, far ? (t === -1 ? COAT.c1 : COAT.c0) : t === inner ? COAT.c0 : t === -inner ? (inner > 0 ? COAT.c3 : COAT.c2) : COAT.c2);
  c.hline(hx - 1, hy - 3, 3, far ? BUFF.c1 : BUFF.c2);
  c.hline(hx - 1, hy - 2, 3, far ? BUFF.c0 : BUFF.c1);
  c.set(hx + 1, hy - 3, BRASS);
  c.rect(hx - 1, hy - 1, 3, 3, far ? WOOD.c1 : WOOD.c2);
  c.set(hx - 1, hy - 1, far ? WOOD.c2 : WOOD.c3);
  c.set(hx + 1, hy + 1, WOOD.c0);
}
function drawDuel(c: Img, dir: Dir5, pose: DuelPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, aim: 0, club: 0, toss: 0, crouch: 0, ...pose };
  const b = o.bob + o.crouch * 2;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  const toe = dir === 'E' ? 1 : dir === 'SE' ? 1 : 0;
  // tall black boots with turned-down brown tops
  for (const [x, lift, dark] of [[19, liftL, 0], [26, liftR, 1]] as const) {
    const y0 = 36 + b;
    const h = 44 - y0 - lift;
    c.rect(x, y0, 4, h, dark ? HAT.c1 : HAT.c2);
    c.vline(x, y0, h, dark ? HAT.c2 : HAT.c3);
    c.vline(x + 3, y0, h, HAT.c0);
    c.hline(x, y0, 4, dark ? WOOD.c1 : WOOD.c2);
    c.hline(x, y0 + 1, 4, dark ? WOOD.c0 : P.wood1);
    c.hline(x + toe, 43 - lift, 4, HAT.c0); // sole
  }
  const cxs = 24 + sh;
  const [gx, gy] = duelHand(dir, o);
  // the off hand: at his side, or up with a keg to throw
  const offS: [number, number] = [dir === 'E' ? cxs - 1 : cxs - 6, 19 + b];
  const offH: [number, number] =
    o.toss > 0 ? [Math.round(cxs - 8 - o.toss), Math.round(30 + b - o.toss * 15)] : dir === 'E' ? [cxs - 3, 30 + b] : [cxs - 9, 30 + b];
  const farOff = dir === 'E' || dir === 'NE';
  if (farOff) coatArm(c, offS[0], offS[1], offH[0], offH[1], true);
  // the long coat, to the boot-tops, split below the belt
  const coatW = (y: number) => 13 + Math.floor((y - 18) / 2.5);
  for (let y = 18; y <= 38; y++) {
    const w = coatW(y);
    const x0 = 24 - Math.floor(w / 2) + (y < 29 ? sh : 0);
    for (let x = 0; x < w; x++) c.set(x0 + x, y + b, y === 38 ? (x < 2 ? COAT.c1 : COAT.c0) : shadeT(x / (w - 1), COAT));
  }
  const skirtX = 24 + (dir === 'SE' ? 2 : dir === 'E' ? 4 : 0);
  if (back) {
    c.vline(24, 30 + b, 9, COAT.c0); // the vent
    c.set(22, 29 + b, BRASS);
    c.set(26, 29 + b, BRASS);
    line(c, 20, 30 + b, 18, 37 + b, COAT.c1);
    line(c, 28, 30 + b, 30, 37 + b, COAT.c0);
  } else {
    // the skirts part over buff breeches, their buff lining turned back
    for (let y = 30; y <= 38; y++) {
      const g = Math.min(3, Math.floor((y - 30) / 2));
      for (let dx = -g; dx <= g; dx++) c.set(skirtX + dx, y + b, Math.abs(dx) === g ? (dx < 0 ? BUFF.c2 : BUFF.c0) : BUFF.c1);
    }
    line(c, skirtX - 6, 30 + b, skirtX - 8, 37 + b, COAT.c1); // folds
    line(c, skirtX + 6, 30 + b, skirtX + 8, 37 + b, COAT.c0);
  }
  // collar and gold epaulettes
  c.hline(cxs - 4, 18 + b, 9, COAT.c3);
  for (const [ex, lit] of [[cxs - 7, 1], [cxs + 5, 0]] as const) {
    if (dir === 'E' && !lit) continue;
    const x = dir === 'E' ? cxs - 2 : ex;
    c.hline(x, 18 + b, 3, lit ? P.flame2 : P.flame1);
    c.hline(x, 19 + b, 3, lit ? P.flame1 : GOLD0);
    c.set(x, 20 + b, GOLD0); // the fringe
    c.set(x + 2, 20 + b, GOLD0);
  }
  if (!back) {
    // buff lapels with brass buttons in pairs, a dark red waistcoat between them
    const lp = cxs + (dir === 'SE' ? 1 : dir === 'E' ? 3 : 0);
    for (let y = 19; y <= 28; y++) {
      const lw = y < 24 ? 2 : 1;
      if (dir !== 'E') for (let k = 1; k <= lw; k++) c.set(lp - 1 - k, y + b, k === lw ? BUFF.c3 : BUFF.c2);
      c.hline(lp - 1, y + b, 2, COAT.c1);
      for (let k = 1; k <= lw; k++) c.set(lp + k, y + b, k === lw ? BUFF.c0 : BUFF.c1);
    }
    for (let y = 20; y < 28; y += 3) {
      c.set(lp + 2, y + b, BRASS);
    }
    // the buff crossbelt, shoulder to hip, a brass plate where it crosses the chest
    line(c, cxs - 6, 19 + b, cxs + 5, 28 + b, BUFF.c2);
    c.rect(cxs - 1, 23 + b, 2, 2, BRASS);
    c.set(cxs - 1, 23 + b, P.flame2);
    // a powder horn on a cord at the left hip
    c.set(cxs - 7, 29 + b, P.wax2);
    c.set(cxs - 6, 30 + b, P.wax1);
    c.set(cxs - 5, 31 + b, P.wax1);
    c.set(cxs - 4, 31 + b, BUFF.c0);
    c.set(cxs - 3, 30 + b, P.dark1);
  } else {
    line(c, cxs + 6, 19 + b, cxs - 5, 28 + b, BUFF.c1);
    line(c, cxs + 6, 20 + b, cxs - 5, 29 + b, BUFF.c0);
  }
  // black belt, big brass buckle; the cartridge box on the right hip
  const bw = coatW(28);
  c.hline(24 - Math.floor(bw / 2) + sh, 28 + b, bw, HAT.c2);
  c.hline(24 - Math.floor(bw / 2) + sh, 29 + b, bw, HAT.c1);
  if (!back) {
    c.rect(skirtX - 1 + sh, 28 + b, 3, 2, BRASS);
    c.set(skirtX - 1 + sh, 28 + b, P.flame2);
  }
  const boxX = back ? cxs - 7 : cxs + 4;
  c.rect(boxX, 29 + b, 4, 3, HAT.c2);
  c.hline(boxX, 29 + b, 4, HAT.c3);
  c.set(boxX + 1, 30 + b, BRASS);
  // arms: the gun hand out to the side, the off hand free (it tosses kegs)
  const gunS: [number, number] = [cxs + (dir === 'E' ? 2 : dir === 'SE' || dir === 'NE' ? 5 : 6), 19 + b];
  coatArm(c, gunS[0], gunS[1], gx, gy, false, dir === 'E' ? 1 : -1);
  if (!farOff) coatArm(c, offS[0], offS[1], offH[0], offH[1], false);
  if (o.toss >= 0.3) kegAt(c, offH[0], offH[1] - 1, 3, true);
  // head: weathered face, an eyepatch, one eye lit like a fuse, a big nose, a grey forked beard in braids
  const hx = 24 + lx + (o.flinch ? -2 : 0);
  const hy = 11 + b + o.hunch + ly;
  const S = SKIN_OLD;
  if (back) {
    litBall(c, hx, hy, 4.2, 4.5, { c0: P.dark2, c1: P.stone1, c2: P.stone2, c3: P.stone3 });
    for (const dx of [-2, 0, 2]) c.vline(hx + dx, hy - 1, 3, P.stone1); // combed back
    c.hline(hx - 3, hy + 3, 7, S.c1); // the nape
    c.vline(hx, hy + 3, 6, GREY.c2); // the queue, tied with a red ribbon
    c.vline(hx + 1, hy + 3, 6, GREY.c0);
    c.rect(hx, hy + 4, 2, 2, P.blood2);
    c.set(hx - 1, hy + 5, P.blood1);
    c.set(hx + 2, hy + 5, P.blood1);
    if (dir === 'NE') c.rect(hx + 3, hy + 2, 2, 4, GREY.c1); // his beard, past his cheek
  } else {
    litBall(c, hx, hy, 4.3, 4.6, S);
    const f = faceX(dir, hx);
    c.hline(f - 3, hy - 1, dir === 'E' ? 6 : 7, S.c0); // heavy brow
    const eye = o.flinch ? P.ember : P.flame2;
    if (dir === 'E') {
      c.set(f + 1, hy, eye);
      c.set(f + 2, hy, P.ember);
    } else {
      c.rect(f - 2, hy - 1, 2, 2, P.ink); // the patch, its strap across the brow
      line(c, f - 4, hy - 3, f, hy - 1, HAT.c0);
      c.set(f + 1, hy, eye);
      c.set(f + 1, hy - 1, P.flame1);
      c.set(f + 2, hy, P.ember);
    }
    c.set(f, hy + 1, mix(S.c2, P.ember, 0.45)); // the drinker's nose
    c.set(f, hy + 2, S.c0);
    c.set(hx - 3, hy + 1, S.c3);
    // moustache and beard
    c.hline(f - 3, hy + 2, 7, GREY.c2);
    c.set(f - 4, hy + 1, GREY.c3);
    c.set(f + 4, hy + 1, GREY.c1);
    const rows = [7, 7, 5, 5, 3];
    rows.forEach((w, i) => {
      const y = hy + 3 + i;
      for (let x = 0; x < w; x++) c.set(f - Math.floor(w / 2) + x, y, (x + i) % 3 === 2 ? GREY.c0 : shadeT(x / Math.max(1, w - 1), GREY));
    });
    for (const dx of [-1, 1]) {
      c.set(f + dx, hy + 8, GREY.c1); // two braids
      c.set(f + dx, hy + 9, P.ember); // with ember beads
    }
    c.set(f, hy + 8, null);
  }
  // hair at the temples
  c.set(hx - 4, hy - 1, GREY.c2);
  c.set(hx + 4, hy - 1, GREY.c1);
  // the tricorn: a crown, a wide cocked brim laced with gold, a red cockade with a brass badge
  const tc = hx + (dir === 'SE' ? 1 : dir === 'E' ? 1 : 0);
  const hat: [number, number, number][] = [[-9, -2, 5], [-8, -4, 9], [-7, -4, 9], [-6, -8, 17], [-5, -7, 15], [-4, -5, 11]];
  for (const [dy, x0, w] of hat) for (let x = 0; x < w; x++) c.set(tc + x0 + x, hy + dy, shadeT(x / (w - 1), HAT));
  for (const s of [-1, 1]) {
    c.set(tc + s * 7, hy - 7, HAT.c2); // the cocked-up wings
    c.set(tc + s * 8, hy - 7, s < 0 ? HAT.c3 : HAT.c1);
  }
  for (let x = -8; x <= 8; x++) if (Math.abs(x) >= 5) c.set(tc + x, hy - 6, x < 0 ? P.flame1 : GOLD0); // gold lace
  c.hline(tc - 2, hy - 8, 2, HAT.c3);
  if (!back) {
    for (let x = -4; x <= 4; x++) c.set(tc + x, hy - 4, x < 0 ? P.flame1 : GOLD0);
    c.set(tc, hy - 3, HAT.c1); // the front point
    c.rect(tc + 3, hy - 8, 2, 2, P.blood2);
    c.set(tc + 3, hy - 8, P.flame2);
  }
}
function duelDeath(c: Img, f: number) {
  if (f < 2) return drawDuel(c, 'S', { bob: 3 + f * 2, hunch: 2 + f, flinch: true });
  c.ellipse(24, 41, 13, 4, COAT.c1);
  c.ellipse(21, 40, 7, 2.5, COAT.c2);
  c.ellipse(19, 39.5, 3, 1.2, COAT.c3);
  c.ellipse(33, 40, 3.5, 2, GREY.c1); // his beard
  c.hline(10, 39, 11, HAT.c2); // his hat, fallen
  c.hline(12, 38, 7, HAT.c3);
  c.hline(10, 40, 11, GOLD0);
  c.set(20, 41, BRASS);
  c.set(27, 41, BRASS);
  if (f < 4) c.set(36, 38, P.flame2); // the eye, going out
}

// --- The Master Gunner, first form (64 cell): his great cannon on its trail carriage, the Gunner himself
// standing at the breech with his linstock (the same man as on foot, drawn into this cell).
type CannonPose = BodyPose & { recoil?: number; smoke?: number; lift?: number; stand?: number; roll?: number };
/** Deterministic noise for flame tongues and smoke edges. */
const hash2 = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
function drawCannon(c: Img, dir: Dir5, pose: CannonPose) {
  const o = { bob: 0, lean: 0, hunch: 0, flinch: false, recoil: 0, smoke: 0, lift: 0, stand: 0, roll: 0, ...pose };
  const [fx, fy] = FACE_VEC[dir];
  const cx = 32 - Math.round(fx * o.recoil * 3);
  const base = 56 - Math.round(fy * o.recoil * 2);
  const back = dir === 'N' || dir === 'NE';
  // ground-plane projection: a along the facing, s along the axle, h up
  const K = 1.25; // the gun is drawn a size up from the man
  const at = (a: number, s: number, h: number): [number, number] => [cx + (fx * a - fy * s) * K, base - 1 + ((fy * a + fx * s) * 0.5 - h) * K];

  // --- the Gunner, at the breech
  const duelPose: DuelPose = {
    bob: o.bob,
    hunch: o.hunch,
    crouch: o.hunch > 0 && !o.stand ? 1 : 0,
    lean: o.recoil > 0 ? -2 : o.hunch > 0 ? 1 : o.lean,
    flinch: o.flinch,
  };
  const spot: Record<Dir5, [number, number]> = { S: [12, 46], SE: [-9, 47], E: [-17, 53], NE: [-16, 57], N: [-20, 57] };
  const gfx = cx + spot[dir][0];
  const gfy = Math.max(45, base - 56 + spot[dir][1] - Math.round(o.stand * 3));
  const drawGunner = () => {
    const g = new Img(48, 48);
    drawDuel(g, dir, duelPose);
    g.outline(P.ink);
    c.blit(g, gfx - 24, gfy - 44);
    // his linstock: upright at rest, down to the touch-hole as he fires
    const [hx0, hy0] = duelHand(dir, duelPose);
    const hx = hx0 + gfx - 24;
    const hy = hy0 + gfy - 44;
    const [thx, thy] = at(-7, 0, 22);
    const [tx, ty] = o.hunch > 0 && !o.stand ? [Math.round(thx), Math.round(thy)] : [hx + 3, hy - 13];
    line(c, hx, hy + 2, tx, ty + 1, WOOD.c2);
    c.set(tx, ty, P.ember);
    c.set(tx, ty - 1, P.flame2);
    c.set(tx + 1, ty - 2, withAlpha(P.stone4, 150));
    if (o.hunch >= 2) {
      c.set(tx - 1, ty - 1, P.wax2); // the priming catches
      c.set(tx + 1, ty, P.flame1);
    }
  };
  const gunnerInFront = back;
  // --- wheels: iron tyre, oak felloe, see-through spokes, a bronze hub
  const wheelR = 8 * K;
  const wheel = (wx: number, wy: number, spin: number) => {
    const rx = Math.max(4, wheelR * Math.abs(fx));
    const ry = wheelR;
    for (let y = Math.floor(wy - ry); y <= Math.ceil(wy + ry); y++)
      for (let x = Math.floor(wx - rx); x <= Math.ceil(wx + rx); x++) {
        const nx = (x + 0.5 - wx) / rx;
        const ny = (y + 0.5 - wy) / ry;
        const d = Math.hypot(nx, ny);
        if (d > 1) continue;
        const lit = -(nx + ny) * 0.7; // light from the top left
        if (rx < 3.5) {
          // edge-on: a band of oak with iron on its rim
          c.set(x, y, d > 0.86 ? (lit > 0 ? IRON.c3 : IRON.c1) : nx < -0.2 ? WOOD.c3 : nx > 0.4 ? WOOD.c1 : WOOD.c2);
          continue;
        }
        if (d > 0.86) c.set(x, y, lit > 0.3 ? IRON.c3 : lit > -0.1 ? IRON.c2 : lit > -0.5 ? IRON.c1 : IRON.c0);
        else if (d > 0.68) c.set(x, y, lit > 0.2 ? WOOD.c3 : lit > -0.3 ? WOOD.c2 : WOOD.c1);
        else if (d < 0.24) c.set(x, y, d < 0.12 ? BRONZE.c2 : lit > 0 ? IRON.c3 : IRON.c1);
        else {
          const ang = Math.atan2(ny, nx) - spin * 0.35;
          const k = (ang / (Math.PI * 2)) * 8;
          const off = Math.abs(k - Math.round(k)) * ((Math.PI * 2) / 8) * d * wheelR;
          if (off < 0.75) c.set(x, y, lit > 0 ? WOOD.c3 : WOOD.c2);
        }
      }
  };
  // --- the carriage: two cheeks on the axle, the trail running back to the ground
  const sides = [-6, 6].sort((p, q) => at(0, p, 0)[1] - at(0, q, 0)[1]); // far side first
  const wheelAt = (s: number) => at(0, s * 1.55, 8);
  const cheek = (s: number, near: boolean) => {
    for (let h = 8; h <= 16; h++) {
      const col = h === 16 ? WOOD.c3 : h >= 14 ? WOOD.c2 : h >= 10 ? WOOD.c1 : WOOD.c0;
      const [x0, y0] = at(-9, s, h - 5);
      const [x1, y1] = at(4, s, h);
      line(c, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), near ? col : mix(col, WOOD.c0, 0.4));
    }
    if (near)
      for (const a of [-5, 1]) {
        const [bx, by] = at(a, s, 12);
        c.set(Math.round(bx), Math.round(by), IRON.c3); // bolts
      }
  };
  const trail = () => {
    for (let w = -2; w <= 2; w++)
      for (let h = 0; h <= 3; h++) {
        const [x0, y0] = at(-2, w, 9 + h);
        const [x1, y1] = at(-16, w * 0.6, 1 + h);
        const col = h === 3 ? (w < 0 ? WOOD.c3 : WOOD.c2) : h === 2 ? WOOD.c2 : WOOD.c1;
        line(c, Math.round(x0), Math.round(y0), Math.round(x1), Math.min(61, Math.round(y1)), Math.abs(w) === 2 ? mix(col, WOOD.c0, 0.4) : col);
      }
  };
  // --- the barrel: a tapering black-iron tube with bronze rings and a flared muzzle, shaded as a cylinder
  const len = 24;
  const [tpx, tpy] = at(0, 0, 17); // the trunnions
  const L2 = Math.round(len * K * (0.55 + 0.45 * Math.abs(fx))); // screen length (foreshortened toward or away)
  const ux0 = fx;
  const uy0 = fy * 0.6;
  const A: [number, number] = [tpx - ux0 * L2 * 0.4, tpy - uy0 * L2 * 0.4 + o.lift * 1.5];
  const B: [number, number] = [tpx + ux0 * L2 * 0.6, tpy + uy0 * L2 * 0.6 - o.lift * 3.5];
  const ax = B[0] - A[0];
  const ay = B[1] - A[1];
  const sl = Math.max(0.01, Math.hypot(ax, ay));
  const ux = ax / sl;
  const uy = ay / sl;
  const profile = (t: number) => (t < 0.08 ? 5.6 : t < 0.14 ? 6.2 : t > 0.9 ? 5 : t > 0.48 && t < 0.54 ? 5.3 : 5.2 - t * 1.2);
  const ringAt = (t: number) => (t >= 0.08 && t < 0.14) || (t > 0.48 && t < 0.54) || t > 0.9;
  const toward = fy > 0.3; // the muzzle end is the near one
  const tubePx = (x: number, y: number, capOnly: boolean) => {
    const px = x + 0.5 - A[0];
    const py = y + 0.5 - A[1];
    const t = (px * ux + py * uy) / sl;
    const s = -px * uy + py * ux;
    if (t < 0 || t > 1 || capOnly) return false;
    const r = profile(t) * K;
    if (Math.abs(s) > r) return false;
    const n = s / r; // -1..1 across the tube; the normal points along (-uy, ux) * n
    const nx = -uy * n;
    const ny = ux * n;
    const lit = -(nx * 0.6 + ny * 0.8) + Math.sqrt(1 - n * n) * 0.35;
    const R = ringAt(t) ? BRONZE : IRON;
    c.set(x, y, lit > 0.75 ? (ringAt(t) ? R.c3 : P.steel2) : lit > 0.45 ? R.c3 : lit > 0.05 ? R.c2 : lit > -0.45 ? R.c1 : R.c0);
    return true;
  };
  const cap = (P0: [number, number], r: number, squash: number, ramp: Ramp) => {
    for (let y = Math.floor(P0[1] - r - 1); y <= Math.ceil(P0[1] + r + 1); y++)
      for (let x = Math.floor(P0[0] - r - 1); x <= Math.ceil(P0[0] + r + 1); x++) {
        const px = x + 0.5 - P0[0];
        const py = y + 0.5 - P0[1];
        const a = (px * ux + py * uy) / (r * squash);
        const s = (-px * uy + py * ux) / r;
        const d = a * a + s * s;
        if (d > 1) continue;
        const lit = -(px * 0.6 + py * 0.8) / r;
        c.set(x, y, lit > 0.5 ? ramp.c3 : lit > 0 ? ramp.c2 : lit > -0.5 ? ramp.c1 : ramp.c0);
      }
  };
  const squash = 0.25 + 0.65 * Math.max(Math.abs(fy), 1 - L2 / len);
  const barrel = () => {
    const x0 = Math.floor(Math.min(A[0], B[0]) - 8);
    const x1 = Math.ceil(Math.max(A[0], B[0]) + 8);
    const y0 = Math.floor(Math.min(A[1], B[1]) - 8);
    const y1 = Math.ceil(Math.max(A[1], B[1]) + 8);
    const knob: [number, number] = [A[0] - ux * 3, A[1] - uy * 3];
    if (toward || dir === 'E') {
      c.disc(knob[0], knob[1], 2.2, IRON.c1); // the cascabel, behind
      c.set(knob[0] - 1, knob[1] - 1, IRON.c3);
      cap(A, 5.6 * K, squash, IRON);
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tubePx(x, y, false);
    if (toward || dir === 'E') {
      // the muzzle face: a bronze swell and the bore
      cap(B, 5.2 * K, squash, BRONZE);
      cap(B, 4.2 * K, squash, IRON);
      const lit = o.recoil > 0 && o.smoke > 0;
      c.ellipse(B[0] + ux * 0.4, B[1] + uy * 0.4, dir === 'E' ? 1.2 : 3.4, dir === 'E' ? 3.4 : 3, lit ? P.flame2 : P.ink);
      if (!lit && toward) c.set(Math.round(B[0] - 2), Math.round(B[1] - 2), IRON.c1);
    } else {
      cap(A, 5.6 * K, squash, IRON); // from behind: the breech, and its knob
      c.disc(knob[0], knob[1], 2.2, IRON.c1);
      c.set(knob[0] - 1, knob[1] - 1, IRON.c3);
    }
    // the touch-hole and a vent-plate
    const [thx, thy] = at(-7, 0, 22);
    c.set(Math.round(thx), Math.round(thy), P.ink);
    c.set(Math.round(thx) - 1, Math.round(thy), BRONZE.c2);
    // trunnion caps: iron straps over the barrel on each cheek
    for (const s of sides) {
      const [qx, qy] = at(0, s, 17);
      c.set(Math.round(qx), Math.round(qy), IRON.c3);
      c.set(Math.round(qx), Math.round(qy) + 1, IRON.c1);
    }
  };

  // --- muzzle blast: a tongue of flame out of the bore, then rolling powder smoke
  const blast = () => {
    if (o.smoke <= 0) return;
    const flame = o.recoil > 0 ? Math.min(1, o.recoil / 3) : 0;
    // smoke puffs: far ones first
    const puffs: [number, number, number, number][] = [];
    const n = 6;
    for (let k = n - 1; k >= 0; k--) {
      const s = Math.min(o.smoke, 1.6);
      const d = 4 + k * 1.8 * s;
      const px = B[0] + ux * d * (dir === 'S' ? 0.5 : 1) + (hash2(k, 3) - 0.5) * 4 * s;
      const py = B[1] + uy * d * (dir === 'S' ? 0.5 : 1) - k * s * 2 - (flame ? 0 : 4);
      const pr = Math.min(7, 2.5 + k * 0.6 * s + (o.smoke > 1.6 ? 1 : 0));
      puffs.push([px, py, pr, k]);
    }
    const fade = o.smoke > 1.6 ? 200 : 255;
    for (const [px, py, pr, k] of puffs) {
      c.ellipse(px, py, pr, pr * 0.85, withAlpha(P.stone2, fade));
      c.ellipse(px - pr * 0.2, py - pr * 0.2, pr * 0.75, pr * 0.62, withAlpha(P.stone3, fade));
      c.ellipse(px - pr * 0.4, py - pr * 0.4, pr * 0.38, pr * 0.3, withAlpha(P.stone4, fade));
      if (flame && k < 2) c.ellipse(px + pr * 0.1, py + pr * 0.35, pr * 0.6, pr * 0.3, P.flame1); // lit from under by the blast
    }
    if (flame) {
      const Lf = 4 + 9 * flame;
      if (dir === 'S') {
        // straight at you: a star of flame round the muzzle
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + 0.3;
          const l = (4 + hash2(k, 1) * 5) * flame + 3;
          line(c, Math.round(B[0]), Math.round(B[1]), Math.round(B[0] + Math.cos(a) * l), Math.round(B[1] + Math.sin(a) * l * 0.8), k % 2 ? P.flame1 : P.ember);
        }
        c.disc(B[0], B[1], 3 + 2.5 * flame, P.flame2);
        c.disc(B[0], B[1], 1.5 + 1.5 * flame, P.wax2);
        return;
      }
      for (let y = Math.floor(B[1] - Lf); y <= Math.ceil(B[1] + Lf); y++)
        for (let x = Math.floor(B[0] - Lf); x <= Math.ceil(B[0] + Lf); x++) {
          const px = x + 0.5 - B[0];
          const py = y + 0.5 - B[1];
          const t = px * ux + py * uy;
          const s = Math.abs(-px * uy + py * ux);
          if (t < -1 || t > Lf) continue;
          const w = (1.8 + t * 0.5) * (0.6 + 0.4 * flame) * (1 - Math.max(0, (t - Lf * 0.7) / (Lf * 0.3)));
          const jag = w * (0.75 + hash2(x, y) * 0.5);
          if (s > jag) continue;
          const k = s / Math.max(0.5, jag);
          c.set(x, y, t < Lf * 0.45 && k < 0.45 ? P.wax2 : k < 0.6 && t < Lf * 0.8 ? P.flame2 : k < 0.85 ? P.flame1 : P.ember);
        }
    }
  };

  const [wfx, wfy] = wheelAt(sides[0]);
  const [wnx, wny] = wheelAt(sides[1]);
  if (!gunnerInFront) drawGunner();
  wheel(wfx, wfy, o.roll + 1);
  cheek(sides[0], false);
  trail();
  if (!toward) blast(); // smoke behind the gun when it fires away from you
  barrel();
  cheek(sides[1], true);
  wheel(wnx, wny, o.roll);
  if (toward) blast();
  if (gunnerInFront) drawGunner();
}
function cannonDeath(c: Img, f: number) {
  drawCannon(c, 'S', { flinch: true, smoke: f * 0.4, bob: f });
}

// ---- The Powder Vault's tileset: a gunpowder magazine under the fort. Oak boards pinned with copper nails (iron
// strikes sparks), black powder spilled between them; red brick walls shored with oak posts, a lantern behind
// glass in its niche; heavy beams along the wall tops.
function genVaultTiles() {
  const T = 16;
  const img = new Img(T * 8, T * 8);
  const at = tileAt;
  const speck = (ox: number, oy: number, r: () => number, n: number, col: RGBA) => {
    for (let i = 0; i < n; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), col);
  };
  const VB = {
    mortar: hex('#2a1a1c'),
    b0: mix(P.blood1, P.dark1, 0.55),
    b1: mix(P.blood1, P.wood1, 0.45),
    b2: mix(P.blood1, P.wood2, 0.4),
    b3: mix(P.ember, P.wood2, 0.45),
    lime: mix(P.wax1, P.stone3, 0.35),
    copper: hex('#b8733a'),
    copperD: hex('#6e3f22'),
    powder: mix(P.ink, P.stone1, 0.35),
    powder2: mix(P.dark1, P.stone2, 0.3),
  };
  const OAK = [mix(P.wood1, P.wood2, 0.35), mix(P.wood1, P.wood2, 0.6), mix(P.wood1, P.dark2, 0.2), P.wood2];
  const cool: SlabPal = { base: mix(P.stone1, P.wood1, 0.25), mortar: mix(P.dark1, P.ink, 0.4), hi: mix(P.stone2, P.wood2, 0.3), lo: mix(P.stone1, P.dark1, 0.5) };

  // 0-3 floor: worn flags, powder in the joints
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(v);
    const r = rng(12000 + v);
    if (v < 2) flagstone(img, ox, oy, 0, 0, 16, 16, r, cool, v ? -0.2 : 0.1);
    else {
      flagstone(img, ox, oy, 0, 0, 16, 7, r, cool, 0.15);
      flagstone(img, ox, oy, 0, 7, 10, 9, r, cool, -0.1);
      flagstone(img, ox, oy, 10, 7, 6, 9, r, cool);
    }
    speck(ox, oy, r, 5, VB.powder);
  }
  // 4-11 floor_plank: broad oak boards, staggered joints, copper nails, grain, powder dust; rarer: a spilled trail
  // of powder, a scorch where a spark caught, a dropped musket ball
  for (let v = 0; v < 8; v++) {
    const [ox, oy] = at(4 + v);
    const r = rng(12100 + v);
    for (let b = 0; b < 4; b++) {
      const y = oy + b * 4;
      const c = OAK[(b * 3 + v) % 4];
      img.rect(ox, y, T, 4, c);
      img.hline(ox, y, T, mix(c, P.wax1, 0.18)); // the lit edge of the board
      img.hline(ox, y + 3, T, mix(P.wood1, P.ink, 0.55)); // the gap between boards
      for (let i = 0; i < 2; i++) img.hline(ox + Math.floor(r() * 11), y + 1 + Math.floor(r() * 2), 3 + Math.floor(r() * 3), mix(c, P.wood1, 0.45)); // grain
      const j = (3 + b * 7 + v * 5) % 16;
      if ((b + v) % 3 === 0) {
        // a board's end (boards run longer than a tile), a copper nail either side of it
        img.vline(ox + j, y, 3, mix(P.wood1, P.ink, 0.5));
        img.set(ox + ((j + 15) % 16), y + 1, VB.copperD);
        img.set(ox + ((j + 1) % 16), y + 1, VB.copper);
      } else if ((b + v) % 3 === 1) img.set(ox + j, y + 1, VB.copperD); // a nail into the joist below
      // powder settled in the gap
      for (let x = 0; x < T; x++) if (r() < 0.18) img.set(ox + x, y + 3, VB.powder2);
    }
    speck(ox, oy, r, 3, VB.powder);
    if (v === 5) {
      // a trail of spilled powder, from a split keg carried through
      for (let x = 0; x < T; x++) {
        const y = oy + 7 + Math.round(Math.sin(x * 0.5) * 1.5);
        img.set(ox + x, y, VB.powder);
        if (r() < 0.6) img.set(ox + x, y + 1, VB.powder2);
        if (r() < 0.2) img.set(ox + x, y - 1, VB.powder2);
      }
    }
    if (v === 6) {
      // a scorch where a spark caught (and was put out)
      for (let y = -3; y <= 3; y++)
        for (let x = -5; x <= 5; x++) {
          const d = (x * x) / 25 + (y * y) / 9;
          if (d < 1 && r() < 1.2 - d) img.set(ox + 8 + x, oy + 8 + y, mix(P.wood1, P.ink, 0.35 + (1 - d) * 0.35));
        }
    }
    if (v === 7) {
      img.rect(ox + 10, oy + 9, 2, 2, IRON.c1); // a dropped musket ball
      img.set(ox + 10, oy + 9, IRON.c3);
      img.hline(ox + 10, oy + 11, 2, mix(P.wood1, P.ink, 0.5));
    }
  }
  // 44-45 grate: an iron grille over the powder drain
  for (const v of [44, 45]) {
    const [ox, oy] = at(v);
    img.rect(ox, oy, T, T, P.ink);
    for (let x = 1; x < T; x += 4) {
      img.vline(ox + x, oy, T, IRON.c1);
      img.vline(ox + x + 1, oy, T, IRON.c0);
      img.set(ox + x, oy + 1, IRON.c2);
    }
    for (const y of [0, 8]) {
      img.hline(ox, oy + y, T, IRON.c2);
      img.hline(ox, oy + y + 1, T, IRON.c0);
    }
    if (v === 45) img.set(ox + 6, oy + 12, VB.powder2);
  }
  // 46-47 rock: packed black earth and fieldstones behind the magazine walls
  for (const idx of [46, 47]) {
    const [ox, oy] = at(idx);
    const r = rng(12200 + idx);
    img.rect(ox, oy, T, T, mix(P.ink, P.dark1, 0.3));
    for (let i = 0; i < 3; i++) {
      const x = ox + 2 + r() * 11;
      const y = oy + 2 + r() * 11;
      img.ellipse(x, y, 1.5 + r() * 1.5, 1 + r(), mix(P.dark1, P.stone1, 0.3));
      img.set(x - 1, y - 1, mix(P.dark2, P.stone2, 0.3));
    }
    speck(ox, oy, r, 4, P.dark1);
  }
  // wall faces: red brick in English bond, limewash flaking from the top, soot above the lamps
  const brick = (ox: number, oy: number, r: () => number) => {
    img.rect(ox, oy, T, T, VB.mortar);
    for (let row = 0; row < 5; row++) {
      const y = oy + 1 + row * 3;
      const header = row % 2 === 1;
      const len = header ? 4 : 8;
      const off = header ? 2 : row % 4 === 0 ? 0 : 4;
      for (let x0 = -off; x0 < T; x0 += len) {
        const x = Math.max(0, x0);
        const w = Math.min(x0 + len - 1, T) - x;
        if (w <= 0) continue;
        const tone = r();
        const c = tone < 0.25 ? VB.b0 : tone < 0.7 ? VB.b1 : VB.b2;
        img.rect(ox + x, y, w, 2, c);
        img.hline(ox + x, y, w, mix(c, VB.b3, 0.5));
        if (r() < 0.3) img.set(ox + x + Math.floor(r() * w), y + 1, mix(c, VB.mortar, 0.5));
      }
    }
    // limewash, flaking away down the wall
    for (let x = 0; x < T; x++) {
      const drip = Math.floor(r() * 4);
      for (let y = 0; y < drip; y++) img.set(ox + x, oy + y, mix(VB.lime, VB.b1, y * 0.25));
    }
    img.hline(ox, oy + 15, T, P.ink);
    img.hline(ox, oy + 14, T, mix(VB.mortar, P.ink, 0.5));
  };
  const post = (ox: number, oy: number, x: number) => {
    // an oak shoring post, iron-strapped
    img.rect(ox + x, oy, 4, 15, OAK[1]);
    img.vline(ox + x, oy, 15, OAK[3]);
    img.vline(ox + x + 3, oy, 15, mix(P.wood1, P.ink, 0.4));
    img.vline(ox + x + 1, oy + 3, 5, OAK[0]);
    for (const y of [3, 11]) {
      img.hline(ox + x - 1, oy + y, 6, IRON.c1);
      img.set(ox + x, oy + y, IRON.c3);
      img.set(ox + x + 3, oy + y, IRON.c3);
    }
  };
  for (const [idx, kind] of [[12, 0], [13, 1], [14, 2], [15, 3], [40, 4], [41, 5], [42, 0], [43, 6]] as const) {
    const [ox, oy] = at(idx);
    const r = rng(12300 + idx);
    brick(ox, oy, r);
    if (kind === 1) post(ox, oy, 6);
    if (kind === 2) {
      // a lantern behind a glass pane in a niche (lamps in a magazine burn behind glass, never in the open)
      img.rect(ox + 4, oy + 3, 8, 10, P.ink);
      img.rect(ox + 5, oy + 4, 6, 8, mix(P.ink, P.flame1, 0.25));
      img.rect(ox + 7, oy + 7, 2, 3, P.flame2);
      img.set(ox + 7, oy + 6, P.flame1);
      img.set(ox + 8, oy + 10, P.honey);
      img.hline(ox + 5, oy + 4, 6, mix(P.wax2, P.flame1, 0.4)); // light on the glass
      img.set(ox + 5, oy + 5, withAlpha(P.wax2, 200));
      for (const y of [3, 12]) img.hline(ox + 4, oy + y, 8, VB.copper);
      img.vline(ox + 4, oy + 3, 10, VB.copperD);
      img.vline(ox + 11, oy + 3, 10, VB.copperD);
      for (let y = 0; y < 3; y++) img.hline(ox + 5, oy + y, 6, mix(VB.mortar, P.ink, 0.3)); // soot above it
    }
    if (kind === 3) {
      // a painted warning: a black keg with a red flame struck through
      img.rect(ox + 4, oy + 3, 8, 9, mix(VB.lime, P.wax2, 0.3));
      img.rect(ox + 6, oy + 5, 4, 5, P.ink);
      img.hline(ox + 6, oy + 6, 4, P.dark2);
      img.hline(ox + 6, oy + 8, 4, P.dark2);
      line(img, ox + 5, oy + 11, ox + 11, oy + 4, P.poppy);
      img.set(ox + 9, oy + 4, P.flame1);
    }
    if (kind === 4) {
      // pegs for hanging powder horns, one horn still on its peg
      for (const x of [4, 11]) {
        img.set(ox + x, oy + 6, OAK[3]);
        img.set(ox + x, oy + 7, OAK[0]);
      }
      img.set(ox + 4, oy + 8, P.dark2); // the cord
      line(img, ox + 3, oy + 9, ox + 6, oy + 12, mix(P.wax1, P.wood2, 0.4));
      line(img, ox + 3, oy + 10, ox + 5, oy + 12, mix(P.wax1, P.wood2, 0.7));
      img.set(ox + 6, oy + 12, VB.copper);
    }
    if (kind === 5) {
      // a crack, a brick fallen out
      img.rect(ox + 9, oy + 7, 4, 2, P.ink);
      line(img, ox + 3, oy + 2, ox + 7, oy + 8, VB.mortar);
      line(img, ox + 7, oy + 8, ox + 9, oy + 8, VB.mortar);
    }
    if (kind === 6) post(ox, oy, 2);
  }
  // 16-31 wall tops: dark brick under heavy oak beams where the wall meets the room, iron-strapped
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(12400 + mask);
    img.rect(ox, oy, T, T, mix(VB.b0, P.ink, 0.5));
    for (let y = 1; y < T; y += 3) for (let x = (y % 2) * 3; x < T; x += 6) img.hline(ox + x, oy + y, 4, mix(VB.b0, P.ink, 0.25));
    speck(ox, oy, r, 3, P.ink);
    const N = mask & 1, E = mask & 2, S = mask & 4, Wt = mask & 8;
    const beamH = (y: number, lit: boolean) => {
      img.rect(ox, oy + y, T, 3, OAK[lit ? 3 : 1]);
      img.hline(ox, oy + y, T, lit ? mix(OAK[3], P.wax1, 0.3) : OAK[3]);
      img.hline(ox, oy + y + 2, T, mix(P.wood1, P.ink, 0.4));
      for (const x of [2, 13]) img.set(ox + x, oy + y + 1, IRON.c2);
    };
    const beamV = (x: number, lit: boolean) => {
      img.rect(ox + x, oy, 3, T, OAK[lit ? 3 : 2]);
      img.vline(ox + x, oy, T, lit ? mix(OAK[3], P.wax1, 0.3) : OAK[1]);
      img.vline(ox + x + 2, oy, T, mix(P.wood1, P.ink, 0.4));
    };
    if (N) beamH(0, true);
    if (S) beamH(13, false);
    if (Wt) beamV(0, true);
    if (E) beamV(13, false);
  }
  shadeTiles(img, 32, 1);
  sheet('tiles_vault', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 1, 1, 2, 3],
      floor_plank: [...Array(14).fill(4), ...Array(14).fill(5), ...Array(12).fill(6), ...Array(12).fill(7), 8, 8, 8, 9, 10, 11], // the spill, scorch and shot are rare
      floor_grate: [44, 44, 45],
      wall_front: [12, 12, 13, 12, 42, 14, 12, 40, 12, 15, 41, 43, 12, 13],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [46, 46, 47],
      shade: Array.from({ length: 8 }, (_, i) => 32 + i),
      glow: [14],
    },
  });
}

function genVault() {
  const P7 = phased7();
  // Blunderbuss (the player's and the Gunner's): a short stock, a brass barrel that flares to a bell
  const blun = new Img(24, 11);
  blun.rect(1, 5, 7, 3, WOOD.c2); // stock
  blun.hline(1, 5, 7, WOOD.c3);
  blun.hline(1, 7, 7, WOOD.c1);
  blun.set(4, 6, WOOD.c1); // grain
  blun.rect(2, 7, 3, 2, WOOD.c1); // grip
  blun.set(2, 7, WOOD.c2);
  blun.hline(1, 9, 3, IRON.c1); // butt plate
  blun.rect(7, 4, 11, 3, BRASS); // barrel
  blun.hline(7, 4, 11, mix(GOLD0, P.wax2, 0.35));
  blun.hline(7, 6, 11, mix(BRASS, P.wood1, 0.4));
  for (const x of [10, 14]) blun.vline(x, 4, 3, IRON.c1); // barrel bands
  for (let x = 18; x < 23; x++) {
    const flare = Math.round((x - 17) * 0.7);
    blun.vline(x, 4 - flare, 3 + flare * 2, x === 22 ? GOLD0 : BRASS); // the bell
    blun.set(x, 4 - flare, mix(GOLD0, P.wax2, 0.35));
  }
  blun.vline(22, 4, 3, IRON.c0); // the dark of the mouth
  blun.rect(7, 3, 2, 1, IRON.c2); // the lock
  blun.set(6, 2, IRON.c2); // cock
  blun.set(5, 8, GOLD0); // trigger guard
  blun.set(6, 8, BRASS);
  blun.outline(P.ink);
  sheet('blunderbuss', blun, { cell: [24, 11], pivot: [3, 6], layer: 'weapon', points: { muzzle: [22, 5] } });
  // cannonball and spark
  const ball = new Img(8, 8);
  ball.disc(4, 4, 3.3, IRON.c0);
  ball.disc(3, 3, 1.5, IRON.c2);
  ball.outline(P.ink);
  sheet('cannonball', ball, { cell: [8, 8], pivot: [4, 4], layer: 'fx' });
  const spark = new Img(5, 5);
  spark.set(2, 2, P.wax2);
  spark.set(1, 2, P.flame2);
  spark.set(3, 2, P.flame2);
  spark.set(2, 1, P.flame1);
  spark.set(2, 3, P.flame1);
  sheet('spark', spark, { cell: [5, 5], pivot: [2, 2], layer: 'fx' });
  // the keg prop: frame 0 whole, frame 1 blown apart
  const keg = new Img(32, 16);
  {
    const a = new Img(16, 16);
    kegAt(a, 8, 14, 5);
    a.outline(P.ink);
    keg.blit(a, 0, 0);
    const r = new Img(16, 16);
    r.ellipse(8, 13, 6, 2, SOOT);
    r.ellipse(8, 13, 4, 1.2, POWDER);
    line(r, 2, 11, 5, 13, WOOD.c2);
    line(r, 12, 10, 14, 13, WOOD.c1);
    r.hline(6, 12, 3, IRON.c1);
    r.outline(P.ink);
    keg.blit(r, 16, 0);
  }
  sheet('prop_keg', keg, { cell: [16, 16], pivot: [8, 14], layer: 'single' });

  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  const frames = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));
  rosterSheet(
    'mule',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(drawMule, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawMule, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(11), loop: true },
      { name: 'shove', frames: frames(drawMule, [{ hunch: 1 }, { hunch: 2, lean: -1 }, { hunch: 2, lean: -2, bob: 1 }, { lean: 3 }, { lean: 3 }, { lean: 1 }, {}]), timing: P7, loop: false },
      { name: 'stagger', frames: frames(drawMule, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => muleDeath(c, f)),
    null,
  );
  rosterSheet(
    'runner',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(drawRunner, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawRunner, f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1 })), timing: walkT(5), loop: true },
      { name: 'throw', frames: frames(drawRunner, [{ arm: -0.5 }, { arm: -1, lean: -1 }, { arm: -1, lean: -2 }, { arm: 1, lean: 2 }, { arm: 1.2, lean: 2 }, { arm: 0.5 }, {}]), timing: P7, loop: false },
      { name: 'jab', frames: frames(drawRunner, [{ arm: 0 }, { arm: -0.5, lean: -1 }, { arm: -0.5, lean: -1 }, { arm: 1.4, lean: 3 }, { arm: 1.4, lean: 3 }, { arm: 0.5, lean: 1 }, {}]), timing: P7, loop: false },
      { name: 'stagger', frames: frames(drawRunner, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => runnerDeath(c, f)),
    null,
  );
  // the cannon: fire, grapeshot, lob, ram; its entrance; the Gunner leaping clear when it's done
  rosterSheet(
    'gunner_cannon',
    64,
    [32, 58],
    7,
    [
      { name: 'idle', frames: frames(drawCannon, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawCannon, f => ({ roll: f, bob: f % 2 })), timing: walkT(10), loop: true },
      { name: 'fire', frames: frames(drawCannon, [{ hunch: 1 }, { hunch: 1, bob: 1 }, { hunch: 2, bob: 1 }, { recoil: 3, smoke: 1 }, { recoil: 2, smoke: 1.4 }, { recoil: 1, smoke: 0.8 }, { smoke: 0.3 }]), timing: P7, loop: false },
      { name: 'lob', frames: frames(drawCannon, [{ lift: 1 }, { lift: 2 }, { lift: 3, bob: 1 }, { lift: 3, recoil: 2, smoke: 1 }, { lift: 2, recoil: 1, smoke: 1.2 }, { lift: 1, smoke: 0.5 }, {}]), timing: P7, loop: false },
      { name: 'ram', frames: frames(drawCannon, [{ bob: 1 }, { bob: 2, roll: 1 }, { bob: 2, roll: 2 }, { roll: 3, lean: 3 }, { roll: 4, lean: 3 }, { roll: 5 }, {}]), timing: P7, loop: false },
      { name: 'intro', frames: frames(drawCannon, [{ stand: 1 }, { stand: 1, bob: 1 }, { stand: 0.5 }, {}, { recoil: 3, smoke: 1.4 }, { smoke: 0.6 }]), timing: [{ ticks: 30 }, { ticks: 30 }, { ticks: 20 }, { ticks: 15 }, { ticks: 15 }, { ticks: 40 }], loop: false },
      { name: 'dismount', frames: frames(drawCannon, [{ stand: 1, smoke: 1 }, { stand: 2, smoke: 1.5, bob: -2 }, { stand: 3, smoke: 2, bob: -4 }, { stand: 1, smoke: 2.4 }]), timing: [{ ticks: 12 }, { ticks: 12 }, { ticks: 12 }, { ticks: 12 }], loop: true },
      { name: 'stagger', frames: frames(drawCannon, [{ flinch: true, recoil: 2 }, { flinch: true, bob: 1 }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => cannonDeath(c, f)),
    null,
  );
  const duel = (name: string, poses: DuelPose[], timing: { ticks: number; phase?: string; events?: string[] }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => drawDuel(c, d, p)),
    timing,
    loop,
    hand: (d: Dir5, f: number) => duelHand(d, poses[f]),
  });
  rosterSheet(
    'gunner',
    48,
    [24, 44],
    7,
    [
      duel('idle', [{}, { bob: 1 }], idleT, true),
      duel('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0 })), walkT(8), true),
      duel('shoot', [{ aim: 0.5 }, { aim: 1, lean: -1 }, { aim: 1, lean: -1, crouch: 1 }, { aim: 0, lean: -3 }, { aim: 0.2, lean: -2 }, { aim: 0.6, lean: -1 }, {}], P7, false),
      duel('club', [{ club: 0.5 }, { club: 1, lean: -1 }, { club: 1.1, lean: -2 }, { club: -0.5, lean: 3, aim: 1 }, { club: -0.6, lean: 3, aim: 1 }, { lean: 1 }, {}], P7, false),
      duel('toss', [{ toss: 0.3 }, { toss: 0.8, lean: -1 }, { toss: 1, lean: -2 }, { toss: 0, lean: 2 }, { lean: 2 }, { lean: 1 }, {}], P7, false),
      duel('leap', [{ crouch: 1 }, { crouch: 2 }, { bob: -6, lean: -2 }, { bob: -4, lean: -3, aim: 1 }, { crouch: 1, aim: 1 }, { aim: 0.5 }, {}], P7, false),
      duel('intro', [{ crouch: 2, hunch: 2 }, { crouch: 1, hunch: 1 }, {}, { aim: 1 }, { aim: 1, lean: -2 }, {}], [{ ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 30 }], false),
      duel('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => duelDeath(c, f)),
    DUEL_HAND,
  );

  // decor (64 cells, pivot at the base like the Works' decor)
  const W = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, W);
  {
    const c = cell(); // 0 keg stack (2 wide): three kegs and one on top
    kegAt(c, 22, B, 7);
    kegAt(c, 38, B, 7);
    kegAt(c, 30, B - 14, 7);
    f.push(c);
  }
  {
    const c = cell(); // 1 powder barrel, tall, a scoop hanging on it
    kegAt(c, 32, B, 8);
    c.ellipse(32, B - 18, 6, 1.5, POWDER);
    line(c, 36, B - 19, 40, B - 10, IRON.c2);
    f.push(c);
  }
  {
    const c = cell(); // 2 cannonball pyramid on a board
    c.rect(20, B - 3, 24, 3, WOOD.c1);
    const balls: [number, number][] = [[24, 7], [31, 7], [38, 7], [27, 13], [34, 13], [31, 19]];
    for (const [x, y] of balls) {
      c.disc(x, B - y, 3.4, IRON.c0);
      c.set(x - 1, B - y - 1, IRON.c2);
    }
    f.push(c);
  }
  {
    const c = cell(); // 3 a practice target: a straw man on a post, full of holes
    c.vline(32, B - 30, 30, WOOD.c1);
    c.vline(33, B - 30, 30, WOOD.c0);
    c.disc(32, B - 34, 8, mix(P.flame1, P.wood2, 0.5));
    c.disc(32, B - 34, 5, P.wax1);
    c.disc(32, B - 34, 2, P.blood1);
    for (const [x, y] of [[28, 37], [35, 31], [30, 30], [36, 38]]) c.set(x, B - y, P.ink);
    c.hline(24, B - 26, 17, mix(P.flame1, P.wood2, 0.5)); // arms of straw
    f.push(c);
  }
  {
    const c = cell(); // 4 spilled powder (flat)
    c.ellipse(32, B - 4, 14, 4, POWDER);
    c.ellipse(28, B - 5, 7, 2, mix(POWDER, P.stone2, 0.5));
    for (const [x, y] of [[20, 2], [44, 4], [40, 7]]) c.set(x, B - y, POWDER);
    f.push(c);
  }
  {
    const c = cell(); // 5 collapsed rubble (flat): fallen stone and a split beam
    for (const [x, y, r] of [[22, 5, 5], [33, 3, 4], [41, 6, 5], [28, 9, 3]] as const) {
      c.ellipse(x, B - y, r, r * 0.6, STN.c1);
      c.ellipse(x - 1, B - y - 1, r * 0.6, r * 0.35, STN.c3);
    }
    line(c, 16, B - 12, 46, B - 2, WOOD.c1);
    line(c, 16, B - 13, 46, B - 3, WOOD.c2);
    f.push(c);
  }
  {
    const c = cell(); // 6 shot crate: an open box of cartridges
    c.rect(22, B - 14, 20, 14, WOOD.c1);
    c.hline(22, B - 14, 20, WOOD.c3);
    c.rect(24, B - 13, 16, 4, P.dark1);
    for (let x = 25; x < 39; x += 2) c.set(x, B - 12, P.wax1);
    c.hline(22, B - 5, 20, WOOD.c0);
    f.push(c);
  }
  {
    const c = cell(); // 7 cannon rail (flat): two iron rails on sleepers
    for (let x = 4; x < 60; x += 8) c.rect(x, B - 9, 4, 8, WOOD.c0);
    c.hline(0, B - 7, 64, IRON.c2);
    c.hline(0, B - 3, 64, IRON.c2);
    c.hline(0, B - 8, 64, IRON.c3);
    f.push(c);
  }
  const img = new Img(W * f.length, W);
  f.forEach((c, i) => {
    c.outline(P.ink);
    img.blit(c, i * W, 0);
  });
  sheet('decor_vault', img, { cell: [W, W], pivot: [32, B], layer: 'single' });
}

// ---------------------------------------------------------------- Bloomhollow, the Apiary Orchard (expansion step 4)
// The first colourful biome: warm late light on an orchard the Synod couldn't finish burning. Honey-stone dry
// walls under flowering hedgerows, orchard grass full of clover, meadow flowers, lavender rows, honey pooling
// where the hives were broken, honeycomb-paved yards, and the ash of the burned grove.
const BL = {
  g0: mix(P.leaf1, P.ink, 0.35),
  g1: P.leaf1,
  g2: mix(P.leaf1, P.leaf2, 0.6),
  g3: P.leaf2,
  g4: P.leaf3,
  g5: mix(P.leaf3, P.flame2, 0.45),
  // honey-stone: the valley's warm limestone
  s0: mix(P.wood1, P.dark1, 0.45),
  s1: mix(P.wood2, P.stone2, 0.35),
  s2: mix(P.wax1, P.wood2, 0.55),
  s3: mix(P.wax1, P.wood2, 0.3),
  s4: mix(P.wax1, P.wax2, 0.35),
  // earth path
  e0: mix(P.wood1, P.dark2, 0.3),
  e1: P.wood1,
  e2: mix(P.wood2, P.flame1, 0.18),
  e3: mix(P.wood2, P.wax1, 0.35),
  // honey
  h0: mix(P.ember, P.wood1, 0.35),
  h1: mix(P.honey, P.ember, 0.3),
  h2: P.honey,
  h3: mix(P.honey, P.flame2, 0.6),
  // ash
  a0: mix(P.ink, P.dark1, 0.5),
  a1: P.stone1,
  a2: P.stone2,
  a3: mix(P.stone3, P.wax1, 0.2),
};

function genOrchardTiles() {
  const T = 16;
  const img = new Img(T * 8, T * 14);
  const at = tileAt;
  const speck = (ox: number, oy: number, r: () => number, n: number, col: RGBA, m = 0) => {
    for (let i = 0; i < n; i++) img.set(ox + m + Math.floor(r() * (16 - m * 2)), oy + m + Math.floor(r() * (16 - m * 2)), col);
  };
  /** A tuft of grass: a dark root, blades lit at the tips. */
  const tuft = (x: number, y: number, r: () => number, tall = 3) => {
    img.set(x, y, BL.g0);
    for (const [dx, h] of [[0, tall], [1, tall - 1], [-1, tall - 2]] as const) {
      if (h <= 0 || r() < 0.2) continue;
      img.vline(x + dx, y - h, h, BL.g3);
      img.set(x + dx, y - h, BL.g4);
    }
  };
  /** A clover leaf: three dots of fresh green. */
  const clover = (x: number, y: number) => {
    img.set(x, y, BL.g4);
    img.set(x + 1, y, BL.g4);
    img.set(x, y + 1, BL.g3);
    img.set(x + 1, y + 1, BL.g0);
  };
  /** A little flower seen from above: petals round a heart. */
  const bloom = (x: number, y: number, petal: RGBA, heart: RGBA, big = false) => {
    img.set(x, y - 1, petal);
    img.set(x - 1, y, petal);
    img.set(x + 1, y, petal);
    img.set(x, y + 1, mix(petal, P.ink, 0.25));
    img.set(x, y, heart);
    if (big) {
      img.set(x - 1, y - 1, mix(petal, P.wax2, 0.3));
      img.set(x + 1, y + 1, mix(petal, P.ink, 0.3));
    }
  };
  /** A poppy: a cup of red, dark at its heart, lit on its rim. */
  const poppy = (x: number, y: number) => {
    img.rect(x, y, 2, 2, P.poppy);
    img.set(x - 1, y, mix(P.poppy, P.ink, 0.3));
    img.set(x + 2, y + 1, mix(P.poppy, P.ink, 0.4));
    img.set(x, y - 1, mix(P.poppy, P.flame2, 0.35));
    img.set(x + 1, y + 1, P.ink);
    img.set(x, y + 2, BL.g1); // the stem
  };

  // 0-3 orchard grass: thick and green, clover, now and then a daisy or a buttercup
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(v);
    const r = rng(9000 + v);
    img.rect(ox, oy, T, T, BL.g2);
    speck(ox, oy, r, 14, BL.g1);
    speck(ox, oy, r, 8, BL.g3);
    speck(ox, oy, r, 3, BL.g0);
    for (let i = 0; i < 3; i++) tuft(ox + 2 + Math.floor(r() * 12), oy + 4 + Math.floor(r() * 11), r, 2 + Math.floor(r() * 2));
    if (v !== 3) clover(ox + 3 + Math.floor(r() * 9), oy + 3 + Math.floor(r() * 9));
    if (v === 1) bloom(ox + 11, oy + 5, P.wax2, P.flame2);
    if (v === 2) {
      bloom(ox + 4, oy + 11, P.flame2, P.flame1);
      img.set(ox + 12, oy + 3, P.blossom); // a petal blown from the trees
    }
  }
  // 4-7 orchard path: packed warm earth in soft patches, worn hollows, a few rounded pebbles, fallen blossom
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(4 + v);
    const r = rng(9100 + v);
    img.rect(ox, oy, T, T, BL.e2);
    for (let i = 0; i < 3; i++) {
      // lighter, drier patches where the earth is packed hardest (wrapping so the tiles join)
      const cx = r() * 16;
      const cy = r() * 16;
      const rr = 2 + r() * 2.5;
      for (let y = -4; y <= 4; y++)
        for (let x = -5; x <= 5; x++)
          if ((x * x) / (rr * rr * 1.4) + (y * y) / (rr * rr * 0.8) < 1) img.set(ox + ((Math.floor(cx + x) + 16) % 16), oy + ((Math.floor(cy + y) + 16) % 16), mix(BL.e2, BL.e3, 0.55));
    }
    for (let i = 0; i < 2; i++) {
      // hollows worn by feet: a dark rim below, lit edge above
      const x = ox + 2 + Math.floor(r() * 10);
      const y = oy + 2 + Math.floor(r() * 11);
      img.hline(x, y, 3, mix(BL.e1, BL.e2, 0.4));
      img.hline(x, y + 1, 3, BL.e1);
      img.hline(x, y - 1, 3, mix(BL.e2, BL.e3, 0.7));
    }
    speck(ox, oy, r, 6, BL.e1);
    speck(ox, oy, r, 5, BL.e3);
    speck(ox, oy, r, 2, BL.e0);
    for (let i = 0; i < 1 + (v % 2); i++) {
      // a rounded pebble: lit top-left, a shadow under it
      const x = ox + 2 + Math.floor(r() * 11);
      const y = oy + 2 + Math.floor(r() * 11);
      img.rect(x, y, 2, 2, BL.s2);
      img.set(x, y, BL.s4);
      img.hline(x, y + 2, 2, BL.e0);
      img.set(x + 2, y + 1, BL.e1);
    }
    if (v === 1 || v === 3) {
      img.set(ox + 5 + v, oy + 9, P.blossom);
      img.set(ox + 6 + v, oy + 9, mix(P.blossom, P.wax2, 0.5));
      img.set(ox + 5 + v, oy + 10, mix(P.blossom, BL.e1, 0.5));
    }
    if (v === 2) img.set(ox + 10, oy + 4, P.blossom);
  }
  // 8-11 meadow: grass crowded with flowers (poppies, daisies, cornflowers, buttercups)
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(8 + v);
    const r = rng(9200 + v);
    img.rect(ox, oy, T, T, BL.g2);
    speck(ox, oy, r, 12, BL.g1);
    speck(ox, oy, r, 8, BL.g4);
    for (let i = 0; i < 2; i++) tuft(ox + 2 + Math.floor(r() * 12), oy + 5 + Math.floor(r() * 10), r);
    const spots: [number, number][] = [[3, 4], [10, 3], [6, 9], [12, 11], [2, 12]];
    spots.forEach(([x, y], i) => {
      const k = (i + v) % 4;
      const px = ox + x + Math.floor(r() * 2);
      const py = oy + y + Math.floor(r() * 2);
      if (k === 0) poppy(px, py);
      else if (k === 1) bloom(px, py, P.wax2, P.flame2, true);
      else if (k === 2) bloom(px, py, P.violet3, P.violet1);
      else bloom(px, py, P.flame2, P.honey);
    });
  }
  // 12-13 lavender: rows of grey-green bushes crowned with violet spikes
  for (let v = 0; v < 2; v++) {
    const [ox, oy] = at(12 + v);
    const r = rng(9300 + v);
    img.rect(ox, oy, T, T, mix(BL.g1, P.stone2, 0.35));
    speck(ox, oy, r, 10, BL.g0);
    for (let i = 0; i < 7; i++) {
      const x = ox + 1 + ((i * 5 + v * 2) % 14) + Math.floor(r() * 2);
      const y = oy + 5 + Math.floor(r() * 10);
      const h = 3 + Math.floor(r() * 3);
      img.vline(x, y - h + 1, h, mix(BL.g2, P.stone3, 0.3)); // stem
      img.vline(x, y - h - 2, 3, P.violet2); // the spike of flowers
      img.set(x, y - h - 2, P.violet3);
      img.set(x + 1, y - h - 1, P.violet1);
    }
  }
  // 14-15, 105-106 honey: a deep amber pool from a broken hive, slow ripples, a few glints, wax flecks and a
  // drowned bee floating in it (it slows you). The ripples run with the tile so the pool reads as one sheet.
  const deep = mix(BL.h1, BL.h0, 0.3);
  [14, 15, 105, 106].forEach((slot, v) => {
    const [ox, oy] = at(slot);
    const r = rng(9400 + v);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const bend = Math.sin((2 * Math.PI * y) / T + v * 1.7) * 0.18;
        const n = Math.sin(2 * Math.PI * (x / T + y / (2 * T) + bend));
        img.set(ox + x, oy + y, n < -0.78 ? mix(deep, BL.h0, 0.3) : n > 0.86 ? mix(BL.h1, BL.h2, 0.3) : deep);
      }
    speck(ox, oy, r, 4, mix(deep, BL.h0, 0.6), 1);
    // a glint: a short bright curve where the light catches the surface
    const gx = ox + 2 + Math.floor(r() * 9);
    const gy = oy + 2 + Math.floor(r() * 10);
    img.hline(gx, gy, 3, BL.h3);
    img.set(gx + 1, gy, P.wax2);
    img.set(gx + 3, gy + 1, BL.h2);
    img.set(gx - 1, gy + 1, BL.h2);
    if (v === 1) {
      // a scrap of comb afloat
      img.rect(ox + 9, oy + 10, 3, 2, mix(P.wax1, BL.h2, 0.4));
      img.set(ox + 10, oy + 10, BL.h0);
      img.hline(ox + 9, oy + 12, 3, BL.h0);
    }
    if (v === 2) {
      // a drowned bee: a dark body, pale wings spread flat
      img.hline(ox + 5, oy + 11, 3, P.ink);
      img.set(ox + 6, oy + 11, BL.h3);
      img.set(ox + 5, oy + 10, P.wax1);
      img.set(ox + 7, oy + 10, P.wax1);
    }
    if (v === 3) for (let i = 0; i < 3; i++) img.set(ox + 3 + Math.floor(r() * 10), oy + 3 + Math.floor(r() * 10), P.wax1); // wax flecks
  });
  // 16-31 wall caps: the flowering hedgerow along the top of every wall, lit on its open edges
  const foliage = (ox: number, oy: number, r: () => number, dark: boolean, blossoms: number) => {
    img.rect(ox, oy, T, T, dark ? mix(BL.g0, P.ink, 0.3) : BL.g1);
    for (let i = 0; i < 7; i++) {
      // round clumps of leaves, lit on their upper left
      const cx = ox + 1 + r() * 14;
      const cy = oy + 1 + r() * 14;
      const rr = 2 + r() * 2;
      img.disc(cx, cy, rr, dark ? BL.g0 : BL.g2);
      img.disc(cx - rr * 0.3, cy - rr * 0.3, rr * 0.55, dark ? BL.g1 : BL.g3);
      if (!dark) img.set(cx - rr * 0.5, cy - rr * 0.6, BL.g4);
    }
    for (let i = 0; i < blossoms; i++) {
      const x = ox + 1 + Math.floor(r() * 14);
      const y = oy + 1 + Math.floor(r() * 14);
      const c = [P.blossom, P.wax2, P.blossom, P.flame2][i % 4];
      img.set(x, y, c);
      img.set(x + 1, y, mix(c, P.ink, 0.35));
    }
  };
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(9500 + mask);
    foliage(ox, oy, r, false, 3);
    const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
    // open edges: the hedge's rounded, sunlit rim over the drop
    if (N) {
      img.hline(ox, oy, T, BL.g4);
      img.hline(ox, oy + 1, T, BL.g3);
      for (let x = 0; x < T; x += 3) img.set(ox + x + Math.floor(r() * 2), oy, BL.g5);
    }
    if (W) {
      img.vline(ox, oy, T, BL.g4);
      img.vline(ox + 1, oy, T, BL.g3);
    }
    if (S) {
      img.hline(ox, oy + 14, T, BL.g1);
      img.hline(ox, oy + 15, T, BL.g0);
      for (let x = 0; x < T; x += 2) if (r() < 0.6) img.set(ox + x, oy + 15, P.ink); // leaves hanging over
    }
    if (E) {
      img.vline(ox + 15, oy, T, BL.g0);
      img.vline(ox + 14, oy, T, BL.g1);
    }
  }
  shadeTiles(img, 32, 0.85);
  // 40-43 wall faces: dry-stone walling in honey-coloured limestone, and what grows on it
  const stones = (ox: number, oy: number, r: () => number, charred = false) => {
    const S0 = charred ? mix(BL.a0, P.ink, 0.4) : BL.s0;
    const cols = charred ? [mix(BL.a1, P.ink, 0.35), BL.a1, mix(BL.a1, BL.a2, 0.5), BL.a2] : [BL.s1, BL.s2, BL.s2, BL.s3];
    img.rect(ox, oy, T, T, S0);
    let y = 0;
    let row = 0;
    while (y < 14) {
      const h = row === 0 ? 3 : 3 + Math.floor(r() * 2);
      let x = -Math.floor(r() * 4);
      while (x < T) {
        const w = 4 + Math.floor(r() * 4);
        const base = cols[Math.floor(r() * cols.length)];
        for (let yy = 0; yy < h - 1; yy++)
          for (let xx = 1; xx < w; xx++) {
            const px = x + xx;
            if (px < 0 || px >= T) continue;
            const edgeTop = yy === 0;
            const edgeLeft = xx === 1;
            const edgeBot = yy === h - 2;
            img.set(ox + px, oy + y + yy, edgeTop ? mix(base, charred ? BL.a3 : BL.s4, 0.5) : edgeLeft ? mix(base, charred ? BL.a3 : BL.s4, 0.25) : edgeBot ? mix(base, S0, 0.35) : base);
          }
        if (r() < 0.3 && x + 2 >= 0 && x + 2 < T) img.set(ox + x + 2 + Math.floor(r() * (w - 3)), oy + y + 1, mix(base, S0, 0.5)); // a pit in the stone
        x += w;
      }
      y += h;
      row++;
    }
    // the foot of the wall, in shadow
    img.hline(ox, oy + 14, T, S0);
    img.hline(ox, oy + 15, T, P.ink);
  };
  const faces: [number, string][] = [[40, 'plain'], [41, 'rose'], [42, 'ivy'], [43, 'bole']];
  for (const [idx, kind] of faces) {
    const [ox, oy] = at(idx);
    const r = rng(9600 + idx);
    stones(ox, oy, r);
    if (kind === 'rose') {
      // a climbing rose: a thorny cane, leaves, and flowers
      line(img, ox + 3, oy + 15, ox + 6, oy + 2, BL.g0);
      line(img, ox + 6, oy + 6, ox + 12, oy + 3, BL.g0);
      for (const [x, y] of [[4, 11], [6, 5], [9, 4], [5, 8], [11, 3]]) {
        img.set(ox + x, oy + y, BL.g3);
        img.set(ox + x + 1, oy + y, BL.g2);
      }
      for (const [x, y, c] of [[7, 3, P.poppy], [12, 2, P.blossom], [4, 7, P.poppy], [10, 5, P.blossom]] as const) {
        img.rect(ox + x, oy + y, 2, 2, c);
        img.set(ox + x, oy + y, mix(c, P.wax2, 0.4));
        img.set(ox + x + 1, oy + y + 1, mix(c, P.ink, 0.4));
      }
    }
    if (kind === 'ivy') {
      for (let i = 0; i < 20; i++) {
        const x = ox + 2 + Math.floor(r() * 12);
        const y = oy + Math.floor(Math.pow(r(), 0.6) * 13);
        img.set(x, y, i % 3 ? BL.g2 : BL.g3);
        img.set(x + 1, y + 1, BL.g0);
      }
    }
    if (kind === 'bole') {
      // a bee bole: an arched niche in the wall holding a straw skep, bees at its door
      img.rect(ox + 3, oy + 4, 10, 10, P.ink);
      img.hline(ox + 4, oy + 3, 8, P.ink);
      img.hline(ox + 3, oy + 13, 10, BL.s3); // its sill
      const straw = [mix(P.wood2, P.flame1, 0.35), mix(P.wax1, P.flame1, 0.35), mix(P.wax1, P.flame2, 0.3)];
      for (let yy = 0; yy < 8; yy++) {
        const half = Math.round(4.2 * Math.sqrt(Math.max(0, 1 - ((7 - yy) / 8.5) ** 2)));
        for (let xx = -half; xx <= half; xx++) {
          const coil = yy % 2 === 0;
          const lit = xx < 0;
          img.set(ox + 8 + xx, oy + 5 + yy, coil ? (lit ? straw[2] : straw[1]) : lit ? straw[1] : straw[0]);
        }
      }
      img.rect(ox + 7, oy + 11, 2, 2, P.ink); // the entrance
      img.set(ox + 10, oy + 9, P.flame2); // a bee
      img.set(ox + 5, oy + 7, P.flame2);
    }
  }
  // 44-45 honeycomb paving: six-sided flags of honey-stone in a comb, some cells stained with honey
  for (let v = 0; v < 2; v++) {
    const [ox, oy] = at(44 + v);
    const r = rng(9700 + v);
    const joint = mix(BL.s0, BL.h0, 0.3);
    img.rect(ox, oy, T, T, BL.s2);
    for (let row = 0; row < 4; row++) {
      const y0 = row * 4;
      const off = row % 2 ? 4 : 0;
      for (let col = -1; col < 3; col++) {
        const x0 = col * 8 + off;
        const stain = r() < 0.1;
        for (let yy = 0; yy < 4; yy++)
          for (let xx = 0; xx < 8; xx++) {
            const px = x0 + xx;
            if (px < 0 || px >= T) continue;
            // cut corners make each flag six-sided
            const corner = (yy === 0 || yy === 3) && (xx === 0 || xx === 7);
            const c = yy === 0 || xx === 0 || corner ? joint : yy === 1 && xx < 6 ? (stain ? mix(BL.s3, BL.h3, 0.5) : BL.s3) : stain ? mix(BL.s2, BL.h2, 0.5) : BL.s2;
            img.set(ox + px, oy + y0 + yy, c);
          }
      }
    }
    speck(ox, oy, r, 4, BL.s1);
  }
  // 46-47 ash: the burned grove's floor, grey and black, still glowing here and there
  for (let v = 0; v < 2; v++) {
    const [ox, oy] = at(46 + v);
    const r = rng(9800 + v);
    img.rect(ox, oy, T, T, BL.a1);
    speck(ox, oy, r, 16, BL.a2);
    speck(ox, oy, r, 10, BL.a0);
    speck(ox, oy, r, 4, BL.a3);
    for (let i = 0; i < 2; i++) {
      const x = ox + 1 + Math.floor(r() * 11);
      const y = oy + 2 + Math.floor(r() * 12);
      img.hline(x, y, 3 + Math.floor(r() * 3), P.ink); // a burnt twig
      img.set(x + 1, y - 1, BL.a0);
    }
    if (v === 1) {
      img.set(ox + 6, oy + 6, P.ember);
      img.set(ox + 7, oy + 6, mix(P.ember, P.flame1, 0.5));
    }
  }
  // 48-63 honey's lip: an amber edge spreading onto the ground, dark where it soaks in
  fringeTiles(48, 4, 9900, (x, y, d, r) => {
    if (d < 0.55) img.set(x, y, d < 0.2 && r() < 0.2 ? BL.h3 : BL.h2);
    else if (d < 0.8) img.set(x, y, BL.h1);
    else if (r() < 0.6) img.set(x, y, BL.h0);
  });
  // 64-79 the path's worn edge fraying into the grass
  fringeTiles(64, 5, 10000, (x, y, d, r) => {
    if (d > 0.75 ? r() < 0.65 : d > 0.45 ? r() < 0.25 : false) return;
    img.set(x, y, d < 0.45 ? (r() < 0.15 ? BL.e3 : BL.e2) : d < 0.75 ? (r() < 0.5 ? BL.e2 : mix(BL.e1, BL.g0, 0.3)) : r() < 0.5 ? mix(BL.e1, BL.g1, 0.4) : BL.g0);
  });
  // 80-95 meadow flowers spilling over their bed's edge
  fringeTiles(80, 5, 10100, (x, y, d, r) => {
    const ox = x - (x % 16);
    const oy = y - (y % 16);
    const put = (px: number, py: number, col: RGBA) => {
      if (px >= ox && px < ox + 16 && py >= oy && py < oy + 16) img.set(px, py, col);
    };
    const k = r();
    if (k < 0.035 * (1 - d) && d > 0.15) {
      // a flower that has seeded itself past the bed
      const petal = [P.poppy, P.wax2, P.violet3, P.flame2][Math.floor(r() * 4)];
      put(x, y - 1, petal);
      put(x - 1, y, petal);
      put(x + 1, y, mix(petal, P.ink, 0.2));
      put(x, y + 1, mix(petal, P.ink, 0.3));
      put(x, y, petal === P.flame2 ? P.honey : P.flame2);
    } else if (k < 0.3 * (1 - d * 0.7)) {
      // the meadow's taller, lusher grass
      put(x, y, BL.g3);
      if (r() < 0.5) put(x, y - 1, BL.g4);
    } else if (k < 0.36 && d < 0.5) put(x, y, BL.g1);
  });
  // 96-97 rock (outside the rooms): deep orchard canopy, dark, a blossom here and there
  for (let v = 0; v < 2; v++) {
    const [ox, oy] = at(96 + v);
    foliage(ox, oy, rng(10200 + v), true, 1);
  }
  // 98-99 floorboards (the press house)
  for (let v = 0; v < 2; v++) {
    const [ox, oy] = at(98 + v);
    const r = rng(10300 + v);
    const wood = [mix(P.wood1, P.wood2, 0.4), mix(P.wood1, P.wood2, 0.65), P.wood2];
    for (let b = 0; b < 4; b++) {
      const c = wood[(b + v) % 3];
      img.rect(ox, oy + b * 4, T, 4, c);
      img.hline(ox, oy + b * 4, T, mix(c, P.wax1, 0.2));
      img.hline(ox, oy + b * 4 + 3, T, mix(P.wood1, P.dark1, 0.5));
      const seam = (b * 7 + v * 5) % 16;
      img.vline(ox + seam, oy + b * 4, 3, mix(P.wood1, P.dark1, 0.5));
      img.set(ox + ((seam + 3) % 16), oy + b * 4 + 1, P.dark1); // a nail
      for (let i = 0; i < 2; i++) img.hline(ox + Math.floor(r() * 12), oy + b * 4 + 1 + Math.floor(r() * 2), 3, mix(c, P.wood1, 0.4)); // grain
    }
  }
  // 100-101 charred wall faces (the burned grove's walls), soot streaking up from the ground
  for (let v = 0; v < 2; v++) {
    const [ox, oy] = at(100 + v);
    const r = rng(10400 + v);
    stones(ox, oy, r, true);
    for (let i = 0; i < 4; i++) {
      const x = ox + 1 + Math.floor(r() * 14);
      img.vline(x, oy + 6 + Math.floor(r() * 5), 8, mix(P.ink, BL.a0, 0.4));
    }
    if (v === 1) img.set(ox + 9, oy + 12, P.ember);
  }
  // 102 a wall face with a candle niche (a beeswax taper still burning in it): glows
  {
    const [ox, oy] = at(102);
    stones(ox, oy, rng(10500));
    img.rect(ox + 5, oy + 4, 6, 8, P.ink);
    img.hline(ox + 6, oy + 3, 4, P.ink);
    img.hline(ox + 5, oy + 12, 6, BL.s3);
    img.rect(ox + 7, oy + 8, 2, 4, mix(P.wax2, P.honey, 0.25)); // a beeswax taper, golden
    img.set(ox + 8, oy + 9, P.honey);
    img.set(ox + 7, oy + 7, P.dark1);
    img.set(ox + 7, oy + 6, P.flame2);
    img.set(ox + 7, oy + 5, P.flame1);
    img.set(ox + 6, oy + 11, mix(P.wax2, P.honey, 0.3)); // a drip
  }
  // 103-104 warm flagstones (the chapel, the press yard)
  const flags: SlabPal = { base: BL.s2, mortar: BL.s0, hi: BL.s4, lo: BL.s1 };
  for (const v of [103, 104]) {
    const [ox, oy] = at(v);
    const r = rng(10600 + v);
    if (v === 103) {
      flagstone(img, ox, oy, 0, 0, 9, 7, r, flags, 0.1);
      flagstone(img, ox, oy, 9, 0, 7, 7, r, flags, -0.15);
      flagstone(img, ox, oy, 0, 7, 16, 9, r, flags);
    } else {
      flagstone(img, ox, oy, 0, 0, 16, 6, r, flags, -0.1);
      flagstone(img, ox, oy, 0, 6, 6, 10, r, flags, 0.15);
      flagstone(img, ox, oy, 6, 6, 10, 10, r, flags);
    }
    if (v === 104) img.set(ox + 3, oy + 3, BL.g3); // moss in a joint
  }

  sheet('tiles_orchard', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 0, 1, 2, 3, 0, 1],
      floor_path: [4, 4, 5, 6, 7],
      floor_flowers: [8, 9, 10, 11],
      floor_lavender: [12, 13],
      floor_honey: [14, 14, 15, 105, 14, 106],
      floor_comb: [44, 45],
      floor_ash: [46, 46, 47],
      floor_plank: [98, 99],
      floor_stone: [103, 104],
      wall_front: [40, 40, 42, 40, 41, 40, 42, 43, 40, 40, 41, 102],
      wall_front_floor_ash: [100, 101],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [96, 97],
      shade: Array.from({ length: 8 }, (_, i) => 32 + i),
      fringe_floor_honey: Array.from({ length: 16 }, (_, i) => 48 + i),
      fringe_floor_flowers: Array.from({ length: 16 }, (_, i) => 80 + i),
      fringe_floor_path: Array.from({ length: 16 }, (_, i) => 64 + i),
      glow: [102],
    },
  });
}

// ---- Bloomhollow scenery and props
const LEAF: Ramp = { c0: BL.g0, c1: BL.g1, c2: BL.g3, c3: BL.g4 };
const STRAW: Ramp = { c0: mix(P.wood2, P.wood1, 0.35), c1: mix(P.wood2, P.flame1, 0.35), c2: mix(P.wax1, P.flame1, 0.35), c3: mix(P.wax1, P.flame2, 0.3) };
const HSTONE: Ramp = { c0: BL.s0, c1: BL.s1, c2: BL.s2, c3: BL.s3 };
const CHAR: Ramp = { c0: P.ink, c1: mix(P.ink, P.dark1, 0.6), c2: P.dark2, c3: mix(P.dark2, P.stone2, 0.4) };
const HONEY: Ramp = { c0: BL.h0, c1: BL.h1, c2: BL.h2, c3: BL.h3 };
const PAINT: Ramp = { c0: mix(P.stone3, P.wood1, 0.3), c1: mix(P.wax1, P.stone3, 0.4), c2: P.wax1, c3: P.wax2 }; // whitewashed boards

/** A straw skep: a dome of coiled straw rope, lit on its left, a dark door at its foot. */
function skep(c: Img, cx: number, base: number, r: number, broken = false) {
  const h = Math.round(r * 1.3);
  for (let y = 0; y < h; y++) {
    const k = (y + 0.5) / h;
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (1 - k) ** 2))); // a round dome
    const band = y % 2; // each coil of straw rope bulges: lit on top, a dark groove below
    for (let x = -half; x <= half; x++) {
      const nx = x / Math.max(1, half);
      let l = -nx * 0.9 + (band === 0 ? 0.25 : -0.35) + (1 - k) * 0.2;
      if (band === 0 && (x + y * 2) % 5 === 0) l -= 0.3; // the bramble bindings
      c.set(cx + x, base - h + y, l > 0.5 ? STRAW.c3 : l > 0 ? STRAW.c2 : l > -0.55 ? STRAW.c1 : STRAW.c0);
    }
  }
  c.hline(cx - r + 1, base - h - 1, 1, STRAW.c3);
  c.set(cx, base - h - 1, STRAW.c2); // the crown knot
  if (broken) {
    // split open: the comb inside, spilling
    for (let y = 2; y < h - 2; y++) c.hline(cx + 1, base - h + y, Math.round(r * 0.5), y % 2 ? BL.h2 : P.wax1);
    c.vline(cx, base - h + 1, h - 2, P.ink);
  } else {
    c.rect(cx - 1, base - 3, 3, 2, P.ink); // the door
    c.set(cx - 1, base - 3, STRAW.c0);
  }
  c.hline(cx - r, base, r * 2 + 1, STRAW.c0); // its ring base
}

/** An orchard tree: a crooked trunk and a round crown, in blossom, in fruit, or burnt to a black skeleton. */
function orchardTree(c: Img, cx: number, base: number, kind: 'blossom' | 'fruit' | 'burnt', seed: number) {
  const r = rng(seed);
  const T = kind === 'burnt' ? CHAR : WOOD;
  // trunk: leaning a little, a knot, roots
  for (let y = 0; y < 24; y++) {
    const w = y < 3 ? 6 : y > 18 ? 3 : 4;
    const lean = Math.round(Math.sin(y * 0.18) * 1.5);
    for (let x = 0; x < w; x++) c.set(cx - Math.floor(w / 2) + x + lean, base - y, x === 0 ? T.c3 : x === w - 1 ? T.c0 : x === 1 ? T.c2 : T.c1);
  }
  line(c, cx - 3, base, cx - 6, base + 1, T.c1);
  line(c, cx + 3, base, cx + 6, base + 1, T.c0);
  c.set(cx, base - 10, T.c0); // a knot
  c.set(cx + 1, base - 11, T.c3);
  // boughs
  const boughs: [number, number][] = [[-10, -34], [9, -33], [-4, -40], [5, -38], [-14, -26], [14, -27]];
  for (const [bx, by] of boughs) line(c, cx, base - 20, cx + bx, base + by, T.c1);
  if (kind === 'burnt') {
    for (const [bx, by] of boughs) {
      line(c, cx + bx, base + by, cx + bx + (bx < 0 ? -3 : 3), base + by - 4, T.c2);
      c.set(cx + bx, base + by + 1, T.c3);
    }
    for (let i = 0; i < 4; i++) c.set(cx - 12 + r() * 24, base - 18 - r() * 20, i % 2 ? P.ember : mix(P.ember, P.flame1, 0.5)); // embers still in it
    return;
  }
  // the crown: overlapping clumps of leaf, lit from the upper left
  const clumps: [number, number, number][] = [[-9, -32, 8], [8, -31, 8], [0, -38, 9], [-12, -24, 6], [12, -24, 6], [0, -27, 9], [-5, -44, 6], [6, -44, 5]];
  for (const [x, y, s] of clumps) blob(c, cx + x, base + y, s, s * 0.85, LEAF);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 17;
    const x = Math.round(cx + Math.cos(a) * d);
    const y = Math.round(base - 33 + Math.sin(a) * d * 0.75);
    if (!c.alpha(x, y)) continue;
    if (kind === 'blossom') {
      c.set(x, y, i % 3 ? P.blossom : P.wax2);
      if (i % 4 === 0) c.set(x + 1, y, mix(P.blossom, P.poppy, 0.3));
    } else if (i % 2 === 0) {
      c.set(x, y, P.poppy); // an apple, lit on one cheek
      c.set(x + 1, y, mix(P.poppy, P.blood1, 0.5));
      c.set(x, y - 1, mix(P.poppy, P.flame2, 0.4));
    }
  }
  if (kind === 'fruit')
    for (const [x, y] of [[-8, 1], [5, 0], [11, 2]]) {
      c.set(cx + x, base + y, P.poppy); // windfalls
      c.set(cx + x + 1, base + y, mix(P.poppy, P.blood1, 0.5));
    }
}

function genBloomDecor() {
  const W = 64;
  const B = 62;
  const f: Img[] = [];
  const cell = () => new Img(W, W);
  const push = (c: Img, sw = 10) => {
    c.outline(P.ink);
    finish(c, 32, B, sw, 2);
    f.push(c);
  };
  // 0 apple tree in blossom (tall)
  {
    const c = cell();
    orchardTree(c, 32, B, 'blossom', 11);
    push(c, 12);
  }
  // 1 apple tree in fruit (tall)
  {
    const c = cell();
    orchardTree(c, 32, B, 'fruit', 12);
    push(c, 12);
  }
  // 2 burned tree: a black skeleton, still smouldering
  {
    const c = cell();
    orchardTree(c, 32, B, 'burnt', 13);
    c.ellipse(32, B, 10, 2, BL.a1);
    push(c, 10);
  }
  // 3 wax press (2 tiles): a heavy oak frame, the great screw, a tray of crushed comb, honey running from its lip
  {
    const c = cell();
    box(c, 17, B - 30, 4, 30, WOOD);
    box(c, 39, B - 30, 4, 30, WOOD);
    box(c, 15, B - 33, 30, 5, WOOD); // the beam
    for (let y = B - 28; y < B - 12; y += 2) {
      c.hline(29, y, 3, IRON.c2); // the screw's thread
      c.set(29, y, IRON.c3);
      c.hline(29, y + 1, 3, IRON.c0);
    }
    box(c, 25, B - 12, 11, 3, WOOD); // the platen
    box(c, 19, B - 9, 23, 7, DWOOD); // the tray
    c.hline(20, B - 8, 21, P.wax1); // crushed comb
    for (let x = 21; x < 40; x += 3) c.set(x, B - 8, BL.h2);
    c.vline(41, B - 5, 5, BL.h2); // honey from the spout
    c.ellipse(42, B, 4, 1.5, BL.h1);
    c.set(41, B - 5, BL.h3);
    line(c, 12, B - 30, 30, B - 30, WOOD.c3); // the bar to turn it
    push(c, 16);
  }
  // 4 flower bed (2 tiles): a low honey-stone kerb round poppies, daisies and cornflowers
  {
    const c = cell();
    const r = rng(14);
    box(c, 16, B - 6, 31, 6, HSTONE);
    c.rect(18, B - 7, 27, 3, mix(P.wood1, P.dark2, 0.3)); // earth
    for (let i = 0; i < 16; i++) {
      const x = 18 + Math.floor(r() * 27);
      const h = 3 + Math.floor(r() * 5);
      c.vline(x, B - 6 - h, h, i % 2 ? BL.g1 : BL.g3);
      const col = [P.poppy, P.wax2, P.violet2, P.flame2][i % 4];
      c.rect(x - 1, B - 7 - h, 2, 2, col);
      c.set(x, B - 6 - h, i % 4 === 0 ? P.ink : mix(col, P.flame2, 0.5));
    }
    push(c, 16);
  }
  // 5 scarecrow: a sack head with a stitched grin, a battered felt hat, a patched coat stuffed with straw, arms on a cross-bar
  {
    const c = cell();
    box(c, 31, B - 36, 3, 36, WOOD); // the post
    box(c, 16, B - 30, 32, 3, WOOD); // the cross-bar
    // the coat, lit from the left, lapels and odd buttons, a red patch and a sackcloth one
    for (let y = B - 31; y < B - 13; y++) {
      const w = y === B - 31 ? 10 : 13 + Math.floor((y - (B - 30)) / 4);
      for (let x = 0; x < w; x++) c.set(32 - Math.floor(w / 2) + x, y, shadeT(x / (w - 1), GUARDCOAT));
    }
    // sleeves along the bar
    for (const [x0, x1, lit] of [[18, 25, true], [39, 46, false]] as const) {
      c.rect(x0, B - 31, x1 - x0 + 1, 4, lit ? GUARDCOAT.c2 : GUARDCOAT.c1);
      c.hline(x0, B - 31, x1 - x0 + 1, lit ? GUARDCOAT.c3 : GUARDCOAT.c2);
      c.hline(x0, B - 28, x1 - x0 + 1, GUARDCOAT.c0);
    }
    strawTuft(c, 17, B - 29, -1, 0);
    strawTuft(c, 47, B - 29, 1, 0);
    c.vline(32, B - 30, 16, GUARDCOAT.c0);
    line(c, 29, B - 31, 31, B - 25, GUARDCOAT.c3);
    line(c, 36, B - 31, 34, B - 25, GUARDCOAT.c1);
    for (const [y, col] of [[B - 25, BL.h2], [B - 21, P.stone3], [B - 17, WOOD.c3]] as const) c.set(33, y, col);
    c.rect(25, B - 22, 3, 3, mix(P.blood1, P.wood2, 0.3));
    c.set(25, B - 22, mix(P.blood2, P.wood2, 0.3));
    c.rect(35, B - 18, 3, 2, SACK.c1);
    c.set(35, B - 18, SACK.c2);
    for (let x = 26; x <= 38; x++) c.set(x, B - 22, x % 2 ? EN.rope : WOOD.c3); // twine belt
    for (let x = 25; x < 40; x++) {
      const t = (x * 5) % 3; // the hem, burst with straw
      c.vline(x, B - 13, t + 1, [STRAW.c1, STRAW.c3, STRAW.c2][(x * 7) % 3]);
    }
    strawTuft(c, 27, B - 32, -1, -1);
    strawTuft(c, 37, B - 32, 1, -1);
    // the sack head, tied at the neck
    sackHead(c, 32, B - 37, 5, SACK, false);
    c.hline(29, B - 32, 7, EN.rope);
    c.set(30, B - 38, P.ink); // painted eyes, a stitch over each
    c.set(34, B - 38, P.ink);
    c.set(30, B - 39, SACK.c0);
    c.set(34, B - 39, SACK.c0);
    for (let x = 29; x <= 35; x++) c.set(x, B - 35 + (x === 29 || x === 35 ? -1 : 0), x % 2 ? P.ink : SACK.c0);
    // the hat: battered felt, dented, the brim drooping, a flower stuck in its band
    c.ellipse(32, B - 42, 8, 1.8, FELT.c1);
    c.hline(24, B - 42, 6, FELT.c2);
    c.set(40, B - 41, FELT.c1);
    c.set(40, B - 40, FELT.c0);
    c.rect(28, B - 47, 9, 5, FELT.c2);
    c.vline(28, B - 47, 5, FELT.c3);
    c.vline(36, B - 47, 5, FELT.c1);
    c.set(32, B - 47, FELT.c1);
    c.set(31, B - 47, FELT.c3);
    c.hline(28, B - 43, 9, mix(P.moss1, FELT.c1, 0.4));
    c.set(35, B - 44, P.blossom);
    c.set(36, B - 44, mix(P.blossom, P.poppy, 0.3));
    c.set(26, B - 41, STRAW.c3);
    c.set(38, B - 40, STRAW.c2);
    // a crow resting on the bar
    perchedCrow(c, 41, B - 33, false);
    push(c, 6);
  }
  // 6 skep bench (2 tiles): a plank on stone legs, three straw skeps, one with bees at the door
  {
    const c = cell();
    box(c, 18, B - 8, 5, 8, HSTONE);
    box(c, 42, B - 8, 5, 8, HSTONE);
    box(c, 14, B - 11, 37, 3, WOOD);
    skep(c, 22, B - 11, 6);
    skep(c, 33, B - 11, 6);
    skep(c, 44, B - 11, 5);
    for (const [x, y] of [[27, B - 18], [30, B - 22], [36, B - 20]]) c.set(x, y, P.flame2); // bees
    push(c, 18);
  }
  // 7 lavender bush: a round grey-green bush crowned with violet spikes
  {
    const c = cell();
    const r = rng(17);
    blob(c, 32, B - 6, 12, 7, { c0: mix(BL.g0, P.stone1, 0.3), c1: mix(BL.g1, P.stone2, 0.35), c2: mix(BL.g3, P.stone3, 0.35), c3: mix(BL.g4, P.stone4, 0.3) });
    for (let i = 0; i < 18; i++) {
      const x = 22 + Math.floor(r() * 21);
      const h = 5 + Math.floor(r() * 6);
      c.vline(x, B - 8 - h, h, mix(BL.g2, P.stone3, 0.3));
      c.vline(x, B - 11 - h, 3, P.violet2);
      c.set(x, B - 11 - h, P.violet3);
      c.set(x + 1, B - 10 - h, P.violet1);
    }
    push(c, 9);
  }
  // 8 hive box: a whitewashed box hive on legs, a little gabled roof, a landing board
  {
    const c = cell();
    box(c, 25, B - 5, 2, 5, WOOD);
    box(c, 37, B - 5, 2, 5, WOOD);
    boards(c, 23, B - 21, 18, 16, PAINT, false, 4, 18);
    c.vline(40, B - 21, 16, PAINT.c0);
    c.hline(23, B - 13, 18, PAINT.c0); // between the boxes
    // roof
    for (let i = 0; i < 5; i++) c.hline(21 + i, B - 22 - i, 22 - i * 2, i === 4 ? WOOD.c3 : WOOD.c1);
    c.hline(21, B - 22, 22, WOOD.c0);
    c.hline(28, B - 7, 8, P.ink); // the entrance
    c.hline(27, B - 6, 10, WOOD.c2); // landing board
    for (const [x, y] of [[30, B - 9], [33, B - 8], [44, B - 14]]) c.set(x, y, P.flame2);
    push(c, 10);
  }
  // 9 the Synod's notice: nailed over the orchard's own sign, sealed in red wax
  {
    const c = cell();
    box(c, 31, B - 30, 3, 30, WOOD);
    boards(c, 22, B - 30, 21, 11, WOOD, false, 4, 19); // the old painted sign (a bee, just visible)
    c.set(25, B - 24, P.flame2);
    c.set(26, B - 24, P.ink);
    c.rect(28, B - 29, 13, 12, P.wax2); // the notice
    c.hline(28, B - 29, 13, mix(P.wax2, P.white, 0.4));
    for (const y of [B - 27, B - 25, B - 23, B - 21]) c.hline(30, y, 9 - (y % 3), mix(P.ink, P.wax1, 0.4)); // its writing
    c.disc(38, B - 19, 1.8, P.blood2); // the seal
    c.set(37, B - 20, mix(P.blood2, P.wax2, 0.4));
    c.set(29, B - 28, IRON.c2); // nails
    c.set(40, B - 28, IRON.c2);
    push(c, 5);
  }
  // 10 the orchard gate (3-tile way through): honey-stone pillars capped with stone skeps, the burned timber arch
  {
    const c = cell();
    for (const x0 of [0, 55]) {
      box(c, x0, B - 34, 9, 34, HSTONE);
      for (let y = B - 30; y < B; y += 6) c.hline(x0 + 1, y, 7, HSTONE.c0); // courses
      skep(c, x0 + 4, B - 34, 4); // a stone skep on top
    }
    // the arch beam, burnt through in the middle and sagging
    box(c, 6, B - 40, 22, 4, CHAR);
    box(c, 36, B - 40, 22, 4, CHAR);
    line(c, 27, B - 37, 31, B - 33, CHAR.c1);
    line(c, 37, B - 37, 34, B - 32, CHAR.c1);
    for (const x of [14, 22, 42, 50]) c.set(x, B - 39, P.ember);
    // what's left of the carved letters: BLOOM...
    for (let x = 8; x < 26; x += 3) c.set(x, B - 38, mix(P.flame1, CHAR.c3, 0.5));
    // a garland of dead flowers still hanging on one pillar
    for (let y = B - 30; y < B - 18; y += 2) c.set(9, y, y % 4 ? mix(P.blossom, P.wood1, 0.5) : BL.g0);
    c.outline(P.ink);
    finish(c, 5, B, 5, 2);
    finish(c, 59, B, 5, 2);
    f.push(c);
  }
  // 11 honey barrels (2 tiles): two casks, one broached and dribbling
  {
    const c = cell();
    kegAt(c, 24, B, 7);
    kegAt(c, 40, B, 7);
    c.rect(44, B - 9, 3, 2, WOOD.c2); // the tap
    c.vline(46, B - 7, 7, BL.h2);
    c.ellipse(46, B, 4, 1.4, BL.h1);
    for (const x of [22, 38]) {
      c.hline(x - 2, B - 8, 5, BL.h1); // honey-sticky hoops
      c.set(x, B - 7, BL.h2);
    }
    push(c, 16);
  }
  // 12 mead rack (2 tiles, tall): a timber rack of small casks and stoppered jugs
  {
    const c = cell();
    box(c, 14, B - 44, 3, 44, WOOD);
    box(c, 47, B - 44, 3, 44, WOOD);
    for (const y of [B - 30, B - 16, B - 2]) box(c, 14, y, 36, 3, WOOD);
    for (const x of [22, 32, 42]) kegAt(c, x, B - 3, 4);
    for (const [x, col] of [[20, BL.h2], [26, P.wax1], [31, BL.h1], [37, BL.h2], [43, P.wax1]] as const) {
      c.rect(x, B - 26, 4, 9, col); // jugs
      c.vline(x, B - 26, 9, mix(col, P.wax2, 0.35));
      c.rect(x + 1, B - 28, 2, 2, WOOD.c1); // stoppers
    }
    for (const x of [20, 30, 40]) {
      c.rect(x, B - 42, 5, 11, mix(P.teal1, P.ink, 0.2)); // dark bottles
      c.vline(x + 1, B - 41, 9, P.teal2);
    }
    push(c, 18);
  }
  // 13 the bee altar (2 tiles): honey-stone, golden beeswax tapers, a gilded comb on a cloth
  {
    const c = cell();
    box(c, 15, B - 14, 34, 14, HSTONE);
    for (let y = B - 11; y < B; y += 4) c.hline(16, y, 32, HSTONE.c0);
    c.rect(18, B - 16, 28, 3, P.wax2); // altar cloth
    c.hline(18, B - 14, 28, P.poppy); // its red hem
    for (let x = 19; x < 46; x += 3) c.set(x, B - 13, P.poppy);
    // the comb: a gilded hexagon
    for (let y = 0; y < 8; y++) {
      const half = y < 2 ? 3 + y : y > 5 ? 10 - y : 5;
      c.hline(32 - half, B - 24 + y, half * 2, y % 2 ? BL.h2 : BL.h3);
    }
    for (const x of [28, 31, 34]) c.set(x, B - 21, BL.h0);
    // tapers, golden, lit
    for (const [x, h] of [[20, 9], [23, 12], [41, 12], [44, 9]]) {
      c.rect(x, B - 16 - h, 2, h, mix(P.wax2, P.honey, 0.3));
      c.vline(x + 1, B - 16 - h, h, mix(P.wax1, P.honey, 0.4));
      c.set(x, B - 17 - h, P.dark1);
      c.set(x, B - 18 - h, P.flame2);
      c.set(x, B - 19 - h, P.flame1);
    }
    push(c, 18);
  }
  // 14 the great skep: the Queen's hive, a straw hall taller than a man, bees at its door, comb bulging from its seams
  {
    const c = cell();
    const cx = 32;
    const r = 23;
    const h = 52;
    for (let y = 0; y < h; y++) {
      const k = y / h;
      const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (1 - k) ** 1.6))); // a tall straw bell
      const band = y % 3; // coils of straw rope, each lit on top with a dark groove below, bound with bramble
      for (let x = -half; x <= half; x++) {
        const nx = x / Math.max(1, half);
        let l = -nx * 0.95 + (band === 0 ? 0.3 : band === 2 ? -0.4 : 0) + (1 - k) * 0.15;
        if (band === 1 && (x + Math.floor(y / 3) * 5) % 11 === 0) l -= 0.35;
        c.set(cx + x, B - h + y, l > 0.45 ? STRAW.c3 : l > 0 ? STRAW.c2 : l > -0.55 ? STRAW.c1 : STRAW.c0);
      }
    }
    // the great door: a dark arch with a warm glow deep inside, honey welling out of it
    c.ellipse(cx, B - 6, 6, 7, P.ink, (_x, y) => y < B);
    c.ellipse(cx, B - 1, 3.5, 2, mix(P.ink, BL.h1, 0.4), (_x, y) => y < B);
    c.ellipse(cx, B, 9, 2, BL.h2);
    c.hline(cx - 5, B - 1, 10, BL.h3);
    c.vline(cx - 6, B - 9, 5, BL.h2); // running down the straw beside it
    c.set(cx - 6, B - 4, BL.h1);
    // comb bulging through a split in the straw, its cells full and dripping
    c.ellipse(cx + 10, B - 29, 3.5, 6, mix(P.wax1, BL.h2, 0.35));
    c.ellipse(cx + 9, B - 30, 2, 3.5, mix(P.wax1, BL.h3, 0.3));
    for (let y = 0; y < 12; y += 2) for (let x = 0; x < 6; x += 2) if (c.alpha(cx + 7 + x + ((y / 2) % 2), B - 35 + y)) c.set(cx + 7 + x + ((y / 2) % 2), B - 35 + y, BL.h1);
    c.vline(cx + 7, B - 36, 13, P.ink);
    c.vline(cx + 10, B - 23, 4, BL.h2);
    c.set(cx + 10, B - 19, BL.h1);
    // a crown of wax on its peak
    for (const [x, hh] of [[-3, 3], [0, 5], [3, 3]]) c.vline(cx + x, B - h - hh, hh, P.wax2);
    c.set(cx, B - h - 6, P.flame2);
    for (const [x, y] of [[-14, -40], [12, -46], [18, -22], [-20, -18], [-8, -50], [6, -12]]) crawlingBee(c, cx + x, B + y, x > 0); // bees
    push(c, 26);
  }
  // 15 charred stump
  {
    const c = cell();
    for (let y = 0; y < 9; y++) {
      const w = 12 - Math.floor(y / 3);
      for (let x = 0; x < w; x++) c.set(32 - Math.floor(w / 2) + x, B - y, shadeT(x / (w - 1), CHAR));
    }
    c.ellipse(32, B - 9, 4.5, 1.5, CHAR.c2);
    for (let i = 0; i < 3; i++) c.set(29 + i * 3, B - 9, i === 1 ? P.ember : CHAR.c3);
    line(c, 26, B, 22, B + 1, CHAR.c1);
    push(c, 8);
  }
  // 16 honey cart (2 tiles): a hand cart of stoppered honey jars, one wheel
  {
    const c = cell();
    boards(c, 16, B - 16, 30, 9, WOOD, false, 3, 26);
    line(c, 46, B - 12, 58, B - 16, WOOD.c2); // handles
    line(c, 46, B - 10, 58, B - 14, WOOD.c1);
    c.disc(22, B - 5, 5, WOOD.c0);
    c.disc(22, B - 5, 3.5, WOOD.c2);
    c.disc(22, B - 5, 1.2, IRON.c2);
    for (const x of [19, 25, 31, 37]) {
      c.rect(x, B - 23, 5, 7, BL.h2);
      c.vline(x, B - 23, 7, BL.h3);
      c.vline(x + 4, B - 23, 7, BL.h1);
      c.rect(x + 1, B - 25, 3, 2, P.wax1); // wax-sealed tops
    }
    push(c, 18);
  }
  // 17 a stack of comb frames, dripping
  {
    const c = cell();
    for (let i = 0; i < 4; i++) {
      const y = B - 5 - i * 5;
      box(c, 22 + (i % 2), y, 20, 5, WOOD);
      c.hline(24 + (i % 2), y + 2, 16, i % 2 ? BL.h2 : P.wax1);
    }
    c.vline(40, B - 8, 5, BL.h2);
    push(c, 12);
  }
  // 18 a bee saint: a stone saint cradling a skep, bees for a halo
  {
    const c = cell();
    box(c, 25, B - 6, 14, 6, HSTONE); // plinth
    for (let y = B - 36; y < B - 6; y++) {
      const w = 8 + Math.floor((y - (B - 36)) / 5);
      for (let x = 0; x < w; x++) c.set(32 - Math.floor(w / 2) + x, y, shadeT(x / (w - 1), STN));
    }
    c.disc(32, B - 40, 4, STN.c2);
    c.disc(31, B - 41, 2.5, STN.c3);
    skep(c, 36, B - 20, 5);
    c.vline(27, B - 30, 12, STN.c0); // a fold
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      c.set(Math.round(32 + Math.cos(a) * 7), Math.round(B - 41 + Math.sin(a) * 4), P.flame2);
    }
    for (const x of [28, 35]) c.set(x, B - 33, BL.g3); // moss on its shoulders
    push(c, 9);
  }
  // 19 fallen skep (flat): a hive knocked off its bench, split, lying in its own honey
  {
    const c = cell();
    c.ellipse(32, B - 1, 13, 3, BL.h1);
    c.ellipse(30, B - 2, 8, 1.8, BL.h2);
    skep(c, 34, B - 1, 6, true);
    for (const [x, y] of [[22, B - 4], [42, B - 3]]) c.set(x, y, P.ink); // dead bees
    push(c, 13);
  }
  // 20 pew (2 tiles): a chapel bench with a bee carved on its end
  {
    const c = cell();
    box(c, 15, B - 12, 34, 4, WOOD);
    box(c, 15, B - 20, 34, 3, WOOD);
    for (const x of [16, 46]) box(c, x, B - 20, 3, 20, WOOD);
    c.set(17, B - 16, P.flame1); // the carved bee
    c.set(18, B - 16, WOOD.c0);
    push(c, 18);
  }
  // 21 candle stand: an iron stand of golden beeswax votives
  {
    const c = cell();
    box(c, 31, B - 20, 2, 20, IRON);
    c.hline(26, B - 20, 12, IRON.c2);
    c.hline(28, B - 1, 8, IRON.c1);
    for (const x of [27, 30, 33, 36]) {
      const h = 3 + (x % 3);
      c.rect(x, B - 20 - h, 2, h, mix(P.wax2, P.honey, 0.3));
      c.set(x, B - 21 - h, P.flame2);
      c.set(x, B - 22 - h, P.flame1);
    }
    push(c, 5);
  }
  // 22 hollyhocks: tall spires of pink and red flowers against a wall
  {
    const c = cell();
    const r = rng(32);
    for (let i = 0; i < 4; i++) {
      const x = 26 + i * 4;
      const h = 22 + Math.floor(r() * 12);
      c.vline(x, B - h, h, BL.g1);
      for (let y = B - h; y < B - 6; y += 3) {
        const col = i % 2 ? P.blossom : P.poppy;
        c.rect(x - 1, y, 3, 2, col);
        c.set(x, y, mix(col, P.flame2, 0.4));
        if (y % 2) c.set(x + 2, y + 2, BL.g3); // a leaf
      }
    }
    push(c, 8);
  }
  // 23 ash heap (flat): what the Synod's men burned: skeps, frames, a scorched comb
  {
    const c = cell();
    c.ellipse(32, B - 1, 13, 3.5, BL.a1);
    c.ellipse(31, B - 2, 9, 2.2, BL.a2);
    line(c, 24, B - 2, 32, B - 4, P.ink);
    line(c, 34, B - 1, 41, B - 4, CHAR.c1);
    c.rect(28, B - 4, 4, 2, mix(P.wax1, P.ink, 0.5)); // a blackened comb
    c.set(36, B - 3, P.ember);
    push(c, 13);
  }
  const img = new Img(W * f.length, W);
  f.forEach((c, i) => img.blit(c, i * W, 0));
  sheet('decor_bloom', img, { cell: [W, W], pivot: [32, B], layer: 'single' });

  // the hive prop (breakable): a skep on a post; frame 1 knocked down and split
  const hive = new Img(48, 32);
  {
    const a = new Img(24, 32);
    box(a, 11, 18, 3, 12, WOOD); // the post
    box(a, 5, 16, 15, 3, WOOD); // its board
    skep(a, 12, 16, 7);
    a.set(6, 8, P.flame2);
    a.set(18, 5, P.flame2);
    a.outline(P.ink);
    hive.blit(a, 0, 0);
    const b = new Img(24, 32);
    box(b, 11, 22, 3, 8, WOOD);
    b.ellipse(12, 29, 10, 2.2, BL.h1);
    skep(b, 13, 29, 6, true);
    b.outline(P.ink);
    hive.blit(b, 24, 0);
  }
  sheet('prop_hive', hive, { cell: [24, 32], pivot: [12, 29], layer: 'single' });

  // the tallow seal (in a wall tile): the Order's grey tallow poured across an old doorway, stamped with the
  // Synod's flame; frame 1 melted away to a puddle
  const seal = new Img(32, 16);
  {
    const a = new Img(16, 16);
    const TAL: Ramp = { c0: mix(P.wax1, P.stone2, 0.55), c1: mix(P.wax1, P.stone3, 0.4), c2: mix(P.wax1, P.stone4, 0.25), c3: P.wax1 };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) a.set(x, y, shadeT(x / 15, TAL));
    for (const [x, l] of [[2, 5], [7, 8], [12, 4]]) a.vline(x, 16 - l, l, TAL.c3); // runs down its face
    a.hline(0, 0, 16, TAL.c3);
    // the stamp: the Synod's flame in a ring
    a.ellipse(8, 7, 3.5, 3.5, TAL.c0);
    a.ellipse(8, 7, 2.5, 2.5, TAL.c2);
    a.vline(8, 5, 4, P.blood1);
    a.set(7, 7, P.blood1);
    a.set(9, 6, P.blood1);
    seal.blit(a, 0, 0);
    const b = new Img(16, 16);
    b.ellipse(8, 14, 7, 1.8, mix(P.wax1, P.stone3, 0.4));
    b.hline(4, 13, 6, P.wax1);
    seal.blit(b, 16, 0);
  }
  sheet('prop_seal', seal, { cell: [16, 16], pivot: [8, 16], layer: 'single' });
}

// ---- Bloomhollow's creatures
const SMOCK: Ramp = { c0: mix(P.wax1, P.stone2, 0.55), c1: mix(P.wax1, P.stone3, 0.3), c2: mix(P.wax1, P.wax2, 0.25), c3: P.wax2 };
const HUSKWAX: Ramp = { c0: mix(P.wax1, P.wood1, 0.45), c1: mix(P.wax1, P.honey, 0.35), c2: mix(P.wax2, P.honey, 0.3), c3: P.wax2 };
const GUARDCOAT: Ramp = { c0: mix(P.teal1, P.ink, 0.35), c1: P.teal1, c2: mix(P.teal1, P.teal2, 0.6), c3: P.teal2 };
const SACK: Ramp = { c0: mix(P.wood1, P.dark1, 0.3), c1: mix(P.wax1, P.wood2, 0.6), c2: mix(P.wax1, P.wood2, 0.4), c3: mix(P.wax1, P.wood2, 0.2) };

const VEIL: Ramp = { c0: mix(P.ink, P.dark1, 0.4), c1: P.dark1, c2: mix(P.dark2, P.stone2, 0.3), c3: mix(P.stone2, P.stone3, 0.4) };

/** A bee crawling on something: a gold body with a black band and a glint of wing. */
function crawlingBee(c: Img, x: number, y: number, flip = false) {
  c.set(x, y, P.flame2);
  c.set(x + (flip ? -1 : 1), y, P.ink);
  c.set(x + (flip ? 1 : -1), y, mix(P.honey, P.ink, 0.3));
  c.set(x, y - 1, withAlpha(P.wax2, 210));
}

/** A wide straw hat with a veil of black gauze falling to the shoulders, a wax face just seen through it. */
function veiledHead(c: Img, dir: Dir5, hx: number, hy: number, flinch: boolean) {
  const back = dir === 'N' || dir === 'NE';
  const side = dir === 'E';
  const f = faceX(dir, hx);
  // the veil: a bell of gauze from the brim to the shoulders, lit down its left side, the mesh just showing
  for (let y = hy - 1; y <= hy + 6; y++) {
    const half = 3.4 + Math.max(0, y - hy) * 0.42;
    const x0 = Math.round(hx - half);
    const x1 = Math.round(hx + half);
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0);
      let col = t < 0.18 ? VEIL.c2 : t > 0.8 ? VEIL.c0 : VEIL.c1;
      if ((x + y) % 2 === 0) col = mix(col, VEIL.c3, 0.22);
      const fx = x - f;
      if (!back && Math.abs(fx) <= 2 && y >= hy && y <= hy + 4 && !(Math.abs(fx) === 2 && (y === hy || y === hy + 4))) {
        // the face, pale wax seen through black mesh
        const lit = fx < 0 || (fx === 0 && y < hy + 3);
        col = (x + y) % 2 ? mix(lit ? HUSKWAX.c3 : HUSKWAX.c1, VEIL.c1, 0.2) : mix(lit ? HUSKWAX.c2 : HUSKWAX.c0, VEIL.c1, 0.45);
      }
      c.set(x, y, col);
    }
  }
  c.hline(Math.round(hx - 5.9), hy + 6, 12, VEIL.c2); // the veil's hem where it lies on the shoulders
  if (!back) {
    const eye = flinch ? P.flame2 : P.ember; // a honey glint deep in empty sockets
    const socket = mix(HUSKWAX.c0, P.ink, 0.6);
    c.set(f - 1, hy + 1, socket);
    c.set(f - 1, hy + 2, eye);
    if (!side) {
      c.set(f + 1, hy + 1, socket);
      c.set(f + 1, hy + 2, eye);
    }
    c.set(f, hy + 3, mix(HUSKWAX.c0, P.ink, 0.35)); // a slack mouth
  }
  // the hat: a woven brim seen a little from above, a rounded crown, a faded red band
  c.ellipse(hx, hy - 2, 6.8, 1.9, STRAW.c1);
  c.ellipse(hx, hy - 2.4, 6.3, 1.4, STRAW.c2, (_x, y) => y <= hy - 3);
  c.hline(hx - 6, hy - 1, 13, STRAW.c0); // the brim's shaded underside
  for (let x = -6; x <= 6; x += 2) c.set(hx + x, hy - 2, x < 0 ? STRAW.c2 : STRAW.c0); // the weave
  c.set(hx - 5, hy - 3, STRAW.c3);
  c.ellipse(hx, hy - 4.2, 3.4, 2.6, STRAW.c1, (_x, y) => y <= hy - 3);
  c.ellipse(hx - 0.8, hy - 4.8, 2.3, 1.8, STRAW.c2, (_x, y) => y <= hy - 4);
  c.set(hx - 2, hy - 6, STRAW.c3);
  c.hline(hx - 3, hy - 3, 7, mix(P.poppy, P.wood1, 0.35));
  c.hline(hx - 3, hy - 3, 2, mix(P.poppy, P.flame1, 0.25));
  if (!back) c.set(hx + 3, hy - 3, mix(P.poppy, P.ink, 0.4)); // the band's knot
}

// --- Beekeeper Husk: a beekeeper the Synod rendered and set back to work, a wax figure in a veiled hat and a
// honey-stained smock. It pumps its smoker into your eyes, and bees crawl on it unharmed.
type HuskPose = BodyPose & { pump?: number; bash?: number };
const HUSK_HAND: Record<Dir5, [number, number]> = { S: [21, 20], SE: [21, 19], E: [19, 19], NE: [20, 18], N: [20, 18] };
function huskHand(dir: Dir5, p: HuskPose): [number, number] {
  const [hx, hy] = HUSK_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const pump = p.pump ?? 0;
  const bash = p.bash ?? 0;
  return [Math.round(hx + lx + fx * pump * 3 - bash * 2), Math.round(hy + ly + (p.bob ?? 0) - pump * 4 + fy * pump * 2 - bash * 6)];
}
/** A baggy smock sleeve from the shoulder to a gathered cuff and a leather glove. */
function smockArm(c: Img, sx: number, sy: number, hx: number, hy: number, far: boolean) {
  const inner = hx < 16 ? 1 : -1; // the edge against the body is in shadow
  for (let t = -1; t <= 1; t++) line(c, sx + t, sy, hx + t, hy - 2, far ? (t === inner ? SMOCK.c0 : SMOCK.c1) : t === inner ? SMOCK.c0 : t === -inner ? SMOCK.c3 : SMOCK.c2);
  c.hline(hx - 1, hy - 2, 3, far ? SMOCK.c0 : SMOCK.c1); // the cuff tie
  c.rect(hx - 1, hy - 1, 3, 2, far ? DWOOD.c1 : DWOOD.c2);
  c.set(hx - 1, hy - 1, far ? DWOOD.c2 : DWOOD.c3);
  c.set(hx + 1, hy, DWOOD.c0);
}
function drawHusk(c: Img, dir: Dir5, pose: HuskPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, pump: 0, bash: 0, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const side = dir === 'E';
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  // dark breeches into heavy boots
  for (const [x, lift, dark] of [[13, liftL, 0], [17, liftR, 1]] as const) {
    c.rect(x, 23 + b, 3, 2 - Math.min(1, lift), dark ? VEIL.c1 : VEIL.c2);
    c.rect(x, 25 - lift + b, 3, 2, dark ? WOOD.c0 : WOOD.c1);
    c.set(x, 25 - lift + b, dark ? WOOD.c1 : WOOD.c2);
    c.hline(x, 26 - lift + b, 3, dark ? P.ink : WOOD.c0);
  }
  // the far arm, behind the body in profile
  const [ax, ay] = huskHand(dir, o);
  if (side) smockArm(c, 14 + sh, 14 + b, 13 + sh, 21 + b, true);
  // the smock, to the shins: round shoulders, a waist cinched by the belt, full skirts, lit from the left
  for (let y = 13; y <= 24; y++) {
    const w = y === 13 ? 7 : y < 19 ? 9 : 10 + Math.floor((y - 19) / 2);
    const x0 = 16 - Math.floor(w / 2) + (y < 19 ? sh : 0);
    for (let x = 0; x < w; x++) c.set(x0 + x, y + b, shadeT(x / (w - 1), SMOCK));
  }
  // folds falling from the belt, a scalloped hem, wax running off it
  c.vline(14, 20 + b, 4, SMOCK.c2);
  c.vline(15, 20 + b, 4, SMOCK.c1);
  c.vline(18, 20 + b, 4, SMOCK.c0);
  for (let x = 10; x < 23; x++) if (c.alpha(x, 24 + b) && x % 3 === 0) c.set(x, 24 + b, SMOCK.c0);
  c.vline(20, 25 + b, 2, HUSKWAX.c1);
  c.set(20, 26 + b, HUSKWAX.c0);
  // rope belt, knotted, its ends hanging
  for (let x = 12; x <= 20; x++) c.set(x + sh, 18 + b, x % 2 ? EN.rope : WOOD.c3);
  if (!back) {
    c.set(13 + sh, 19 + b, EN.rope);
    c.set(13 + sh, 20 + b, WOOD.c3);
    // the honey it worked in, soaked down the front from the chest
    for (const [x, y, col] of [[17, 14, BL.h3], [17, 15, BL.h2], [18, 15, BL.h1], [17, 16, BL.h1], [17, 17, BL.h0], [17, 19, BL.h1], [17, 20, BL.h0]] as const)
      c.set(x + (y < 19 ? sh : 0), y + b, col);
    c.hline(13 + sh, 15 + b, 2, SMOCK.c1); // a breast pocket
    c.set(13 + sh, 14 + b, SMOCK.c3);
  } else {
    c.vline(16 + sh, 14 + b, 4, SMOCK.c1); // the back seam
    c.vline(16, 19 + b, 5, SMOCK.c1);
  }
  // arms: the near off arm hanging, the smoker arm out to its hand; a shadow where each meets the body
  if (!side) smockArm(c, 11 + sh, 14 + b, 10 + sh, 21 + b, false);
  smockArm(c, 21 + sh, 14 + b, ax, ay + 1, back);
  // a bee or two crawling over it, as they crawl over anything that smells of honey
  crawlingBee(c, 13 + sh, 17 + b);
  if (!back) crawlingBee(c, 19, 23 + b, true);
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 7 + b + o.hunch + ly;
  veiledHead(c, dir, hx, hy, o.flinch);
}
function huskDeath(c: Img, f: number) {
  if (f < 2) return drawHusk(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true });
  // it slumps into a puddle of wax in its own smock; the hat rolls off
  c.ellipse(16, 25, 9, 3, HUSKWAX.c1);
  c.ellipse(15, 24.5, 6.5, 2.2, SMOCK.c1);
  c.ellipse(14, 24, 4, 1.4, SMOCK.c2);
  c.ellipse(22, 25.5, 3, 1.2, HUSKWAX.c2);
  c.set(20, 24, BL.h2);
  c.ellipse(8, 23, 4.5, 1.4, STRAW.c1);
  c.ellipse(8, 22.5, 2.4, 1.2, STRAW.c2);
  c.hline(6, 23, 5, mix(P.poppy, P.wood1, 0.35));
  if (f < 4) crawlingBee(c, 18, 23);
}

// --- Orchard Guard: a scarecrow that stands in the rows with its arms out, and then doesn't.
type GuardPose = BodyPose & { wake?: number; reap?: number };
const GUARD_HAND: Record<Dir5, [number, number]> = { S: [22, 19], SE: [22, 18], E: [20, 18], NE: [21, 17], N: [21, 17] };
function guardHand(dir: Dir5, p: GuardPose): [number, number] {
  const [hx, hy] = GUARD_HAND[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const wake = p.wake ?? 1;
  const reap = p.reap ?? 0;
  // asleep, the arm is straight out along the cross-bar
  return [Math.round(hx + lx + (1 - wake) * 4 - reap * 3), Math.round(hy + ly + (p.bob ?? 0) - (1 - wake) * 4 - reap * 5)];
}
const FELT: Ramp = { c0: mix(P.dark1, P.ink, 0.3), c1: mix(P.wood1, P.dark1, 0.55), c2: mix(P.wood1, P.dark2, 0.3), c3: mix(P.wood1, P.stone2, 0.35) };
/** A burst of straw: a few stiff strands fanning out from (x, y) toward (dx, dy). */
function strawTuft(c: Img, x: number, y: number, dx: number, dy: number) {
  const px = -dy;
  const py = dx;
  for (const [k, col] of [[-1, STRAW.c1], [0, STRAW.c3], [1, STRAW.c2]] as const) {
    c.set(x + dx + px * k, y + dy + py * k, col);
    c.set(x + Math.round(dx * 1.8) + px * k * 1.5, y + Math.round(dy * 1.8) + Math.round(py * k * 1.5), k ? STRAW.c1 : STRAW.c2);
  }
  c.set(x, y, STRAW.c2);
}
/** A sack head: stitched burlap, lit from the top left; `back` shows the seam and the tie. */
function sackHead(c: Img, hx: number, hy: number, r: number, R: Ramp, back: boolean) {
  litBall(c, hx, hy, r, r * 0.95, R);
  for (let y = Math.floor(hy - r); y <= hy + r; y++)
    for (let x = Math.floor(hx - r); x <= hx + r; x++) if (c.alpha(x, y) && (x * 3 + y * 5) % 11 === 0) c.set(x, y, mix(R.c1, R.c0, 0.4)); // the weave
  if (back) c.vline(hx, Math.round(hy - r + 1), Math.round(r * 2 - 1), R.c0); // the seam
}
function drawGuard(c: Img, dir: Dir5, pose: GuardPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, wake: 1, reap: 0, ...pose };
  const b = o.bob;
  const w = o.wake;
  const { lx, ly, sh } = leanOffsets(dir, o.lean * w);
  const back = dir === 'N' || dir === 'NE';
  const side = dir === 'E';
  // below the coat: the post it stood on, or two stick legs in rag puttees once it walks
  if (w < 0.5) box(c, 15, 21 + b, 3, 7, WOOD);
  else {
    const liftL = o.step === 1 ? 2 : 0;
    const liftR = o.step === 3 ? 2 : 0;
    for (const [x, lift, R] of [[13, liftL, WOOD], [18, liftR, DWOOD]] as const) {
      box(c, x, 21 + b, 2, 7 - lift, R);
      c.hline(x, 24 + b - lift, 2, SACK.c1); // rag bindings
      c.hline(x, 26 + b - lift, 2, SACK.c0);
    }
  }
  // the cross-bar under the coat's shoulders (asleep)
  if (w < 0.5) box(c, 4, 13 + b, 24, 2, WOOD);
  // the far arm in profile, behind the coat
  const [ax, ay] = guardHand(dir, o);
  if (side && w >= 0.5) {
    line(c, 14 + sh, 13 + b, 13 + sh, 19 + b, GUARDCOAT.c0);
    strawTuft(c, 13 + sh, 20 + b, 0, 1);
  }
  // the coat: an old keeper's frock, too big for the sticks inside it, patched and burst at the hem
  for (let y = 12; y <= 22; y++) {
    const cw = y === 12 ? 7 : y < 18 ? 10 : 10 + Math.floor((y - 17) / 2);
    const x0 = 16 - Math.floor(cw / 2) + (y < 17 ? sh : 0);
    for (let x = 0; x < cw; x++) c.set(x0 + x, y + b, shadeT(x / (cw - 1), GUARDCOAT));
  }
  for (let x = 11; x <= 21; x++) {
    const tatter = (x * 5) % 3; // a ragged hem, straw bursting through
    if (c.alpha(x, 22 + b)) {
      if (tatter === 0) c.set(x, 22 + b, null);
      c.vline(x, 23 + b - (tatter === 0 ? 1 : 0), tatter + 1, [STRAW.c1, STRAW.c3, STRAW.c2][(x * 7) % 3]);
    }
  }
  if (!back) {
    // lapels, a line of odd buttons, a sackcloth patch and a red one
    c.vline(16 + sh, 13 + b, 9, GUARDCOAT.c0);
    line(c, 14 + sh, 12 + b, 15 + sh, 16 + b, GUARDCOAT.c3);
    line(c, 18 + sh, 12 + b, 17 + sh, 16 + b, GUARDCOAT.c1);
    for (const [y, col] of [[15, BL.h2], [18, P.stone3], [20, WOOD.c3]] as const) c.set(17 + sh * (y < 17 ? 1 : 0), y + b, col);
    c.rect(12 + sh, 17 + b, 3, 3, mix(P.blood1, P.wood2, 0.3));
    c.set(12 + sh, 17 + b, mix(P.blood2, P.wood2, 0.3));
    c.set(14 + sh, 19 + b, P.ink); // a stitch
    c.rect(18, 19 + b, 2, 2, SACK.c1);
    c.set(18, 19 + b, SACK.c2);
  } else {
    c.rect(15, 16 + b, 3, 3, SACK.c1); // a patch on the back
    c.set(15, 16 + b, SACK.c2);
    c.set(17, 18 + b, P.ink);
  }
  for (let x = 11; x <= 20; x++) c.set(x + sh, 17 + b, x % 2 ? EN.rope : WOOD.c3); // twine for a belt
  // straw poking from the collar
  c.set(13 + sh, 11 + b, STRAW.c2);
  c.set(19 + sh, 11 + b, STRAW.c3);
  // arms: out stiff along the bar asleep; bent and gripping awake
  const sleeve = (sx: number, sy: number, hx: number, hy: number, lit: boolean) => {
    for (let t = 0; t <= 1; t++) line(c, sx + t, sy, hx + t, hy, lit ? (t ? GUARDCOAT.c2 : GUARDCOAT.c3) : t ? GUARDCOAT.c0 : GUARDCOAT.c1);
  };
  if (w < 0.5) {
    for (const [x0, x1, lit] of [[6, 11, true], [21, 26, false]] as const) {
      c.rect(x0, 12 + b, x1 - x0 + 1, 3, lit ? GUARDCOAT.c2 : GUARDCOAT.c1);
      c.hline(x0, 12 + b, x1 - x0 + 1, lit ? GUARDCOAT.c3 : GUARDCOAT.c2);
      c.hline(x0, 14 + b, x1 - x0 + 1, GUARDCOAT.c0);
    }
    strawTuft(c, 5, 13 + b, -1, 0);
    strawTuft(c, 27, 13 + b, 1, 0);
  } else {
    if (!side) {
      sleeve(11 + sh, 13 + b, 10 + sh, 18 + b, true);
      strawTuft(c, 10 + sh, 19 + b, 0, 1);
    }
    sleeve(20 + sh, 13 + b, ax, ay - 1, !back);
    strawTuft(c, ax, ay, 0, 1);
  }
  // the sack head: painted eyes (they burn when it wakes), a stitched grin, a battered felt hat
  const tilt = w < 0.5 ? 1 : 0;
  const hx = 16 + lx + (o.flinch ? -1 : 0) + tilt;
  const hy = 7 + b + o.hunch + ly;
  sackHead(c, hx, hy, 3.8, SACK, back);
  c.hline(hx - 2, hy + 4, 5, EN.rope); // tied off at the neck
  c.set(hx - 3, hy + 5, STRAW.c3);
  c.set(hx + 3, hy + 5, STRAW.c2);
  if (!back) {
    const f = faceX(dir, hx);
    const lit = w > 0.5;
    const eye = lit ? (o.flinch ? P.flame2 : P.ember) : P.ink;
    // painted eyes, a stitch over each; awake, a coal glows through the cloth
    for (const ex of side ? [f] : [f - 1, f + 1]) {
      c.set(ex, hy, eye);
      c.set(ex, hy - 1, SACK.c0);
    }
    for (let x = -2; x <= 2; x++) c.set(f + x, hy + 2 + (Math.abs(x) === 2 ? -1 : 0), x % 2 ? P.ink : SACK.c0); // the grin, stitched
  }
  // the hat: a battered felt crown, dented, a floppy brim, straw escaping under it
  const ty = hy - 1;
  c.ellipse(hx, ty - 3, 6.2, 1.5, FELT.c1);
  c.hline(hx - 6, ty - 3, 5, FELT.c2);
  c.set(hx + 6, ty - 2, FELT.c1); // the brim droops on one side
  c.set(hx + 6, ty - 1, FELT.c0);
  c.rect(hx - 3, ty - 7, 7, 4, FELT.c2);
  c.vline(hx - 3, ty - 7, 4, FELT.c3);
  c.vline(hx + 3, ty - 7, 4, FELT.c1);
  c.set(hx, ty - 7, FELT.c1); // the dent
  c.set(hx - 1, ty - 7, FELT.c3);
  c.hline(hx - 3, ty - 4, 7, mix(P.moss1, FELT.c1, 0.4)); // a band gone green
  c.set(hx + 2, ty - 6, P.ink); // a hole
  c.set(hx - 5, ty - 1, STRAW.c3);
  c.set(hx + 4, ty - 1, STRAW.c2);
}
function guardDeath(c: Img, f: number) {
  if (f < 2) return drawGuard(c, 'S', { bob: 2 + f, hunch: 2 + f, flinch: true });
  // it falls apart into a heap of coat and straw, the head rolled clear
  c.ellipse(16, 25, 8, 2.6, GUARDCOAT.c1);
  c.ellipse(15, 24.5, 5, 1.6, GUARDCOAT.c2);
  for (let i = 0; i < 10; i++) c.set(8 + i * 2, 25 + (i % 2) - (i % 3 === 0 ? 1 : 0), [STRAW.c1, STRAW.c2, STRAW.c3][i % 3]);
  sackHead(c, 23, 23, 2.6, SACK, false);
  if (f < 4) c.set(22, 23, P.ember);
  c.ellipse(8, 23, 4, 1.2, FELT.c1);
  c.rect(6, 21, 4, 2, FELT.c2);
  line(c, 12, 26, 20, 27, WOOD.c1);
}

/** A crow perched at (x, y) facing right (or left when `flip`): a glossy black body, tail, beak, a lit eye. */
function perchedCrow(c: Img, x: number, y: number, flip: boolean) {
  const X = (dx: number) => (flip ? x + 3 - dx : x + dx);
  const sheen = mix(P.dark2, P.violet1, 0.55);
  for (let dx = 0; dx < 4; dx++) c.set(X(dx), y, dx === 1 || dx === 2 ? sheen : P.ink);
  for (let dx = 0; dx < 4; dx++) c.set(X(dx), y + 1, P.ink);
  c.set(X(1), y + 1, mix(P.ink, P.violet1, 0.3)); // the folded wing
  c.set(X(-1), y + 1, P.ink); // the tail
  c.set(X(-2), y + 2, P.ink);
  c.set(X(4), y - 1, P.ink); // the head
  c.set(X(3), y - 1, P.ink);
  c.set(X(4), y, P.ink);
  c.set(X(4), y - 1, P.ember); // an eye
  c.set(X(5), y, mix(P.stone3, P.ink, 0.35)); // the beak
  c.set(X(1), y + 2, P.dark2); // feet gripping
  c.set(X(3), y + 2, P.dark2);
}

// --- The Scarecrow Warden (48 cell): the old orchard-keeper's scarecrow, burned with the grove and still
// keeping it. The keeper's own beekeeping coat on its back, scorched; a candle burning inside its sack head;
// crows riding its shoulders; a great scythe.
type WardenPose = BodyPose & { wake?: number; reap?: number; crow?: number; crouch?: number };
const SWARDEN_HAND: Record<Dir5, [number, number]> = { S: [33, 28], SE: [33, 27], E: [30, 27], NE: [32, 25], N: [32, 25] };
function swardenHand(dir: Dir5, p: WardenPose): [number, number] {
  const [hx, hy] = SWARDEN_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const wake = p.wake ?? 1;
  const reap = p.reap ?? 0;
  return [Math.round(hx + lx + (1 - wake) * 6 - reap * 5 + fx * Math.max(0, -reap) * 4), Math.round(hy + ly + (p.bob ?? 0) + (p.crouch ?? 0) * 2 - (1 - wake) * 6 - reap * 8 + fy * Math.max(0, -reap) * 2)];
}
const COAT_B: Ramp = { c0: mix(SMOCK.c0, P.ink, 0.45), c1: mix(SMOCK.c1, P.ink, 0.25), c2: SMOCK.c1, c3: SMOCK.c2 }; // scorched cream
const SACK_B: Ramp = { c0: mix(SACK.c0, P.ink, 0.4), c1: mix(SACK.c1, P.ink, 0.35), c2: mix(SACK.c2, P.ink, 0.25), c3: mix(SACK.c3, P.ink, 0.15) }; // smoked burlap
function drawScarecrowWarden(c: Img, dir: Dir5, pose: WardenPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, wake: 1, reap: 0, crow: 0, crouch: 0, ...pose };
  const b = o.bob + o.crouch * 2;
  const w = o.wake;
  const { lx, ly, sh } = leanOffsets(dir, o.lean * w);
  const back = dir === 'N' || dir === 'NE';
  const side = dir === 'E';
  // below the coat: the burnt stake it hung on, or two charred poles bound in rags once it walks
  if (w < 0.5) box(c, 22, 32 + b, 4, 12, CHAR);
  else {
    const liftL = o.step === 1 ? 3 : 0;
    const liftR = o.step === 3 ? 3 : 0;
    for (const [x, lift, far] of [[19, liftL, 0], [27, liftR, 1]] as const) {
      box(c, x, 32 + b, 3, 12 - lift, CHAR);
      c.vline(x, 33 + b, 10 - lift, far ? CHAR.c1 : CHAR.c3);
      for (const y of [36, 39]) c.hline(x, y + b - lift, 3, far ? SACK_B.c0 : SACK_B.c1); // rag bindings
      c.set(x + 1, 43 - lift + b, P.ember); // still smouldering where it stood in the fire
    }
  }
  if (w < 0.5) {
    box(c, 5, 18 + b, 38, 3, CHAR); // the cross-bar
    c.set(5, 18 + b, P.ember);
  }
  const [ax, ay] = swardenHand(dir, o);
  const sleeve = (sx: number, sy: number, hx: number, hy: number, far: boolean) => {
    const inner = hx < 24 ? 1 : -1; // the edge against the coat is in shadow
    for (let t = -1; t <= 1; t++) line(c, sx + t, sy, hx + t, hy, t === inner ? COAT_B.c0 : far ? COAT_B.c1 : t === -inner ? COAT_B.c3 : COAT_B.c2);
    c.hline(hx - 1, hy, 3, CHAR.c1); // a burnt cuff
  };
  if (side && w >= 0.5) {
    sleeve(21 + sh, 17 + b, 20 + sh, 29 + b, true);
    strawTuft(c, 20 + sh, 30 + b, 0, 1);
  }
  // the coat: long and too wide for the poles inside it, scorched darker toward a ragged hem that still glows
  const r = rng(4242);
  for (let y = 15; y <= 35; y++) {
    const cw = y === 15 ? 12 : y < 26 ? 16 : y === 26 ? 15 : 16 + Math.floor((y - 26) / 2);
    const x0 = 24 - Math.floor(cw / 2) + (y < 26 ? sh : 0);
    const burn = Math.max(0, (y - 27) / 9);
    for (let x = 0; x < cw; x++) c.set(x0 + x, y + b, mix(shadeT(x / (cw - 1), COAT_B), CHAR.c1, burn * 0.8));
  }
  for (let x = 15; x <= 33; x++) {
    if (!c.alpha(x, 34 + b)) continue;
    const ragged = Math.floor(r() * 4);
    for (let k = 0; k < ragged; k++) c.set(x, 35 + b - k, null);
    const tip = 35 + b - ragged;
    if (ragged > 0 && c.alpha(x, tip)) c.set(x, tip, r() < 0.45 ? P.ember : CHAR.c0); // the edge still burning
    if (ragged === 0 && r() < 0.3) c.set(x, 36 + b, x % 2 ? STRAW.c1 : CHAR.c3); // charred straw below it
  }
  const burnHole = (x: number, y: number) => {
    c.rect(x, y, 2, 2, CHAR.c0);
    c.set(x - 1, y, P.ember);
    c.set(x + 2, y + 1, P.ember);
    c.set(x, y - 1, mix(COAT_B.c1, P.ember, 0.5));
  };
  if (!back) {
    // the keeper's coat: the opening, lapels, brass buttons gone green, burn holes, a lantern at its hip
    c.vline(24 + sh, 16 + b, 17, COAT_B.c0);
    line(c, 21 + sh, 15 + b, 23 + sh, 21 + b, COAT_B.c3);
    line(c, 27 + sh, 15 + b, 25 + sh, 21 + b, COAT_B.c1);
    for (let y = 19; y < 31; y += 4) c.set(25 + (y < 26 ? sh : 0), y + b, y === 23 ? mix(BL.h2, P.moss1, 0.4) : BL.h2);
    burnHole(19 + sh, 21 + b);
    burnHole(28, 29 + b);
  } else {
    c.vline(24 + sh, 16 + b, 9, COAT_B.c1); // the back seam, split
    c.vline(24, 27 + b, 7, CHAR.c1);
    burnHole(20 + sh, 19 + b);
    burnHole(27, 25 + b);
  }
  for (let x = 16; x <= 32; x++) c.set(x + sh, 26 + b, x % 2 ? EN.rope : WOOD.c3); // a rope belt
  if (!back && !side) {
    // the keeper's lantern, still lit, swinging from the belt
    const lx0 = 18 + sh;
    c.set(lx0 + 1, 27 + b, IRON.c1);
    c.rect(lx0, 28 + b, 3, 4, IRON.c0);
    c.set(lx0 + 1, 29 + b, P.flame2);
    c.set(lx0 + 1, 30 + b, P.flame1);
    c.hline(lx0, 28 + b, 3, IRON.c2);
  }
  // straw bursting from the collar
  strawTuft(c, 18 + sh, 15 + b, -1, -1);
  strawTuft(c, 30 + sh, 15 + b, 1, -1);
  // arms: out stiff along the bar asleep; long and loose-jointed awake
  if (w < 0.5) {
    for (const [x0, x1, lit] of [[7, 16, true], [32, 41, false]] as const) {
      c.rect(x0, 17 + b, x1 - x0 + 1, 4, lit ? COAT_B.c2 : COAT_B.c1);
      c.hline(x0, 17 + b, x1 - x0 + 1, lit ? COAT_B.c3 : COAT_B.c2);
      c.hline(x0, 20 + b, x1 - x0 + 1, COAT_B.c0);
      c.vline(lit ? x0 : x1, 17 + b, 4, CHAR.c1);
    }
    strawTuft(c, 6, 19 + b, -1, 0);
    strawTuft(c, 42, 19 + b, 1, 0);
  } else {
    if (!side) {
      const off: [number, number] = o.crow > 0 ? [13 + sh - Math.round(o.crow * 2), 10 + b - Math.round(o.crow * 6)] : [14 + sh, 29 + b];
      sleeve(17 + sh, 17 + b, off[0], off[1], false);
      strawTuft(c, off[0], off[1] + 1, o.crow > 0 ? -1 : 0, o.crow > 0 ? -1 : 1);
    }
    sleeve(31 + sh, 17 + b, ax, ay, back);
    strawTuft(c, ax, ay + 1, 0, 1);
  }
  // crows riding its shoulders (one takes off when it throws)
  perchedCrow(c, 15 + sh, 13 + b, true);
  if (o.crow < 0.5) perchedCrow(c, 30 + sh, 13 + b, false);
  // the head: a burnt sack with a candle inside, light through the eye-holes and the grin
  const hx = 24 + lx + (o.flinch ? -2 : 0) + (w < 0.5 ? 2 : 0);
  const hy = 10 + b + o.hunch + ly;
  sackHead(c, hx, hy, 5.6, SACK_B, back);
  c.hline(hx - 3, hy + 6, 7, EN.rope); // tied at the neck
  if (!back) {
    const f = hx + (dir === 'E' ? 2 : dir === 'SE' ? 1 : 0);
    const awake = w > 0.5;
    const lit = awake ? (o.flinch ? P.wax2 : P.flame2) : mix(P.flame1, P.ink, 0.4);
    const glow = awake ? mix(SACK_B.c2, P.flame1, 0.45) : SACK_B.c1;
    for (const dx of side ? [1] : [-2, 2]) {
      // a ragged hole, the flame's light bleeding into the burlap round it
      c.rect(f + dx - 1, hy - 2, 2, 2, lit);
      c.set(f + dx - 1, hy - 2, awake ? P.wax2 : lit);
      c.set(f + dx, hy - 1, P.flame1);
      c.set(f + dx - 2, hy - 1, glow);
      c.set(f + dx + 1, hy - 2, glow);
      c.set(f + dx - 1, hy - 3, SACK_B.c0); // a scorched brow
      c.set(f + dx, hy - 3, SACK_B.c0);
    }
    for (let x = -3; x <= 3; x++) {
      const y = hy + 2 + (Math.abs(x) === 3 ? -1 : 0) + (x % 2 ? 1 : 0);
      c.set(f + x, y, x % 2 ? lit : P.ink); // a jagged grin, lit from inside
      if (x % 2 && awake) c.set(f + x, y - 1, P.flame1);
    }
  }
  // the hat: a tall crooked crown gone black, a wide brim burnt through, a dull buckle, a coal in its band
  const ty = hy - 4;
  c.ellipse(hx, ty, 9, 2, CHAR.c1);
  c.ellipse(hx - 1, ty - 0.4, 7.5, 1.3, CHAR.c2, (_x, y) => y < ty);
  c.hline(hx - 8, ty + 1, 17, CHAR.c0);
  for (let k = 0; k < 7; k++) {
    const y = ty - 1 - k;
    const half = 4.5 - k * 0.35;
    const bend = k > 4 ? k - 4 : 0; // the tip folds over
    for (let x = Math.round(hx - half) + bend; x <= Math.round(hx + half) + bend; x++) {
      const t = (x - (hx - half) - bend) / (half * 2);
      c.set(x, y, t < 0.25 ? CHAR.c3 : t < 0.7 ? CHAR.c2 : CHAR.c1);
    }
  }
  c.hline(hx - 4, ty - 2, 9, mix(P.wood1, P.ink, 0.4)); // the band
  c.rect(hx - 1, ty - 3, 2, 2, mix(BL.h1, P.stone2, 0.5)); // the buckle
  c.set(hx + 3, ty - 2, P.ember);
  c.set(hx + 6, ty, null); // holes in the brim
  c.set(hx - 6, ty + 1, null);
  c.set(hx + 7, ty, P.ember);
  // smoke curling off the fold
  c.set(hx + 6, ty - 7, withAlpha(P.stone3, 170));
  c.set(hx + 7, ty - 8, withAlpha(P.stone3, 110));
}
function swardenDeath(c: Img, f: number) {
  if (f < 2) return drawScarecrowWarden(c, 'S', { bob: 3 + f * 2, hunch: 2 + f, flinch: true });
  // it collapses into a smoking heap of coat and straw; the head rolls clear, its candle guttering
  c.ellipse(24, 41, 14, 3.5, mix(COAT_B.c1, CHAR.c1, 0.4));
  c.ellipse(22, 40, 9, 2.2, COAT_B.c2);
  for (let i = 0; i < 13; i++) c.set(11 + i * 2, 41 + (i % 2) - (i % 3 === 0 ? 1 : 0), i % 3 ? STRAW.c1 : CHAR.c3);
  c.set(18, 41, P.ember);
  c.set(27, 42, P.ember);
  sackHead(c, 36, 39, 4, SACK_B, false);
  if (f < 4) {
    c.set(35, 38, P.flame2); // the candle in its head, guttering
    c.set(37, 38, P.flame1);
  }
  c.ellipse(10, 39, 6, 1.5, CHAR.c1); // the hat
  c.rect(7, 35, 6, 4, CHAR.c2);
  c.vline(7, 35, 4, CHAR.c3);
  if (f < 4) c.set(12, 33, withAlpha(P.stone3, 150));
  perchedCrow(c, 20, 37, false); // one crow stays with it
}

// --- The Hive Queen (64 cell): the orchard's queen, grown into her own great skep. A pale gold woman to the
// waist, a bodice of comb, amber eyes, a crown of lit beeswax tapers, gauze wings; below the waist the straw
// hive she has become, bees pouring from its door. A sceptre of comb in her hand.
type QueenPose = BodyPose & { rise?: number; arm?: number; reach?: number; spread?: number; mouth?: number; sink?: number; wing?: number };
const QUEEN_HAND: Record<Dir5, [number, number]> = { S: [47, 30], SE: [46, 29], E: [42, 29], NE: [45, 27], N: [45, 27] };
function queenHand(dir: Dir5, p: QueenPose): [number, number] {
  const [hx, hy] = QUEEN_HAND[dir];
  const [fx, fy] = FACE_VEC[dir];
  const { lx, ly } = leanOffsets(dir, p.lean ?? 0);
  const up = Math.max(p.arm ?? 0, p.spread ?? 0);
  const reach = p.reach ?? 0;
  const y = hy + (p.bob ?? 0) + (p.rise ?? 0) + (p.sink ?? 0) + ly + reach * 5 * fy - up * 12;
  return [Math.round(hx + lx + reach * 8 * fx - up * 3 * fx + (p.spread ?? 0) * 4), Math.round(Math.min(56, y))];
}
function drawQueen(c: Img, dir: Dir5, pose: QueenPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, rise: 0, arm: 0, reach: 0, spread: 0, mouth: 0, sink: 0, wing: 0, ...pose };
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const side = dir === 'E';
  const SKIN_Q: Ramp = { c0: mix(P.honey, P.wood1, 0.45), c1: mix(P.wax1, P.honey, 0.45), c2: mix(P.wax2, P.honey, 0.3), c3: P.wax2 };
  const HAIR: Ramp = { c0: mix(P.honey, P.wood1, 0.5), c1: mix(P.honey, P.ember, 0.2), c2: P.honey, c3: mix(P.flame2, P.wax2, 0.3) };
  const wb = o.bob + o.rise + o.sink;
  // her wings, behind everything: two pairs of gauze shimmering pale gold and violet, veined with honey
  const wy = 18 + o.bob + o.rise + o.sink + ly;
  const flap = o.wing ? 2 : 0;
  if (o.sink < 14)
    for (const s of [-1, 1]) {
      const wing = (cx: number, cy: number, rx: number, ry: number, clip: number) => {
        for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
          for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
            const dx = (x + 0.5 - cx) / rx;
            const dy = (y + 0.5 - cy) / ry;
            const d = dx * dx + dy * dy;
            if (d > 1 || y > clip) continue;
            const edge = d > 0.7;
            const tint = mix(P.wax2, P.violet3, 0.25 + 0.3 * ((x + y) % 5 === 0 ? 1 : 0) * (1 - d));
            c.set(x, y, withAlpha(edge ? P.wax2 : tint, edge ? 200 : 120));
          }
      };
      wing(32 + s * 13 + sh, wy - flap, 9.5, 5, wy + 3);
      wing(32 + s * 11 + sh, wy + 7 - flap, 7, 3.2, 99);
      line(c, 32 + s * 4 + sh, wy + 2, 32 + s * 20 + sh, wy - 4 - flap, withAlpha(P.honey, 220)); // veins
      line(c, 32 + s * 10 + sh, wy, 32 + s * 15 + sh, wy + 3 - flap, withAlpha(P.honey, 170));
      line(c, 32 + s * 5 + sh, wy + 5, 32 + s * 16 + sh, wy + 8 - flap, withAlpha(P.honey, 170));
    }
  // the skep she has become: a great bell of coiled straw, each coil round and bound, lit from the left
  const base = 57;
  const sk = 24;
  const top = 30 + o.bob;
  for (let y = top; y <= base; y++) {
    const k = (y - top) / (base - top);
    const half = Math.round(10 + (sk - 10) * Math.sqrt(k));
    const band = (y - top) % 3;
    for (let x = -half; x <= half; x++) {
      const nx = x / half;
      let l = -nx * 0.95 + (band === 0 ? 0.3 : band === 2 ? -0.4 : 0) - k * 0.1;
      if (band === 1 && (x + Math.floor((y - top) / 3) * 5) % 11 === 0) l -= 0.35; // the bramble bindings
      c.set(32 + x, y, l > 0.45 ? STRAW.c3 : l > 0 ? STRAW.c2 : l > -0.55 ? STRAW.c1 : STRAW.c0);
    }
  }
  if (!back) {
    // the door: a dark arch with a warm glow deep inside, its sill worn gold, bees crawling out over the straw
    c.ellipse(32, base - 3, 5, 4.5, P.ink, (_x, y) => y <= base);
    c.ellipse(32, base - 1, 3, 1.6, mix(P.ink, BL.h1, 0.4), (_x, y) => y <= base);
    c.hline(31, base, 3, mix(P.ink, BL.h2, 0.55));
    c.hline(27, base, 11, BL.h1);
    for (const [x, y] of [[25, 53], [39, 52], [36, 49], [26, 49], [42, 55], [21, 56], [30, 47]]) crawlingBee(c, x, y, x > 32);
    // honey running from the rim of the door
    c.vline(27, base - 5, 3, BL.h2);
    c.set(27, base - 2, BL.h1);
  }
  // honey welling round its foot
  c.ellipse(32, base + 1, 15, 2.2, BL.h1);
  c.ellipse(29, base + 0.6, 9, 1.2, BL.h2);
  c.hline(22, base + 1, 4, BL.h3);
  // comb bulging from a split in the straw, its cells full and dripping
  const kx = 40;
  const ky = top + 11;
  c.ellipse(kx + 2, ky + 4, 3.5, 5, mix(P.wax1, BL.h2, 0.35));
  c.ellipse(kx + 1, ky + 3, 2, 3, mix(P.wax1, BL.h3, 0.3));
  for (let y = 0; y < 9; y++) for (let x = 0; x < 6; x++) if (c.alpha(kx + x, ky + y) && (x + (y % 2)) % 2 === 0 && y % 2 === 0) c.set(kx - 1 + x, ky + y, BL.h1);
  c.vline(kx + 1, ky + 9, 3, BL.h2);
  c.set(kx + 1, ky + 12, BL.h1);
  c.set(kx - 1, ky + 1, P.wax2);
  // her body to the waist, rising out of the hive
  if (o.sink < 14) {
    for (let y = 19; y <= 32; y++) {
      if (y + wb > top + 1) continue; // below the rim of the hive
      const half = y === 19 ? 3.6 : y < 22 ? 5 : y < 26 ? 5 - (y - 22) * 0.25 : 4 + Math.floor((y - 26) / 3);
      const x0 = Math.round(32 - half + sh);
      const x1 = Math.round(32 + half + sh);
      for (let x = x0; x <= x1; x++) {
        const t = (x - x0) / Math.max(1, x1 - x0);
        if (back) {
          c.set(x, y + wb, shadeT(t, HAIR)); // her hair falls down her back
          continue;
        }
        if (y < 23) {
          c.set(x, y + wb, shadeT(t, SKIN_Q)); // bare shoulders and collarbone
          continue;
        }
        // a bodice of comb: golden cells with dark rims, a pale wax lacing down the middle
        const cell = (x + (Math.floor((y - 23) / 2) % 2 ? 1 : 0)) % 2 === 0 && (y - 23) % 2 === 0;
        const col = cell ? mix(shadeT(t, HONEY), P.ink, 0.25) : shadeT(t, HONEY);
        c.set(x, y + wb, col);
      }
    }
    if (!back) {
      c.hline(Math.round(28 + sh), 22 + wb, 9, mix(BL.h1, P.wood1, 0.3)); // the bodice's neckline
      c.set(Math.round(29 + sh), 21 + wb, SKIN_Q.c3);
      c.vline(Math.round(32 + sh), 23 + wb, Math.max(0, Math.min(7, top - 24 - wb)), P.wax2); // lacing
    }
    // arms: long and pale, shaded; the right holds the sceptre, the left beckons (or both spread wide)
    const shoulderY = 21 + wb;
    const arm = (sx: number, hx: number, hy: number, far: boolean) => {
      for (let t = -1; t <= 0; t++) line(c, sx + t, shoulderY, hx + t, hy - 1, far ? (t ? SKIN_Q.c0 : SKIN_Q.c1) : t ? SKIN_Q.c2 : SKIN_Q.c1);
      c.set(sx - 1, shoulderY - 1, far ? SKIN_Q.c1 : SKIN_Q.c3); // the round of the shoulder
      c.hline(hx - 1, hy - 2, 2, BL.h2); // a bracelet of comb
      c.rect(hx - 1, hy - 1, 2, 2, far ? SKIN_Q.c2 : SKIN_Q.c3);
    };
    const [rx, ry] = queenHand(dir, o);
    arm(Math.round(38 + sh), rx, ry, back);
    const lh: [number, number] = o.spread > 0 ? [18 + sh - Math.round(o.spread * 4), shoulderY - Math.round(o.spread * 10)] : [23 + sh, shoulderY + 9];
    if (!side) arm(Math.round(27 + sh), lh[0], lh[1], false);
    // the head: long golden hair, a calm face like a mask, amber eyes, the crown
    const hx = 32 + lx + (o.flinch ? -2 : 0);
    const hy = 13 + wb + o.hunch + ly;
    for (const s of [-1, 1]) {
      // hair falling past her shoulders in two heavy locks
      for (let y = hy - 2; y < hy + 13; y++) {
        const x = hx + s * (4 + Math.floor((y - hy) / 5));
        c.set(x, y, s < 0 ? HAIR.c2 : HAIR.c1);
        c.set(x + s, y, y % 3 ? HAIR.c1 : HAIR.c0);
        if (y % 4 === 0) c.set(x, y, HAIR.c3);
      }
    }
    c.rect(hx - 1, hy + 4, 3, 4, SKIN_Q.c1); // her neck
    c.vline(hx - 1, hy + 5, 3, SKIN_Q.c2);
    if (back) {
      litBall(c, hx, hy + 0.5, 4.6, 5.4, HAIR);
      for (let y = hy - 3; y < hy + 5; y += 2) c.hline(hx - 2, y, 4, HAIR.c3);
    } else {
      litBall(c, hx, hy + 1, 4.2, 5.2, SKIN_Q);
      // her hair, parted and swept back from the brow
      c.ellipse(hx, hy - 2.5, 4.6, 2.4, HAIR.c2, (_x, y) => y < hy - 1);
      c.hline(hx - 3, hy - 3, 2, HAIR.c3);
      c.set(hx, hy - 3, HAIR.c0); // the parting
      const f = faceX(dir, hx);
      const eye = o.flinch ? P.wax2 : P.flame2;
      // almond eyes of amber, lit from inside, under dark brows
      for (const ex of side ? [f] : [f - 2, f + 1]) {
        c.hline(ex, hy - 1, 2, SKIN_Q.c0);
        c.set(ex, hy, eye);
        c.set(ex + 1, hy, P.honey);
      }
      c.set(f, hy + 2, SKIN_Q.c1); // the nose's shadow
      if (o.mouth > 0) {
        c.rect(f - 1, hy + 3, 2, 2, P.ink);
        c.set(f - 1, hy + 3, mix(P.blood1, P.ink, 0.3));
      } else c.hline(f - 1, hy + 3, 2, mix(P.blood2, SKIN_Q.c1, 0.55)); // pale lips
      c.set(hx - 3, hy + 1, mix(SKIN_Q.c2, P.blossom, 0.35)); // a flush on the cheek
    }
    // the crown: a ring of comb, five lit beeswax tapers
    c.hline(hx - 4, hy - 4, 9, BL.h2);
    c.hline(hx - 4, hy - 5, 9, BL.h3);
    for (let x = -4; x <= 4; x += 2) c.set(hx + x, hy - 4, BL.h1);
    for (const [dx, h] of [[-4, 2], [-2, 3], [0, 5], [2, 3], [4, 2]]) {
      c.vline(hx + dx, hy - 5 - h, h, dx ? mix(P.wax2, P.honey, 0.3) : P.wax2);
      c.set(hx + dx, hy - 6 - h, P.flame2);
      if (h > 2) c.set(hx + dx, hy - 7 - h, P.flame1);
    }
  } else {
    // sunk into her hive: only the crown's flames show over its rim
    for (const dx of [-4, -2, 0, 2, 4]) c.set(32 + dx, top - 1, dx ? P.flame1 : P.flame2);
  }
}
function queenDeath(c: Img, f: number) {
  drawQueen(c, 'S', { sink: f * 4, flinch: true });
}

// --- The Swarm Queen (64 cell): what's left when her hive breaks: her shape held in the air by the whole swarm,
// her crown floating where her head was, her eyes two points of amber.
type SwarmQPose = BodyPose & { spread?: number; stretch?: number; scatter?: number; seed?: number; coalesce?: number };
function drawQueenSwarm(c: Img, dir: Dir5, pose: SwarmQPose) {
  const o = { bob: 0, lean: 0, hunch: 0, flinch: false, spread: 0, stretch: 0, scatter: 0, seed: 0, coalesce: 1, ...pose };
  const [fx, fy] = FACE_VEC[dir];
  const back = dir === 'N' || dir === 'NE';
  const cx = 32 + Math.round(fx * o.stretch * 6);
  const cy = 30 + o.bob + Math.round(fy * o.stretch * 3);
  const loose = o.scatter * 1.2 + (1 - o.coalesce) * 1.5; // how far the shape has come apart
  // her shape, as a field: a head, shoulders, a gown belling out and trailing to the ground, two arms
  const blobs: [number, number, number, number][] = [
    [cx, cy - 16, 4.2, 5],
    [cx, cy - 6, 7.5, 5],
    [cx, cy + 3, 8.5, 7],
    [cx + fx * 2, cy + 13, 10.5, 8],
    [cx + fx * 3, cy + 23, 7, 4],
  ];
  const armA = o.spread > 0 ? -0.9 - o.spread * 0.5 : 0.5;
  for (const s of [-1, 1]) {
    const ax = cx + s * (11 + o.spread * 7) + fx * o.stretch * 8;
    const ay = cy - 6 + Math.round(armA * 7) + fy * o.stretch * 4;
    const n = 5;
    for (let i = 1; i <= n; i++) blobs.push([cx + s * 5 + ((ax - cx - s * 5) * i) / n, cy - 9 + ((ay - cy + 9) * i) / n, 2.2 + (i === n ? 1 : 0), 2]);
  }
  const field = (x: number, y: number) => {
    let v = -9;
    for (const [bx, by, rx, ry] of blobs) {
      const dx = (x - bx) / rx;
      const dy = (y - by) / ry;
      v = Math.max(v, 1 - (dx * dx + dy * dy));
    }
    return v;
  };
  const noise = (x: number, y: number) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + o.seed * 37.719) * 43758.5453;
    return h - Math.floor(h);
  };
  for (let y = 1; y < 63; y++)
    for (let x = 1; x < 63; x++) {
      const v = field(x, y);
      const edge = 0.28 * (1 + loose);
      if (v <= 0) {
        // stray bees flying off the edge of her
        if (v > -0.6 - loose && noise(x, y) < 0.04 + loose * 0.05) c.set(x, y, noise(y, x) < 0.5 ? P.honey : P.ink);
        continue;
      }
      if (v < edge && noise(x, y) > (v / edge) * 0.9) continue; // a crawling, broken edge
      if (o.coalesce < 1 && noise(x, y) > o.coalesce + 0.15) continue;
      // lit from the upper left: gold bees on the lit rim, dark bodies deeper in, a violet sheen of wings
      const lit = field(x - 2, y - 1) < v * 0.6;
      const n = noise(x, y);
      let col: RGBA;
      if (lit) col = n < 0.45 ? P.flame2 : n < 0.8 ? P.honey : P.ink;
      else if (v < 0.35) col = n < 0.2 ? P.honey : n < 0.35 ? mix(P.honey, P.ink, 0.5) : n < 0.5 ? mix(P.violet1, P.dark1, 0.4) : P.ink;
      else col = n < 0.06 ? P.honey : n < 0.16 ? mix(P.violet1, P.dark1, 0.5) : n < 0.6 ? P.dark1 : P.ink;
      c.set(x, y, col);
    }
  // her heart: a lump of glowing comb in her breast, seen through the bees
  if (o.coalesce > 0.5 && !back) {
    const hx = cx - 1;
    const hy = cy - 3;
    c.ellipse(hx + 0.5, hy + 0.5, 2.2, 2.6, mix(BL.h1, P.ink, 0.25));
    c.rect(hx, hy, 2, 2, o.flinch ? P.wax2 : P.flame2);
    c.set(hx, hy, P.wax2);
    for (const [dx, dy] of [[-2, 0], [3, 1], [0, -2], [1, 3]]) c.set(hx + dx, hy + dy, mix(P.flame1, P.ink, 0.3));
  }
  // streams of bees falling from her head like hair
  for (const s of [-1, 1])
    for (let k = 0; k < 7; k++) {
      const x = Math.round(cx + s * (4 + k * 0.45));
      const y = cy - 17 + k * 2;
      if (noise(x, y + k) < 0.75) c.set(x, y, k % 2 ? P.honey : P.ink);
    }
  // her crown, floating where her head was, and her eyes
  const hy = cy - 17;
  c.hline(cx - 4, hy - 4, 9, BL.h2);
  c.hline(cx - 4, hy - 5, 9, BL.h3);
  for (const [dx, h] of [[-4, 2], [-2, 3], [0, 5], [2, 3], [4, 2]]) {
    c.vline(cx + dx, hy - 5 - h, h, mix(P.wax2, P.honey, 0.3));
    c.set(cx + dx, hy - 6 - h, P.flame2);
  }
  if (!back && o.coalesce > 0.5) {
    const f = cx + (dir === 'E' ? 2 : dir === 'SE' ? 1 : 0);
    const eye = o.flinch ? P.wax2 : P.flame2;
    for (const ex of dir === 'E' ? [f] : [f - 2, f + 2]) {
      c.set(ex, hy + 1, eye);
      c.set(ex, hy + 2, mix(P.flame1, P.ink, 0.4)); // the glow running down like tears
    }
  }
}
function queenSwarmDeath(c: Img, f: number) {
  // the swarm lets go: bees scatter, the crown drops to the ground
  if (f < 3) drawQueenSwarm(c, 'S', { scatter: 0.5 + f * 0.7, coalesce: 1 - f * 0.3, seed: f, flinch: true });
  const y = f < 3 ? 13 + f * 12 : 52;
  c.hline(28, y, 9, BL.h2);
  for (const dx of [-3, 0, 3]) c.vline(32 + dx, y - 3, 3, mix(P.wax2, P.honey, 0.3));
  if (f < 4) c.set(32, y - 4, P.flame2);
}

// --- Honey Slime: a crawler of honey instead of wax, drowned bees hanging in it, a scrap of comb on its back.
function drawHoneySlime(c: Img, _dir: Dir5, pose: BodyPose & { sunk?: number }) {
  const o = { bob: 0, lean: 0, flinch: false, sunk: 0, ...pose };
  const sq = o.bob * 0.7; // squash: wider and lower as it gathers itself
  const w = 9.5 + sq;
  const h = 6.5 - sq * 0.6;
  const cx = 16 + o.lean;
  const base = 27;
  const cy = base - h;
  const r = rng(91);
  // the body, shaded per pixel: lit from the upper left, dark amber underneath, light glowing through the far side
  for (let y = Math.floor(cy - h); y <= base; y++)
    for (let x = Math.floor(cx - w - 1); x <= cx + w + 1; x++) {
      const nx = (x + 0.5 - cx) / w;
      const ny = (y + 0.5 - (cy + h * 0.25)) / h;
      if (nx * nx + ny * ny > 1 && !(y === base && Math.abs(nx) < 1.12)) continue; // a foot of honey spreading at the floor
      const lit = -0.55 * nx - 0.75 * ny;
      const rim = nx > 0.55 && ny < 0.4 && ny > -0.5;
      let col = lit > 0.55 ? BL.h3 : lit > -0.05 ? BL.h2 : lit > -0.6 ? BL.h1 : BL.h0;
      if (rim) col = mix(col, BL.h3, 0.45);
      if (y === base) col = Math.abs(nx) > 0.9 ? BL.h1 : BL.h0; // where it meets the floor
      c.set(x, y, col);
    }
  // drowned bees hanging inside
  for (const [dx, dy] of [[-5, 2.5], [4, 3.5], [1, 5]]) {
    const x = Math.round(cx + dx);
    const y = Math.round(cy + dy);
    if (!c.alpha(x, y) || !c.alpha(x + 1, y)) continue;
    c.set(x, y, mix(P.ink, BL.h0, 0.35));
    c.set(x + 1, y, mix(P.flame2, BL.h1, 0.4));
    if (r() < 0.5) c.set(x, y - 1, mix(P.wax2, BL.h2, 0.5));
  }
  // a scrap of comb riding on its back
  const kx = Math.round(cx + 2);
  const ky = Math.round(cy - h * 0.8);
  c.rect(kx - 1, ky, 5, 3, P.wax1);
  c.hline(kx - 1, ky, 5, P.wax2);
  for (const [x, y] of [[0, 1], [2, 1], [1, 2], [3, 2]]) c.set(kx + x, ky + y, BL.h1);
  c.set(kx + 3, ky + 3, BL.h2); // honey running from it
  // the gloss: a long highlight and a white spark
  c.hline(Math.round(cx - w * 0.6), Math.round(cy - h * 0.35), 3, BL.h3);
  c.hline(Math.round(cx - w * 0.5), Math.round(cy - h * 0.55), 2, P.wax2);
  c.set(Math.round(cx - w * 0.65), Math.round(cy - h * 0.2), P.white);
  // two hollow sockets and a sagging mouth
  const eye = o.flinch ? P.flame2 : P.ink;
  for (const ex of [cx - 3, cx + 1]) {
    c.set(Math.round(ex), Math.round(cy + 0.5), BL.h0);
    c.set(Math.round(ex), Math.round(cy + 1.5), eye);
  }
  c.hline(Math.round(cx - 2), Math.round(cy + 3.5), 3, BL.h0);
  const sunk = o.sunk;
  if (sunk > 0) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (y < base - 1 - (8 - sunk) && c.alpha(x, y)) c.set(x, y, null); // still mostly under the honey
}
function honeySlimeDeath(c: Img, f: number) {
  if (f < 2) return drawHoneySlime(c, 'S', { bob: 3 + f * 2, flinch: true });
  // it runs flat into a spreading pool; the comb and a bee or two are left on the top
  c.ellipse(16, 26, 9 + f, 2.6, BL.h1);
  c.ellipse(15, 25.6, 6 + f * 0.5, 1.6, BL.h2);
  c.hline(11, 25, 3, BL.h3);
  c.rect(18, 24, 3, 2, P.wax1);
  c.set(19, 25, BL.h1);
  if (f < 4) {
    c.set(12, 26, P.ink);
    c.set(13, 26, P.flame2);
  }
}

function genBloomCreatures() {
  const P7 = phased7();
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  const frames = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));
  const withHand = <T,>(draw: (c: Img, d: Dir5, p: T) => void, hand: (d: Dir5, p: T) => [number, number]) => (name: string, poses: T[], timing: { ticks: number; phase?: string; events?: string[] }[], loop: boolean) => ({
    name,
    frames: poses.map(p => (c: Img, d: Dir5) => draw(c, d, p)),
    timing,
    loop,
    hand: (d: Dir5, f: number) => hand(d, poses[f]),
  });

  // ---- weapons and shots
  // the smoker: a tin fire-can with a spout and a leather bellows (the player's and the husks')
  const smoker = new Img(20, 12);
  smoker.rect(1, 5, 5, 3, WOOD.c2); // bellows boards
  smoker.hline(1, 5, 5, WOOD.c3);
  smoker.rect(2, 8, 4, 2, mix(P.wood1, P.dark2, 0.3)); // leather
  smoker.rect(6, 3, 8, 7, IRON.c1); // the can
  smoker.vline(6, 3, 7, IRON.c3);
  smoker.vline(13, 3, 7, IRON.c0);
  smoker.hline(7, 6, 6, IRON.c0);
  for (let x = 14; x < 19; x++) smoker.vline(x, 3 + Math.floor((x - 14) / 2), 3 - Math.floor((x - 14) / 3), IRON.c2); // the spout
  smoker.set(18, 4, P.ember);
  smoker.set(9, 8, P.ember); // coals glowing through a vent
  smoker.outline(P.ink);
  sheet('smoker', smoker, { cell: [20, 12], pivot: [3, 7], layer: 'weapon', points: { tip: [18, 4] } });
  // the guards' scythe
  const scythe = new Img(34, 16);
  line(scythe, 1, 12, 24, 8, WOOD.c2);
  line(scythe, 1, 13, 24, 9, WOOD.c1);
  for (let i = 0; i < 12; i++) {
    const x = 24 + i * 0.7;
    const y = 8 - Math.sqrt(i) * 2.4 + i * 0.35;
    scythe.set(Math.round(x), Math.round(y), i < 10 ? P.steel1 : P.steel2);
    scythe.set(Math.round(x) - 1, Math.round(y) + 1, i % 3 ? IRON.c1 : P.steel2);
  }
  line(scythe, 24, 8, 31, 2, P.steel2);
  scythe.set(12, 10, WOOD.c3); // the grip
  scythe.outline(P.ink);
  sheet('scythe', scythe, { cell: [34, 16], pivot: [3, 12], layer: 'weapon', points: { tip: [31, 2] } });
  // the Warden's great scythe: a long charred snath, a wide blade still hot at its edge
  const gs = new Img(52, 22);
  line(gs, 1, 18, 38, 12, CHAR.c2);
  line(gs, 1, 19, 38, 13, CHAR.c1);
  for (let i = 0; i < 16; i++) {
    const x = 38 + i * 0.75;
    const y = 12 - Math.sqrt(i) * 3.2 + i * 0.4;
    gs.vline(Math.round(x), Math.round(y), 3, i < 13 ? IRON.c1 : IRON.c2);
    gs.set(Math.round(x), Math.round(y), i % 4 ? P.steel2 : P.ember);
  }
  line(gs, 38, 12, 49, 2, P.steel2);
  gs.outline(P.ink);
  sheet('warden_scythe', gs, { cell: [52, 22], pivot: [3, 18], layer: 'weapon', points: { tip: [49, 2] } });
  // the Queen's sceptre: a rod of dark wax crowned with a gilded comb
  const sc = new Img(30, 12);
  line(sc, 1, 7, 20, 5, mix(P.wood1, P.honey, 0.35));
  line(sc, 1, 8, 20, 6, P.wood1);
  for (let y = 0; y < 8; y++) sc.hline(21, 2 + y, 7 - Math.abs(y - 4) / 1.5, y % 2 ? BL.h2 : BL.h3);
  sc.set(24, 5, BL.h0);
  sc.set(26, 4, BL.h0);
  sc.outline(P.ink);
  sheet('comb_sceptre', sc, { cell: [30, 12], pivot: [3, 7], layer: 'weapon', points: { tip: [28, 6] } });
  // royal jelly (a lobbed glob), a bee (a stinging dart), a crow (the Warden's messenger)
  const jelly = new Img(9, 9);
  jelly.disc(4.5, 5, 3.4, BL.h1);
  jelly.disc(4, 4.5, 2.2, BL.h2);
  jelly.set(3, 3, P.wax2);
  jelly.outline(P.ink);
  sheet('royal_jelly', jelly, { cell: [9, 9], pivot: [4, 4], layer: 'fx' });
  const bee = new Img(7, 5);
  bee.rect(1, 2, 4, 2, P.flame2);
  bee.set(2, 2, P.ink);
  bee.set(4, 2, P.ink);
  bee.set(5, 3, P.ink); // the sting
  bee.set(2, 1, withAlpha(P.wax2, 200));
  bee.set(3, 1, withAlpha(P.wax2, 200));
  sheet('bee_dart', bee, { cell: [7, 5], pivot: [3, 2], layer: 'fx' });
  const crow = new Img(12, 8);
  crow.rect(2, 3, 6, 3, P.ink);
  crow.rect(8, 3, 2, 2, P.ink);
  crow.set(10, 3, P.flame1);
  crow.set(9, 3, P.ember); // an eye
  line(crow, 3, 3, 6, 0, P.dark1); // a wing up
  crow.set(1, 4, P.dark1);
  crow.outline(P.ink);
  sheet('crow_dart', crow, { cell: [12, 8], pivot: [6, 4], layer: 'fx' });

  // ---- Beekeeper Husk
  const husk = withHand(drawHusk, huskHand);
  rosterSheet(
    'husk',
    CELL,
    PIVOT,
    7,
    [
      husk('idle', [{}, { bob: 1 }], idleT, true),
      husk('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0 })), walkT(9), true),
      husk('puff', [{ pump: 0.3 }, { pump: 0.7, lean: -1 }, { pump: 1, lean: -1 }, { pump: 1.2, lean: 2 }, { pump: 1.1, lean: 2 }, { pump: 0.5 }, {}], P7, false),
      husk('bash', [{ bash: 0.5 }, { bash: 1, lean: -1 }, { bash: 1.1, lean: -2 }, { bash: -0.5, lean: 3, pump: 1 }, { bash: -0.6, lean: 3, pump: 1 }, { lean: 1 }, {}], P7, false),
      husk('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => huskDeath(c, f)),
    HUSK_HAND,
  );
  // ---- Orchard Guard
  const guard = withHand(drawGuard, guardHand);
  rosterSheet(
    'orchard_guard',
    CELL,
    PIVOT,
    7,
    [
      guard('dormant', [{ wake: 0 }, { wake: 0, bob: 1 }], [{ ticks: 60 }, { ticks: 60 }], true),
      guard('rise', [{ wake: 0, flinch: true }, { wake: 0.2, bob: 1 }, { wake: 0.6, lean: -1 }, { wake: 1, lean: 1 }, { wake: 1 }], [{ ticks: 8 }, { ticks: 8 }, { ticks: 8 }, { ticks: 8 }, { ticks: 8 }], false),
      guard('idle', [{}, { bob: 1 }], idleT, true),
      guard('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1 })), walkT(10), true),
      guard('reap', [{ reap: 0.5 }, { reap: 1, lean: -1 }, { reap: 1.2, lean: -2 }, { reap: -0.5, lean: 3 }, { reap: -0.6, lean: 3 }, { lean: 1 }, {}], P7, false),
      guard('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => guardDeath(c, f)),
    GUARD_HAND,
  );
  // ---- Honey Slime: a crawler of honey instead of wax, drowned bees suspended in it
  const honeyDraw = drawHoneySlime;
  rosterSheet(
    'honey_slime',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(honeyDraw, [{}, { bob: 1 }]), timing: [{ ticks: 14 }, { ticks: 14 }], loop: true },
      { name: 'walk', frames: walk4(honeyDraw, f => ({ bob: f % 2 ? 2 : 0, lean: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(8), loop: true },
      { name: 'rise', frames: frames(honeyDraw, [{ sunk: 6 }, { sunk: 4, bob: 2 }, { sunk: 2, bob: 3 }, { bob: -2 }, {}]), timing: [{ ticks: 8 }, { ticks: 8 }, { ticks: 8 }, { ticks: 8 }, { ticks: 8 }], loop: false },
      { name: 'engulf', frames: frames(honeyDraw, [{ bob: 2 }, { bob: 3 }, { bob: 4 }, { bob: -3, lean: 2 }, { bob: -2, lean: 2 }, { bob: 1 }, {}]), timing: P7, loop: false },
      { name: 'stagger', frames: frames(honeyDraw, [{ bob: 3, flinch: true }, { bob: 2, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => honeySlimeDeath(c, f)),
    null,
  );
  // ---- the Scarecrow Warden (48)
  const sw = withHand(drawScarecrowWarden, swardenHand);
  rosterSheet(
    'scarecrow_warden',
    48,
    [24, 44],
    7,
    [
      sw('dormant', [{ wake: 0 }, { wake: 0, bob: 1 }], [{ ticks: 60 }, { ticks: 60 }], true),
      sw('rise', [{ wake: 0, flinch: true }, { wake: 0.3, bob: 1 }, { wake: 0.7, lean: -2 }, { wake: 1, lean: 1, crow: 1 }, { wake: 1 }], [{ ticks: 10 }, { ticks: 10 }, { ticks: 10 }, { ticks: 10 }, { ticks: 14 }], false),
      sw('idle', [{}, { bob: 1 }], idleT, true),
      sw('walk', [0, 1, 2, 3].map(f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1 })), walkT(11), true),
      sw('reap', [{ reap: 0.5 }, { reap: 1, lean: -1 }, { reap: 1.2, lean: -2 }, { reap: -0.6, lean: 3 }, { reap: -0.7, lean: 3 }, { lean: 1 }, {}], P7, false),
      sw('spin', [{ reap: 0.8, crouch: 1 }, { reap: 1, crouch: 1 }, { reap: 1.2, crouch: 1, lean: -1 }, { reap: 0.2, lean: 2 }, { reap: -0.4, lean: 2 }, { reap: 0.2 }, {}], P7, false),
      sw('crows', [{ crow: 0.5 }, { crow: 1, lean: -1 }, { crow: 1, lean: -1 }, { crow: 1.2, lean: 2 }, { crow: 1, lean: 1 }, { crow: 0.4 }, {}], P7, false),
      sw('leap', [{ crouch: 1 }, { crouch: 2, reap: 1 }, { bob: -8, reap: 1.2, lean: -2 }, { bob: -4, reap: -0.6, lean: 3 }, { crouch: 1, reap: -0.7 }, { reap: -0.3 }, {}], P7, false),
      sw('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => swardenDeath(c, f)),
    SWARDEN_HAND,
  );
  // ---- the Hive Queen (64)
  const q = withHand(drawQueen, queenHand);
  rosterSheet(
    'hive_queen',
    64,
    [32, 58],
    7,
    [
      q('idle', [{}, { wing: 1 }, { bob: 1 }, { bob: 1, wing: 1 }], [{ ticks: 10 }, { ticks: 10 }, { ticks: 10 }, { ticks: 10 }], true),
      q('walk', [0, 1, 2, 3].map(f => ({ bob: f % 2 ? 1 : 0, wing: f % 2 })), walkT(9), true),
      q('intro', [{ sink: 16 }, { sink: 12, wing: 1 }, { sink: 7 }, { sink: 2, wing: 1 }, { spread: 1 }, { spread: 1, wing: 1 }], [{ ticks: 18 }, { ticks: 18 }, { ticks: 18 }, { ticks: 18 }, { ticks: 20 }, { ticks: 30 }], false),
      q('sweep', [{ arm: 0.5 }, { arm: 1, lean: -1 }, { arm: 1.1, lean: -2, wing: 1 }, { reach: 1, lean: 3 }, { reach: 1, lean: 3, wing: 1 }, { lean: 1 }, {}], P7, false),
      q('thrust', [{ reach: -0.5 }, { reach: -0.8, lean: -1 }, { reach: -1, lean: -2, wing: 1 }, { reach: 1.4, lean: 3 }, { reach: 1.4, lean: 3, wing: 1 }, { reach: 0.4 }, {}], P7, false),
      q('spit', [{ hunch: 1 }, { hunch: -1, mouth: 1, lean: -1 }, { hunch: -2, mouth: 1, lean: -2 }, { mouth: 1, lean: 2 }, { mouth: 1, lean: 1, wing: 1 }, { lean: 1 }, {}], P7, false),
      q('release', [{ spread: 0.4 }, { spread: 0.8, wing: 1 }, { spread: 1 }, { spread: 1.1, wing: 1, bob: -1 }, { spread: 1, wing: 1 }, { spread: 0.5 }, {}], P7, false),
      q('pour', [{ flinch: true }, { sink: 3, flinch: true }, { sink: 6, wing: 1 }, { sink: 9 }, { sink: 12, wing: 1 }, { sink: 15 }], [{ ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 60 }], false),
      q('stagger', [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => queenDeath(c, f)),
    QUEEN_HAND,
  );
  // ---- the Swarm Queen (64): a new pattern of bees in every frame
  const sq = (name: string, poses: SwarmQPose[], timing: { ticks: number }[], loop: boolean) => ({ name, frames: poses.map((p, i) => (c: Img, d: Dir5) => drawQueenSwarm(c, d, { seed: i, ...p })), timing, loop });
  rosterSheet(
    'queen_swarm',
    64,
    [32, 58],
    7,
    [
      sq('idle', [{}, { bob: 1 }, {}, { bob: -1 }], [{ ticks: 6 }, { ticks: 6 }, { ticks: 6 }, { ticks: 6 }], true),
      sq('walk', [{}, { bob: 1 }, {}, { bob: -1 }], [{ ticks: 5 }, { ticks: 5 }, { ticks: 5 }, { ticks: 5 }], true),
      sq('intro', [{ coalesce: 0 }, { coalesce: 0.2 }, { coalesce: 0.45 }, { coalesce: 0.7 }, { coalesce: 0.9, spread: 1 }, { spread: 1 }], [{ ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 20 }, { ticks: 30 }], false),
      sq('dive', [{ stretch: -0.5 }, { stretch: -1 }, { stretch: -1, bob: -2 }, { stretch: 1.5 }, { stretch: 1.6 }, { stretch: 0.5 }, {}], P7, false),
      sq('engulf', [{ spread: 0.5 }, { spread: 1 }, { spread: 1.2, bob: -1 }, { spread: 1.4, scatter: 0.3 }, { spread: 1.4, scatter: 0.4 }, { spread: 0.6 }, {}], P7, false),
      sq('volley', [{ stretch: -0.4 }, { stretch: -0.6, spread: 0.4 }, { stretch: -0.6, spread: 0.6 }, { stretch: 0.8, spread: 0.6 }, { stretch: 0.8, spread: 0.4 }, { stretch: 0.3 }, {}], P7, false),
      sq('stagger', [{ scatter: 0.8, flinch: true }, { scatter: 0.6, flinch: true }, { scatter: 0.2 }], staggerT, false),
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => queenSwarmDeath(c, f)),
    null,
  );
}

// ---- Hild the beekeeper: Maudlin's sister, the last honest chandler, in her veiled hat with her smoker.
function genHild() {
  const honeySkin = mix(P.wax1, P.wood2, 0.3);
  villagerSheet('npc_hild', {
    cloth: SMOCK,
    long: true,
    legs: P.dark2,
    skin: honeySkin,
    head: 'hair',
    headCol: mix(P.stone3, P.wax1, 0.4), // grey-gold hair
    apron: mix(P.honey, P.wood2, 0.35),
    job: (c, f, g) => {
      // the veiled hat, pushed back so the veil hangs behind her
      c.hline(g.cx - 6, g.top + 1, 13, STRAW.c1);
      c.hline(g.cx - 6, g.top + 1, 4, STRAW.c3);
      c.rect(g.cx - 3, g.top - 2, 7, 3, STRAW.c2);
      c.hline(g.cx - 3, g.top - 2, 7, STRAW.c3);
      for (let y = g.top + 2; y < g.body + 2; y++) {
        c.set(g.cx - 5, y, y % 2 ? P.dark1 : P.dark2); // the veil falling behind her shoulders
        c.set(g.cx + 5, y, y % 2 ? P.dark2 : P.dark1);
      }
      if (f.kind === 'work') {
        // working the smoker over a frame of comb
        const r: [number, number] = [g.cx + 7, g.waist - 2 - f.k * 2];
        c.rect(r[0] - 1, r[1] - 3, 3, 4, IRON.c1);
        c.set(r[0] + 1, r[1] - 4, IRON.c2);
        if (f.k) c.set(r[0] + 2, r[1] - 6, withAlpha(P.stone4, 180));
        const l: [number, number] = [g.cx - 6, g.waist];
        c.rect(l[0] - 2, l[1] - 3, 5, 4, WOOD.c2);
        c.hline(l[0] - 1, l[1] - 2, 3, BL.h2);
        return { r, l };
      }
      if (f.pose === 'stand') c.set(g.cx + 6, g.waist + 2, P.flame2); // a bee on her apron
    },
  });
}

function genBloom() {
  genOrchardTiles();
  genBloomDecor();
  genBloomCreatures();
  genHild();
}

genPlayer();
genWeapons();
genMisc();
genEnemies();
genCombatFx();
genArsenal();
genShrine();
genRoster();
genWorldBits();
genTiles();
genRoadTiles();
genRoadDecor();
genHubDecor();
genWorksDecor();
genMireDecor();
genNaveDecor();
genAbbeyDecor();
genChest();
genNpcs();
genCutsceneCast();
genCritters();
genIcons();
genTollwarden();
genWorks();
genMire();
genNave();
genVault();
genVaultTiles();
genBloom();
genFont();
console.log(
  ONLY
    ? `gen-art: wrote ${written} file(s) for ${ONLY.join(', ')}`
    : `gen-art: wrote ${written} file(s), skipped ${skipped} existing${skipped && !FORCE ? ' (use --force to overwrite)' : ''}`,
);
