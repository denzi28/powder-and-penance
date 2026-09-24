// The townsfolk's screens, opened from their conversations (script step { "open": ... }):
//   LEVEL UP (Maudlin): spend Tallow on Vitality, Endurance, Strength and Dexterity. Points are added one by
//     one and previewed; confirming pays for them all at once.
//   SHOP (Oskar): buy consumables, powder, materials, rings and notes. The stock grows as you explore.
//   SMITH (Bede): upgrade a weapon +1 to +5 with Tallow and materials.
// The world is paused while one is open. Drawn by GearView; this is the state, the rules and the navigation.
import { DATA } from '../data/config';
import { check } from '../story/conditions';
import { applyItem, useLine } from '../game/Items';
import { levelCost, STATS, weaponMult } from '../player/Player';
import type { ShopEntry, StatName } from '../data/schemas';
import type { Input } from '../input/Input';
import type { Player } from '../player/Player';
import type { GameScene } from '../scenes/GameScene';
import { NOTE_ICON } from './GearScreen';

/** Up/down (and left/right) presses from keys, D-pad or stick, one per push. */
class Nav {
  private prevX = 0;
  private prevY = 0;
  read(input: Input) {
    const x = input.moveX;
    const y = input.moveY;
    const up = input.pressed('moveUp') || (y < -0.5 && this.prevY >= -0.5);
    const down = input.pressed('moveDown') || (y > 0.5 && this.prevY <= 0.5);
    const left = input.pressed('moveLeft') || (x < -0.5 && this.prevX >= -0.5);
    const right = input.pressed('moveRight') || (x > 0.5 && this.prevX <= 0.5);
    this.prevX = x;
    this.prevY = y;
    return { step: up ? -1 : down ? 1 : 0, side: left ? -1 : right ? 1 : 0 };
  }
}

abstract class ServiceScreen {
  index = 0;
  /** The result of the last action, shown along the bottom. */
  message: { text: string; good: boolean } | null = null;
  protected nav = new Nav();

  constructor(
    protected gs: GameScene,
    private onClose: () => void,
  ) {}

  get p(): Player {
    return this.gs.player;
  }
  protected sfx(id: string) {
    this.gs.bus.emit('sfx', { id });
  }
  protected say(text: string, good: boolean) {
    this.message = { text, good };
    if (!good) this.sfx('locked');
  }
  protected close() {
    this.onClose();
  }
  abstract rows(): number;
  update(input: Input) {
    const { step, side } = this.nav.read(input);
    const n = this.rows();
    if (step && n) {
      this.index = (this.index + step + n) % n;
      this.sfx('menu_move');
    }
    this.handle(input, side);
  }
  protected abstract handle(input: Input, side: number): void;
}

// ------------------------------------------------------------------ level up
export class LevelUpScreen extends ServiceScreen {
  readonly kind = 'levelup' as const;
  /** Points added but not yet paid for. */
  pending: Record<StatName, number> = { vitality: 0, endurance: 0, strength: 0, dexterity: 0 };

  rows() {
    return STATS.length;
  }
  get added() {
    return STATS.reduce((a, k) => a + this.pending[k], 0);
  }
  /** Tallow for every pending point, from the current level up. */
  get cost() {
    let c = 0;
    for (let i = 0; i < this.added; i++) c += levelCost(this.p.level + i);
    return c;
  }
  /** The next point's price. */
  get nextCost() {
    return levelCost(this.p.level + this.added);
  }

  /** What the player would be with the pending points (read through the real getters, so rings count). */
  preview() {
    const p = this.p;
    const read = () => ({
      level: p.level,
      hp: p.maxHp,
      stamina: p.stamina.max,
      capacity: p.capacity,
      right: handDamage(p, 0),
      left: handDamage(p, 1),
    });
    const now = read();
    const saved = { ...p.stats };
    for (const k of STATS) p.stats[k] += this.pending[k];
    const after = read();
    p.stats = saved;
    return { now, after };
  }

