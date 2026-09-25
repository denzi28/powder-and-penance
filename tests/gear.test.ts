// Gear: equip load tiers and how they reshape the roll; every piece of gear has an icon and a way into the
// world; every sound the code asks for by name exists.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { LAYERED_SOUNDS } from '../src/data/schemas';
import { equipHand, loadOf, loadTier, normalizeHands, rollFor } from '../src/player/Player';

const ICONS = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/sprites/icons.anim.json'), 'utf8'));
const iconCount = (() => {
  // the sheet is one row of 16x16 cells
  const png = fs.readFileSync(path.join(__dirname, '../assets/sprites/icons.png'));
  return png.readUInt32BE(16) / ICONS.cell[0];
})();

describe('equip load', () => {
  const cap = DATA.load.capacity;

  it('picks the tier by the fraction of capacity carried', () => {
    expect(loadTier(0).id).toBe('light');
    expect(loadTier(cap * 0.3).id).toBe('light');
    expect(loadTier(cap * 0.31).id).toBe('medium');
    expect(loadTier(cap * 0.7).id).toBe('medium');
    expect(loadTier(cap * 0.71).id).toBe('heavy');
    expect(loadTier(cap).id).toBe('heavy');
    expect(loadTier(cap * 1.01).id).toBe('over');
  });

  it('counts both hands, the shield and armour, and a weapon only once', () => {
    const w = DATA.weapons;
    expect(loadOf({ slots: ['straight_sword', 'flintlock'], shield: 'buckler', head: 'pilgrims_hood', body: 'warden_hauberk' })).toBeCloseTo(
      w.straight_sword.weight + w.flintlock.weight + DATA.shields.buckler.weight + DATA.armour.pilgrims_hood.weight + DATA.armour.warden_hauberk.weight,
    );
    expect(loadOf({ slots: ['fists', 'fists'], shield: null, head: null, body: null })).toBe(0);
  });

  it('rolls further and quicker light, shorter and slower heavy; overloaded barely moves', () => {
    const t = Object.fromEntries(DATA.load.tiers.map(x => [x.id, rollFor(x)]));
    expect(t.light.distance).toBeGreaterThan(t.medium.distance);
    expect(t.heavy.distance).toBeLessThan(t.medium.distance);
    expect(t.over.distance).toBeLessThan(t.heavy.distance);
    expect(t.light.totalTicks).toBeLessThan(t.medium.totalTicks);
    expect(t.heavy.totalTicks).toBeGreaterThan(t.medium.totalTicks);
    expect(t.heavy.stamina).toBeGreaterThan(t.medium.stamina);
    for (const r of Object.values(t)) {
      // i-frames stay inside the roll's travel, cancels inside the roll
      expect(r.iframeEnd).toBeGreaterThanOrEqual(r.iframeStart);
      expect(r.iframeEnd).toBeLessThanOrEqual(r.travelTicks);
      expect(r.cancelFrom).toBeLessThan(r.totalTicks);
      expect(r.moveCancelFrom).toBeLessThan(r.totalTicks);
    }
    expect(DATA.load.tiers.find(x => x.id === 'over')!.sprint).toBe(false);
  });
});

