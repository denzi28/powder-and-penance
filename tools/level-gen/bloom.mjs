// Authoring helper for Bloomhollow, the Apiary Orchard (area "bloom"). Writes data/rooms/bloom_*.json.
// Re-running OVERWRITES them.
//   node tools/level-gen/bloom.mjs
//
// Tileset: tiles_orchard. '#' honey-stone wall under a flowering hedge, '.' orchard grass, '=' orchard path,
// ',' meadow flowers, 'l' lavender, '~' HONEY (slows you), 'h' honeycomb paving, 'a' ash, 'p' floorboards,
// ':' flagstones.
//
//                     Penance Road (Collapsed Gate)
//                               |
//                      [01 Orchard Gate]
//                               |
//                      [02 Lavender Rows]----[03 Hive Walls]
//                               |                  |
//   (shrine: Press Wick) [04 Press House]----[05 Apple Walk]----[08 Orchard Chapel]
//                               |                  |
//                      [06 Mead Cellar]==>[07 Burned Grove]  (miniboss: the Scarecrow Warden)
//                        (door opens from the grove)  |
//                                          [09 Queen's Garden]
//                                                  |
//                                          [10 The Great Skep]  (boss: the Hive Queen)
import fs from 'node:fs';

const legend = {
  '#': 'wall', '.': 'floor', '=': 'floor_path', ',': 'floor_flowers', l: 'floor_lavender', '~': 'floor_honey',
  h: 'floor_comb', a: 'floor_ash', p: 'floor_plank', ':': 'floor_stone', ' ': 'void',
};

function room(id, origin, w, h) {
  const g = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  const entities = [];
  const r = {
    id, origin, w, h, g, entities,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; return r; },
    fill(x, y, fw, fh, c) { for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) r.set(x + i, y + j, c); return r; },
    wall(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '#'); },
    open(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '.'); },
    /** Repaint existing floor only (never turns walls into floor). */
    paint(x, y, fw, fh, c) {
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (g[y + j]?.[x + i] && g[y + j][x + i] !== '#') g[y + j][x + i] = c;
      return r;
    },
    add(e) { entities.push(e); return r; },
    decor(kind, x, y, flip = false) { return r.add({ type: 'decor', kind, at: [x, y], ...(flip ? { flip: true } : {}) }); },
    decors(kind, pts) { for (const [x, y] of pts) r.decor(kind, x, y); return r; },
    enemy(kind, x, y, facing = 'S', extra = {}) { return r.add({ type: 'enemy', kind, at: [x, y], facing, ...extra }); },
    prop(kind, x, y) { return r.add({ type: 'prop', kind, at: [x, y] }); },
    props(kind, pts) { for (const [x, y] of pts) r.prop(kind, x, y); return r; },
    swarm(x, y, kind = 'drones') { return r.add({ type: 'swarm', swarm: kind, at: [x, y] }); },
    item(id, item, x, y) { return r.add({ type: 'item', id, item, at: [x, y] }); },
    note(note, x, y) { return r.add({ type: 'note', note, at: [x, y] }); },
    spawn(id, x, y) { return r.add({ type: 'spawn', id, at: [x, y] }); },
  };
  return r;
}

const rooms = [];
const R = (...a) => { const r = room(...a); rooms.push(r); return r; };

