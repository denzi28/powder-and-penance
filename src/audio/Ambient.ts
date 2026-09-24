// Ambient sound (data/audio/ambient.json), synthesised with WebAudio like the effects in Sfx.ts.
// - Beds: continuous layers per area (gusting wind, a low drone or machine hum, a rumble), crossfaded
//   when the area changes.
// - Events: one-off sounds at random intervals (crows, owls, frogs, a distant bell, clanks, drips...),
//   spread left and right, optionally only while a story condition holds.
// - Decor: sounds near scenery (a crackling fire, bubbling vats), louder as you get close and panned.
// - Critters call `play` when they flee (wings, squeaks, a plop).
// Drips and bells can go through a shared echo, set per area.
import { DATA } from '../data/config';
import { check } from '../story/conditions';
import { TILE } from '../world/TileGrid';
import type { Sfx } from './Sfx';
import type { AmbientBed, AmbientSound, RoomData } from '../data/schemas';

type Out = { node: AudioNode; t: number };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Live {
  gain: GainNode;
  stop: () => void;
}

interface Emitter {
  x: number;
  y: number;
  sound: AmbientSound;
  every: [number, number];
  range: number;
  volume: number;
  timer: number;
}

export class AmbientAudio {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private echoFb: GainNode | null = null;
  private beds: Live[] = [];
  private area: string | null = null;
  private timers: number[] = [];
  private emitters: Emitter[] = [];

  constructor(private sfx: Sfx) {}

