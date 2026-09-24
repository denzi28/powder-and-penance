// Applying placed items (data/items) and telling the player, in plain words and real numbers, what changed.
// The item's own `description` is lore, kept for the INVENTORY.
import { keysFor, keyName } from './Settings';
import { DATA } from '../data/config';
import type { GameScene } from '../scenes/GameScene';

export function grantItem(gs: GameScene, id: string, itemId: string, x: number, y: number) {
  const item = DATA.items[itemId];
  gs.flags.add(`item:${id}`);
  const what = applyItem(gs, itemId);
  gs.showToast(item.name.toUpperCase(), what);
  gs.particles.burst(x, y, 10, -Math.PI / 2, 1.6, 12, 60, 'flame2', false); // sparks from the open chest
  gs.bus.emit('sfx', { id: 'item' });
  gs.save();
}

/** Apply an item's effect to the player (from a chest, a script, the shop). Returns what changed, in plain words. */
export function applyItem(gs: GameScene, itemId: string): string {
  const p = gs.player;
  const item = DATA.items[itemId];
  const e = item.effect;
  let what: string;
  switch (e.type) {
    case 'phialMax': {
      const before = p.phials.max;
      p.phials.max = Math.min(DATA.phial.maxCharges, p.phials.max + e.amount);
      p.phials.charges = Math.min(p.phials.max, p.phials.charges + e.amount);
      what =
        p.phials.max > before
          ? `Your Mending Phial holds one more drink: ${before} -> ${p.phials.max}. All drinks refill when you rest at a shrine.`
          : `Your phial already holds the most it can (${before} drinks).`;
      break;
    }
    case 'phialLevel': {
      const before = p.healAmount;
      p.phials.level = Math.min(DATA.phial.maxLevel, p.phials.level + e.amount);
      what =
        p.healAmount > before
          ? `Each phial drink now heals more: ${before} -> ${p.healAmount} HP.`
          : `Your phial is already as strong as it gets (${before} HP per drink).`;
      break;
    }
    case 'ammo': {
      const parts: string[] = [];
      for (const wid of p.inv.weapons) {
        const r = DATA.weapons[wid]?.ranged;
        if (!r) continue;
        const a = p.ammoFor(wid);
        const before = a.reserve;
        a.reserve = Math.min(r.reserveMax, a.reserve + Math.ceil(r.reserveMax * e.amount));
        const name = DATA.weapons[wid].name;
        parts.push(
          a.reserve > before
            ? `${name}: +${a.reserve - before} spare shots (${before} -> ${a.reserve} of ${r.reserveMax})`
            : `${name}: spare shots already full (${r.reserveMax})`,
        );
      }
      what = parts.length
        ? `${parts.join('. ')}. Spare shots are what you reload from; shrines refill them.`
        : 'Ammo for firearms, but you carry none. Find a gun or crossbow to use pouches like this.';
      break;
    }
    case 'tallow':
      p.tallow += e.amount;
      what = `+${e.amount} Tallow (you carry ${p.tallow}). Tallow is money. You drop all you carry when you die; reach the spot again to take it back.`;
      break;
    case 'key':
      gs.flags.add(`key:${item.id}`);
      what = `A key. It opens ${e.opens}. Keys are kept for good, even if you die.`;
      break;
    case 'gear': {
      const table = e.kind === 'weapon' ? DATA.weapons : e.kind === 'shield' ? DATA.shields : DATA.armour;
      const g = table[e.id];
      p.give(e.kind, e.id);
      // wear it straight away if the slot it goes in is empty
      let on = false;
      if (e.kind === 'weapon') on = p.pickUpWeapon(e.id);
      else if (e.kind === 'shield' && !p.shieldId && !p.leftWeapon && !p.twoHanding) {
        p.setShield(e.id);
        on = true;
      } else if (e.kind === 'armour') {
        const slot = DATA.armour[e.id].slot;
        if (!p.worn[slot]) {
          p.setArmour(slot, e.id);
          on = true;
        }
      }
      const tier = p.loadTier;
      what = `${g.name}${on ? ', equipped' : ', added to your pack'}. Weight ${g.weight}; equip load now ${p.equipLoad} of ${p.capacity} (${tier.label.toLowerCase()}: ${tier.note.toLowerCase()}). Change gear from EQUIPMENT (Esc).`;
      break;
    }
    case 'consumable': {
      const c = DATA.consumables[e.id];
      const took = p.addItem(e.id, e.count);
      gs.flags.add(`found:${e.id}`);
      const has = p.count(e.id);
      what =
        took > 0
          ? `${took > 1 ? `${took} x ` : ''}${c.name}: ${useLine(e.id)} You carry ${has}${c.use.type === 'material' ? '' : ` of ${c.max}. ${p.belt === e.id ? `It is on your belt: ${beltKeys().use} uses it, ${beltKeys().cycle} cycles.` : `${beltKeys().cycle} cycles your belt to it; ${beltKeys().use} uses it.`}`}`
          : `You can't carry more ${c.name} (${c.max}).`;
      break;
    }
    case 'ring': {
      const r = DATA.rings[e.id];
      if (!p.inv.rings.includes(e.id)) p.inv.rings.push(e.id);
      const free = p.rings.indexOf(null);
      if (free >= 0 && !p.rings.includes(e.id)) p.setRing(free as 0 | 1, e.id);
      const on = p.rings.includes(e.id);
      what = `A ring: ${r.effect.toLowerCase()} while worn. ${on ? 'You put it on.' : 'Both hands are ringed; swap rings from EQUIPMENT (Esc).'}`;
      break;
    }
    case 'quest':
      gs.flags.add(`key:${item.id}`);
      what = `${e.note} Kept for good, even if you die.`;
      break;
  }
  return what;
}

