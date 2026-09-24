// Ambient chatter (data/chatter.json): now and then, NPCs standing near each other trade a few short lines in
// speech bubbles over their heads, while the player is close enough to see. It never stops the game: they
// pause what they're doing, face each other, talk, and go back to it. Chats whose `when` doesn't hold are
// skipped, so what they talk about follows the story. A chat isn't repeated until the others have been heard.
import Phaser from 'phaser';
import { DATA } from '../data/config';
import { DEPTH } from '../render/depth';
import { check } from './conditions';
import type { ChatDef } from '../data/schemas';
import type { Npc, Npcs } from './Npcs';
import type { EventBus, GameEvents } from '../core/EventBus';

const TYPE_MS = 40;
const HOLD_MS = 1300;
const HOLD_PER_CHAR_MS = 42;
const GAP_MS: [number, number] = [2600, 5200];
const SEE_RANGE = 230;
const WRAP = 19;

interface Playing {
  chat: ChatDef;
  line: number;
  shown: number;
  hold: number;
  people: Npc[];
}

export class Chatter {
  private playing: Playing | null = null;
  private cooldown = 1500;
  private heard = new Set<string>();
  private text: Phaser.GameObjects.BitmapText;
  private box: Phaser.GameObjects.Graphics;
  private letters = 0;

  constructor(
    scene: Phaser.Scene,
    private npcs: Npcs,
    private bus: EventBus<GameEvents>,
  ) {
    this.box = scene.add.graphics().setDepth(DEPTH.overlay - 4);
    this.text = scene.add.bitmapText(0, 0, 'pixel', '').setDepth(DEPTH.overlay - 3);
    this.hide();
  }

  /** A new area: forget what's been said and stop talking. */
  reset() {
    this.stop();
    this.heard.clear();
    this.cooldown = 1500;
  }

  stop() {
    if (this.playing) for (const n of this.playing.people) (n.held = false), (n.lookAt = null);
    this.playing = null;
    this.npcs.chattering.clear();
    this.hide();
  }

  update(deltaMs: number, player: { x: number; y: number }, flags: ReadonlySet<string>, paused: boolean) {
    if (paused) {
      // A conversation with the player interrupts a chat with one of its people.
      if (this.playing && this.playing.people.some(n => this.npcs.speaking === n.npc)) this.stop();
      return;
    }
    if (!this.playing) {
      this.cooldown -= deltaMs;
      if (this.cooldown <= 0) this.pick(player, flags);
      return;
    }
    const p = this.playing;
    // Everyone still here? (a script can send someone away)
    if (p.people.some(n => !n.visible)) return this.finish();
    const [who, say] = p.chat.lines[p.line];
    const speaker = p.people.find(n => n.id === who)!;
    if (p.shown < say.length) {
      const before = Math.floor(p.shown);
      p.shown = Math.min(say.length, p.shown + deltaMs / TYPE_MS);
      this.blips(speaker, say, before, Math.floor(p.shown), player);
      this.npcs.chattering = new Set([speaker.id]);
    } else {
      this.npcs.chattering.clear();
      p.hold -= deltaMs;
      if (p.hold <= 0) {
        p.line++;
        if (p.line >= p.chat.lines.length) return this.finish();
        p.shown = 0;
        p.hold = HOLD_MS + p.chat.lines[p.line][1].length * HOLD_PER_CHAR_MS;
        this.letters = 0;
        this.face(p);
      }
    }
    this.draw(speaker, say.slice(0, Math.floor(p.shown)));
  }

