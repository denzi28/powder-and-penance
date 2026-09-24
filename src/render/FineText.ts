// Fine print: small, crisp text drawn over the game. The game is 480x270 blown up by a whole number z, so
// its own text can't be smaller than one game pixel per font pixel. This overlay canvas sits exactly on the
// game at full screen resolution and draws the same pixel font at 2/3 of that (2 screen pixels per font
// pixel where the game uses 3): the same letters, a third smaller. Used for the message box and item
// descriptions. Everything is laid out in game pixels (fractions allowed); `charW` / `lineH` give the metrics.
import { FONT } from '../scenes/BootScene';
import { FONT_URL } from '../data/assets';

export type FineItem =
  | { kind: 'text'; x: number; y: number; text: string; color: number; alpha?: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: number; alpha?: number };

const FIRST_CHAR = 32;

class FineOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private font: HTMLImageElement | null = null;
  private tinted = new Map<number, HTMLCanvasElement>();
  private layers = new Map<string, FineItem[]>();
  private drawn = '';
  /** Screen (device) pixels per game pixel, and per font pixel. */
  private z = 3;
  private s = 2;

  /** Put the overlay over the game canvas; called by the pixel scaler whenever the scale changes. */
  place(game: HTMLCanvasElement, w: number, h: number, z: number, dpr: number) {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.imageRendering = 'pixelated';
      game.parentElement?.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        this.font = img;
        this.drawn = '';
      };
      img.src = FONT_URL;
      const loop = () => {
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    this.z = z;
    this.s = Math.max(1, Math.round((z * 2) / 3));
    const c = this.canvas;
    c.width = w * z;
    c.height = h * z;
    c.style.left = game.style.left;
    c.style.top = game.style.top;
    c.style.width = `${(w * z) / dpr}px`;
    c.style.height = `${(h * z) / dpr}px`;
    this.drawn = '';
  }

  /** Advance of one letter, and height of one line, in game pixels. */
  get charW() {
    return (FONT.cellW * this.s) / this.z;
  }
  get lineH() {
    return ((FONT.cellH + 1) * this.s) / this.z;
  }
  /** Size of a (multi-line) text in game pixels. */
  measure(text: string) {
    const lines = text.split('\n');
    return { w: Math.max(...lines.map(l => l.length)) * this.charW, h: lines.length * this.lineH - this.s / this.z };
  }

  /** Replace what one owner (the message box, the gear screen) shows. An empty list clears it. */
  set(layer: string, items: FineItem[]) {
    this.layers.set(layer, items);
  }

  private render() {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;
    const all = [...this.layers.values()].flat();
    const key = JSON.stringify(all);
    if (key === this.drawn) return;
    this.drawn = this.font ? key : '';
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    const px = (v: number) => Math.round(v * this.z);
    for (const it of all) {
      ctx.globalAlpha = it.alpha ?? 1;
      if (it.kind === 'rect') {
        ctx.fillStyle = `#${it.color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(px(it.x), px(it.y), px(it.x + it.w) - px(it.x), px(it.y + it.h) - px(it.y));
        continue;
      }
      if (!this.font) continue;
      const sheet = this.tint(it.color);
      const s = this.s;
      it.text.split('\n').forEach((line, row) => {
        const y = px(it.y) + row * (FONT.cellH + 1) * s;
        for (let i = 0; i < line.length; i++) {
          const idx = line.charCodeAt(i) - FIRST_CHAR;
          if (idx <= 0 || idx >= 96) continue; // space, or nothing to draw
          const sx = (idx % FONT.charsPerRow) * FONT.cellW;
          const sy = Math.floor(idx / FONT.charsPerRow) * FONT.cellH;
          ctx.drawImage(sheet, sx, sy, FONT.cellW, FONT.cellH, px(it.x) + i * FONT.cellW * s, y, FONT.cellW * s, FONT.cellH * s);
        }
      });
    }
    ctx.globalAlpha = 1;
  }

  /** The font sheet in one colour (it is drawn in white). */
  private tint(color: number): HTMLCanvasElement {
    let t = this.tinted.get(color);
    if (!t) {
      const f = this.font!;
      t = document.createElement('canvas');
      t.width = f.width;
      t.height = f.height;
      const g = t.getContext('2d')!;
      g.drawImage(f, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      g.fillRect(0, 0, t.width, t.height);
      this.tinted.set(color, t);
    }
    return t;
  }
}

export const FINE = new FineOverlay();
if (import.meta.env.DEV) (window as unknown as { __fine: FineOverlay }).__fine = FINE; // console debugging
