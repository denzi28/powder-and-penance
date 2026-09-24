// The gear screens opened from the pause menu (Esc): EQUIPMENT (what's in your hands and on your back, chosen
// from your pack, with the equip load it adds up to) and INVENTORY (everything you carry, by kind). The world
// is paused while they're open. Drawn by GearView in the UI scene; this is the state and the navigation.
import { DATA } from '../data/config';
import { FISTS, equipHand, loadOf, loadTier, weaponMult, type Gear } from '../player/Player';
import { useLine } from '../game/Items';
import type { Player } from '../player/Player';
import type { Input } from '../input/Input';

export type SlotKey = 'hand0' | 'hand1' | 'head' | 'body' | 'ring0' | 'ring1';
export const SLOTS: { key: SlotKey; label: string }[] = [
  { key: 'hand0', label: 'RIGHT HAND (LEFT CLICK)' },
  { key: 'hand1', label: 'LEFT HAND (RIGHT CLICK)' },
  { key: 'head', label: 'HEAD' },
  { key: 'body', label: 'BODY' },
  { key: 'ring0', label: 'RING I' },
  { key: 'ring1', label: 'RING II' },
];
export const TABS = ['WEAPONS', 'SHIELDS', 'ARMOUR', 'RINGS', 'ITEMS', 'KEYS', 'NOTES'] as const;
export const NOTE_ICON = 47;

/** One thing to show in a list or the detail panel. */
export interface Entry {
  id: string | null;
  name: string;
  icon: number;
  weight: number | null;
  /** Short stat lines. */
  stats: string[];
  description: string;
  /** Equipped (inventory lists mark these). */
  on?: boolean;
  /** A count or amount shown after the name. */
  qty?: string;
}

const ICON_EMPTY = 25;
const ICON_PHIAL = 24;

// ------------------------------------------------------------------ entries
/** "STR C  DEX B": a weapon's scaling grades. */
export function gradeText(id: string): string {
  const sc = DATA.weapons[id]?.scaling ?? {};
  return [sc.str ? `STR ${sc.str}` : '', sc.dex ? `DEX ${sc.dex}` : ''].filter(Boolean).join('  ') || 'NO SCALING';
}

/** A weapon; with a player, its damage as their stats and its upgrade make it, and its +level in the name. */
export function weaponEntry(id: string, p?: Player): Entry {
  const w = DATA.weapons[id];
  const up = p?.upgrades[id] ?? 0;
  const k = p ? weaponMult(id, p.stats, up) : 1;
  const d = (x: number) => Math.round(x * k);
  const stats: string[] = [];
  if (w.kind === 'melee') {
    const l = w.light[0];
    stats.push(`LIGHT ${d(l.damage)} DMG  ${l.stamina} STAMINA${w.light.length > 1 ? `  x${w.light.length} COMBO` : ''}`);
    if (w.heavy) stats.push(`HEAVY ${d(w.heavy.strike.damage)}-${d(w.heavy.strike.damage * w.heavy.chargeDamageMult)} DMG  ${w.heavy.strike.poise} POISE`);
  } else if (w.ranged) {
    const r = w.ranged;
    stats.push(`SHOT ${d(r.projectile.damage)} DMG  ${r.projectile.poise} POISE`);
    stats.push(`CLIP ${r.clip}  SPARE ${r.reserveMax}  RELOAD ${((r.reload.ticks * (p?.mods.reload ?? 1)) / 60).toFixed(1)}S`);
  }
  stats.push(`${w.twoHanded ? 'TWO-HANDED' : 'ONE-HANDED'}  ${gradeText(id)}`);
  return { id, name: up ? `${w.name} +${up}` : w.name, icon: w.icon, weight: w.weight, stats, description: w.description };
}

export function shieldEntry(id: string): Entry {
  const s = DATA.shields[id];
  return {
    id,
    name: s.name,
    icon: s.icon,
    weight: s.weight,
    stats: [`BLOCKS ${Math.round(s.absorption * 100)}% OF A BLOW`, `STABILITY ${Math.round(s.stability * 100)}  PARRY WINDOW ${s.parryWindowTicks}`],
    description: s.description,
  };
}

export function armourEntry(id: string): Entry {
  const a = DATA.armour[id];
  return {
    id,
    name: a.name,
    icon: a.icon,
    weight: a.weight,
    stats: [`${a.slot === 'head' ? 'HEAD' : 'BODY'}  TAKES ${Math.round(a.absorb * 100)}% OFF DAMAGE  +${a.poise} POISE`],
    description: a.description,
  };
}

