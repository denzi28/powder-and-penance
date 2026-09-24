// Game state <-> SaveData. Loading always puts the player at their last shrine, rested.
import { DATA } from '../data/config';
import { FISTS } from '../player/Player';
import type { SaveData } from '../save/SaveSystem';
import type { GameScene } from '../scenes/GameScene';

export function snapshot(gs: GameScene): SaveData {
  const p = gs.player;
  const m = gs.marker.data;
  return {
    version: 3,
    savedAt: Date.now(),
    lastShrine: gs.lastShrine,
    tallow: p.tallow,
    phials: { ...p.phials },
    stats: { level: 1 },
    loadout: { slots: [...p.slots], slot: p.slot, shield: p.shieldId },
    ammo: Object.fromEntries(p.ammo),
    gear: { weapons: [...p.inv.weapons], shields: [...p.inv.shields], armour: [...p.inv.armour], head: p.worn.head, body: p.worn.body },
    items: { pack: Object.fromEntries(p.pack), belt: p.belt, rings: [...p.inv.rings], worn: [p.rings[0], p.rings[1]] },
    world: {
      flags: [...gs.flags],
      groundItems: gs.ground.list.map(i => ({ weapon: i.weapon, x: i.x, y: i.y, area: i.area })),
    },
    deathMarker: m ? { x: m.x, y: m.y, tallow: m.tallow, area: m.area ?? gs.area } : null,
  };
}

/** Apply the player/world parts of a save (flags and last shrine are applied before the world is built). */
export function applySave(gs: GameScene, s: SaveData) {
  const p = gs.player;
  const known = (id: string) => (DATA.weapons[id] ? id : FISTS); // data may have changed since saving
  p.tallow = s.tallow;
  p.phials = { ...s.phials };
  // the inventory first (dropping anything the data no longer has), then what's equipped from it
  p.inv.weapons = s.gear.weapons.filter(id => DATA.weapons[id] && id !== FISTS);
  p.inv.shields = s.gear.shields.filter(id => DATA.shields[id]);
  p.inv.armour = s.gear.armour.filter(id => DATA.armour[id]);
  p.worn.head = s.gear.head && p.inv.armour.includes(s.gear.head) ? s.gear.head : null;
  p.worn.body = s.gear.body && p.inv.armour.includes(s.gear.body) ? s.gear.body : null;
  p.slots = [known(s.loadout.slots[0]), known(s.loadout.slots[1])];
  for (const id of p.slots) if (id !== FISTS && !p.inv.weapons.includes(id)) p.inv.weapons.push(id);
  p.slot = s.loadout.slot;
  p.shieldId = s.loadout.shield && DATA.shields[s.loadout.shield] ? s.loadout.shield : null;
  if (p.shieldId && !p.inv.shields.includes(p.shieldId)) p.inv.shields.push(p.shieldId);
  p.normalizeHands();
  // consumables (at most what can be carried), the belt, rings
  p.pack.clear();
  for (const [id, n] of Object.entries(s.items.pack)) if (DATA.consumables[id] && n > 0) p.pack.set(id, Math.min(n, DATA.consumables[id].max));
  p.belt = s.items.belt && p.pack.has(s.items.belt) ? s.items.belt : (p.carried[0] ?? null);
  p.inv.rings = s.items.rings.filter(id => DATA.rings[id]);
  p.rings[0] = s.items.worn[0] && p.inv.rings.includes(s.items.worn[0]) ? s.items.worn[0] : null;
  p.rings[1] = s.items.worn[1] && p.inv.rings.includes(s.items.worn[1]) && s.items.worn[1] !== p.rings[0] ? s.items.worn[1] : null;
  p.hp = p.maxHp;
  for (const [id, a] of Object.entries(s.ammo)) p.ammo.set(id, { ...a });
  for (const g of s.world.groundItems) if (DATA.weapons[g.weapon]) gs.ground.add(g.weapon, g.x, g.y, g.area ?? gs.area);
  gs.marker.set(s.deathMarker ? { ...s.deathMarker, area: s.deathMarker.area ?? gs.area } : null);
}
