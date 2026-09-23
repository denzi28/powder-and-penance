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
genTiles();
genFont();
console.log(`gen-art: wrote ${written} file(s), skipped ${skipped} existing${skipped && !FORCE ? ' (use --force to overwrite)' : ''}`);
