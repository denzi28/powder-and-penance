// Story scripts: conditions, and every script in data/scripts can be played to the end without getting stuck
// (a menu nobody can leave, a loop). Runs the real Story runner against a minimal stand-in for the game.
import { ScreenFx } from '../src/game/ScreenFx';
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

/** A stand-in for any Phaser object: every method call returns it again (sprites, graphics, texts). */
const anything: unknown = new Proxy(() => anything, { get: (_t, k) => (k === 'then' ? undefined : k === 'width' || k === 'height' ? 10 : anything), apply: () => anything });
/** Any animation a cutscene asks for exists. */
const anyAnims = new Proxy({}, { get: () => ({ row: 0, dirs: ['S'], loop: true, frames: [{ ticks: 5 }] }), has: () => true });

/** Plays a script: confirms every few ticks and walks the menu cursor upward, so every menu is eventually left. */
function play(id: string, flags: Set<string>, maxTicks = 20000) {
  let t = 0;
  const gs = {
    flags,
    controls: {
      pressed: (a: string) => (a === 'moveUp' ? t % 4 === 0 : a === 'confirm' ? t % 4 === 2 : false),
      clearBuffer: () => {},
    },
    npcs: { speaking: null, refresh: () => {}, get: () => null, setSceneHidden: () => {} },
    // the cutscene stage: sprites, graphics and effects that go nowhere
    lib: { sprite: () => anything, manifest: () => ({ animations: anyAnims, cell: [32, 32] }), frame: () => ({ frame: 0, flip: false }) },
    add: anything,
    decor: { setKindVisible: () => {} },
    playerView: { hidden: false },
    screenFx: new ScreenFx(),
    roomAt: () => null,
    // enough of a player for `give` steps (grantItem)
    player: {
      x: 0, y: 0, tallow: 0, slots: [], phials: { max: 3, charges: 3, level: 0 }, healAmount: 45, ammoFor: () => ({ reserve: 0 }),
      inv: { weapons: [], shields: [], armour: [], rings: [] }, rings: [null, null], worn: { head: null, body: null },
      give: () => true, addItem: () => 1, count: () => 1, belt: null, pickUpWeapon: () => false, setRing: () => {}, setArmour: () => {}, equipLoad: 0, capacity: 30, loadTier: { label: 'Light', note: 'quick' },
    },
    particles: { burst: () => {} },
    save: () => {},
    enemies: [],
    areaRoomList: Object.values(DATA.rooms),
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

describe('voices', () => {
  /** Types one line out untouched and returns the voice blips it made. */
  function blips(who: string | undefined, say: string, press = false) {
    const heard: { id: string; pitch?: number }[] = [];
    const gs = {
      flags: new Set<string>(),
      controls: { pressed: (a: string) => press && a === 'confirm', clearBuffer: () => {} },
      npcs: { speaking: null, refresh: () => {}, get: () => null },
      bus: { emit: (_: string, e: { id: string; pitch?: number }) => heard.push(e) },
      markDirty: () => {},
    } as unknown as GameScene;
    const scripts = DATA.scripts as Record<string, unknown>;
    scripts.__voice_test = { id: '__voice_test', steps: [{ say, ...(who ? { who } : {}) }] };
    const story = new Story(gs);
    story.start('__voice_test');
    for (let t = 0; t < 200; t++) story.tick();
    delete scripts.__voice_test;
    return heard;
  }

  it('each speaker blips at their own pitch while their letters type out; spaces and punctuation are silent', () => {
    const pip = blips('pip', 'abcd efgh!');
    const npc = DATA.npcs.npcs;
    expect(pip.length).toBe(4); // 8 letters, every 2nd
    expect(pip.every(e => e.id === npc.pip.voice.sfx && e.pitch === npc.pip.voice.pitch)).toBe(true);
    expect(npc.pip.voice.pitch).toBeGreaterThan(1);
    expect(npc.tollwarden.voice.pitch).toBeLessThan(1);
    expect(blips(undefined, 'abcdef')[0].id).toBe(DATA.npcs.narration.sfx);
    expect(blips('pip', '... !!!').length).toBe(0);
  });

  it('skipping a line with a press is silent', () => {
    expect(blips('pip', 'a long line that is skipped', true).length).toBe(0);
  });
});

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
