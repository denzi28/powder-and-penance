// Placeholder art generator. Writes PNG sprite sheets + .anim.json manifests into assets/ following ASSETS.md.
//   npm run gen:art              -> only writes files that don't exist yet (never clobbers your replacement art)
//   npm run gen:art -- --force   -> regenerate everything
//   npm run gen:art -- --only=tiles,player_body   -> regenerate just these sheets
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

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

function drawWicklingDeath(c: Img, f: number) {
  if (f < 2) {
    drawWickling(c, 'S', { bob: f + 1, hunch: f + 2, flame: f, sway: 0, flinch: true });
    return;
  }
  c.ellipse(16, 26, 7 + f, 2.5, P.wood1);
  c.ellipse(16, 25, 3 + f * 0.5, 1.5, P.wax1);
  c.set(15, 24, P.wax2);
  if (f < 4) c.set(17, 23, f === 2 ? P.flame2 : P.flame1);
  else c.set(17, 22, P.dark2);
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
      c.hline(1, 4, 3, P.wood1);
      c.vline(4, 3, 3, P.steel1);
      c.rect(5, 3, 6, 2, P.steel2);
      c.hline(5, 4, 6, P.steel1);
      c.set(11, 3, P.steel2);
    }),
    { cell: [14, 8], pivot: [2, 4], layer: 'weapon', points: { tip: [12, 3] } },
  );

  sheet(
    'greataxe',
    outlined(31, 17, c => {
      c.hline(1, 8, 23, P.wood1); // haft
      c.hline(1, 9, 23, P.wood2);
      c.set(0, 8, P.steel1);
      c.rect(17, 7, 3, 4, P.steel1); // back spike + socket
      for (let y = 2; y <= 15; y++) {
        const bulge = 3 - Math.abs(y - 8.5) / 2.5;
        c.hline(20, y, Math.max(2, Math.round(3 + bulge)), P.steel1);
        c.set(20 + Math.max(2, Math.round(3 + bulge)), y, P.steel2); // edge
      }
      c.set(24, 1, P.steel2);
      c.set(24, 16, P.steel2);
    }),
    { cell: [31, 17], pivot: [5, 8], layer: 'weapon', points: { tip: [27, 8] } },
  );

  sheet(
    'crossbow',
    outlined(21, 15, c => {
      c.rect(1, 6, 12, 3, P.wood1); // stock
      c.hline(1, 6, 12, P.wood2);
      c.vline(14, 1, 13, P.wood2); // prod
      c.set(13, 0, P.wood2);
      c.set(13, 14, P.wood2);
      for (let y = 2; y <= 12; y++) c.set(12 - Math.round(Math.abs(y - 7) * 0.2), y, P.wax1); // string
      c.hline(9, 7, 10, P.steel2); // loaded bolt
      c.set(19, 7, P.steel1);
    }),
    { cell: [21, 15], pivot: [5, 7], layer: 'weapon', points: { muzzle: [19, 7] } },
  );

  sheet(
    'flintlock',
    outlined(20, 10, c => {
      c.rect(6, 2, 12, 2, P.steel1); // long barrel
      c.hline(6, 2, 12, P.steel2);
      c.rect(2, 3, 6, 2, P.wood2); // stock
      c.rect(1, 5, 3, 3, P.wood1); // grip
      c.set(6, 4, P.dark2); // lock
      c.set(5, 1, P.steel1); // cock
      c.set(8, 5, P.dark2); // trigger guard
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
      c.rect(3, 6, 2, 14, P.wood1);
      c.rect(13, 6, 2, 14, P.wood1);
      c.hline(2, 8, 14, P.wood2);
      c.hline(2, 16, 14, P.wood2);
      c.rect(1, 19, 16, 2, P.dark1);
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
    c.rect(5, 38, 14, 4, P.dark1); // base
    c.hline(5, 38, 14, P.stone3);
    c.rect(11, 18, 2, 20, P.steel1); // stem
    c.vline(11, 18, 20, P.stone3);
    c.rect(9, 26, 6, 2, P.steel1); // knob
    c.rect(6, 16, 12, 2, P.steel1); // dish
    c.hline(6, 16, 12, P.steel2);
    c.rect(9, 7, 6, 9, P.wax1); // candle
    c.vline(9, 7, 9, P.wax2);
    c.set(14, 12, P.wax2); // drips
    c.set(8, 15, P.wax1);
    c.set(15, 14, P.wax1);
    c.set(12, 6, P.ink); // wick
    if (f > 0) {
      const sway = f === 2 ? 1 : 0;
      c.ellipse(12 + sway, 3.5, 2, 3 + (f === 3 ? 0.5 : 0), P.flame1);
      c.ellipse(12 + sway, 4, 1, 1.8, P.flame2);
      c.set(12 + sway, 4, P.wax2);
    }
    c.outline(P.ink);
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
  anims: { name: string; frames: ((c: Img, d: Dir5) => void)[]; timing: { ticks: number; phase?: string; events?: string[] }[]; loop: boolean }[],
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
    animations[a.name] = { row: i * 5, dirs: DIR5, loop: a.loop, frames: a.timing };
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
  c.ellipse(16, 25, 9, 3, P.steel1);
  c.ellipse(15, 24.5, 5, 1.5, P.steel2);
  c.rect(8, 24, 5, 3, P.wood2);
  c.rect(20, 23, 3, 3, P.blood1);
  if (f === 4) c.set(22, 22, P.dark2);
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
  c.ellipse(16, 25, 8, 3, P.dark2);
  c.rect(12, 23, 4, 3, P.wax2);
  if (f < 4) c.set(21, 24, P.flame2);
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
  c.ellipse(24, 40, 16, 5, P.wax1);
  c.rect(15, 37, 18, 4, P.wood1);
  c.ellipse(36, 37, 6, 4, P.flame1);
  c.set(40, 37, P.ember);
}

// --- The Tollwarden (48x48): the Abbey's gatekeeper. Tall iron barbute with a coin-slot visor and pale
// candle eyes, a long toll-collector's coat in old red, gilt buttons, a ring of keys at the hip, a halberd.
const TOLL_HAND: Record<Dir5, [number, number]> = { S: [34, 27], SE: [33, 26], E: [30, 26], NE: [32, 24], N: [32, 24] };

function drawTollwarden(c: Img, dir: Dir5, pose: BodyPose & { kneel?: boolean }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, kneel: false, ...pose };
  const b = o.bob;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  // Legs: armoured greaves under the coat (or folded, kneeling)
  if (o.kneel) {
    c.rect(15, 40, 9, 3, P.steel1);
    c.rect(26, 38, 3, 5, P.steel1);
    c.rect(24, 42, 8, 2, P.dark1);
  } else {
    const liftL = o.step === 1 ? 2 : 0;
    const liftR = o.step === 3 ? 2 : 0;
    c.rect(18, 34 + b, 4, 8 - liftL, P.steel1);
    c.rect(17, 42 - liftL, 6, 2, P.dark1);
    c.rect(27, 34 + b, 4, 8 - liftR, P.steel1);
    c.rect(26, 42 - liftR, 6, 2, P.dark1);
  }
  // The long coat: widening from the shoulders to the knees
  for (let y = 17; y <= 38; y++) {
    const half = Math.round(7 + (y - 17) * 0.28);
    c.hline(24 + sh - half, y + b, half * 2, P.blood1);
  }
  c.vline(24 + sh - 7, 17 + b, 20, P.blood2);
  // Breastplate, gilt buttons, belt with the ring of keys
  if (!back) {
    c.rect(19 + sh, 18 + b, 10, 10, P.steel1);
    c.vline(19 + sh, 18 + b, 10, P.steel2);
    for (const y of [20, 23, 26]) c.set(24 + sh + (dir === 'E' ? 2 : 0), y + b, P.flame2);
  }
  c.hline(16 + sh, 28 + b, 16, P.dark2);
  c.disc(17 + sh, 31 + b, 2, P.flame1); // keys
  c.set(16 + sh, 33 + b, P.flame1);
  c.set(18 + sh, 33 + b, P.flame1);
  // Pauldrons
  c.ellipse(15 + sh, 19 + b, 4, 3, P.steel1);
  c.ellipse(33 + sh, 19 + b, 4, 3, P.steel1);
  c.hline(12 + sh, 18 + b, 6, P.steel2);
  // Tall barbute with a coin-slot visor
  const hx = 24 + lx + (o.flinch ? -2 : 0);
  const hy = 4 + b + o.hunch + ly;
  c.rect(hx - 5, hy, 10, 13, P.steel1);
  c.rect(hx - 4, hy - 1, 8, 1, P.steel1);
  c.vline(hx - 5, hy, 13, P.steel2);
  c.hline(hx - 5, hy + 12, 10, P.stone1);
  c.rect(hx - 1, hy - 3, 2, 2, P.flame1); // crest knob
  if (!back) {
    const eye = o.flinch ? P.ember : P.wax2;
    const vx = dir === 'S' ? hx - 4 : dir === 'SE' ? hx - 2 : hx;
    c.hline(vx, hy + 5, dir === 'E' ? 5 : 8, P.ink);
    c.set(vx + 2, hy + 5, eye);
    if (dir !== 'E') c.set(vx + 5, hy + 5, eye);
    c.vline(hx, hy + 7, 4, P.ink); // the coin slot
  }
  // Gauntlet at the weapon hand
  const [ax, ay] = TOLL_HAND[dir];
  c.rect(ax - 2, ay - 2 + b, 4, 4, P.steel2);
}

function tollwardenDeath(c: Img, f: number) {
  // He doesn't fall: he sinks to his knees and stays there, head bowed, for his last words.
  if (f < 2) drawTollwarden(c, 'S', { bob: 1 + f, hunch: 1 + f, lean: -1, flinch: true });
  else drawTollwarden(c, 'S', { bob: 5, hunch: 2 + Math.min(f - 2, 2), kneel: true });
}

function genTollwarden() {
  const P7 = phased7();
  const frames = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  rosterSheet(
    'tollwarden',
    48,
    [24, 44],
    7,
    [
      { name: 'idle', frames: frames(drawTollwarden, [{}, { bob: 1 }]), timing: [{ ticks: 26 }, { ticks: 26 }], loop: true },
      { name: 'walk', frames: walk4(drawTollwarden, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(11), loop: true },
      {
        name: 'sweep',
        frames: frames(drawTollwarden, [{ sway: -2, lean: -1 }, { sway: -2, lean: -2 }, { sway: -2, lean: -2, bob: 1 }, { lean: 3 }, { lean: 3 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'thrust',
        frames: frames(drawTollwarden, [{ lean: -1 }, { lean: -3, hunch: 1 }, { lean: -3, hunch: 1, bob: 1 }, { lean: 4 }, { lean: 4, bob: 1 }, { lean: 2 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'slam',
        frames: frames(drawTollwarden, [
          { lean: -2, bob: -2, hunch: -2 }, { lean: -3, bob: -2, hunch: -2 }, { lean: -3, bob: -2, hunch: -2 },
          { lean: 3, bob: 2, hunch: 2 }, { lean: 3, bob: 3, hunch: 2 }, { lean: 2, bob: 2 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      {
        // The entrance: rears back with the halberd raised, drives it into the stones (the slam lands on the
        // third frame, 20 ticks into each 40-tick cycle), straightens.
        name: 'intro',
        frames: frames(drawTollwarden, [{ lean: -2, bob: -1, hunch: -1 }, { lean: -3, bob: -2, hunch: -2 }, { lean: 3, bob: 2, hunch: 2 }, { lean: 1 }]),
        timing: [{ ticks: 12 }, { ticks: 8 }, { ticks: 4 }, { ticks: 16 }],
        loop: true,
      },
      { name: 'stagger', frames: frames(drawTollwarden, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => tollwardenDeath(c, f)),
    TOLL_HAND,
  );

  // The halberd: long haft, crescent axe, a spike at the tip, a hook behind
  const hal = new Img(46, 13);
  hal.hline(1, 6, 36, P.wood1);
  hal.hline(1, 7, 36, P.wood2);
  for (let y = 1; y <= 11; y++) {
    const w = Math.round(4 - Math.abs(y - 6) * 0.5);
    hal.hline(33, y, w, P.steel2);
  }
  hal.vline(33, 1, 11, P.steel1);
  hal.hline(37, 6, 8, P.steel2);
  hal.set(44, 6, P.steel2);
  hal.rect(29, 4, 2, 2, P.steel1); // back hook
  hal.outline(P.ink);
  sheet('toll_halberd', hal, { cell: [46, 13], pivot: [9, 6], layer: 'weapon', points: { tip: [44, 6] } });

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
  c.rect(8, 23, 16, 4, P.stone1);
  c.rect(10, 23, 8, 3, P.wood2);
  c.rect(22, 22, 4, 4, P.dark2);
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

function drawMother(c: Img, dir: Dir5, pose: BodyPose & { rise?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, ...pose };
  const b = o.bob + o.rise; // rise: sunk into her wax pool (intro), 0 = full height
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  // Her pool of wax, always around her
  c.ellipse(32, 58, 22, 5, P.wax1);
  c.ellipse(26, 57, 8, 2, P.wax2);
  // Body: a great bell of wax under a stained smock
  for (let y = 22; y <= 56; y++) {
    if (y + b > 57) continue;
    const half = Math.round(10 + (y - 22) * 0.38);
    c.hline(32 + sh - half, y + b, half * 2, y > 44 ? P.wax1 : P.stone2);
  }
  c.rect(24 + sh, 30 + b, 16, 12, P.wood2); // smock bib, stained
  c.set(28 + sh, 34 + b, P.blood1);
  c.set(34 + sh, 38 + b, P.blood1);
  // Arms
  c.ellipse(17 + sh + o.sway, 36 + b, 4, 9, P.wax1);
  c.ellipse(47 + sh + o.sway, 36 + b, 4, 9, P.wax1);
  // Head: half melted, the face slid to one side; hair of wicks
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 10 + b + o.hunch + ly;
  c.ellipse(hx, hy + 7, 8, 9, P.wax1);
  c.ellipse(hx + 3, hy + 13, 5, 4, P.wax1); // the slid-down cheek
  if (dir !== 'N' && dir !== 'NE') {
    const fx = dir === 'S' ? hx : dir === 'SE' ? hx + 2 : hx + 4;
    c.set(fx - 3, hy + 6, P.ink);
    c.set(fx + 2, hy + 7, P.ink);
    c.hline(fx - 2, hy + 11, 4, o.flinch ? P.ember : P.dark2); // a humming mouth
  }
  for (const [x, y] of [[-7, 0], [-4, -3], [0, -4], [4, -3], [7, 0], [-12, 8], [12, 8]]) {
    c.vline(hx + x, hy + y, 2, P.dark2);
    c.set(hx + x, hy + y - 1, o.flinch ? P.ember : P.flame2);
  }
  const [ax, ay] = MOTHER_HAND[dir];
  c.rect(ax - 2, ay - 2 + b, 5, 5, P.wax1);
}
function motherDeath(c: Img, f: number) {
  // She sinks back into her wax and the wicks go out one by one.
  const rise = [2, 6, 14, 22, 30][f];
  drawMother(c, 'S', { rise, flinch: f < 2, hunch: f });
}

// --- The Bones of Mother Tallow (64x64): what is left when the wax burns away. A tall, stooped skeleton
// with embers smouldering in the ribs and eye sockets, still holding the ladle.
function drawBones(c: Img, dir: Dir5, pose: BodyPose & { rise?: number; spread?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, spread: 0, ...pose };
  const b = o.bob + o.rise;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const bone = P.wax2;
  const boneDark = P.stone4;
  // Burnt floor and a few embers where she stands
  c.ellipse(32, 58, 16, 3.5, P.dark1);
  if (o.rise > 0) for (const x of [22, 30, 38, 44]) c.set(x, 56, P.flame1);
  // Legs
  const liftL = o.step === 1 ? 3 : 0;
  const liftR = o.step === 3 ? 3 : 0;
  if (44 + b < 57) {
    c.vline(27, 44 + b, 13 - liftL - Math.max(0, b), bone);
    c.vline(37, 44 + b, 13 - liftR - Math.max(0, b), bone);
    c.hline(25, 57 - liftL, 4, boneDark);
    c.hline(36, 57 - liftR, 4, boneDark);
  }
  // Pelvis, spine, ribs with embers inside
  if (42 + b < 58) c.rect(26 + sh, 41 + b, 13, 3, boneDark);
  c.vline(32 + sh, 20 + b, 22, bone);
  for (let i = 0; i < 5; i++) {
    const y = 23 + b + i * 3;
    const w = 7 - Math.abs(i - 1);
    c.hline(32 + sh - w, y, w * 2 + 1, bone);
    if (i < 4) c.set(32 + sh - 2 + i, y + 1, i % 2 ? P.flame2 : P.ember);
  }
  // Arms (spread = the summoning pose, arms raised wide). Upper arm then forearm on both sides, mirrored
  // around the spine (x = 32), so they're always the same length.
  const armY = 22 + b - o.spread * 6;
  const elbowOut = 15 + o.spread * 4; // shoulder-to-elbow reach from the spine
  const handOut = 16 + o.spread * 6;
  const handY = armY + 18 - o.spread * 12;
  for (const side of [-1, 1]) {
    const x0 = 32 + sh + side * 7; // shoulder
    const ex = 32 + sh + o.sway + side * elbowOut;
    const hx2 = 32 + sh + o.sway + side * handOut;
    line(c, x0, 22 + b, ex, armY + 10, bone);
    line(c, ex, armY + 10, hx2, handY, bone);
  }
  if (o.spread > 0) {
    // wax gathering between her raised hands
    c.disc(32 + sh, armY - 4, 3 + o.spread, P.flame1);
    c.disc(32 + sh, armY - 4, 1 + o.spread, P.flame2);
  }
  // Skull
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 9 + b + o.hunch + ly;
  c.ellipse(hx, hy + 4, 6, 6, bone);
  c.rect(hx - 3, hy + 8, 7, 3, boneDark); // jaw
  if (dir !== 'N' && dir !== 'NE') {
    const fx = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 3;
    c.rect(fx - 3, hy + 3, 2, 2, P.ink);
    c.rect(fx + 1, hy + 3, 2, 2, P.ink);
    c.set(fx - 3, hy + 3, o.flinch ? P.wax2 : P.flame2); // ember eyes
    c.set(fx + 1, hy + 3, o.flinch ? P.wax2 : P.flame2);
  }
  for (const [x, y] of [[-4, -2], [0, -3], [4, -2]]) c.set(hx + x, hy + y, P.ember); // wick stumps, burnt out
  // The ladle hand sits at the end of the right forearm (where the game holds the ladle; see boneHand).
  c.rect(32 + sh + o.sway + handOut - 1, handY - 1, 3, 3, bone);
}

/** Right-hand position relative to the pivot (32,58), matching drawBones' forearm, for per-frame `hand`. */
function boneHand(p: BodyPose & { spread?: number }): [number, number] {
  const s = p.spread ?? 0;
  const armY = 22 + (p.bob ?? 0) - s * 6;
  return [Math.round((p.sway ?? 0) + 16 + s * 6), Math.round(armY + 18 - s * 12 - 58)];
}

const SUMMON_POSES = [{ spread: 0.5 }, { spread: 1 }, { spread: 1.5, bob: -1 }, { spread: 2, bob: -2 }, { spread: 2, bob: -2 }, { spread: 1 }, {}];
const CHANNEL_POSES = [{ spread: 2, bob: -2 }, { spread: 1.8, bob: -3, sway: 1 }, { spread: 2, bob: -2 }, { spread: 1.8, bob: -1, sway: -1 }];

function bonesDeath(c: Img, f: number) {
  // The bones come apart and settle into a heap; the heap itself is what blows away as dust.
  if (f === 0) {
    drawBones(c, 'S', { flinch: true, hunch: 2, bob: 2 });
    return;
  }
  const spread = f * 4;
  for (const [x, y, len, dx] of [[20, 50, 10, 1], [34, 52, 12, -1], [26, 46, 8, 1], [40, 48, 9, 0], [30, 54, 14, 0]]) {
    line(c, x - spread / 2, y + f, x + len * dx + spread / 2, y + f - (dx === 0 ? 0 : 3), P.wax2);
  }
  if (f < 4) c.ellipse(32, 50 + f, 5, 4, P.wax2); // the skull
  if (f < 4) c.rect(30, 49 + f, 2, 2, P.ink);
  c.ellipse(32, 57, 12 + f * 2, 2, P.stone4); // bone dust
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

  // ---- decor (64x64, pivot 32,62)
  const W = 64;
  const H = 64;
  const B = 62;
  const frames: Img[] = [];
  const cell = () => new Img(W, H);
  // 0: rendering vat (three tiles wide, tall): an iron cauldron full of glowing wax
  {
    const c = cell();
    c.ellipse(32, B - 10, 23, 10, P.dark1);
    c.rect(9, B - 30, 46, 22, P.steel1);
    c.vline(9, B - 30, 22, P.steel2);
    c.vline(54, B - 30, 22, P.stone1);
    for (const y of [B - 26, B - 16]) c.hline(9, y, 46, P.stone1);
    c.ellipse(32, B - 31, 23, 6, P.stone1); // rim
    c.ellipse(32, B - 31, 20, 4.5, P.wax1); // molten tallow
    c.ellipse(26, B - 32, 7, 2, P.wax2);
    c.set(40, B - 31, P.flame2);
    c.rect(28, B - 8, 8, 5, P.ember); // fire under it
    c.rect(30, B - 7, 4, 3, P.flame2);
    c.outline(P.ink);
    frames.push(c);
  }
  // 1: hook on a chain, hanging from above (no footprint)
  {
    const c = cell();
    for (let y = 0; y < 44; y += 3) c.rect(31, y, 2, 2, P.steel1);
    c.rect(30, 44, 4, 3, P.steel2);
    line(c, 33, 47, 35, 52, P.steel2);
    line(c, 35, 52, 31, 54, P.steel2);
    c.set(30, 52, P.steel2);
    c.ellipse(32, B - 1, 3, 1, withAlpha(P.ink, 120)); // shadow on the floor
    frames.push(c);
  }
  // 2: empty pilgrim cage (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(9, B - 26, 30, 26, P.dark1);
    for (let x = 9; x <= 38; x += 4) c.vline(x, B - 26, 26, P.steel1);
    c.hline(9, B - 26, 30, P.steel2);
    c.hline(9, B - 1, 30, P.steel2);
    c.rect(20, B - 6, 6, 3, P.stone3); // a dropped robe
    c.outline(P.ink);
    frames.push(c);
  }
  // 3: tallow blocks stacked on a pallet
  {
    const c = cell();
    c.rect(22, B - 3, 20, 3, P.wood1);
    for (const [x, y] of [[23, 11], [32, 11], [27, 19]]) {
      c.rect(x, B - y, 9, 8, P.wax1);
      c.hline(x, B - y, 9, P.wax2);
      c.rect(x + 3, B - y + 3, 3, 2, P.stone3); // a stamped mark
    }
    c.outline(P.ink);
    frames.push(c);
  }
  // 4: furnace (two tiles: anchor and west), tall, fire in its mouth
  {
    const c = cell();
    c.rect(9, B - 36, 30, 36, P.wood1);
    for (const y of [B - 30, B - 22, B - 14]) c.hline(9, y, 30, P.dark2);
    c.rect(15, B - 14, 18, 12, P.ink);
    c.rect(17, B - 11, 14, 9, P.ember);
    c.rect(20, B - 9, 8, 6, P.flame2);
    c.rect(20, B - 44, 8, 8, P.dark1); // flue
    c.outline(P.ink);
    frames.push(c);
  }
  // 5: iron pipe rising into the dark
  {
    const c = cell();
    c.rect(28, B - 46, 8, 46, P.steel1);
    c.vline(28, B - 46, 46, P.steel2);
    for (const y of [B - 34, B - 12]) c.rect(26, y, 12, 3, P.stone1);
    c.set(33, B - 20, P.ember);
    c.outline(P.ink);
    frames.push(c);
  }
  // 6: rack of pilgrim robes with name tags (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(9, B - 32, 30, 2, P.wood1);
    c.rect(9, B - 32, 2, 32, P.wood1);
    c.rect(37, B - 32, 2, 32, P.wood1);
    for (let i = 0; i < 5; i++) {
      const x = 12 + i * 5;
      c.rect(x, B - 30, 4, 18, [P.stone3, P.teal2, P.stone2, P.wood2, P.stone3][i]);
      c.rect(x + 1, B - 12, 2, 2, P.wax2); // tag
    }
    c.outline(P.ink);
    frames.push(c);
  }
  // 7: the foreman's desk with a ledger (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(9, B - 14, 30, 5, P.wood2);
    c.rect(10, B - 9, 3, 9, P.wood1);
    c.rect(35, B - 9, 3, 9, P.wood1);
    c.rect(16, B - 17, 10, 3, P.wax2); // open ledger
    c.vline(21, B - 17, 3, P.stone3);
    c.rect(30, B - 20, 2, 6, P.wax1); // candle
    c.set(30, B - 21, P.flame2);
    c.outline(P.ink);
    frames.push(c);
  }
  // 8: lift cage platform (flat, two tiles: anchor and east) with its chains
  {
    const c = cell();
    c.rect(24, B - 6, 32, 6, P.wood2);
    for (let x = 26; x < 56; x += 5) c.vline(x, B - 6, 6, P.wood1);
    c.hline(24, B - 6, 32, P.steel1);
    c.hline(24, B - 1, 32, P.steel1);
    for (const x of [25, 54]) for (let y = 0; y < B - 6; y += 3) c.rect(x, y, 1, 2, P.steel1);
    frames.push(c);
  }
  // 9: heap of chain (flat)
  {
    const c = cell();
    for (let i = 0; i < 9; i++) c.ellipse(24 + (i % 3) * 5 + (i > 5 ? 3 : 0), B - 2 - Math.floor(i / 3) * 2, 2.5, 1.5, P.steel1);
    frames.push(c);
  }
  // 10: tallow cart (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(10, B - 14, 28, 9, P.wood1);
    c.hline(10, B - 14, 28, P.wood2);
    c.disc(16, B - 4, 4, P.dark2);
    c.disc(32, B - 4, 4, P.dark2);
    c.rect(12, B - 19, 24, 5, P.wax1); // heaped tallow
    c.ellipse(20, B - 19, 5, 2, P.wax2);
    c.outline(P.ink);
    frames.push(c);
  }
  // 11: carters' toll booth (tall)
  {
    const c = cell();
    c.rect(22, B - 30, 20, 30, P.wood1);
    c.rect(20, B - 34, 24, 5, P.dark2); // roof
    c.rect(26, B - 24, 12, 8, P.ink); // window
    c.rect(28, B - 21, 2, 2, P.flame2);
    c.outline(P.ink);
    frames.push(c);
  }
  const deco = new Img(W * frames.length, H);
  frames.forEach((f, i) => deco.blit(f, i * W, 0));
  sheet('decor_works', deco, { cell: [W, H], pivot: [32, B], layer: 'single' });

  // ---- lever (16x24, pivot 8,23): frame 0 up (unpulled), 1 down
  const lever = new Img(32, 24);
  for (let f = 0; f < 2; f++) {
    const c = new Img(16, 24);
    c.rect(4, 17, 8, 6, P.stone2);
    c.hline(4, 17, 8, P.stone3);
    if (f === 0) line(c, 8, 18, 10, 6, P.steel1);
    else line(c, 8, 18, 14, 14, P.steel1);
    const [kx, ky] = f === 0 ? [10, 5] : [14, 13];
    c.disc(kx, ky, 1.5, P.blood2);
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
  rosterSheet(
    'mother_tallow',
    64,
    [32, 58],
    7,
    [
      { name: 'idle', frames: frames2(drawMother, [{}, { bob: 1 }]), timing: [{ ticks: 30 }, { ticks: 30 }], loop: true },
      { name: 'walk', frames: walk4(drawMother, f => ({ bob: f % 2 ? 1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(14), loop: true },
      {
        name: 'sweep',
        frames: frames2(drawMother, [{ sway: -2, lean: -1 }, { sway: -3, lean: -2 }, { sway: -3, lean: -2, bob: 1 }, { sway: 3, lean: 3 }, { sway: 3, lean: 2 }, { sway: 1, lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'spit',
        frames: frames2(drawMother, [{ hunch: -1 }, { hunch: -2, lean: -2 }, { hunch: -2, lean: -2, bob: -1 }, { hunch: 1, lean: 3 }, { lean: 2 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'crush',
        frames: frames2(drawMother, [{ bob: -2, hunch: -2 }, { bob: -3, hunch: -3 }, { bob: -3, hunch: -3, sway: 1 }, { bob: 3, hunch: 3, lean: 2 }, { bob: 4, hunch: 3, lean: 2 }, { bob: 2 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // The entrance: she rises out of her vat's pool, the wicks on her shoulders catching one by one.
        name: 'intro',
        frames: frames2(drawMother, [{ rise: 26 }, { rise: 18 }, { rise: 10 }, { rise: 3 }, { rise: 0, sway: -1 }, { rise: 0, sway: 1 }]),
        timing: [{ ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 15 }, { ticks: 15 }, { ticks: 30 }],
        loop: false,
      },
      { name: 'stagger', frames: frames2(drawMother, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => motherDeath(c, f)),
    MOTHER_HAND,
  );

  rosterSheet(
    'mother_bones',
    64,
    [32, 58],
    7,
    [
      { name: 'idle', frames: frames2(drawBones, [{}, { bob: 1, sway: 1 }]), timing: [{ ticks: 14 }, { ticks: 14 }], loop: true },
      { name: 'walk', frames: walk4(drawBones, f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1 })), timing: walkT(7), loop: true },
      {
        name: 'sweep',
        frames: frames2(drawBones, [{ sway: -3, lean: -2 }, { sway: -4, lean: -3 }, { sway: -4, lean: -3, bob: 1 }, { sway: 4, lean: 4 }, { sway: 3, lean: 3 }, { sway: 1, lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'jab',
        frames: frames2(drawBones, [{ lean: -1 }, { lean: -3, hunch: 1 }, { lean: -3, hunch: 1 }, { lean: 5 }, { lean: 4 }, { lean: 2 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'spit',
        frames: frames2(drawBones, [{ hunch: -1 }, { hunch: -2, lean: -2 }, { hunch: -3, lean: -2, bob: -1 }, { hunch: 2, lean: 3 }, { lean: 2 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'leap',
        frames: frames2(drawBones, [{ bob: 3, hunch: 2 }, { bob: 4, hunch: 3 }, { bob: -6, hunch: -2 }, { bob: 4, hunch: 3, lean: 3 }, { bob: 3, hunch: 2, lean: 2 }, { bob: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Raised-arm poses carry their own hand position, so the ladle goes up with the arm.
        name: 'summon',
        frames: frames2(drawBones, SUMMON_POSES),
        timing: P7.map((tm, i) => ({ ...tm, hand: boneHand(SUMMON_POSES[i]) })),
        loop: false,
      },
      {
        // Held while her summons live: arms raised, wax gathering between her hands, swaying slightly.
        name: 'channel',
        frames: frames2(drawBones, CHANNEL_POSES),
        timing: CHANNEL_POSES.map(p => ({ ticks: 10, hand: boneHand(p) })),
        loop: true,
      },
      {
        // Rising out of her own burning wax.
        name: 'intro',
        frames: frames2(drawBones, [{ rise: 30 }, { rise: 20 }, { rise: 12 }, { rise: 5 }, { rise: 0, hunch: 3 }, { rise: 0, spread: 1 }]),
        timing: [{ ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 30 }],
        loop: false,
      },
      { name: 'stagger', frames: frames2(drawBones, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
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
        // recolour the pale wax to molten orange
        const [r, g] = [c.px[i], c.px[i + 1]];
        if (r === P.wax1[0] && g === P.wax1[1]) c.set(x, y, P.flame1);
        else if (r === P.wax2[0] && g === P.wax2[1]) c.set(x, y, P.flame2);
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

  const ladle = new Img(48, 16);
  ladle.hline(1, 8, 34, P.wood1);
  ladle.hline(1, 7, 34, P.wood2);
  ladle.ellipse(40, 8, 7, 6, P.steel1);
  ladle.ellipse(40, 7, 5, 3, P.wax1);
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

function drawMatron(c: Img, dir: Dir5, pose: BodyPose & { rise?: number; spread?: number }) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, spread: 0, ...pose };
  const b = o.bob + o.rise;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  c.ellipse(32, 57, 20, 4.5, P.wax1); // her pool
  c.ellipse(24, 56, 7, 1.5, P.wax2);
  // Body: a long habit that melts into the pool
  for (let y = 20; y <= 55; y++) {
    if (y + b > 56) continue;
    const half = Math.round(7 + (y - 20) * 0.2);
    c.hline(32 + sh - half, y + b, half * 2, y > 46 ? P.wax1 : P.teal1);
  }
  c.vline(32 + sh - 7, 20 + b, 26, P.teal2);
  c.rect(27 + sh, 24 + b, 10, 4, P.stone3); // collar / apron bib
  // Arms: long as oars (spread = arms opened wide, singing)
  const aY = 22 + b - o.spread * 3;
  for (const side of [-1, 1]) {
    const ex = 32 + sh + o.sway + side * (12 + o.spread * 6);
    const hx2 = 32 + sh + o.sway + side * (15 + o.spread * 9);
    line(c, 32 + sh + side * 6, 22 + b, ex, aY + 12, P.teal1);
    line(c, 32 + sh + side * 7, 22 + b, ex + side, aY + 12, P.teal1);
    line(c, ex, aY + 12, hx2, aY + 24 - o.spread * 8, P.wax2);
  }
  // Veiled head, face pale and calm
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 7 + b + o.hunch + ly;
  c.rect(hx - 6, hy, 12, 15, P.stone1); // veil
  c.rect(hx - 5, hy + 1, 10, 4, P.wax2); // wimple band
  if (dir !== 'N' && dir !== 'NE') {
    const fx = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 3;
    c.rect(fx - 3, hy + 5, 6, 7, P.wax1);
    c.hline(fx - 2, hy + 7, 2, P.ink); // closed eyes
    c.hline(fx + 1, hy + 7, 2, P.ink);
    c.rect(fx - 1, hy + 10, 2, o.spread > 0 ? 2 : 1, o.flinch ? P.ember : P.dark2); // singing mouth
  }
  const [ax, ay] = MATRON_HAND[dir];
  if (o.spread === 0) c.rect(ax - 1, ay - 1 + b, 3, 3, P.wax2);
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

  // ---- decor (64x64, pivot 32,62)
  const W = 64;
  const H = 64;
  const B = 62;
  const frames: Img[] = [];
  const cell = () => new Img(W, H);
  // 0: gravestone, leaning
  {
    const c = cell();
    for (let y = 0; y < 16; y++) c.hline(26 + Math.floor(y / 6), B - 16 + y, 11, y < 3 ? P.stone3 : P.stone2);
    c.ellipse(31.5, B - 16, 5.5, 3, P.stone3);
    c.hline(29, B - 10, 5, P.stone1);
    c.hline(29, B - 7, 4, P.stone1);
    c.ellipse(32, B - 1, 7, 1.5, P.wax1); // wax pooled at its foot
    c.outline(P.ink);
    frames.push(c);
  }
  // 1: grave cross
  {
    const c = cell();
    c.rect(31, B - 20, 3, 20, P.wood1);
    c.rect(26, B - 16, 13, 3, P.wood1);
    c.set(30, B - 22, P.wax1);
    c.vline(33, B - 13, 4, P.wax1); // wax drips
    c.outline(P.ink);
    frames.push(c);
  }
  // 2: reeds (tall enough to hide in; see decor.json)
  {
    const c = cell();
    const r = rng(5100);
    for (let i = 0; i < 14; i++) {
      const x = 24 + Math.floor(r() * 16);
      const h = 14 + Math.floor(r() * 12);
      line(c, x, B, x + (r() < 0.5 ? -2 : 2), B - h, i % 3 ? P.moss1 : P.moss2);
      if (i % 4 === 0) c.rect(x + (r() < 0.5 ? -2 : 2) - 1, B - h - 3, 2, 4, P.wood1); // bulrush heads
    }
    frames.push(c);
  }
  // 3: root tangle (two tiles: anchor and west), tall
  {
    const c = cell();
    const r = rng(5200);
    for (let i = 0; i < 9; i++) {
      const x0 = 10 + Math.floor(r() * 28);
      line(c, x0, B, x0 + Math.floor(r() * 12) - 6, B - 18 - Math.floor(r() * 14), P.wood1);
      line(c, x0 + 1, B, x0 + Math.floor(r() * 10) - 4, B - 12 - Math.floor(r() * 10), P.wax1);
    }
    c.ellipse(24, B - 2, 13, 3, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 4: weeping stone angel, tall
  {
    const c = cell();
    c.rect(26, B - 6, 12, 6, P.stone1); // plinth
    c.rect(28, B - 26, 8, 20, P.stone3); // robed body
    c.ellipse(32, B - 29, 3.5, 4, P.stone3); // head bowed
    c.rect(29, B - 27, 6, 2, P.stone4); // hands to the face
    for (const s of [-1, 1]) for (let i = 0; i < 12; i++) c.hline(32 + s * (4 + Math.floor(i / 2)), B - 30 + i, 3, P.stone2); // wings folded
    c.vline(31, B - 24, 5, P.wax1); // wax tears
    c.outline(P.ink);
    frames.push(c);
  }
  // 5: coffin, half sunk (flat)
  {
    const c = cell();
    for (let y = 0; y < 6; y++) c.hline(20 + (y < 3 ? 3 - y : y - 3), B - 7 + y, 24 - 2 * Math.abs(y - 3), P.wood1);
    c.hline(21, B - 5, 22, P.wood2);
    c.ellipse(32, B - 1, 14, 2, P.wax1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 6: drowned candles (floating stubs, flat)
  {
    const c = cell();
    for (const [x, y] of [[24, 4], [30, 2], [36, 5], [40, 1]]) {
      c.ellipse(x, B - y, 2, 1, P.wax1);
      c.rect(x - 1, B - y - 3, 2, 3, P.wax2);
      c.set(x - 1, B - y - 4, P.flame2);
    }
    frames.push(c);
  }
  // 7: dead willow, drooping (tall)
  {
    const c = cell();
    c.rect(30, B - 26, 4, 26, P.wood1);
    line(c, 32, B - 26, 18, B - 36, P.wood1);
    line(c, 32, B - 24, 46, B - 34, P.wood1);
    for (const x of [18, 22, 27, 38, 42, 46]) c.vline(x, B - 35 + (x % 3), 12 + (x % 5), P.moss1); // hanging moss
    c.outline(P.ink);
    frames.push(c);
  }
  // 8: sunken bell, rim above the wax (low)
  {
    const c = cell();
    c.ellipse(32, B - 5, 11, 6, P.flame1);
    c.ellipse(32, B - 7, 9, 3, P.ember);
    c.ellipse(32, B - 1, 14, 2.5, P.wax1);
    c.outline(P.ink);
    frames.push(c);
  }
  const deco = new Img(W * frames.length, H);
  frames.forEach((f, i) => deco.blit(f, i * W, 0));
  sheet('decor_mire', deco, { cell: [W, H], pivot: [32, B], layer: 'single' });

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
  rosterSheet(
    'mire_matron',
    64,
    [32, 58],
    7,
    [
      { name: 'idle', frames: frames2(drawMatron, [{}, { bob: 1, sway: 1 }]), timing: [{ ticks: 26 }, { ticks: 26 }], loop: true },
      { name: 'walk', frames: walk4(drawMatron, f => ({ bob: f % 2 ? 1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(12), loop: true },
      {
        name: 'sweep',
        frames: frames2(drawMatron, [{ sway: -3, lean: -1 }, { sway: -4, lean: -2 }, { sway: -4, lean: -2, bob: 1 }, { sway: 4, lean: 3 }, { sway: 3, lean: 2 }, { sway: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'embrace',
        frames: frames2(drawMatron, [{ spread: 0.5 }, { spread: 1, lean: -1 }, { spread: 1.2, lean: -1 }, { spread: 0.2, lean: 4 }, { lean: 4 }, { lean: 2 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'sing',
        frames: frames2(drawMatron, [{ spread: 0.5 }, { spread: 1, bob: -1 }, { spread: 1.5, bob: -2 }, { spread: 2, bob: -2 }, { spread: 2, bob: -1 }, { spread: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'intro',
        frames: frames2(drawMatron, [{ rise: 30 }, { rise: 22 }, { rise: 14 }, { rise: 6 }, { spread: 1 }, { spread: 2, bob: -1 }]),
        timing: [{ ticks: 18 }, { ticks: 18 }, { ticks: 18 }, { ticks: 18 }, { ticks: 20 }, { ticks: 40 }],
        loop: false,
      },
      { name: 'stagger', frames: frames2(drawMatron, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
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

function genRoster() {
  const P7 = phased7();
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));
  const frames = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));

  rosterSheet(
    'warden',
    CELL,
    PIVOT,
    7,
    [
      { name: 'idle', frames: frames(drawWarden, [{}, { bob: 1 }]), timing: idleT, loop: true },
      { name: 'walk', frames: walk4(drawWarden, f => ({ step: f, bob: f % 2 ? -1 : 0 })), timing: walkT(9), loop: true },
      {
        name: 'bash',
        frames: frames(drawWarden, [
          { lean: -1, shield: -1 }, { lean: -2, shield: -1 }, { lean: -2, shield: -1, bob: 1 },
          { lean: 2, shield: 3 }, { lean: 2, shield: 3 }, { lean: 1, shield: 1 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      {
        name: 'thrust',
        frames: frames(drawWarden, [{ lean: -1 }, { lean: -2 }, { lean: -2, bob: 1 }, { lean: 2 }, { lean: 3 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'overhead',
        frames: frames(drawWarden, [
          { lean: -1, hunch: -1, bob: -1 }, { lean: -2, hunch: -2, bob: -1 }, { lean: -2, hunch: -2, bob: -1, flinch: false },
          { lean: 2, bob: 1, hunch: 1 }, { lean: 2, bob: 1, hunch: 2 }, { lean: 1, bob: 1 }, {},
        ]),
        timing: P7,
        loop: false,
      },
      { name: 'stagger', frames: frames(drawWarden, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => wardenDeath(c, f)),
    WARDEN_HAND,
  );

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
      c.rect(2, 4, 12, 10, P.wood1);
      c.rect(2, 3, 12, 3, P.wood2);
      for (const y of [8, 11]) c.hline(3, y, 10, P.dark2);
      c.vline(2, 4, 10, P.wood2);
      c.set(12, 9, P.steel1);
    },
    c => {
      c.rect(2, 12, 5, 2, P.wood1);
      c.rect(8, 11, 6, 2, P.wood2);
      c.rect(5, 13, 4, 1, P.dark2);
    },
  );
  prop(
    'prop_pot',
    c => {
      c.ellipse(8, 9.5, 5, 4.5, P.wood2);
      c.ellipse(6.5, 8, 2, 2, P.flame1);
      c.rect(6, 3, 4, 2, P.wood2);
      c.hline(5, 3, 6, P.wood1);
      c.hline(4, 11, 8, P.wood1);
    },
    c => {
      c.rect(3, 12, 3, 2, P.wood2);
      c.rect(9, 11, 4, 2, P.wood2);
      c.set(7, 13, P.wood1);
    },
  );
  prop(
    'prop_candles',
    c => {
      c.ellipse(8, 13, 6, 2, P.wax1);
      for (const [x, h] of [[4, 5], [7, 8], [11, 6]] as const) {
        c.rect(x, 13 - h, 2, h, P.wax2);
        c.set(x, 12 - h, P.flame2);
        c.set(x + 1, 11 - h, P.flame1);
      }
    },
    c => {
      c.ellipse(8, 13, 6, 2, P.wax1);
      c.rect(5, 11, 5, 2, P.wax2);
    },
  );

  // Door: frame 0 = in a horizontal wall (face-on, with the wall cap above), frame 1 = in a vertical wall
  // (seen from above). Cell 16x32, pivot at the bottom of the door's tile.
  const door = new Img(32, 32);
  {
    const c = new Img(16, 32);
    c.rect(0, 0, 16, 16, P.dark1); // cap above
    c.hline(0, 0, 16, P.stone3);
    c.rect(0, 16, 16, 16, P.stone3); // stone frame
    c.rect(2, 17, 12, 13, P.wood1); // planks
    for (const x of [5, 8, 11]) c.vline(x, 17, 13, P.wood2);
    for (const y of [20, 26]) c.hline(2, y, 12, P.dark2);
    c.set(11, 23, P.flame1); // ring handle
    c.rect(0, 30, 16, 2, P.dark2);
    door.blit(c, 0, 0);
  }
  {
    const c = new Img(16, 32);
    c.rect(0, 16, 16, 16, P.dark1);
    c.rect(4, 16, 8, 16, P.wood1);
    c.vline(4, 16, 16, P.wood2);
    for (const y of [19, 28]) c.hline(4, y, 8, P.dark2);
    c.set(10, 24, P.flame1);
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
  const img = new Img(T * 8, T * 6);
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
      wall_front: [12, 12, 12, 12, 12, 13, 12, 12, 14, 15],
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
function genHubDecor() {
  const W = 64;
  const H = 64;
  const B = 62;
  const frames: Img[] = [];
  const cell = () => new Img(W, H);

  // 0: merchant stall: counter three tiles wide under a striped awning
  {
    const c = cell();
    c.rect(10, B - 30, 2, 30, P.wood1);
    c.rect(52, B - 30, 2, 30, P.wood1);
    c.rect(9, B - 12, 46, 12, P.wood2); // counter
    c.hline(9, B - 12, 46, P.wax1);
    for (let x = 12; x < 54; x += 8) c.vline(x, B - 11, 11, P.wood1);
    for (let i = 0; i < 6; i++) c.rect(7 + i * 8, B - 38, 8, 7, i % 2 ? P.wax1 : P.ember); // awning
    for (let i = 0; i < 6; i++) c.set(10 + i * 8, B - 31, i % 2 ? P.wax1 : P.ember);
    c.rect(16, B - 16, 5, 4, P.stone3); // wares: a jar, a pouch, powder horn
    c.disc(30, B - 14, 2.5, P.wood1);
    c.rect(40, B - 15, 7, 3, P.wax2);
    c.outline(P.ink);
    frames.push(c);
  }
  // 1: campfire: stone ring, logs, flame
  {
    const c = cell();
    c.ellipse(32, B - 3, 9, 4, P.stone2);
    c.ellipse(32, B - 3, 6, 2.5, P.dark1);
    line(c, 26, B - 2, 38, B - 6, P.wood1);
    line(c, 26, B - 6, 38, B - 2, P.wood1);
    c.ellipse(32, B - 8, 4, 6, P.flame1);
    c.ellipse(32, B - 7, 2.5, 4, P.flame2);
    c.set(32, B - 15, P.flame1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 2: well with a little roof
  {
    const c = cell();
    c.ellipse(32, B - 6, 10, 6, P.stone2);
    c.ellipse(32, B - 8, 7, 3.5, P.dark1);
    c.rect(22, B - 28, 2, 20, P.wood1);
    c.rect(40, B - 28, 2, 20, P.wood1);
    c.rect(18, B - 34, 28, 6, P.wood2); // roof
    c.hline(18, B - 34, 28, P.wax1);
    c.hline(24, B - 22, 16, P.wood1); // winch
    c.vline(32, B - 21, 8, P.stone3); // rope
    c.rect(30, B - 14, 4, 4, P.wood1); // bucket
    c.outline(P.ink);
    frames.push(c);
  }
  // 3: pilgrim tent (two tiles: the anchor and the one west)
  {
    const c = cell();
    for (let y = 0; y < 22; y++) c.hline(24 - Math.round(y * 0.7) - 8, B - 22 + y, Math.round(y * 1.4) + 2 + 14, y % 5 === 0 ? P.wax2 : P.wax1);
    c.rect(20, B - 12, 8, 12, P.dark1); // opening
    c.vline(24, B - 26, 5, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 4: fence segment
  {
    const c = cell();
    c.rect(24, B - 12, 2, 12, P.wood1);
    c.rect(38, B - 12, 2, 12, P.wood1);
    c.rect(24, B - 10, 16, 2, P.wood2);
    c.rect(24, B - 5, 16, 2, P.wood2);
    c.outline(P.ink);
    frames.push(c);
  }
  // 5: lantern post
  {
    const c = cell();
    c.rect(31, B - 30, 2, 30, P.wood1);
    c.rect(31, B - 30, 8, 2, P.wood1);
    c.rect(35, B - 27, 5, 6, P.dark1);
    c.rect(36, B - 26, 3, 4, P.flame2);
    c.ellipse(32, B - 1, 3, 1, P.dark2);
    c.outline(P.ink);
    frames.push(c);
  }
  // 6: hand cart (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(10, B - 14, 28, 9, P.wood2);
    c.hline(10, B - 14, 28, P.wax1);
    for (const x of [16, 24, 32]) c.vline(x, B - 13, 8, P.wood1);
    c.disc(16, B - 4, 4, P.wood1);
    c.disc(16, B - 4, 1.5, P.steel1);
    line(c, 38, B - 10, 44, B - 4, P.wood1); // handle
    c.rect(14, B - 18, 8, 4, P.wax1); // sacks
    c.rect(24, B - 17, 6, 3, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 7: chapel altar with candles (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(10, B - 14, 28, 14, P.stone2);
    c.rect(10, B - 14, 28, 3, P.stone3);
    c.rect(18, B - 10, 12, 6, P.blood1); // altar cloth
    for (const [x, h] of [[13, 6], [17, 9], [30, 7], [34, 5]]) {
      c.rect(x, B - 14 - h, 2, h, P.wax2);
      c.set(x, B - 15 - h, P.flame2);
    }
    c.outline(P.ink);
    frames.push(c);
  }
  // 8: prayer bench (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(11, B - 9, 26, 3, P.wood2);
    c.rect(11, B - 16, 26, 3, P.wood1); // backrest
    for (const x of [12, 34]) c.rect(x, B - 16, 2, 16, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 9: bedroll (flat)
  {
    const c = cell();
    c.rect(22, B - 8, 20, 7, P.teal2);
    c.rect(22, B - 8, 6, 7, P.wax1); // pillow end
    c.hline(28, B - 5, 14, P.teal1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 10: bookshelf against a wall (two tiles: anchor and west)
  {
    const c = cell();
    c.rect(10, B - 34, 28, 34, P.wood1);
    for (const y of [B - 26, B - 17, B - 8]) c.hline(11, y, 26, P.dark1);
    const r = rng(9090);
    for (const y0 of [B - 33, B - 25, B - 16]) for (let x = 12; x < 36; x += 3) c.rect(x, y0 + Math.floor(r() * 2), 2, 7, [P.blood1, P.teal2, P.wax1, P.wood2][Math.floor(r() * 4)]);
    c.outline(P.ink);
    frames.push(c);
  }
  // 11: ruined timber wall (three tiles)
  {
    const c = cell();
    c.rect(8, B - 8, 48, 8, P.stone2); // stone footing
    c.hline(8, B - 8, 48, P.stone3);
    for (const x of [9, 30, 51]) c.rect(x, B - 44 + (x === 51 ? 16 : 0), 4, 36 - (x === 51 ? 16 : 0), P.wood1); // posts, one broken
    c.rect(13, B - 38, 17, 30, P.wax1); // plaster panel
    line(c, 13, B - 38, 29, B - 9, P.wood1); // brace
    c.rect(34, B - 26, 17, 18, P.wax1); // lower panel, the top gone
    c.rect(38, B - 22, 6, 6, P.dark1); // hole
    c.rect(9, B - 44, 24, 3, P.wood2); // top beam, snapped
    c.outline(P.ink);
    frames.push(c);
  }
  // 12: notice board
  {
    const c = cell();
    c.rect(25, B - 24, 2, 24, P.wood1);
    c.rect(37, B - 24, 2, 24, P.wood1);
    c.rect(23, B - 26, 18, 12, P.wood2);
    c.rect(26, B - 24, 5, 6, P.wax2);
    c.rect(33, B - 23, 5, 7, P.wax1);
    c.outline(P.ink);
    frames.push(c);
  }

  const img = new Img(W * frames.length, H);
  frames.forEach((f, i) => img.blit(f, i * W, 0));
  sheet('decor_hub', img, { cell: [W, H], pivot: [32, B], layer: 'single' });
}

// ---------------------------------------------------------------- NPCs (32x32, pivot 16,28) and portraits (32x32)
// NPC frames: 0-1 idle (breathing), 2-3 talking (mouth open / closed). Skin is pale wax: everyone here is
// half a candle already.
type NpcPose = { breath: number; mouth: boolean };

function drawOskar(c: Img, { breath, mouth }: NpcPose) {
  const b = breath;
  c.ellipse(16, 27, 6, 1.5, withAlpha(P.ink, 90)); // feet shadow
  c.rect(11, 22, 4, 6, P.dark2); // legs
  c.rect(17, 22, 4, 6, P.dark2);
  c.rect(9, 12 + b, 14, 11, P.wood1); // broad body in convict's rags
  c.hline(9, 12 + b, 14, P.wood2);
  for (const y of [15, 18, 21]) c.hline(10, y + b, 12, P.dark2);
  c.rect(7, 14 + b, 3, 7, P.wood1); // arms
  c.rect(22, 14 + b, 3, 7, P.wood1);
  c.rect(7, 20 + b, 3, 2, P.steel1); // shackles
  c.rect(22, 20 + b, 3, 2, P.steel1);
  c.rect(12, 4 + b, 8, 8, P.wax1); // big bald head
  c.hline(12, 4 + b, 8, P.wax2);
  c.set(14, 7 + b, P.ink); // eyes
  c.set(17, 7 + b, P.ink);
  c.rect(12, 9 + b, 8, 4, P.dark2); // beard
  if (mouth) c.rect(15, 10 + b, 2, 1, P.blood1);
  c.outline(P.ink);
}

function drawMaudlin(c: Img, { breath, mouth }: NpcPose) {
  const b = breath;
  c.ellipse(16, 27, 5, 1.5, withAlpha(P.ink, 90));
  c.rect(11, 12 + b, 10, 16 - b, P.stone2); // grey habit to the ground
  c.vline(11, 13 + b, 14, P.stone3);
  c.vline(20, 13 + b, 15, P.stone1);
  c.hline(12, 18 + b, 8, P.stone1); // cord belt
  c.rect(13, 16 + b, 6, 3, P.stone3); // hands folded
  c.rect(15, 13 + b, 2, 4, P.wax2); // a candle in her hands
  c.set(15, 12 + b, P.flame2);
  c.rect(11, 4 + b, 10, 9, P.stone1); // veil
  c.rect(12, 5 + b, 8, 7, P.wax2); // wimple
  c.rect(13, 6 + b, 6, 5, P.wax1); // face
  c.set(14, 8 + b, P.ink);
  c.set(17, 8 + b, P.ink);
  if (mouth) c.set(15, 10 + b, P.blood1);
  c.outline(P.ink);
}

function drawPip(c: Img, { breath, mouth }: NpcPose) {
  const b = breath;
  c.ellipse(16, 27, 4, 1.2, withAlpha(P.ink, 90));
  c.rect(13, 23, 2, 5, P.dark2);
  c.rect(17, 23, 2, 5, P.dark2);
  c.rect(12, 16 + b, 8, 8 - b, P.teal2); // small cloak
  c.hline(12, 23, 8, P.teal1);
  c.rect(13, 10 + b, 6, 6, P.wax1); // face
  c.rect(12, 9 + b, 8, 2, P.wood1); // messy hair
  c.set(12, 11 + b, P.wood1);
  c.set(14, 12 + b, P.ink);
  c.set(17, 12 + b, P.ink);
  if (mouth) c.set(15, 14 + b, P.blood1);
  c.rect(19, 18 + b, 2, 3, P.wax2); // a candle stub
  c.set(19, 17 + b, P.flame1);
  c.outline(P.ink);
}

/** Head-and-shoulders portraits for the dialogue box, drawn at double detail. */
function drawPortrait(c: Img, who: 'oskar' | 'maudlin' | 'pip' | 'tollwarden' | 'matron' | 'chandler') {
  c.rect(0, 0, 32, 32, P.dark1);
  if (who === 'chandler') {
    c.rect(3, 24, 26, 8, P.wax2); // chasuble
    c.hline(3, 24, 26, P.flame1);
    c.rect(14, 24, 4, 8, P.flame1); // the gold orphrey
    c.vline(15, 24, 8, P.flame2);
    c.rect(9, 21, 14, 4, P.blood2); // red stole at the collar
    c.rect(10, 7, 12, 15, P.stone4); // a long grey face
    c.hline(11, 21, 10, P.stone3);
    c.vline(10, 9, 12, P.stone3); // hollow cheeks
    c.vline(21, 9, 12, P.stone3);
    c.hline(11, 11, 4, P.dark2); // deep-set, tired eyes
    c.hline(17, 11, 4, P.dark2);
    c.set(13, 12, P.ink);
    c.set(18, 12, P.ink);
    c.rect(15, 13, 2, 3, P.stone3); // nose
    c.hline(14, 18, 4, P.dark2); // a thin mouth
    c.vline(12, 6, 4, P.wax1); // wax running from the crown
    c.hline(9, 5, 14, P.flame1); // crown band
    c.set(16, 5, P.blood2);
    for (const x of [10, 13, 16, 19, 22]) {
      c.vline(x, 1, 4, P.wax2); // lit tapers
      c.set(x, 0, P.flame2);
    }
  } else if (who === 'matron') {
    c.rect(4, 24, 24, 8, P.teal1); // sodden habit
    c.rect(9, 22, 14, 4, P.stone3); // collar
    c.rect(6, 2, 20, 23, P.stone1); // veil
    c.rect(8, 4, 16, 4, P.wax2); // wimple band
    c.rect(10, 8, 12, 14, P.wax1); // face, pale as wax
    c.hline(12, 13, 3, P.ink); // eyes closed
    c.hline(18, 13, 3, P.ink);
    c.rect(15, 18, 3, 2, P.dark2); // singing
    c.vline(11, 14, 6, P.wax2); // wax tear tracks
    c.vline(21, 15, 5, P.wax2);
    for (const x of [7, 25]) c.vline(x, 20, 6, P.wax1); // wax running from the veil's hem
  } else if (who === 'tollwarden') {
    c.rect(3, 24, 26, 8, P.blood1); // coat collar
    c.ellipse(5, 26, 5, 4, P.steel1); // pauldrons
    c.ellipse(27, 26, 5, 4, P.steel1);
    c.rect(8, 3, 16, 21, P.steel1); // barbute
    c.vline(8, 3, 21, P.steel2);
    c.hline(8, 23, 16, P.stone1);
    c.rect(14, 0, 4, 3, P.flame1); // crest
    c.hline(10, 11, 12, P.ink); // visor slit
    c.hline(10, 12, 12, P.ink);
    c.rect(12, 11, 2, 2, P.wax2); // pale candle eyes
    c.rect(18, 11, 2, 2, P.wax2);
    c.rect(15, 14, 2, 7, P.ink); // the coin slot
    c.set(22, 7, P.stone3); // dents
    c.set(10, 18, P.stone3);
  } else if (who === 'oskar') {
    c.rect(4, 22, 24, 10, P.wood1);
    c.hline(4, 22, 24, P.wood2);
    c.rect(8, 4, 16, 17, P.wax1);
    c.hline(8, 4, 16, P.wax2);
    c.rect(10, 9, 3, 2, P.ink);
    c.rect(19, 9, 3, 2, P.ink);
    c.hline(9, 7, 5, P.wood1); // heavy brows
    c.hline(18, 7, 5, P.wood1);
    c.rect(8, 14, 16, 9, P.dark2); // beard
    c.rect(13, 16, 6, 2, P.blood1);
    c.set(15, 12, P.stone3); // nose
    c.set(16, 12, P.stone3);
  } else if (who === 'maudlin') {
    c.rect(4, 22, 24, 10, P.stone2);
    c.rect(6, 2, 20, 22, P.stone1); // veil
    c.rect(8, 4, 16, 18, P.wax2); // wimple
    c.rect(10, 7, 12, 13, P.wax1); // face
    c.rect(12, 11, 2, 2, P.ink);
    c.rect(18, 11, 2, 2, P.ink);
    c.hline(11, 10, 3, P.stone3);
    c.hline(18, 10, 3, P.stone3);
    c.hline(14, 17, 4, P.blood1);
    c.vline(10, 8, 12, P.stone4); // lined cheeks: tired
    c.vline(21, 8, 12, P.stone4);
  } else {
    c.rect(7, 22, 18, 10, P.teal2);
    c.rect(9, 7, 14, 15, P.wax1);
    c.rect(8, 4, 16, 5, P.wood1); // hair
    c.rect(8, 9, 2, 4, P.wood1);
    c.rect(22, 9, 2, 3, P.wood1);
    c.rect(11, 12, 2, 3, P.ink); // big eyes
    c.rect(19, 12, 2, 3, P.ink);
    c.set(11, 12, P.wax2);
    c.set(19, 12, P.wax2);
    c.hline(15, 18, 2, P.blood1);
  }
  // frame
  c.hline(0, 0, 32, P.stone3);
  c.hline(0, 31, 32, P.stone3);
  c.vline(0, 0, 32, P.stone3);
  c.vline(31, 0, 32, P.stone3);
}

function genNpcs() {
  const poses: NpcPose[] = [
    { breath: 0, mouth: false },
    { breath: 1, mouth: false },
    { breath: 0, mouth: true },
    { breath: 0, mouth: false },
  ];
  const draws = { oskar: drawOskar, maudlin: drawMaudlin, pip: drawPip } as const;
  for (const [name, draw] of Object.entries(draws)) {
    const img = new Img(32 * poses.length, 32);
    poses.forEach((pose, i) => {
      const c = new Img(32, 32);
      draw(c, pose);
      img.blit(c, i * 32, 0);
    });
    sheet(`npc_${name}`, img, { cell: [32, 32], pivot: [16, 28], layer: 'single' });
  }
  const who = ['oskar', 'maudlin', 'pip', 'tollwarden', 'matron', 'chandler'] as const;
  const portraits = new Img(32 * who.length, 32);
  who.forEach((w, i) => {
    const c = new Img(32, 32);
    drawPortrait(c, w);
    portraits.blit(c, i * 32, 0);
  });
  sheet('portraits', portraits, { cell: [32, 32], pivot: [0, 0], layer: 'ui' });
}

// ---------------------------------------------------------------- chest (20x18 cells, pivot = ground centre)
// Frames: 0 closed, 1-3 opening (lid rising, light spilling out), 4 open and empty.
function genChest() {
  const W = 20;
  const H = 18;
  const body = (c: Img) => {
    c.rect(2, 9, 16, 7, P.wood1);
    c.hline(2, 12, 16, P.wood2);
    c.vline(5, 9, 7, P.steel1);
    c.vline(14, 9, 7, P.steel1);
    c.hline(2, 15, 16, P.dark2);
  };
  const frames: Img[] = [];
  for (let f = 0; f < 5; f++) {
    const c = new Img(W, H);
    body(c);
    if (f === 0) {
      c.rect(2, 5, 16, 4, P.wood2); // lid
      c.hline(3, 4, 14, P.wood2);
      c.vline(5, 4, 5, P.steel1);
      c.vline(14, 4, 5, P.steel1);
      c.rect(9, 8, 2, 3, P.flame2); // lock
    } else {
      const lift = [0, 2, 4, 5, 5][f];
      const inside = f === 4 ? P.dark1 : f === 1 ? P.flame1 : P.flame2;
      c.rect(3, 9, 14, 2, inside); // the open mouth of the chest
      c.rect(2, 8 - lift, 16, Math.max(1, 5 - lift), P.wood1); // lid tipping back: seen from below, shorter
      c.hline(3, 7 - lift, 14, P.wood2);
      if (f >= 2 && f <= 3) {
        c.rect(5, 6 - lift, 10, lift + 2, withAlpha(P.wax2, 150)); // light spilling up
        c.set(10, 1, P.wax2);
      }
    }
    c.outline(P.ink);
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

// ---------------------------------------------------------------- Penance Road decor (64x48 cells, pivot = ground centre)
function genRoadDecor() {
  const W = 64;
  const H = 48;
  const frames: Img[] = [];
  const cell = () => new Img(W, H);
  const B = 46; // ground line

  // 0: the prison wagon, overturned on its side. Floor planks face us; the barred side faces up.
  {
    const c = cell();
    c.rect(6, B - 20, 52, 20, P.wood1); // floor boards (now vertical)
    for (let x = 8; x < 58; x += 6) c.vline(x, B - 20, 20, P.dark2);
    c.hline(6, B - 20, 52, P.wood2);
    c.hline(6, B - 11, 52, P.wood2);
    c.rect(6, B - 32, 52, 12, P.dark1); // the cage side seen from above, dark inside
    for (let x = 9; x < 57; x += 5) c.vline(x, B - 32, 12, P.steel1); // bars
    c.hline(6, B - 32, 52, P.wood2);
    c.rect(40, B - 32, 10, 12, P.dark1); // broken bars: the way you crawled out
    line(c, 40, B - 31, 44, B - 24, P.steel1);
    for (const [cx, cy] of [[16, B - 8], [48, B - 8]]) {
      c.disc(cx, cy, 7, P.wood2); // wheels, axle side toward us
      c.disc(cx, cy, 5, P.wood1);
      line(c, cx - 5, cy, cx + 5, cy, P.wood2);
      line(c, cx, cy - 5, cx, cy + 5, P.wood2);
      c.disc(cx, cy, 1.5, P.steel1);
    }
    c.outline(P.ink);
    frames.push(c);
  }
  // 1: dead horse
  {
    const c = cell();
    c.ellipse(32, B - 6, 15, 6, P.wood2);
    c.ellipse(15, B - 5, 6, 4, P.wood2); // head
    c.hline(14, B - 9, 10, P.dark2); // mane
    for (const x of [38, 42, 46]) line(c, x, B - 3, x + 4, B + 1, P.wood1);
    c.set(12, B - 6, P.ink);
    c.outline(P.ink);
    frames.push(c);
  }
  // 2: dead guard (flat) with blood
  {
    const c = cell();
    c.ellipse(34, B - 4, 11, 3, P.blood1);
    c.rect(24, B - 7, 12, 5, P.steel1); // breastplate
    c.disc(40, B - 5, 3, P.steel2); // helmet
    c.rect(18, B - 6, 6, 3, P.dark2); // legs
    c.outline(P.ink);
    frames.push(c);
  }
  // 3: boulder
  {
    const c = cell();
    c.ellipse(32, B - 8, 11, 9, P.stone2);
    c.ellipse(29, B - 11, 6, 4, P.stone3);
    c.set(26, B - 13, P.stone4);
    c.hline(24, B - 1, 16, P.stone1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 4: dead tree
  {
    const c = cell();
    c.rect(30, B - 30, 5, 30, P.wood1);
    c.vline(31, B - 28, 26, P.dark2);
    line(c, 32, B - 22, 20, B - 36, P.wood1);
    line(c, 33, B - 26, 46, B - 42, P.wood1);
    line(c, 20, B - 36, 16, B - 38, P.wood1);
    line(c, 38, B - 33, 44, B - 30, P.wood1);
    line(c, 32, B - 30, 30, B - 44, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 5: loose wheel and planks (flat)
  {
    const c = cell();
    c.ellipse(26, B - 4, 7, 3, P.wood2);
    c.ellipse(26, B - 4, 5, 2, P.wood1);
    c.rect(36, B - 5, 12, 2, P.wood2);
    c.rect(38, B - 2, 9, 2, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 6: signpost pointing the way to the Abbey
  {
    const c = cell();
    c.rect(31, B - 26, 2, 26, P.wood1);
    c.rect(24, B - 26, 18, 6, P.wood2);
    c.set(42, B - 24, P.wood2);
    c.set(42, B - 23, P.wood2);
    c.hline(26, B - 23, 12, P.wood1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 7: roadside candle shrine (a small cairn with wax stubs)
  {
    const c = cell();
    c.ellipse(32, B - 5, 8, 5, P.stone2);
    c.ellipse(32, B - 9, 5, 3, P.stone3);
    for (const [x, h] of [[29, 5], [32, 7], [35, 4]]) {
      c.rect(x, B - 11 - h, 2, h, P.wax1);
      c.set(x, B - 12 - h, P.flame2);
    }
    c.outline(P.ink);
    frames.push(c);
  }
  // 8: gibbet: a post with an arm and a hanging iron cage
  {
    const c = cell();
    c.rect(24, B - 40, 3, 40, P.wood1);
    c.rect(24, B - 40, 18, 3, P.wood1);
    c.vline(38, B - 37, 5, P.steel1); // chain
    c.rect(34, B - 32, 9, 13, P.dark1);
    for (let x = 34; x <= 42; x += 2) c.vline(x, B - 32, 13, P.steel1);
    c.hline(34, B - 32, 9, P.steel1);
    c.hline(34, B - 20, 9, P.steel1);
    c.rect(37, B - 27, 3, 4, P.wax1); // something waxy inside
    c.outline(P.ink);
    frames.push(c);
  }
  // 9: large rock (two tiles wide, tall enough to hide behind)
  {
    const c = cell();
    // Drawn 8 px left of the pivot so it covers exactly its two blocking tiles (the anchor and the one west).
    c.ellipse(18, B - 11, 11, 11, P.stone2);
    c.ellipse(31, B - 8, 9, 8, P.stone2);
    c.ellipse(15, B - 15, 7, 5, P.stone3);
    c.ellipse(30, B - 11, 5, 3, P.stone3);
    c.set(12, B - 18, P.stone4);
    c.set(28, B - 13, P.stone4);
    c.hline(9, B - 1, 30, P.stone1);
    c.ellipse(22, B - 3, 3, 2, P.moss1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 10: ruined gate pillar
  {
    const c = cell();
    c.rect(26, B - 36, 12, 36, P.stone2);
    for (const y of [B - 30, B - 22, B - 14, B - 6]) c.hline(26, y, 12, P.stone1);
    c.vline(31, B - 30, 8, P.stone1);
    c.vline(34, B - 14, 8, P.stone1);
    c.rect(26, B - 36, 12, 2, P.stone3);
    for (const [x, y] of [[26, B - 37], [30, B - 38], [35, B - 37]]) c.rect(x, y, 3, 2, P.stone3); // broken top
    c.vline(26, B - 34, 34, P.stone3);
    c.ellipse(30, B - 2, 5, 2, P.moss1);
    c.outline(P.ink);
    frames.push(c);
  }
  // 11: fallen lintel: the gate's beam lying across the road (low cover, three tiles)
  {
    const c = cell();
    c.rect(9, B - 10, 46, 10, P.stone2);
    c.rect(9, B - 10, 46, 3, P.stone3);
    for (const x of [21, 36, 47]) c.vline(x, B - 7, 7, P.stone1);
    c.rect(18, B - 9, 12, 2, P.wax1); // carved letters, half worn away
    c.outline(P.ink);
    frames.push(c);
  }
  // 12: tall grass tuft (decoration only)
  {
    const c = cell();
    const r = rng(4242);
    for (let i = 0; i < 9; i++) {
      const x = 26 + Math.floor(r() * 12);
      const h = 4 + Math.floor(r() * 6);
      line(c, x, B - 1, x + (r() < 0.5 ? -1 : 1), B - h, i % 3 ? P.moss1 : P.moss2);
    }
    frames.push(c);
  }

  const img = new Img(W * frames.length, H);
  frames.forEach((f, i) => img.blit(f, i * W, 0));
  sheet('decor_road', img, { cell: [W, H], pivot: [32, B], layer: 'single' });
}

// =============================================================== THE NAVE: THE CHANDLER
// --- The Chandler (64x64): head of the Abbey. Tall and gaunt in heavy cream-and-red vestments with gold
// trim, a crown of lit tapers like a halo, a thin grey face with tired eyes. His weapon is a great
// candle-snuffer on an iron staff.
const CHANDLER_HAND: Record<Dir5, [number, number]> = { S: [42, 39], SE: [41, 38], E: [37, 38], NE: [40, 36], N: [40, 36] };

/** kneel 0..1; reach: both hands forward and up (pouring); lift: the free hand up to the crown (plucking a taper); smoke: censer cloud; drip: wax running off him. */
type PriestPose = BodyPose & { kneel?: number; reach?: number; lift?: number; smoke?: number; drip?: number };

function drawChandler(c: Img, dir: Dir5, pose: PriestPose) {
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, kneel: 0, reach: 0, lift: 0, smoke: 0, drip: 0, ...pose };
  const b = o.bob + Math.round(o.kneel * 9);
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const cx = 32 + sh;
  const top = 21 + b; // shoulders
  const hem = 57;
  // Red under-robe: a long bell to the floor, pooled wide when he kneels; the hem swings as he walks.
  for (let y = top; y <= hem; y++) {
    const k = (y - top) / Math.max(1, hem - top);
    const half = Math.round(5 + k * (7 + o.kneel * 5));
    const swing = y > hem - 6 && o.step >= 0 ? (o.step % 2 ? 1 : -1) : 0;
    c.hline(cx - half + swing, y, half * 2 + 1, y >= hem - 1 ? P.flame1 : P.blood1);
  }
  // Cream chasuble over it, to the knees, edged in gold
  const chasBot = Math.min(hem - 5, top + 25);
  for (let y = top; y <= chasBot; y++) {
    const k = (y - top) / Math.max(1, chasBot - top);
    const half = Math.round(6 + k * 4);
    c.hline(cx - half, y, half * 2 + 1, P.wax2);
    c.set(cx - half, y, P.flame1);
    c.set(cx + half, y, P.flame1);
  }
  c.hline(cx - 10, chasBot, 21, P.flame1);
  // The orphrey: a gold band down the front, a gold cross on the back
  if (!back) {
    c.vline(cx - 1, top, chasBot - top, P.flame1);
    c.vline(cx, top, chasBot - top, P.flame2);
    c.vline(cx + 1, top, chasBot - top, P.flame1);
  } else {
    c.vline(cx, top + 2, 18, P.flame1);
    c.hline(cx - 4, top + 7, 9, P.flame1);
  }
  // Wax stains running down under the gold: the Drip had him all along
  for (const [x, y, l] of [[-5, 10, 5], [4, 14, 4], [-3, 20, 3]]) c.vline(cx + x, top + y, l + o.drip, P.wax1);
  // Stiff red stole at the collar
  c.hline(cx - 5, top, 11, P.blood2);
  c.hline(cx - 4, top - 1, 9, P.blood2);

  // Arms: heavy cream sleeves, red cuffs, grey hands. The right hand holds the staff (CHANDLER_HAND).
  const [rx0, ry0] = CHANDLER_HAND[dir];
  const rHand: [number, number] = o.reach > 0 ? [cx + 5, Math.round(top + 10 - o.reach * 7)] : [rx0 + sh, ry0 + b];
  const lHand: [number, number] =
    o.reach > 0 ? [cx - 5, Math.round(top + 10 - o.reach * 7)] : o.lift > 0 ? [cx - 6, Math.round(top - 3 - o.lift * 5)] : [cx - 10 + o.sway, top + 17];
  for (const [side, hand] of [[1, rHand], [-1, lHand]] as const) {
    // red alb sleeves under the chasuble, a gold cuff
    for (let t = -1; t <= 1; t++) line(c, cx + side * 7 + t, top + 1, hand[0] + t, hand[1] - 2, t === side ? P.blood2 : P.blood1);
    c.hline(hand[0] - 1, hand[1] - 2, 3, P.flame1);
    c.rect(hand[0] - 1, hand[1] - 1, 3, 3, P.stone4);
  }
  if (o.drip > 0) for (const h of [rHand, lHand]) c.vline(h[0], h[1] + 2, o.drip * 3, P.wax1); // pouring himself out

  // Head: long, thin and grey
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 12 + b + o.hunch + ly;
  c.ellipse(hx, hy + 1, 4, 5.5, back ? P.stone2 : P.stone4);
  if (!back) {
    const fx = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 2;
    c.hline(fx - 3, hy, 2, P.dark2); // deep-set eyes
    c.hline(fx + 1, hy, 2, P.dark2);
    c.set(fx - 2, hy + 1, o.flinch ? P.ember : P.ink);
    c.set(fx + 2, hy + 1, o.flinch ? P.ember : P.ink);
    c.vline(fx - 3, hy + 2, 3, P.stone3); // hollow cheeks
    c.vline(fx + 3, hy + 2, 3, P.stone3);
    c.hline(fx - 1, hy + 4, 3, P.dark2); // a thin mouth
  }
  // Crown of lit tapers on a gold band, like a halo
  const cy = hy - 4;
  c.hline(hx - 4, cy, 9, P.flame1);
  if (!back) c.set(hx, cy, P.blood2);
  (back ? [-3, -1, 1, 3] : [-4, -2, 0, 2, 4]).forEach((dx, i) => {
    if (o.lift > 1.2 && dx === -2) return; // plucked, to throw
    const h = 3 + (i % 2) + (dx === 0 ? 1 : 0);
    c.vline(hx + dx, cy - h, h, P.wax2);
    c.set(hx + dx, cy - h - 1, P.flame2);
    if (!o.flinch) c.set(hx + dx, cy - h - 2, P.flame1);
  });
  // Censer smoke curling around him
  if (o.smoke > 0) {
    const r = rng(900 + Math.round(o.smoke * 10));
    for (let i = 0; i < 90 * o.smoke; i++) {
      const a = r() * Math.PI * 2;
      const d = 8 + r() * 16;
      c.set(32 + Math.cos(a) * d, 46 + Math.sin(a) * d * 0.6 - r() * 16, r() < 0.5 ? P.stone3 : P.stone4);
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

type CandlePose = BodyPose & { rise?: number; spread?: number; flare?: number; melt?: number; out?: boolean };

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
  const o = { bob: 0, lean: 0, hunch: 0, step: -1, flinch: false, sway: 0, rise: 0, spread: 0, flare: 1, melt: 0, out: false, ...pose };
  const b = o.bob + o.rise;
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const back = dir === 'N' || dir === 'NE';
  const cx = 32 + sh;
  // His own wax, pooling where he stands
  c.ellipse(32, 57, 12 + o.melt * 4, 3 + o.melt * 0.5, P.wax1);
  c.ellipse(28, 56.5, 5, 1.2, P.wax2);
  // The column of his body: wax, lit from inside (shorter than he was: he has been melting)
  const top = 28 + b;
  for (let y = top; y <= 56; y++) {
    const k = (y - top) / Math.max(1, 56 - top);
    const half = Math.round(7 + k * 3 + (y > 50 ? (y - 50) * 0.6 : 0));
    c.hline(cx - half, y, half * 2 + 1, P.wax1);
    c.set(cx - half + 1, y, P.wax2);
    if (!back && (y - top) % 5 === 2) c.set(cx + 2, y, P.flame1); // the glow through the wax
  }
  for (const [x, y, l] of [[-8, 8, 4], [7, 12, 5], [-5, 18, 3], [9, 20, 4]]) if (top + y < 56) c.vline(cx + x, top + y, l, P.wax2); // drips
  // Rags of burnt vestment at the hips
  const rag = rng(77);
  for (let x = -9; x <= 9; x++) if (top + 14 < 56) c.vline(cx + x, top + 14, Math.min(3 + Math.floor(rag() * 5), 56 - top - 14), x % 3 === 0 ? P.blood1 : P.dark2);
  // Fire licking up one flank, and cracks glowing through the wax
  const fl = rng(31 + (o.sway + 3) * 7 + o.bob * 3);
  for (let i = 0; i < 7; i++) {
    const y = top + 6 + Math.floor(fl() * 24);
    if (y > 55) continue;
    const x = cx + 7 + Math.floor(fl() * 3);
    const h = 2 + Math.floor(fl() * 3);
    c.vline(x, y - h, h, P.flame1);
    c.set(x, y - h, P.flame2);
    c.set(x + 1, y - 1, P.ember);
  }
  if (!back)
    for (const [x0, y0, x1, y1] of [[-3, 5, 1, 9], [1, 9, -1, 13], [3, 17, 5, 22]]) if (top + y1 < 55) line(c, cx + x0, top + y0, cx + x1, top + y1, P.ember);
  // Arms of wax (spread = raised wide). The right hand holds the snuffer (CANDLE_HAND) unless spread.
  const armY = top + 2;
  for (const side of [-1, 1]) {
    const held = side === 1 && !o.spread;
    const hx2 = held ? CANDLE_HAND[dir][0] + sh : Math.round(cx + side * (11 + o.spread * 5));
    const hy2 = Math.min(53, held ? CANDLE_HAND[dir][1] + b : Math.round(armY + 15 - o.spread * 12)); // sunk in: arms stay above the pool
    if (armY > 52) continue;
    for (let t = 0; t <= 1; t++) line(c, cx + side * 7, armY + t, hx2, hy2 + t, P.wax1);
    c.rect(hx2 - 1, hy2 - 1, 3, 3, P.wax2);
    c.vline(hx2, hy2 + 2, 2 + (o.spread ? 2 : 0), P.wax1);
  }
  // Head: melted to one side, one ember eye left
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 18 + b + o.hunch + ly;
  c.ellipse(hx, hy + 2, 5, 6, P.wax1);
  c.ellipse(hx + 2, hy + 7, 3, 2, P.wax1);
  if (!back) {
    const fx = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 2;
    c.rect(fx - 3, hy + 1, 2, 2, P.ink);
    c.set(fx - 3, hy + 1, o.flinch ? P.wax2 : P.flame2);
    c.hline(fx + 1, hy + 2, 2, P.wax2); // the other eye, melted shut
    c.hline(fx - 1, hy + 5, 3, o.flinch ? P.ember : P.dark2);
  }
  // The wick, and its black flame
  c.vline(hx, hy - 6, 3, P.ink);
  if (!o.out) blackFlame(c, hx, hy - 6, o.flare, o.sway);
  // Rising out of the altar fire: flames around what hasn't come up yet
  if (o.rise > 0 && o.melt === 0) {
    const r = rng(600 + o.rise);
    for (let i = 0; i < 16; i++) {
      const x = 20 + Math.floor(r() * 25);
      const h = 3 + Math.floor(r() * 8);
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
  img.hline(2, 8, 44, P.dark2);
  img.hline(2, 7, 44, P.steel1);
  img.rect(0, 6, 3, 4, P.flame1);
  img.rect(44, 6, 3, 4, P.flame1);
  for (let x = 47; x <= 58; x++) {
    const half = Math.round(1 + (x - 47) * 0.45);
    img.vline(x, 8 - half, half * 2 + 1, x > 55 ? P.steel2 : P.steel1);
    img.set(x, 8 - half, P.steel2);
  }
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
  const frames = <T,>(draw: (c: Img, d: Dir5, p: T) => void, poses: T[]) => poses.map(p => (c: Img, d: Dir5) => draw(c, d, p));
  const walk4 = <T,>(draw: (c: Img, d: Dir5, p: T) => void, mk: (f: number) => T) => [0, 1, 2, 3].map(f => (c: Img, d: Dir5) => draw(c, d, mk(f)));

  rosterSheet(
    'chandler',
    64,
    [32, 58],
    7,
    [
      { name: 'idle', frames: frames(drawChandler, [{}, { bob: 1 }]), timing: [{ ticks: 26 }, { ticks: 26 }], loop: true },
      { name: 'walk', frames: walk4(drawChandler, f => ({ step: f, bob: f % 2 ? 1 : 0, sway: f === 1 ? 1 : f === 3 ? -1 : 0 })), timing: walkT(11), loop: true },
      {
        name: 'sweep',
        frames: frames(drawChandler, [{ lean: -1 }, { lean: -2, sway: -1 }, { lean: -2, sway: -1, bob: 1 }, { lean: 3 }, { lean: 2 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Extinguish: the bell raised high, then brought down over you
        name: 'slam',
        frames: frames(drawChandler, [{ hunch: -1, bob: -1 }, { hunch: -2, bob: -2 }, { hunch: -2, bob: -2 }, { hunch: 2, bob: 2, lean: 3 }, { hunch: 2, bob: 3, lean: 3 }, { bob: 1, lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'jab',
        frames: frames(drawChandler, [{ lean: -1 }, { lean: -2 }, { lean: -2, hunch: 1 }, { lean: 4 }, { lean: 3 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Taper volley: plucks candles from his crown and flicks them
        name: 'flick',
        frames: frames(drawChandler, [{ lift: 0.5 }, { lift: 1 }, { lift: 1.6 }, { lift: 0.4, lean: 2 }, { lean: 2 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Censer smoke: the cloud swallows him
        name: 'censer',
        frames: frames(drawChandler, [{ smoke: 0.3, sway: 1 }, { smoke: 0.6 }, { smoke: 1, bob: 1 }, { smoke: 1.4, bob: 2 }, { smoke: 1.6, bob: 2 }, { smoke: 1 }, { smoke: 0.4 }]),
        timing: P7,
        loop: false,
      },
      {
        // The entrance: kneeling at the altar, he finishes his prayer and rises
        name: 'intro',
        frames: frames(drawChandler, [{ kneel: 1 }, { kneel: 1, hunch: 1 }, { kneel: 0.6 }, { kneel: 0.2 }, {}, { hunch: -1 }]),
        timing: [{ ticks: 30 }, { ticks: 30 }, { ticks: 20 }, { ticks: 20 }, { ticks: 20 }, { ticks: 40 }],
        loop: false,
      },
      {
        // His turn: hands over the altar fire, pouring out the wax he is made of
        name: 'pour',
        frames: frames(drawChandler, [{ reach: 1.5, drip: 1 }, { reach: 1.6, drip: 2, bob: 1 }, { reach: 1.5, drip: 3 }, { reach: 1.4, drip: 2, bob: 1 }]),
        timing: [{ ticks: 12 }, { ticks: 12 }, { ticks: 12 }, { ticks: 12 }],
        loop: true,
      },
      { name: 'stagger', frames: frames(drawChandler, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
    ],
    [0, 1, 2, 3, 4].map(f => (c: Img) => chandlerDeath(c, f)),
    CHANDLER_HAND,
  );

  rosterSheet(
    'chandler_wick',
    64,
    [32, 58],
    7,
    [
      { name: 'idle', frames: frames(drawCandleMan, [{ flare: 1 }, { flare: 1.4, bob: 1, sway: 1 }]), timing: [{ ticks: 10 }, { ticks: 10 }], loop: true },
      {
        name: 'walk',
        frames: walk4(drawCandleMan, f => ({ step: f, bob: f % 2 ? -1 : 0, lean: 1, sway: f === 1 ? 1 : f === 3 ? -1 : 0, flare: 1 + (f % 2) * 0.4 })),
        timing: walkT(7),
        loop: true,
      },
      {
        name: 'sweep',
        frames: frames(drawCandleMan, [{ sway: -2, lean: -2 }, { sway: -3, lean: -3 }, { sway: -3, lean: -3, bob: 1 }, { sway: 3, lean: 4, flare: 1.6 }, { sway: 2, lean: 3 }, { sway: 1, lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'jab',
        frames: frames(drawCandleMan, [{ lean: -1 }, { lean: -3, hunch: 1 }, { lean: -3, hunch: 1 }, { lean: 5, sway: -2 }, { lean: 4 }, { lean: 2 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'slam',
        frames: frames(drawCandleMan, [{ hunch: -1, bob: -2 }, { hunch: -2, bob: -3, flare: 2 }, { hunch: -2, bob: -3, flare: 2 }, { hunch: 2, bob: 2, lean: 3 }, { hunch: 2, bob: 3, lean: 3 }, { bob: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        name: 'leap',
        frames: frames(drawCandleMan, [{ bob: 3, hunch: 2 }, { bob: 4, hunch: 3 }, { bob: -7, hunch: -2, flare: 2.5 }, { bob: 4, hunch: 3, lean: 3 }, { bob: 3, hunch: 2, lean: 2 }, { bob: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Flame volley: the black flame on his head swells and flings burning wax
        name: 'volley',
        frames: frames(drawCandleMan, [{ flare: 1.5 }, { flare: 2, hunch: -1 }, { flare: 2.6, hunch: -2, bob: -1 }, { flare: 1, lean: 3, sway: 2 }, { flare: 1.2, lean: 2 }, { lean: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Wax flood: arms thrown wide, his wax running out across the floor
        name: 'flood',
        frames: frames(drawCandleMan, [{ spread: 0.5 }, { spread: 1 }, { spread: 1.5, bob: -1 }, { spread: 2, bob: -2, melt: 1, flare: 2 }, { spread: 2, melt: 1, flare: 2 }, { spread: 1, melt: 1 }, {}]),
        timing: P7,
        loop: false,
      },
      {
        // Rising out of the altar fire, arms opening
        name: 'intro',
        frames: frames(drawCandleMan, [{ rise: 26, flare: 2.5 }, { rise: 18, flare: 2.5 }, { rise: 10, flare: 2 }, { rise: 4, flare: 2 }, { spread: 1.5, flare: 3 }, { spread: 1, flare: 2 }]),
        timing: [{ ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 16 }, { ticks: 26 }, { ticks: 20 }],
        loop: false,
      },
      { name: 'stagger', frames: frames(drawCandleMan, [{ lean: -2, flinch: true }, { lean: -1, bob: 1, flinch: true }, { bob: 1 }]), timing: staggerT, loop: false },
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

  // ---- Nave decor (64x64, pivot 32,62)
  const W = 64;
  const H = 64;
  const B = 62;
  const cell = () => new Img(W, H);
  const deco: Img[] = [];
  // 0: the great altar (three tiles), its fire burning high in a black iron bowl
  {
    const c = cell();
    c.rect(9, B - 14, 46, 14, P.stone2); // the block
    c.hline(9, B - 1, 46, P.stone1);
    for (const x of [15, 27, 37, 49]) c.vline(x, B - 12, 10, P.stone1); // panels
    c.rect(8, B - 17, 48, 4, P.stone3); // top slab
    c.rect(22, B - 17, 20, 12, P.blood1); // altar cloth
    c.hline(22, B - 6, 20, P.flame1);
    c.vline(22, B - 17, 12, P.flame1);
    c.vline(41, B - 17, 12, P.flame1);
    for (const [x, l] of [[12, 6], [19, 9], [45, 7], [52, 5]]) c.vline(x, B - 14, l, P.wax1); // wax running down the front
    c.ellipse(32, B - 19, 8, 3, P.dark2); // the fire bowl
    c.hline(25, B - 18, 15, P.steel1);
    const r = rng(4242);
    for (let i = 0; i < 26; i++) {
      const x = 26 + Math.floor(r() * 13);
      const h = 4 + Math.floor(r() * (14 - Math.abs(x - 32) * 1.4));
      c.vline(x, B - 20 - h, h, i % 3 ? P.flame1 : P.flame2);
      c.set(x, B - 21 - h, P.flame2);
    }
    c.vline(32, B - 40, 8, P.flame2);
    for (const x of [12, 52]) {
      c.rect(x - 1, B - 22, 3, 5, P.wax2); // altar candles
      c.set(x, B - 23, P.flame2);
    }
    c.outline(P.ink);
    deco.push(c);
  }
  // 1: candelabrum, tall iron, three candles
  {
    const c = cell();
    c.vline(32, B - 30, 30, P.dark2);
    c.vline(31, B - 30, 30, P.steel1);
    c.hline(27, B - 1, 10, P.dark2); // feet
    c.hline(28, B - 2, 8, P.steel1);
    line(c, 26, B - 26, 38, B - 26, P.steel1); // the arms
    line(c, 26, B - 26, 26, B - 30, P.steel1);
    line(c, 38, B - 26, 38, B - 30, P.steel1);
    for (const [x, y] of [[26, 31], [32, 34], [38, 31]]) {
      c.rect(x - 1, B - y - 4, 2, 4, P.wax2);
      c.set(x - 1, B - y - 5, P.flame2);
      c.set(x - 1, B - y - 6, P.flame1);
      c.vline(x + 1, B - y + 1, 3, P.wax1); // drips
    }
    c.outline(P.ink);
    deco.push(c);
  }
  // 2, 3: a pew (anchor and west tile), whole or broken
  for (const broken of [false, true]) {
    const c = cell();
    const x0 = 9;
    const w = 31;
    if (!broken) {
      c.rect(x0, B - 16, w, 3, P.wood1); // backrest
      c.hline(x0, B - 16, w, P.wood2);
      c.rect(x0, B - 10, w, 4, P.wood2); // seat
      c.hline(x0, B - 7, w, P.wood1);
      for (const x of [x0, x0 + w - 2]) c.rect(x, B - 16, 2, 16, P.wood1); // ends
      c.rect(x0 + 13, B - 6, 2, 6, P.wood1);
    } else {
      line(c, x0, B - 14, x0 + 14, B - 10, P.wood1); // snapped backrest
      line(c, x0 + 17, B - 12, x0 + w, B - 17, P.wood1);
      c.rect(x0, B - 8, 12, 3, P.wood2);
      c.rect(x0 + 18, B - 9, w - 18, 3, P.wood2);
      for (const x of [x0, x0 + w - 2]) c.rect(x, B - 12, 2, 12, P.wood1);
      for (const [x, y] of [[x0 + 14, 2], [x0 + 16, 4], [x0 + 12, 1]]) c.rect(x, B - y, 2, 1, P.wood2); // splinters
    }
    c.outline(P.ink);
    deco.push(c);
  }
  // 4: the lift gate in the wall: a dark shaft behind iron bars, a chain going up
  {
    const c = cell();
    c.rect(24, B - 30, 17, 30, P.ink);
    c.rect(24, B - 32, 17, 2, P.steel1);
    for (let x = 25; x <= 39; x += 3) c.vline(x, B - 30, 30, P.steel1);
    c.hline(24, B - 16, 17, P.steel1);
    c.vline(32, B - 44, 12, P.dark2); // the chain
    for (let y = B - 44; y < B - 32; y += 2) c.set(32, y, P.steel2);
    c.outline(P.ink);
    deco.push(c);
  }
  const img = new Img(W * deco.length, H);
  deco.forEach((f, i) => img.blit(f, i * W, 0));
  sheet('decor_nave', img, { cell: [W, H], pivot: [32, B], layer: 'single' });
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
genChest();
genNpcs();
genTollwarden();
genWorks();
genMire();
genNave();
genFont();
console.log(
  ONLY
    ? `gen-art: wrote ${written} file(s) for ${ONLY.join(', ')}`
    : `gen-art: wrote ${written} file(s), skipped ${skipped} existing${skipped && !FORCE ? ' (use --force to overwrite)' : ''}`,
);
