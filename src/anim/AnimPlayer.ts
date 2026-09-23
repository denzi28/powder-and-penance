// Plays one animation track from a sprite manifest. Pure logic (no Phaser) so gameplay can own it.
//
// Phase stretching: frames may be tagged with a phase ("windup", "roll", ...). When play() is given
// {phases: {roll: 20}}, all frames tagged "roll" are time-scaled so the phase lasts exactly 20 ticks,
// whatever the authored frame count. Gameplay timing lives in data; art only supplies the look.
import type { AnimDef, FrameDef } from '../data/schemas';

export interface PlayOpts {
  restart?: boolean;
  phases?: Record<string, number>;
}

export function computeDurations(def: AnimDef, phases?: Record<string, number>): number[] {
  if (!phases) return def.frames.map(f => f.ticks);
  const totals: Record<string, number> = {};
  for (const f of def.frames) if (f.phase) totals[f.phase] = (totals[f.phase] ?? 0) + f.ticks;
  return def.frames.map(f =>
    f.phase !== undefined && phases[f.phase] !== undefined ? (f.ticks * phases[f.phase]) / totals[f.phase] : f.ticks,
  );
}

export class AnimPlayer {
  name = '';
  index = 0;
  done = false;
  private def: AnimDef | null = null;
  private time = 0;
  private durations: number[] = [];
  private pending: string[] = [];

  constructor(private anims: Record<string, AnimDef>) {}

  get frame(): FrameDef {
    return this.def ? this.def.frames[this.index] : { ticks: 1 };
  }

  has(name: string) {
    return name in this.anims;
  }

  play(name: string, opts: PlayOpts = {}) {
    if (!opts.restart && name === this.name) return;
    const def = this.anims[name];
    if (!def) throw new Error(`Unknown animation "${name}"`);
    this.def = def;
    this.name = name;
    this.index = 0;
    this.time = 0;
    this.done = false;
    this.durations = computeDurations(def, opts.phases);
    this.pending.push(...(def.frames[0].events ?? []));
  }

  /** Advance by `speed` ticks (negative plays backwards). Returns events of frames entered. */
  tick(speed = 1): string[] {
    const out = this.pending;
    this.pending = [];
    const def = this.def;
    if (!def || this.done || speed === 0) return out;
    const n = def.frames.length;
    const dir = speed > 0 ? 1 : -1;
    this.time += Math.abs(speed);
    for (let guard = 0; this.time >= this.durations[this.index] && guard < n * 4; guard++) {
      this.time -= this.durations[this.index];
      let next = this.index + dir;
      if (next >= n || next < 0) {
        if (!def.loop) {
          this.done = true;
          this.time = 0;
          break;
        }
        next = dir > 0 ? 0 : n - 1;
      }
      this.index = next;
      out.push(...(def.frames[next].events ?? []));
    }
    return out;
  }
}
