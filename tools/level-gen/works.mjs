// Authoring helper for the Tallow Works (area "works"). Writes data/rooms/works_*.json. Re-running OVERWRITES them.
//   node tools/level-gen/works.mjs
//
// Tileset: tiles_works. '#' soot brick, '.' flagstones, ',' iron grate, '~' spilled tallow, '_' planks.
//
//  [01 Toll Gate]--[02 Receiving Pens]
//   (from hub)            |
//                  [03 Tallow Stores]--[04 Lift Shaft] (lift up to Wick's Rest once called)
//                   (cracked wall: to the Powder Vault)   |
//          [06 Hook Gallery]---------------[05 Scalding Floor]
//           |                 |
//  [07 Foreman's Office]=[08 Rendering Hall]--[09 Ember Flue]
//   (shrine, ledger; the door              |
//    opens from the office side)      [10 The Great Vat: Mother Tallow]
import fs from 'node:fs';

const legend = {
  '#': 'wall', '.': 'floor', ',': 'floor_grate', '~': 'floor_grease', '_': 'floor_plank', ' ': 'void',
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
    paint(x, y, fw, fh, c) {
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (g[y + j]?.[x + i] && g[y + j][x + i] !== '#') g[y + j][x + i] = c;
      return r;
    },
    add(e) { entities.push(e); return r; },
    decor(kind, x, y, flip = false) { return r.add({ type: 'decor', kind, at: [x, y], ...(flip ? { flip: true } : {}) }); },
    enemy(kind, x, y, facing = 'S') { return r.add({ type: 'enemy', kind, at: [x, y], facing }); },
    prop(kind, x, y) { return r.add({ type: 'prop', kind, at: [x, y] }); },
    item(id, item, x, y) { return r.add({ type: 'item', id, item, at: [x, y] }); },
    spawn(id, x, y) { return r.add({ type: 'spawn', id, at: [x, y] }); },
    exit(id, x, y, w2, h2, area, spawn, extra = {}) { return r.add({ type: 'exit', id, at: [x, y], size: [w2, h2], to: { area, spawn }, ...extra }); },
  };
  return r;
}

const rooms = [];
const R = (...a) => { const r = room(...a); rooms.push(r); return r; };

// 01 Toll Gate: the carters' road arrives at an iron gate. The booth where carts were counted; Wicklings in
// pilgrim robes still shuffle toward the vats.
R('works_01_toll_gate', [0, 0], 22, 14)
  .open(0, 6, 1, 2).open(21, 6, 1, 2)
  .wall(1, 1, 3, 3).wall(1, 10, 3, 3).wall(18, 1, 3, 2)
  .paint(0, 6, 22, 2, ',')
  .spawn('from_hub', 2, 6)
  .exit('works_to_hub', 0, 6, 1, 2, 'hub', 'from_works')
  .add({ type: 'cutscene', id: 'works_arrive', script: 'works_arrive', at: [1, 5], size: [3, 4] })
  .decor('toll_booth', 7, 4).decor('tallow_cart', 12, 10).decor('chain_heap', 15, 3).decor('pipe', 19, 11)
  .enemy('wickling', 13, 5, 'W').enemy('wickling', 16, 9, 'W')
  .prop('crate', 5, 11).prop('crate', 6, 11).prop('pot', 17, 4);

// 02 Receiving Pens: where the pilgrims waited. Empty cages, robes on racks with name tags. The first Renderer.
R('works_02_pens', [21, 0], 20, 14)
  .open(0, 6, 1, 2).open(8, 13, 2, 1)
  .paint(1, 6, 10, 2, ',').paint(8, 8, 2, 5, ',')
  .decor('cage', 4, 3).decor('cage', 8, 3).decor('cage', 12, 3).decor('cage', 16, 3)
  .decor('robe_rack', 5, 11).decor('robe_rack', 16, 11).decor('hook_chain', 11, 6).decor('hook_chain', 15, 8)
  .enemy('renderer', 13, 8, 'W').enemy('wickling', 5, 8, 'E')
  .item('works_tallow', 'tallow_lump', 18, 6)
  .prop('pot', 18, 9).prop('crate', 1, 11);

