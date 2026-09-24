// Player settings, kept in the browser apart from the save: volumes, screen shake, and keyboard bindings
// changed from the defaults in data/config/input.json. Read them at use time (they change while playing).

export const SETTINGS_KEY = 'powder-and-penance.settings';

export interface Settings {
  /** 0..1, on top of data/config/audio.json. */
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  /** 0..1: how hard the screen shakes. */
  shake: number;
  /** Keyboard bindings that replace the defaults, by action (KeyboardEvent codes, "Mouse0"...). */
  keys: Record<string, string[]>;
}

const DEFAULTS: Settings = { master: 1, music: 1, sfx: 1, ambience: 1, shake: 1, keys: {} };

function load(): Settings {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS, keys: {} };
    const s = JSON.parse(raw) as Partial<Settings>;
    const num = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    const keys: Record<string, string[]> = {};
    if (s.keys && typeof s.keys === 'object')
      for (const [a, codes] of Object.entries(s.keys)) if (Array.isArray(codes) && codes.every(c => typeof c === 'string')) keys[a] = codes;
    return {
      master: num(s.master, 1),
      music: num(s.music, 1),
      sfx: num(s.sfx, 1),
      ambience: num(s.ambience, 1),
      shake: num(s.shake, 1),
      keys,
    };
  } catch {
    return { ...DEFAULTS, keys: {} };
  }
}

/** The live settings. Change them through `setSetting` / `bindKey` so they're saved. */
export const SETTINGS: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS));
  } catch {
    // private browsing and the like: settings just won't persist
  }
}

export function setSetting(k: 'master' | 'music' | 'sfx' | 'ambience' | 'shake', v: number) {
  SETTINGS[k] = Math.round(Math.max(0, Math.min(1, v)) * 10) / 10;
  saveSettings();
}

/** The keys for an action: the player's own binding, else the default. */
export function keysFor(action: string, defaults: Record<string, string[]>): string[] {
  return SETTINGS.keys[action] ?? defaults[action] ?? [];
}

/** Bind a single key to an action, taking it away from any other gameplay action that used it. */
export function bindKey(action: string, code: string, defaults: Record<string, string[]>, rebindable: readonly string[]) {
  for (const other of rebindable) {
    if (other === action) continue;
    const cur = keysFor(other, defaults);
    if (cur.includes(code)) SETTINGS.keys[other] = cur.filter(c => c !== code);
  }
  SETTINGS.keys[action] = [code];
  saveSettings();
}

export function resetKeys() {
  SETTINGS.keys = {};
  saveSettings();
}

/** "Mouse0" -> "LEFT CLICK", "KeyF" -> "F", "ShiftLeft" -> "LEFT SHIFT". */
export function keyName(code: string): string {
  const special: Record<string, string> = {
    Mouse0: 'LEFT CLICK', Mouse1: 'MIDDLE CLICK', Mouse2: 'RIGHT CLICK', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5',
    WheelUp: 'WHEEL UP', WheelDown: 'WHEEL DOWN', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Backspace: 'BACKSPACE', Tab: 'TAB',
    ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL', AltLeft: 'L ALT', AltRight: 'R ALT',
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', CapsLock: 'CAPS LOCK',
  };
  if (special[code]) return special[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}
