// Dialogue portraits, 48x48, painted rather than stamped: every form (heads, hair, hoods, shoulders) is shaded as
// a lit volume (key light from the upper left, a warm candle rim on the right), quantised to short hue-shifted
// ramps with a touch of ordered dithering, then given a selective outline. Each character is a set of
// parameters for one painter (skin, age, eyes, mouth, hair, beard, headwear, clothes) plus a few strokes of
// their own (the Tollwarden's helmet, the Chandler's crown of tapers, the Matron's veil...).
import fs from 'node:fs';
import path from 'node:path';

export type RGBA = readonly [number, number, number, number];
const ROOT = path.resolve(import.meta.dirname, '..');
const hexes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/palette.json'), 'utf8')) as Record<string, string>;
const P = Object.fromEntries(
  Object.entries(hexes).map(([k, h]) => [k, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).concat(255) as unknown as RGBA]),
) as Record<string, RGBA>;
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)).concat(255) as unknown as RGBA;

export const PORTRAIT = 48;
const S = PORTRAIT;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.47);
const LIGHT = (() => {
  const v = [-0.55, -0.62, 0.56];
  const l = Math.hypot(...v);
  return v.map(x => x / l);
})();

/** Five tones from deep shadow to highlight, shadows cooled toward violet, lights warmed toward wax. */
export function ramp(base: RGBA, warm = P.wax2): RGBA[] {
  return [mix(base, mix(P.ink, P.blood1, 0.25), 0.55), mix(base, mix(P.dark2, P.blood1, 0.3), 0.32), base, mix(base, warm, 0.3), mix(base, warm, 0.6)];
}

class Canvas {
  readonly px = new Uint8Array(S * S * 4);
  set(x: number, y: number, c: RGBA | null) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    if (!c) this.px[i + 3] = 0;
    else this.px.set(c, i);
  }
  get(x: number, y: number): RGBA | null {
    if (x < 0 || y < 0 || x >= S || y >= S) return null;
    const i = (y * S + x) * 4;
    return this.px[i + 3] ? [this.px[i], this.px[i + 1], this.px[i + 2], 255] : null;
  }
  has(x: number, y: number) {
    return !!this.get(x, y);
  }
  over(src: Canvas) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = src.get(x, y);
      if (c) this.set(x, y, c);
    }
  }
}