// 01 Orchard Gate: down from the Penance Road. The orchard's burned gate, the Synod's notice nailed over its
// sign, and two scarecrows standing in the grass with their arms out. They are not scarecrows.
R('bloom_01_orchard_gate', [20, 0], 24, 16)
  .open(11, 0, 2, 1).open(6, 15, 2, 1)
  .wall(1, 1, 4, 3).wall(19, 1, 4, 2).wall(1, 12, 3, 3).wall(20, 11, 3, 4)
  .paint(11, 0, 2, 6, '=').paint(9, 6, 4, 2, '=').paint(7, 8, 3, 8, '=')
  .paint(14, 9, 5, 3, ',').paint(3, 5, 4, 3, ',').paint(15, 2, 3, 2, ',')
  .spawn('from_road', 11, 2)
  .add({ type: 'exit', id: 'bloom_to_road', at: [11, 0], size: [2, 1], to: { area: 'road', spawn: 'from_bloom' } })
  .add({ type: 'cutscene', id: 'bloom_arrive', script: 'bloom_arrive', at: [10, 2], size: [4, 3] })
  .add({ type: 'point', id: 'bloom_gate', at: [12, 5] })
  .add({ type: 'point', id: 'bloom_hive', at: [18, 3] })
  .decor('orchard_gate', 12, 5).decor('synod_notice', 9, 4)
  .decors('apple_tree', [[3, 9], [17, 6], [5, 13], [15, 13]]).decor('apple_tree_fruit', 19, 9)
  .decor('flower_bed', 16, 3).decor('hollyhocks', 6, 4).decor('lavender_bush', 13, 10).decor('fallen_skep', 10, 11)
  .enemy('orchard_guard', 5, 8, 'E').enemy('orchard_guard', 16, 10, 'W')
  .prop('hive', 18, 3);

// 02 Lavender Rows: row upon row of lavender, humming. Drone swarms over the flowers; husks tending them.
R('bloom_02_lavender_rows', [4, 15], 30, 18)
  .open(22, 0, 2, 1).open(29, 8, 1, 2).open(16, 17, 2, 1)
  .wall(1, 1, 3, 2).wall(26, 14, 3, 3).wall(1, 16, 2, 1)
  .paint(3, 3, 24, 2, 'l').paint(3, 7, 24, 2, 'l').paint(3, 11, 20, 2, 'l')
  .paint(22, 1, 2, 16, '=').paint(12, 5, 2, 12, '=').paint(12, 9, 18, 2, '=').paint(12, 13, 6, 2, '=')
  .paint(3, 13, 5, 3, '~')
  .decors('lavender_bush', [[2, 3], [2, 7], [27, 3], [27, 7], [2, 11], [23, 11]])
  .decor('skep_bench', 9, 15).decor('hive_box', 26, 12).decor('scarecrow', 18, 6).decor('apple_tree', 4, 1)
  .swarm(7, 4).swarm(18, 8)
  .enemy('beekeeper_husk', 16, 9, 'W').enemy('beekeeper_husk', 25, 13, 'N')
  .enemy('honey_slime', 5, 14, 'E')
  .item('bloom_honey', 'cache_honey', 27, 2)
  .note('note_hild_orchard', 20, 15);

// 03 Hive Walls: terraces of bee-boles cut into the honey-stone, straw hives on every ledge.
R('bloom_03_hive_walls', [33, 15], 24, 18)
  .open(0, 8, 1, 2).open(11, 17, 2, 1)
  .wall(1, 5, 15, 1).wall(8, 11, 15, 1)
  .paint(1, 1, 22, 4, ',').paint(1, 6, 22, 5, '.').paint(1, 12, 22, 5, '.')
  .paint(1, 8, 12, 2, '=').paint(10, 12, 3, 5, '=')
  .props('hive', [[3, 3], [7, 3], [11, 3], [18, 7], [20, 13], [4, 14]])
  .decors('skep_bench', [[15, 3], [6, 9]]).decor('hive_box', 21, 9).decor('frame_stack', 3, 7).decor('hollyhocks', 17, 1)
  .enemy('beekeeper_husk', 12, 8, 'W').enemy('beekeeper_husk', 16, 14, 'W').enemy('orchard_guard', 19, 3, 'S')
  .item('bloom_veil', 'gear_beekeepers_veil', 21, 2);

