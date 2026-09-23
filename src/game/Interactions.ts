// "Press E" interactions: dropped weapons, people, chests, doors, shrines and racks (in that priority).
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

  const remains = gs.arena.remainsInteraction();
  if (remains) return remains;

  const npc = gs.npcs.nearest(p.x, p.y);
  if (npc?.talk) {
    const talk = npc.talk;
    return { label: `TALK TO ${DATA.npcs.npcs[npc.npc].name}`, use: () => gs.story.start(talk) };
  }

  const lever = gs.levers.nearest(p.x, p.y, gs.leverPulled);
  if (lever)
    return {
      label: 'PULL LEVER',
      use: () => {
        gs.flags.add(`lever:${lever.id}`);
        gs.levers.refresh(gs.leverPulled);
        gs.bus.emit('sfx', { id: 'door_open', x: lever.x, y: lever.y });
        gs.cam.addTrauma(0.15);
        if (lever.script) gs.story.start(lever.script);
        gs.save();
      },
    };

  const chest = gs.pickups.nearest(p.x, p.y);
  if (chest)
    return {
      label: 'OPEN CHEST',
      // The lid opens over a few ticks while the player keeps moving; the item pops out in GameScene.tick.
      use: () => {
        gs.pickups.open(chest);
        gs.bus.emit('sfx', { id: 'chest_open', x: chest.x, y: chest.y });
      },
    };

  const near = gs.doors.nearest(p.x, p.y);
  const door = near && !gs.arena.sealed(near.tx, near.ty) ? near : null; // a smoke-sealed doorway can't be opened
  if (door && door.requires && !gs.flags.has(`key:${door.requires}`)) {
    const key = DATA.items[door.requires]?.name ?? door.requires;
    return {
      label: 'LOCKED',
      use: () => {
        gs.showToast('LOCKED', `It needs the ${key}.`);
        gs.bus.emit('sfx', { id: 'locked' });
      },
    };
  }
  if (door) {
    if (!gs.doors.canOpenFrom(door, p.x, p.y))
      return {
        label: 'BARRED FROM BEYOND',
        use: () => {
          gs.showToast('BARRED FROM BEYOND', 'It will not open from this side.');
          gs.bus.emit('sfx', { id: 'locked' });
        },
      };
    return {
      label: door.requires ? `UNLOCK (${DATA.items[door.requires]?.name ?? door.requires})` : door.opensFrom ? 'LIFT THE BAR' : 'OPEN DOOR',
      use: () => {
        gs.doors.setOpen(door, gs.grid, true);
        gs.flags.add(`door:${door.id}`);
        gs.bus.emit('sfx', { id: 'door_open', x: door.tx * 16 + 8, y: door.ty * 16 + 8 });
        if (door.opensFrom) gs.showToast('SHORTCUT OPENED', 'The way back is clear.');
        if (door.requires) gs.showToast('UNLOCKED', `The ${DATA.items[door.requires]?.name ?? 'key'} turns. The gate stays open for good.`);
        gs.save();
      },
    };
  }

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

function announce(gs: GameScene, text: string) {
  gs.numbers.add(text.toUpperCase(), gs.player.x, gs.player.y - 34, hexToInt(DATA.palette.wax2));
}
