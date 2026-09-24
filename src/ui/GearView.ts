// Draws the gear screens (GearScreen) over the game: a full panel in the pixel font with item icons.
//   EQUIPMENT: the five slots on the left; on the right your armour and roll, or the choices for a slot;
//              the highlighted item's details and the equip-load bar along the bottom.
//   INVENTORY: tabs across the top, the list on the left, the details on the right.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from './colors';
import { wrap } from './MenuRenderer';
import { SLOTS, TABS, gradeText, type Entry, type GearScreen } from './GearScreen';
import type { Player } from '../player/Player';
import { STATS, levelCost } from '../player/Player';
import { weaponDamage, type AnyServiceScreen, type LevelUpScreen, type ShopScreen, type SmithScreen } from './ServiceScreens';
import { CONTROL_ROWS, SETTING_ROWS, keysText, padText, type AnyOptionsScreen, type ControlsScreen, type SettingsScreen } from './OptionsScreens';
import { SETTINGS } from '../game/Settings';

const TIER_COLOUR: Record<string, string> = { light: 'moss2', medium: 'flame2', heavy: 'ember', over: 'blood2' };

export class GearView {
  private g: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.BitmapText[] = [];
  private icons: Phaser.GameObjects.Image[] = [];
  private nText = 0;
  private nIcon = 0;

