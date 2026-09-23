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
  // the opening cutscene (plays where you wake), and Oskar locked in the wagon cage until you free him
  .add({ type: 'cutscene', id: 'wreck_intro', script: 'wreck_intro', at: [12, 11], size: [1, 1] })
  .add({ type: 'point', id: 'wagon', at: [8, 7] })
  .add({ type: 'npc', id: 'oskar_wreck', npc: 'oskar', talk: 'oskar_wreck', when: '!oskar_freed', at: [9, 7] });

// road_02 The Cutting — a narrow, winding road between cliffs. One Wickling stands on the road facing you:
// the first fight (attack, roll). A guard who ran this way didn't make it.
R('road_02_cutting', [29, 3], 36, 12)
  .open(0, 6, 1, 2).open(35, 4, 1, 2)
  .cliff(1, 1, 34, 2).cliff(1, 9, 34, 2)
  .cliff(1, 3, 6, 2).cliff(1, 8, 4, 1).cliff(9, 3, 5, 1).cliff(14, 7, 6, 2).cliff(20, 3, 4, 2)
  .cliff(26, 7, 9, 2).cliff(30, 3, 5, 1)
  .grassEdges()
  .paint(0, 6, 14, 2, '=').paint(14, 4, 6, 2, '=').paint(20, 5, 6, 2, '=').paint(26, 4, 10, 2, '=')
  .enemy('wickling', 12, 6, 'W')
  // the guard who ran east with the cage key: it's in his satchel beside him
  .add({ type: 'item', id: 'road_cage_key', item: 'cage_key', at: [6, 5] })
  .decor('guard_dead', 5, 6, true).decor('boulder', 7, 4).decor('boulder', 18, 6).decor('dead_tree', 24, 4)
  .decor('grass_tuft', 3, 5).decor('grass_tuft', 16, 3).decor('grass_tuft', 28, 6).decor('grass_tuft', 33, 6)
  .prop('pot', 33, 6).prop('pot', 22, 7);

// road_03 Gibbet Bend — the road bends down into a wide hollow hung with gibbets. Three Wicklings keep
// watch; the first stands at the bend with its back to you (backstab). Tall rocks hide you; once one sees
// you, the whole hollow knows. A side path along the northern ledge leads to a Powder Pouch.
R('road_03_gibbet_bend', [64, 2], 32, 22)
  .open(0, 5, 1, 2).open(31, 15, 1, 2)
  .cliff(1, 1, 30, 2).cliff(1, 3, 8, 2).cliff(1, 7, 5, 3).cliff(1, 10, 3, 9)
  .cliff(9, 3, 5, 4).cliff(14, 7, 14, 1) // the ledge: open above row 7, reached only from its east end
  .cliff(1, 19, 12, 2).cliff(13, 20, 13, 1).cliff(26, 19, 5, 2)
  .grassEdges()
  .paint(0, 5, 9, 2, '=').paint(6, 7, 2, 5, '=').paint(6, 12, 19, 2, '=').paint(24, 14, 2, 1, '=').paint(24, 15, 8, 2, '=')
  .enemy('wickling', 10, 11, 'E').enemy('wickling', 18, 14, 'N').enemy('wickling', 26, 17, 'W')
  .decor('gibbet', 13, 10).decor('gibbet', 19, 18).decor('gibbet', 27, 11)
  .decor('rock_large', 12, 16).decor('rock_large', 21, 10).decor('rock_large', 23, 17).decor('boulder', 16, 16).decor('boulder', 8, 14)
  .decor('dead_tree', 24, 9).decor('dead_tree', 5, 16)
  .decor('grass_tuft', 7, 18).decor('grass_tuft', 15, 9).decor('grass_tuft', 29, 17).decor('grass_tuft', 20, 4).decor('grass_tuft', 26, 5)
  .add({ type: 'item', id: 'road_pouch', item: 'ammo_pouch', at: [16, 4] })
  .prop('crate', 29, 13).prop('pot', 4, 12);