/** Light on a unit ellipsoid at (nx, ny) (each -1..1 across the shape), 0..1. */
function lambert(nx: number, ny: number, flat = 0) {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const n = [nx * (1 - flat), ny * (1 - flat), nz + flat];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return Math.max(0, (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / l);
}
/** Pick a ramp tone for light t (0..1), dithered at the seams. */
function tone(r: RGBA[], t: number, x: number, y: number, dither = 0.55, lift = 0) {
  const v = Math.min(1, Math.max(0, 0.08 + Math.pow(t, 0.85) * 1.12 + lift)) * (r.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] * dither;
  return r[Math.max(0, Math.min(r.length - 1, Math.round(v)))];
}

interface Ell {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
const inside = (e: Ell, x: number, y: number) => ((x + 0.5 - e.cx) / e.rx) ** 2 + ((y + 0.5 - e.cy) / e.ry) ** 2 <= 1;

/** Paint a lit ellipsoid (a head, a hood, a shoulder) with a ramp, optionally only where `where` allows. */
function volume(c: Canvas, e: Ell, r: RGBA[], where?: (x: number, y: number) => boolean, opt: { flat?: number; lift?: number; dither?: number } = {}) {
  for (let y = Math.floor(e.cy - e.ry); y <= Math.ceil(e.cy + e.ry); y++)
    for (let x = Math.floor(e.cx - e.rx); x <= Math.ceil(e.cx + e.rx); x++) {
      if (!inside(e, x, y) || (where && !where(x, y))) continue;
      const t = lambert((x + 0.5 - e.cx) / e.rx, (y + 0.5 - e.cy) / e.ry, opt.flat ?? 0);
      c.set(x, y, tone(r, t, x, y, opt.dither ?? 0.55, opt.lift ?? 0));
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

function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, col: RGBA | ((x: number, y: number) => RGBA | null)) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    const k = typeof col === 'function' ? col(x, y) : col;
    if (k) c.set(x, y, k);
  }
}

// ---------------------------------------------------------------- the painter
type Mouth = 'neutral' | 'smile' | 'grin' | 'open' | 'thin' | 'wry' | 'frown' | 'sing';
type Eyes = 'open' | 'half' | 'closed' | 'wink' | 'wide';
interface Person {
  seed: number;
  skin: RGBA;
  bg: RGBA;
  rim?: RGBA;
  age?: 0 | 1 | 2;
  child?: boolean;
  /** A softer jaw, lashes, fuller lips. */
  fem?: boolean;
  /** Face width and height tweaks (px). */
  wide?: number;
  long?: number;
  iris?: RGBA;
  eyes?: Eyes;
  brow?: RGBA | null;
  browTilt?: number;
  mouth?: Mouth;
  lips?: RGBA;
  hair?: { col: RGBA; style: 'short' | 'long' | 'wet' | 'tonsure' | 'bald' };
  beard?: { col: RGBA; style: 'full' | 'long' | 'braided' | 'stubble' | 'moustache' | 'short' };
  head?: { kind: 'hood' | 'veil' | 'kerchief' | 'cap' | 'none'; col: RGBA; inner?: RGBA };
  cloth: RGBA;
  collar?: RGBA;
  /** Drawn before the head (behind it) and after everything (in front). */
  back?: (k: Kit) => void;
  front?: (k: Kit) => void;
}

/** What a character's own strokes can use: the canvas, the geometry and the shaded skin. */
interface Kit {
  c: Canvas;
  head: Ell;
  ey: number;
  my: number;
  skin: RGBA[];
  skinAt: (x: number, y: number, d?: number) => RGBA;
  r: () => number;
}

function paint(p: Person): Canvas {
  const r = rng(p.seed);
  const bg = new Canvas();
  // background: a lamp-lit wall, brighter behind the head on the lit side, dark at the corners
  const bgR = ramp(p.bg, mix(p.bg, P.flame1, 0.5));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot((x - 17) / 30, (y - 16) / 30);
      bg.set(x, y, tone(bgR, Math.max(0, 0.55 - d * 0.7), x, y, 0.45, -0.2));
    }

  const c = new Canvas();
  const kid = p.child ? 1 : 0;
  const head: Ell = { cx: 24, cy: 21 + kid * 2, rx: 10 + (p.wide ?? 0) * 0.5 + kid * 0.5, ry: 12 + (p.long ?? 0) * 0.5 - kid };
  const ey = Math.round(head.cy - 0.5 + kid);
  const my = Math.round(head.cy + 7.5 - kid + (p.long ?? 0) * 0.3);
  const skin = ramp(p.skin);
  const skinAt = (x: number, y: number, d = 0) => {
    const t = lambert((x + 0.5 - head.cx) / head.rx, (y + 0.5 - head.cy) / head.ry, 0.15);
    const i = Math.max(0, Math.min(4, Math.round((0.08 + Math.pow(t, 0.85) * 1.12) * 4 + d)));
    return skin[i];
  };
  const k: Kit = { c, head, ey, my, skin, skinAt, r };

  // --- behind the head: long hair, hood and veil backs, shoulders, neck
  const hairR = p.hair ? ramp(p.hair.col) : null;
  if (p.hair && (p.hair.style === 'long' || p.hair.style === 'wet'))
    volume(c, { cx: head.cx, cy: head.cy + 6, rx: head.rx + 3, ry: head.ry + 9 }, hairR!, (_x, y) => y > head.cy - 8);
  const hoodR = p.head && (p.head.kind === 'hood' || p.head.kind === 'veil') ? ramp(p.head.col) : null;
  if (hoodR) volume(c, { cx: head.cx + 0.5, cy: head.cy + 3, rx: head.rx + 6.5, ry: head.ry + 10 }, hoodR, undefined, { flat: 0.25 });
  // neck: a lit cylinder in the head's shadow, the cloth drawn over its foot
  for (let y = Math.round(head.cy + head.ry - 5); y < 42; y++)
    for (let x = 21 - kid; x <= 27 + kid; x++) {
      const t = lambert((x + 0.5 - 24) / 4.5, 0, 0) * (y < head.cy + head.ry + 3 ? 0.45 : 0.8);
      c.set(x, y, tone(skin, t, x, y, 0.4));
    }
  const clothR = ramp(p.cloth);
  const shoulders: Ell = { cx: 24, cy: 50 + kid * 3, rx: 22 - kid * 4 + (p.wide ?? 0) * 0.6, ry: 16 };
  volume(c, shoulders, clothR, undefined, { flat: 0.3 });
  // cloth folds: a few soft creases running down from the neck
  for (const fx of [-11, -6, 7, 12]) {
    const x0 = 24 + fx - kid * Math.sign(fx) * 3;
    for (let y = 40; y < S; y++) {
      const x = x0 + Math.round((y - 40) * 0.15 * Math.sign(fx));
      if (c.has(x, y) && inside(shoulders, x, y)) c.set(x, y, mix(c.get(x, y)!, clothR[0], 0.45));
    }
  }
  if (p.back) p.back(k);
  // a V neckline: the neck's foot showing, the collar's edges turned back on either side
  for (let y = 36 + kid; y < 44 + kid; y++) {
    const half = Math.max(0, 5 - (y - 36 - kid) * 0.75);
    for (let x = Math.floor(24 - half); x <= 24 + half; x++) c.set(x, y, tone(skin, x < 24 ? 0.55 : 0.3, x, y, 0.3));
    const edge = p.collar ?? clothR[3];
    for (const [x, lit] of [[Math.floor(24 - half) - 1, 0.35], [Math.ceil(24 + half) + 1, 0]] as const) {
      c.set(x, y, mix(edge, P.wax2, lit));
      c.set(x + (x < 24 ? -1 : 1), y, mix(edge, P.ink, 0.3));
    }
  }
  // ears
  for (const side of [-1, 1])
    volume(c, { cx: head.cx + side * (head.rx - 0.5), cy: ey + 2, rx: 2.2, ry: 3.2 }, skin, undefined, { lift: side < 0 ? 0 : -0.1 });

  // --- the head
  volume(c, head, skin, undefined, { flat: 0.15 });
  // a jaw that narrows to the chin
  for (let y = my; y <= head.cy + head.ry + 1; y++)
    for (let x = Math.floor(head.cx - head.rx); x <= head.cx + head.rx; x++) {
      const w = (head.rx - (p.fem ? 2 : 1.5)) * (1 - ((y - my) / (head.cy + head.ry + 2 - my)) ** 2 * (p.fem ? 0.75 : 0.55));
      if (Math.abs(x + 0.5 - head.cx) > w && c.has(x, y) && inside(head, x, y)) c.set(x, y, null);
    }

  face(k, p);

  // --- beard, then hair, then headwear over the face's edges
  if (p.beard) beard(k, p.beard);
  if (p.hair) hair(k, p.hair, hairR!);
  if (p.head && p.head.kind !== 'none') headwear(k, p.head);
  if (p.front) p.front(k);

  // --- outline and rim light
  const out = new Canvas();
  out.over(c);
  const rim = p.rim ?? P.flame1;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const col = c.get(x, y);
      if (!col) continue;
      const openR = !c.has(x + 1, y);
      const openB = !c.has(x, y + 1);
      const openL = !c.has(x - 1, y);
      if (openR && x < S - 1) out.set(x, y, mix(col, rim, 0.38)); // the candle behind them catches the far edge
      else if (openB || openL || !c.has(x, y - 1)) out.set(x, y, mix(col, P.ink, 0.35)); // a soft inner edge
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (!c.has(x, y) && (c.has(x - 1, y) || c.has(x + 1, y) || c.has(x, y - 1) || c.has(x, y + 1))) out.set(x, y, mix(P.ink, p.bg, 0.25));
  bg.over(out);
  // frame
  for (let i = 0; i < S; i++) {
    for (const [x, y] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) bg.set(x, y, P.stone3);
    for (const [x, y] of [[i, 1], [i, S - 2], [1, i], [S - 2, i]]) if (i > 0 && i < S - 1) bg.set(x, y, P.ink);
  }
  return bg;
}