  /** The audio context exists only after the player's first key or click. */
  private ready(): BaseAudioContext | null {
    const ctx = this.sfx.context;
    if (!ctx || (ctx.state !== 'running' && !(ctx instanceof OfflineAudioContext))) return null; // offline: rendering a preview
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = DATA.ambient.volume * DATA.audio.master;
      this.out.connect(ctx.destination);
      // echo: delay -> low-pass -> feedback, mixed into the output
      this.echoIn = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.27;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      this.echoFb = ctx.createGain();
      this.echoFb.gain.value = 0;
      this.echoIn.connect(delay);
      delay.connect(lp);
      lp.connect(this.echoFb);
      this.echoFb.connect(delay);
      lp.connect(this.out);
      this.area = null; // (re)start the beds on this context
    }
    return ctx;
  }

  /** Build the decor emitters of an area. */
  build(rooms: RoomData[]) {
    this.emitters = [];
    for (const r of rooms)
      for (const en of r.entities) {
        if (en.type !== 'decor') continue;
        const d = DATA.ambient.decor[String(en.kind)];
        if (!d) continue;
        this.emitters.push({
          x: (r.origin[0] + en.at[0]) * TILE + TILE / 2,
          y: (r.origin[1] + en.at[1]) * TILE + TILE,
          sound: d.sound,
          every: d.every,
          range: d.range,
          volume: d.volume,
          timer: rnd(0, d.every[1]),
        });
      }
  }

  update(dt: number, area: string, listener: { x: number; y: number }, flags: ReadonlySet<string>) {
    const ctx = this.ready();
    if (!ctx || !this.out) return;
    const cfg = DATA.ambient.areas[area];
    if (area !== this.area) {
      this.area = area;
      for (const b of this.beds) {
        b.gain.gain.cancelScheduledValues(ctx.currentTime);
        b.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
        const s = b.stop;
        setTimeout(s, 3000);
      }
      this.beds = (cfg?.beds ?? []).map(b => this.startBed(ctx, b));
      this.timers = (cfg?.events ?? []).map(e => rnd(e.every[0] * 0.3, e.every[1]));
      this.echoFb!.gain.setTargetAtTime(cfg?.echo ?? 0, ctx.currentTime, 0.5);
    }
    if (!cfg) return;
    cfg.events.forEach((e, i) => {
      this.timers[i] -= dt;
      if (this.timers[i] > 0) return;
      this.timers[i] = rnd(e.every[0], e.every[1]);
      if (!check(flags, e.when)) return;
      this.sound(e.sound, e.volume * rnd(0.7, 1), rnd(-0.7, 0.7), cfg.echo ? e.echo : 0);
    });
    for (const em of this.emitters) {
      const d = Math.hypot(em.x - listener.x, em.y - listener.y);
      if (d > em.range) continue;
      em.timer -= dt;
      if (em.timer > 0) continue;
      em.timer = rnd(em.every[0], em.every[1]);
      const near = 1 - d / em.range;
      this.sound(em.sound, em.volume * near * near, Math.max(-0.8, Math.min(0.8, (em.x - listener.x) / 160)), 0);
    }
  }

  /** A one-off sound at a world position (critters). */
  play(sound: AmbientSound, x: number, y: number, listener: { x: number; y: number }, volume = 1) {
    const d = Math.hypot(x - listener.x, y - listener.y);
    const near = Math.max(0, 1 - d / DATA.audio.hearingDistance);
    if (near <= 0 || !this.ready()) return;
    this.sound(sound, volume * near, Math.max(-0.8, Math.min(0.8, (x - listener.x) / 160)), 0);
  }

  stop() {
    for (const b of this.beds) b.stop();
    this.beds = [];
    this.area = null;
  }

  // ---------------------------------------------------------------- beds
  private startBed(ctx: BaseAudioContext, b: AmbientBed): Live {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(b.volume, ctx.currentTime, 0.8);
    gain.connect(this.out!);
    const nodes: AudioScheduledSourceNode[] = [];
    const lfo = (rate: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
      nodes.push(o);
    };
    const noise = (rate: number) => {
      const n = ctx.createBufferSource();
      n.buffer = this.sfx.noiseBuffer;
      n.loop = true;
      n.playbackRate.value = rate;
      n.start(ctx.currentTime, Math.random());
      nodes.push(n);
      return n;
    };
    if (b.type === 'wind') {
      // noise through a wandering band-pass, swelling in gusts
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = b.freq;
      bp.Q.value = 0.8;
      const swell = ctx.createGain();
      swell.gain.value = 1 - b.gust * 0.5;
      noise(1).connect(bp).connect(swell).connect(gain);
      lfo(0.07, b.freq * 0.45, bp.frequency);
      lfo(0.11, b.gust * 0.5, swell.gain);
      lfo(0.043, b.gust * 0.25, swell.gain);
    } else if (b.type === 'rumble') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = b.freq;
      const swell = ctx.createGain();
      swell.gain.value = 1;
      noise(0.5).connect(lp).connect(swell).connect(gain);
      lfo(0.09, b.gust * 0.5, swell.gain);
    } else {
      // drone / hum: a few detuned oscillators, softened, slowly beating
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = b.type === 'hum' ? b.freq * 6 : b.freq * 3;
      lp.connect(gain);
      for (const [i, mult] of (b.chord ?? [1]).entries()) {
        for (const det of [-1, 1]) {
          const o = ctx.createOscillator();
          o.type = b.type === 'hum' ? 'sawtooth' : 'triangle';
          o.frequency.value = b.freq * mult;
          o.detune.value = det * (3 + i * 2);
          const g = ctx.createGain();
          g.gain.value = 0.5 / (1 + i);
          o.connect(g).connect(lp);
          o.start();
          nodes.push(o);
        }
      }
      lfo(0.05, b.freq * 1.5, lp.frequency);
    }
    return {
      gain,
      stop: () => {
        for (const n of nodes)
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        gain.disconnect();
      },
    };
  }

  // ---------------------------------------------------------------- one-off sounds
  private sound(id: AmbientSound, volume: number, pan: number, echo: number) {
    const ctx = this.ctx!;
    if (volume < 0.01) return;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(panner).connect(this.out!);
    if (echo > 0) {
      const send = ctx.createGain();
      send.gain.value = echo;
      g.connect(send).connect(this.echoIn!);
    }
    const o: Out = { node: g, t: ctx.currentTime + 0.02 };
    RECIPES[id](ctx, o, this.sfx.noiseBuffer!);
  }
}

// ---------------------------------------------------------------- recipes
/** A shaped tone: wave from f0 to f1 over dur, attack/decay envelope, optional low-pass. */
function tone(ctx: BaseAudioContext, out: AudioNode, t: number, wave: OscillatorType, f0: number, f1: number, dur: number, vol: number, lp?: number, attack = 0.005) {
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n: AudioNode = o;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    n = n.connect(f);
  }
  n.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

