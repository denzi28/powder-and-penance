// Townsfolk routines: every walk between stops stays on open ground (no walls, no solid scenery), and every
// chat pairs people whose routines actually bring them within earshot of each other at some point.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelGrid } from './levelGrid';
import { Cell, TILE } from '../src/world/TileGrid';
import { NpcStop } from '../src/data/schemas';

const areas = [...new Set(Object.values(DATA.rooms).map(r => r.area))];
type Placed = { id: string; room: string; points: [number, number][]; stops: [number, number][] };

function placements(area: string): Placed[] {
  const out: Placed[] = [];
  for (const r of Object.values(DATA.rooms).filter(x => x.area === area))
    for (const en of r.entities) {
      if (en.type !== 'npc' || !en.id) continue;
      const w = (p: readonly number[]): [number, number] => [r.origin[0] + p[0], r.origin[1] + p[1]];
      const stops = en.routine ? (en.routine as unknown[]).map(s => NpcStop.parse(s)) : [];
      const points = stops.flatMap(s => [...(s.via ?? []).map(w), w(s.at)]);
      out.push({ id: en.id, room: r.id, points: points.length ? points : [w(en.at)], stops: stops.length ? stops.map(s => w(s.at)) : [w(en.at)] });
    }
  return out;
}

describe('townsfolk', () => {
  it('walk only over open ground between their stops', () => {
    const bad: string[] = [];
    for (const area of areas) {
      const g = levelGrid(Object.values(DATA.rooms).filter(r => r.area === area));
      for (const p of placements(area)) {
        if (p.points.length < 2) continue;
        const loop = [...p.points, p.points[0]];
        for (let i = 1; i < loop.length; i++) {
          const [x0, y0] = loop[i - 1];
          const [x1, y1] = loop[i];
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4 + 1;
          for (let k = 0; k <= n; k++) {
            const tx = Math.round(x0 + ((x1 - x0) * k) / n);
            const ty = Math.round(y0 + ((y1 - y0) * k) / n);
            if (g.get(tx, ty) !== Cell.Floor || g.isSolid(tx, ty)) {
              bad.push(`${p.room}: ${p.id} walks through [${tx}, ${ty}] on its way from [${x0}, ${y0}] to [${x1}, ${y1}]`);
              break;
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('only chat with people their routines bring close', () => {
    const all = areas.flatMap(placements);
    const bad: string[] = [];
    for (const c of DATA.chatter.chats) {
      const people = c.who.map(id => all.find(p => p.id === id)!);
      const [first, ...rest] = people;
      for (const other of rest) {
        const close = first.stops.some(([ax, ay]) => other.stops.some(([bx, by]) => Math.hypot(ax - bx, ay - by) * TILE <= c.range));
        if (!close) bad.push(`${c.id}: ${first.id} and ${other.id} never stop within ${c.range} px of each other`);
      }
    }
    expect(bad).toEqual([]);
  });
});
