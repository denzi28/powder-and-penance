// Act 1's route: every biome is on it. The Nave wants a Seal from each of the four bosses, and Bloomhollow's
// fallen gate only gives way to powder, which is found in the Vault.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';

const json = (x: unknown) => JSON.stringify(x);

describe('the Act 1 route', () => {
  it('opens the Nave with four Seals, each given by one boss', () => {
    const door = DATA.rooms.abbey_11_nave_approach.entities.find(e => e.type === 'door' && e.id === 'abbey_door_nave');
    const seals = door?.requires as string[];
    expect(seals).toEqual(['seal_of_tallow', 'seal_of_the_mire', 'seal_of_powder', 'seal_of_the_hive']);
    const scripts = Object.values(DATA.scripts).map(json);
    for (const s of seals) {
      expect(DATA.items[s]?.effect.type, s).toBe('key');
      expect(scripts.filter(t => t.includes(`"give":"${s}"`)).length, s).toBe(1);
    }
    expect(json(DATA.scripts.gunner_death)).toContain('"give":"seal_of_powder"');
    expect(json(DATA.scripts.queen_death)).toContain('"give":"seal_of_the_hive"');
  });

  it("blocks Bloomhollow's gate with rubble that only a powder blast shifts", () => {
    const road = DATA.rooms.road_04_collapsed_gate;
    const exit = road.entities.find(e => e.type === 'exit' && (e.to as { area: string }).area === 'bloom')!;
    const rubble = road.entities.filter(e => e.type === 'prop' && e.kind === 'gate_rubble');
    const [ex, ey] = exit.at;
    const [w] = (exit.size as [number, number]) ?? [1, 1];
    for (let x = ex; x < ex + w; x++) {
      expect(road.legend[road.tiles[ey][x]], 'the gate is walled until blown').toBe('wall');
      expect(rubble.some(r => r.at[0] === x && r.at[1] === ey), `rubble at ${x},${ey}`).toBe(true);
    }
    const prop = DATA.props.gate_rubble;
    expect(prop.secretWall).toBe(true);
    const min = prop.blastOnly!.minRadius;
    expect(DATA.consumables.keg_charge.use.type === 'throw' && DATA.consumables.keg_charge.use.projectile.lob!.blastRadius).toBeGreaterThanOrEqual(min);
    const fb = DATA.consumables.firebomb.use;
    expect(fb.type === 'throw' && fb.projectile.lob!.blastRadius).toBeLessThan(min); // a firebomb found beside it won't do
  });

  it('finds keg charges in the Vault, and the Gunner hands over two more', () => {
    const vault = Object.values(DATA.rooms).filter(r => r.area === 'vault').flatMap(r => r.entities);
    expect(vault.some(e => e.type === 'item' && e.item === 'cache_keg_charges')).toBe(true);
    expect(json(DATA.scripts.gunner_death)).toContain('"give":"cache_keg_charges"');
  });

  it('points the way: Tomas names all four Seals, Oskar names the rubble', () => {
    const tomas = json(DATA.scripts.tomas);
    for (const s of ['seal_of_tallow', 'seal_of_the_mire', 'seal_of_powder', 'seal_of_the_hive']) expect(tomas).toContain(`key:${s}`);
    expect(json(DATA.scripts.oskar_hub)).toContain('orchard gate');
  });
});
