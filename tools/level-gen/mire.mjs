// Authoring helper for the Waxmire (area "mire"). Writes data/rooms/mire_*.json. Re-running OVERWRITES them.
//   node tools/level-gen/mire.mjs
//
// Tileset: tiles_mire. '#' root-bound earth bank, '.' mud, ',' swamp grass, '~' WAX (slows you), ':' flagstones.
//
//  [02 Sunken Graves]--[01 Mire Edge]--> Wick's Rest
//          |
//  [03 Lantern Walk]--[04 Drowned Chapel]--[05 Pip's Hollow]
//          |            (Drowned Wick)
//  [06 Wax Falls]--[07 Hanging Roots]--[08 The Sluice] (lever: shortcut up to the Abbey Undercroft)
//                         |
//                  [09 Choir Pool]
//                         |
//                  [10 Matron's Bath] (boss: the Mire Matron)
import fs from 'node:fs';

const legend = { '#': 'wall', '.': 'floor', ',': 'floor_grass', '~': 'floor_wax', ':': 'floor_stone', ' ': 'void' };

function room(id, origin, w, h) {
  const g = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  const entities = [];
  const r = {
    id, origin, w, h, g, entities,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; return r; },
    fill(x, y, fw, fh, c) { for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) r.set(x + i, y + j, c); return r; },
    bank(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '#'); },
    open(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '.'); },
    paint(x, y, fw, fh, c) {
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (g[y + j]?.[x + i] && g[y + j][x + i] !== '#') g[y + j][x + i] = c;
      return r;
    },
    add(e) { entities.push(e); return r; },
    decor(kind, x, y) { return r.add({ type: 'decor', kind, at: [x, y] }); },
    decors(kind, pts) { for (const [x, y] of pts) r.decor(kind, x, y); return r; },
    enemy(kind, x, y, facing = 'S') { return r.add({ type: 'enemy', kind, at: [x, y], facing }); },
    item(id, item, x, y) { return r.add({ type: 'item', id, item, at: [x, y] }); },
    spawn(id, x, y) { return r.add({ type: 'spawn', id, at: [x, y] }); },
  };
  return r;
}

const rooms = [];
const R = (...a) => { const r = room(...a); rooms.push(r); return r; };

// 01 Mire Edge: down from Wick's Rest. The first wax pools, and the first things under them.
R('mire_01_edge', [40, 0], 24, 16)
  .open(23, 6, 1, 2).open(0, 9, 1, 2)
  .bank(1, 1, 4, 3).bank(1, 12, 3, 3).bank(17, 12, 6, 3).bank(19, 1, 4, 2)
  .paint(1, 5, 22, 6, ',').paint(5, 3, 6, 4, '~').paint(11, 8, 7, 4, '~')
  .spawn('from_hub', 21, 6)
  .add({ type: 'exit', id: 'mire_to_hub', at: [23, 6], size: [1, 2], to: { area: 'hub', spawn: 'from_mire' } })
  .add({ type: 'cutscene', id: 'mire_arrive', script: 'mire_arrive', at: [19, 4], size: [4, 5] })
  .enemy('drowned_pilgrim', 7, 4, 'E').enemy('drowned_pilgrim', 14, 10, 'E').enemy('wickling', 9, 11, 'E')
  .decor('dead_willow', 6, 13).decor('dead_willow', 16, 3).decors('reeds', [[18, 5], [18, 11], [3, 8], [11, 2]])
  .decor('gravestone', 21, 11);