  protected handle(input: Input, side: number) {
    const k = STATS[this.index];
    if (side > 0) {
      if (this.p.stats[k] + this.pending[k] >= DATA.levels.max) this.say(`${k.toUpperCase()} is as high as it goes.`, false);
      else if (this.cost + this.nextCost > this.p.tallow) this.say(`Not enough Tallow: the next point costs ${this.nextCost}.`, false);
      else {
        this.pending[k]++;
        this.message = null;
        this.sfx('menu_move');
      }
    } else if (side < 0 && this.pending[k] > 0) {
      this.pending[k]--;
      this.sfx('menu_move');
    }
    if (input.pressed('confirm') && this.added > 0) {
      const p = this.p;
      const before = p.maxHp;
      const from = p.level;
      p.tallow -= this.cost;
      for (const s of STATS) p.stats[s] += this.pending[s];
      p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - before)); // new health comes filled
      this.pending = { vitality: 0, endurance: 0, strength: 0, dexterity: 0 };
      this.say(`Level ${from} -> ${p.level}. The warmth settles into you.`, true);
      this.sfx('p_levelup');
      this.gs.markDirty();
      this.gs.save();
    } else if (input.pressed('back') || input.pressed('pause')) {
      if (this.added > 0) {
        this.pending = { vitality: 0, endurance: 0, strength: 0, dexterity: 0 };
        this.message = null;
        this.sfx('menu_move');
      } else this.close();
    }
  }
}

/** A hand's first light hit (or shot) as the player's stats and upgrades make it; null for an empty hand. */
export function handDamage(p: Player, hand: 0 | 1): { weapon: string; damage: number } | null {
  const id = p.slots[hand];
  if (hand === 1 && id === 'fists') return null;
  return { weapon: id, damage: weaponDamage(p, id, p.upgrades[id] ?? 0) };
}

/** A weapon's first light hit (or its shot) with your stats at an upgrade level. */
export function weaponDamage(p: Player, id: string, upgrade: number): number {
  const w = DATA.weapons[id];
  const base = w.ranged ? w.ranged.projectile.damage : (w.light[0]?.damage ?? w.heavy?.strike.damage ?? 0);
  return Math.round(base * weaponMult(id, p.stats, upgrade));
}

// ------------------------------------------------------------------ shop
export interface ShopRow {
  entry: ShopEntry;
  name: string;
  icon: number;
  price: number;
  /** Bought as many times as it can be. */
  soldOut: boolean;
  /** What it does, and its lore. */
  stats: string[];
  description: string;
}

export class ShopScreen extends ServiceScreen {
  readonly kind = 'shop' as const;

  /** What's on sale now (the stock grows with world flags). */
  list(): ShopRow[] {
    const p = this.p;
    return DATA.shop.stock
      .filter(e => check(this.gs.flags, e.when))
      .map(e => {
        const limit = e.limit ?? (e.note ? 1 : undefined);
        const n = p.bought[e.id] ?? 0;
        const price = Math.max(1, Math.round(e.price * p.mods.prices));
        const soldOut = (limit !== undefined && n >= limit) || (!!e.note && this.gs.flags.has(`note:${e.note}`));
        if (e.consumable) {
          const c = DATA.consumables[e.consumable];
          return { entry: e, name: c.name, icon: c.icon, price, soldOut, stats: [useLine(c.id).toUpperCase(), `YOU CARRY ${p.count(c.id)}${c.use.type === 'material' ? '' : ` OF ${c.max}`}`], description: c.description };
        }
        if (e.note) {
          const note = DATA.notes[e.note];
          return { entry: e, name: note.title, icon: NOTE_ICON, price, soldOut, stats: ['A NOTE: KEPT UNDER INVENTORY > NOTES'], description: 'Oskar won\'t say where he got it. "Read it and you\'ll see why."' };
        }
        const it = DATA.items[e.item!];
        const ring = it.effect.type === 'ring' ? DATA.rings[it.effect.id] : null;
        return { entry: e, name: it.name, icon: it.icon, price, soldOut, stats: ring ? [`A RING: ${ring.effect.toUpperCase()}`] : [], description: it.description };
      });
  }
  rows() {
    return this.list().length;
  }

