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

// ---------------------------------------------------------------- NPCs (32x32, pivot 16,28) and portraits (32x32)
// NPC frames: 0-1 idle (breathing), 2-3 talking (mouth open / closed). Skin is pale wax: everyone here is
// half a candle already.




/** Head-and-shoulders portraits for the dialogue box, drawn at double detail. */
function drawPortrait(c: Img, who: 'oskar' | 'maudlin' | 'pip' | 'tollwarden' | 'matron' | 'chandler' | 'tomas' | 'hedda' | 'bede' | 'agnes' | 'ulla' | 'jost') {
  c.rect(0, 0, 32, 32, P.dark1);
  const skin = mix(P.wax1, P.wood2, 0.35);
  const oldSkin = mix(P.wax1, P.stone3, 0.3);
  const face = (x: number, y: number, w: number, h: number, col: RGBA) => {
    c.rect(x, y, w, h, col);
    c.vline(x, y, h, mix(col, P.wax2, 0.35));
    c.vline(x + w - 1, y, h, mix(col, P.wood1, 0.35));
    c.hline(x + 2, y + Math.floor(h * 0.4), 3, P.ink);
    c.hline(x + w - 5, y + Math.floor(h * 0.4), 3, P.ink);
    c.rect(x + Math.floor(w / 2) - 1, y + Math.floor(h * 0.45), 2, 3, mix(col, P.wood1, 0.3));
  };
  if (who === 'tomas') {
    // the lamplighter: an old face, a white beard, a cap pulled low; a spark of his flame
    c.rect(3, 24, 26, 8, mix(P.moss1, P.stone1, 0.5));
    face(9, 8, 14, 15, oldSkin);
    for (let y = 16; y < 25; y++) c.hline(10 + Math.floor((y - 16) / 3), y, 12 - Math.floor((y - 16) / 3) * 2, P.stone4); // beard
    c.hline(12, 17, 8, P.stone3); // moustache
    c.rect(7, 4, 18, 5, P.dark2); // cap
    c.hline(6, 8, 21, P.dark1); // brim
    c.set(26, 3, P.flame2);
    c.set(27, 2, P.flame1);
  } else if (who === 'hedda') {
    // the water-carrier: a red kerchief, a broad kind face, strong shoulders under the yoke
    c.rect(2, 24, 28, 8, mix(P.teal1, P.stone2, 0.5));
    c.hline(0, 23, 32, P.wood2); // the yoke
    c.hline(0, 24, 32, P.wood1);
    face(9, 8, 14, 15, skin);
    c.hline(13, 19, 6, P.blood1); // a wide mouth
    c.rect(7, 3, 18, 6, P.blood2); // kerchief
    c.hline(8, 3, 16, mix(P.blood2, P.white, 0.3));
    c.rect(24, 8, 3, 4, P.blood2); // its knot
  } else if (who === 'bede') {
    // the woodcutter: broad and bearded, brown hair, an axe haft over his shoulder
    c.rect(1, 24, 30, 8, P.moss1);
    line(c, 24, 31, 30, 14, P.wood2);
    c.rect(27, 11, 4, 4, EN.steel2);
    face(8, 7, 16, 16, skin);
    c.rect(8, 16, 16, 8, P.wood1); // beard
    c.hline(12, 16, 8, mix(P.wood1, P.dark2, 0.4));
    c.rect(7, 3, 18, 5, P.wood1); // hair
    c.vline(7, 3, 8, P.wood1);
  } else if (who === 'agnes') {
    // the old pilgrim: a black shawl, a lined face, eyes half closed, her beads
    c.rect(3, 22, 26, 10, P.dark1);
    c.rect(5, 2, 22, 22, P.dark2); // shawl
    face(10, 8, 12, 14, oldSkin);
    c.hline(12, 11, 3, oldSkin); // lids lowered
    c.hline(17, 11, 3, oldSkin);
    c.hline(12, 12, 3, P.ink);
    c.hline(17, 12, 3, P.ink);
    for (const y of [15, 18]) c.hline(11, y, 2, mix(oldSkin, P.wood1, 0.4)); // lines
    for (let x = 10; x < 23; x += 2) c.set(x, 27 + ((x / 2) % 2), P.wood2); // prayer beads
  } else if (who === 'ulla') {
    // the pilgrim wife: a moss-green kerchief, soot on her cheek, a brown shawl
    c.rect(3, 24, 26, 8, mix(P.wood1, P.stone2, 0.4));
    face(9, 8, 14, 15, skin);
    c.set(19, 16, P.dark2); // soot
    c.hline(13, 19, 6, mix(skin, P.blood1, 0.5));
    c.rect(7, 3, 18, 6, mix(P.moss1, P.stone2, 0.4));
    c.hline(8, 3, 16, mix(P.moss2, P.wax1, 0.3));
  } else if (who === 'jost') {
    // the old pilgrim: a brown hood, a white beard, a scallop badge
    c.rect(3, 24, 26, 8, P.stone2);
    c.rect(5, 2, 22, 22, mix(P.wood1, P.stone2, 0.3)); // hood
    face(10, 8, 12, 14, oldSkin);
    for (let y = 16; y < 24; y++) c.hline(11 + Math.floor((y - 16) / 3), y, 10 - Math.floor((y - 16) / 3) * 2, mix(P.stone4, P.wax1, 0.3));
    c.rect(6, 26, 3, 3, P.wax2); // scallop
  } else if (who === 'chandler') {
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
  genTownsfolk();
  const who = ['oskar', 'maudlin', 'pip', 'tollwarden', 'matron', 'chandler', 'tomas', 'hedda', 'bede', 'agnes', 'ulla', 'jost'] as const;
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
  const shadeAt = (t: number, r: { c0: RGBA; c1: RGBA; c2: RGBA; c3: RGBA }) => (t < 0.1 ? r.c3 : t < 0.2 ? mix(r.c2, r.c3, 0.5) : t > 0.92 ? r.c0 : t > 0.78 ? r.c1 : r.c2);
  // Red under-robe: a long bell to the floor, pooled wide when he kneels; the hem swings as he walks.
  for (let y = top; y <= hem; y++) {
    const k = (y - top) / Math.max(1, hem - top);
    const half = Math.round(5 + k * (7 + o.kneel * 5));
    const swing = y > hem - 6 && o.step >= 0 ? (o.step % 2 ? 1 : -1) : 0;
    const x0 = cx - half + swing;
    for (let x = x0; x <= x0 + half * 2; x++) c.set(x, y, y >= hem - 1 ? (y === hem ? gold0 : P.flame1) : shadeAt((x - x0) / (half * 2), red));
  }
  for (const x of [-5, 4]) line(c, cx + x, top + 26, cx + x * 1.6, hem - 2, red.c1); // folds of the under-robe
  // Cream chasuble over it, to the knees, edged in gold
  const chasBot = Math.min(hem - 5, top + 25);
  for (let y = top; y <= chasBot; y++) {
    const k = (y - top) / Math.max(1, chasBot - top);
    const half = Math.round(6 + k * 4);
    for (let x = cx - half; x <= cx + half; x++) c.set(x, y, shadeAt((x - cx + half) / (half * 2), cream));
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
  const glow = mix(P.wax2, P.flame1, 0.45); // the light inside him, showing through the wax
  // His own wax, pooling where he stands
  c.ellipse(32, 57.5, 12 + o.melt * 4, 3.5 + o.melt * 0.5, W.w0);
  c.ellipse(32, 57, 11 + o.melt * 4, 3 + o.melt * 0.5, W.w2);
  c.ellipse(28, 56.5, 5, 1.2, W.w3);
  // The column of his body: wax lit from inside, brightest down the middle (he has been melting: shorter than he was)
  const top = 28 + b;
  for (let y = top; y <= 56; y++) {
    const k = (y - top) / Math.max(1, 56 - top);
    const half = Math.round(7 + k * 3 + (y > 50 ? (y - 50) * 0.6 : 0));
    for (let x = cx - half; x <= cx + half; x++) {
      const t = (x - cx + half) / (half * 2);
      const col = t < 0.12 ? W.w3 : t > 0.88 ? W.w0 : t > 0.72 ? W.w1 : Math.abs(t - 0.45) < 0.14 && !back ? glow : W.w2;
      c.set(x, y, col);
    }
  }
  for (const [x, y, l] of [[-8, 8, 4], [7, 12, 5], [-5, 18, 3], [9, 20, 4]]) if (top + y < 56) {
    c.vline(cx + x, top + y, l, W.w3); // drips
    c.set(cx + x, top + y + l, W.w1);
  }
  // Rags of burnt vestment at the hips: red gone black at the edges, a scrap of gold
  const rag = rng(77);
  for (let x = -9; x <= 9; x++) {
    if (top + 14 >= 56) break;
    const l = Math.min(3 + Math.floor(rag() * 5), 56 - top - 14);
    c.vline(cx + x, top + 14, l, x % 3 === 0 ? P.blood1 : x % 3 === 1 ? mix(P.blood1, P.dark1, 0.6) : P.dark2);
    c.set(cx + x, top + 14 + l - 1, P.ink); // burnt edge
  }
  c.hline(cx - 9, top + 14, 19, mix(P.flame1, P.dark1, 0.5)); // what is left of the gold hem
  // Fire licking up one flank, and cracks glowing through the wax
  const fl = rng(31 + (o.sway + 3) * 7 + o.bob * 3 + o.flick * 11);
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
    for (const [x0, y0, x1, y1] of [[-3, 5, 1, 9], [1, 9, -1, 13], [3, 17, 5, 22], [-6, 20, -4, 25]]) {
      if (top + y1 >= 55) continue;
      line(c, cx + x0, top + y0, cx + x1, top + y1, P.ember);
      line(c, cx + x0 + 1, top + y0, cx + x1 + 1, top + y1, (x0 + o.flick) % 2 ? P.flame1 : P.flame2); // the crack's hot lip
    }
  // Arms of wax (spread = raised wide). The right hand holds the snuffer unless spread.
  const armY = top + 2;
  for (const side of [-1, 1]) {
    const held = side === 1 && !o.spread;
    const [chx, chy] = candleHand(dir, o);
    const hx2 = held ? chx : Math.round(cx + side * (11 + o.spread * 5));
    const hy2 = Math.min(53, held ? chy : Math.round(armY + 15 - o.spread * 12)); // sunk in: arms stay above the pool
    if (armY > 52) continue;
    for (let t = -1; t <= 1; t++) line(c, cx + side * 7, armY + t, hx2, hy2 + t, t < 0 ? W.w3 : t > 0 ? W.w1 : W.w2);
    c.disc(hx2, hy2, 1.8, W.w2);
    c.set(hx2 - 1, hy2 - 1, W.w3);
    c.vline(hx2, hy2 + 2, 2 + (o.spread ? 2 : 0), W.w2); // dripping off his fingers
    c.set(hx2, hy2 + 4 + (o.spread ? 2 : 0), W.w1);
  }
  // Head: melted to one side, one ember eye left
  const hx = 32 + lx + (o.flinch ? -2 : 0);
  const hy = 18 + b + o.hunch + ly;
  c.ellipse(hx, hy + 2, 5, 6, W.w1);
  c.ellipse(hx - 1, hy + 1, 3.5, 4.5, W.w2);
  c.set(hx - 3, hy - 2, W.w3);
  c.ellipse(hx + 2, hy + 7, 3, 2, W.w1);
  c.hline(hx + 1, hy + 9, 3, W.w0);
  if (!back) {
    const f0 = dir === 'S' ? hx : dir === 'SE' ? hx + 1 : hx + 2;
    c.rect(f0 - 3, hy + 1, 2, 2, P.ink);
    c.set(f0 - 3, hy + 1, o.flinch ? P.wax2 : P.flame2);
    c.set(f0 - 2, hy + 2, o.flinch ? P.wax2 : P.ember);
    c.hline(f0 + 1, hy + 2, 2, W.w3); // the other eye, melted shut
    c.hline(f0 + 1, hy + 3, 2, W.w0);
    c.hline(f0 - 1, hy + 5, 3, o.flinch ? P.ember : P.dark2);
  }
  // The wick, and its black flame
  c.vline(hx, hy - 6, 3, P.ink);
  if (!o.out) blackFlame(c, hx, hy - 6, o.flare + o.flick * 0.3, o.sway);
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
    drawVillager(c, s, f);
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
genWorksDecor();
genMireDecor();
genNaveDecor();
genAbbeyDecor();
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
