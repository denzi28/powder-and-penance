// One-shot authoring helper for The Guttering Abbey (area "abbey"). Writes data/rooms/abbey_*.json.
// The JSON files are the source of truth: edit them directly. Re-running this OVERWRITES them.
//   node tools/level-gen/abbey.mjs
//
// Layout (tile coords; rooms share their border walls; gaps are doorways):
//
//   [12 Nave]                 [1 Porch*]=door=[2 Courtyard]--[3 Cloister]--[4 Bell Passage]
//      |                          ||              |                              |
//   [11 Nave Approach]--[10 Undercroft]   [2b Side Chapel]               [5 Crypt Stair]
//   (shortcut gate 10 -> 1:   |                                                  |
//    opens from the south)  [9 Scriptorium]--[8 Chapterhouse*]=door=[7 Gatehouse]--[6 Ossuary]
//   * = Wick Shrine
import fs from 'node:fs';

const legend = { '#': 'wall', '.': 'floor', ',': 'floor_moss', ' ': 'void' };

function room(id, origin, w, h) {
  const g = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  const entities = [];
  const r = {
    id, origin, w, h, g, entities,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; return r; },
    fill(x, y, fw, fh, c) { for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) r.set(x + i, y + j, c); return r; },
    /** Open a doorway in the border wall. */
    gap(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '.'); },
    moss(x, y, fw, fh) { for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (g[y + j]?.[x + i] === '.') g[y + j][x + i] = ','; return r; },
    pillar(x, y, s = 1) { return r.fill(x, y, s, s, '#'); },
    add(e) { entities.push(e); return r; },
    enemy(kind, x, y, facing = 'S') { return r.add({ type: 'enemy', kind, at: [x, y], facing }); },
    prop(kind, x, y) { return r.add({ type: 'prop', kind, at: [x, y] }); },
  };
  return r;
}

const rooms = [];
const R = (...a) => { const r = room(...a); rooms.push(r); return r; };

// 1 Porch — first shrine, safe. Door east to the courtyard; barred shortcut gate south.
R('abbey_01_porch', [0, 20], 22, 16)
  .gap(21, 7).add({ type: 'door', id: 'abbey_door_porch', at: [21, 7] })
  .gap(8, 15).add({ type: 'door', id: 'abbey_gate_undercroft', at: [8, 15], opensFrom: 'S' })
  // north doorway: down the Hill Stair to Wick's Rest (the west wall is shared with the Nave)
  .gap(10, 0).add({ type: 'exit', id: 'abbey_to_hub', at: [10, 0], to: { area: 'hub', spawn: 'from_abbey' } })
  .add({ type: 'spawn', id: 'from_hub', at: [10, 2] })
  .add({ type: 'spawn', id: 'default', at: [10, 10] })
  .add({ type: 'shrine', id: 'shrine_porch', name: 'Porch Wick', at: [6, 6] })
  .pillar(14, 4, 2).pillar(14, 10, 2).moss(2, 11, 5, 3)
  .prop('candles', 4, 5).prop('candles', 8, 5).prop('pot', 2, 13).prop('pot', 18, 13);

// 2 Courtyard — Wicklings among the columns.
R('abbey_02_courtyard', [21, 16], 30, 24)
  .gap(0, 11).gap(10, 23, 2, 1).gap(29, 8, 1, 3)
  .pillar(6, 5, 2).pillar(6, 15, 2).pillar(20, 5, 2).pillar(20, 15, 2).pillar(13, 10, 2)
  .moss(9, 2, 6, 3).moss(16, 17, 7, 4).moss(24, 9, 4, 5)
  .enemy('wickling', 10, 10, 'S').enemy('wickling', 23, 12, 'W').enemy('wickling', 14, 19, 'N')
  .prop('crate', 2, 2).prop('crate', 3, 2).prop('crate', 27, 21).prop('pot', 26, 2).prop('pot', 2, 21).prop('pot', 17, 9);

// 2b Side chapel — optional: a Phial Shard guarded by a hound.
R('abbey_02b_chapel', [26, 39], 12, 10)
  .gap(5, 0, 2, 1)
  .add({ type: 'item', id: 'abbey_shard', item: 'phial_shard', at: [6, 6] })
  .enemy('taper_hound', 3, 5, 'E')
  .prop('candles', 2, 2).prop('candles', 9, 2).prop('candles', 9, 7).moss(1, 6, 3, 2);

// 3 Cloister — first Bulwark Warden. Colonnades to hide behind and flank.
const cloister = R('abbey_03_cloister', [50, 16], 26, 18).gap(0, 8, 1, 3).gap(25, 7, 1, 3);
for (let x = 4; x <= 21; x += 4) cloister.pillar(x, 4).pillar(x, 13);
cloister.moss(8, 7, 10, 4)
  .enemy('bulwark_warden', 13, 9, 'W').enemy('wickling', 20, 6, 'S')
  .prop('pot', 2, 2).prop('pot', 23, 15).prop('crate', 23, 2);

// 4 Bell Passage — a corridor held by two Powder Acolytes; crates for cover.
R('abbey_04_bell_passage', [75, 20], 20, 10)
  .gap(0, 3, 1, 3).gap(15, 9, 3, 1)
  .fill(5, 1, 1, 2, '#').fill(10, 7, 1, 2, '#')
  .enemy('powder_acolyte', 16, 3, 'W').enemy('powder_acolyte', 17, 6, 'W')
  .prop('crate', 7, 4).prop('crate', 8, 6).prop('crate', 12, 3).prop('pot', 3, 7);

