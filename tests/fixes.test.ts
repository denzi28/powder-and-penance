// Regression checks for reported bugs: the hub shrine clear of people, the gear hotkeys, broods that rest.
import { describe, expect, it } from 'vitest';
import { DATA } from '../src/data/config';
import { rollFor } from '../src/player/Player';

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
    for (const g of carried) expect(chests, g).not.toContain(g);
    expect(JSON.stringify(DATA.scripts.gunner_death)).toContain('"give":"gear_gunners_coat"');
  });

  it('reloads the heavy guns quicker', () => {
    for (const id of ['flintlock', 'blunderbuss', 'heavy_crossbow']) expect(DATA.weapons[id].ranged!.reload.ticks, id).toBeLessThanOrEqual(110);
  });
});
