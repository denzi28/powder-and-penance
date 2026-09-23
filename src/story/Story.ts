// Runs dialogue and cutscene scripts (data/scripts). While a script runs, the world is paused: the script
// drives the dialogue box, the camera and fades itself. Cutscenes start when the player walks into a
// cutscene trigger ({ "type": "cutscene", "id", "script", "at", "size": [w, h], "when" }), once per save.
import { DATA } from '../data/config';
import { TILE } from '../world/TileGrid';
import { grantItem } from '../game/Items';
import { check, storyFlag } from './conditions';
import type { Cond, Step } from '../data/schemas';
import type { GameScene } from '../scenes/GameScene';

/** What the dialogue box shows (read by the UI). */
export interface DialogueState {
  speaker: string | null;
  portrait: number | null;
  text: string;
  /** Characters revealed so far (typewriter). */
  shown: number;
  choices: string[] | null;
  selected: number;
}

type MenuOption = Extract<Step, { menu: unknown }>['menu'][number];

const TYPE_CHARS_PER_TICK = 1.5;
const DEFAULT_CAMERA_TICKS = 40;
const DEFAULT_FADE_TICKS = 30;

export class Story {
  dialogue: DialogueState | null = null;
  /** 0..1 black overlay driven by `fade` steps. */
  fadeAlpha = 0;

  private stack: { steps: Step[]; i: number }[] = [];
  private running = false;
  private skippable = false;
  private skipping = false;
  /** A button press was already acted on this tick. */
  private inputUsed = false;
  /** Last option picked in each menu step, so a menu that comes back keeps its cursor. */
  private lastChoice = new WeakMap<Step, number>();
  /** Who spoke last: a menu keeps showing their name and portrait. */
  private lastSpeaker: { speaker: string; portrait: number } | null = null;
  private wait = 0;
  private menu: { options: MenuOption[]; step: Step } | null = null;
  private fade: { from: number; to: number; t: number; ticks: number } | null = null;
  /** Camera focus (world px) while a script points it somewhere; null = follow the player. */
  private focus: { x: number; y: number } | null = null;
  private pan: { fromX: number; fromY: number; toX: number; toY: number; t: number; ticks: number; release: boolean } | null = null;

  constructor(private gs: GameScene) {}

  get active() {
    return this.running;
  }

  /** Where the camera should look (null = on the player as usual). */
  get cameraPoint() {
    return this.focus;
  }

  start(scriptId: string) {
    const def = DATA.scripts[scriptId];
    if (!def) return;
    this.stack = [{ steps: def.steps, i: 0 }];
    this.running = true;
    this.lastSpeaker = null;
    this.skippable = def.skippable;
    this.skipping = false;
    this.wait = 0;
    this.menu = null;
    this.dialogue = null;
    this.gs.controls.clearBuffer();
  }

  /** Per sim tick, while no script runs: start any cutscene whose trigger the player is standing in. */
  checkTriggers() {
    const gs = this.gs;
    const tx = Math.floor(gs.player.x / TILE);
    const ty = Math.floor(gs.player.y / TILE);
    for (const r of gs.areaRoomList)
      for (const en of r.entities) {
        if (en.type !== 'cutscene' || !en.id || gs.flags.has(`cutscene:${en.id}`)) continue;
        const [w, h] = (en.size as [number, number] | undefined) ?? [1, 1];
        const x0 = r.origin[0] + en.at[0];
        const y0 = r.origin[1] + en.at[1];
        if (tx < x0 || ty < y0 || tx >= x0 + w || ty >= y0 + h) continue;
        if (!check(gs.flags, en.when as Cond | undefined)) continue;
        gs.flags.add(`cutscene:${en.id}`);
        this.start(String(en.script));
        return;
      }
  }