function face(k: Kit, p: Person) {
  const { c, head, ey, my, skinAt } = k;
  const cx = Math.round(head.cx);
  const age = p.age ?? 1;
  const iris = p.iris ?? mix(P.wood1, P.dark2, 0.3);
  const white = mix(P.wax2, P.stone4, 0.25);
  // brow ridge and eye sockets: a shadow band above and around the eyes
  for (const ex of [cx - 6, cx + 3]) {
    for (let x = ex; x <= ex + 3; x++) c.set(x, ey - 2, skinAt(x, ey - 2, 0.4)); // the lit brow bone over the lid
    c.set(ex - 1, ey, skinAt(ex - 1, ey, -0.8));
    c.set(ex + 4, ey + 1, skinAt(ex + 4, ey + 1, -0.6));
    if (age === 2) for (let x = ex; x <= ex + 3; x++) c.set(x, ey + 2, skinAt(x, ey + 2, -0.6));
  }
  // eyes
  const state = p.eyes ?? 'open';
  [cx - 6, cx + 3].forEach((ex, i) => {
    const shut = state === 'closed' || (state === 'wink' && i === 1);
    if (shut) {
      // a closed lid: a curved lash line
      line(c, ex, ey + 1, ex + 3, ey + 1, P.ink);
      c.set(ex - 1, ey, mix(P.ink, p.skin, 0.4));
      c.set(ex + 1, ey, skinAt(ex + 1, ey, 0.6));
      c.set(ex + 2, ey, skinAt(ex + 2, ey, 0.4));
      return;
    }
    const shade = i === 1 ? 0.18 : 0;
    for (let x = ex; x < ex + 4; x++) {
      c.set(x, ey, mix(white, P.stone2, shade));
      c.set(x, ey + 1, mix(white, P.stone3, 0.3 + shade));
    }
    if (state === 'wide') for (let x = ex; x < ex + 4; x++) c.set(x, ey - 1, mix(white, P.stone3, 0.2));
    // iris, pupil, and the catch-light
    const ix = ex + 1;
    c.set(ix, ey, iris);
    c.set(ix + 1, ey, mix(iris, P.ink, 0.35));
    c.set(ix, ey + 1, mix(iris, P.wax2, 0.2));
    c.set(ix + 1, ey + 1, iris);
    c.set(ix + 1, ey, P.ink);
    c.set(ix, ey, mix(iris, P.white, 0.6));
    // the upper lid (lowered over half the eye when tired)
    // the upper lash line, heaviest in the middle
    const lidY = state === 'wide' ? ey - 2 : ey - 1;
    for (let x = ex; x <= ex + 3; x++) c.set(x, lidY, x === ex ? mix(P.ink, p.skin, 0.45) : mix(P.ink, P.dark2, 0.25));
    c.set(ex + 4, lidY + 1, mix(P.ink, p.skin, 0.35));
    if (p.fem) c.set(i ? ex + 4 : ex - 1, lidY, P.ink); // a lash flicked out at the corner
    if (state === 'half') for (let x = ex; x < ex + 4; x++) c.set(x, ey, skinAt(x, ey, -0.6));
    if (state === 'half') line(c, ex, ey + 1, ex + 3, ey + 1, mix(P.ink, p.skin, 0.2));
    c.set(ex + 4, ey, mix(P.ink, p.skin, 0.5));
    if (age === 2) {
      // bags and crow's feet
      line(c, ex, ey + 3, ex + 3, ey + 3, skinAt(ex, ey + 3, -1));
      c.set(i ? ex + 5 : ex - 2, ey + 1, skinAt(ex, ey, -1.2));
    }
  });
  // brows
  if (p.brow !== null) {
    const bc = p.brow ?? mix(p.hair?.col ?? P.wood1, P.ink, 0.3);
    const tilt = p.browTilt ?? 0;
    for (const [ex, dir] of [[cx - 6, 1], [cx + 3, -1]] as const) {
      for (let j = 0; j < 5; j++) {
        const x = ex - 1 + j;
        const y = ey - 3 + Math.round(((j - 2) * dir * tilt) / 3);
        c.set(x, y, j === (dir > 0 ? 4 : 0) ? mix(bc, p.skin, 0.4) : bc);
        if (j > 0 && j < 4 && age < 2) c.set(x, y - 1, mix(skinAt(x, y - 1), bc, 0.35));
      }
    }
  }
  // nose: a lit bridge, a shadowed side, a rounded tip and nostrils
  for (let y = ey + 1; y <= my - 3; y++) {
    c.set(cx - 1, y, skinAt(cx - 1, y, 0.7));
    c.set(cx + 1, y, skinAt(cx + 1, y, -1));
  }
  c.set(cx + 2, my - 3, skinAt(cx + 2, my - 3, -1.4));
  c.set(cx - 1, my - 3, skinAt(cx, my - 3, -1.5));
  c.set(cx + 1, my - 3, skinAt(cx, my - 3, -1.8));
  c.set(cx, my - 4, skinAt(cx, my - 4, 1));
  for (let x = cx - 2; x <= cx + 2; x++) c.set(x, my - 2, skinAt(x, my - 2, -0.7)); // under the nose
  // cheeks: a warm flush, and the old man's folds
  const flush = mix(p.skin, P.blood2, 0.35);
  if (!p.beard || p.beard.style === 'moustache' || p.beard.style === 'stubble')
    for (const x of [cx - 7, cx - 6, cx + 5]) c.set(x, ey + 4, mix(c.get(x, ey + 4) ?? p.skin, flush, 0.55));
  if (age === 2) {
    line(c, cx - 3, my - 3, cx - 5, my + 1, (x, y) => skinAt(x, y, -1));
    line(c, cx + 3, my - 3, cx + 5, my + 1, (x, y) => skinAt(x, y, -1.3));
    for (const y of [ey - 6, ey - 7]) for (let x = cx - 4; x <= cx + 3; x += 2) c.set(x + (y & 1), y, skinAt(x, y, -0.7));
  }
  // mouth
  const lips = p.lips ?? mix(p.skin, P.blood2, 0.22);
  const dark = mix(mix(P.ink, P.blood1, 0.35), p.skin, 0.25);
  const m = p.mouth ?? 'neutral';
  const lower = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) c.set(x, y, mix(lips, P.wax2, x < cx ? 0.25 : 0.05));
  };
  if (m === 'open' || m === 'sing') {
    const w = m === 'sing' ? 1 : 2;
    for (let y = my - 1; y <= my + 1; y++) for (let x = cx - w; x <= cx + w; x++) c.set(x, y, dark);
    c.set(cx - w - 1, my, lips);
    c.set(cx + w + 1, my, lips);
    lower(cx - w, cx + w, my + 2);
    if (m === 'open') for (let x = cx - 1; x <= cx + 1; x++) c.set(x, my - 1, mix(P.wax2, P.stone3, 0.3)); // teeth
  } else if (m === 'grin') {
    for (let x = cx - 4; x <= cx + 4; x++) c.set(x, my - (Math.abs(x - cx) > 3 ? 1 : 0), dark);
    for (let x = cx - 3; x <= cx + 3; x++) c.set(x, my + 1, mix(P.wax2, P.stone3, 0.2));
    lower(cx - 3, cx + 3, my + 2);
  } else {
    const curve = m === 'smile' ? -1 : m === 'frown' ? 1 : 0;
    const w = m === 'thin' ? 2 : 3;
    for (let x = cx - w; x <= cx + w; x++) {
      const end = Math.abs(x - cx) === w;
      const wry = m === 'wry' && x > cx ? -1 : 0;
      c.set(x, my + (end ? curve : 0) + (m === 'wry' && x === cx + w ? -1 : 0) + (wry && end ? 0 : 0), end ? mix(dark, p.skin, 0.4) : dark);
    }
    if (m !== 'thin') lower(cx - w + 1, cx + w - 1, my + 1);
    if (p.fem && m !== 'thin') for (let x = cx - w + 1; x <= cx + w - 1; x++) c.set(x, my + 1, mix(lips, P.blood2, 0.25));
    c.set(cx, my + 3, skinAt(cx, my + 3, -0.6)); // under the lip
  }
  // form: the cheek turning away from the light, and a shadow under the jaw
  for (let y = ey + 3; y < my + 3; y++) {
    const x = Math.round(cx + head.rx - 3 - (y - ey) * 0.15);
    if (c.has(x, y)) c.set(x, y, skinAt(x, y, -0.8));
  }
  for (let x = cx - 5; x <= cx + 6; x++) {
    const y = Math.round(head.cy + head.ry - 1 - ((x - cx) / 7) ** 2 * 3);
    if (c.has(x, y + 1)) c.set(x, y + 1, skinAt(x, y + 1, -1.2));
  }
  // chin highlight
  c.set(cx - 1, my + 5, skinAt(cx - 1, my + 5, 0.8));
}

