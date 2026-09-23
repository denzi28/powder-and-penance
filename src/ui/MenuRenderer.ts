// Draws a Menu as a centred panel in the pixel font. Shared by the shrine menu and the title screen.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { hexToInt } from './colors';
import type { Menu } from './Menu';

export class MenuRenderer {
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private subtitle: Phaser.GameObjects.BitmapText;
  private rows: Phaser.GameObjects.BitmapText[] = [];

  constructor(private scene: Phaser.Scene, private depth: number, private panel = true) {
    this.g = scene.add.graphics().setDepth(depth);
    this.title = scene.add.bitmapText(0, 0, 'pixel', '').setScale(2).setDepth(depth + 1);
    this.subtitle = scene.add.bitmapText(0, 0, 'pixel', '').setDepth(depth + 1);
  }

  draw(menu: Menu | null, centerY = DATA.game.height / 2) {
    const pal = DATA.palette;
    this.g.clear();
    const visible = !!menu;
    this.title.setVisible(visible);
    this.subtitle.setVisible(visible);
    this.rows.forEach(r => r.setVisible(false));
    if (!menu) return;

    const W = DATA.game.width;
    const lineH = 12;
    const h = 30 + (menu.subtitle ? 12 : 0) + menu.items.length * lineH + 8;
    const top = Math.round(centerY - h / 2);
    this.title.setText(menu.title).setTint(hexToInt(pal.flame2));
    if (this.panel) {
      // Fit the panel to its widest line (6 px per character in the pixel font).
      const rowChars = Math.max(...menu.items.map(i => this.rowText(i, false).length));
      const w = Math.min(W - 16, Math.max(this.title.width, (menu.subtitle?.length ?? 0) * 6, rowChars * 6) + 24);
      const left = Math.round((W - w) / 2);
      this.g.fillStyle(hexToInt(pal.ink), 0.9).fillRect(left, top, w, h);
      this.g.fillStyle(hexToInt(pal.flame1), 1);
      this.g.fillRect(left, top, w, 1).fillRect(left, top + h - 1, w, 1).fillRect(left, top, 1, h).fillRect(left + w - 1, top, 1, h);
    }
    this.title.setPosition(Math.round((W - this.title.width) / 2), top + 8);
    let y = top + 28;
    if (menu.subtitle) {
      this.subtitle.setText(menu.subtitle).setTint(hexToInt(pal.stone4));
      this.subtitle.setPosition(Math.round((W - this.subtitle.width) / 2), y);
      y += 12;
    }
    menu.items.forEach((item, i) => {
      while (this.rows.length <= i) this.rows.push(this.scene.add.bitmapText(0, 0, 'pixel', '').setDepth(this.depth + 1));
      const row = this.rows[i];
      const sel = i === menu.index;
      row.setText(this.rowText(item, sel)).setVisible(true);
      row.setTint(hexToInt(!item.enabled ? pal.stone2 : sel ? pal.wax2 : pal.stone4));
      row.setPosition(Math.round((W - row.width) / 2), y + i * lineH);
    });
  }

  private rowText(item: Menu['items'][number], selected: boolean) {
    return `${selected ? '> ' : '  '}${item.label}${!item.enabled && item.note ? ` (${item.note})` : ''}`;
  }
}

/** Greedy word wrap for the fixed-width pixel font. */
export function wrap(text: string, cols: number): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > cols) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join('\n');
}