// 02 Sunken Graves: the Abbey's old graveyard, half under the wax. The drowned wait between the stones.
R('mire_02_graves', [17, 0], 24, 16)
  .open(23, 9, 1, 2).open(5, 15, 2, 1)
  .paint(1, 1, 22, 14, ',').paint(2, 8, 19, 3, '~').paint(4, 12, 6, 2, '~')
  .decors('gravestone', [[4, 3], [7, 3], [10, 3], [13, 3], [16, 3], [19, 3], [4, 6], [8, 6], [12, 6], [16, 6], [20, 6]])
  .decors('grave_cross', [[8, 12], [12, 12], [16, 12], [20, 12]])
  .decor('stone_angel', 12, 1).decor('coffin', 14, 9).decor('dead_willow', 2, 13)
  .enemy('drowned_pilgrim', 6, 9, 'E').enemy('drowned_pilgrim', 15, 9, 'W').enemy('drowned_pilgrim', 10, 13, 'N')
  .item('mire_tallow', 'tallow_lump', 21, 1);

// 03 Lantern Walk: Mire Lanterns sweep the reeds with their cold light. Stay out of the light (or in the
// reeds). If one sees you, everything here comes.
R('mire_03_lantern_walk', [12, 15], 28, 18)
  .open(10, 0, 2, 1).open(27, 6, 1, 2).open(6, 17, 2, 1)
  .paint(1, 1, 26, 16, ',').paint(3, 12, 6, 3, '~').paint(18, 8, 5, 3, '~').paint(9, 2, 4, 3, '~')
  .enemy('mire_lantern', 8, 5, 'E').enemy('mire_lantern', 20, 12, 'W')
  .enemy('wickling', 15, 5, 'S').enemy('wickling', 22, 15, 'N')
  .decors('reeds', [[4, 4], [5, 4], [12, 7], [13, 7], [14, 7], [17, 3], [18, 3], [22, 6], [6, 10], [7, 10], [15, 13], [16, 13], [23, 11], [11, 15], [3, 15]])
  .decor('root_tangle', 11, 11).decor('root_tangle', 25, 9).decor('dead_willow', 25, 15)
  .item('mire_pouch', 'ammo_pouch', 25, 2);

// 04 Drowned Chapel: a chapel the mire rose into. The Drowned Wick still burns on its altar step.
R('mire_04_chapel', [39, 15], 16, 14)
  .open(0, 6, 1, 2).open(15, 5)
  .paint(1, 1, 14, 12, ':').paint(2, 9, 4, 3, '~').paint(11, 10, 3, 2, '~')
  .add({ type: 'shrine', id: 'shrine_drowned', name: 'Drowned Wick', at: [8, 4] })
  .decor('stone_angel', 3, 2).decor('stone_angel', 12, 2).decor('altar', 9, 1)
  .decor('prayer_bench', 6, 8).decor('prayer_bench', 11, 8).decor('drowned_candles', 4, 11);

// 05 Pip's Hollow: a ring of floating candles. Pip hides inside it.
R('mire_05_hollow', [54, 15], 12, 12)
  .open(0, 5)
  .paint(1, 1, 10, 10, ',').paint(2, 8, 3, 2, '~')
  .add({ type: 'npc', id: 'pip_mire', npc: 'pip', talk: 'pip_mire', when: '!pip_rescued', at: [6, 5] })
  .decors('drowned_candles', [[4, 3], [8, 3], [4, 8], [8, 8]]).decors('reeds', [[2, 2], [9, 2]])
  .item('mire_shard', 'phial_shard', 10, 9);

// 06 Wax Falls: the ground steps down in tiers; wax pours over the edges. Hounds on the ledges.
R('mire_06_falls', [12, 32], 20, 22)
  .open(6, 0, 2, 1).open(19, 9, 1, 2)
  .bank(1, 6, 13, 1).bank(6, 12, 13, 1).bank(1, 17, 13, 1)
  .paint(1, 1, 18, 20, ',').paint(14, 1, 5, 5, '~').paint(14, 7, 5, 4, '~').paint(1, 13, 5, 3, '~').paint(14, 18, 5, 3, '~')
  .enemy('taper_hound', 4, 3, 'E').enemy('taper_hound', 15, 14, 'W').enemy('powder_acolyte', 9, 9, 'S').enemy('drowned_pilgrim', 3, 19, 'E')
  .decor('dead_willow', 2, 9).decor('reeds', 11, 3).decor('reeds', 8, 15).decor('gravestone', 10, 20);

