// Quick travel between lit shrines (from a shrine's menu). The world pauses; the player comes apart into
// rising embers, the screen fades, the destination loads (arriving counts as a rest there), the screen
// clears and the player gathers back together out of the light.
import { DATA } from '../data/config';
import { TILE } from '../world/TileGrid';
import { check } from '../story/conditions';
import type { Cond } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

export interface WarpTarget {
  id: string;
  name: string;
  area: string;
  x: number;
  y: number;
}

/** Timeline (ticks). */
const FADE_OUT_END = 40; // player gone
const VEIL_IN = [26, 48] as const; // screen to black
const SWAP = 50; // move the player
const VEIL_OUT = [52, 72] as const; // screen back
const FADE_IN = [62, 96] as const; // player back
const DONE = 100;

/** Every lit shrine the player could travel to (in any area), except the one they're at. */
export function travelTargets(gs: GameScene, from: string): WarpTarget[] {
  const out: WarpTarget[] = [];
  const [ox, oy] = DATA.shrine.spawnOffset;
  for (const r of Object.values(DATA.rooms))
    for (const en of r.entities) {
      if (en.type !== 'shrine' || !en.id || en.id === from || !gs.flags.has(`shrine:${en.id}`)) continue;
      if (!check(gs.flags, en.when as Cond | undefined)) continue;
      out.push({
        id: en.id,
        name: String(en.name ?? en.id),
        area: r.area,
        x: (r.origin[0] + en.at[0]) * TILE + TILE / 2 + ox,
        y: (r.origin[1] + en.at[1]) * TILE + TILE - 2 + oy,
      });
    }
  return out;
}

export function beginWarp(gs: GameScene, to: WarpTarget) {
  gs.warp = { to, t: 0 };
  gs.bus.emit('sfx', { id: 'warp' });
}

/** Black screen amount (0..1) for the UI. */
export function warpVeil(gs: GameScene) {
  const w = gs.warp;
  if (!w) return 0;
  const ramp = (t: number, [a, b]: readonly [number, number]) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  return w.t < SWAP ? ramp(w.t, VEIL_IN) : 1 - ramp(w.t, VEIL_OUT);
}

/** Per tick while travelling (the world is paused meanwhile). */
export function tickWarp(gs: GameScene) {
  const w = gs.warp!;
  const p = gs.player;
  w.t++;
  if (w.t <= FADE_OUT_END) {
    p.fade = 1 - w.t / FADE_OUT_END;
    // Embers lift off the body, more of them as it goes.
    if (w.t % 2 === 0) gs.particles.burst(p.x + (Math.random() - 0.5) * 10, p.y - Math.random() * 20, 4, -Math.PI / 2, 0.6, 2, 40, w.t % 4 ? 'flame2' : 'wax2', false);
  }
  if (w.t === SWAP) {
    if (w.to.area !== gs.area) gs.loadArea(w.to.area);
    p.x = p.prevX = w.to.x;
    p.y = p.prevY = w.to.y;
    p.vx = p.vy = 0;
    gs.lastShrine = w.to.id; // arriving counts as resting here
    gs.restoreWorld();
    gs.particles.clear();
    gs.cam.snap();
    gs.save();
  }
  if (w.t >= FADE_IN[0] && w.t <= FADE_IN[1]) {
    p.fade = (w.t - FADE_IN[0]) / (FADE_IN[1] - FADE_IN[0]);
    if (w.t === FADE_IN[0]) {
      gs.particles.burst(p.x, p.y, 2, -Math.PI / 2, Math.PI * 2, 18, 50, 'wax2', false);
      gs.bus.emit('sfx', { id: 'rest', x: p.x, y: p.y });
    }
    if (w.t % 3 === 0) gs.particles.burst(p.x + (Math.random() - 0.5) * 12, p.y - 24 + Math.random() * 6, 2, Math.PI / 2, 0.5, 1, 30, 'flame2', false);
  }
  if (w.t >= DONE) {
    p.fade = 1;
    gs.warp = null;
    gs.controls.clearBuffer();
  }
}