// road_04 Collapsed Gate — the old toll arch has fallen across the road. A Taper Hound and a Wickling hold
// the far side: the first fight against two at once. A Phial Shard lies on the ledge to the north-east.
R('road_04_collapsed_gate', [95, 12], 26, 18)
  .open(0, 5, 1, 2).open(25, 12, 1, 2)
  .cliff(1, 1, 24, 2).cliff(1, 3, 4, 2).cliff(12, 3, 2, 3).cliff(14, 5, 9, 1) // the ledge, open at its east end
  .cliff(1, 9, 2, 5).cliff(1, 14, 10, 3).cliff(18, 15, 7, 2)
  .grassEdges()
  .paint(0, 5, 7, 2, '=').paint(5, 7, 2, 2, '=').paint(5, 9, 17, 2, '=').paint(20, 11, 2, 1, '=').paint(20, 12, 6, 2, '=')
  // the gate: two broken pillars, rubble between them, the lintel lying on the road's west side
  .decor('pillar_ruin', 11, 6).decor('pillar_ruin', 11, 12).decor('boulder', 11, 7).decor('boulder', 11, 11)
  .decor('lintel', 7, 12)
  .enemy('taper_hound', 17, 8, 'W').enemy('wickling', 19, 11, 'W')
  .add({ type: 'item', id: 'road_shard', item: 'phial_shard', at: [16, 3] })
  .decor('guard_dead', 14, 12).decor('dead_tree', 21, 7).decor('candle_cairn', 3, 7)
  .decor('grass_tuft', 6, 12).decor('grass_tuft', 15, 13).decor('grass_tuft', 23, 9).decor('grass_tuft', 19, 3)
  .prop('crate', 22, 14).prop('pot', 4, 12);

// road_05 Hill of Candles — the road climbs in switchbacks toward Wick's Rest, lined with pilgrims' candle
// cairns. No enemies: a breather, and the first view of the Abbey (cutscene). The pilgrims' terrace below the
// path holds the road's only shrine. Exit north to the hub.
R('road_05_hill_of_candles', [120, 16], 22, 20)
  .open(0, 8, 1, 2).open(10, 0, 2, 1)
  // the NE mass stops at row 3 so the upper path (rows 4-5) is two tiles high; row 6 lies under the ridge's cap
  .cliff(1, 1, 8, 6).cliff(13, 1, 8, 3).cliff(1, 10, 6, 9).cliff(7, 15, 14, 4)
  .cliff(7, 11, 9, 1).cliff(7, 7, 13, 1) // switchback ridges
  .grassEdges()
  .paint(0, 8, 20, 2, '=').paint(19, 4, 2, 5, '=').paint(9, 4, 12, 2, '=').paint(10, 0, 2, 5, '=')
  .decor('candle_cairn', 2, 7).decor('candle_cairn', 5, 7)
  .decor('candle_cairn', 9, 2).decor('candle_cairn', 12, 2)
  .decor('candle_cairn', 9, 13).decor('candle_cairn', 12, 14).decor('candle_cairn', 15, 12).decor('candle_cairn', 18, 13)
  .decor('signpost', 20, 9).decor('dead_tree', 17, 13)
  .decor('grass_tuft', 3, 7).decor('grass_tuft', 20, 11).decor('grass_tuft', 14, 13).decor('grass_tuft', 10, 3)
  .add({ type: 'shrine', id: 'shrine_hill', name: 'Hill Wick', at: [13, 12] })
  .add({ type: 'cutscene', id: 'abbey_view', script: 'abbey_view', at: [19, 5], size: [2, 3] })
  .add({ type: 'point', id: 'hill_top', at: [10, 2] })
  // up to Wick's Rest
  .add({ type: 'exit', id: 'road_to_hub', at: [10, 0], size: [2, 1], to: { area: 'hub', spawn: 'from_road' } })
  .add({ type: 'spawn', id: 'from_hub', at: [10, 1] });

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'road', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} room(s)`);