function beard(k: Kit, b: NonNullable<Person['beard']>) {
  const { c, head, my, r } = k;
  const cx = head.cx;
  const br = ramp(b.col);
  const len = b.style === 'long' ? 12 : b.style === 'braided' ? 9 : b.style === 'full' ? 6 : b.style === 'short' ? 3 : 0;
  if (b.style === 'stubble') {
    for (let y = my - 3; y <= head.cy + head.ry; y++)
      for (let x = Math.floor(cx - head.rx); x <= cx + head.rx; x++)
        if (c.has(x, y) && inside(head, x, y) && y > my - 3 && ((x * 7 + y * 13) % 5 === 0 || (x + y) % 7 === 0)) c.set(x, y, mix(c.get(x, y)!, br[1], 0.5));
    return;
  }
  if (len) {
    const top = my - 2;
    const bottom = head.cy + head.ry + len;
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const half = (head.rx - 0.5) * (y < head.cy + head.ry - 2 ? 1 : 1 - (t - 0.35) * (b.style === 'long' ? 0.9 : 1.1));
      for (let x = Math.floor(cx - half); x <= cx + half; x++) {
        if (y < my + 2 && Math.abs(x + 0.5 - cx) < 3.5 - (y - top) * 0.2) continue; // the mouth shows through
        const nx = (x + 0.5 - cx) / Math.max(half, 1);
        const light = lambert(nx * 0.9, (t - 0.4) * 1.2, 0.2);
        const strand = (x * 5 + Math.floor(y / 3) * 3) % 4 === 0 ? -0.9 : 0;
        c.set(x, y, tone(br, light, x, y, 0.4, strand * 0.25));
      }
    }
    if (b.style === 'braided')
      for (const bx of [cx - 2, cx + 2])
        for (let y = head.cy + head.ry + 2; y < bottom + 4; y++) {
          c.set(bx, y, y % 2 ? br[3] : br[1]);
          c.set(bx + (y % 2 ? 1 : -1), y, br[0]);
        }
    for (let i = 0; i < 6; i++) c.set(cx - 4 + Math.floor(r() * 9), my + 3 + Math.floor(r() * len), br[4]); // stray light hairs
  }
  // moustache over the lip
  for (let x = Math.round(cx - 4); x <= cx + 4; x++) {
    const y = my - 1 - (Math.abs(x - cx) < 2 ? 0 : 0);
    c.set(x, y, x < cx ? br[3] : br[1]);
    if (Math.abs(x - cx) > 2) c.set(x, y + 1, br[1]);
  }
}

function hair(k: Kit, h: NonNullable<Person['hair']>, hr: RGBA[]) {
  const { c, head, ey } = k;
  const cx = head.cx;
  if (h.style === 'bald') {
    // a shine on the scalp
    for (const [dx, dy] of [[-4, -9], [-3, -9], [-5, -8], [-4, -8]]) c.set(cx + dx, head.cy + dy, k.skin[4]);
    return;
  }
  const cap: Ell = { cx, cy: head.cy - 1, rx: head.rx + 1.2, ry: head.ry + 0.8 };
  const hairline = (x: number) => ey - 5 + ((x + 0.5 - cx) / head.rx) ** 2 * 7;
  volume(
    c,
    cap,
    hr,
    (x, y) => {
      if (h.style === 'tonsure' && ((x + 0.5 - cx) / 6) ** 2 + ((y + 0.5 - (head.cy - 9)) / 3.5) ** 2 <= 1) return false;
      return y < hairline(x) || (Math.abs(x + 0.5 - cx) > head.rx - 1.5 && y < ey + (h.style === 'short' || h.style === 'tonsure' ? 2 : 9));
    },
    { dither: 0.45 },
  );
  // strands: darker partings sweeping from the crown
  for (let i = -4; i <= 4; i++) {
    const x0 = cx + i * 2.2;
    for (let s = 0; s < 6; s++) {
      const x = Math.round(x0 + i * s * 0.35);
      const y = Math.round(head.cy - head.ry + 2 + s);
      if (c.has(x, y) && y < hairline(x)) c.set(x, y, mix(c.get(x, y)!, hr[0], 0.55));
    }
  }
  // a sheen where the light catches the crown
  for (let x = Math.floor(cx - head.rx + 2); x < cx + 2; x++) {
    const y = Math.round(head.cy - head.ry + 3 + ((x + 0.5 - cx + 3) / 6) ** 2);
    if (c.has(x, y) && y < hairline(x) - 1) c.set(x, y, hr[4]);
    if (c.has(x, y + 1) && y + 1 < hairline(x) - 1 && (x & 1)) c.set(x, y + 1, hr[3]);
  }
  if (h.style === 'wet')
    for (const x of [cx - head.rx - 1, cx - head.rx + 1, cx + head.rx - 1, cx + head.rx + 1])
      for (let y = ey; y < ey + 16; y++) if (c.has(x, y) || y > ey + 3) c.set(x + (y % 5 === 0 ? 1 : 0), y, y % 3 ? hr[1] : hr[2]); // hanging wet locks
  if (h.style === 'tonsure') for (let x = cx - 5; x <= cx - 2; x++) c.set(x, head.cy - 10, k.skin[4]);
}