// 03 Tallow Stores: a maze of stacked tallow. Acolytes watch the aisles. A cracked section of the north
// wall hides the old heretics' workshop (the Powder Vault).
const stores = R('works_03_stores', [21, 13], 24, 16).open(8, 0, 2, 1).open(23, 7, 1, 2);
for (const [x0, x1, y] of [[3, 7, 4], [11, 15, 4], [19, 21, 4], [5, 9, 9], [13, 18, 9], [2, 4, 12], [9, 12, 12], [17, 20, 12]])
  for (let x = x0; x <= x1; x++) stores.decor('tallow_stack', x, y);
stores
  .paint(8, 1, 2, 2, ',').paint(20, 7, 3, 2, ',')
  .prop('cracked_wall', 21, 0)
  .exit('works_to_vault', 21, 0, 1, 1, 'vault', 'from_works')
  .enemy('powder_acolyte', 12, 2, 'S').enemy('powder_acolyte', 20, 11, 'W').enemy('vat_crawler', 10, 7, 'E')
  .item('works_shard', 'phial_shard', 2, 13)
  .prop('crate', 16, 2).prop('crate', 17, 2).prop('crate', 22, 13).prop('pot', 1, 7);

// 04 Lift Shaft: the lift up to Wick's Rest. It only runs once the lever down here has called the cage.
R('works_04_lift', [44, 13], 12, 16)
  .open(0, 7, 1, 2).open(4, 15, 2, 1)
  .paint(3, 2, 4, 3, ',')
  .decor('lift_cage', 4, 3).decor('pipe', 1, 12).decor('pipe', 10, 12).decor('chain_heap', 9, 6)
  .exit('works_lift_up', 4, 3, 2, 1, 'hub', 'from_works_lift', {
    when: 'lever:works_lift',
    closed: 'The lift cage hangs somewhere far above. The lever beside the shaft will call it down.',
  })
  .add({ type: 'lever', id: 'works_lift', script: 'works_lift_lever', at: [7, 3] })
  .spawn('from_hub_lift', 4, 5)
  .enemy('renderer', 6, 10, 'N');

// 05 Scalding Floor: great vats to hide behind, spilled tallow underfoot, and things crawling out of it.
R('works_05_scalding', [38, 28], 22, 14)
  .open(10, 0, 2, 1).open(0, 6, 1, 2)
  .paint(8, 6, 6, 3, '~').paint(2, 10, 5, 2, '~').paint(15, 2, 4, 2, '~')
  .decor('vat', 5, 4).decor('vat', 16, 5).decor('vat', 6, 11).decor('vat', 16, 11)
  .enemy('vat_crawler', 11, 8, 'N').enemy('vat_crawler', 19, 3, 'W').enemy('vat_crawler', 2, 9, 'E')
  .item('works_pouch', 'ammo_pouch', 20, 12)
  .prop('pot', 1, 1).prop('pot', 20, 1);

// 06 Hook Gallery: hooks hang in rows from the dark. Renderers work here.
const gallery = R('works_06_gallery', [17, 28], 22, 14).open(21, 6, 1, 2).open(5, 13).open(16, 13, 2, 1);
for (let x = 3; x <= 18; x += 3) gallery.decor('hook_chain', x, 3).decor('hook_chain', x + 1, 10);
gallery
  .paint(1, 6, 20, 2, ',')
  .decor('robe_rack', 4, 11).decor('robe_rack', 13, 1).decor('chain_heap', 19, 11)
  .enemy('renderer', 7, 4, 'E').enemy('renderer', 16, 9, 'W').enemy('wickling', 11, 6, 'E')
  .prop('crate', 1, 1).prop('crate', 20, 11);