/** A burst of filtered noise. */
function hiss(ctx: BaseAudioContext, out: AudioNode, t: number, buf: AudioBuffer, type: BiquadFilterType, freq: number, dur: number, vol: number, attack = 0.005, rate = 1) {
  const n = ctx.createBufferSource();
  n.buffer = buf;
  n.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(out);
  n.start(t, Math.random() * 0.5);
  n.stop(t + dur + 0.05);
}

type Recipe = (ctx: BaseAudioContext, o: Out, noise: AudioBuffer) => void;
const RECIPES: Record<AmbientSound, Recipe> = {
  // a crow: two or three harsh, falling caws
  crow: (ctx, { node, t }) => {
    const n = 2 + Math.floor(Math.random() * 2);
    const base = rnd(520, 640);
    for (let i = 0; i < n; i++) {
      const s = t + i * rnd(0.32, 0.42);
      const o = tone(ctx, node, s, 'sawtooth', base, base * 0.72, 0.22, 0.22, 1400, 0.02);
      // throat rasp
      const vib = ctx.createOscillator();
      vib.frequency.value = 38;
      const vg = ctx.createGain();
      vg.gain.value = 40;
      vib.connect(vg).connect(o.frequency);
      vib.start(s);
      vib.stop(s + 0.25);
    }
  },
  // wood straining on a rope: a slow, grinding, rising creak
  creak: (ctx, { node, t }) => {
    const o = tone(ctx, node, t, 'sawtooth', rnd(90, 120), rnd(130, 170), 0.9, 0.12, 700, 0.25);
    const jit = ctx.createOscillator();
    jit.type = 'square';
    jit.frequency.value = rnd(18, 26);
    const jg = ctx.createGain();
    jg.gain.value = 25;
    jit.connect(jg).connect(o.frequency);
    jit.start(t);
    jit.stop(t + 1);
  },
  // an owl: hoo... hoo-hoo
  owl: (ctx, { node, t }) => {
    const f = rnd(340, 400);
    tone(ctx, node, t, 'sine', f, f * 0.93, 0.45, 0.2, undefined, 0.08);
    tone(ctx, node, t + 0.75, 'sine', f * 1.02, f * 0.95, 0.22, 0.16, undefined, 0.05);
    tone(ctx, node, t + 1.05, 'sine', f, f * 0.9, 0.5, 0.18, undefined, 0.06);
  },
  // the great bell, far off: inharmonic partials with a long fading hum
  bell: (ctx, { node, t }) => {
    const f = rnd(98, 104);
    for (const [ratio, v, dur] of [
      [0.5, 0.12, 7],
      [1, 0.3, 6],
      [1.19, 0.14, 4],
      [1.5, 0.1, 3.5],
      [2, 0.12, 3],
      [2.74, 0.07, 2],
    ] as const)
      tone(ctx, node, t, 'sine', f * ratio, f * ratio * 0.998, dur, v, undefined, 0.004);
  },
  // crickets: short, fast trills of a high chirp
  crickets: (ctx, { node, t }) => {
    const f = rnd(4200, 4800);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 4; k++) tone(ctx, node, t + i * 0.28 + k * 0.035, 'sine', f, f, 0.025, 0.05, undefined, 0.003);
  },
  // a frog: a low throaty croak, a quick train of pulses
  frog: (ctx, { node, t }) => {
    const f = rnd(95, 140);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 7; k++) tone(ctx, node, t + i * 0.3 + k * 0.028, 'square', f, f * 0.92, 0.024, 0.13, 700, 0.003);
  },
  // a bubble rising and popping in thick wax
  bubble: (ctx, { node, t }) => {
    const f = rnd(180, 320);
    tone(ctx, node, t, 'sine', f, f * rnd(2.2, 3), 0.07, 0.22, undefined, 0.004);
    if (Math.random() < 0.4) tone(ctx, node, t + rnd(0.08, 0.2), 'sine', f * 1.3, f * 3.5, 0.05, 0.12);
  },
  // a drop landing in a puddle: a bright plink (the echo gives the room)
  drip: (ctx, { node, t }) => {
    const f = rnd(900, 1500);
    tone(ctx, node, t, 'sine', f, f * 2.1, 0.09, 0.2, undefined, 0.002);
  },
  // iron on iron, somewhere in the Works
  clank: (ctx, { node, t }, buf) => {
    const f = rnd(160, 260);
    for (const [r, v] of [
      [1, 0.14],
      [2.76, 0.1],
      [5.4, 0.06],
      [8.9, 0.04],
    ] as const)
      tone(ctx, node, t, 'triangle', f * r, f * r * 0.99, rnd(0.5, 1.1), v, undefined, 0.001);
    hiss(ctx, node, t, buf, 'highpass', 2000, 0.05, 0.2);
  },
  // steam escaping a pipe
  steam: (ctx, { node, t }, buf) => hiss(ctx, node, t, buf, 'highpass', rnd(2500, 4000), rnd(0.8, 1.6), 0.12, 0.08),
  // a chain dragged and rattling
  chain: (ctx, { node, t }, buf) => {
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const s = t + i * rnd(0.04, 0.09);
      hiss(ctx, node, s, buf, 'bandpass', rnd(2500, 4500), 0.04, 0.12);
      tone(ctx, node, s, 'triangle', rnd(1800, 2600), rnd(1700, 2500), 0.06, 0.03);
    }
  },
  // monks humming in the dark: a low vowel swelling and fading
  choir: (ctx, { node, t }) => {
    const base = [110, 123.5, 130.8, 146.8][Math.floor(Math.random() * 4)];
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 650;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1050;
    f2.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 2);
    g.gain.linearRampToValueAtTime(0.0001, t + 5);
    f1.connect(g);
    f2.connect(g);
    g.connect(node);
    for (const [r, det] of [
      [1, -6],
      [1, 5],
      [1.5, 3],
      [2, -4],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = base * r;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.12;
      o.connect(og);
      og.connect(f1);
      og.connect(f2);
      o.start(t);
      o.stop(t + 5.1);
    }
  },
  // someone humming far off across the water: a wavering, wandering line
  humming: (ctx, { node, t }) => {
    const notes = [220, 247, 262, 220, 196, 220];
    const o = ctx.createOscillator();
    o.type = 'sine';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vg = ctx.createGain();
    vg.gain.value = 4;
    vib.connect(vg).connect(o.frequency);
    notes.forEach((f, i) => o.frequency.setTargetAtTime(f, t + i * 0.7, 0.12));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.8);
    g.gain.setValueAtTime(0.14, t + notes.length * 0.7 - 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + notes.length * 0.7);
    o.connect(g).connect(node);
    o.start(t);
    vib.start(t);
    o.stop(t + notes.length * 0.7 + 0.1);
    vib.stop(t + notes.length * 0.7 + 0.1);
  },
  // a fire crackling: tiny sharp pops
  crackle: (ctx, { node, t }, buf) => {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) hiss(ctx, node, t + i * rnd(0.01, 0.05), buf, 'highpass', rnd(1500, 3500), rnd(0.015, 0.04), rnd(0.15, 0.35), 0.001);
  },
  // a furnace breathing: a low whoosh
  roar: (ctx, { node, t }, buf) => hiss(ctx, node, t, buf, 'lowpass', rnd(200, 350), rnd(1.2, 2), 0.35, 0.4, 0.6),
  // wings beating as a bird takes off
  wings: (ctx, { node, t }, buf) => {
    for (let i = 0; i < 5; i++) hiss(ctx, node, t + i * 0.085, buf, 'bandpass', rnd(700, 1100), 0.06, 0.3 - i * 0.04, 0.01);
  },
  // a rat's squeak (or a bat's)
  squeak: (ctx, { node, t }) => {
    const f = rnd(2800, 3600);
    tone(ctx, node, t, 'sine', f, f * 1.25, 0.06, 0.08);
    if (Math.random() < 0.5) tone(ctx, node, t + 0.09, 'sine', f * 1.1, f * 1.3, 0.05, 0.06);
  },
  // something slipping into water
  plop: (ctx, { node, t }) => tone(ctx, node, t, 'sine', rnd(250, 350), rnd(700, 900), 0.08, 0.25, undefined, 0.002),
};
