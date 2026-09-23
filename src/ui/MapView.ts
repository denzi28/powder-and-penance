// Minimap (top-right corner) and the large map (M). Both show the current area from one canvas texture,
// one pixel per tile, containing only rooms the player has visited ("seen:<room>" flags). It is redrawn
// only when something on it changes: a new room seen, the player's room, a door or shrine state.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { Cell, TILE } from '../world/TileGrid';
import { hexToInt } from './colors';
import type { GameScene } from '../scenes/GameScene';

const KEY = 'area_map';
/** Map colours, by palette name. */
const COL = {
  floor: 'stone1',
  floorHere: 'stone2',
  wall: 'stone4',
  door: 'flame1',
  locked: 'blood2',
  exit: 'wax2',
  shrine: 'flame2',
  shrineUnlit: 'ember',
} as const;
const LEGEND: [keyof typeof COL, string][] = [
  ['shrine', 'SHRINE'],
  ['exit', 'EXIT'],
  ['door', 'DOOR'],
  ['locked', 'LOCKED'],
];

export class MapView {
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private sig = '';
  /** Bounding box of the seen rooms, in texture pixels (= grid-local tiles), exclusive max. */
  private bbox = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private mini: Phaser.GameObjects.Image;
  private big: Phaser.GameObjects.Image;
  private back: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private texts: Phaser.GameObjects.BitmapText[] = [];
  private blink = 0;

  constructor(private scene: Phaser.Scene) {
    this.back = scene.add.graphics().setDepth(17);
    this.mini = scene.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setDepth(3).setVisible(false);
    this.big = scene.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setDepth(18).setVisible(false);
    this.front = scene.add.graphics().setDepth(19);
    this.title = scene.add.bitmapText(0, 0, 'pixel', '').setTint(hexToInt(DATA.palette.flame2)).setDepth(19);
  }

  update(gs: GameScene, deltaMs: number) {
    this.blink += deltaMs;
    this.back.clear();
    this.front.clear();
    this.texts.forEach(t => t.setVisible(false));
    this.title.setVisible(false);
    this.mini.setVisible(false);
    this.big.setVisible(false);
    this.redrawIfChanged(gs);
    if (!this.tex) return;
    if (gs.mapOpen) this.drawBig(gs);
    else if (DATA.hud.minimap.enabled && !gs.menu && !gs.player.dead) this.drawMini(gs);
  }

