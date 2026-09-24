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
