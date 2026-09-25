// Bloomhollow: reached from the road, its hives and seals wired up, its Queen's two forms, and Hild's letter to her sister.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { check } from '../src/story/conditions';

const bloom = Object.values(DATA.rooms).filter(r => r.area === 'bloom');
const ents = bloom.flatMap(r => r.entities);
const json = (x: unknown) => JSON.stringify(x);

describe('Bloomhollow', () => {
  it('has ten rooms, entered through the collapsed gate on the road and left back onto it', () => {
    expect(bloom.length).toBe(10);
    const onRoad = DATA.rooms.road_04_collapsed_gate.entities.find(e => e.type === 'exit' && (e.to as { area: string }).area === 'bloom');
    expect(onRoad && (onRoad.to as { spawn: string }).spawn).toBe('from_road');
    const back = ents.find(e => e.type === 'exit' && (e.to as { area: string }).area === 'road');
    expect(back && (back.to as { spawn: string }).spawn).toBe('from_bloom');
  });

  it('has its four new enemies, the Scarecrow Warden as a miniboss and the Hive Queen as its boss', () => {
    const kinds = new Set(ents.filter(e => e.type === 'enemy').map(e => String(e.kind)));
    for (const k of ['beekeeper_husk', 'orchard_guard', 'honey_slime', 'scarecrow_warden', 'hive_queen']) expect(kinds.has(k), k).toBe(true);
    const warden = ents.find(e => e.type === 'enemy' && e.kind === 'scarecrow_warden');
    expect(warden?.miniboss).toBeTruthy();
    expect(ents.some(e => e.type === 'swarm')).toBe(true);
  });

  it('hives let out swarms, smoke calms them, and the husks and the Smoker make smoke', () => {
    expect(DATA.swarms.swarms[DATA.props.hive.hive!]).toBeTruthy();
    expect(ents.filter(e => e.type === 'prop' && e.kind === 'hive').length).toBeGreaterThanOrEqual(4);
    const smokes = (moves: { strikes: { smoke?: unknown }[] }[]) => moves.some(m => m.strikes.some(s => s.smoke));
    expect(smokes(DATA.enemies.beekeeper_husk.moves)).toBe(true);
    expect(DATA.enemies.beekeeper_husk.beeproof).toBe(true);
    expect(json(DATA.weapons.smoker)).toContain('"smoke"');
  });

  it('tallow seals only melt near a beeswax light, and Hild hands out the first candle', () => {
    const seal = DATA.props.tallow_seal;
    expect(seal.melts).toBeTruthy();
    expect(seal.secretWall).toBe(true);
    expect(ents.filter(e => e.type === 'prop' && e.kind === 'tallow_seal').length).toBe(2);
    expect(DATA.consumables.beeswax_candle.use.type).toBe('buff');
    expect(json(DATA.consumables.beeswax_candle.use)).toContain('"light"');
    expect(json(DATA.scripts.hild_talk)).toContain('"give":"cache_beeswax_one"');
  });

  it("the Queen's turn becomes her swarm at a floor tile in the Great Skep, and the swarm gives her ring", () => {
    const queen = DATA.enemies.hive_queen;
    expect(queen.boss?.turn?.kind).toBe('queen_swarm');
    const skep = DATA.rooms.bloom_10_great_skep;
    const [ax, ay] = queen.boss!.turn!.altar;
    expect(skep.legend[skep.tiles[ay][ax]]).toMatch(/^floor/);
    const script = DATA.scripts[DATA.enemies.queen_swarm.boss!.deathScript!];
    expect(json(script.steps)).toContain('"give":"ring_of_the_queen"');
    expect(DATA.music.bosses.hive_queen).toBeTruthy();
    expect(DATA.music.bosses.queen_swarm).toBeTruthy();
    expect(DATA.music.areas.bloom).toBeTruthy();
  });

  it("Hild's letter goes to Maudlin, Maudlin's reply comes back, and the reply opens more of Hild's stock", () => {
    const maudlin = json(DATA.scripts.maudlin);
    expect(maudlin).toContain('"key:hild_letter"');
    expect(maudlin).toContain('"give":"maudlin_reply"');
    const hild = json(DATA.scripts.hild_talk);
    expect(hild).toContain('"give":"hild_letter"');
    expect(hild).toContain('"key:maudlin_reply"');
    const hilds = DATA.shop.stock.filter(e => e.seller === 'hild');
    const onSale = (flags: string[]) => hilds.filter(e => check(new Set(flags), e.when)).length;
    expect(onSale([])).toBeGreaterThanOrEqual(3);
    expect(onSale(['story:hild_read_reply'])).toBeGreaterThan(onSale([]));
    expect(onSale(['story:hild_read_reply', 'boss:hive_queen'])).toBe(hilds.length);
  });
});
