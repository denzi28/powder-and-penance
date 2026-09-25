// The cutscene stage: what a script puts in front of the camera while the world waits. Actors are puppets
// (any sprite sheet: an animation of a character, a strip of NPC frames, one decor frame) that walk, roll,
// hop and change pose; speech bubbles pop up over them (several at once, so people can talk over each other);
// bursts of dust, sparks, wax or water go off; world pieces (the player, an NPC, all decor of a kind) can be
// hidden while a stand-in plays their part. Everything is cleared when the script ends or is skipped.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { AnimPlayer } from '../anim/AnimPlayer';
import { DEPTH } from '../render/depth';
import { hexToInt } from '../ui/colors';
import { TILE } from '../world/TileGrid';
import type { Dir8 } from '../core/math';
import type { GameScene } from '../scenes/GameScene';

/** Where something is: a target string ("player", "npc:id", "point:id", "actor:id", "enemy:kind") or room tiles. */
export type At = string | readonly [number, number];

interface Pose {
  anim?: string;
  dir?: string;
  frames?: number[];
  every?: number;
  frame?: number;
  flip?: boolean;
}

interface Actor {
  id: string;
  sheet: string;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse | null;
  x: number;
  y: number;
  /** Drawn this many px higher (a driver on his seat), and depth-biased. */
  lift: number;
  z: number;
  player: AnimPlayer | null;
  dir: Dir8;
  frames: number[] | null;
  every: number;
  t: number;
  flip: boolean;
  move: { fx: number; fy: number; tx: number; ty: number; t: number; ticks: number; arc: number; face: boolean } | null;
  /** Jitter (a cart on a rough road, a thing convulsing), px. */
  shake: number;
  bob: number;
}

interface Bubble {
  text: string;
  over: string;
  t: number;
  ticks: number;
}

/** Particle presets for `burst`: colours, spread and speed. */
const BURSTS: Record<string, { cols: string[]; z: number; spread: number; speed: number; up: boolean; stain?: boolean }> = {
  dust: { cols: ['stone4', 'wood2', 'stone3'], z: 2, spread: Math.PI * 2, speed: 70, up: false },
  debris: { cols: ['wood1', 'wood2', 'stone3'], z: 6, spread: Math.PI * 2, speed: 130, up: true },
  sparks: { cols: ['flame2', 'flame1'], z: 8, spread: Math.PI * 2, speed: 120, up: true },
  flame: { cols: ['flame1', 'flame2', 'ember'], z: 6, spread: 1.2, speed: 60, up: true },
  wax: { cols: ['wax1', 'wax2'], z: 10, spread: 1.6, speed: 70, up: true, stain: true },
  blood: { cols: ['blood2', 'blood1'], z: 10, spread: 1.6, speed: 80, up: true, stain: true },
  smoke: { cols: ['stone2', 'dark2', 'stone3'], z: 10, spread: 0.8, speed: 25, up: true },
  water: { cols: ['teal3', 'cyan', 'stone4'], z: 4, spread: 1.4, speed: 80, up: true },
  feathers: { cols: ['dark1', 'dark2', 'stone2'], z: 12, spread: Math.PI * 2, speed: 60, up: true },
  petals: { cols: ['blossom', 'blossom', 'wax1'], z: 14, spread: Math.PI * 2, speed: 35, up: true },
  honey: { cols: ['honey', 'flame2'], z: 8, spread: 1.4, speed: 60, up: true, stain: true },
};

const WRAP = 22;

export class Stage {
  private actors = new Map<string, Actor>();
  private bubbles: Bubble[] = [];
  private hidden = new Set<string>();
  /** The actor the camera rides with, if any. */
  follow: string | null = null;
  private g: Phaser.GameObjects.Graphics | null = null;
  private texts: Phaser.GameObjects.BitmapText[] = [];

  constructor(private gs: GameScene) {}

  get busy() {
    return this.actors.size > 0 || this.bubbles.length > 0 || this.hidden.size > 0;
  }

  // ------------------------------------------------------------------ positions
  /** Room tiles are counted from the origin of the room the player is in (the bottom-centre of the tile). */
  pos(at: At): { x: number; y: number } {
    const gs = this.gs;
    if (Array.isArray(at)) {
      const room = gs.areaRoomList.find(r => r.id === gs.roomAt(gs.player.x, gs.player.y)) ?? gs.areaRoomList[0];
      return { x: (room.origin[0] + at[0]) * TILE + TILE / 2, y: (room.origin[1] + at[1]) * TILE + TILE - 2 };
    }
    const target = at as string;
    if (target === 'player') return { x: gs.player.x, y: gs.player.y };
    const [kind, id] = target.split(/:(.*)/);
    if (kind === 'actor') {
      const a = this.actors.get(id);
      if (a) return { x: a.x, y: a.y - a.lift };
    }
    if (kind === 'npc') {
      const n = gs.npcs.get(id);
      if (n) return { x: n.x, y: n.y };
    }
    if (kind === 'enemy') {
      const e = gs.enemies.find(x => x.kind === id);
      if (e) return { x: e.x, y: e.y - 12 };
    }
    if (kind === 'point')
      for (const r of gs.areaRoomList)
        for (const en of r.entities)
          if (en.type === 'point' && en.id === id) return { x: (r.origin[0] + en.at[0]) * TILE + TILE / 2, y: (r.origin[1] + en.at[1]) * TILE + TILE / 2 };
    return { x: gs.player.x, y: gs.player.y };
  }