/** What a consumable does, in one plain sentence with real numbers. */
export function useLine(id: string): string {
  const u = DATA.consumables[id].use;
  const secs = (t: number) => `${Math.round(t / DATA.game.tickRate)}s`;
  switch (u.type) {
    case 'throw':
      return u.projectile.lob
        ? `Thrown where you aim; bursts for ${u.projectile.damage} damage around it.`
        : `Thrown straight where you aim for ${u.projectile.damage} damage.`;
    case 'regen':
      return `Heals ${u.amount} HP over ${secs(u.ticks)}.`;
    case 'buff':
      return `${buffLine(u.mods, u.lose)} for ${secs(u.ticks)}.`;
    case 'reload':
      return `Loads every gun you carry at once, and adds ${Math.round(u.reserve * 100)}% of its spare shots.`;
    case 'tallow':
      return `Turn it into ${u.amount} Tallow.`;
    case 'material':
      return 'A smith\'s material: Bede takes it to upgrade weapons.';
  }
}

function buffLine(m: import('../data/schemas').Mods, lose: boolean): string {
  const pct = (x: number) => `${Math.round(Math.abs(x - 1) * 100)}%`;
  const parts: string[] = [];
  if (lose) parts.push('enemies hunting you lose you');
  if (m.notice) parts.push(`you are noticed ${pct(m.notice)} slower`);
  if (m.sureFooted) parts.push('wax, mud and spilled pools no longer slow you');
  if (m.damageTaken) parts.push(`you take ${pct(m.damageTaken)} less damage`);
  if (m.damage) parts.push(`your hits deal ${pct(m.damage)} more damage`);
  if (m.staminaRegen) parts.push(`stamina comes back ${pct(m.staminaRegen)} faster`);
  if (m.poise) parts.push(`+${m.poise} poise, so you are hard to stagger`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The keys that use and cycle the belt, as bound now ("C", "X"; D-pad on a gamepad). */
export function beltKeys(): { use: string; cycle: string } {
  const k = (a: string) => keyName(keysFor(a, DATA.input.keyboard)[0] ?? '?');
  return { use: `${k('useItem')} (D-pad right)`, cycle: `${k('cycleItem')} (D-pad up)` };
}
