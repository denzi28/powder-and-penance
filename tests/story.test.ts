// Story scripts: conditions, and every script in data/scripts can be played to the end without getting stuck
// (a menu nobody can leave, a loop). Runs the real Story runner against a minimal stand-in for the game.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { check, storyFlag } from '../src/story/conditions';
import { Story } from '../src/story/Story';
import type { GameScene } from '../src/scenes/GameScene';

describe('conditions', () => {
  const flags = new Set(['story:oskar_met', 'key:toll_key']);
  it('bare names are story flags; names with a colon are any flag; ! negates; lists mean all', () => {
    expect(storyFlag('oskar_met')).toBe('story:oskar_met');
    expect(storyFlag('key:toll_key')).toBe('key:toll_key');
    expect(check(flags, 'oskar_met')).toBe(true);
    expect(check(flags, '!oskar_met')).toBe(false);
    expect(check(flags, 'key:toll_key')).toBe(true);
    expect(check(flags, ['oskar_met', '!oskar_freed'])).toBe(true);
    expect(check(flags, ['oskar_met', 'oskar_freed'])).toBe(false);
    expect(check(flags, undefined)).toBe(true);
  });
});

/** Plays a script: confirms every few ticks and walks the menu cursor upward, so every menu is eventually left. */
function play(id: string, flags: Set<string>, maxTicks = 20000) {
  let t = 0;
  const gs = {
    flags,
    controls: {
      pressed: (a: string) => (a === 'moveUp' ? t % 4 === 0 : a === 'confirm' ? t % 4 === 2 : false),
      clearBuffer: () => {},
    },
    npcs: { speaking: null, refresh: () => {}, get: () => null },
    // enough of a player for `give` steps (grantItem)
    player: { x: 0, y: 0, tallow: 0, slots: [], phials: { max: 3, charges: 3, level: 0 }, healAmount: 45, ammoFor: () => ({ reserve: 0 }) },
    particles: { burst: () => {} },
    save: () => {},
    enemies: [],
    areaRoomList: [],
    bus: { emit: () => {} },
    cam: { addTrauma: () => {} },
    showToast: () => {},
    markDirty: () => {},
  } as unknown as GameScene;
  const story = new Story(gs);
  story.start(id);
  while (story.active && t < maxTicks) {
    story.tick();
    t++;
  }
  return { finished: !story.active, ticks: t };
}

describe('scripts', () => {
  for (const id of Object.keys(DATA.scripts))
    it(`${id} plays to the end`, () => {
      // Try it both fresh and with the story flags it sets itself already set (the second conversation).
      const flags = new Set<string>();
      expect(play(id, flags).finished, `${id} (first time)`).toBe(true);
      expect(play(id, flags).finished, `${id} (again)`).toBe(true);
      expect(play(id, new Set(['key:cage_key', 'key:toll_key'])).finished, `${id} (with keys)`).toBe(true);
    });
});