describe('two hands', () => {
  const empty = { right: 'fists', left: 'fists', shield: null };

  it('a shield or a one-handed weapon goes in the left hand, not both', () => {
    const swordShield = equipHand(equipHand(empty, 'right', 'straight_sword'), 'left', 'buckler');
    expect(swordShield).toEqual({ right: 'straight_sword', left: 'fists', shield: 'buckler' });
    expect(equipHand(swordShield, 'left', 'flintlock')).toEqual({ right: 'straight_sword', left: 'flintlock', shield: null });
    expect(equipHand(swordShield, 'left', null)).toEqual({ right: 'straight_sword', left: 'fists', shield: null });
  });

  it('a two-handed weapon empties the left hand, and a shield takes it off again', () => {
    const axe = equipHand({ right: 'straight_sword', left: 'fists', shield: 'buckler' }, 'right', 'greataxe');
    expect(axe).toEqual({ right: 'greataxe', left: 'fists', shield: null });
    expect(equipHand(axe, 'left', 'buckler')).toEqual({ right: 'fists', left: 'fists', shield: 'buckler' });
    expect(equipHand(axe, 'left', 'flintlock')).toEqual({ right: 'fists', left: 'flintlock', shield: null });
    // a two-hander offered to the left hand goes to the right
    expect(equipHand({ right: 'dagger', left: 'fists', shield: 'buckler' }, 'left', 'heavy_crossbow')).toEqual({ right: 'heavy_crossbow', left: 'fists', shield: null });
  });

  it('one weapon is never in both hands', () => {
    expect(equipHand({ right: 'dagger', left: 'flintlock', shield: null }, 'left', 'dagger')).toEqual({ right: 'fists', left: 'dagger', shield: null });
    expect(equipHand({ right: 'dagger', left: 'flintlock', shield: null }, 'right', 'flintlock')).toEqual({ right: 'flintlock', left: 'fists', shield: null });
  });

  it('old saves are put right: the shield wins the left hand, a two-hander both', () => {
    expect(normalizeHands({ right: 'straight_sword', left: 'flintlock', shield: 'buckler' })).toEqual({ right: 'straight_sword', left: 'fists', shield: 'buckler' });
    expect(normalizeHands({ right: 'greataxe', left: 'revolver', shield: 'buckler' })).toEqual({ right: 'greataxe', left: 'fists', shield: null });
    expect(normalizeHands({ right: 'fists', left: 'greataxe', shield: null })).toEqual({ right: 'greataxe', left: 'fists', shield: null });
  });
});

describe('gear in the world', () => {
  it('every weapon, shield, armour piece and item has an icon on the sheet', () => {
    const all = [...Object.values(DATA.weapons), ...Object.values(DATA.shields), ...Object.values(DATA.armour), ...Object.values(DATA.items)];
    for (const g of all) expect(g.icon, g.id).toBeLessThan(iconCount);
  });

  it('every armour piece, and every weapon but the starting two, can be found in a chest, on an enemy or from a boss', () => {
    const inChests = new Set<string>();
    const found = (item: string) => {
      const e = DATA.items[item]?.effect;
      if (e?.type === 'gear') inChests.add(e.id);
    };
    for (const r of Object.values(DATA.rooms))
      for (const en of r.entities) {
        if (en.type === 'item') found(String(en.item));
        if (en.type !== 'enemy') continue;
        const mb = en.miniboss as { drop?: string } | undefined;
        const carried = en.carries as { item?: string } | undefined;
        if (mb?.drop) found(mb.drop);
        if (carried?.item) found(carried.item);
      }
    // bosses hand theirs over in their last words
    for (const sc of Object.values(DATA.scripts)) for (const m of JSON.stringify(sc).matchAll(/"give":"([a-z_]+)"/g)) found(m[1]);
    for (const id of Object.keys(DATA.armour)) expect(inChests.has(id), id).toBe(true);
    for (const id of ['dagger', 'greataxe', 'revolver', 'heavy_crossbow', 'buckler']) expect(inChests.has(id), id).toBe(true);
  });
});

describe('sounds named in code', () => {
  it('exist as layered sounds', () => {
    const src = ['src/player/PlayerStates.ts', 'src/player/Player.ts', 'src/game/Presentation.ts', 'src/ui/GearScreen.ts', 'src/game/Interactions.ts']
      .map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
      .join('\n');
    const named = new Set([...src.matchAll(/'(p_[a-z_]+)'/g)].map(m => m[1]));
    expect(named.size).toBeGreaterThan(5);
    for (const id of named) expect((LAYERED_SOUNDS as readonly string[]).includes(id), id).toBe(true);
  });
});
