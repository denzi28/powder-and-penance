// Action-based input. Hardware (keyboard codes, mouse buttons, standard-mapping gamepad buttons) is mapped to
// actions via data/config/input.json. Sampled once per gameplay tick so presses are never lost between ticks.
import type { InputCfg } from '../data/schemas';
import { radialDeadzone } from '../core/math';
import { keysFor } from '../game/Settings';

export const ACTIONS = [
  'moveUp', 'moveDown', 'moveLeft', 'moveRight',
  'light', 'heavy', 'block', 'roll', 'sprint', 'heal', 'useItem', 'cycleItem', 'reload', 'interact', 'drop', 'swap', 'pause', 'map',
  'confirm', 'back',
] as const;
export type Action = (typeof ACTIONS)[number];
export type Device = 'kbm' | 'pad';

/** Actions that queue for `bufferTicks` if pressed while the player can't act yet. */
const BUFFERED: ReadonlySet<Action> = new Set<Action>(['light', 'heavy', 'block', 'roll', 'heal', 'useItem', 'cycleItem', 'reload', 'interact', 'swap']);
const ALWAYS_PREVENT = new Set(['Tab', 'Space', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);

export class Input {
  device: Device = 'kbm';
  tick = 0;
  /** Movement vector, magnitude 0..1 (analog on pad, normalized on keyboard). */
  moveX = 0;
  moveY = 0;
  aimStickX = 0;
  aimStickY = 0;
  aimStickActive = false;

  private down = new Set<string>();
  private presses = new Map<string, number>();
  private seen = new Map<string, number>();
  private padPrev: boolean[] = [];
  private pressedNow = new Set<Action>();
  private heldNow = new Set<Action>();
  private bufferedAt = new Map<Action, number>();
  private mouseMoved = false;
  private cleanup: (() => void) | null = null;
  private rawPress: string | null = null;

  constructor(private cfg: () => InputCfg) {}

  attach(canvas: HTMLElement) {
    if (this.cleanup) return; // already attached (shared across scenes)
    const press = (code: string) => {
      this.presses.set(code, (this.presses.get(code) ?? 0) + 1);
      this.rawPress = code;
    };
    const kd = (e: KeyboardEvent) => {
      if (ALWAYS_PREVENT.has(e.code) || this.isBound(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      press(e.code);
    };
    const ku = (e: KeyboardEvent) => this.down.delete(e.code);
    const md = (e: MouseEvent) => {
      e.preventDefault();
      this.down.add(`Mouse${e.button}`);
      press(`Mouse${e.button}`);
    };
    const mu = (e: MouseEvent) => {
      if (e.button >= 3) e.preventDefault(); // stop browser back/forward on side buttons
      this.down.delete(`Mouse${e.button}`);
    };
    const mm = () => (this.mouseMoved = true);
    const wh = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY !== 0) press(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    };
    const blur = () => this.down.clear();
    const ctx = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('mousemove', mm);
    canvas.addEventListener('wheel', wh, { passive: false });
    window.addEventListener('blur', blur);
    canvas.addEventListener('contextmenu', ctx);
    this.cleanup = () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      canvas.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('mousemove', mm);
      canvas.removeEventListener('wheel', wh);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('contextmenu', ctx);
    };
  }

  dispose() {
    this.cleanup?.();
  }

  /** Sample all devices for this tick. Call exactly once per gameplay tick, before anything reads input. */
  beginTick(tick: number) {
    const cfg = this.cfg();
    this.tick = tick;
    this.pressedNow.clear();
    this.heldNow.clear();

    let kbmActive = this.mouseMoved;
    this.mouseMoved = false;
    for (const a of ACTIONS) {
      for (const code of keysFor(a, cfg.keyboard)) {
        if (this.down.has(code)) this.heldNow.add(a);
        if ((this.presses.get(code) ?? 0) > (this.seen.get(code) ?? 0)) {
          this.pressedNow.add(a);
          kbmActive = true;
        }
      }
    }
    for (const [code, n] of this.presses) this.seen.set(code, n);

    let padActive = false;
    let lx = 0;
    let ly = 0;
    const pad = firstPad();
    if (pad) {
      const now = pad.buttons.map((b, i) => (i === 6 || i === 7 ? b.value > cfg.triggerThreshold : b.pressed));
      for (const a of ACTIONS) {
        for (const i of cfg.gamepad[a] ?? []) {
          if (now[i]) this.heldNow.add(a);
          if (now[i] && !this.padPrev[i]) {
            this.pressedNow.add(a);
            padActive = true;
          }
        }
      }
      this.padPrev = now;
      [lx, ly] = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, cfg.stickDeadzone);
      const [rx, ry] = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, cfg.aimStickDeadzone);
      this.aimStickActive = rx !== 0 || ry !== 0;
      if (this.aimStickActive) {
        this.aimStickX = rx;
        this.aimStickY = ry;
      }
      if (lx !== 0 || ly !== 0 || this.aimStickActive) padActive = true;
    } else {
      this.aimStickActive = false;
    }
    if (padActive) this.device = 'pad';
    else if (kbmActive) this.device = 'kbm';

    if (lx !== 0 || ly !== 0) {
      this.moveX = lx;
      this.moveY = ly;
    } else {
      const dx = +this.heldNow.has('moveRight') - +this.heldNow.has('moveLeft');
      const dy = +this.heldNow.has('moveDown') - +this.heldNow.has('moveUp');
      const len = Math.hypot(dx, dy) || 1;
      this.moveX = dx / len;
      this.moveY = dy / len;
    }

    for (const a of this.pressedNow) if (BUFFERED.has(a)) this.bufferedAt.set(a, tick);
  }

  pressed(a: Action) {
    return this.pressedNow.has(a);
  }
  held(a: Action) {
    return this.heldNow.has(a);
  }
  /** True if `a` was pressed within the buffer window and not yet used. */
  peek(a: Action) {
    const t = this.bufferedAt.get(a);
    return t !== undefined && this.tick - t <= this.cfg().bufferTicks;
  }
  /** Forget all buffered presses (e.g. when a menu closes, so its confirm press doesn't leak into gameplay). */
  clearBuffer() {
    this.bufferedAt.clear();
  }

  /** peek() and mark the press as used. */
  consume(a: Action) {
    const ok = this.peek(a);
    this.bufferedAt.delete(a);
    return ok;
  }

  private isBound(code: string) {
    for (const a of ACTIONS) if (keysFor(a, this.cfg().keyboard).includes(code)) return true;
    return false;
  }

  /** The last key or mouse button pressed since the previous call (for rebinding), or null. */
  takeRawPress(): string | null {
    const c = this.rawPress;
    this.rawPress = null;
    return c;
  }
}

function firstPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p && p.connected) return p;
  return null;
}