  // ------------------------------------------------------------------ steps
  add(id: string, sheet: string, at: At, pose: Pose, opt: { lift?: number; z?: number; shadow?: boolean; bob?: number }) {
    this.remove(id);
    const p = this.pos(at);
    const sprite = this.gs.lib.sprite(sheet);
    const shadow = opt.shadow === false ? null : this.gs.add.ellipse(p.x, p.y, 14, 5, hexToInt(DATA.palette.ink), 0.35).setDepth(DEPTH.shadow + 1);
    const a: Actor = {
      id, sheet, sprite, shadow, x: p.x, y: p.y, lift: opt.lift ?? 0, z: opt.z ?? 0, player: null, dir: 'S', frames: null, every: 10, t: 0,
      flip: false, move: null, shake: 0, bob: opt.bob ?? 0,
    };
    this.actors.set(id, a);
    this.pose(a, pose);
  }

  play(id: string, pose: Pose & { shake?: number }) {
    const a = this.actors.get(id);
    if (!a) return;
    this.pose(a, pose);
    if (pose.shake !== undefined) a.shake = pose.shake;
  }

  private pose(a: Actor, p: Pose) {
    if (p.flip !== undefined) a.flip = p.flip;
    if (p.dir) a.dir = p.dir as Dir8;
    if (p.anim) {
      const m = this.gs.lib.manifest(a.sheet);
      a.player ??= new AnimPlayer(m.animations);
      a.player.play(p.anim, { restart: true });
      a.frames = null;
    } else if (p.frames) {
      a.frames = p.frames;
      a.every = p.every ?? 10;
      a.player = null;
    } else if (p.frame !== undefined) {
      a.frames = [p.frame];
      a.player = null;
    }
  }

  moveTo(id: string, to: At, ticks: number, opt: { arc?: number; face?: boolean; anim?: string; dir?: string }) {
    const a = this.actors.get(id);
    if (!a) return;
    const p = this.pos(to);
    a.move = { fx: a.x, fy: a.y, tx: p.x, ty: p.y, t: 0, ticks: Math.max(1, ticks), arc: opt.arc ?? 0, face: opt.face ?? true };
    if (opt.anim || opt.dir) this.pose(a, { anim: opt.anim, dir: opt.dir });
  }

  remove(id: string) {
    const a = this.actors.get(id);
    if (!a) return;
    a.sprite.destroy();
    a.shadow?.destroy();
    this.actors.delete(id);
    if (this.follow === id) this.follow = null;
  }

  bubble(text: string, over: string, ticks?: number) {
    this.bubbles = this.bubbles.filter(b => b.over !== over); // one line at a time per speaker
    this.bubbles.push({ text, over, t: 0, ticks: ticks ?? 50 + text.length * 3 });
    this.gs.bus.emit('sfx', { id: 'voice', volume: 0.35, pitch: 0.8 + Math.random() * 0.4 });
  }

  burst(kind: string, at: At, count = 12) {
    const b = BURSTS[kind] ?? BURSTS.dust;
    const p = this.pos(at);
    for (const col of b.cols)
      this.gs.particles.burst(p.x, p.y, b.z, b.up ? -Math.PI / 2 : 0, b.spread, Math.ceil(count / b.cols.length), b.speed, col, !!b.stain);
  }

  /** Hide (or show again) "player", "npc:<placement>" or "decor:<kind>". */
  setHidden(what: string, hide: boolean) {
    const gs = this.gs;
    if (hide) this.hidden.add(what);
    else this.hidden.delete(what);
    if (what === 'player') gs.playerView.hidden = hide;
    const [kind, id] = what.split(/:(.*)/);
    if (kind === 'npc') gs.npcs.setSceneHidden(id, hide);
    if (kind === 'decor') gs.decor.setKindVisible(id, !hide);
  }

  // ------------------------------------------------------------------ time
  /** Per sim tick while the script runs. */
  tick() {
    for (const a of this.actors.values()) {
      a.t++;
      a.player?.tick();
      const m = a.move;
      if (m) {
        m.t++;
        const k = Math.min(1, m.t / m.ticks);
        a.x = m.fx + (m.tx - m.fx) * k;
        a.y = m.fy + (m.ty - m.fy) * k;
        if (m.face && Math.abs(m.tx - m.fx) > 1 && !a.player) a.flip = m.tx < m.fx;
        if (m.face && a.player) a.dir = directionOf(m.tx - m.fx, m.ty - m.fy);
        if (k >= 1) a.move = null;
      }
    }
    for (const b of this.bubbles) b.t++;
    this.bubbles = this.bubbles.filter(b => b.t < b.ticks);
  }

