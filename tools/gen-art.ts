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

function drawTorso(c: Img, dir: Dir5, breath: number, pose: TorsoPose = 'idle') {
  if (pose === 'windup' || pose === 'windup2') breath = 1;
  if (pose === 'active' || pose === 'flinch' || pose === 'flinch2') breath = -1;
  // Cloak
  c.rect(12, 13, 8, 1, P.teal2);
  c.rect(11, 14, 10, 8, P.teal2);
  c.vline(11, 14, 7, P.teal3);
  c.vline(20, 14, 8, P.teal1);
  c.hline(11, 21, 10, P.teal1);
  if (pose === 'windup' || pose === 'windup2') {
    // cloak gathers: widen at the shoulders
    c.vline(10, 15, 4, P.teal2);
    c.vline(21, 15, 4, P.teal1);
  }
  if (pose === 'windup2') {
    // coiled deeper: the hem pulls in and the shoulders hunch
    c.vline(9, 16, 3, P.teal2);
    c.vline(22, 16, 3, P.teal1);
    c.hline(12, 21, 8, P.dark2);
  }
  if (pose === 'active') c.hline(10, 22, 12, P.teal1); // hem flares out with the swing
  if (pose === 'follow') {
    // follow-through: hem swirls to one side
    c.hline(12, 22, 11, P.teal1);
    c.set(22, 21, P.teal1);
    c.set(21, 20, P.teal2);
  }
  if (pose === 'flinch2') c.hline(10, 22, 4, P.teal1); // cloak snaps back
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
  const eye = pose === 'flinch' || pose === 'flinch2' ? P.ember : P.flame2;
  switch (dir) {
    case 'S':
      c.rect(13, hy + 3, 6, 3, P.ink);
      c.set(14, hy + 4, eye);
      c.set(17, hy + 4, eye);
      break;
    case 'SE':
      c.rect(14, hy + 3, 5, 3, P.ink);
      c.set(15, hy + 4, eye);
      c.set(18, hy + 4, eye);
      break;
    case 'E':
      c.rect(16, hy + 3, 4, 3, P.ink);
      c.set(18, hy + 4, eye);
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

/** Full-body collapse (legs layer hidden). Authored facing S only. */
function drawPlayerDeath(c: Img, f: number) {
  switch (f) {
    case 0:
      c.rect(12, 26, 3, 2, P.wood1);
      c.rect(17, 26, 3, 2, P.wood1);
      c.ellipse(16, 22.5, 6, 5, P.teal2);
      c.disc(16, 18, 3.5, P.teal1);
      c.set(15, 18, P.flame1);
      c.set(17, 18, P.flame1);
      break;
    case 1:
      c.ellipse(16, 24, 7, 4, P.teal2);
      c.disc(12, 21, 3, P.teal1);
      break;
    case 2:
      c.ellipse(16, 25, 8, 3, P.teal2);
      c.disc(10, 24, 3, P.teal1);
      c.set(21, 25, P.flame2);
      break;
    default:
      c.ellipse(16, 26, 9, 2.5, P.teal1);
      c.ellipse(15, 25.5, 6, 1.5, P.teal2);
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

function drawWickling(c: Img, dir: Dir5, pose: WickPose) {
  const o = { bob: 0, hunch: 0, flame: 0, sway: 0, lean: 0, ...pose };
  const b = o.bob;
  // Lean: head and shoulders shift toward the facing (positive) or away from it (negative, anticipation).
  const [fx, fy] = FACE_VEC[dir];
  const lx = Math.round(o.lean * fx);
  const ly = Math.round(o.lean * fy * 0.7);
  const shoulders = Math.round(o.lean * fx * 0.5);
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
    c.hline(x + sway, y + b, w, P.wood1);
    c.set(x + sway, y + b, P.wood2);
  }
  for (let x = 10; x < 22; x += 2) c.set(x + o.sway, 27 + b, P.dark2); // ragged hem
  c.vline(16 + shoulders, 19 + b, 6, P.dark2); // robe seam
  // Wax head, drooping
  const hx = 16 + (o.flinch ? -1 : 0) + lx;
  const hy = 13 + b + o.hunch + ly;
  c.disc(hx, hy, 3.6, P.wax1);
  c.set(hx - 2, hy - 2, P.wax2);
  c.set(hx - 1, hy - 3, P.wax2);
  c.set(hx - 3, hy + 3, P.wax1);
  c.set(hx + 3, hy + 2, P.wax1);
  const eye = o.flinch ? P.ember : P.blood2;
  if (dir === 'S') {
    c.set(hx - 2, hy, eye);
    c.set(hx + 1, hy, eye);
  } else if (dir === 'SE') {
    c.set(hx - 1, hy, eye);
    c.set(hx + 2, hy, eye);
  } else if (dir === 'E') c.set(hx + 2, hy, eye);
  // Candle stub + flame
  c.rect(hx - 1, hy - 6, 2, 3, P.wax2);
  c.set(hx, hy - 7, P.ink);
  c.set(hx + (o.flame ? -1 : 0), hy - 8, P.flame2);
  c.set(hx, hy - 9, o.flame ? P.flame2 : P.flame1);
  // Pale hand (weapon grip) — must match WICK_HAND
  const [ax, ay] = WICK_HAND[dir];
  c.rect(ax - 1, ay - 1 + b, 2, 2, P.wax1);
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
  const { lx, ly, sh } = leanOffsets(dir, o.lean);
  const [fx] = FACE_VEC[dir];
  const towerShield = (sx: number, sy: number, w: number) => {
    c.rect(sx, sy, w, 14, P.wood2);
    c.vline(sx, sy, 14, P.steel2);
    c.vline(sx + w - 1, sy, 14, P.steel2);
    c.hline(sx, sy, w, P.steel2);
    c.hline(sx, sy + 13, w, P.steel2);
    if (w >= 4) {
      c.rect(sx + Math.floor(w / 2) - 1, sy + 3, 2, 3, P.blood1);
      c.set(sx + Math.floor(w / 2), sy + 7, P.steel2);
    }
  };
  if (dir === 'N') towerShield(9, 13 + b, 3); // carried in front, mostly hidden by the body
  // Legs
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  c.rect(13, 22 + b, 2, 4 - liftL, P.stone2);
  c.rect(12, 26 - liftL, 3, 2, P.dark1);
  c.rect(17, 22 + b, 2, 4 - liftR, P.stone2);
  c.rect(17, 26 - liftR, 3, 2, P.dark1);
  // Torso plates
  c.rect(11 + sh, 13 + b, 10, 10, P.steel1);
  c.vline(11 + sh, 13 + b, 10, P.steel2);
  c.vline(20 + sh, 13 + b, 10, P.stone2);
  c.hline(11 + sh, 19 + b, 10, P.dark2);
  if (dir === 'S' || dir === 'SE') {
    c.rect(14 + sh + (dir === 'SE' ? 1 : 0), 14 + b, 4, 9, P.blood1);
    c.vline(14 + sh + (dir === 'SE' ? 1 : 0), 14 + b, 9, P.blood2);
  } else if (dir === 'E') c.rect(17 + sh, 14 + b, 3, 9, P.blood1);
  else for (const y of [15, 17]) c.hline(12 + sh, y + b, 8, P.stone2);
  // Helm with crest; cold cyan eyes behind the visor slit
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 5 + b + o.hunch + ly;
  c.rect(hx - 3, hy, 6, 1, P.steel1);
  c.rect(hx - 4, hy + 1, 8, 7, P.steel1);
  c.hline(hx - 3, hy + 1, 3, P.steel2);
  c.rect(hx - 1, hy - 2, 2, 2, P.ember);
  const eye = o.flinch ? P.ember : P.cyan;
  if (dir === 'S') {
    c.hline(hx - 3, hy + 4, 6, P.ink);
    c.set(hx - 2, hy + 4, eye);
    c.set(hx + 1, hy + 4, eye);
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
  c.rect(ax - 1, ay - 1 + b, 2, 2, P.steel2);
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
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  c.rect(13, 25 - liftL + b, 2, 2, P.dark1);
  c.rect(17, 25 - liftR + b, 2, 2, P.dark1);
  for (let y = 13; y <= 25; y++) {
    const w = 6 + Math.floor((y - 13) / 2);
    const x = 16 - Math.floor(w / 2) + (y < 19 ? sh : 0);
    c.hline(x, y + b, w, P.dark2);
    c.set(x, y + b, P.stone1);
  }
  // Ember sash + bandolier of tiny pots
  for (let i = 0; i < 5; i++) c.set(12 + i * 2 + sh, 15 + i + b, dir === 'N' ? P.dark1 : P.flame1);
  c.hline(11 + sh, 20 + b, 10, P.ember);
  // Hood and porcelain mask
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 6 + b + o.hunch + ly;
  c.disc(hx, hy + 3, 4, P.dark1);
  c.set(hx, hy - 2, P.dark1);
  if (dir !== 'N' && dir !== 'NE') {
    const mx = dir === 'S' ? hx - 2 : dir === 'SE' ? hx - 1 : hx;
    c.rect(mx, hy + 2, dir === 'E' ? 3 : 4, 4, P.wax2);
    c.set(mx + 1, hy + 3, o.flinch ? P.ember : P.ink);
    if (dir !== 'E') c.set(mx + 3, hy + 3, o.flinch ? P.ember : P.ink);
  }
  // The pot in hand
  const pot = (px: number, py: number) => {
    c.rect(px - 1, py - 1, 3, 3, P.wood2);
    c.set(px - 1, py, P.wood1);
    c.set(px, py - 2, P.flame2); // lit fuse
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
  const candle = (x: number, y: number) => {
    c.rect(x, y, 2, 4, P.wax2);
    c.set(x, y - 1, P.flame2);
    c.set(x + 1, y - 2, P.flame1);
  };
  const eye = o.flinch ? P.wax2 : P.ember;
  if (dir === 'S' || dir === 'N') {
    const legs = [13, 18];
    legs.forEach((x, i) => c.rect(x, 22 + cr, 2, 5 - cr - (o.step === (i ? 3 : 1) ? 1 : 0), P.dark1));
    c.ellipse(16, 20 + cr, 5, 3.5, P.dark1);
    if (dir === 'S') {
      c.disc(16, 16 + cr + (o.head > 0 ? 2 : 0), 3.5, P.dark1);
      c.set(14, 13 + cr, P.dark1);
      c.set(18, 13 + cr, P.dark1);
      c.set(14, 15 + cr, eye);
      c.set(17, 15 + cr, eye);
      c.rect(15, 18 + cr + (o.head > 0 ? 2 : 0), 2, 2, P.stone1);
      c.set(15, 19 + cr + (o.head > 0 ? 2 : 0), P.ink);
      if (o.head > 1) c.hline(14, 21 + cr, 4, P.wax2); // bared teeth
    } else {
      c.vline(16, 23 + cr, 3, P.dark1); // tail
      c.disc(16, 16 + cr, 3, P.dark1);
    }
    candle(15, 12 + cr);
    return;
  }
  // Side views (E / SE / NE), facing right.
  const s = o.stretch;
  const bodyX = 15;
  const bodyY = 20 + cr;
  c.ellipse(bodyX, bodyY, 7 + s, 3, P.dark1);
  c.hline(bodyX - 5, bodyY - 2, 9 + s, P.stone1);
  // Legs: back pair and front pair, alternating stride
  const stride = o.step === 1 ? 1 : o.step === 3 ? -1 : 0;
  const legTop = bodyY + 2;
  const legLen = Math.max(2, 27 - legTop);
  for (const [x, d] of [[bodyX - 5 - Math.max(0, s), stride], [bodyX - 3 - Math.max(0, s), -stride], [bodyX + 4 + s, -stride], [bodyX + 6 + s, stride]] as const)
    c.vline(x + d, legTop, s > 1 ? legLen - 2 : legLen, P.dark1);
  c.set(bodyX - 8 - s, bodyY - 2, P.dark1); // tail
  c.set(bodyX - 9 - s, bodyY - 3, P.dark1);
  // Head + snout
  const hx = bodyX + 8 + s + o.head;
  const hy = bodyY - 3 + (dir === 'NE' ? -1 : 0) + (o.head < 0 ? 1 : 0);
  c.disc(hx, hy, 2.6, P.dark1);
  c.rect(hx + 2, hy, 3, 2, P.dark1);
  c.set(hx + 4, hy, P.ink);
  c.set(hx - 1, hy - 3, P.dark1); // ear
  c.set(hx + 1, hy - 1, eye);
  if (o.head > 1) c.hline(hx + 2, hy + 2, 3, P.wax2); // open jaws
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
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  // Legs
  c.rect(16, 34 + b, 6, 7 - liftL, P.dark2);
  c.rect(15, 41 - liftL, 7, 3, P.dark1);
  c.rect(26, 34 + b, 6, 7 - liftR, P.dark2);
  c.rect(26, 41 - liftR, 7, 3, P.dark1);
  // Barrel chest, leather apron, huge arms
  c.ellipse(24 + sh, 26 + b, 12, 10, P.wax1);
  c.ellipse(20 + sh, 23 + b, 5, 4, P.wax2);
  c.rect(17 + sh, 29 + b, 14, 7, P.wood1);
  c.hline(17 + sh, 29 + b, 14, P.wood2);
  c.ellipse(11 + sh + o.sway, 28 + b, 3.5, 7, P.wax1);
  c.ellipse(37 + sh + o.sway, 28 + b, 3.5, 7, P.wax1);
  // Bronze bell helm
  const hx = 24 + lx + (o.flinch ? -2 : 0);
  const top = 6 + b + o.hunch + ly;
  for (let y = 0; y <= 13; y++) {
    const half = Math.round(4 + y * 0.45);
    c.hline(hx - half, top + y, half * 2, P.flame1);
    c.set(hx - half, top + y, P.flame2);
    c.set(hx + half - 1, top + y, P.ember);
  }
  c.hline(hx - 10, top + 14, 20, P.dark2); // rim
  c.rect(hx - 1, top - 2, 2, 2, P.ember); // crown loop
  if (dir !== 'N' && dir !== 'NE') {
    const sx = dir === 'S' ? hx - 3 : dir === 'SE' ? hx - 1 : hx + 2;
    c.hline(sx, top + 10, dir === 'E' ? 4 : 6, P.ink);
    c.set(sx + 1, top + 10, o.flinch ? P.wax2 : P.flame2);
    if (dir !== 'E') c.set(sx + 4, top + 10, o.flinch ? P.wax2 : P.flame2);
  }
  const [ax, ay] = BRUTE_HAND[dir];
  c.rect(ax - 2, ay - 2 + b, 4, 4, P.wax1);
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
  const liftL = o.step === 1 ? 2 : 0;
  const liftR = o.step === 3 ? 2 : 0;
  c.rect(13, 22 + b, 2, 5 - liftL, P.dark2); // thin legs
  c.rect(12, 27 - liftL, 3, 1, P.dark1);
  c.rect(17, 22 + b, 2, 5 - liftR, P.dark2);
  c.rect(17, 27 - liftR, 3, 1, P.dark1);
  c.rect(12 + sh, 12 + b, 8, 11, P.stone1); // tall narrow body
  c.rect(13 + sh, 14 + b, 6, 9, P.wood2); // leather apron, stained
  c.set(15 + sh, 17 + b, P.wax1);
  c.set(16 + sh, 20 + b, P.wax1);
  c.rect(10 + sh + o.sway, 13 + b, 2, 8, P.stone1); // long arms
  c.rect(20 + sh + o.sway, 13 + b, 2, 8, P.stone1);
  const hx = 16 + lx + (o.flinch ? -1 : 0);
  const hy = 4 + b + o.hunch + ly;
  c.rect(hx - 3, hy, 6, 8, P.dark2); // hood
  c.rect(hx - 2, hy - 1, 4, 1, P.dark2);
  if (dir !== 'N' && dir !== 'NE') {
    const fx = dir === 'S' ? hx - 2 : dir === 'SE' ? hx - 1 : hx;
    c.rect(fx, hy + 3, dir === 'E' ? 3 : 4, 3, P.wax1); // pale face, a mouth-cloth
    c.hline(fx, hy + 5, dir === 'E' ? 3 : 4, P.stone3);
    c.set(fx + 1, hy + 3, o.flinch ? P.ember : P.ink);
    if (dir !== 'E') c.set(fx + 3, hy + 3, o.flinch ? P.ember : P.ink);
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
  c.ellipse(cx, cy + h * 0.4, w, h, P.wax1);
  c.ellipse(cx - w * 0.3, cy, w * 0.5, h * 0.6, P.wax2);
  for (const d of [-0.6, 0.1, 0.7]) c.vline(Math.round(cx + w * d), Math.round(cy + h * 0.9), 2, P.wax1); // drips
  c.set(Math.round(cx - 2 * s), Math.round(cy), o.flinch ? P.ember : P.ink); // sunken eyes
  c.set(Math.round(cx + 2 * s), Math.round(cy), o.flinch ? P.ember : P.ink);
  c.vline(Math.round(cx + 1), Math.round(cy - h - 1), 2, P.dark2); // wick
  if (!o.flinch) c.set(Math.round(cx + 1), Math.round(cy - h - 2), P.flame2);
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

function genWorks() {
  const T = 16;
  // ---- tileset: soot-black flagstones, iron grates, tallow spills, soot brick walls with iron tops
  const img = new Img(T * 8, T * 4);
  const at = (idx: number) => [(idx % 8) * T, Math.floor(idx / 8) * T] as const;
  const speck = (ox: number, oy: number, r: () => number, n: number, col: RGBA) => {
    for (let i = 0; i < n; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), col);
  };
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(v);
    const r = rng(3000 + v);
    img.rect(ox, oy, T, T, P.stone1);
    img.hline(ox, oy + 15, T, P.dark1);
    img.vline(ox + 15, oy, T, P.dark1);
    if (v % 2) img.vline(ox + 7, oy, 15, P.dark1);
    speck(ox, oy, r, 12, P.dark2);
    speck(ox, oy, r, 4, P.ink);
    if (v === 3) img.ellipse(ox + 8, oy + 8, 4, 2, P.dark2); // soot stain
  }
  for (const v of [4, 5]) {
    // iron grate over a dark drain
    const [ox, oy] = at(v);
    img.rect(ox, oy, T, T, P.ink);
    for (let x = 1; x < T; x += 4) img.vline(ox + x, oy, T, P.steel1);
    img.hline(ox, oy, T, P.stone2);
    img.hline(ox, oy + 8, T, P.stone2);
    if (v === 5) img.set(ox + 6, oy + 11, P.ember); // a glow from below
  }
  for (const idx of [6, 7]) {
    const [ox, oy] = at(idx);
    const r = rng(3100 + idx);
    img.rect(ox, oy, T, T, P.ink);
    speck(ox, oy, r, 6, P.dark1);
    if (idx === 7) img.set(ox + 9, oy + 5, P.ember);
  }
  for (const [idx, v] of [[8, 0], [9, 1]]) {
    // soot brick
    const [ox, oy] = at(idx);
    const r = rng(3200 + idx);
    img.rect(ox, oy, T, T, P.wood1);
    for (const y of [3, 7, 11]) img.hline(ox, oy + y, T, P.dark2);
    for (const [x, y, h] of [[5, 0, 3], [13, 0, 3], [1, 4, 3], [9, 4, 3], [5, 8, 3], [13, 8, 3]]) img.vline(ox + x + v * 2, oy + y, h, P.dark2);
    speck(ox, oy, r, 6, P.dark1);
    speck(ox, oy, r, 2, P.ember);
    img.hline(ox, oy, T, P.steel1);
    img.rect(ox, oy + 13, T, 3, P.dark1);
  }
  for (const v of [10, 11]) {
    // tallow spilled on the stones: a flat, faint, greasy sheen across the whole tile (no blob shapes, which
    // would read as Vat Crawlers)
    const [ox, oy] = at(v);
    const r = rng(3300 + v);
    const mix = (a: RGBA, b: RGBA, k: number): RGBA => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k)).concat(255) as unknown as RGBA;
    img.rect(ox, oy, T, T, mix(P.stone1, P.wax1, 0.28));
    img.hline(ox, oy + 15, T, mix(P.stone1, P.dark1, 0.6));
    speck(ox, oy, r, 7, mix(P.stone1, P.wax2, 0.5)); // glints of grease (dots, so big spills don't stripe)
    speck(ox, oy, r, 5, P.dark2);
  }
  for (const v of [12, 13]) {
    const [ox, oy] = at(v);
    const r = rng(3400 + v);
    img.rect(ox, oy, T, T, P.wood1);
    for (const y of [0, 4, 8, 12]) img.hline(ox, oy + y, T, P.dark2);
    speck(ox, oy, r, 5, P.wood2);
  }
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(3500 + mask);
    img.rect(ox, oy, T, T, P.dark1);
    speck(ox, oy, r, 5, P.ink);
    if (mask & 1) img.hline(ox, oy, T, P.steel1);
    if (mask & 2) img.vline(ox + 15, oy, T, P.steel1);
    if (mask & 4) {
      img.hline(ox, oy + 14, T, P.steel1);
      img.hline(ox, oy + 15, T, P.stone1);
      for (const x of [3, 11]) img.set(ox + x, oy + 14, P.ember); // rivets
    }
    if (mask & 8) img.vline(ox, oy, T, P.steel1);
  }
  sheet('tiles_works', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 0, 1, 1, 2, 3],
      floor_grate: [4, 4, 5],
      floor_grease: [10, 11],
      floor_plank: [12, 13],
      wall_front: [8, 8, 9],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [6, 6, 7],
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

  // ---- weapons and projectiles
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

  // Rock: the solid mass outside every room (indices 6, 7). Darker than wall caps, faintly textured.
  for (const idx of [6, 7]) {
    const [ox, oy] = at(idx);
    const r = rng(500 + idx);
    img.rect(ox, oy, T, T, P.ink);
    for (let i = 0; i < 10; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), P.dark1);
    for (let i = 0; i < 3; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), P.dark2);
  }

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
      rock: [6, 6, 6, 7],
    },
  });
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
function drawPortrait(c: Img, who: 'oskar' | 'maudlin' | 'pip' | 'tollwarden') {
  c.rect(0, 0, 32, 32, P.dark1);
  if (who === 'tollwarden') {
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
  const who = ['oskar', 'maudlin', 'pip', 'tollwarden'] as const;
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
  const img = new Img(T * 8, T * 4);
  const at = (idx: number) => [(idx % 8) * T, Math.floor(idx / 8) * T] as const;
  const speck = (ox: number, oy: number, r: () => number, n: number, c: RGBA) => {
    for (let i = 0; i < n; i++) img.set(ox + Math.floor(r() * 16), oy + Math.floor(r() * 16), c);
  };

  // 0-3 dirt
  for (let v = 0; v < 4; v++) {
    const [ox, oy] = at(v);
    const r = rng(2000 + v);
    img.rect(ox, oy, T, T, P.wood1);
    speck(ox, oy, r, 14, P.dark2);
    speck(ox, oy, r, 8, P.wood2);
    if (v === 2) for (const [x, y] of [[4, 6], [5, 6], [11, 11]]) img.rect(ox + x, oy + y, 2, 1, P.stone2); // pebbles
    if (v === 3) img.ellipse(ox + 8, oy + 9, 3, 1.5, P.dark2); // puddle stain
  }
  // 4-5 grass
  for (const v of [4, 5]) {
    const [ox, oy] = at(v);
    const r = rng(2100 + v);
    img.rect(ox, oy, T, T, P.moss1);
    speck(ox, oy, r, 10, P.teal1);
    for (let i = 0; i < 9; i++) {
      const x = ox + Math.floor(r() * 15);
      const y = oy + 1 + Math.floor(r() * 14);
      img.set(x, y, P.moss2);
      img.set(x + 1, y - 1, P.moss2);
    }
    if (v === 5) for (const [x, y] of [[5, 5], [11, 10]]) img.set(ox + x, oy + y, P.wax1); // tiny flowers
  }
  // 6-7 forest outside the ravine: near-black canopy
  for (const idx of [6, 7]) {
    const [ox, oy] = at(idx);
    const r = rng(2200 + idx);
    img.rect(ox, oy, T, T, P.ink);
    for (let i = 0; i < 3; i++) img.ellipse(ox + 2 + r() * 12, oy + 2 + r() * 12, 2 + r() * 2, 1.5 + r(), P.teal1);
    speck(ox, oy, r, 4, P.dark1);
  }
  // 8-9 cliff face: layered earth with roots, grass lip on top
  for (const [idx, v] of [[8, 0], [9, 1]]) {
    const [ox, oy] = at(idx);
    const r = rng(2300 + idx);
    img.rect(ox, oy, T, T, P.wood1);
    img.rect(ox, oy + 5, T, 3, P.dark2);
    img.rect(ox, oy + 10, T, 2, P.dark2);
    speck(ox, oy, r, 8, P.wood2);
    img.hline(ox, oy, T, P.moss2);
    for (let x = 0; x < T; x += 3) img.set(ox + x + (v ? 1 : 0), oy + 1, P.moss1); // grass hanging over the lip
    if (v === 1) line(img, ox + 4, oy + 2, ox + 6, oy + 9, P.dark1); // root
    img.hline(ox, oy + 13, T, P.dark2);
    img.rect(ox, oy + 14, T, 2, P.dark1);
  }
  // 10-11 cart road: packed lighter earth with two wheel ruts
  for (const v of [10, 11]) {
    const [ox, oy] = at(v);
    const r = rng(2400 + v);
    img.rect(ox, oy, T, T, P.wood2);
    speck(ox, oy, r, 10, P.wood1);
    img.hline(ox, oy + 4, T, P.wood1);
    img.hline(ox, oy + 11, T, P.wood1);
    if (v === 11) img.set(ox + 7, oy + 8, P.stone3);
  }
  // 12-13 wooden planks (inside buildings)
  for (const v of [12, 13]) {
    const [ox, oy] = at(v);
    const r = rng(2600 + v);
    img.rect(ox, oy, T, T, P.wood2);
    for (const y of [0, 4, 8, 12]) img.hline(ox, oy + y, T, P.wood1);
    for (const [x, y] of [[5, 1], [12, 5], [3, 9], [9, 13]]) img.vline(ox + x + (v === 13 ? 2 : 0), oy + y, 3, P.wood1);
    speck(ox, oy, r, 4, P.dark2);
  }
  // 14-15 flagstones (chapel floor)
  for (const v of [14, 15]) {
    const [ox, oy] = at(v);
    const r = rng(2700 + v);
    img.rect(ox, oy, T, T, P.stone2);
    img.hline(ox, oy + 7, T, P.stone1);
    img.hline(ox, oy + 15, T, P.stone1);
    img.vline(ox + (v === 14 ? 6 : 10), oy, 7, P.stone1);
    img.vline(ox + (v === 14 ? 11 : 3), oy + 8, 7, P.stone1);
    speck(ox, oy, r, 6, P.stone3);
  }
  // 16-31 cliff tops: dark brush and treetops (clearly not walkable), rim = grass edge on open sides
  for (let mask = 0; mask < 16; mask++) {
    const [ox, oy] = at(16 + mask);
    const r = rng(2500 + mask);
    img.rect(ox, oy, T, T, P.dark1);
    for (let i = 0; i < 4; i++) {
      const cx = ox + 2 + r() * 12;
      const cy = oy + 2 + r() * 12;
      img.ellipse(cx, cy, 2.5 + r() * 2, 2 + r() * 1.5, P.teal1);
      img.set(cx - 1, cy - 1, P.moss1);
    }
    speck(ox, oy, r, 3, P.moss1);
    if (mask & 1) img.hline(ox, oy, T, P.moss2);
    if (mask & 2) img.vline(ox + 15, oy, T, P.moss2);
    if (mask & 4) {
      img.hline(ox, oy + 14, T, P.moss2);
      img.hline(ox, oy + 15, T, P.dark2);
    }
    if (mask & 8) img.vline(ox, oy, T, P.moss2);
  }

  sheet('tiles_road', img, {
    cell: [T, T],
    pivot: [0, 0],
    layer: 'tiles',
    tiles: {
      floor: [0, 0, 0, 0, 1, 1, 2, 3],
      floor_grass: [4, 4, 5],
      floor_road: [10, 10, 10, 11],
      floor_plank: [12, 12, 13],
      floor_stone: [14, 15],
      wall_front: [8, 8, 9],
      wall_cap: Array.from({ length: 16 }, (_, i) => 16 + i),
      rock: [6, 6, 7],
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
genFont();
console.log(`gen-art: wrote ${written} file(s), skipped ${skipped} existing${skipped && !FORCE ? ' (use --force to overwrite)' : ''}`);