  // ------------------------------------------------------------------ texture
  private redrawIfChanged(gs: GameScene) {
    const seen = gs.areaRoomList.filter(r => gs.flags.has(`seen:${r.id}`));
    const here = gs.roomAt(gs.player.x, gs.player.y);
    const sig = [
      gs.area,
      gs.grid.w,
      gs.grid.h,
      here,
      seen.map(r => r.id).join(','),
      gs.doors.list.map(d => (d.open ? 1 : d.requires && !gs.flags.has(`key:${d.requires}`) ? 2 : 0)).join(''),
      gs.shrines.list.map(s => (s.lit ? 1 : 0)).join(''),
    ].join('|');
    if (sig === this.sig) return;
    this.sig = sig;

    const grid = gs.grid;
    if (!this.tex || this.tex.width !== grid.w || this.tex.height !== grid.h) {
      if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
      this.tex = this.scene.textures.createCanvas(KEY, grid.w, grid.h);
      this.mini.setTexture(KEY);
      this.big.setTexture(KEY);
    }
    const tex = this.tex!;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, grid.w, grid.h);
    const pal = DATA.palette;
    const put = (tx: number, ty: number, col: keyof typeof COL) => {
      ctx.fillStyle = pal[COL[col]];
      ctx.fillRect(tx - grid.ox, ty - grid.oy, 1, 1);
    };
    const inSeen = (tx: number, ty: number) =>
      seen.some(r => tx >= r.origin[0] && ty >= r.origin[1] && tx < r.origin[0] + r.tiles[0].length && ty < r.origin[1] + r.tiles.length);

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of seen) {
      const [ox, oy] = r.origin;
      const w = r.tiles[0].length;
      const h = r.tiles.length;
      x0 = Math.min(x0, ox - grid.ox);
      y0 = Math.min(y0, oy - grid.oy);
      x1 = Math.max(x1, ox + w - grid.ox);
      y1 = Math.max(y1, oy + h - grid.oy);
      for (let ty = oy; ty < oy + h; ty++)
        for (let tx = ox; tx < ox + w; tx++) {
          if (grid.isGround(tx, ty)) put(tx, ty, r.id === here ? 'floorHere' : 'floor');
          else if (grid.get(tx, ty) === Cell.Wall) {
            // Only walls that border open ground are drawn: the outline of the rooms.
            const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid.isGround(tx + dx, ty + dy));
            if (edge) put(tx, ty, 'wall');
          }
        }
    }
    for (const d of gs.doors.list)
      if (!d.open && inSeen(d.tx, d.ty)) put(d.tx, d.ty, d.requires && !gs.flags.has(`key:${d.requires}`) ? 'locked' : 'door');
    for (const e of gs.exits.list)
      for (let ty = e.y0; ty < e.y1; ty++) for (let tx = e.x0; tx < e.x1; tx++) if (inSeen(tx, ty)) put(tx, ty, 'exit');
    for (const s of gs.shrines.list) {
      const tx = Math.floor(s.x / TILE);
      const ty = Math.floor(s.y / TILE);
      if (inSeen(tx, ty)) {
        put(tx, ty, s.lit ? 'shrine' : 'shrineUnlit');
        put(tx, ty - 1, s.lit ? 'shrine' : 'shrineUnlit');
      }
    }
    tex.refresh();
    this.bbox = seen.length ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
  }

  // ------------------------------------------------------------------ minimap
  private drawMini(gs: GameScene) {
    const cfg = DATA.hud.minimap;
    const W = DATA.game.width;
    const s = cfg.scale;
    const bx = W - 8 - cfg.w;
    const by = 26;
    const vw = Math.floor(cfg.w / s);
    const vh = Math.floor(cfg.h / s);
    const grid = gs.grid;
    const ptx = gs.player.x / TILE - grid.ox;
    const pty = gs.player.y / TILE - grid.oy;
    const cx = Math.round(ptx - vw / 2);
    const cy = Math.round(pty - vh / 2);

    this.back.setDepth(2);
    this.back.fillStyle(hexToInt(DATA.palette.ink), 0.75).fillRect(bx - 1, by - 1, cfg.w + 2, cfg.h + 2);
    this.back.lineStyle(1, hexToInt(DATA.palette.stone1), 1).strokeRect(bx - 1.5, by - 1.5, cfg.w + 3, cfg.h + 3);
    this.crop(this.mini, cx, cy, vw, vh, s, bx, by);
    this.front.setDepth(4);
    this.marker(bx + (ptx - cx) * s, by + (pty - cy) * s, 1);
  }

  // ------------------------------------------------------------------ large map
  private drawBig(gs: GameScene) {
    const W = DATA.game.width;
    const H = DATA.game.height;
    const pal = DATA.palette;
    const grid = gs.grid;
    const b = this.bbox;
    const bw = b.x1 - b.x0 + 2;
    const bh = b.y1 - b.y0 + 2;
    const top = 26;
    const bottom = H - 26;
    const s = Math.max(1, Math.min(6, Math.floor(Math.min((W - 32) / bw, (bottom - top) / bh))));
    const left = Math.round((W - bw * s) / 2);
    const upper = Math.round(top + (bottom - top - bh * s) / 2);
    const px = (tx: number) => left + (tx - (b.x0 - 1)) * s;
    const py = (ty: number) => upper + (ty - (b.y0 - 1)) * s;

    this.back.setDepth(17);
    this.back.fillStyle(hexToInt(pal.ink), 0.94).fillRect(0, 0, W, H);
    this.crop(this.big, b.x0 - 1, b.y0 - 1, bw, bh, s, left, upper);
    this.front.setDepth(19);

    this.title.setText(DATA.areas.areas[gs.area].name.toUpperCase()).setVisible(true);
    this.title.setPosition(Math.round((W - this.title.width) / 2), 10);

    // Where each seen exit leads, written just outside it.
    for (const e of gs.exits.list) {
      const lx = e.x0 - grid.ox;
      const ly = e.y0 - grid.oy;
      if (!gs.flags.has(`seen:${gs.roomAt(e.x0 * TILE + 8, e.y0 * TILE + 8)}`)) continue;
      const t = this.text(DATA.areas.areas[e.to.area].name.toUpperCase(), pal.wax1);
      const cxp = px(lx + (e.x1 - e.x0) / 2);
      const cyp = py(ly + (e.y1 - e.y0) / 2);
      const up = grid.get(e.x0, e.y0 - 1) === Cell.Void;
      const down = grid.get(e.x0, e.y1) === Cell.Void;
      const west = grid.get(e.x0 - 1, e.y0) === Cell.Void;
      let x = cxp - t.width / 2;
      let y = cyp - t.height / 2;
      if (up) y = cyp - s - t.height - 2;
      else if (down) y = cyp + s + 2;
      else if (west) x = cxp - s - t.width - 3;
      else x = cxp + s + 3;
      t.setPosition(Math.round(Phaser.Math.Clamp(x, 2, W - t.width - 2)), Math.round(Phaser.Math.Clamp(y, top - 10, bottom + 2)));
    }

    // You are here.
    this.marker(px(gs.player.x / TILE - grid.ox), py(gs.player.y / TILE - grid.oy), Math.max(1, Math.floor(s / 2)));

    // Legend and controls along the bottom.
    let x = 12;
    const ly = H - 14;
    for (const [col, label] of LEGEND) {
      this.front.fillStyle(hexToInt(pal[COL[col]]), 1).fillRect(x, ly + 1, 5, 5);
      const t = this.text(label, pal.stone4);
      t.setPosition(x + 8, ly);
      x += 8 + t.width + 10;
    }
    this.front.fillStyle(hexToInt(pal.wax2), 1).fillRect(x, ly + 1, 5, 5);
    this.text('YOU', pal.stone4).setPosition(x + 8, ly);
    const close = this.text('[M] CLOSE', pal.wax2);
    close.setPosition(W - 12 - close.width, ly);
  }

  // ------------------------------------------------------------------ helpers
  /** Show the texture region (x, y, w, h) scaled by s with its top-left pixel at screen (sx, sy). */
  private crop(img: Phaser.GameObjects.Image, x: number, y: number, w: number, h: number, s: number, sx: number, sy: number) {
    const tex = this.tex!;
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(tex.width, x + w);
    const y1 = Math.min(tex.height, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    // The crop keeps positions relative to the image origin, so the image sits where texture (0,0) would be.
    img.setScale(s).setCrop(x0, y0, x1 - x0, y1 - y0);
    img.setPosition(Math.round(sx - x * s), Math.round(sy - y * s)).setVisible(true);
  }

  /** The player: a blinking dot with a dark outline. */
  private marker(x: number, y: number, r: number) {
    const on = Math.floor(this.blink / 350) % 2 === 0;
    const pal = DATA.palette;
    const xi = Math.round(x);
    const yi = Math.round(y);
    this.front.fillStyle(hexToInt(pal.ink), 1).fillRect(xi - r - 1, yi - r - 1, 2 * r + 3, 2 * r + 3);
    this.front.fillStyle(hexToInt(on ? pal.wax2 : pal.flame2), 1).fillRect(xi - r, yi - r, 2 * r + 1, 2 * r + 1);
  }

  private text(s: string, color: string) {
    let t = this.texts.find(x => !x.visible);
    if (!t) {
      t = this.scene.add.bitmapText(0, 0, 'pixel', '').setDepth(19);
      this.texts.push(t);
    }
    return t.setText(s).setTint(hexToInt(color)).setVisible(true);
  }
}
