// "Press E" interactions: dropped weapons, people or shrines (whichever is closer), levers, notes, chests, doors and racks.
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
        const inHand = p.pickUpWeapon(item.weapon);
        if (inHand) announce(gs, DATA.weapons[item.weapon].name);
        else gs.showToast(DATA.weapons[item.weapon].name.toUpperCase(), 'Your hands are full, so it goes in your pack. Change weapons from EQUIPMENT (Esc).');
        gs.markDirty();
      },
    };

  const remains = gs.arena.remainsInteraction();
  if (remains) return remains;

  // A shrine you're standing closer to than anyone wins, so people milling about it never crowd it out.
  const shrine = gs.shrines.nearest(p.x, p.y);
  const npc = gs.npcs.nearest(p.x, p.y);
  if (shrine && (!npc?.talk || Math.hypot(shrine.x - p.x, shrine.y - p.y) < Math.hypot(npc.x - p.x, npc.y - p.y)))
    return {
      label: shrine.lit ? `REST AT ${shrine.name}` : `KINDLE ${shrine.name}`,
      use: () => beginShrine(gs, shrine),
    };
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

  const note = gs.notes.nearest(p.x, p.y);
  if (note)
    return {
      label: `READ ${DATA.notes[note.note].title.toUpperCase()}`,
      use: () => {
        gs.notes.take(note);
        gs.flags.add(`note:${note.note}`);
        gs.bus.emit('sfx', { id: 'p_paper' });
        gs.save();
        gs.openGear('inventory', note.note);
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
  const missing = door ? gs.doors.missingKeys(door, gs.flags) : [];
  if (door && missing.length) {
    const held = door.requires.length - missing.length;
    return {
      label: 'LOCKED',
      use: () => {
        gs.showToast('LOCKED', `It needs ${keyNames(missing)}.${held ? ` The ${keyNames(door.requires.filter(k => !missing.includes(k)), false)} fits, but it is not enough alone.` : ''}`);
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
      label:
        door.requires.length > 1 ? 'SET THE SEALS' : door.requires.length ? `UNLOCK (${keyNames(door.requires, false).toUpperCase()})` : door.opensFrom ? 'LIFT THE BAR' : 'OPEN DOOR',
      use: () => {
        gs.doors.setOpen(door, gs.grid, true);
        gs.flags.add(`door:${door.id}`);
        gs.bus.emit('sfx', { id: 'door_open', x: door.tx * 16 + 8, y: door.ty * 16 + 8 });
        if (door.opensFrom) gs.showToast('SHORTCUT OPENED', 'The way back is clear.');
        if (door.requires.length === 1) gs.showToast('UNLOCKED', `The ${keyNames(door.requires, false)} turns. The gate stays open for good.`);
        if (door.requires.length > 1) gs.showToast('UNLOCKED', `The ${keyNames(door.requires, false)} sink into the door together. It opens, and stays open for good.`);
        gs.save();
      },
    };
  }

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
      if (id) p.give('shield', id);
      p.setShield(id);
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

/** "the Toll Key", "the Seal of Tallow and the Seal of the Mire" (without "the" when `article` is false). */
function keyNames(ids: string[], article = true): string {
  const names = ids.map(id => `${article ? 'the ' : ''}${DATA.items[id]?.name ?? id}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}

function announce(gs: GameScene, text: string) {
  gs.numbers.add(text.toUpperCase(), gs.player.x, gs.player.y - 34, hexToInt(DATA.palette.wax2));
}
