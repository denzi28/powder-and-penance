// Hitbox geometry in world space. Hurtboxes are axis-aligned rects (the body as seen on screen).
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HitShape =
  | { kind: 'arc'; cx: number; cy: number; angle: number; radius: number; halfAngle: number; inner: number }
  | { kind: 'circle'; cx: number; cy: number; radius: number };

function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function closestPoint(r: Rect, px: number, py: number): [number, number] {
  return [Math.max(r.x, Math.min(px, r.x + r.w)), Math.max(r.y, Math.min(py, r.y + r.h))];
}

function pointInArc(s: Extract<HitShape, { kind: 'arc' }>, px: number, py: number) {
  const dx = px - s.cx;
  const dy = py - s.cy;
  const d = Math.hypot(dx, dy);
  if (d > s.radius || d < s.inner) return false;
  if (d === 0 || s.halfAngle >= Math.PI) return true;
  return angleDiff(Math.atan2(dy, dx), s.angle) <= s.halfAngle;
}

export function shapeHitsRect(s: HitShape, r: Rect): boolean {
  const [qx, qy] = closestPoint(r, s.cx, s.cy);
  if (s.kind === 'circle') return Math.hypot(qx - s.cx, qy - s.cy) <= s.radius;
  // Sector vs rect: test the closest point plus a 3x3 grid of sample points on the rect.
  if (pointInArc(s, qx, qy)) return true;
  for (let i = 0; i <= 2; i++)
    for (let j = 0; j <= 2; j++) if (pointInArc(s, r.x + (r.w * i) / 2, r.y + (r.h * j) / 2)) return true;
  return false;
}

/** Outline points for debug drawing. */
export function shapeOutline(s: HitShape, segments = 12): [number, number][] {
  if (s.kind === 'circle')
    return Array.from({ length: segments + 1 }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      return [s.cx + Math.cos(a) * s.radius, s.cy + Math.sin(a) * s.radius];
    });
  const pts: [number, number][] = [[s.cx + Math.cos(s.angle - s.halfAngle) * s.inner, s.cy + Math.sin(s.angle - s.halfAngle) * s.inner]];
  for (let i = 0; i <= segments; i++) {
    const a = s.angle - s.halfAngle + (2 * s.halfAngle * i) / segments;
    pts.push([s.cx + Math.cos(a) * s.radius, s.cy + Math.sin(a) * s.radius]);
  }
  pts.push(pts[0]);
  return pts;
}
