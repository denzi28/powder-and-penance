// Regression checks for reported bugs: the hub shrine clear of people, the gear hotkeys, broods that rest.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { rollFor } from '../src/player/Player';
import { check } from '../src/story/conditions';
import { Exits } from '../src/world/Exits';
import { isDesktop } from '../src/game/Desktop';

describe('reported bugs', () => {
  it("Wick's Rest stands clear of every villager's stops and paths", () => {
    const hub = DATA.rooms.hub_01_yard;
    const shrine = hub.entities.find(e => e.type === 'shrine')!;
    const [sx, sy] = shrine.at as [number, number];
    for (const e of hub.entities) {
      if (e.type !== 'npc') continue;
      const npc = e as unknown as { at: [number, number]; routine?: { at: [number, number]; via?: [number, number][] }[] };
      const points = [npc.at, ...(npc.routine ?? []).flatMap(s => [s.at, ...(s.via ?? [])])];
      for (const [x, y] of points) expect(Math.hypot(x - sx, y - sy), `${(e as { id: string }).id} at ${x},${y}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('Tab opens EQUIPMENT and I opens INVENTORY', () => {
    expect(DATA.input.keyboard.equipment).toContain('Tab');
    expect(DATA.input.keyboard.inventory).toContain('KeyI');
  });

  it('the medium and heavy rolls keep i-frames and reach', () => {
    const t = Object.fromEntries(DATA.load.tiers.map(x => [x.id, rollFor(x)]));
    expect(t.medium.iframeEnd - t.medium.iframeStart).toBeGreaterThanOrEqual(DATA.roll.iframeEnd - DATA.roll.iframeStart);
    expect(t.heavy.iframeEnd - t.heavy.iframeStart).toBeGreaterThanOrEqual(DATA.roll.iframeEnd - DATA.roll.iframeStart);
    expect(t.heavy.distance).toBeGreaterThanOrEqual(DATA.roll.distance * 0.9);
  });

  it("Mother Tallow's brood is rare", () => {
    const brood = DATA.enemies.mother_bones.moves.find(m => m.id === 'brood')!;
    expect(brood.cooldown).toBeGreaterThanOrEqual(600);
    expect(brood.weight).toBe(1);
  });
});

describe('the near-finished pass', () => {
  /** The world tile under a point (in world tiles), from every room's grid: its legend name, or null off the map. */
  const tileAt = (x: number, y: number): string | null => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    for (const r of Object.values(DATA.rooms)) {
      if (r.area !== 'road') continue;
      const [ox, oy] = r.origin;
      const row = r.tiles[ty - oy];
      const c = row?.[tx - ox];
      if (c !== undefined && tx >= ox) return r.legend[c] ?? null;
    }
    return null;
  };

  it('keeps everyone in the opening cutscene out of the walls', () => {
    const steps = DATA.scripts.wreck_intro.steps as Record<string, unknown>[];
    let placed = 0;
    for (const s of steps) {
      const who = (s.actor ?? s.move) as string | undefined;
      const at = (Array.isArray(s.at) ? s.at : s.to) as [number, number] | undefined;
      if (!who || !at || who === 'driver') continue; // the driver sits up on the wagon
      expect(tileAt(at[0], at[1]), `${who} at ${at}`).not.toBe('wall');
      placed++;
    }
    expect(placed).toBeGreaterThan(10);
  });

  it('plays a theme of its own for every miniboss', () => {
    for (const r of Object.values(DATA.rooms))
      for (const en of r.entities) {
        const mb = en.type === 'enemy' ? (en.miniboss as { id: string } | undefined) : undefined;
        if (mb) expect(DATA.music.themes[DATA.music.minibosses[mb.id]], mb.id).toBeTruthy();
      }
  });

  it('has enemies carry the gear that used to sit in chests beside them, and the Gunner hand over his coat', () => {
    const carried = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'enemy' && e.carries).map(e => (e.carries as { item: string }).item));
    for (const g of ['gear_warden_hauberk', 'gear_acolyte_robe', 'gear_renderer_apron', 'gear_drowned_veil', 'gear_beekeepers_veil']) expect(carried, g).toContain(g);
    const chests = Object.values(DATA.rooms).flatMap(r => r.entities.filter(e => e.type === 'item').map(e => String(e.item)));
    for (const g of carried.filter(i => DATA.items[i].effect.type === 'gear')) expect(chests, g).not.toContain(g);
    expect(JSON.stringify(DATA.scripts.gunner_death)).toContain('"give":"gear_gunners_coat"');
  });

  it('reloads the heavy guns quicker', () => {
    for (const id of ['flintlock', 'blunderbuss', 'heavy_crossbow']) expect(DATA.weapons[id].ranged!.reload.ticks, id).toBeLessThanOrEqual(110);
  });
});

describe('small polish', () => {
  it('names a goal for every step of Act 1, in order', () => {
    const goal = (flags: string[]) => DATA.goals.goals.find(g => check(new Set(flags), g.when))!.text;
    expect(goal([])).toContain('cage key');
    expect(goal(['key:cage_key', 'story:oskar_freed'])).toContain('Tollwarden');
    const seals = ['key:seal_of_tallow', 'key:seal_of_the_mire', 'key:seal_of_powder', 'key:seal_of_the_hive'];
    expect(goal(['key:cage_key', 'story:oskar_freed', 'boss:tollwarden', ...seals.slice(0, 2)])).toContain('Powder Vault');
    expect(goal(['key:cage_key', 'story:oskar_freed', 'boss:tollwarden', ...seals])).toContain('Chandler');
    expect(goal(['key:cage_key', 'story:oskar_freed', 'boss:tollwarden', ...seals, 'boss:chandler', 'key:chandler_ledger'])).toContain('Maudlin');
    expect(goal(['key:cage_key', 'story:oskar_freed', 'boss:tollwarden', ...seals, 'boss:chandler'])).toContain('Act One is over');
    expect(DATA.goals.goals.at(-1)!.when).toBeUndefined(); // there's always something to say
  });

  it('keeps the Cutting\'s Wickling off the stage in the opening, and brings it back after', () => {
    const steps = JSON.stringify(DATA.scripts.wreck_intro.steps);
    expect(steps).toContain('"hide":["decor:wagon","decor:horse","decor:guard_dead","decor:wheel_debris","player","npc:oskar_wreck","enemy:wickling"]');
    expect(steps).toContain('"show":["decor:wagon","decor:horse","decor:guard_dead","decor:wheel_debris","player","npc:oskar_wreck","enemy:wickling"]');
  });
});

describe('opening cutscene polish', () => {
  it('gives every line in the wagon scene time to be read before the next one', () => {
    const steps = DATA.scripts.wreck_intro.steps as Record<string, unknown>[];
    const gaps: number[] = [];
    let run: number | null = null;
    for (const s of steps) {
      if (typeof s.bubble === 'string') {
        if (run !== null) gaps.push(run);
        run = 0;
      } else if (typeof s.wait === 'number' && run !== null) run += s.wait;
    }
    expect(gaps.length).toBeGreaterThanOrEqual(8);
    expect(gaps.slice(0, 5).every(g => g >= 70), String(gaps)).toBe(true); // the quiet opening lines don't tumble over each other
  });

  it('shows who wrecked the wagon, and lands everyone it throws', () => {
    const steps = DATA.scripts.wreck_intro.steps as Record<string, unknown>[];
    const wicklings = steps.filter(s => s.sprite === 'wickling').map(s => s.actor);
    expect(wicklings.length).toBeGreaterThanOrEqual(3);
    // the guard with the cage key runs off east (to die in the Cutting, beside the key)
    expect(steps.some(s => s.move === 'guard3' && (s.to as number[])[0] >= 30)).toBe(true);
    // a thrown driver is put back on the ground (no longer drawn up on the wagon's seat)
    const thrown = steps.findIndex(s => s.move === 'driver' && s.arc);
    const landed = steps.findIndex((s, i) => i > thrown && s.actor === 'driver');
    expect(thrown).toBeGreaterThan(0);
    expect(landed).toBeGreaterThan(thrown);
    expect(steps[landed].lift).toBeUndefined();
  });
});

describe('release', () => {
  it('ships with the debug hotkeys and menu switched off', () => {
    expect(DATA.debug.enabled).toBe(false);
  });
});

describe('update 0.1.1', () => {
  it('lets angry bees give up sooner', () => {
    const s = DATA.swarms.swarms;
    expect(s.hive.angerTicks).toBeLessThanOrEqual(300);
    expect(s.hive.giveUp).toBeLessThanOrEqual(150);
    expect(s.hive_broken.angerTicks).toBeLessThanOrEqual(420);
    expect(s.drones.angerTicks).toBeLessThanOrEqual(210);
  });

  it('has the Hive Queen fight with honey: no swarms released, splashing sounds', () => {
    for (const k of ['hive_queen', 'queen_swarm']) {
      const text = JSON.stringify(DATA.enemies[k]);
      expect(text, k).not.toContain('"swarm":');
      expect(text, k).not.toMatch(/"(b_swarm_[a-z]+|b_sceptre|b_step_glide|e_buzz)"/);
    }
    expect(DATA.enemies.hive_queen.moves.some(m => m.id === 'comb_burst')).toBe(true);
    expect(DATA.enemies.queen_swarm.moves.some(m => m.id === 'honey_deluge')).toBe(true);
  });

  it('turns screams and roars down', () => {
    expect(DATA.audio.screamVolume).toBeLessThan(0.6);
  });

  it("won't take an exit through a sealed way until it opens", () => {
    const exits = new Exits();
    exits.build([DATA.rooms.road_04_collapsed_gate]);
    const gate = DATA.rooms.road_04_collapsed_gate;
    const at = { x: (gate.origin[0] + 13) * 16 + 8, y: (gate.origin[1] + 17) * 16 }; // feet pressed on the rubble's edge
    exits.check(0, 0); // arm it (standing off every exit)
    expect(exits.check(at.x, at.y, () => true)).toBeNull(); // the rubble is still there
    expect(exits.check(at.x, at.y, () => false)?.to.area).toBe('bloom'); // blasted clear
  });
});

describe('quit game', () => {
  it('only offers QUIT GAME in the desktop app (a browser tab cannot close itself)', () => {
    expect(isDesktop()).toBe(false); // the tests run outside Electron
  });
});
