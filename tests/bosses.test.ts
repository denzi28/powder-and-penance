// Boss rules: every boss arena gets a shrine once its boss falls, and multi-phase bosses are wired up.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';

describe('bosses', () => {
  const arenas = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'arena').map(e => ({ r, e })));
  const shrines = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'shrine').map(e => ({ r, e })));

  it('every boss arena has a shrine that appears when its boss falls, in the same area', () => {
    expect(arenas.length).toBeGreaterThan(0);
    for (const { r, e } of arenas) {
      const s = shrines.find(x => x.e.when === `boss:${String(e.boss)}`);
      expect(s, `shrine for ${String(e.boss)}`).toBeDefined();
      expect(s!.r.area, `shrine for ${String(e.boss)}`).toBe(r.area);
    }
  });

  it('a boss with a next phase names a boss, and a chest spot inside its arena room', () => {
    for (const { r, e } of arenas) {
      const next = DATA.enemies[String(e.boss)].boss?.next;
      if (!next) continue;
      expect(DATA.enemies[next.kind].boss, next.kind).toBeDefined();
      const [x, y] = next.chest.at;
      expect(r.tiles[y]?.[x], `chest at [${x},${y}] in ${r.id}`).not.toBe('#');
    }
  });
});
