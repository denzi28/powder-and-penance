// Settings: rebinding a key takes it away from whatever used it, and resetting brings the defaults back.
import { describe, expect, it } from 'vitest';
import { SETTINGS, bindKey, keyName, keysFor, resetKeys, setSetting } from '../src/game/Settings';

const defaults = { light: ['Mouse0'], useItem: ['KeyC'], cycleItem: ['KeyX'], roll: ['Space'] };
const rebindable = Object.keys(defaults);

describe('key bindings', () => {
  it('a new key replaces the old one, and is taken from any other action', () => {
    resetKeys();
    bindKey('useItem', 'KeyX', defaults, rebindable);
    expect(keysFor('useItem', defaults)).toEqual(['KeyX']);
    expect(keysFor('cycleItem', defaults)).toEqual([]); // X was cycle's; it isn't any more
    expect(keysFor('roll', defaults)).toEqual(['Space']);
    resetKeys();
    expect(keysFor('cycleItem', defaults)).toEqual(['KeyX']);
  });

  it('names keys the way a player would', () => {
    expect(keyName('KeyF')).toBe('F');
    expect(keyName('Mouse2')).toBe('RIGHT CLICK');
    expect(keyName('ShiftLeft')).toBe('L SHIFT');
  });

  it('volumes stay between 0 and 1 in steps of a tenth', () => {
    setSetting('music', 1.5);
    expect(SETTINGS.music).toBe(1);
    setSetting('music', 0.33);
    expect(SETTINGS.music).toBe(0.3);
    setSetting('music', -1);
    expect(SETTINGS.music).toBe(0);
    setSetting('music', 1);
  });
});
