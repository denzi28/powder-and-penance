// Step 1 loot: consumables, rings and lore notes. Every one has its own lore and its own effect, and every one
// can be found in the world; modifiers combine the way the rings and effects say.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { combineMods } from '../src/player/Player';
import { useLine } from '../src/game/Items';
import { rollLoot } from '../src/world/LootDrops';
import { MinibossPlacement } from '../src/data/schemas';

const ICONS = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/sprites/icons.anim.json'), 'utf8'));
const iconCount = fs.readFileSync(path.join(__dirname, '../assets/sprites/icons.png')).readUInt32BE(16) / ICONS.cell[0];

const entities = Object.values(DATA.rooms).flatMap(r => r.entities.map(en => ({ room: r.id, en })));
const chestItems = entities.filter(e => e.en.type === 'item').map(e => DATA.items[String(e.en.item)]);
const minibosses = entities.filter(e => e.en.type === 'enemy' && e.en.miniboss !== undefined).map(e => MinibossPlacement.parse(e.en.miniboss));

describe('consumables', () => {
  const all = Object.values(DATA.consumables);

  it('there are at least ten, each with its own icon, lore and effect', () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(new Set(all.map(c => c.icon)).size).toBe(all.length);
    expect(new Set(all.map(c => c.description)).size).toBe(all.length);
    expect(new Set(all.map(c => JSON.stringify(c.use))).size).toBe(all.length);
    for (const c of all) {
      expect(c.icon, c.id).toBeLessThan(iconCount);
      expect(c.description.length, c.id).toBeGreaterThan(40);
      expect(useLine(c.id), c.id).toMatch(/\w/);
    }
  });

  it('each can be found: in a chest, or dropped by an enemy', () => {
    const inChests = new Set(chestItems.flatMap(it => (it.effect.type === 'consumable' ? [it.effect.id] : [])));
    const dropped = new Set(
      Object.values(DATA.enemies)
        .flatMap(e => (e.loot ? DATA.loot.tables[e.loot] : []))
        .flatMap(l => (l.item ? [l.item] : [])),
    );
    for (const c of all) expect(inChests.has(c.id) || dropped.has(c.id), c.id).toBe(true);
  });

  it('an enemy loot roll can hand out an item stack', () => {
    const table = DATA.loot.tables.acolyte;
    const seen = new Set<string>();
    let s = 1;
    const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const e = rollLoot(table, rng);
      if (e.item) seen.add(e.item);
    }
    expect(seen.has('firebomb')).toBe(true);
  });
});

describe('rings', () => {
  const all = Object.values(DATA.rings);

  it('each has its own icon, lore and effect', () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(new Set(all.map(r => r.icon)).size).toBe(all.length);
    expect(new Set(all.map(r => JSON.stringify(r.mods))).size).toBe(all.length);
    for (const r of all) {
      expect(r.icon, r.id).toBeLessThan(iconCount);
      expect(r.description.length, r.id).toBeGreaterThan(40);
      expect(Object.keys(r.mods).length, r.id).toBeGreaterThan(0);
    }
  });

  it('each can be found once: in a chest or on a miniboss', () => {
    const sources = [
      ...chestItems.flatMap(it => (it.effect.type === 'ring' ? [it.effect.id] : [])),
      ...minibosses.map(m => DATA.items[m.drop].effect).flatMap(e => (e.type === 'ring' ? [e.id] : [])),
    ];
    for (const r of all) expect(sources.filter(id => id === r.id).length, r.id).toBe(1);
  });
});

describe('notes', () => {
  it('each lies somewhere exactly once', () => {
    const placed = entities.filter(e => e.en.type === 'note').map(e => String(e.en.note));
    for (const id of Object.keys(DATA.notes)) expect(placed.filter(n => n === id).length, id).toBe(1);
    expect(placed.length).toBeGreaterThanOrEqual(8);
  });
});

describe('minibosses', () => {
  it('have tougher health, a title and a ring to drop', () => {
    expect(minibosses.length).toBeGreaterThanOrEqual(2);
    for (const m of minibosses) {
      expect(m.hpMult).toBeGreaterThan(1);
      expect(DATA.items[m.drop].effect.type).toBe('ring');
    }
  });
});

describe('modifiers', () => {
  it('add, multiply, and take the largest fraction', () => {
    const m = combineMods([{ maxHp: 20, damage: 1.3, keepTallow: 0.34 }, { maxHp: 5, damage: 1.5, keepTallow: 0.1, notice: 0.6 }]);
    expect(m.maxHp).toBe(25);
    expect(m.damage).toBeCloseTo(1.95);
    expect(m.keepTallow).toBeCloseTo(0.34);
    expect(m.notice).toBeCloseTo(0.6);
    expect(m.capacity).toBe(1);
    expect(combineMods([])).toMatchObject({ maxHp: 0, damage: 1, damageTaken: 1, sureFooted: 0 });
  });
});