function headwear(k: Kit, h: NonNullable<Person['head']>) {
  const { c, head, ey } = k;
  const cx = head.cx;
  const hr = ramp(h.col);
  const opening: Ell = { cx, cy: head.cy + 2.5, rx: head.rx - 0.3, ry: head.ry - 0.2 };
  const hood: Ell = { cx: cx + 0.5, cy: head.cy + 3, rx: head.rx + 6.5, ry: head.ry + 10 };
  if (h.kind === 'hood' || h.kind === 'veil') {
    if (h.kind === 'veil' && h.inner) {
      // the wimple: a white band framing the face, under the veil
      const wr = ramp(h.inner, P.white);
      const wim: Ell = { cx, cy: head.cy + 2, rx: head.rx + 2.5, ry: head.ry + 3 };
      volume(c, wim, wr, (x, y) => !inside({ ...opening, rx: opening.rx - 0.5, ry: opening.ry - 0.8 }, x, y) && y < 40, { flat: 0.4, dither: 0.3 });
    }
    const hole: Ell = h.kind === 'veil' ? { cx, cy: head.cy + 2, rx: head.rx + 2.5, ry: head.ry + 3 } : opening;
    volume(c, hood, hr, (x, y) => !inside(hole, x, y) && y < 42, { flat: 0.25 });
    // the fold where the hood turns in round the face
    for (let a = Math.PI * 1.05; a < Math.PI * 1.95; a += 0.04) {
      const x = Math.round(hole.cx + Math.cos(a) * (hole.rx + 0.6));
      const y = Math.round(hole.cy + Math.sin(a) * (hole.ry + 0.6));
      if (c.has(x, y)) c.set(x, y, mix(c.get(x, y)!, hr[0], 0.5));
    }
    for (let i = 0; i < 4; i++) line(c, hood.cx + 7 + i * 2, hood.cy - 8 + i * 5, hood.cx + 9 + i * 2, hood.cy + 2 + i * 5, (x, y) => (c.has(x, y) && !inside(hole, x, y) ? mix(c.get(x, y)!, hr[0], 0.35) : null));
    return;
  }
  if (h.kind === 'kerchief') {
    const cap: Ell = { cx, cy: head.cy - 1, rx: head.rx + 1.5, ry: head.ry + 1 };
    volume(c, cap, hr, (x, y) => y < ey - 4 + ((x + 0.5 - cx) / head.rx) ** 2 * 3, { flat: 0.2 });
    for (let x = Math.floor(cx - head.rx - 1); x <= cx + head.rx + 1; x++) {
      const y = Math.round(ey - 4 + ((x + 0.5 - cx) / head.rx) ** 2 * 3);
      if (c.has(x, y - 1)) c.set(x, y - 1, hr[x < cx ? 3 : 1]); // the hem
    }
    // the knot at the side, its ends hanging
    volume(c, { cx: cx + head.rx + 1, cy: ey - 5, rx: 2.5, ry: 2 }, hr);
    line(c, cx + head.rx + 2, ey - 4, cx + head.rx + 4, ey, hr[1]);
    line(c, cx + head.rx + 1, ey - 3, cx + head.rx + 2, ey + 1, hr[2]);
    return;
  }
  if (h.kind === 'cap') {
    const cap: Ell = { cx: cx - 0.5, cy: head.cy - 3, rx: head.rx + 1.5, ry: head.ry - 1 };
    volume(c, cap, hr, (_x, y) => y < ey - 4, { flat: 0.15 });
    for (let x = Math.floor(cx - head.rx - 2); x <= cx + head.rx + 2; x++) {
      c.set(x, ey - 4, hr[x < cx ? 3 : 2]); // the brim
      c.set(x, ey - 3, hr[0]);
    }
    for (let x = Math.floor(cx - head.rx); x <= cx + head.rx; x++) if (c.has(x, ey - 2)) c.set(x, ey - 2, mix(c.get(x, ey - 2)!, P.ink, 0.35)); // its shadow on the brow
  }
}

// ---------------------------------------------------------------- the cast
const SKIN = mix(P.wax1, P.wood2, 0.35);
const PALE = mix(P.wax2, P.wax1, 0.5);
const OLD = mix(P.wax1, P.stone3, 0.3);
const WALL = mix(P.dark2, P.wood1, 0.35);

function candle(c: Canvas, x: number, y: number, h: number, flame = true) {
  const wr = ramp(P.wax1, P.white);
  for (let j = 0; j < h; j++) {
    c.set(x, y - j, wr[3]);
    c.set(x + 1, y - j, wr[2]);
    c.set(x + 2, y - j, wr[1]);
  }
  c.set(x + 2, y - h + 2, wr[3]); // a drip
  if (!flame) return;
  c.set(x + 1, y - h, P.ink); // wick
  c.set(x + 1, y - h - 1, P.flame1);
  c.set(x + 1, y - h - 2, P.flame2);
  c.set(x, y - h - 2, mix(P.flame1, P.wax2, 0.3));
  c.set(x + 1, y - h - 3, P.wax2);
}
function glow(c: Canvas, x: number, y: number, rad: number, col: RGBA, amt: number) {
  for (let j = -rad; j <= rad; j++)
    for (let i = -rad; i <= rad; i++) {
      const d = Math.hypot(i, j) / rad;
      const cur = c.get(x + i, y + j);
      if (!cur || d > 1) continue;
      const t = amt * (1 - d) ** 1.5 + BAYER[((y + j) & 3) * 4 + ((x + i) & 3)] * 0.08;
      if (t > 0.04) c.set(x + i, y + j, mix(cur, col, Math.min(0.8, t)));
    }
}