  private pick(player: { x: number; y: number }, flags: ReadonlySet<string>) {
    const byId = (id: string) => this.npcs.get(id);
    const ready = DATA.chatter.chats.filter(c => {
      if (!check(flags, c.when)) return false;
      const people = c.who.map(byId);
      if (people.some(n => !n || !n.visible)) return false;
      const first = people[0]!;
      if (Math.hypot(first.x - player.x, first.y - player.y) > SEE_RANGE) return false;
      return people.every(n => Math.hypot(n!.x - first.x, n!.y - first.y) <= c.range);
    });
    this.cooldown = 700; // look again soon if nobody is in place
    if (!ready.length) return;
    let fresh = ready.filter(c => !this.heard.has(c.id));
    if (!fresh.length) {
      for (const c of ready) this.heard.delete(c.id);
      fresh = ready;
    }
    const chat = fresh[Math.floor(Math.random() * fresh.length)];
    this.heard.add(chat.id);
    const people = chat.who.map(id => byId(id)!);
    for (const n of people) n.held = true;
    this.playing = { chat, line: 0, shown: 0, hold: HOLD_MS + chat.lines[0][1].length * HOLD_PER_CHAR_MS, people };
    this.letters = 0;
    this.face(this.playing);
  }

  /** Listeners look at whoever is speaking; the speaker looks at the next one to speak (or the first listener). */
  private face(p: Playing) {
    const speaker = p.people.find(n => n.id === p.chat.lines[p.line][0])!;
    const next = p.chat.lines.slice(p.line + 1).find(([w]) => w !== speaker.id)?.[0];
    const target = p.people.find(n => n.id === next) ?? p.people.find(n => n !== speaker)!;
    for (const n of p.people) n.lookAt = n === speaker ? (target?.x ?? null) : speaker.x;
  }

  private finish() {
    this.stop();
    this.cooldown = GAP_MS[0] + Math.random() * (GAP_MS[1] - GAP_MS[0]);
  }

  /** Quiet voice blips, fading with distance from the player. */
  private blips(n: Npc, text: string, from: number, to: number, player: { x: number; y: number }) {
    const v = DATA.npcs.npcs[n.npc].voice;
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    const vol = v.volume * 0.35 * Math.max(0, 1 - d / SEE_RANGE);
    if (vol < 0.03) return;
    for (let i = from; i < to; i++) {
      if (!/[\p{L}\p{N}]/u.test(text[i])) continue;
      if (this.letters++ % (v.every + 1) === 0) this.bus.emit('sfx', { id: v.sfx, pitch: v.pitch, volume: vol });
    }
  }

  private wrap(s: string): string {
    const out: string[] = [];
    let line = '';
    for (const w of s.split(' ')) {
      if (line && (line + ' ' + w).length > WRAP) {
        out.push(line);
        line = w;
      } else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
    return out.join('\n');
  }

  private draw(n: Npc, shown: string) {
    const full = this.wrap(this.playing!.chat.lines[this.playing!.line][1]);
    // lay the box out for the whole line so it doesn't grow while typing
    this.text.setText(full);
    const w = this.text.width + 6;
    const h = this.text.height + 5;
    // wrap the shown part the same way (same break points)
    let k = 0;
    let typed = '';
    for (const ch of full) {
      if (k >= shown.length) break;
      typed += ch;
      if (ch !== '\n') k++;
    }
    this.text.setText(typed);
    const x = Math.round(n.x - w / 2);
    const top = this.box.scene.cameras.main.worldView.y + 2;
    const y = Math.round(Math.max(top, n.y - 34 - h)); // keep the bubble on screen
    this.box.clear();
    this.box.fillStyle(0x140f14, 0.88).fillRect(x, y, w, h);
    this.box.lineStyle(1, 0xa39eb0, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (y + h < n.y - 30) this.box.fillStyle(0x140f14, 0.88).fillTriangle(n.x - 3, y + h, n.x + 3, y + h, n.x, y + h + 4); // tail
    if (y + h < n.y - 30) this.box.lineStyle(1, 0xa39eb0, 1).lineBetween(n.x - 3, y + h, n.x, y + h + 3).lineBetween(n.x + 3, y + h, n.x, y + h + 3);
    this.box.setVisible(true);
    this.text.setPosition(x + 3, y + 3).setVisible(true);
  }

  private hide() {
    this.box.clear().setVisible(false);
    this.text.setVisible(false);
  }

  destroy() {
    this.box.destroy();
    this.text.destroy();
  }
}