// 04 Press House: the orchard's wax press, where Hild still works. The Press Wick burns on the old hearth.
R('bloom_04_press_house', [12, 32], 18, 14)
  .open(8, 0, 2, 1).open(17, 6, 1, 2).open(5, 13, 2, 1)
  .paint(1, 1, 16, 12, 'p').paint(7, 1, 4, 3, ':').paint(4, 10, 4, 3, ':')
  .add({ type: 'shrine', id: 'shrine_press', name: 'Press Wick', at: [4, 4] })
  .add({
    type: 'npc', id: 'hild_press', npc: 'hild', talk: 'hild_talk', at: [11, 6],
    routine: [
      { at: [12, 5], do: 'work', ticks: 360 },
      { at: [14, 9], do: 'idle', ticks: 160 },
      { at: [9, 8], do: 'work', ticks: 300 },
      { at: [12, 5], do: 'idle', ticks: 120 },
    ],
  })
  .decor('wax_press', 14, 3).decor('honey_barrels', 3, 11).decor('mead_rack', 15, 11).decor('frame_stack', 8, 11)
  .decor('honey_cart', 16, 8).decor('votive_stand', 1, 2)
  .note('note_hild_ledger', 6, 2)
  .item('bloom_press_ingots', 'ingot_press', 1, 11);

// 05 Apple Walk: the orchard proper: rows of old apple trees, fruit rotting in the grass, scarecrows among
// them. Some of the scarecrows are only scarecrows.
R('bloom_05_apple_walk', [29, 32], 28, 18)
  .open(0, 6, 1, 2).open(15, 0, 2, 1).open(27, 8, 1, 2).open(20, 17, 2, 1)
  .paint(1, 6, 26, 2, '=').paint(15, 1, 2, 5, '=').paint(20, 8, 2, 9, '=').paint(22, 8, 5, 2, '=')
  .paint(2, 10, 8, 5, ',').paint(23, 12, 3, 4, ',').paint(10, 2, 4, 3, ',')
  .paint(12, 11, 5, 3, '~')
  .decors('apple_tree', [[3, 3], [7, 3], [19, 3], [23, 3], [3, 15], [11, 15], [16, 15], [25, 11]])
  .decors('apple_tree_fruit', [[11, 3], [7, 9], [15, 9], [25, 15]])
  .decor('scarecrow', 5, 12).decor('skep_bench', 18, 12).decor('fallen_skep', 13, 10)
  .props('hive', [[17, 11], [19, 11]])
  .enemy('orchard_guard', 9, 12, 'N').enemy('orchard_guard', 24, 5, 'W')
  .enemy('honey_slime', 14, 12, 'N')
  .swarm(4, 11)
  .item('bloom_orchard_ingot', 'ingot_orchard', 1, 1);

// 06 Mead Cellar: under the press house: casks, mead racks, honey pooled on the flags where the Synod's men
// broke the barrels. A door in the east wall leads to the burned grove (barred from beyond), and a way the
// Order sealed with tallow, which a beeswax light will melt.
R('bloom_06_mead_cellar', [8, 45], 22, 14)
  .open(9, 0, 2, 1).open(21, 7)
  .paint(1, 1, 20, 12, ':').paint(9, 5, 6, 4, '~').paint(15, 10, 4, 2, '~')
  .wall(6, 1, 1, 4).wall(1, 5, 6, 1) // a nook the Order walled up
  .set(3, 5, ':').add({ type: 'prop', kind: 'tallow_seal', at: [3, 5] })
  .add({ type: 'door', id: 'bloom_cellar_door', at: [21, 7], opensFrom: 'E' })
  .decors('mead_rack', [[8, 2], [16, 2]]).decors('honey_barrels', [[12, 12], [19, 3]]).decor('frame_stack', 7, 11)
  .enemy('honey_slime', 11, 6, 'N').enemy('honey_slime', 16, 11, 'W')
  .item('bloom_shard', 'phial_shard', 2, 3)
  .note('note_synod_ledger', 3, 10);

// 07 Burned Grove: where the Synod's men burned the old trees and the keeper's hives with them. The keeper's
// scarecrow still stands at the heart of it, in the keeper's own coat.
R('bloom_07_burned_grove', [29, 49], 28, 18)
  .open(20, 0, 2, 1).open(0, 3).open(13, 17, 2, 1)
  .paint(1, 1, 26, 16, 'a').paint(1, 3, 6, 1, '=').paint(20, 1, 2, 5, '=').paint(13, 12, 2, 5, '=')
  .paint(23, 13, 2, 1, ',').paint(22, 14, 4, 1, ',').paint(23, 15, 3, 1, ',') // one corner the fire missed
  .decors('burned_tree', [[4, 7], [9, 3], [18, 4], [24, 8], [5, 14], [22, 14], [10, 12]])
  .decors('charred_stump', [[13, 4], [17, 12], [7, 10]]).decors('ash_heap', [[15, 7], [20, 10]])
  .enemy('scarecrow_warden', 14, 8, 'S', { miniboss: { id: 'scarecrow_warden', title: 'The Scarecrow Warden', drop: 'gear_beekeepers_coat', hpMult: 1.3, tallow: 400 } })
  .note('note_decree', 3, 5)
  .item('bloom_grove_salt', 'salt_grove', 25, 15);

