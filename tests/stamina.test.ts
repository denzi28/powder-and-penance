import { describe, expect, it } from 'vitest';
import { Stamina } from '../src/actors/Stamina';

const cfg = { max: 100, regenDelayTicks: 30, regenPerSec: 60, minToAct: 1 };
const make = () => new Stamina(() => cfg, () => 60);

describe('Stamina', () => {
  it('allows an action with any stamina left and clamps at zero', () => {
    const s = make();
    s.spend(95);
    expect(s.canAct()).toBe(true);
    s.spend(40);
    expect(s.value).toBe(0);
    expect(s.locked).toBe(true);
    expect(s.canAct()).toBe(false);
  });

  it('waits regenDelayTicks after the last spend before regenerating', () => {
    const s = make();
    s.spend(50);
    for (let i = 0; i < 30; i++) s.tick();
    expect(s.value).toBe(50);
    s.tick();
    expect(s.value).toBeCloseTo(51);
  });

  it('unlocks once regen restores minToAct', () => {
    const s = make();
    s.spend(100);
    for (let i = 0; i < 30; i++) s.tick();
    expect(s.canAct()).toBe(false);
    s.tick(); // +1 at 60/s
    expect(s.canAct()).toBe(true);
    expect(s.locked).toBe(false);
  });

  it('a new spend resets the regen delay', () => {
    const s = make();
    s.spend(10);
    for (let i = 0; i < 20; i++) s.tick();
    s.spend(10);
    for (let i = 0; i < 30; i++) s.tick();
    expect(s.value).toBe(80);
  });
});
