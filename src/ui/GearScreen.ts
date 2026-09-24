// The gear screens opened from the pause menu (Esc): EQUIPMENT (what's in your hands and on your back, chosen
// from your pack, with the equip load it adds up to) and INVENTORY (everything you carry, by kind). The world
// is paused while they're open. Drawn by GearView in the UI scene; this is the state and the navigation.
import { DATA } from '../data/config';
import { FISTS, loadOf, loadTier, type Gear } from '../player/Player';
import type { Player } from '../player/Player';
import type { Input } from '../input/Input';

export type SlotKey = 'hand0' | 'hand1' | 'shield' | 'head' | 'body';
export const SLOTS: { key: SlotKey; label: string }[] = [
  { key: 'hand0', label: 'RIGHT HAND I' },
  { key: 'hand1', label: 'RIGHT HAND II' },
  { key: 'shield', label: 'LEFT HAND' },
  { key: 'head', label: 'HEAD' },
  { key: 'body', label: 'BODY' },
];
export const TABS = ['WEAPONS', 'SHIELDS', 'ARMOUR', 'ITEMS', 'KEYS'] as const;

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
export function weaponEntry(id: string): Entry {
  const w = DATA.weapons[id];
  const stats: string[] = [];
  if (w.kind === 'melee') {
    const l = w.light[0];
    stats.push(`LIGHT ${l.damage} DMG  ${l.stamina} STAMINA${w.light.length > 1 ? `  x${w.light.length} COMBO` : ''}`);
    if (w.heavy) stats.push(`HEAVY ${w.heavy.strike.damage}-${Math.round(w.heavy.strike.damage * w.heavy.chargeDamageMult)} DMG  ${w.heavy.strike.poise} POISE`);
  } else if (w.ranged) {
    const r = w.ranged;
    stats.push(`SHOT ${r.projectile.damage} DMG  ${r.projectile.poise} POISE`);
    stats.push(`CLIP ${r.clip}  SPARE ${r.reserveMax}  RELOAD ${(r.reload.ticks / 60).toFixed(1)}S`);
  }
  stats.push(w.twoHanded ? 'TWO-HANDED (NO SHIELD)' : 'ONE-HANDED');
  return { id, name: w.name, icon: w.icon, weight: w.weight, stats, description: w.description };
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

const none = (what: string, description: string): Entry => ({ id: null, name: what, icon: ICON_EMPTY, weight: 0, stats: [], description });

export function slotEntry(p: Player, key: SlotKey): Entry {
  switch (key) {
    case 'hand0':
    case 'hand1': {
      const id = p.slots[key === 'hand0' ? 0 : 1];
      return id === FISTS ? { ...weaponEntry(FISTS), id: null } : weaponEntry(id);
    }
    case 'shield':
      return p.shieldId ? shieldEntry(p.shieldId) : none('NO SHIELD', 'Nothing in the left hand. You can still roll.');
    default: {
      const id = p.worn[key];
      return id ? armourEntry(id) : none(`NO ${key.toUpperCase()} ARMOUR`, 'Nothing worn here.');
    }
  }
}

/** What can go in a slot: nothing, then everything owned that fits. */
export function slotOptions(p: Player, key: SlotKey): Entry[] {
  switch (key) {
    case 'hand0':
    case 'hand1':
      return [{ ...weaponEntry(FISTS), id: FISTS }, ...p.inv.weapons.map(weaponEntry)];
    case 'shield':
      return [none('NO SHIELD', 'Leave the left hand free.'), ...p.inv.shields.map(shieldEntry)];
    default:
      return [none('NOTHING', 'Go without.'), ...p.inv.armour.filter(id => DATA.armour[id].slot === key).map(armourEntry)];
  }
}

/** The gear you'd have with `id` in slot `key` (for the load preview). */
export function gearWith(p: Player, key: SlotKey, id: string | null): Gear {
  const g: Gear = { slots: [...p.slots], shield: p.shieldId, head: p.worn.head, body: p.worn.body };
  if (key === 'hand0' || key === 'hand1') {
    const i = key === 'hand0' ? 0 : 1;
    const slots = [...p.slots];
    const w = id ?? FISTS;
    if (w !== FISTS && slots[1 - i] === w) slots[1 - i] = FISTS;
    slots[i] = w;
    g.slots = slots;
  } else if (key === 'shield') g.shield = id;
  else g[key] = id;
  return g;
}

/** Everything in a tab of the inventory. */
export function tabEntries(p: Player, flags: ReadonlySet<string>, tab: number): Entry[] {
  const eq = new Set<string>([...p.slots, p.shieldId ?? '', p.worn.head ?? '', p.worn.body ?? '']);
  switch (TABS[tab]) {
    case 'WEAPONS':
      return p.inv.weapons.map(id => ({ ...weaponEntry(id), on: eq.has(id) }));
    case 'SHIELDS':
      return p.inv.shields.map(id => ({ ...shieldEntry(id), on: eq.has(id) }));
    case 'ARMOUR':
      return p.inv.armour.map(id => ({ ...armourEntry(id), on: eq.has(id) }));
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

  /** The equip load now, and what it would be with the highlighted choice. */
  load() {
    const now = loadOf({ slots: this.p.slots, shield: this.p.shieldId, head: this.p.worn.head, body: this.p.worn.body });
    let preview: number | null = null;
    if (this.choosing) preview = loadOf(gearWith(this.p, this.choosing.key, this.choosing.options[this.choosing.index]?.id ?? null));
    return { now, preview, capacity: DATA.load.capacity, tier: loadTier(preview ?? now) };
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
      if (input.pressed('back') || input.pressed('pause')) this.onClose();
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
    } else if (input.pressed('back') || input.pressed('pause')) this.onClose();
  }

  private apply(key: SlotKey, id: string | null) {
    const p = this.p;
    if (key === 'hand0' || key === 'hand1') p.setSlot(key === 'hand0' ? 0 : 1, id ?? FISTS);
    else if (key === 'shield') p.setShield(id);
    else p.setArmour(key, id);
    this.sfx(id ? equipSound(key, id) : 'p_unequip');
  }
}

/** The sound of putting something on: a blade drawn, a gun checked, a buckler strapped, armour buckled. */
function equipSound(key: SlotKey, id: string): string {
  if (key === 'hand0' || key === 'hand1') return DATA.weapons[id]?.sounds.draw ?? 'p_draw';
  if (key === 'shield') return 'p_strap';
  return (DATA.armour[id]?.weight ?? 0) >= 5 ? 'p_armour_heavy' : 'p_armour_light';
}
