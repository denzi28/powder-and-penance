import { describe, expect, it } from 'vitest';
import { AnimPlayer, computeDurations } from '../src/anim/AnimPlayer';
import type { AnimDef } from '../src/data/schemas';

const roll: AnimDef = {
  row: 0,
  dirs: ['S'],
  loop: false,
  frames: [
    { ticks: 2, phase: 'roll', events: ['dust'] },
    { ticks: 2, phase: 'roll' },
    { ticks: 4, phase: 'recover', events: ['stand'] },
  ],
};
const walk: AnimDef = {
  row: 0,
  dirs: ['S'],
  loop: true,
  frames: [{ ticks: 5, events: ['step'] }, { ticks: 5 }],
};

describe('computeDurations', () => {
  it('stretches each phase to its target tick count', () => {
    expect(computeDurations(roll, { roll: 10, recover: 20 })).toEqual([5, 5, 20]);
  });
  it('uses authored ticks without phases', () => {
    expect(computeDurations(roll)).toEqual([2, 2, 4]);
  });
});

describe('AnimPlayer', () => {
  it('fires first-frame events on play and later events on frame entry', () => {
    const a = new AnimPlayer({ roll });
    a.play('roll', { phases: { roll: 10, recover: 20 } });
    expect(a.tick()).toEqual(['dust']);
    const events: string[] = [];
    let ticks = 1;
    while (!a.done && ticks < 100) {
      events.push(...a.tick());
      ticks++;
    }
    expect(events).toEqual(['stand']);
    expect(ticks).toBe(30); // phase-stretched total length
    expect(a.index).toBe(2); // holds the last frame
  });

  it('loops and can play backwards', () => {
    const a = new AnimPlayer({ walk });
    a.play('walk');
    a.tick();
    for (let i = 0; i < 5; i++) a.tick(-1);
    expect(a.index).toBe(1); // wrapped from 0 back to the last frame
  });
});