export function ringEntry(id: string): Entry {
  const r = DATA.rings[id];
  return { id, name: r.name, icon: r.icon, weight: null, stats: [r.effect.toUpperCase()], description: r.description };
}

export function consumableEntry(p: Player, id: string): Entry {
  const c = DATA.consumables[id];
  return {
    id,
    name: c.name,
    icon: c.icon,
    weight: null,
    qty: c.use.type === 'material' ? String(p.count(id)) : `${p.count(id)}/${c.max}`,
    stats: [useLine(id).toUpperCase()],
    description: c.description,
    on: p.belt === id,
  };
}

const none = (what: string, description: string): Entry => ({ id: null, name: what, icon: ICON_EMPTY, weight: 0, stats: [], description });

export function slotEntry(p: Player, key: SlotKey): Entry {
  switch (key) {
    case 'hand0': {
      const id = p.slots[0];
      return id === FISTS ? { ...weaponEntry(FISTS, p), id: null } : weaponEntry(id, p);
    }
    case 'hand1': {
      if (p.twoHanding) {
        const w = DATA.weapons[p.slots[0]];
        return { id: null, name: 'Held in both hands', icon: w.icon, weight: 0, stats: [`${w.name.toUpperCase()} IS TWO-HANDED`], description: 'Put a shield or a one-handed weapon here and the two-handed weapon comes off.' };
      }
      if (p.shieldId) return shieldEntry(p.shieldId);
      if (p.leftWeapon) return weaponEntry(p.leftWeapon, p);
      return none('EMPTY', 'Nothing in the left hand. A shield here blocks with right click; a one-handed weapon here strikes or fires with it.');
    }
    case 'ring0':
    case 'ring1': {
      const id = p.rings[key === 'ring0' ? 0 : 1];
      return id ? ringEntry(id) : none('NO RING', 'A bare finger.');
    }
    default: {
      const id = p.worn[key];
      return id ? armourEntry(id) : none(`NO ${key.toUpperCase()} ARMOUR`, 'Nothing worn here.');
    }
  }
}

/** What can go in a slot: nothing, then everything owned that fits. Choices that would take something else
 *  off (a two-hander and the left hand) say so. */
export function slotOptions(p: Player, key: SlotKey): Entry[] {
  const bumps = (e: Entry, hand: 'right' | 'left'): Entry => {
    const after = equipHand(p.hands, hand, e.id);
    const off = [p.slots[0], p.slots[1], p.shieldId].filter(
      (id): id is string => !!id && id !== FISTS && id !== e.id && ![after.right, after.left, after.shield].includes(id),
    );
    const names = off.map(id => (DATA.weapons[id] ?? DATA.shields[id]).name.toUpperCase());
    return names.length ? { ...e, stats: [...e.stats, `TAKES OFF: ${names.join(', ')}`] } : e;
  };
  switch (key) {
    case 'hand0':
      return [{ ...weaponEntry(FISTS, p), id: FISTS }, ...p.inv.weapons.map(id => bumps(weaponEntry(id, p), 'right'))];
    case 'hand1':
      return [
        none('EMPTY', 'Leave the left hand free.'),
        ...p.inv.shields.map(id => bumps(shieldEntry(id), 'left')),
        ...p.inv.weapons.filter(id => !DATA.weapons[id].twoHanded).map(id => bumps(weaponEntry(id, p), 'left')),
      ];
    case 'ring0':
    case 'ring1':
      return [none('NO RING', 'Take it off.'), ...p.inv.rings.map(id => ({ ...ringEntry(id), on: p.rings.includes(id) }))];
    default:
      return [none('NOTHING', 'Go without.'), ...p.inv.armour.filter(id => DATA.armour[id].slot === key).map(armourEntry)];
  }
}

/** The gear you'd have with `id` in slot `key` (for the load preview). */
export function gearWith(p: Player, key: SlotKey, id: string | null): Gear {
  const g: Gear = { slots: [...p.slots], shield: p.shieldId, head: p.worn.head, body: p.worn.body };
  if (key === 'hand0' || key === 'hand1') {
    const h = equipHand(p.hands, key === 'hand0' ? 'right' : 'left', id);
    g.slots = [h.right, h.left];
    g.shield = h.shield;
  } else if (key === 'head' || key === 'body') g[key] = id;
  return g;
}

