import { describe, expect, it } from 'vitest';
import { SAVE_KEY, SaveSystem, type KeyValueStore, type SaveData } from '../src/save/SaveSystem';

class MemStore implements KeyValueStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const sample: SaveData = {
  version: 2,
  savedAt: 1,
  lastShrine: 'shrine_test',
  tallow: 120,
  phials: { charges: 2, max: 4, level: 1 },
  stats: { level: 1 },
  loadout: { slots: ['greataxe', 'revolver'], slot: 0, shield: 'buckler' },
  ammo: { revolver: { clip: 3, reserve: 12 } },
  world: { flags: ['shrine:shrine_test', 'item:test_shard'], groundItems: [{ weapon: 'dagger', x: 10, y: 20 }] },
  deathMarker: { x: 100, y: 50, tallow: 80 },
  gear: { weapons: ['greataxe', 'revolver', 'dagger'], shields: ['buckler'], armour: ['pilgrims_hood'], head: 'pilgrims_hood', body: null },
};

describe('SaveSystem', () => {
  it('round-trips a save', () => {
    const s = new SaveSystem(new MemStore());
    expect(s.exists()).toBe(false);
    expect(s.load()).toEqual({ ok: false, reason: 'none' });
    s.write(sample);
    expect(s.exists()).toBe(true);
    const r = s.load();
    expect(r.ok && r.save).toEqual(sample);
  });

  it('backs up and clears an unreadable save instead of crashing', () => {
    const store = new MemStore();
    const s = new SaveSystem(store);
    store.setItem(SAVE_KEY, '{"version":1,"tallow":"lots"');
    const r = s.load();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('corrupt');
    expect(s.exists()).toBe(false);
    expect([...store.m.keys()].some(k => k.startsWith(`${SAVE_KEY}.corrupt-`))).toBe(true);
  });

  it('migrates a version-1 save: what was in hand becomes the inventory', () => {
    const store = new MemStore();
    const { gear: _gear, ...v1 } = sample;
    store.setItem(SAVE_KEY, JSON.stringify({ ...v1, version: 1, loadout: { slots: ['straight_sword', 'fists'], slot: 0, shield: 'buckler' } }));
    const r = new SaveSystem(store).load();
    expect(r.ok).toBe(true);
    expect(r.ok && r.save.version).toBe(2);
    expect(r.ok && r.save.gear).toEqual({ weapons: ['straight_sword'], shields: ['buckler'], armour: [], head: null, body: null });
  });

  it('rejects saves that fail validation (e.g. negative tallow)', () => {
    const store = new MemStore();
    store.setItem(SAVE_KEY, JSON.stringify({ ...sample, tallow: -5 }));
    expect(new SaveSystem(store).load().ok).toBe(false);
  });
});
