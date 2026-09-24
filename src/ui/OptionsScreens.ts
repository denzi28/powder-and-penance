// CONTROLS and SETTINGS, from the pause menu (Esc).
//   CONTROLS: every action with its keys and gamepad button. Select one and press E/Enter, then the new key
//     (or mouse button) to rebind it; Esc cancels. The last row puts every key back as it was.
//   SETTINGS: volumes (master, music, effects, ambience) and screen shake, left/right in steps of 10%.
// Settings are kept in the browser (src/game/Settings.ts), not in the save.
import { DATA } from '../data/config';
import { SETTINGS, bindKey, keyName, keysFor, resetKeys, setSetting, toggleSetting } from '../game/Settings';
import type { Input } from '../input/Input';
import type { GameScene } from '../scenes/GameScene';

/** The actions you can rebind, with what they do in plain words. Menu keys (Esc, Enter) stay fixed. */
export const CONTROL_ROWS: { action: string; label: string }[] = [
  { action: 'moveUp', label: 'MOVE UP' },
  { action: 'moveDown', label: 'MOVE DOWN' },
  { action: 'moveLeft', label: 'MOVE LEFT' },
  { action: 'moveRight', label: 'MOVE RIGHT' },
  { action: 'light', label: 'RIGHT HAND: ATTACK / FIRE' },
  { action: 'block', label: 'LEFT HAND: BLOCK / ATTACK / FIRE' },
  { action: 'heavy', label: 'HEAVY ATTACK (HOLD TO CHARGE)' },
  { action: 'roll', label: 'ROLL' },
  { action: 'sprint', label: 'SPRINT (HOLD)' },
  { action: 'heal', label: 'DRINK A MENDING PHIAL' },
  { action: 'useItem', label: 'USE THE BELT ITEM' },
  { action: 'cycleItem', label: 'NEXT BELT ITEM' },
  { action: 'reload', label: 'RELOAD' },
  { action: 'interact', label: 'TALK, OPEN, PICK UP, READ' },
  { action: 'drop', label: 'DROP THE WEAPON IN USE (HOLD)' },
  { action: 'equipment', label: 'EQUIPMENT' },
  { action: 'inventory', label: 'INVENTORY' },
  { action: 'map', label: 'MAP' },
];
const REBINDABLE = CONTROL_ROWS.map(r => r.action);

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'D-PAD UP', 'D-PAD DOWN', 'D-PAD LEFT', 'D-PAD RIGHT'];
export const padName = (i: number) => PAD_NAMES[i] ?? `BUTTON ${i}`;

/** The keyboard/mouse keys of an action as text ("C", "LEFT CLICK / F"). */
export function keysText(action: string): string {
  return keysFor(action, DATA.input.keyboard).map(keyName).join(' / ') || '-';
}
export function padText(action: string): string {
  const b = DATA.input.gamepad[action] ?? [];
  const extra = action === 'moveUp' || action === 'moveDown' || action === 'moveLeft' || action === 'moveRight' ? 'LEFT STICK' : '';
  return [extra, ...b.map(padName)].filter(Boolean).join(' / ') || '-';
}

class UpDown {
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

export class ControlsScreen {
  readonly kind = 'controls' as const;
  index = 0;
  /** Waiting for the key to bind to this row's action. */
  waiting = false;
  message: string | null = null;
  private nav = new UpDown();

  constructor(
    private gs: GameScene,
    private onClose: () => void,
  ) {}

  /** The rows, and "reset" at the end. */
  get count() {
    return CONTROL_ROWS.length + 1;
  }

  update(input: Input) {
    if (this.waiting) {
      const code = input.takeRawPress();
      if (!code) {
        if (input.pressed('back')) {
          this.waiting = false; // a gamepad's B: keys are rebound on the keyboard
          this.message = 'Unchanged.';
        }
        return;
      }
      this.waiting = false;
      if (code === 'Escape' || code === 'Enter') {
        this.message = 'Unchanged.';
        return;
      }
      const row = CONTROL_ROWS[this.index];
      bindKey(row.action, code, DATA.input.keyboard, REBINDABLE);
      this.message = `${row.label}: ${keyName(code)}.`;
      this.gs.bus.emit('sfx', { id: 'menu_confirm' });
      input.clearBuffer();
      return;
    }
    const { step } = this.nav.read(input);
    if (step) {
      this.index = (this.index + step + this.count) % this.count;
      this.gs.bus.emit('sfx', { id: 'menu_move' });
    }
    if (input.pressed('confirm')) {
      if (this.index === CONTROL_ROWS.length) {
        resetKeys();
        this.message = 'Every key is back to its default.';
        this.gs.bus.emit('sfx', { id: 'menu_confirm' });
      } else {
        input.takeRawPress(); // forget the confirm press itself
        this.waiting = true;
        this.message = null;
      }
    } else if (input.pressed('back') || input.pressed('pause')) this.onClose();
  }
}

export const SETTING_ROWS: { key: 'master' | 'music' | 'sfx' | 'ambience' | 'shake' | 'hints' | 'minimap'; label: string }[] = [
  { key: 'master', label: 'MASTER VOLUME' },
  { key: 'music', label: 'MUSIC' },
  { key: 'sfx', label: 'SOUND EFFECTS' },
  { key: 'ambience', label: 'AMBIENCE' },
  { key: 'shake', label: 'SCREEN SHAKE' },
  { key: 'hints', label: 'BUTTON HINTS ON THE HUD' },
  { key: 'minimap', label: 'MINIMAP' },
];

export class SettingsScreen {
  readonly kind = 'settings' as const;
  index = 0;
  private nav = new UpDown();

  constructor(
    private gs: GameScene,
    private onClose: () => void,
  ) {}

  update(input: Input) {
    const { step, side } = this.nav.read(input);
    const n = SETTING_ROWS.length;
    if (step) {
      this.index = (this.index + step + n) % n;
      this.gs.bus.emit('sfx', { id: 'menu_move' });
    }
    const k = SETTING_ROWS[this.index].key;
    if (k === 'hints' || k === 'minimap') {
      if (side || input.pressed('confirm')) {
        toggleSetting(k);
        this.gs.bus.emit('sfx', { id: 'menu_move' });
      }
    } else if (side) {
      setSetting(k, SETTINGS[k] + side * 0.1);
      this.gs.ambientAudio.applyVolume();
      // a sample of what changed: a click for effects, a small shake for shake
      if (k === 'shake') this.gs.cam.addTrauma(0.3);
      this.gs.bus.emit('sfx', { id: 'menu_move' });
    }
    if (input.pressed('back') || input.pressed('pause')) this.onClose();
  }
}

export type AnyOptionsScreen = ControlsScreen | SettingsScreen;
