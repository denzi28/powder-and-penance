export type Dir8 = 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';
export const DIR8: readonly Dir8[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const DIR_ANGLE: Record<Dir8, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
const MIRROR: Record<Dir8, Dir8> = { E: 'W', W: 'E', SE: 'SW', SW: 'SE', NE: 'NW', NW: 'NE', N: 'N', S: 'S' };

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;

/** Normalize degrees into [0, 360). */
export function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Screen-space angle (y down) to the nearest of 8 directions. */
export function dir8FromAngle(rad: number): Dir8 {
  return DIR8[(((Math.round(rad / (Math.PI / 4)) % 8) + 8) % 8)];
}

/** Screen-space angle to the nearest cardinal direction. */
export function dir4FromAngle(rad: number): Dir8 {
  return (['E', 'S', 'W', 'N'] as const)[(((Math.round(rad / (Math.PI / 2)) % 4) + 4) % 4)];
}

/**
 * Map a wanted direction onto the directions a sheet actually authors.
 * Uses horizontal mirroring where possible, else the angularly nearest option.
 */
export function resolveDir(want: Dir8, authored: readonly string[]): { dir: Dir8; flip: boolean } {
  if (authored.includes(want)) return { dir: want, flip: false };
  let best = { dir: authored[0] as Dir8, flip: false };
  let bestDist = Infinity;
  for (const a of authored as readonly Dir8[]) {
    for (const flip of [false, true]) {
      const shown = flip ? MIRROR[a] : a;
      const d = Math.abs(normDeg(DIR_ANGLE[shown] - DIR_ANGLE[want] + 180) - 180);
      if (d < bestDist - 1e-6) {
        bestDist = d;
        best = { dir: a, flip };
      }
    }
  }
  return best;
}

export function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz || m === 0) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