// 07 Foreman's Office: the Foreman's Wick; his desk; the Chandler's Ledger. A door into the Rendering Hall
// that only opens from this side (a shortcut from the Hall back to the shrine).
R('works_07_office', [17, 41], 14, 11)
  .open(5, 0).open(13, 5)
  .paint(1, 1, 12, 9, '_').paint(5, 0, 1, 1, '_')
  .add({ type: 'shrine', id: 'shrine_foreman', name: "Foreman's Wick", at: [7, 3] })
  .add({ type: 'door', id: 'works_office_door', at: [13, 5], opensFrom: 'W' })
  .decor('desk', 4, 7).decor('bookshelf', 12, 1).decor('tallow_stack', 1, 9)
  .item('works_ledger', 'chandler_ledger', 2, 7)
  .prop('candles', 1, 1).prop('candles', 10, 8);

// 08 Rendering Hall: the heart of the Works, and the Act's twist (cutscene on entering).
R('works_08_hall', [30, 41], 26, 18)
  .open(3, 0, 2, 1).open(0, 5).open(25, 9)
  .paint(1, 8, 24, 2, ',').paint(9, 3, 6, 2, '~').paint(15, 13, 5, 2, '~')
  .add({ type: 'cutscene', id: 'rendering_reveal', script: 'rendering_reveal', at: [2, 1], size: [4, 3] })
  .add({ type: 'point', id: 'vats', at: [13, 8] })
  .decor('vat', 7, 5).decor('vat', 13, 5).decor('vat', 19, 5).decor('vat', 7, 14).decor('vat', 19, 14)
  .decor('robe_rack', 11, 12).decor('robe_rack', 16, 12).decor('furnace', 24, 3).decor('tallow_stack', 1, 15).decor('tallow_stack', 2, 15)
  .decor('hook_chain', 10, 10).decor('hook_chain', 16, 10)
  .enemy('renderer', 17, 9, 'W').enemy('vat_crawler', 9, 10, 'E').enemy('vat_crawler', 22, 15, 'N').enemy('powder_acolyte', 22, 2, 'S')
  .prop('crate', 24, 15).prop('pot', 1, 1);

// 09 Ember Flue: iron walkways over the furnaces. Hounds.
R('works_09_flue', [55, 41], 18, 18)
  .open(0, 9).open(7, 17, 2, 1)
  // the furnace pit: walls everywhere except the walkways
  .wall(1, 1, 16, 16)
  .open(1, 8, 9, 3).open(7, 3, 3, 14).open(10, 3, 6, 3).open(13, 6, 3, 6).open(7, 11, 8, 3)
  .paint(1, 8, 9, 3, ',').paint(7, 3, 3, 14, ',').paint(10, 3, 6, 3, ',').paint(13, 6, 3, 6, ',').paint(7, 11, 8, 3, ',')
  .enemy('taper_hound', 12, 4, 'W').enemy('taper_hound', 13, 12, 'W').enemy('renderer', 8, 5, 'S')
  .item('works_salt', 'bitter_salt', 15, 4);

// 10 The Great Vat: Mother Tallow's vat, and her arena. Smoke seals the stair behind you.
R('works_10_great_vat', [52, 58], 24, 20)
  .open(10, 0, 2, 1)
  .paint(6, 6, 12, 9, '~')
  .decor('vat', 3, 3).decor('vat', 20, 3).decor('vat', 3, 17).decor('vat', 20, 17).decor('furnace', 12, 18)
  .enemy('mother_tallow', 12, 10, 'N')
  // appears once she's gone for good
  .add({ type: 'shrine', id: 'shrine_great_vat', name: 'Great Vat Wick', at: [12, 5], when: 'boss:mother_tallow' })
  .add({ type: 'arena', id: 'great_vat', boss: 'mother_tallow', seals: [[10, 0], [11, 0]], at: [0, 0] });

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'works', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} room(s)`);
