// Authoring helper for the Penance Road (area "road"). Writes data/rooms/road_*.json.
// Rooms are added here one at a time (see WORLD.md). Re-running OVERWRITES the road JSON files.
//   node tools/level-gen/road.mjs
//
// Tileset: tiles_road. '#' earth cliff, '.' dirt, ',' grass, '=' cart road.
import fs from 'node:fs';

const legend = { '#': 'wall', '.': 'floor', ',': 'floor_grass', '=': 'floor_road', ' ': 'void' };

function room(id, origin, w, h) {
  const g = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  const entities = [];
  const r = {
    id, origin, w, h, g, entities,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; return r; },
    fill(x, y, fw, fh, c) { for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) r.set(x + i, y + j, c); return r; },
    /** Cliff mass (wall). */
    cliff(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '#'); },
    /** Open ground (dirt). */
    open(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '.'); },
    /** Repaint existing floor only (never turns walls into floor). */
    paint(x, y, fw, fh, c) {
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (g[y + j]?.[x + i] && g[y + j][x + i] !== '#') g[y + j][x + i] = c;
      return r;
    },
    /** Grass along every floor cell that touches a cliff. */
    grassEdges() {
      const wall = (x, y) => g[y]?.[x] === '#' || g[y]?.[x] === undefined;
      const snap = g.map(row => [...row]);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (snap[y][x] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => wall(x + dx, y + dy))) g[y][x] = ',';
      return r;
    },
    add(e) { entities.push(e); return r; },
    decor(kind, x, y, flip = false) { return r.add({ type: 'decor', kind, at: [x, y], ...(flip ? { flip: true } : {}) }); },
    enemy(kind, x, y, facing = 'S') { return r.add({ type: 'enemy', kind, at: [x, y], facing }); },
    prop(kind, x, y) { return r.add({ type: 'prop', kind, at: [x, y] }); },
  };
  return r;
}

const rooms = [];
const R = (...a) => { const r = room(...a); rooms.push(r); return r; };

// road_01 The Wreck — the game starts here. A ravine at dusk; the prison wagon lies on its side across the
// road where fallen rocks stopped it. No enemies: move, look around, pick up a weapon. Exit east.
R('road_01_wreck', [0, 0], 30, 17)
  // ravine walls: jagged cliff lines top and bottom, a rocky dead end to the west
  .cliff(1, 1, 6, 2).cliff(1, 3, 3, 1).cliff(1, 4, 2, 1).cliff(12, 1, 5, 1).cliff(13, 2, 3, 1)
  .cliff(22, 1, 7, 1).cliff(24, 2, 5, 1).cliff(27, 3, 2, 1)
  .cliff(1, 12, 2, 4).cliff(3, 14, 5, 2).cliff(11, 15, 6, 1).cliff(12, 14, 3, 1).cliff(21, 14, 8, 2).cliff(25, 13, 4, 1)
  .grassEdges()
  // the cart road, bending gently down toward the east exit
  .paint(3, 7, 8, 2, '=').paint(11, 8, 9, 2, '=').paint(20, 9, 9, 2, '=')
  .open(29, 9, 1, 2).paint(29, 9, 1, 2, '=')
  .add({ type: 'spawn', id: 'default', at: [12, 11] })
  // the wreck: wagon on its side on the road, its horse dead in the traces, guards where they fell
  .decor('wagon', 8, 8).decor('horse', 14, 8).decor('guard_dead', 6, 11).decor('guard_dead', 17, 6, true)
  .decor('wheel_debris', 11, 12).decor('wheel_debris', 4, 9, true)
  .add({ type: 'weapon', id: 'road_wreck_sword', weapon: 'straight_sword', at: [7, 11] })
  .add({ type: 'weapon', id: 'road_wreck_pistol', weapon: 'flintlock', at: [18, 6] })
  // the rockfall that stopped the wagon, and scenery
  .decor('boulder', 16, 4).decor('boulder', 19, 3).decor('boulder', 5, 5).decor('boulder', 23, 12)
  .decor('dead_tree', 9, 3).decor('dead_tree', 26, 6).decor('signpost', 25, 12)
  .prop('crate', 10, 11).prop('crate', 5, 10).prop('pot', 20, 12)
  // story hooks (story systems milestone): the crash cutscene; Oskar locked in the wagon cage
  .add({ type: 'cutscene', id: 'wreck_intro', at: [12, 11] })
  .add({ type: 'npc', id: 'oskar', at: [8, 7] });

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'road', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} room(s)`);