// 07 Hanging Roots: a maze of roots. Wardens who came after runaways are stuck in the wax to the knees.
R('mire_07_roots', [31, 32], 24, 16)
  .open(0, 9, 1, 2).open(23, 5, 1, 2).open(12, 15, 2, 1)
  .paint(1, 1, 22, 14, ',').paint(7, 5, 6, 3, '~').paint(13, 10, 6, 3, '~')
  .decors('root_tangle', [[4, 3], [9, 2], [15, 3], [21, 3], [6, 9], [12, 8], [19, 9], [4, 13], [10, 13], [17, 13], [22, 12]])
  .enemy('bulwark_warden', 9, 6, 'W').enemy('bulwark_warden', 15, 11, 'W')
  .enemy('drowned_pilgrim', 19, 6, 'W').enemy('drowned_pilgrim', 8, 11, 'E');

// 08 The Sluice: a stone channel up to the Abbey. Its gate lever is down here: a shortcut once pulled.
R('mire_08_sluice', [54, 32], 14, 14)
  .open(0, 5, 1, 2).open(7, 0)
  .paint(1, 1, 12, 12, ':').paint(2, 8, 5, 4, '~')
  .add({
    type: 'exit', id: 'mire_sluice_up', at: [7, 0], size: [1, 1], to: { area: 'abbey', spawn: 'from_mire' },
    when: 'lever:mire_sluice',
    closed: 'A sluice gate, shut. Its lever must be down here somewhere.',
  })
  .add({ type: 'lever', id: 'mire_sluice', script: 'mire_sluice_lever', at: [9, 2] })
  .spawn('from_abbey', 7, 2)
  .enemy('drowned_pilgrim', 4, 9, 'N')
  .decor('sunken_bell', 3, 11).decor('drowned_candles', 10, 7)
  .item('mire_salt', 'bitter_salt', 11, 11);

// 09 Choir Pool: one great pool of wax. The drowned lie in a ring beneath it; a lantern keeps watch.
R('mire_09_choir', [31, 47], 24, 16)
  .open(12, 0, 2, 1).open(11, 15, 2, 1)
  .paint(1, 1, 22, 14, ',').paint(3, 3, 18, 10, '~')
  .enemy('mire_lantern', 12, 7, 'S')
  .enemy('drowned_pilgrim', 6, 5, 'E').enemy('drowned_pilgrim', 11, 4, 'S').enemy('drowned_pilgrim', 16, 5, 'W')
  .enemy('drowned_pilgrim', 18, 9, 'W').enemy('drowned_pilgrim', 12, 11, 'N').enemy('drowned_pilgrim', 6, 10, 'E')
  .decors('coffin', [[4, 13], [19, 13]]).decors('drowned_candles', [[3, 2], [20, 2], [9, 13], [15, 13]])
  .decor('stone_angel', 2, 8).decor('stone_angel', 21, 8);

// 10 Matron's Bath: her pool. Smoke seals the path behind you.
R('mire_10_bath', [31, 62], 24, 20)
  .open(11, 0, 2, 1)
  .paint(1, 1, 22, 18, ':').paint(4, 5, 16, 11, '~')
  .enemy('mire_matron', 12, 11, 'N')
  .add({ type: 'arena', id: 'matrons_bath', boss: 'mire_matron', seals: [[11, 0], [12, 0]], at: [0, 0] })
  .add({ type: 'shrine', id: 'shrine_matron', name: "Matron's Wick", at: [12, 3], when: 'boss:mire_matron' })
  .decors('stone_angel', [[3, 3], [20, 3], [3, 17], [20, 17]]).decors('drowned_candles', [[7, 3], [16, 3], [7, 17], [16, 17]]);

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'mire', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} room(s)`);
