// The Powder Vault: reachable from the Works, its boss's two forms wired together, its loot out in the world.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';

const vault = Object.values(DATA.rooms).filter(r => r.area === 'vault');

describe('the Powder Vault', () => {
  it('has four rooms, entered from the Works and left back into them', () => {
    expect(vault.length).toBe(4);
    const inWorks = DATA.rooms.works_03_stores.entities.find(e => e.type === 'exit' && (e.to as { area: string }).area === 'vault');
    expect(inWorks).toBeTruthy();
    const back = vault.flatMap(r => r.entities).find(e => e.type === 'exit' && (e.to as { area: string }).area === 'works');
    expect(back && (back.to as { spawn: string }).spawn).toBe('from_vault');
  });

  it("the Gunner's cannon turns into the duel at a floor tile in the Range, and the duel gives the Blunderbuss", () => {
    const cannon = DATA.enemies.master_gunner;
    expect(cannon.boss?.turn?.kind).toBe('master_gunner_duel');
    const range = DATA.rooms.vault_04_the_range;
    const [ax, ay] = cannon.boss!.turn!.altar;
    expect(range.legend[range.tiles[ay][ax]]).toMatch(/^floor/);
    const script = DATA.scripts[DATA.enemies.master_gunner_duel.boss!.deathScript!];
    expect(JSON.stringify(script.steps)).toContain('"give":"gear_blunderbuss"');
  });

  it('kegs and mules carry powder; Fuse-Runners aim at kegs', () => {
    expect(DATA.props.keg.explode?.damage).toBeGreaterThan(0);
    expect(DATA.enemies.powder_mule.deathBlast?.fuseTicks).toBeGreaterThan(30); // time to get clear
    expect(DATA.enemies.fuse_runner.moves.some(m => m.strikes.some(s => s.aimAtKeg))).toBe(true);
    const kegs = vault.flatMap(r => r.entities).filter(e => e.type === 'prop' && e.kind === 'keg');
    expect(kegs.length).toBeGreaterThanOrEqual(10);
  });

  it("Oskar's strongbox is in the cache, and bringing it back opens new stock", () => {
    const cache = DATA.rooms.vault_03_oskars_cache.entities.find(e => e.type === 'item' && e.item === 'oskars_strongbox');
    expect(cache).toBeTruthy();
    expect(DATA.shop.stock.filter(e => e.when === 'oskar_cache_returned').length).toBeGreaterThanOrEqual(2);
  });
});