  constructor(
    private scene: Phaser.Scene,
    private depth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  private text(x: number, y: number, s: string, colour: string, scale = 1) {
    let t = this.texts[this.nText];
    if (!t) {
      t = this.scene.add.bitmapText(0, 0, 'pixel', '').setDepth(this.depth + 2);
      this.texts.push(t);
    }
    this.nText++;
    t.setText(s).setScale(scale).setPosition(Math.round(x), Math.round(y)).setTint(hexToInt(DATA.palette[colour] ?? colour)).setVisible(true);
    return t;
  }

  private icon(x: number, y: number, frame: number, scale = 1, alpha = 1) {
    let i = this.icons[this.nIcon];
    if (!i) {
      i = this.scene.add.image(0, 0, 'icons', 0).setOrigin(0, 0).setDepth(this.depth + 1);
      this.icons.push(i);
    }
    this.nIcon++;
    i.setFrame(frame).setScale(scale).setAlpha(alpha).setPosition(Math.round(x), Math.round(y)).setVisible(true);
  }

  private col(name: string) {
    return hexToInt(DATA.palette[name]);
  }

  draw(screen: GearScreen | AnyServiceScreen | AnyOptionsScreen | null, p: Player) {
    this.g.clear();
    this.nText = 0;
    this.nIcon = 0;
    if (screen) {
      const W = DATA.game.width;
      const H = DATA.game.height;
      const g = this.g;
      g.fillStyle(this.col('ink'), 1).fillRect(8, 8, W - 16, H - 16);
      g.fillStyle(this.col('flame1'), 1);
      g.fillRect(8, 8, W - 16, 1).fillRect(8, H - 9, W - 16, 1).fillRect(8, 8, 1, H - 16).fillRect(W - 9, 8, 1, H - 16);
      if (screen.kind === 'equip') this.drawEquip(screen, p);
      else if (screen.kind === 'inventory') this.drawInventory(screen);
      else if (screen.kind === 'levelup') this.drawLevelUp(screen, p);
      else if (screen.kind === 'shop') this.drawShop(screen, p);
      else if (screen.kind === 'controls') this.drawControls(screen as ControlsScreen);
      else if (screen.kind === 'settings') this.drawSettings(screen as SettingsScreen);
      else this.drawSmith(screen as SmithScreen, p);
    }
    for (let i = this.nText; i < this.texts.length; i++) this.texts[i].setVisible(false);
    for (let i = this.nIcon; i < this.icons.length; i++) this.icons[i].setVisible(false);
  }

  /** An item row: icon in a small well, name, and a figure on the right. */
  private row(x: number, y: number, w: number, e: Entry, selected: boolean, label?: string, right?: string, h = label ? 22 : 20) {
    const g = this.g;
    if (selected) {
      g.fillStyle(this.col('dark2'), 1).fillRect(x - 3, y - 2 + Math.floor((22 - h) / 2), w + 6, h);
      g.fillStyle(this.col('flame1'), 1).fillRect(x - 3, y - 2 + Math.floor((22 - h) / 2), 1, h);
    }
    g.fillStyle(this.col('dark1'), 1).fillRect(x, y, 18, 18);
    this.icon(x + 1, y + 1, e.icon, 1, e.id === null && e.icon === 25 ? 0.8 : 1);
    if (label) {
      this.text(x + 23, y, label, 'stone3');
      this.text(x + 23, y + 9, e.name.toUpperCase(), selected ? 'wax2' : 'stone4');
    } else {
      this.text(x + 23, y + 5, e.name.toUpperCase(), selected ? 'wax2' : 'stone4');
      if (e.on) this.text(x + 23 + e.name.length * 6 + 4, y + 5, 'E', 'flame2');
    }
    if (right) this.text(x + w - right.length * 6, y + (label ? 9 : 5), right, 'stone3');
  }

  /** Name, stat lines and description, wrapped to `cols`, never running past `maxLines` lines in all. */
  private details(x: number, y: number, cols: number, e: Entry | null, maxLines = 7, name = true) {
    if (!e) return;
    let yy = y;
    if (name) {
      this.text(x, yy, e.name.toUpperCase(), 'flame2');
      yy += 11;
    }
    const stats = e.stats.flatMap(s => wrap(s, cols).split('\n'));
    for (const s of stats) {
      this.text(x, yy, s, 'stone4');
      yy += 9;
    }
    const room = Math.max(1, maxLines - stats.length);
    const all = wrap(e.description, cols).split('\n');
    const lines = all.slice(0, room);
    if (all.length > room) lines[room - 1] = lines[room - 1].slice(0, cols - 3) + '...';
    if (lines[0]) this.text(x, yy + 3, lines.join('\n'), 'wax1');
  }

  private drawEquip(s: GearScreen, p: Player) {
    const W = DATA.game.width;
    this.text(20, 16, 'EQUIPMENT', 'flame2', 2);
    // the slots (while choosing, the one being changed stays highlighted)
    s.slotRows().forEach((entry, i) => {
      const slot = SLOTS[i];
      const sel = s.choosing ? s.choosing.key === slot.key : s.row === i;
      const ring = slot.key === 'ring0' || slot.key === 'ring1';
      this.row(22, SLOT_Y + i * SLOT_STEP, 196, entry, sel, slot.label, ring ? '' : entry.weight ? entry.weight.toFixed(1) : '-', SLOT_STEP);
    });
    // right: your standing, or the choices
    const rx = 250;
    if (s.choosing) {
      const c = s.choosing;
      this.text(rx, 42, `CHOOSE: ${SLOTS.find(sl => sl.key === c.key)!.label}`, 'stone3');
      const max = 6;
      const first = Math.max(0, Math.min(c.index - 2, c.options.length - max));
      c.options.slice(first, first + max).forEach((e, i) => {
        this.row(rx, 54 + i * 21, W - rx - 22, e, first + i === c.index, undefined, e.weight ? e.weight.toFixed(1) : '-');
      });
      if (first > 0) this.text(W - 30, 54, '^', 'stone3');
      if (first + max < c.options.length) this.text(W - 30, 54 + (max - 1) * 21 + 8, 'v', 'stone3');
    } else {
      this.text(rx, 42, 'YOU', 'stone3');
      const absorb = Math.round(p.armourAbsorb * 100);
      const lines = [
        `LEVEL ${p.level}  VIT ${p.stats.vitality} END ${p.stats.endurance} STR ${p.stats.strength} DEX ${p.stats.dexterity}`,
        `HP ${p.hp}/${p.maxHp}   STAMINA ${p.stamina.max}`,
        `ARMOUR TAKES ${absorb}% OFF DAMAGE`,
        `POISE ${p.poise.max}`,
        `ROLL: ${p.loadTier.note.toUpperCase()}`,
        p.loadTier.sprint ? '' : 'CANNOT RUN',
      ].filter(Boolean);
      lines.forEach((l, i) => this.text(rx, 54 + i * 11, l, i === 4 ? TIER_COLOUR[p.loadTier.id] : 'stone4'));
      // what the rings and any timed effects are doing
      const on = p.rings.filter((r): r is string => !!r && !!DATA.rings[r]).map(r => DATA.rings[r].effect.toUpperCase());
      for (const b of p.buffs) {
        const u = DATA.consumables[b.id]?.use;
        if (u?.type === 'buff') on.push(`${u.label} ${Math.ceil(b.ticks / DATA.game.tickRate)}S`);
      }
      on.slice(0, 5).forEach((l, i) => this.text(rx, 54 + (lines.length + 0.5) * 11 + i * 10, l.slice(0, 32), 'wax1'));
    }
    // bottom: details and the load
    this.g.fillStyle(this.col('stone1'), 1).fillRect(20, 176, W - 40, 1);
    this.details(22, 182, 44, s.selected(), 5);
    this.loadBox(300, 182, W - 322, s);
    this.text(22, DATA.game.height - 18, s.choosing ? 'UP/DOWN CHOOSE   E/ENTER EQUIP   ESC BACK' : 'UP/DOWN SELECT   E/ENTER CHANGE   ESC BACK', 'stone2');
  }

  // ------------------------------------------------------------------ controls and settings
  private drawControls(s: ControlsScreen) {
    const W = DATA.game.width;
    const H = DATA.game.height;
    this.text(20, 16, 'CONTROLS', 'flame2', 2);
    this.text(W - 22 - 'KEYBOARD / MOUSE     GAMEPAD'.length * 6, 22, 'KEYBOARD / MOUSE     GAMEPAD', 'stone3');
    const rows = [...CONTROL_ROWS.map(r => ({ label: r.label, keys: keysText(r.action), pad: padText(r.action) })), { label: 'RESET ALL KEYS TO DEFAULT', keys: '', pad: '' }];
    const max = 15;
    const first = Math.max(0, Math.min(s.index - 7, rows.length - max));
    rows.slice(first, first + max).forEach((r, i) => {
      const y = 40 + i * 12;
      const sel = first + i === s.index;
      if (sel) this.g.fillStyle(this.col('dark2'), 1).fillRect(18, y - 2, W - 36, 11);
      this.text(22, y, r.label, sel ? 'wax2' : 'stone4');
      const keys = sel && s.waiting ? 'PRESS A KEY...' : r.keys;
      this.text(250, y, keys.slice(0, 22), sel && s.waiting ? 'flame2' : 'wax1');
      this.text(W - 22 - r.pad.length * 6, y, r.pad, 'stone3');
    });
    if (first > 0) this.text(12, 40, '^', 'stone3');
    if (first + max < rows.length) this.text(12, 40 + (max - 1) * 12, 'v', 'stone3');
    if (s.message) this.text(22, H - 30, s.message.toUpperCase(), 'moss2');
    this.text(22, H - 18, s.waiting ? 'PRESS THE NEW KEY OR MOUSE BUTTON   ESC CANCEL' : 'UP/DOWN SELECT   E/ENTER REBIND   ESC BACK', 'stone2');
  }

  private drawSettings(s: SettingsScreen) {
    const W = DATA.game.width;
    const H = DATA.game.height;
    this.text(20, 16, 'SETTINGS', 'flame2', 2);
    SETTING_ROWS.forEach((r, i) => {
      const y = 46 + i * 22;
      const sel = s.index === i;
      if (sel) {
        this.g.fillStyle(this.col('dark2'), 1).fillRect(18, y - 5, W - 36, 18);
        this.g.fillStyle(this.col('flame1'), 1).fillRect(18, y - 5, 1, 18);
      }
      this.text(26, y, r.label, sel ? 'wax2' : 'stone4');
      if (r.key === 'hints' || r.key === 'minimap') {
        const on = SETTINGS[r.key];
        this.text(200, y, on ? '< ON >' : '< OFF >', on ? (sel ? 'flame2' : 'stone4') : 'stone2');
        return;
      }
      const v = SETTINGS[r.key];
      const bx = 200;
      const bw = 200;
      this.g.fillStyle(this.col('dark1'), 1).fillRect(bx, y, bw, 7);
      this.g.fillStyle(this.col(sel ? 'flame2' : 'stone3'), 1).fillRect(bx, y + 1, Math.round(bw * v), 5);
      for (let t = 1; t < 10; t++) this.g.fillStyle(this.col('ink'), 1).fillRect(bx + Math.round((bw * t) / 10), y + 1, 1, 5);
      const pct = v === 0 ? 'OFF' : `${Math.round(v * 100)}%`;
      this.text(bx + bw + 10, y, pct, sel ? 'wax2' : 'stone4');
    });
    this.text(26, 46 + SETTING_ROWS.length * 22 + 4, 'KEYS ARE CHANGED UNDER CONTROLS.', 'stone3');
    this.text(22, H - 18, 'UP/DOWN SELECT   LEFT/RIGHT CHANGE   ESC BACK', 'stone2');
  }


  // ------------------------------------------------------------------ the townsfolk's screens
  /** Title, and the Tallow you carry top-right. */
  private serviceHeader(title: string, p: Player) {
    const W = DATA.game.width;
    this.text(20, 16, title, 'flame2', 2);
    const t = `${p.tallow}`;
    this.text(W - 22 - t.length * 6, 20, t, 'wax2');
    this.icon(W - 22 - t.length * 6 - 18, 15, DATA.items.tallow_lump?.icon ?? 14);
  }

  /** The last action's result, and the key hints, along the bottom. */
  private serviceFooter(s: { message: { text: string; good: boolean } | null }, hints: string) {
    const H = DATA.game.height;
    if (s.message) this.text(22, H - 32, wrap(s.message.text.toUpperCase(), 72).split('\n')[0], s.message.good ? 'moss2' : 'blood2');
    this.text(22, H - 18, hints, 'stone2');
  }

  private drawLevelUp(s: LevelUpScreen, p: Player) {
    this.serviceHeader('LEVEL UP', p);
    const W = DATA.game.width;
    const { now, after } = s.preview();
    STATS.forEach((k, i) => {
      const y = 48 + i * 30;
      const sel = s.index === i;
      if (sel) {
        this.g.fillStyle(this.col('dark2'), 1).fillRect(19, y - 3, 212, 27);
        this.g.fillStyle(this.col('flame1'), 1).fillRect(19, y - 3, 1, 27);
      }
      const v = p.stats[k];
      const add = s.pending[k];
      this.text(26, y, k.toUpperCase(), sel ? 'wax2' : 'stone4');
      const val = add ? `${v} -> ${v + add}` : `${v}`;
      this.text(226 - val.length * 6, y, val, add ? 'moss2' : 'stone4');
      if (sel) this.text(226 - val.length * 6 - 16, y, '<', add ? 'stone4' : 'stone1');
      if (sel) this.text(230, y, '>', 'stone4');
      this.text(26, y + 11, (DATA.levels.notes[k] ?? '').toUpperCase(), 'stone3');
    });
    // right: what it comes to
    const rx = 252;
    const line = (i: number, label: string, a: number | string, b: number | string, fmt = (x: number | string) => String(x)) => {
      const changed = a !== b;
      this.text(rx, 48 + i * 12, label, 'stone3');
      this.text(rx + 84, 48 + i * 12, changed ? `${fmt(a)} -> ${fmt(b)}` : fmt(a), changed ? 'moss2' : 'stone4');
    };
    line(0, 'LEVEL', now.level, after.level);
    const short = s.cost > p.tallow;
    this.text(rx, 48 + 1 * 12, 'COST', 'stone3');
    this.text(rx + 84, 48 + 1 * 12, s.added ? `${s.cost}` : '-', short ? 'blood2' : 'stone4');
    this.text(rx, 48 + 2 * 12, 'NEXT POINT', 'stone3');
    this.text(rx + 84, 48 + 2 * 12, `${levelCost(p.level + s.added)}`, s.cost + levelCost(p.level + s.added) > p.tallow ? 'blood2' : 'stone4');
    line(4, 'HP', now.hp, after.hp);
    line(5, 'STAMINA', now.stamina, after.stamina);
    line(6, 'CAPACITY', now.capacity, after.capacity, x => Number(x).toFixed(1));
    const hand = (i: number, label: string, a: { weapon: string; damage: number } | null, b: { weapon: string; damage: number } | null) => {
      if (!a || !b) return;
      const w = DATA.weapons[a.weapon];
      this.text(rx, 48 + i * 12, label, 'stone3');
      this.text(rx + 84, 48 + i * 12, a.damage !== b.damage ? `${a.damage} -> ${b.damage}` : `${a.damage}`, a.damage !== b.damage ? 'moss2' : 'stone4');
      this.text(rx, 48 + i * 12 + 10, `${w.name.toUpperCase()}  ${gradeText(a.weapon)}`.slice(0, Math.floor((W - 26 - rx) / 6)), 'stone2');
    };
    hand(8, 'RIGHT HAND', now.right, after.right);
    hand(11, 'LEFT HAND', now.left, after.left);
    this.serviceFooter(s, s.added ? 'LEFT/RIGHT REMOVE/ADD   E/ENTER CONFIRM   ESC UNDO' : 'UP/DOWN STAT   RIGHT ADD A POINT   ESC LEAVE');
  }

  private drawShop(s: ShopScreen, p: Player) {
    this.serviceHeader("OSKAR'S STALL", p);
    const list = s.list();
    const max = 8;
    const first = Math.max(0, Math.min(s.index - 3, list.length - max));
    list.slice(first, first + max).forEach((r, i) => {
      const e = { id: r.entry.id, name: r.name, icon: r.icon, weight: null, stats: [], description: '' };
      this.row(22, 46 + i * 21, 208, e, first + i === s.index, undefined, r.soldOut ? 'SOLD' : String(r.price));
    });
    if (first > 0) this.text(236, 46, '^', 'stone3');
    if (first + max < list.length) this.text(236, 46 + (max - 1) * 21 + 8, 'v', 'stone3');
    const r = list[s.index];
    if (r) {
      this.g.fillStyle(this.col('dark1'), 1).fillRect(250, 46, 34, 34);
      this.icon(251, 47, r.icon, 2);
      this.text(292, 50, wrap(r.name.toUpperCase(), 26), 'flame2');
      this.text(292, 70, r.soldOut ? 'SOLD OUT' : `${r.price} TALLOW`, r.soldOut ? 'stone3' : r.price > p.tallow ? 'blood2' : 'wax2');
      this.details(250, 88, 34, { id: r.entry.id, name: r.name, icon: r.icon, weight: null, stats: r.stats, description: r.description }, 12, false);
    }
    this.serviceFooter(s, 'UP/DOWN CHOOSE   E/ENTER BUY   ESC LEAVE');
  }

  private drawSmith(s: SmithScreen, p: Player) {
    this.serviceHeader("BEDE'S BLOCK", p);
    const W = DATA.game.width;
    // the materials you carry, next to the Tallow
    let mx = W - 150;
    for (const id of ['tallow_ingot', 'ember_salt']) {
      const c = DATA.consumables[id];
      if (!c) continue;
      this.icon(mx, 15, c.icon);
      this.text(mx + 18, 20, String(p.count(id)), 'wax2');
      mx += 40;
    }
    const list = s.weapons();
    if (!list.length) this.text(22, 50, 'YOU CARRY NOTHING BEDE CAN WORK.', 'stone3');
    const max = 8;
    const first = Math.max(0, Math.min(s.index - 3, list.length - max));
    list.slice(first, first + max).forEach((id, i) => {
      const w = DATA.weapons[id];
      const lvl = p.upgrades[id] ?? 0;
      const e = { id, name: w.name, icon: w.icon, weight: null, stats: [], description: '' };
      this.row(22, 46 + i * 21, 208, e, first + i === s.index, undefined, `+${lvl}`);
    });
    const id = list[s.index];
    if (!id) return this.serviceFooter(s, 'ESC LEAVE');
    const w = DATA.weapons[id];
    const lvl = p.upgrades[id] ?? 0;
    const rx = 250;
    this.g.fillStyle(this.col('dark1'), 1).fillRect(rx, 46, 34, 34);
    this.icon(rx + 1, 47, w.icon, 2);
    this.text(292, 50, wrap(`${w.name.toUpperCase()} +${lvl}`, 26), 'flame2');
    this.text(292, 70, gradeText(id), 'stone3');
    const n = s.next(id);
    if (!n) {
      this.text(rx, 92, `FULLY UPGRADED (+${DATA.smith.levels.length})`, 'moss2');
      this.text(rx, 104, `DAMAGE ${weaponDamage(p, id, lvl)}`, 'stone4');
    } else {
      this.text(rx, 92, `NEXT: +${n.level}`, 'wax2');
      const a = weaponDamage(p, id, lvl);
      const b = weaponDamage(p, id, n.level);
      this.text(rx, 106, 'DAMAGE', 'stone3');
      this.text(rx + 72, 106, `${a} -> ${b}`, 'moss2');
      this.text(rx, 120, 'TALLOW', 'stone3');
      this.text(rx + 72, 120, `${n.tallow}`, p.tallow >= n.tallow ? 'stone4' : 'blood2');
      n.materials.forEach((m, i) => {
        const c = DATA.consumables[m.id];
        this.icon(rx, 131 + i * 17, c.icon);
        this.text(rx + 20, 136 + i * 17, c.name.toUpperCase(), 'stone3');
        this.text(rx + 120, 136 + i * 17, `NEED ${m.need} (HAVE ${m.have})`, m.have >= m.need ? 'stone4' : 'blood2');
      });
      this.text(rx, 170, wrap(`EACH LEVEL ADDS ${Math.round(DATA.smith.damagePerLevel * 100)}% DAMAGE. YOUR STATS ADD MORE THROUGH ITS GRADES.`, 34), 'stone2');
    }
    this.serviceFooter(s, 'UP/DOWN CHOOSE   E/ENTER UPGRADE   ESC LEAVE');
  }

  private loadBox(x: number, y: number, w: number, s: GearScreen) {
    const g = this.g;
    const L = s.load();
    const frac = (v: number) => Math.min(1, v / L.capacity);
    this.text(x, y, 'EQUIP LOAD', 'stone3');
    const shown = L.preview ?? L.now;
    this.text(x + w - `${shown.toFixed(1)}/${L.capacity}`.length * 6, y, `${shown.toFixed(1)}/${L.capacity}`, L.preview !== null && L.preview !== L.now ? 'wax2' : 'stone4');
    const by = y + 12;
    g.fillStyle(this.col('dark1'), 1).fillRect(x, by, w, 7);
    // tier bands behind the bar
    let from = 0;
    for (const t of DATA.load.tiers) {
      const to = Math.min(1, t.upTo);
      g.fillStyle(this.col(TIER_COLOUR[t.id]), 0.18).fillRect(x + Math.round(from * w), by, Math.round((to - from) * w), 7);
      from = to;
      if (from >= 1) break;
    }
    g.fillStyle(this.col(TIER_COLOUR[loadTierId(L.now, L.capacity)]), 1).fillRect(x, by + 1, Math.round(frac(L.now) * w), 5);
    if (L.preview !== null && L.preview !== L.now) {
      const a = Math.min(frac(L.now), frac(L.preview));
      const b = Math.max(frac(L.now), frac(L.preview));
      g.fillStyle(this.col(L.preview > L.now ? 'blood2' : 'wax2'), 0.8).fillRect(x + Math.round(a * w), by + 1, Math.max(1, Math.round((b - a) * w)), 5);
    }
    for (const t of DATA.load.tiers) if (t.upTo <= 1) g.fillStyle(this.col('stone3'), 1).fillRect(x + Math.round(t.upTo * w) - 1, by - 2, 1, 11);
    const pct = Math.round((shown / L.capacity) * 100);
    this.text(x, by + 12, `${L.tier.label} (${pct}%)`, TIER_COLOUR[L.tier.id]);
    this.text(x, by + 22, wrap(L.tier.note.toUpperCase(), Math.floor(w / 6)), 'stone4');
    if (!L.tier.sprint) this.text(x, by + 42, 'CANNOT RUN', 'blood2');
  }

  private drawInventory(s: GearScreen) {
    const W = DATA.game.width;
    this.text(20, 16, 'INVENTORY', 'flame2', 2);
    // tabs
    let tx = 22;
    TABS.forEach((t, i) => {
      const on = i === s.tab;
      this.text(tx, 40, t, on ? 'flame2' : 'stone3');
      if (on) this.g.fillStyle(this.col('flame1'), 1).fillRect(tx, 49, t.length * 6 - 1, 1);
      tx += t.length * 6 + 16;
    });
    this.text(W - 90, 40, '< > TABS', 'stone2');
    const list = s.list();
    if (!list.length) this.text(22, 60, 'NOTHING YET.', 'stone3');
    const max = 9;
    const first = Math.max(0, Math.min(s.index - 4, list.length - max));
    list.slice(first, first + max).forEach((e, i) => {
      const right = e.qty ?? (e.weight !== null ? e.weight.toFixed(1) : '');
      this.row(22, 56 + i * 21, 208, e, first + i === s.index, undefined, right);
    });
    // details, with a large icon (a note is shown for reading instead)
    const e = list[s.index];
    if (e && TABS[s.tab] === 'NOTES') {
      this.text(250, 56, wrap(e.name.toUpperCase(), 34), 'flame2');
      const lines = wrapParagraphs(e.description, 34);
      const room = Math.floor((DATA.game.height - 26 - 72) / 8);
      this.text(250, 72, lines.slice(0, room).join('\n'), 'wax1');
    } else if (e) {
      this.g.fillStyle(this.col('dark1'), 1).fillRect(250, 56, 34, 34);
      this.icon(251, 57, e.icon, 2);
      this.text(292, 62, wrap(e.name.toUpperCase(), 26), 'flame2');
      if (e.weight !== null) this.text(292, 80, `WEIGHT ${e.weight.toFixed(1)}${e.on ? '   EQUIPPED' : ''}`, 'stone3');
      else if (e.qty) this.text(292, 80, e.qty, 'stone3');
      this.details(250, 98, 34, e, 14, false);
    }
    const onItems = TABS[s.tab] === 'ITEMS' && e?.id && DATA.consumables[e.id] && DATA.consumables[e.id].use.type !== 'material';
    this.text(22, DATA.game.height - 18, onItems ? 'UP/DOWN SELECT   E/ENTER PUT ON BELT   LEFT/RIGHT TAB   ESC BACK' : 'UP/DOWN SELECT   LEFT/RIGHT TAB   ESC BACK', 'stone2');
  }
}

const SLOT_Y = 38;
const SLOT_STEP = 22;

/** Wrap text that has its own line breaks (paragraphs, verses): each line wrapped on its own. */
function wrapParagraphs(text: string, cols: number): string[] {
  return text.split('\n').flatMap(l => (l.trim() ? wrap(l, cols).split('\n') : ['']));
}

function loadTierId(load: number, capacity: number) {
  const f = load / capacity;
  return (DATA.load.tiers.find(t => f <= t.upTo + 1e-9) ?? DATA.load.tiers[DATA.load.tiers.length - 1]).id;
}