  /** Per sim tick while a script runs. */
  tick() {
    const c = this.gs.controls;
    this.inputUsed = false;
    if (this.skippable && !this.skipping && c.pressed('back')) this.skipping = true;
    this.tickPan();
    this.tickFade();

    for (let guard = 0; guard < 200; guard++) {
      if (this.skipping) {
        this.wait = 0;
        this.dialogue = null;
        if (this.pan) this.pan.t = this.pan.ticks;
        if (this.fade) this.fade.t = this.fade.ticks;
        this.tickPan();
        this.tickFade();
      }
      if (this.wait > 0) {
        this.wait--;
        return;
      }
      if (this.menu) {
        // Skipping takes an option that ends the conversation (never loops back into the menu).
        if (this.skipping) this.pick(Math.max(0, this.menu.options.findIndex(o => o.end)));
        else if (!this.tickMenu()) return;
        continue;
      }
      if (this.dialogue) {
        if (!this.tickSay()) return;
        continue;
      }
      const frame = this.stack[this.stack.length - 1];
      if (!frame) {
        this.finish();
        return;
      }
      if (frame.i >= frame.steps.length) {
        this.stack.pop();
        continue;
      }
      this.exec(frame.steps[frame.i++]);
    }
  }

  // ------------------------------------------------------------------ steps
  private exec(s: Step) {
    const gs = this.gs;
    if ('say' in s) {
      const who = s.who ? DATA.npcs.npcs[s.who] : null;
      gs.npcs.speaking = s.who ?? null;
      this.lastSpeaker = who ? { speaker: who.name, portrait: who.portrait } : null;
      this.dialogue = { speaker: who?.name ?? null, portrait: who?.portrait ?? null, text: s.say, shown: 0, choices: null, selected: 0 };
    } else if ('menu' in s) {
      const options = s.menu.filter(o => check(gs.flags, o.when));
      this.menu = { options, step: s };
      const d = this.dialogue;
      this.dialogue = {
        speaker: d?.speaker ?? this.lastSpeaker?.speaker ?? null,
        portrait: d?.portrait ?? this.lastSpeaker?.portrait ?? null,
        text: d?.text ?? '',
        shown: d?.text.length ?? 0,
        choices: options.map(o => o.text),
        // A menu that comes back keeps the cursor where you left it.
        selected: Math.min(this.lastChoice.get(s) ?? 0, options.length - 1),
      };
      gs.npcs.speaking = null;
    } else if ('if' in s) {
      const branch = check(gs.flags, s.if) ? s.then : (s.else ?? []);
      this.stack.push({ steps: branch, i: 0 });
    } else if ('set' in s) {
      for (const f of [s.set].flat()) gs.flags.add(storyFlag(f));
      this.onFlags();
    } else if ('clear' in s) {
      for (const f of [s.clear].flat()) gs.flags.delete(storyFlag(f));
      this.onFlags();
    } else if ('wait' in s) {
      this.wait = s.wait;
    } else if ('camera' in s) {
      const ticks = s.ticks ?? DEFAULT_CAMERA_TICKS;
      const to = this.targetPos(s.camera);
      const from = this.focus ?? this.playerPoint();
      this.pan = { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, t: 0, ticks, release: s.camera === 'player' };
      this.focus = { ...from };
      this.wait = ticks;
    } else if ('fade' in s) {
      const ticks = s.ticks ?? DEFAULT_FADE_TICKS;
      this.fade = { from: this.fadeAlpha, to: s.fade === 'out' ? 1 : 0, t: 0, ticks };
      this.wait = ticks;
    } else if ('sfx' in s) {
      gs.bus.emit('sfx', { id: s.sfx });
    } else if ('shake' in s) {
      gs.cam.addTrauma(s.shake);
    } else if ('give' in s) {
      grantItem(gs, `script_${s.give}`, s.give, gs.player.x, gs.player.y);
    } else if ('toast' in s) {
      gs.showToast(s.toast[0], s.toast[1]);
    }
  }

  /**
   * A press of one of these actions this tick, if it hasn't been used yet. Each press does one thing only:
   * the press that closes a line must not also pick the first option of the menu that follows it.
   */
  private press(...actions: Parameters<GameScene['controls']['pressed']>[0][]): boolean {
    if (this.inputUsed || !actions.some(a => this.gs.controls.pressed(a))) return false;
    this.inputUsed = true;
    return true;
  }

