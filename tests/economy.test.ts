// Step 2, the economy: levelling costs and what stats give, weapon scaling and upgrades, Oskar's stock and
// the smith's materials being out there to find.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { levelCost, levelOf, scalingBonus, startStats, vitalityHp, weaponMult } from '../src/player/Player';
import { check } from '../src/story/conditions';

const chestCount = (consumable: string) =>
  Object.values(DATA.rooms)
    .flatMap(r => r.entities)
    .filter(en => en.type === 'item')
    .map(en => DATA.items[String(en.item)].effect)
    .reduce((a, e) => a + (e.type === 'consumable' && e.id === consumable ? e.count : 0), 0);

describe('levels', () => {
  it('start at 1 and rise one per point', () => {
    const s = startStats();
    expect(levelOf(s)).toBe(1);
    expect(levelOf({ ...s, vitality: s.vitality + 3, strength: s.strength + 2 })).toBe(6);
  });

  it('cost more each time, and an Act 1 playthrough affords a dozen or so', () => {
    for (let l = 1; l < 40; l++) expect(levelCost(l + 1)).toBeGreaterThan(levelCost(l));
    let spent = 0;
    for (let l = 1; l < 13; l++) spent += levelCost(l);
    expect(spent).toBeGreaterThan(5000);
    expect(spent).toBeLessThan(20000);
  });

  it('Vitality adds HP, more slowly past the soft cap', () => {
    const v = DATA.levels.vitality;
    expect(vitalityHp(DATA.levels.start)).toBe(0);
    const perBefore = vitalityHp(v.softCap) - vitalityHp(v.softCap - 1);
    const perAfter = vitalityHp(v.softCap + 1) - vitalityHp(v.softCap);
    expect(perAfter).toBeLessThan(perBefore);
  });
});

describe('weapon scaling and upgrades', () => {
  const base = startStats();

  it('grades order S > A > B > C > D > E, and none at the starting stat', () => {
    const g = DATA.levels.scaling.grades as Record<string, number>;
    expect(g.S).toBeGreaterThan(g.A);
    expect(g.A).toBeGreaterThan(g.B);
    expect(g.D).toBeGreaterThan(g.E);
    expect(scalingBonus('A', DATA.levels.start)).toBe(0);
    expect(scalingBonus('A', DATA.levels.scaling.full)).toBeCloseTo(g.A);
    expect(scalingBonus('A', 999)).toBeCloseTo(g.A); // capped
  });

  it('Strength helps the greataxe more than the dagger; Dexterity the reverse; guns only by Dexterity', () => {
    const str = { ...base, strength: 30 };
    const dex = { ...base, dexterity: 30 };
    expect(weaponMult('greataxe', str, 0)).toBeGreaterThan(weaponMult('dagger', str, 0));
    expect(weaponMult('dagger', dex, 0)).toBeGreaterThan(weaponMult('greataxe', dex, 0));
    expect(weaponMult('revolver', str, 0)).toBe(1);
    expect(weaponMult('revolver', dex, 0)).toBeGreaterThan(1);
  });

  it('each upgrade adds damage, up to +5', () => {
    expect(DATA.smith.levels.length).toBe(5);
    for (let i = 1; i <= 5; i++) expect(weaponMult('straight_sword', base, i)).toBeGreaterThan(weaponMult('straight_sword', base, i - 1));
    for (let i = 1; i < DATA.smith.levels.length; i++) expect(DATA.smith.levels[i].tallow).toBeGreaterThan(DATA.smith.levels[i - 1].tallow);
  });

  it('every upgradable weapon has a grade; bare fists cannot be upgraded', () => {
    for (const w of Object.values(DATA.weapons)) if (w.upgradable) expect(w.scaling.str || w.scaling.dex, w.id).toBeTruthy();
    expect(DATA.weapons.fists.upgradable).toBe(false);
  });

  it('the world holds enough materials to take a weapon to +5 without buying any', () => {
    const need: Record<string, number> = {};
    for (const lv of DATA.smith.levels) for (const [m, n] of Object.entries(lv.materials)) need[m] = (need[m] ?? 0) + n;
    const bossDrops = (m: string) =>
      Object.values(DATA.enemies)
        .filter(e => e.boss && e.loot)
        .flatMap(e => DATA.loot.tables[e.loot!])
        .reduce((a, l) => a + (l.item === m ? l.count : 0), 0);
    for (const [m, n] of Object.entries(need)) expect(chestCount(m) + bossDrops(m), m).toBeGreaterThanOrEqual(n);
  });
});

describe("Oskar's stock", () => {
  it('starts small and grows as the bosses fall', () => {
    const oskars = DATA.shop.stock.filter(e => e.seller === 'oskar');
    const onSale = (flags: string[]) => oskars.filter(e => check(new Set(flags), e.when)).length;
    const start = onSale([]);
    const later = onSale(['boss:tollwarden', 'boss:mother_tallow', 'boss:mire_matron', 'boss:chandler', 'story:oskar_cache_returned']);
    expect(start).toBeGreaterThanOrEqual(4);
    expect(later).toBeGreaterThan(start + 4);
    expect(later).toBe(oskars.length);
  });
});