export const CAST: Record<string, Person> = {
  oskar: {
    seed: 1, skin: SKIN, bg: WALL, age: 1, wide: 3, iris: mix(P.wood1, P.ink, 0.2), brow: P.dark2, browTilt: 1, mouth: 'grin',
    hair: { col: SKIN, style: 'bald' }, beard: { col: mix(P.dark2, P.wood1, 0.3), style: 'full' },
    cloth: mix(P.wood1, P.stone2, 0.25), collar: P.wood2,
    front: k => {
      // a scar across the brow, and the broken shackle on the shoulder strap
      line(k.c, k.head.cx + 3, k.ey - 6, k.head.cx + 7, k.ey - 2, mix(P.blood1, P.wax1, 0.4));
      for (let x = 34; x < 40; x++) k.c.set(x, 42 + (x % 2), x % 2 ? P.steel1 : P.stone2);
    },
  },
  maudlin: {
    fem: true, seed: 2, skin: PALE, bg: mix(P.dark2, P.stone1, 0.3), age: 2, eyes: 'half', iris: P.stone3, brow: P.stone3, browTilt: -1.2, mouth: 'thin',
    head: { kind: 'veil', col: mix(P.dark1, P.stone1, 0.4), inner: P.wax2 },
    cloth: P.stone2, collar: P.stone3,
    front: k => {
      // the little flame she wears on a cord
      line(k.c, 20, 38, 24, 44, P.wood1);
      line(k.c, 28, 38, 24, 44, P.wood1);
      k.c.set(24, 45, P.flame2);
      k.c.set(24, 44, P.flame1);
      glow(k.c, 24, 44, 4, P.flame2, 0.5);
    },
  },
  pip: {
    seed: 3, skin: PALE, bg: mix(P.teal1, P.dark1, 0.5), rim: P.flame2, child: true, age: 0, eyes: 'wide', iris: mix(P.teal3, P.stone3, 0.3),
    brow: mix(P.wood1, P.dark2, 0.3), browTilt: -1, mouth: 'neutral', hair: { col: P.wood1, style: 'short' },
    head: { kind: 'hood', col: P.teal1 }, cloth: P.teal2,
    front: k => {
      // the candle stub held up under the chin, lighting the face from below
      candle(k.c, 30, 46, 5);
      glow(k.c, 31, 39, 9, P.flame2, 0.45);
    },
  },
  tollwarden: {
    seed: 4, skin: P.steel1, bg: mix(P.blood1, P.dark1, 0.6), cloth: P.blood1, collar: P.flame1,
    front: k => tollHelm(k),
  },
  matron: {
    fem: true, seed: 5, skin: mix(P.wax1, P.teal3, 0.15), bg: mix(P.teal1, P.ink, 0.4), rim: P.cyan, age: 1, eyes: 'closed', brow: null, mouth: 'sing',
    lips: mix(P.stone3, P.teal2, 0.4), head: { kind: 'veil', col: mix(P.teal1, P.stone1, 0.5), inner: mix(P.stone4, P.teal3, 0.3) },
    cloth: P.teal1, collar: P.stone3,
    front: k => {
      // wax tears running from the closed eyes, and water dripping from the veil
      for (const x of [k.head.cx - 5, k.head.cx + 5]) for (let y = k.ey + 2; y < k.ey + 9; y++) k.c.set(x + (y > k.ey + 5 ? 0 : 0), y, y % 3 ? P.wax2 : P.wax1);
      for (const [x, y] of [[9, 30], [38, 33], [11, 38], [36, 42], [8, 44]]) {
        k.c.set(x, y, P.cyan);
        k.c.set(x, y + 1, mix(P.cyan, P.teal2, 0.5));
      }
    },
  },
  chandler: {
    seed: 6, skin: mix(P.stone4, P.wax1, 0.3), bg: mix(P.dark2, P.blood1, 0.25), rim: P.flame2, age: 2, long: 3, wide: -2, eyes: 'half',
    iris: mix(P.flame1, P.stone3, 0.5), brow: P.stone2, browTilt: 1.5, mouth: 'thin', hair: { col: P.stone4, style: 'bald' },
    cloth: P.wax2, collar: P.blood2,
    front: k => chandlerCrown(k),
  },
  tomas: {
    seed: 7, skin: OLD, bg: WALL, age: 2, iris: P.stone3, brow: P.stone4, mouth: 'smile',
    beard: { col: P.stone4, style: 'long' }, head: { kind: 'cap', col: P.dark2 },
    cloth: mix(P.moss1, P.stone1, 0.5), collar: mix(P.moss1, P.ink, 0.4),
    front: k => {
      // the lamplighter's pole behind his shoulder, its little flame at the top corner
      line(k.c, 40, 47, 43, 6, P.wood2);
      line(k.c, 41, 47, 44, 6, P.wood1);
      k.c.set(44, 5, P.steel1);
      k.c.set(43, 4, P.flame1);
      k.c.set(43, 3, P.flame2);
      glow(k.c, 43, 4, 6, P.flame2, 0.4);
    },
  },
  hedda: {
    fem: true, seed: 8, skin: SKIN, bg: WALL, age: 1, wide: 2, iris: mix(P.wood2, P.ink, 0.3), mouth: 'smile',
    hair: { col: mix(P.wood1, P.flame1, 0.2), style: 'short' }, head: { kind: 'kerchief', col: P.blood2 },
    cloth: mix(P.teal1, P.stone2, 0.5), collar: mix(P.wax1, P.stone3, 0.3),
    back: k => {
      // the yoke across her shoulders
      for (let x = 2; x < 46; x++) {
        k.c.set(x, 37 - Math.round(Math.abs(x - 24) * 0.06), P.wood2);
        k.c.set(x, 38 - Math.round(Math.abs(x - 24) * 0.06), P.wood1);
      }
    },
  },
  bede: {
    seed: 9, skin: SKIN, bg: mix(P.moss1, P.dark1, 0.6), age: 1, wide: 3, iris: mix(P.moss2, P.ink, 0.3), brow: P.wood1, browTilt: 0.5,
    mouth: 'neutral', hair: { col: P.wood1, style: 'short' }, beard: { col: P.wood1, style: 'full' }, cloth: P.moss1, collar: P.moss2,
    back: k => {
      // the axe on his shoulder
      line(k.c, 36, 47, 44, 14, P.wood2);
      line(k.c, 37, 47, 45, 14, P.wood1);
      const ir = ramp(P.steel1, P.steel2);
      for (let y = 9; y < 17; y++) for (let x = 41; x < 47; x++) if (x - 41 < 2 + (y - 9) * 0.6) k.c.set(x, y, ir[x === 46 ? 4 : 2 + (y < 12 ? 1 : 0)]);
    },
  },
  agnes: {
    fem: true, seed: 10, skin: OLD, bg: mix(P.dark1, P.stone1, 0.3), age: 2, eyes: 'half', iris: P.stone3, brow: P.stone3, browTilt: -1,
    mouth: 'thin', head: { kind: 'hood', col: P.dark1 }, cloth: P.dark1,
    front: k => {
      // prayer beads looped over her hands at the bottom
      for (let x = 14; x < 34; x += 2) k.c.set(x, 44 + Math.round(Math.sin(x / 3)), x % 4 ? P.wood2 : mix(P.wood2, P.wax1, 0.4));
      k.c.set(24, 46, P.wax2);
    },
  },
  ulla: {
    fem: true, seed: 11, skin: SKIN, bg: WALL, age: 1, iris: mix(P.wood2, P.ink, 0.35), mouth: 'neutral', browTilt: -0.5,
    hair: { col: P.wood1, style: 'short' }, head: { kind: 'kerchief', col: mix(P.moss1, P.stone2, 0.4) },
    cloth: mix(P.wood1, P.stone2, 0.4), collar: mix(P.wax1, P.stone3, 0.4),
    front: k => {
      for (const [x, y] of [[k.head.cx + 5, k.ey + 4], [k.head.cx + 6, k.ey + 5], [k.head.cx + 4, k.ey + 5]]) k.c.set(x, y, mix(k.c.get(x, y)!, P.dark2, 0.6)); // soot
    },
  },
  jost: {
    seed: 12, skin: OLD, bg: WALL, age: 2, iris: mix(P.teal2, P.stone3, 0.4), mouth: 'smile',
    beard: { col: mix(P.stone4, P.wax1, 0.3), style: 'long' }, head: { kind: 'hood', col: mix(P.wood1, P.stone2, 0.3) }, cloth: P.stone2,
    front: k => {
      // the scallop badge on his breast
      const sr = ramp(P.wax1, P.white);
      for (let y = 0; y < 5; y++) for (let x = -2; x <= 2; x++) if (Math.abs(x) <= 2 - (y > 3 ? 1 : 0)) k.c.set(12 + x, 41 + y, sr[(x + y) % 2 ? 2 : 3]);
      k.c.set(12, 46, sr[1]);
    },
  },
  lome: {
    seed: 13, skin: OLD, bg: mix(P.dark1, P.wood1, 0.3), rim: P.flame2, age: 2, eyes: 'half', iris: P.wood2, mouth: 'neutral',
    beard: { col: P.stone3, style: 'long' }, head: { kind: 'hood', col: mix(P.wood1, P.ink, 0.3) }, cloth: mix(P.wood1, P.stone1, 0.3),
    front: k => {
      candle(k.c, 34, 46, 4);
      glow(k.c, 35, 40, 10, P.flame2, 0.4);
    },
  },
  wenna: {
    fem: true, seed: 14, skin: mix(SKIN, P.moss2, 0.15), bg: mix(P.moss1, P.ink, 0.5), rim: mix(P.moss2, P.wax1, 0.4), age: 1, iris: P.moss2, eyes: 'half',
    browTilt: 0.6, mouth: 'wry', hair: { col: mix(P.dark2, P.moss1, 0.3), style: 'wet' }, cloth: P.moss1, collar: P.moss2,
  },
  fennick: {
    seed: 15, skin: PALE, bg: mix(P.dark1, P.stone1, 0.5), age: 1, long: 2, iris: P.stone3, brow: P.stone3, browTilt: -0.5, mouth: 'thin',
    hair: { col: PALE, style: 'bald' }, cloth: P.dark1, collar: P.wax2,
    front: k => {
      // round spectacles
      const rimC = P.stone2;
      for (const ex of [k.head.cx - 6, k.head.cx + 3]) {
        for (let a = 0; a < Math.PI * 2; a += 0.2) k.c.set(Math.round(ex + 1.5 + Math.cos(a) * 3), Math.round(k.ey + 0.5 + Math.sin(a) * 2.5), rimC);
        k.c.set(ex, k.ey - 1, P.white); // glint
      }
      line(k.c, k.head.cx - 2, k.ey, k.head.cx + 1, k.ey, rimC);
    },
  },
  cuthwin: {
    seed: 16, skin: PALE, bg: mix(P.stone1, P.dark1, 0.4), age: 0, iris: mix(P.moss2, P.stone3, 0.3), eyes: 'wide', browTilt: -1.5, mouth: 'frown',
    hair: { col: mix(P.wood1, P.flame1, 0.35), style: 'tonsure' }, cloth: mix(P.stone3, P.wood2, 0.35), collar: mix(P.stone2, P.wood1, 0.4),
    front: k => {
      for (const [dx, dy] of [[-7, 4], [-5, 5], [4, 4], [6, 5], [-6, 3]]) k.c.set(k.head.cx + dx, k.ey + dy, mix(k.c.get(k.head.cx + dx, k.ey + dy)!, P.ember, 0.4)); // freckles
    },
  },
  hobb: {
    seed: 17, skin: OLD, bg: WALL, age: 2, eyes: 'wink', iris: P.stone3, brow: P.stone3, browTilt: 1, mouth: 'wry',
    beard: { col: P.stone3, style: 'stubble' }, head: { kind: 'cap', col: mix(P.teal1, P.ink, 0.3) }, cloth: P.wood1,
    front: k => {
      // a patch on the cap
      for (let y = 6; y < 9; y++) for (let x = 27; x < 31; x++) k.c.set(x, y, mix(P.wood2, P.stone2, 0.3));
      k.c.set(28, 7, P.wax1);
    },
  },
  wren: {
    fem: true, seed: 18, skin: SKIN, bg: mix(P.blood1, P.dark1, 0.6), age: 0, iris: mix(P.moss2, P.teal3, 0.4), mouth: 'smile', browTilt: 0.3,
    hair: { col: mix(P.wood2, P.flame1, 0.3), style: 'long' }, head: { kind: 'cap', col: mix(P.moss1, P.stone1, 0.3) },
    cloth: mix(P.blood1, P.stone2, 0.35), collar: mix(P.wax1, P.stone3, 0.2),
    front: k => {
      // a white feather in the cap, and the harp's neck at her shoulder
      line(k.c, 14, 10, 7, 2, P.wax2);
      line(k.c, 15, 10, 8, 3, P.wax1);
      line(k.c, 13, 9, 9, 5, P.white);
      line(k.c, 42, 47, 42, 24, P.wood2);
      line(k.c, 43, 47, 43, 24, P.wood1);
      line(k.c, 42, 24, 46, 29, P.wood2);
      for (let y = 30; y < 47; y += 3) k.c.set(44, y, P.wax2);
    },
  },
  gunner: {
    seed: 19, skin: mix(P.wax1, P.dark1, 0.42), bg: mix(P.stone1, P.dark1, 0.5), rim: P.flame1, age: 2, iris: P.flame2, brow: P.stone3, browTilt: 1.4,
    mouth: 'grin', beard: { col: P.stone3, style: 'braided' }, cloth: mix(P.blood1, P.dark1, 0.2), collar: P.flame1,
    front: k => gunnerHat(k),
  },
};