  /** Typewriter, then wait for a press. Returns true when the line is done. */
  private tickSay(): boolean {
    const d = this.dialogue!;
    const press = this.press('confirm', 'interact', 'light');
    if (d.shown < d.text.length) {
      d.shown = press ? d.text.length : Math.min(d.text.length, d.shown + TYPE_CHARS_PER_TICK);
      if (d.shown >= d.text.length) this.gs.npcs.speaking = null;
      return false;
    }
    if (!press) return false;
    this.dialogue = null;
    return true;
  }

  /** Choice navigation. Returns true once an option is picked. */
  private tickMenu(): boolean {
    const d = this.dialogue!;
    const c = this.gs.controls;
    const n = this.menu!.options.length;
    if (!this.inputUsed && (c.pressed('moveUp') || c.pressed('moveDown'))) {
      d.selected = (d.selected + (c.pressed('moveUp') ? n - 1 : 1)) % n;
      this.gs.bus.emit('sfx', { id: 'menu_move' });
      this.inputUsed = true;
    }
    if (!this.press('confirm', 'interact')) return false;
    this.gs.bus.emit('sfx', { id: 'menu_confirm' });
    this.pick(d.selected);
    return true;
  }

  private pick(i: number) {
    const m = this.menu!;
    const opt = m.options[i];
    this.lastChoice.set(m.step, i);
    this.menu = null;
    this.dialogue = null;
    if (!opt) return;
    // Show the menu again after the option's steps, unless it ends the conversation.
    if (!opt.end) this.stack.push({ steps: [m.step], i: 0 });
    if (opt.do?.length) this.stack.push({ steps: opt.do, i: 0 });
  }

  private finish() {
    this.running = false;
    this.dialogue = null;
    this.menu = null;
    this.gs.npcs.speaking = null;
    this.fade = null;
    this.fadeAlpha = 0;
    this.focus = null;
    this.pan = null;
    this.gs.controls.clearBuffer(); // the last confirm press must not swing the sword
    this.gs.markDirty();
  }

  private onFlags() {
    this.gs.npcs.refresh(this.gs.flags);
    this.gs.markDirty();
  }

  // ------------------------------------------------------------------ camera and fades
  private playerPoint() {
    return { x: this.gs.player.x, y: this.gs.player.y };
  }

  private targetPos(target: string): { x: number; y: number } {
    if (target === 'player') return this.playerPoint();
    const [kind, id] = target.split(/:(.*)/);
    if (kind === 'npc') {
      const n = this.gs.npcs.get(id);
      if (n) return { x: n.x, y: n.y };
    }
    if (kind === 'enemy') {
      const e = this.gs.enemies.find(x => x.kind === id);
      if (e) return { x: e.x, y: e.y - 12 };
    }
    if (kind === 'point')
      for (const r of this.gs.areaRoomList)
        for (const en of r.entities)
          if (en.type === 'point' && en.id === id)
            return { x: (r.origin[0] + en.at[0]) * TILE + TILE / 2, y: (r.origin[1] + en.at[1]) * TILE + TILE / 2 };
    return this.playerPoint();
  }

  private tickPan() {
    const p = this.pan;
    if (!p) return;
    p.t = Math.min(p.ticks, p.t + 1);
    const k = p.ticks ? p.t / p.ticks : 1;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
    this.focus = { x: p.fromX + (p.toX - p.fromX) * e, y: p.fromY + (p.toY - p.fromY) * e };
    if (p.t >= p.ticks) {
      if (p.release) this.focus = null;
      this.pan = null;
    }
  }

  private tickFade() {
    const f = this.fade;
    if (!f) return;
    f.t = Math.min(f.ticks, f.t + 1);
    this.fadeAlpha = f.from + (f.to - f.from) * (f.t / f.ticks);
    if (f.t >= f.ticks) this.fade = null;
  }
}