  /** Is this actor still on its way? */
  moving(id: string) {
    return !!this.actors.get(id)?.move;
  }

  /** Skip: everyone arrives, nobody is still talking. */
  skip() {
    for (const a of this.actors.values())
      if (a.move) {
        a.x = a.move.tx;
        a.y = a.move.ty;
        a.move = null;
      }
    this.bubbles = [];
  }

  /** The script ended: strike the set. */
  end() {
    for (const id of [...this.actors.keys()]) this.remove(id);
    for (const h of [...this.hidden]) this.setHidden(h, false);
    this.bubbles = [];
    this.follow = null;
    this.g?.clear();
    this.texts.forEach(t => t.setVisible(false));
  }

  // ------------------------------------------------------------------ drawing (every frame)
  draw() {
    const gs = this.gs;
    for (const a of this.actors.values()) {
      const m = a.move;
      const hop = m && m.arc ? Math.sin(Math.PI * Math.min(1, m.t / m.ticks)) * m.arc : 0;
      const jx = a.shake ? Math.round((Math.random() - 0.5) * 2 * a.shake) : 0;
      const jy = a.shake ? Math.round((Math.random() - 0.5) * a.shake) : 0;
      const bob = a.bob && m ? (Math.floor(a.t / 6) % 2) * a.bob : 0;
      const x = Math.round(a.x) + jx;
      const y = Math.round(a.y - a.lift - hop) - bob + jy;
      let frame = 0;
      let flip = a.flip;
      if (a.player) {
        const f = gs.lib.frame(a.sheet, a.player.name, a.dir, a.player.index);
        frame = f.frame;
        flip = f.flip;
      } else if (a.frames) frame = a.frames[Math.floor(a.t / a.every) % a.frames.length];
      a.sprite.setFrame(frame).setFlipX(flip).setPosition(x, y).setDepth(DEPTH.actor(a.y) + a.z);
      a.shadow?.setPosition(Math.round(a.x), Math.round(a.y) + 1).setScale(hop ? Math.max(0.5, 1 - hop / 40) : 1);
    }
    // speech bubbles over whoever speaks
    this.g ??= gs.add.graphics().setDepth(DEPTH.overlay - 4);
    const g = this.g.clear();
    this.texts.forEach(t => t.setVisible(false));
    // bubbles that would overlap stack upward (a leader line runs back down to the speaker), inside the view
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const view = gs.cameras.main.worldView;
    this.bubbles.forEach((b, i) => {
      const over = this.pos(b.over);
      const a = b.over.startsWith('actor:') ? this.actors.get(b.over.slice(6)) : null;
      const head = a ? (gs.lib.manifest(a.sheet).cell[1] ?? 32) * 0.8 : 30;
      let t = this.texts[i];
      if (!t) {
        t = gs.add.bitmapText(0, 0, 'pixel', '').setDepth(DEPTH.overlay - 3);
        this.texts[i] = t;
      }
      const shown = b.text.slice(0, Math.ceil(b.t * 1.2));
      t.setText(wrap(b.text));
      const w = t.width + 6;
      const h = t.height + 5;
      t.setText(wrap(shown, b.text));
      const bx = Math.round(Math.max(view.x + 2, Math.min(view.right - w - 2, over.x - w / 2)));
      const natural = Math.round(over.y - head - h - 4);
      let by = natural;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find(r => bx < r.x + r.w + 2 && bx + w + 2 > r.x && by < r.y + r.h + 2 && by + h + 2 > r.y);
        if (!hit) break;
        by = hit.y - h - 3;
      }
      by = Math.max(view.y + 2, by);
      placed.push({ x: bx, y: by, w, h });
      const fade = b.t > b.ticks - 8 ? (b.ticks - b.t) / 8 : 1;
      if (by < natural - 1) g.lineStyle(1, 0xa39eb0, 0.6 * fade).lineBetween(over.x, by + h, over.x, natural + h + 3); // a leader down to the speaker
      g.fillStyle(0x140f14, 0.9 * fade).fillRect(bx, by, w, h);
      g.lineStyle(1, 0xa39eb0, fade).strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      g.fillStyle(0x140f14, 0.9 * fade).fillTriangle(over.x - 3, by + h, over.x + 3, by + h, over.x, by + h + 4);
      t.setPosition(bx + 3, by + 3).setAlpha(fade).setVisible(true);
    });
  }
}

function wrap(s: string, full = s): string {
  // break `s` where the full line breaks, so the bubble doesn't reflow as it types
  const out: string[] = [];
  let line = '';
  for (const w of full.split(' ')) {
    if (line && (line + ' ' + w).length > WRAP) {
      out.push(line);
      line = w;
    } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  const layout = out.join('\n');
  let k = 0;
  let res = '';
  for (const ch of layout) {
    if (k >= s.length) break;
    res += ch;
    k++; // a line break stands where a space was
  }
  return res;
}

function directionOf(dx: number, dy: number): Dir8 {
  const a = Math.atan2(dy, dx);
  const i = Math.round((a / (Math.PI * 2)) * 8 + 8) % 8;
  return (['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const)[i];
}