/** Everything in a tab of the inventory. */
export function tabEntries(p: Player, flags: ReadonlySet<string>, tab: number): Entry[] {
  const eq = new Set<string>([...p.slots, p.shieldId ?? '', p.worn.head ?? '', p.worn.body ?? '']);
  switch (TABS[tab]) {
    case 'WEAPONS':
      return p.inv.weapons.map(id => ({ ...weaponEntry(id, p), on: eq.has(id) }));
    case 'SHIELDS':
      return p.inv.shields.map(id => ({ ...shieldEntry(id), on: eq.has(id) }));
    case 'ARMOUR':
      return p.inv.armour.map(id => ({ ...armourEntry(id), on: eq.has(id) }));
    case 'RINGS':
      return p.inv.rings.map(id => ({ ...ringEntry(id), on: p.rings.includes(id) }));
    case 'NOTES':
      return Object.values(DATA.notes)
        .filter(n => flags.has(`note:${n.id}`))
        .map(n => ({ id: n.id, name: n.title, icon: NOTE_ICON, weight: null, stats: [], description: n.text }));
    case 'ITEMS': {
      const out: Entry[] = [
        {
          id: 'phial',
          name: 'Mending Phial',
          icon: ICON_PHIAL,
          weight: null,
          qty: `${p.phials.charges}/${p.phials.max}`,
          stats: [`HEALS ${p.healAmount} HP A DRINK`, 'REFILLS WHEN YOU REST AT A WICK'],
          description: 'A flask of warm wax-water blessed at the Wicks. It tastes of smoke, and it closes wounds.',
        },
        {
          id: 'tallow',
          name: 'Tallow',
          icon: DATA.items.tallow_lump?.icon ?? 14,
          weight: null,
          qty: String(p.tallow),
          stats: ['CARRIED CURRENCY', 'DROPPED WHERE YOU FALL'],
          description: 'Rendered wax, the only coin that means anything here. Lose it when you die; walk back to where you fell to take it up again.',
        },
      ];
      for (const id of p.carried) out.push(consumableEntry(p, id));
      for (const id of p.inv.weapons) {
        const r = DATA.weapons[id].ranged;
        if (!r) continue;
        const a = p.ammoFor(id);
        out.push({
          id: `ammo:${id}`,
          name: `${DATA.weapons[id].name} rounds`,
          icon: DATA.items.ammo_pouch?.icon ?? 15,
          weight: null,
          qty: `${a.clip}+${a.reserve}`,
          stats: [`LOADED ${a.clip} OF ${r.clip}`, `SPARE ${a.reserve} OF ${r.reserveMax}`],
          description: 'Shot and powder for it. Shrines refill your spare rounds; powder pouches in chests top them up.',
        });
      }
      return out;
    }
    case 'KEYS':
    default:
      return Object.values(DATA.items)
        .filter(it => (it.effect.type === 'key' || it.effect.type === 'quest') && flags.has(`key:${it.id}`))
        .map(it => ({
          id: it.id,
          name: it.name,
          icon: it.icon,
          weight: null,
          stats: [it.effect.type === 'key' ? `OPENS ${(it.effect as { opens: string }).opens.toUpperCase()}` : 'KEPT FOR GOOD'],
          description: it.description,
        }));
  }
}

// ------------------------------------------------------------------ the screen
export class GearScreen {
  kind: 'equip' | 'inventory';
  /** Equipment: the slot row; inventory: the tab. */
  row = 0;
  tab = 0;
  index = 0;
  /** Equipment: choosing what to put in the selected slot. */
  choosing: { key: SlotKey; options: Entry[]; index: number } | null = null;
  private prevX = 0;
  private prevY = 0;

  constructor(
    kind: 'equip' | 'inventory',
    private p: Player,
    private flags: ReadonlySet<string>,
    private onClose: () => void,
    private sfx: (id: string) => void,
    /** Opened with its own key (Tab, I): pressing it again closes the screen. */
    private hotkey?: 'equipment' | 'inventory',
  ) {
    this.kind = kind;
  }

  /** The entries currently listed (for the view): the slots, the options, or the tab. */
  list(): Entry[] {
    if (this.kind === 'inventory') return tabEntries(this.p, this.flags, this.tab);
    if (this.choosing) return this.choosing.options;
    return this.slotRows();
  }

  /** What's in each slot now. */
  slotRows(): Entry[] {
    return SLOTS.map(sl => slotEntry(this.p, sl.key));
  }

  /** The entry under the cursor. */
  selected(): Entry | null {
    const l = this.list();
    const i = this.kind === 'inventory' ? this.index : this.choosing ? this.choosing.index : this.row;
    return l[i] ?? null;
  }

