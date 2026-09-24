import { describe, expect, it } from 'vitest';
import { autotile, buildGrid, Cell } from '../src/world/TileGrid';
import { moveBox } from '../src/world/collision';
import { RoomData } from '../src/data/schemas';
import { resolveDir } from '../src/core/math';

const room = RoomData.parse({
  id: 'r',
  origin: [0, 0],
  legend: { '#': 'wall', '.': 'floor', ',': 'floor_moss' },
  tiles: [
    '#####',
    '#...#',
    '#.#.#',
    '#..,#',
    '#####',
  ],
});
const ts = { floor: [0], floor_moss: [1], wall_front: [2], wall_cap: Array.from({ length: 16 }, (_, i) => 100 + i) };

describe('room schema', () => {
  it('rejects ragged rows and unknown characters', () => {
    const bad = RoomData.safeParse({ id: 'x', origin: [0, 0], legend: { '#': 'wall' }, tiles: ['##', '#?#'] });
    expect(bad.success).toBe(false);
  });
});

describe('autotile', () => {
  const g = buildGrid([room]);
  const { statics, overhang } = autotile(g, ts);
  const at = (x: number, y: number) => statics.find(t => t.tx === x && t.ty === y)?.index;

  it('builds a padded grid', () => {
    expect(g.get(0, 0)).toBe(Cell.Wall);
    expect(g.get(1, 1)).toBe(Cell.Floor);
    expect(g.get(-1, -1)).toBe(Cell.Void);
  });
  it('draws brick fronts on walls with floor below, caps elsewhere', () => {
    expect(at(1, 0)).toBe(2); // north wall faces the room
    expect(at(0, 2)).toBeGreaterThanOrEqual(100); // west wall is seen from above
    expect(at(3, 3)).toBe(1); // moss floor
  });
  it('puts the cap of a 1-tile pillar on the floor cell above it, as an overhang', () => {
    expect(at(2, 2)).toBe(2); // pillar front face
    const cap = overhang.find(t => t.tx === 2 && t.ty === 1);
    expect(cap).toBeDefined();
    // open to E and W (2|8); N is the north wall's face, S is the pillar's own face
    expect(cap!.index).toBe(100 + 10);
  });
  it('places caps above the north wall in the padding row', () => {
    expect(at(1, -1)).toBeGreaterThanOrEqual(100);
  });
  it('shades floor along walls only when the tileset has shade tiles', () => {
    expect(autotile(g, ts).shade).toEqual([]);
    const { shade } = autotile(g, { ...ts, shade: Array.from({ length: 8 }, (_, i) => 200 + i) });
    const shadeAt = (x: number, y: number) => shade.find(t => t.tx === x && t.ty === y)?.index;
    expect(shadeAt(1, 1)).toBe(200 + 1 + 2 + 4); // north wall above, pillar cap to the east, west wall
    expect(shadeAt(3, 3)).toBe(200 + 2); // east wall beside
    expect(shadeAt(2, 3)).toBe(200 + 1); // below the pillar's face
    expect(shadeAt(2, 1)).toBeUndefined(); // under the pillar's cap: the overhang covers it
  });
});

describe('moveBox', () => {
  const g = buildGrid([room]);
  it('stops against walls and slides along them', () => {
    // feet at the middle of cell (1,1) = (24, 30); move far left into the west wall at x = 16
    const r = moveBox(g, 24, 30, 4, 5, -20, 0);
    expect(r.hitX).toBe(true);
    expect(r.x).toBe(20);
    const s = moveBox(g, 24, 30, 4, 5, -20, 3);
    expect(s.y).toBe(33);
  });
  it("treats the floor cell under a pillar's cap as solid", () => {
    // pillar front face at (2,2); its cap sits on floor cell (2,1)
    expect(g.isSolid(2, 1)).toBe(true);
    const r = moveBox(g, 24, 30, 4, 5, 20, 0);
    expect(r.hitX).toBe(true);
    expect(r.x).toBe(28);
  });
  it('stops at the floor edge moving down', () => {
    const r = moveBox(g, 24, 60, 4, 5, 0, 20);
    expect(r.hitY).toBe(true);
    expect(r.y).toBe(64);
  });
});

describe('resolveDir', () => {
  const five = ['S', 'SE', 'E', 'NE', 'N'];
  it('mirrors west-facing directions', () => {
    expect(resolveDir('W', five)).toEqual({ dir: 'E', flip: true });
    expect(resolveDir('SW', five)).toEqual({ dir: 'SE', flip: true });
    expect(resolveDir('S', five)).toEqual({ dir: 'S', flip: false });
  });
  it('falls back to the nearest authored direction', () => {
    expect(resolveDir('SW', ['S', 'E', 'N'])).toEqual({ dir: 'S', flip: false });
    expect(resolveDir('W', ['S', 'E', 'N'])).toEqual({ dir: 'E', flip: true });
  });
});