// 5 Crypt Stair — hounds.
R('abbey_05_crypt_stair', [86, 29], 12, 16)
  .gap(4, 0, 3, 1).gap(4, 15, 3, 1)
  .pillar(2, 5).pillar(9, 5).pillar(2, 10).pillar(9, 10)
  .enemy('taper_hound', 4, 8, 'N').enemy('taper_hound', 8, 11, 'N')
  .prop('candles', 1, 1).prop('candles', 10, 13);

// 6 Ossuary — the Belfry Brute, and Bitter Salt behind it.
R('abbey_06_ossuary', [74, 44], 26, 18)
  .gap(16, 0, 3, 1).gap(0, 8, 1, 3)
  .pillar(6, 4, 2).pillar(18, 4, 2).pillar(6, 12, 2).pillar(18, 12, 2)
  .moss(10, 13, 6, 3)
  .enemy('belfry_brute', 13, 9, 'N')
  .add({ type: 'item', id: 'abbey_salt', item: 'bitter_salt', at: [22, 15] })
  .prop('crate', 2, 2).prop('crate', 3, 2).prop('crate', 2, 3).prop('pot', 23, 2).prop('pot', 22, 2).prop('pot', 2, 15).prop('crate', 12, 15);

// 7 Gatehouse — the Tollwarden's arena. Smoke seals both doorways when you walk in.
R('abbey_07_gatehouse', [50, 46], 25, 16)
  .gap(24, 6, 1, 3).gap(0, 9)
  .fill(8, 3, 1, 3, '#').fill(8, 10, 1, 3, '#')
  .enemy('tollwarden', 15, 8, 'E')
  .add({ type: 'shrine', id: 'shrine_gatehouse', name: 'Gatehouse Wick', at: [18, 4], when: 'boss:tollwarden' })
  .add({ type: 'arena', id: 'gatehouse', boss: 'tollwarden', seals: [[24, 6], [24, 7], [24, 8], [0, 9]], at: [0, 0] })
  .add({ type: 'item', id: 'abbey_pouch', item: 'ammo_pouch', at: [3, 13] })
  .prop('pot', 2, 2).prop('pot', 22, 13);

// 8 Chapterhouse — second shrine, behind a door.
R('abbey_08_chapterhouse', [38, 50], 13, 12)
  .gap(12, 5).add({ type: 'door', id: 'abbey_door_chapter', at: [12, 5] })
  .gap(0, 4, 1, 3)
  .add({ type: 'shrine', id: 'shrine_chapter', name: 'Chapterhouse Wick', at: [6, 4] })
  .prop('candles', 3, 2).prop('candles', 9, 2).prop('candles', 3, 9).prop('candles', 9, 9);

// 9 Scriptorium — a mixed patrol among the writing desks.
const scrip = R('abbey_09_scriptorium', [8, 48], 31, 16).gap(30, 6, 1, 3).gap(3, 0, 2, 1);
for (const x of [6, 12, 18, 24]) scrip.fill(x, 4, 1, 2, '#').fill(x, 10, 1, 2, '#');
scrip.moss(13, 7, 5, 2)
  .enemy('powder_acolyte', 4, 5, 'E').enemy('wickling', 15, 8, 'W').enemy('wickling', 25, 12, 'N').enemy('bulwark_warden', 10, 12, 'E')
  .add({ type: 'item', id: 'abbey_tallow', item: 'tallow_lump', at: [2, 13] })
  .prop('crate', 27, 2).prop('crate', 28, 2).prop('pot', 20, 13).prop('pot', 9, 2).prop('crate', 2, 8);

// 10 Undercroft — the shortcut gate up to the porch is in its north wall; it can only be opened from here.
R('abbey_10_undercroft', [0, 35], 16, 14)
  .gap(8, 0).gap(11, 13, 2, 1).gap(0, 6, 1, 3)
  // the sluice down to the Waxmire: shut until its lever (down in the mire) is pulled
  .gap(4, 13)
  .add({ type: 'exit', id: 'abbey_sluice_down', at: [4, 13], to: { area: 'mire', spawn: 'from_abbey' }, when: 'lever:mire_sluice', closed: 'A sluice channel runs down into the dark, its gate shut from below.' })
  .add({ type: 'spawn', id: 'from_mire', at: [4, 12] })
  .pillar(4, 4).pillar(11, 4).pillar(4, 9).pillar(11, 9)
  .enemy('taper_hound', 8, 7, 'S').enemy('wickling', 3, 11, 'E')
  .prop('crate', 13, 2).prop('pot', 2, 2).moss(6, 10, 4, 2);

// 11 Nave Approach
R('abbey_11_nave_approach', [-20, 37], 21, 12)
  .gap(20, 4, 1, 3).gap(9, 0, 3, 1)
  .pillar(5, 3, 2).pillar(14, 3, 2).pillar(5, 7, 2).pillar(14, 7, 2)
  .enemy('wickling', 10, 6, 'E').enemy('wickling', 8, 9, 'E').enemy('powder_acolyte', 10, 2, 'S')
  .prop('pot', 1, 1).prop('pot', 19, 10).prop('candles', 1, 10);

// 12 Nave — the boss arena (boss, smoke veil and bar arrive in M6). Empty for now.
const nave = R('abbey_12_nave', [-20, 20], 21, 18).gap(9, 17, 3, 1);
for (const [x, y] of [[4, 4], [16, 4], [4, 12], [16, 12]]) nave.pillar(x, y);
nave.moss(7, 6, 7, 5).prop('candles', 9, 2).prop('candles', 11, 2);

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'abbey', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} rooms`);