  /** Open the inventory on a tab, on a given entry (e.g. the note just picked up). */
  focus(tab: (typeof TABS)[number], id: string) {
    this.tab = TABS.indexOf(tab);
    this.index = Math.max(0, this.list().findIndex(e => e.id === id));
  }

  /** The equip load now, and what it would be with the highlighted choice. */
  load() {
    const now = loadOf({ slots: this.p.slots, shield: this.p.shieldId, head: this.p.worn.head, body: this.p.worn.body });
    let preview: number | null = null;
    if (this.choosing) preview = loadOf(gearWith(this.p, this.choosing.key, this.choosing.options[this.choosing.index]?.id ?? null));
    const cap = this.p.capacity;
    return { now, preview, capacity: cap, tier: loadTier(preview ?? now, cap) };
  }

  update(input: Input) {
    const x = input.moveX;
    const y = input.moveY;
    const up = input.pressed('moveUp') || (y < -0.5 && this.prevY >= -0.5);
    const down = input.pressed('moveDown') || (y > 0.5 && this.prevY <= 0.5);
    const left = input.pressed('moveLeft') || (x < -0.5 && this.prevX >= -0.5);
    const right = input.pressed('moveRight') || (x > 0.5 && this.prevX <= 0.5);
    this.prevX = x;
    this.prevY = y;
    const step = up ? -1 : down ? 1 : 0;

    if (this.kind === 'inventory') {
      if (left || right) {
        this.tab = (this.tab + (left ? -1 : 1) + TABS.length) % TABS.length;
        this.index = 0;
        this.sfx('menu_move');
      }
      const n = this.list().length;
      if (step && n) {
        this.index = (this.index + step + n) % n;
        this.sfx('menu_move');
      }
      // on ITEMS, confirm puts the highlighted consumable on the belt
      const sel = this.selected();
      if (TABS[this.tab] === 'ITEMS' && sel?.id && DATA.consumables[sel.id] && DATA.consumables[sel.id].use.type !== 'material' && input.pressed('confirm')) {
        this.p.belt = sel.id;
        this.sfx('p_belt');
      }
      if (input.pressed('back') || input.pressed('pause') || (this.hotkey && input.pressed(this.hotkey))) this.onClose();
      return;
    }

    if (this.choosing) {
      const c = this.choosing;
      if (step) {
        c.index = (c.index + step + c.options.length) % c.options.length;
        this.sfx('menu_move');
      }
      if (input.pressed('confirm')) {
        this.apply(c.key, c.options[c.index].id);
        this.choosing = null;
      } else if (input.pressed('back')) {
        this.choosing = null;
        this.sfx('menu_move');
      }
      return;
    }
    if (step) {
      this.row = (this.row + step + SLOTS.length) % SLOTS.length;
      this.sfx('menu_move');
    }
    if (input.pressed('confirm')) {
      const key = SLOTS[this.row].key;
      const options = slotOptions(this.p, key);
      const cur = slotEntry(this.p, key).id;
      this.choosing = { key, options, index: Math.max(0, options.findIndex(o => o.id === cur || (cur === null && (o.id === null || o.id === FISTS)))) };
      this.sfx('menu_confirm');
    } else if (input.pressed('back') || input.pressed('pause') || (this.hotkey && input.pressed(this.hotkey))) this.onClose();
  }

  private apply(key: SlotKey, id: string | null) {
    const p = this.p;
    const norm = (x: string | null) => (x === FISTS ? null : x);
    const changed = norm(slotEntry(p, key).id) !== norm(id);
    if (key === 'hand0') p.setSlot(0, id ?? FISTS);
    else if (key === 'hand1') {
      if (id && DATA.shields[id]) p.setShield(id);
      else p.setSlot(1, id ?? FISTS);
    } else if (key === 'ring0' || key === 'ring1') p.setRing(key === 'ring0' ? 0 : 1, id);
    else p.setArmour(key, id);
    // any change swaps with a sound of its own, alongside the new thing's (a blade drawn, a buckle...)
    if (changed) this.sfx('p_swap');
    this.sfx(id ? equipSound(key, id) : 'p_unequip');
  }
}

/** The sound of putting something on: a blade drawn, a gun checked, a buckler strapped, armour buckled. */
function equipSound(key: SlotKey, id: string): string {
  if (DATA.shields[id]) return 'p_strap';
  if (key === 'hand0' || key === 'hand1') return DATA.weapons[id]?.sounds.draw ?? 'p_draw';
  if (key === 'ring0' || key === 'ring1') return 'p_ring';
  return (DATA.armour[id]?.weight ?? 0) >= 5 ? 'p_armour_heavy' : 'p_armour_light';
}
