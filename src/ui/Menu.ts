// Minimal menu model + navigation shared by the title screen and the shrine menu.
// Up/down: move keys, arrows, D-pad (via move actions) or a left-stick flick. Confirm/back: see input.json.
import type { Input } from '../input/Input';

export interface MenuItem {
  label: string;
  enabled: boolean;
  /** Greyed-out hint shown for disabled entries. */
  note?: string;
  action: () => void;
}

export interface Menu {
  title: string;
  subtitle?: string;
  /** Wrapped lines under the choices (the pause menu's current goal). */
  footer?: string;
  items: MenuItem[];
  index: number;
  /** Called on "back"; if omitted, back does nothing. */
  onBack?: () => void;
}

export type NavResult = 'moved' | 'confirmed' | 'back' | null;

export class MenuNav {
  private prevY = 0;

  /** Call once per tick after input.beginTick(). */
  update(menu: Menu, input: Input): NavResult {
    const y = input.moveY;
    const flickUp = y < -0.5 && this.prevY >= -0.5;
    const flickDown = y > 0.5 && this.prevY <= 0.5;
    this.prevY = y;
    const step = input.pressed('moveUp') || flickUp ? -1 : input.pressed('moveDown') || flickDown ? 1 : 0;
    if (step) {
      const n = menu.items.length;
      let i = menu.index;
      for (let k = 0; k < n; k++) {
        i = (i + step + n) % n;
        if (menu.items[i].enabled) break;
      }
      if (i !== menu.index) {
        menu.index = i;
        return 'moved';
      }
    }
    if (input.pressed('confirm') && menu.items[menu.index]?.enabled) {
      menu.items[menu.index].action();
      return 'confirmed';
    }
    if (input.pressed('back') && menu.onBack) {
      menu.onBack();
      return 'back';
    }
    return null;
  }
}

/** First enabled index (for opening a menu). */
export function firstEnabled(items: MenuItem[]) {
  return Math.max(0, items.findIndex(i => i.enabled));
}