// 08 Orchard Chapel: "The Orchard Chapel welcomes all pilgrims." A beeswax altar, saints with hives in their
// arms, and husks still kneeling in the pews. The side chapel was sealed with tallow.
R('bloom_08_orchard_chapel', [56, 32], 16, 16)
  .open(0, 8, 1, 2)
  .paint(1, 1, 11, 14, 'h').paint(1, 8, 11, 2, ':')
  .wall(11, 1, 1, 4).wall(11, 5, 4, 1) // the side chapel, sealed
  .set(13, 5, ':').add({ type: 'prop', kind: 'tallow_seal', at: [13, 5] })
  .paint(12, 1, 3, 4, ':').paint(12, 6, 3, 9, 'h')
  .decor('bee_altar', 6, 2).decors('bee_saint', [[2, 2], [9, 2]]).decors('chapel_pew', [[4, 6], [9, 6], [4, 11], [9, 11]])
  .decors('votive_stand', [[2, 13], [10, 13]])
  .enemy('beekeeper_husk', 4, 5, 'N').enemy('beekeeper_husk', 9, 10, 'N')
  .note('note_chapel_hymn', 6, 4)
  .item('bloom_chapel_candles', 'cache_beeswax', 13, 2)
  .note('note_tallow_accounts', 12, 3);

// 09 Queen's Garden: the old queen-rearing garden, run wild: flowers to the waist, great hives, and the
// Queen's own guard in the air. Her skep is through the gate at the bottom.
R('bloom_09_queens_garden', [29, 66], 28, 18)
  .open(13, 0, 2, 1).open(5, 17, 2, 1)
  .paint(1, 1, 26, 16, ',').paint(13, 1, 2, 7, '=').paint(5, 7, 10, 2, '=').paint(5, 9, 2, 8, '=')
  .paint(18, 11, 5, 3, '~')
  .wall(9, 12, 12, 1).wall(20, 4, 1, 8)
  .props('hive', [[3, 3], [10, 3], [23, 3], [16, 14], [24, 15]])
  .decors('hollyhocks', [[1, 1], [26, 1], [1, 15]]).decors('flower_bed', [[18, 7], [25, 10]]).decor('bee_saint', 9, 15)
  .swarm(17, 3).swarm(23, 13, 'queens_guard')
  .enemy('beekeeper_husk', 9, 5, 'S').enemy('beekeeper_husk', 16, 9, 'W').enemy('orchard_guard', 24, 6, 'W');

// 10 The Great Skep: the Queen's hive, a straw hall taller than a house, honey welling from its door. She
// waits before it. Smoke seals the gate behind you.
R('bloom_10_great_skep', [31, 83], 24, 20)
  .open(3, 0, 2, 1)
  .paint(1, 1, 22, 18, 'h').paint(1, 1, 22, 2, ',').paint(1, 16, 22, 3, ',')
  .paint(3, 12, 5, 3, '~').paint(16, 13, 5, 3, '~').paint(9, 6, 7, 2, '~')
  .decor('great_skep', 12, 4).decors('bee_saint', [[5, 3], [19, 3]]).decors('votive_stand', [[2, 9], [21, 9]])
  .enemy('hive_queen', 12, 10, 'N')
  .add({ type: 'arena', id: 'great_skep', boss: 'hive_queen', seals: [[3, 0], [4, 0]], at: [0, 0] })
  .add({ type: 'shrine', id: 'shrine_queen', name: "Queen's Wick", at: [12, 13], when: 'boss:hive_queen' });

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'bloom', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} room(s)`);