function tollHelm(k: Kit) {
  // No face at all: a barbute with a T-shaped slit, pale candle eyes inside, a coin slot, a flame crest.
  const { c, head } = k;
  const cx = head.cx;
  const helm: Ell = { cx, cy: head.cy + 1, rx: head.rx + 1.5, ry: head.ry + 2 };
  const ir = ramp(P.steel1, P.steel2);
  volume(c, helm, ir, (_x, y) => y < 38, { flat: 0.1, dither: 0.35 });
  for (let x = Math.floor(cx - helm.rx); x <= cx + helm.rx; x++) if (c.has(x, 37)) c.set(x, 37, ir[0]); // lower rim
  // the slit
  for (let x = cx - 8; x <= cx + 8; x++) {
    c.set(x, k.ey, P.ink);
    c.set(x, k.ey + 1, mix(P.ink, P.dark2, 0.3));
  }
  for (let y = k.ey; y < k.ey + 11; y++) {
    c.set(cx - 1, y, P.ink);
    c.set(cx, y, P.ink);
  }
  for (const ex of [cx - 6, cx + 4]) {
    c.set(ex, k.ey, P.wax2);
    c.set(ex + 1, k.ey, P.wax1);
    glow(c, ex, k.ey, 3, P.wax2, 0.35);
  }
  // rivets and dents
  for (const [x, y] of [[cx - 9, 22], [cx + 9, 22], [cx - 8, 30], [cx + 8, 30]]) {
    c.set(x, y, ir[4]);
    c.set(x + 1, y + 1, ir[0]);
  }
  c.set(cx + 6, 12, ir[1]);
  c.set(cx - 4, 31, ir[1]);
  // the flame crest
  for (let y = 3; y < 9; y++) for (let x = cx - 2; x <= cx + 1; x++) c.set(x, y, y < 5 ? P.flame2 : x < cx ? P.flame1 : P.ember);
  // pauldrons
  for (const side of [-1, 1]) volume(c, { cx: 24 + side * 15, cy: 44, rx: 9, ry: 6 }, ir, undefined, { flat: 0.2 });
}

