// Authoring helper for Wick's Rest (area "hub"). Writes data/rooms/hub_*.json. Re-running OVERWRITES them.
//   node tools/level-gen/hub.mjs
//
// Tileset: tiles_road. '#' earth cliff, '.' dirt, ',' grass, '=' cart road, '_' planks, ':' flagstones.
//
//        [hub_02 Chapel]   [hub_03 Hill Stair] --north--> Abbey Porch
//               |                  |
//   Waxmire <-- [hub_01 Waystation Yard] --Toll Gate--> Tallow Works
//                         |
//                   Penance Road
import fs from 'node:fs';

const legend = {
  '#': 'wall', '.': 'floor', ',': 'floor_grass', '=': 'floor_road', '_': 'floor_plank', ':': 'floor_stone', ' ': 'void',
};

function room(id, origin, w, h) {
  const g = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  const entities = [];
  const r = {
    id, origin, w, h, g, entities,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; return r; },
    fill(x, y, fw, fh, c) { for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) r.set(x + i, y + j, c); return r; },
    cliff(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '#'); },
    open(x, y, fw = 1, fh = 1) { return r.fill(x, y, fw, fh, '.'); },
    paint(x, y, fw, fh, c) {
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (g[y + j]?.[x + i] && g[y + j][x + i] !== '#') g[y + j][x + i] = c;
      return r;
    },
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
    prop(kind, x, y) { return r.add({ type: 'prop', kind, at: [x, y] }); },
    spawn(id, x, y) { return r.add({ type: 'spawn', id, at: [x, y] }); },
    exit(id, x, y, w2, h2, area, spawn) { return r.add({ type: 'exit', id, at: [x, y], size: [w2, h2], to: { area, spawn } }); },
    npc(id, x, y) { return r.add({ type: 'npc', id, at: [x, y] }); },
  };
  return r;
}

const rooms = [];
const R = (...a) => { const r = room(...a); rooms.push(r); return r; };

// hub_01 Waystation Yard — the heart of Act 1. The shrine and campfire at the crossroads; Oskar's stall
// (once he's freed) to the north-east; tents and a well for the pilgrims who stopped here and never left.
// South: back down to the road. West: the Waxmire. East: the Toll Gate (Toll Key), then the carters' road
// to the Tallow Works. North: the Hill Stair up to the Abbey; north-west: Maudlin's chapel.
R('hub_01_yard', [0, 10], 34, 24)
  // doorways: chapel (N-W), Hill Stair (N), road (S), Waxmire (W), carters' road (E)
  .open(5, 0).open(17, 0, 2, 1).open(17, 23, 2, 1).open(0, 11, 1, 2).open(33, 10, 1, 3)
  // the gate wall between the yard and the carters' road, and the road's cliffs
  .cliff(28, 1, 1, 22).open(28, 11).cliff(29, 1, 4, 9).cliff(29, 13, 4, 10)
  // rougher corners
  .cliff(1, 1, 3, 2).cliff(1, 19, 3, 4).cliff(24, 20, 4, 3).cliff(24, 1, 4, 1)
  .grassEdges()
  .paint(17, 0, 2, 24, '=').paint(0, 11, 34, 2, '=')
  .add({ type: 'door', id: 'hub_toll_gate', at: [28, 11], requires: 'toll_key' })
  .add({ type: 'shrine', id: 'shrine_rest', name: "Wick's Rest", at: [14, 9] })
  .decor('campfire', 21, 15).decor('bedroll', 19, 17).decor('bedroll', 23, 17, true)
  .decor('stall', 22, 7).decor('lantern_post', 25, 8).decor('notice_board', 20, 8)
  .decor('well', 9, 16).decor('tent', 5, 17).decor('tent', 13, 19).decor('hand_cart', 26, 5)
  .decor('ruin_wall', 10, 5).decor('ruin_wall', 6, 7).decor('fence', 4, 14).decor('fence', 5, 14).decor('fence', 6, 14)
  .decor('lantern_post', 15, 13).decor('lantern_post', 20, 13).decor('signpost', 2, 10).decor('signpost', 26, 13)
  .decor('grass_tuft', 3, 5).decor('grass_tuft', 11, 20).decor('grass_tuft', 26, 18).decor('grass_tuft', 8, 2)
  .prop('crate', 24, 9).prop('crate', 20, 6).prop('pot', 23, 6).prop('pot', 12, 16).prop('crate', 27, 3)
  .spawn('from_road', 17, 21).spawn('from_mire', 2, 12).spawn('from_works', 31, 11)
  .exit('hub_to_road', 17, 23, 2, 1, 'road', 'from_hub')
  .exit('hub_to_mire', 0, 11, 1, 2, 'mire', 'from_hub')
  .exit('hub_to_works', 33, 10, 1, 3, 'works', 'from_hub')
  // story hooks (story systems milestone)
  .npc('maudlin', 12, 11).npc('oskar_stall', 22, 6).npc('pip', 22, 16)
  .add({ type: 'cutscene', id: 'arrive_wicks_rest', at: [17, 20] });

// hub_02 Maudlin's Chapel — a grotto chapel dug into the hollow's side: flagstones, an altar, benches, her
// bedroll and shelves. Where the Chandler's ledger is brought later.
R('hub_02_chapel', [0, 2], 11, 9)
  .open(5, 8)
  .paint(1, 1, 9, 7, ':').paint(5, 8, 1, 1, ':')
  .decor('altar', 6, 1).decor('bookshelf', 9, 1).decor('prayer_bench', 4, 4).decor('prayer_bench', 8, 4)
  .decor('bedroll', 2, 6).prop('candles', 1, 1).prop('candles', 3, 1).prop('pot', 9, 6)
  .npc('maudlin_chapel', 5, 3);

// hub_03 Hill Stair — a switchback path up the hollow's north side to the Abbey Porch. Ridges alternate
// open ends (right, left, right); rows directly above a ridge are under its cap, so each landing leaves one.
R('hub_03_hill_stair', [12, -4], 12, 15)
  .open(5, 0, 2, 1).open(5, 14, 2, 1)
  .cliff(1, 11, 7, 1).cliff(4, 7, 7, 1).cliff(1, 3, 6, 1)
  .grassEdges()
  .paint(5, 12, 5, 2, '=').paint(8, 8, 3, 4, '=').paint(1, 8, 8, 2, '=').paint(1, 4, 3, 4, '=')
  .paint(1, 4, 9, 2, '=').paint(8, 1, 3, 3, '=').paint(5, 0, 6, 2, '=').paint(5, 13, 2, 2, '=')
  .decor('lantern_post', 10, 12).decor('lantern_post', 1, 9).decor('lantern_post', 10, 5).decor('signpost', 4, 1)
  .decor('grass_tuft', 2, 12).decor('grass_tuft', 6, 9).decor('grass_tuft', 5, 5)
  .spawn('from_abbey', 6, 1)
  .exit('hub_to_abbey', 5, 0, 2, 1, 'abbey', 'from_hub');

// ---- write
fs.mkdirSync('data/rooms', { recursive: true });
for (const r of rooms) {
  const data = { id: r.id, area: 'hub', origin: r.origin, legend, tiles: r.g.map(row => row.join('')), entities: r.entities };
  const json = JSON.stringify(data, null, 2).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
  fs.writeFileSync(`data/rooms/${r.id}.json`, json + '\n');
}
console.log(`wrote ${rooms.length} room(s)`);
