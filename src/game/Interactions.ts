// "Press E" interactions: dropped weapons, placed items, shrines and racks (nearest wins, in that priority).
import { DATA } from '../data/config';
import { hexToInt } from '../ui/colors';
import { beginShrine } from './ShrineFlow';
import type { GameScene } from '../scenes/GameScene';

/** Only these player states may interact with objects. */
const CAN_INTERACT = new Set(['idle', 'move', 'sprint']);

export interface Interactable {
  label: string;
  use: () => void;
}

export function nearestInteractable(gs: GameScene): Interactable | null {
  const p = gs.player;
  if (!CAN_INTERACT.has(p.stateName) || gs.shrineSeq) return null;

  const item = gs.ground.nearest(p.x, p.y);
  if (item)
    return {
      label: `PICK UP ${DATA.weapons[item.weapon].name}`,
      use: () => {
        gs.ground.remove(item);
        const released = p.equip(item.weapon);
        if (released) gs.ground.add(released, p.x, p.y + 2); // hands full: swap with the one on the floor
        announce(gs, DATA.weapons[item.weapon].name);
        gs.markDirty();
      },
    };

  const pick = gs.pickups.nearest(p.x, p.y);
  if (pick) return { label: `PICK UP ${DATA.items[pick.item].name}`, use: () => takePickup(gs, pick.id, pick.item) };

  const shrine = gs.shrines.nearest(p.x, p.y);
  if (shrine)
    return {
      label: shrine.lit ? `REST AT ${shrine.name}` : `KINDLE ${shrine.name}`,
      use: () => beginShrine(gs, shrine),
    };

  const rack = gs.racks.nearest(p.x, p.y);
  if (!rack) return null;
  if (rack.kind === 'weapon' && rack.id) {
    const id = rack.id;
    return {
      label: `TAKE ${DATA.weapons[id].name}`,
      use: () => {
        p.equip(id); // racks never run out; the replaced weapon goes back on the rack
        announce(gs, DATA.weapons[id].name);
        gs.markDirty();
      },
    };
  }
  const id = rack.id;
  return {
    label: id ? `TAKE ${DATA.shields[id].name}` : 'REMOVE SHIELD',
    use: () => {
      p.shieldId = id;
      announce(gs, id ? DATA.shields[id].name : 'no shield');
      gs.markDirty();
    },
  };
}

export function handleInteract(gs: GameScene) {
  const target = nearestInteractable(gs);
  if (!target || !gs.controls.consume('interact')) return;
  target.use();
  gs.bus.emit('sfx', { id: 'pickup' });
}

function takePickup(gs: GameScene, id: string, itemId: string) {
  const p = gs.player;
  const item = DATA.items[itemId];
  const pick = gs.pickups.list.find(i => i.id === id);
  if (pick) gs.pickups.remove(pick);
  gs.flags.add(`item:${id}`);
  const e = item.effect;
  switch (e.type) {
    case 'phialMax':
      p.phials.max = Math.min(DATA.phial.maxCharges, p.phials.max + e.amount);
      p.phials.charges = Math.min(p.phials.max, p.phials.charges + e.amount);
      break;
    case 'phialLevel':
      p.phials.level = Math.min(DATA.phial.maxLevel, p.phials.level + e.amount);
      break;
    case 'ammo':
      for (const wid of new Set(p.slots)) {
        const r = DATA.weapons[wid]?.ranged;
        if (!r) continue;
        const a = p.ammoFor(wid);
        a.reserve = Math.min(r.reserveMax, a.reserve + Math.ceil(r.reserveMax * e.amount));
      }
      break;
    case 'tallow':
      p.tallow += e.amount;
      break;
  }
  gs.showToast(item.name.toUpperCase(), item.description);
  gs.bus.emit('sfx', { id: 'item' });
  gs.save();
}

function announce(gs: GameScene, text: string) {
  gs.numbers.add(text.toUpperCase(), gs.player.x, gs.player.y - 34, hexToInt(DATA.palette.wax2));
}