function chandlerCrown(k: Kit) {
  const { c, head } = k;
  const cx = head.cx;
  // wax running down from the crown over his brow
  for (const [x, len] of [[cx - 5, 5], [cx + 2, 3], [cx + 6, 6]]) for (let y = head.cy - 9; y < head.cy - 9 + len; y++) c.set(x, y, y % 2 ? P.wax2 : P.wax1);
  // the band and its lit tapers
  const gold = ramp(P.flame1, P.flame2);
  for (let x = cx - 10; x <= cx + 10; x++) {
    c.set(x, head.cy - 10, gold[x < cx ? 3 : 2]);
    c.set(x, head.cy - 9, gold[1]);
  }
  c.set(cx, head.cy - 10, P.blood2);
  for (const dx of [-9, -5, -1, 3, 7]) candle(c, cx + dx, head.cy - 11, 4 + ((dx + 9) % 3));
  glow(c, cx, head.cy - 16, 12, P.flame2, 0.25);
  // the gold orphrey down his chasuble
  for (let y = 40; y < 48; y++) for (let x = 22; x <= 26; x++) c.set(x, y, gold[x === 22 ? 3 : x === 26 ? 1 : 2]);
}

function gunnerHat(k: Kit) {
  const { c, head } = k;
  const cx = head.cx;
  const hr = ramp(mix(P.dark1, P.stone1, 0.3));
  // the tricorn: a low crown and a wide cocked brim turned up at the sides
  volume(c, { cx, cy: head.cy - 9, rx: head.rx + 1, ry: 5 }, hr, (_x, y) => y < head.cy - 5, { flat: 0.2 });
  for (let x = Math.floor(cx - head.rx - 5); x <= cx + head.rx + 5; x++) {
    const up = Math.round(Math.abs(x + 0.5 - cx) ** 1.6 / 10);
    for (let y = head.cy - 6 - up; y <= head.cy - 5; y++) c.set(x, y, hr[y === head.cy - 6 - up ? 3 : 1]);
  }
  c.set(cx + 7, head.cy - 7, P.flame1); // a brass cockade
  c.set(cx + 8, head.cy - 7, P.flame2);
  // brass buttons down the coat, and a fuse cord over the shoulder smouldering at its end
  for (const y of [41, 45]) c.set(20, y, P.flame2);
  line(c, 30, 38, 40, 47, mix(P.wood1, P.stone2, 0.3));
  c.set(35, 43, P.ember);
  c.set(35, 42, P.flame1);
}

/** Paint the named characters side by side: a strip `PORTRAIT * n` wide. */
export function renderPortraits(who: readonly string[]) {
  const w = PORTRAIT * who.length;
  const px = new Uint8Array(w * PORTRAIT * 4);
  who.forEach((name, i) => {
    const p = CAST[name];
    if (!p) throw new Error(`no portrait for "${name}"`);
    const one = paint(p);
    for (let y = 0; y < S; y++) px.set(one.px.subarray(y * S * 4, (y + 1) * S * 4), (y * w + i * S) * 4);
  });
  return { w, h: PORTRAIT, px };
}
