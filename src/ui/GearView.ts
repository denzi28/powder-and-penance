// Draws the gear screens (GearScreen) over the game: a full panel in the pixel font with item icons.
//   EQUIPMENT: the five slots on the left; on the right your armour and roll, or the choices for a slot;
//              the highlighted item's details and the equip-load bar along the bottom.
//   INVENTORY: tabs across the top, the list on the left, the details on the right.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from './colors';
import { wrap } from './MenuRenderer';
import { SLOTS, TABS, type Entry, type GearScreen } from './GearScreen';
import type { Player } from '../player/Player';

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

  draw(screen: GearScreen | null, p: Player) {
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
      else this.drawInventory(screen);
    }
    for (let i = this.nText; i < this.texts.length; i++) this.texts[i].setVisible(false);
    for (let i = this.nIcon; i < this.icons.length; i++) this.icons[i].setVisible(false);
  }

  /** An item row: icon in a small well, name, and a figure on the right. */
  private row(x: number, y: number, w: number, e: Entry, selected: boolean, label?: string, right?: string) {
    const g = this.g;
    if (selected) {
      g.fillStyle(this.col('dark2'), 1).fillRect(x - 3, y - 2, w + 6, label ? 22 : 20);
      g.fillStyle(this.col('flame1'), 1).fillRect(x - 3, y - 2, 1, label ? 22 : 20);
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
    // the five slots (while choosing, the one being changed stays highlighted)
    s.slotRows().forEach((entry, i) => {
      const slot = SLOTS[i];
      const sel = s.choosing ? s.choosing.key === slot.key : s.row === i;
      this.row(22, 42 + i * 26, 196, entry, sel, slot.label, entry.weight ? entry.weight.toFixed(1) : '-');
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
        `HP ${p.hp}/${p.maxHp}`,
        `ARMOUR TAKES ${absorb}% OFF DAMAGE`,
        `POISE ${p.poise.max}`,
        `ROLL: ${p.loadTier.note.toUpperCase()}`,
        p.loadTier.sprint ? '' : 'CANNOT RUN',
      ].filter(Boolean);
      lines.forEach((l, i) => this.text(rx, 54 + i * 11, l, i === 3 ? TIER_COLOUR[p.loadTier.id] : 'stone4'));
    }
    // bottom: details and the load
    this.g.fillStyle(this.col('stone1'), 1).fillRect(20, 176, W - 40, 1);
    this.details(22, 182, 44, s.selected(), 5);
    this.loadBox(300, 182, W - 322, s);
    this.text(22, DATA.game.height - 18, s.choosing ? 'UP/DOWN CHOOSE   E/ENTER EQUIP   ESC BACK' : 'UP/DOWN SELECT   E/ENTER CHANGE   ESC BACK', 'stone2');
    // a shield can't be used with a two-handed weapon in hand (it still weighs what it weighs)
    if (p.shieldId && p.lockedSlot !== null) this.text(22 + 23 + 'LEFT HAND'.length * 6 + 6, 42 + 2 * 26, 'UNUSED (TWO-HANDED)', 'blood2');
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
    g.fillStyle(this.col(TIER_COLOUR[loadTierId(L.now)]), 1).fillRect(x, by + 1, Math.round(frac(L.now) * w), 5);
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
    // details, with a large icon
    const e = list[s.index];
    if (e) {
      this.g.fillStyle(this.col('dark1'), 1).fillRect(250, 56, 34, 34);
      this.icon(251, 57, e.icon, 2);
      this.text(292, 62, wrap(e.name.toUpperCase(), 26), 'flame2');
      if (e.weight !== null) this.text(292, 80, `WEIGHT ${e.weight.toFixed(1)}${e.on ? '   EQUIPPED' : ''}`, 'stone3');
      else if (e.qty) this.text(292, 80, e.qty, 'stone3');
      this.details(250, 98, 34, e, 14, false);
    }
    this.text(22, DATA.game.height - 18, 'UP/DOWN SELECT   LEFT/RIGHT TAB   ESC BACK', 'stone2');
  }
}

function loadTierId(load: number) {
  const f = load / DATA.load.capacity;
  return (DATA.load.tiers.find(t => f <= t.upTo + 1e-9) ?? DATA.load.tiers[DATA.load.tiers.length - 1]).id;
}