  protected handle(input: Input) {
    const row = this.list()[this.index];
    if (row && input.pressed('confirm')) this.buy(row);
    else if (input.pressed('back') || input.pressed('pause')) this.close();
  }

  private buy(row: ShopRow) {
    const p = this.p;
    const e = row.entry;
    if (row.soldOut) return this.say(`${row.name}: sold out.`, false);
    if (row.price > p.tallow) return this.say(`Not enough Tallow: ${row.name} costs ${row.price}, you have ${p.tallow}.`, false);
    if (e.consumable && p.count(e.consumable) >= DATA.consumables[e.consumable].max)
      return this.say(`You can't carry more ${row.name} (${DATA.consumables[e.consumable].max}).`, false);
    if (e.item && DATA.items[e.item].effect.type === 'ammo') {
      const guns = p.inv.weapons.filter(id => DATA.weapons[id].ranged);
      if (!guns.length) return this.say('You carry no gun or crossbow for it.', false);
      if (guns.every(id => p.ammoFor(id).reserve >= DATA.weapons[id].ranged!.reserveMax)) return this.say('Your spare shots are already full.', false);
    }
    p.tallow -= row.price;
    p.bought[e.id] = (p.bought[e.id] ?? 0) + 1;
    let what: string;
    if (e.consumable) {
      p.addItem(e.consumable, 1);
      this.gs.flags.add(`found:${e.consumable}`);
      what = `${row.name}: you carry ${p.count(e.consumable)}.`;
    } else if (e.note) {
      this.gs.flags.add(`note:${e.note}`);
      what = `${row.name}: read it under INVENTORY > NOTES.`;
    } else what = applyItem(this.gs, e.item!);
    this.say(`Bought for ${row.price}. ${what}`, true);
    this.sfx('p_buy');
    this.gs.markDirty();
    this.gs.save();
  }
}

// ------------------------------------------------------------------ smith
export class SmithScreen extends ServiceScreen {
  readonly kind = 'smith' as const;

  /** Owned weapons Bede can work. */
  weapons(): string[] {
    return this.p.inv.weapons.filter(id => DATA.weapons[id].upgradable);
  }
  rows() {
    return this.weapons().length;
  }

  /** The next upgrade of a weapon: its cost and what you have toward it (null when it's at +max). */
  next(id: string) {
    const lvl = this.p.upgrades[id] ?? 0;
    const cost = DATA.smith.levels[lvl];
    if (!cost) return null;
    const materials = Object.entries(cost.materials).map(([m, n]) => ({ id: m, need: n, have: this.p.count(m) }));
    const ok = this.p.tallow >= cost.tallow && materials.every(m => m.have >= m.need);
    return { level: lvl + 1, tallow: cost.tallow, materials, ok };
  }

  protected handle(input: Input) {
    const id = this.weapons()[this.index];
    if (id && input.pressed('confirm')) this.upgrade(id);
    else if (input.pressed('back') || input.pressed('pause')) this.close();
  }

  private upgrade(id: string) {
    const p = this.p;
    const w = DATA.weapons[id];
    const n = this.next(id);
    if (!n) return this.say(`${w.name} is +${DATA.smith.levels.length}. There's nothing more Bede can do for it.`, false);
    if (p.tallow < n.tallow) return this.say(`Not enough Tallow: +${n.level} costs ${n.tallow}, you have ${p.tallow}.`, false);
    const short = n.materials.find(m => m.have < m.need);
    if (short) return this.say(`Bede needs ${short.need} ${DATA.consumables[short.id].name} for +${n.level}; you have ${short.have}.`, false);
    const before = weaponDamage(p, id, n.level - 1);
    p.tallow -= n.tallow;
    for (const m of n.materials) p.spendItem(m.id, m.need);
    p.upgrades[id] = n.level;
    this.say(`${w.name} +${n.level}: damage ${before} -> ${weaponDamage(p, id, n.level)}.`, true);
    this.sfx('p_anvil');
    this.gs.markDirty();
    this.gs.save();
  }
}

export type AnyServiceScreen = LevelUpScreen | ShopScreen | SmithScreen;
