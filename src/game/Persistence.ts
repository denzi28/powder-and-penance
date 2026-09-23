// Game state <-> SaveData. Loading always puts the player at their last shrine, rested.
import { DATA } from '../data/config';
import { FISTS } from '../player/Player';
import type { SaveData } from '../save/SaveSystem';
import type { GameScene } from '../scenes/GameScene';

export function snapshot(gs: GameScene): SaveData {
  const p = gs.player;
  const m = gs.marker.data;
  return {
    version: 1,
    savedAt: Date.now(),
    lastShrine: gs.lastShrine,
    tallow: p.tallow,
    phials: { ...p.phials },
    stats: { level: 1 },
    loadout: { slots: [...p.slots], slot: p.slot, shield: p.shieldId },
    ammo: Object.fromEntries(p.ammo),
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
  p.slots = [known(s.loadout.slots[0]), known(s.loadout.slots[1])];
  p.slot = s.loadout.slot;
  p.shieldId = s.loadout.shield && DATA.shields[s.loadout.shield] ? s.loadout.shield : null;
  p.enforceTwoHanded();
  for (const [id, a] of Object.entries(s.ammo)) p.ammo.set(id, { ...a });
  for (const g of s.world.groundItems) if (DATA.weapons[g.weapon]) gs.ground.add(g.weapon, g.x, g.y, g.area ?? gs.area);
  gs.marker.set(s.deathMarker ? { ...s.deathMarker, area: s.deathMarker.area ?? gs.area } : null);
}
