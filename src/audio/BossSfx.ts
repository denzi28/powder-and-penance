// Boss sound effects, synthesised in layers (the plain presets in data/audio/sfx.json are one voice each).
// Any effect id starting "b_" is one of these: a strike's `sfx` (the swing or impact), its `windupSfx`
// (the tell: a grunt, a chain, a breath), a boss's `roarSfx` / `slamSfx`, or a lob's landing `sfx`.
// They play into a stone-hall reverb, panned toward where the boss is.
import { DATA } from '../data/config';
import { hallImpulse } from './Music';
import type { Sfx } from './Sfx';
import type { LayeredSound } from '../data/schemas';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class BossSfx {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private wet: GainNode | null = null;

  constructor(private sfx: Sfx) {}

  private ready(): BaseAudioContext | null {
    const ctx = this.sfx.context;
    if (!ctx || (ctx.state !== 'running' && !(ctx instanceof OfflineAudioContext))) return null;
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor(); // big layered hits: keep them from clipping
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.out = ctx.createGain();
      this.out.connect(comp);
      const verb = ctx.createConvolver();
      verb.buffer = hallImpulse(ctx, 2.6);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.35;
      this.wet.connect(verb).connect(comp);
    }
    return ctx;
  }

  static has(id: string): id is LayeredSound {
    return id in RECIPES;
  }

  /** @param pan -1 left .. 1 right */
  play(id: LayeredSound, volume = 1, pan = 0) {
    const ctx = this.ready();
    if (!ctx || volume <= 0.01) return;
    const g = ctx.createGain();
    const soft = id.startsWith('b_matron') || id === 'b_wet_swipe' || id === 'b_embrace'; // her voice is thin: lift it
    g.gain.value = volume * DATA.audio.master * DATA.audio.sfx * 0.8 * (soft ? 1.8 : 1);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    g.connect(p);
    p.connect(this.out!);
    p.connect(this.wet!);
    RECIPES[id](new Kit(ctx, g, ctx.currentTime + 0.01));
  }
}

// ---------------------------------------------------------------- building blocks
const VOWELS = {
  ah: [800, 1150, 2900],
  oh: [450, 800, 2830],
  uh: [600, 1000, 2500],
  eh: [530, 1840, 2480],
  oo: [325, 700, 2530],
  mm: [250, 900, 2200],
} as const;
type Vowel = keyof typeof VOWELS;

let noiseBuf: AudioBuffer | null = null;

/** The tools a recipe builds from, all writing into one output at time t. */
class Kit {
  constructor(
    readonly ctx: BaseAudioContext,
    readonly out: AudioNode,
    readonly t: number,
  ) {}

  private noiseSrc(at: number, dur: number, rate = 1) {
    const ctx = this.ctx;
    if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.loop = true;
    n.playbackRate.value = rate;
    n.start(at, Math.random() * 1.5);
    n.stop(at + dur + 0.05);
    return n;
  }

  /** A gain envelope: attack, then exponential decay to silence over `dur`. */
  private env(at: number, attack: number, dur: number, peak: number, dest: AudioNode = this.out) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(dur, attack + 0.01));
    g.connect(dest);
    return g;
  }

  private filt(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private osc(type: OscillatorType, f: number, at: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  /** Air cut by something big: band-passed noise sweeping from f0 to f1, swelling to its peak at `peakAt`. */
  whoosh(dt: number, dur: number, f0: number, f1: number, vol: number, peakAt = 0.6) {
    const at = this.t + dt;
    const n = this.noiseSrc(at, dur);
    const bp = this.filt('bandpass', f0, 1.3);
    bp.frequency.setValueAtTime(f0, at);
    bp.frequency.exponentialRampToValueAtTime(f1, at + dur * peakAt);
    bp.frequency.exponentialRampToValueAtTime(f0 * 0.8, at + dur);
    const g = this.env(at, dur * peakAt, dur, vol);
    n.connect(bp).connect(g);
  }

  /** A deep impact: a sine dropping in pitch, and the thud of the hit. */
  boom(dt: number, f0: number, f1: number, dur: number, vol: number) {
    const at = this.t + dt;
    const o = this.osc('sine', f0, at, dur);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.7);
    o.connect(this.env(at, 0.004, dur, vol));
    const n = this.noiseSrc(at, 0.2);
    n.connect(this.filt('lowpass', 600)).connect(this.env(at, 0.002, 0.18, vol * 0.6));
  }

  /** The floor shaking after an impact. */
  rumble(dt: number, dur: number, vol: number) {
    const at = this.t + dt;
    this.noiseSrc(at, dur, 0.5)
      .connect(this.filt('lowpass', 140))
      .connect(this.env(at, 0.02, dur, vol));
  }

  /** Grit and stone chips falling. */
  debris(dt: number, dur: number, vol: number) {
    for (let i = 0; i < 12; i++) {
      const at = this.t + dt + Math.pow(Math.random(), 1.6) * dur;
      this.noiseSrc(at, 0.03)
        .connect(this.filt('bandpass', rnd(1500, 5000), 3))
        .connect(this.env(at, 0.001, 0.03, vol * rnd(0.3, 1)));
    }
  }

  /** A great bell: inharmonic partials and a long hum. */
  bell(dt: number, f: number, dur: number, vol: number) {
    const at = this.t + dt;
    for (const [r, v, d] of [
      [0.5, 0.35, 1],
      [1, 1, 0.85],
      [1.19, 0.45, 0.6],
      [1.5, 0.3, 0.5],
      [2, 0.35, 0.4],
      [2.74, 0.2, 0.25],
      [3.76, 0.12, 0.18],
    ] as const)
      this.osc('sine', f * r * rnd(0.998, 1.002), at, dur * d).connect(this.env(at, 0.002, dur * d, vol * v * 0.3));
  }

  /** Metal struck: a bright, short inharmonic ring and a click. */
  clang(dt: number, f: number, dur: number, vol: number) {
    const at = this.t + dt;
    for (const [r, v] of [
      [1, 1],
      [2.76, 0.6],
      [5.4, 0.35],
      [8.93, 0.2],
    ] as const)
      this.osc('triangle', f * r, at, dur / Math.sqrt(r)).connect(this.env(at, 0.001, dur / Math.sqrt(r), vol * v * 0.3));
    this.noiseSrc(at, 0.04).connect(this.filt('highpass', 3000)).connect(this.env(at, 0.001, 0.04, vol * 0.5));
  }

  /** A chain swinging: links knocking together. */
  chain(dt: number, dur: number, vol: number) {
    const n = Math.round(dur / 0.045);
    for (let i = 0; i < n; i++) {
      const at = this.t + dt + i * rnd(0.03, 0.06);
      this.noiseSrc(at, 0.03).connect(this.filt('bandpass', rnd(2500, 4500), 4)).connect(this.env(at, 0.001, 0.035, vol * rnd(0.4, 1)));
      this.osc('triangle', rnd(1800, 2800), at, 0.05).connect(this.env(at, 0.001, 0.05, vol * 0.15));
    }
  }

  /** Something wet hitting or sloshing: a falling noise band and a few bubbles. */
  splash(dt: number, dur: number, vol: number, low = false) {
    const at = this.t + dt;
    const bp = this.filt('bandpass', low ? 700 : 1400, 0.9);
    bp.frequency.setValueAtTime(low ? 900 : 2200, at);
    bp.frequency.exponentialRampToValueAtTime(low ? 250 : 500, at + dur);
    this.noiseSrc(at, dur).connect(bp).connect(this.env(at, 0.01, dur, vol));
    this.bubbles(dt + dur * 0.3, 4, vol * 0.5, low);
  }

  bubbles(dt: number, n: number, vol: number, low = false) {
    for (let i = 0; i < n; i++) {
      const at = this.t + dt + rnd(0, 0.35);
      const f = low ? rnd(120, 220) : rnd(250, 500);
      const o = this.osc('sine', f, at, 0.08);
      o.frequency.exponentialRampToValueAtTime(f * rnd(2, 3), at + 0.07);
      o.connect(this.env(at, 0.004, 0.08, vol * 0.6));
    }
  }

  /** Hot wax on stone: a high hiss. */
  sizzle(dt: number, dur: number, vol: number) {
    const at = this.t + dt;
    this.noiseSrc(at, dur).connect(this.filt('highpass', 4000)).connect(this.env(at, 0.03, dur, vol));
  }

  /** Fire: a roaring band of noise swelling and falling, and crackles. */
  fire(dt: number, dur: number, vol: number, bright = 1) {
    const at = this.t + dt;
    const lp = this.filt('lowpass', 500 * bright, 0.8);
    lp.frequency.setValueAtTime(400 * bright, at);
    lp.frequency.exponentialRampToValueAtTime(2200 * bright, at + dur * 0.3);
    lp.frequency.exponentialRampToValueAtTime(600 * bright, at + dur);
    this.noiseSrc(at, dur, 0.8).connect(lp).connect(this.env(at, dur * 0.25, dur, vol));
    for (let i = 0; i < dur * 20; i++) {
      const ct = at + rnd(0, dur);
      this.noiseSrc(ct, 0.02).connect(this.filt('highpass', rnd(2000, 5000))).connect(this.env(ct, 0.001, 0.02, vol * rnd(0.2, 0.6)));
    }
  }

  /** Bones knocking: dry woody clicks. */
  rattle(dt: number, dur: number, vol: number) {
    const n = Math.round(dur / 0.035);
    for (let i = 0; i < n; i++) {
      const at = this.t + dt + rnd(0, dur);
      const f = rnd(700, 1600);
      this.osc('triangle', f, at, 0.03).connect(this.env(at, 0.001, 0.03, vol * rnd(0.3, 0.9)));
      this.noiseSrc(at, 0.015).connect(this.filt('bandpass', f * 2, 5)).connect(this.env(at, 0.001, 0.015, vol * 0.4));
    }
  }

  /** A sound swelling up out of nothing and cut off at its loudest (a spell gathering). */
  swell(dt: number, dur: number, f: number, vol: number) {
    const at = this.t + dt;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + dur);
    g.gain.setValueAtTime(0.0001, at + dur + 0.02);
    g.connect(this.out);
    for (const r of [1, 1.5, 2.01]) this.osc('sine', f * r, at, dur).connect(g);
    const bp = this.filt('bandpass', f * 4, 2);
    bp.frequency.setValueAtTime(f * 2, at);
    bp.frequency.exponentialRampToValueAtTime(f * 12, at + dur);
    this.noiseSrc(at, dur).connect(bp).connect(g);
  }

  /**
   * A voice: a sawtooth throat through vowel formants, pitch gliding from f0 to f1, with `growl` roughness
   * (0 clean .. 1 a snarl) and `voices` singers slightly apart (a choir, or a thing with more than one throat).
   */
  voice(dt: number, dur: number, f0: number, f1: number, vowel: Vowel, vol: number, growl = 0, voices = 1, vibrato = 0) {
    const at = this.t + dt;
    const g = this.env(at, Math.min(0.08, dur * 0.2), dur, vol);
    const [F1, F2, F3] = VOWELS[vowel];
    const mix = this.ctx.createGain();
    for (const [f, q, a] of [
      [F1, 5, 1],
      [F2, 6, 0.5],
      [F3, 9, 0.2],
    ] as const) {
      const b = this.filt('bandpass', f, q);
      const bg = this.ctx.createGain();
      bg.gain.value = a;
      mix.connect(b).connect(bg).connect(g);
    }
    for (let i = 0; i < voices; i++) {
      const o = this.osc('sawtooth', f0, at, dur);
      o.detune.value = (i - (voices - 1) / 2) * 12;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      if (growl > 0) {
        // roughness: the throat's pitch and loudness jitter fast
        const lfo = this.osc('square', rnd(28, 45), at, dur);
        const lg = this.ctx.createGain();
        lg.gain.value = f0 * 0.08 * growl;
        lfo.connect(lg).connect(o.frequency);
      }
      if (vibrato > 0) {
        const v = this.osc('sine', rnd(4.8, 5.8), at, dur);
        const vg = this.ctx.createGain();
        vg.gain.value = vibrato;
        v.connect(vg).connect(o.detune);
      }
      o.connect(mix);
    }
    if (growl > 0) this.noiseSrc(at, dur).connect(this.filt('bandpass', F1, 2)).connect(this.env(at, 0.05, dur, vol * 0.4 * growl));
  }

  /** A blade drawn through the air: a thin, fast, rising hiss. */
  slice(dt: number, dur: number, vol: number) {
    const at = this.t + dt;
    const hp = this.filt('bandpass', 3000, 2);
    hp.frequency.setValueAtTime(2000, at);
    hp.frequency.exponentialRampToValueAtTime(7000, at + dur);
    this.noiseSrc(at, dur).connect(hp).connect(this.env(at, dur * 0.5, dur, vol));
  }

  /** Glass breaking: bright pings scattering and a crunch. */
  glass(dt: number, vol: number) {
    const at = this.t + dt;
    this.noiseSrc(at, 0.15).connect(this.filt('highpass', 3500)).connect(this.env(at, 0.001, 0.15, vol * 0.7));
    for (let i = 0; i < 9; i++) {
      const pt = at + Math.pow(Math.random(), 1.5) * 0.35;
      this.osc('sine', rnd(2500, 6500), pt, 0.12).connect(this.env(pt, 0.001, 0.12, vol * rnd(0.1, 0.35)));
    }
  }

  /** A flame going out: a puff and a hiss. */
  snuff(dt: number, vol: number) {
    this.breath(dt, 0.3, vol * 0.8, false);
    this.sizzle(dt + 0.05, 0.4, vol * 0.4);
  }

  /** A pop, like a bubble bursting or a cork. */
  pop(dt: number, f: number, vol: number) {
    const at = this.t + dt;
    const o = this.osc('sine', f, at, 0.07);
    o.frequency.exponentialRampToValueAtTime(f * 2.5, at + 0.05);
    o.connect(this.env(at, 0.002, 0.07, vol));
    this.noiseSrc(at, 0.02).connect(this.filt('bandpass', f * 4, 2)).connect(this.env(at, 0.001, 0.02, vol * 0.5));
  }

  /** Breath drawn in (or out): shaped noise. */
  breath(dt: number, dur: number, vol: number, inhale = true) {
    const at = this.t + dt;
    const bp = this.filt('bandpass', inhale ? 1200 : 2400, 1.5);
    bp.frequency.setValueAtTime(inhale ? 900 : 2600, at);
    bp.frequency.exponentialRampToValueAtTime(inhale ? 2600 : 900, at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + (inhale ? dur * 0.85 : 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(this.out);
    this.noiseSrc(at, dur).connect(bp).connect(g);
  }
}

// ---------------------------------------------------------------- the bosses' sounds
type Recipe = (k: Kit) => void;
const RECIPES: Record<LayeredSound, Recipe> = {
  // ---- the Tollwarden: a giant gaoler with a bell for a hammer
  b_toll_heft: k => {
    k.voice(0, 0.35, 95, 80, 'uh', 0.5, 0.8);
    k.chain(0.05, 0.3, 0.35);
  },
  b_hammer_whoosh: k => {
    k.whoosh(0, 0.38, 180, 900, 0.9);
    k.clang(0.22, 520, 1.2, 0.25);
  },
  b_hammer_thrust: k => {
    k.whoosh(0, 0.2, 400, 1600, 0.8, 0.5);
    k.clang(0.14, 700, 0.8, 0.3);
  },
  b_bell_rise: k => {
    k.voice(0, 0.55, 90, 135, 'ah', 0.55, 0.9);
    k.swell(0, 0.6, 98, 0.25);
    k.chain(0.1, 0.4, 0.3);
  },
  b_bell_slam: k => {
    k.bell(0, 98, 4.5, 1);
    k.boom(0, 85, 32, 0.9, 1);
    k.rumble(0.02, 1.6, 0.6);
    k.debris(0.05, 0.7, 0.4);
    k.clang(0, 260, 1.5, 0.35);
  },
  b_toss: k => {
    k.voice(0, 0.25, 110, 85, 'uh', 0.45, 0.7);
    k.whoosh(0.05, 0.28, 300, 1200, 0.6);
  },
  b_toll_roar: k => {
    k.voice(0, 1.5, 115, 68, 'ah', 0.8, 1, 2);
    k.bell(0.3, 98, 3.5, 0.6);
    k.rumble(0, 1.6, 0.4);
  },
  // ---- the Mire Matron: a drowned mother who sings
  b_matron_breath: k => {
    k.breath(0, 0.55, 0.4);
    k.bubbles(0.1, 3, 0.25, true);
  },
  b_wet_swipe: k => {
    k.whoosh(0, 0.3, 300, 1200, 0.7);
    k.splash(0.18, 0.45, 0.6);
  },
  b_matron_hush: k => {
    k.breath(0, 0.7, 0.35, false); // "shhh"
    k.voice(0.1, 0.8, 196, 175, 'oo', 0.25, 0, 2, 12);
  },
  b_embrace: k => {
    k.splash(0, 0.6, 0.8, true);
    k.voice(0.05, 1.0, 220, 165, 'oh', 0.35, 0.15, 2, 15);
    k.bubbles(0.3, 5, 0.4, true);
  },
  b_matron_sing: k => k.voice(0, 0.7, 440, 440, 'ah', 0.35, 0, 3, 25),
  b_matron_wail: k => {
    k.voice(0, 1.4, 700, 300, 'ah', 0.6, 0.35, 3, 30);
    k.voice(0.05, 1.3, 470, 210, 'eh', 0.35, 0.3, 2, 20);
    k.breath(1.1, 0.4, 0.2, false);
  },
  b_matron_lullaby: k => {
    [523, 440, 392, 440].forEach((f, i) => k.voice(i * 0.42, 0.55, f, f, 'oo', 0.3, 0, 3, 22));
  },
  // ---- Mother Tallow: the renderer, a ladle as big as a door, a hum
  b_mother_grunt: k => k.voice(0, 0.3, 165, 130, 'uh', 0.5, 0.7),
  b_ladle_whoosh: k => {
    k.whoosh(0, 0.42, 160, 750, 0.9);
    k.splash(0.2, 0.5, 0.45, true);
  },
  b_spit: k => {
    k.voice(0, 0.18, 180, 150, 'eh', 0.35, 1);
    k.whoosh(0.05, 0.2, 800, 2500, 0.4, 0.3);
    k.splash(0.08, 0.2, 0.3);
  },
  b_wax_splat: k => {
    k.splash(0, 0.45, 0.8, true);
    k.sizzle(0.05, 0.9, 0.25);
    k.bubbles(0.1, 4, 0.4);
  },
  b_mother_heave: k => {
    k.voice(0, 0.55, 150, 230, 'ah', 0.55, 0.8);
    k.splash(0.1, 0.5, 0.35, true);
  },
  b_ladle_crush: k => {
    k.clang(0, 300, 1.6, 0.6);
    k.boom(0, 80, 35, 0.8, 1);
    k.splash(0.02, 0.6, 0.8, true);
    k.rumble(0.02, 1.2, 0.45);
    k.debris(0.05, 0.5, 0.3);
  },
  b_mother_hum: k => {
    k.voice(0, 0.4, 196, 196, 'mm', 0.4, 0, 1, 10);
    k.voice(0.42, 0.45, 220, 220, 'mm', 0.4, 0, 1, 10);
  },
  b_wax_pour: k => {
    k.splash(0, 1.1, 0.5, true);
    k.bubbles(0, 8, 0.5, true);
    k.sizzle(0.4, 1.0, 0.2);
  },
  b_mother_roar: k => {
    k.voice(0, 0.45, 196, 196, 'mm', 0.35, 0, 1, 10);
    k.voice(0.45, 1.2, 185, 105, 'ah', 0.8, 1, 2);
    k.splash(0.5, 0.8, 0.4, true);
  },
  // ---- Mother Tallow, Unrendered: what was under the wax
  b_bone_rattle: k => k.rattle(0, 0.35, 0.5),
  b_bone_whoosh: k => {
    k.whoosh(0, 0.3, 250, 1100, 0.8);
    k.rattle(0.05, 0.3, 0.45);
  },
  b_bone_jab: k => {
    k.whoosh(0, 0.14, 500, 1800, 0.6, 0.5);
    k.rattle(0.08, 0.1, 0.5);
  },
  b_bone_hiss: k => {
    k.breath(0, 0.45, 0.45, false);
    k.fire(0.1, 0.4, 0.35, 1.2);
  },
  b_bone_leap: k => {
    k.rattle(0, 0.25, 0.5);
    k.whoosh(0.05, 0.45, 400, 3000, 0.7, 0.8);
  },
  b_ground_slam: k => {
    k.boom(0, 90, 30, 0.9, 1);
    k.rumble(0.02, 1.4, 0.6);
    k.debris(0.03, 0.8, 0.45);
    k.rattle(0.05, 0.4, 0.35);
  },
  b_bone_summon: k => {
    k.swell(0, 1.0, 110, 0.35);
    k.voice(0, 1.1, 82, 78, 'oo', 0.35, 0.5, 3);
    k.rattle(0.4, 0.8, 0.4);
  },
  b_bone_screech: k => {
    k.voice(0, 1.2, 900, 480, 'eh', 0.55, 0.8, 2);
    k.rattle(0.1, 1.0, 0.4);
    k.rumble(0, 1, 0.3);
  },
  // ---- the Chandler: the old priest with his snuffer and censer
  b_chandler_chant: k => k.voice(0, 0.4, 131, 123, 'ah', 0.4, 0.2, 2, 18),
  b_staff_whoosh: k => {
    k.whoosh(0, 0.34, 220, 1000, 0.8);
    k.fire(0.1, 0.35, 0.3, 1.3);
  },
  b_staff_thrust: k => {
    k.whoosh(0, 0.18, 450, 1700, 0.7, 0.5);
    k.clang(0.12, 850, 0.6, 0.25);
  },
  b_flame_flick: k => {
    k.whoosh(0, 0.25, 700, 2600, 0.5, 0.4);
    k.fire(0, 0.35, 0.35, 1.5);
  },
  b_censer: k => {
    k.chain(0, 0.45, 0.45);
    k.whoosh(0.05, 0.35, 300, 1200, 0.6);
    k.breath(0.25, 0.5, 0.25, false); // the smoke puffing out
  },
  b_chandler_roar: k => {
    k.voice(0, 1.4, 131, 98, 'ah', 0.6, 0.4, 3, 15);
    k.bell(0.2, 98, 3.5, 0.5);
  },
  // ---- the Chandler, Last Candle: black flame
  b_blackflame_whoosh: k => {
    k.whoosh(0, 0.34, 150, 800, 0.8);
    k.fire(0.05, 0.45, 0.45, 0.7);
  },
  b_blackflame_jab: k => {
    k.whoosh(0, 0.16, 400, 1600, 0.6, 0.5);
    k.fire(0.05, 0.25, 0.35, 0.8);
  },
  b_blackflame_slam: k => {
    k.boom(0, 95, 30, 1, 1);
    k.fire(0, 1.1, 0.7, 0.7);
    k.bell(0, 93, 3.5, 0.55);
    k.rumble(0.02, 1.5, 0.55);
    k.debris(0.03, 0.6, 0.35);
  },
  b_blackflame_leap: k => {
    k.whoosh(0, 0.5, 300, 2500, 0.7, 0.8);
    k.fire(0, 0.6, 0.45, 0.8);
  },
  b_volley: k => {
    for (let i = 0; i < 3; i++) k.fire(i * 0.09, 0.3, 0.3, 1.4);
    k.whoosh(0, 0.35, 600, 2200, 0.4);
  },
  b_fire_burst: k => {
    k.boom(0, 110, 40, 0.6, 0.8);
    k.fire(0, 0.8, 0.6, 1);
    k.debris(0.02, 0.4, 0.25);
  },
  b_flood: k => {
    k.fire(0, 1.6, 0.8, 0.8);
    k.rumble(0, 1.6, 0.5);
    k.splash(0.3, 1.0, 0.35, true);
  },
  b_blackflame_roar: k => {
    k.voice(0, 1.6, 105, 58, 'ah', 0.7, 1, 3);
    k.fire(0.1, 1.6, 0.55, 0.7);
    k.voice(0.2, 1.4, 311, 294, 'oo', 0.2, 0, 3, 25); // a thin, wrong choir behind him
  },
  // ---- footfalls
  // the Tollwarden: an iron-shod boot, his chains jingling
  b_step_armor: k => {
    k.boom(0, 70, 45, 0.28, 0.55);
    k.clang(0, rnd(380, 460), 0.25, 0.08);
    if (Math.random() < 0.5) k.chain(0.03, 0.12, 0.15);
  },
  // the Matron: a drowned thing dragging itself through water
  b_step_wet: k => {
    k.splash(0, 0.35, 0.3, true);
    if (Math.random() < 0.3) k.bubbles(0.1, 2, 0.2, true);
  },
  // Mother Tallow: an enormous weight coming down, wax squelching under it
  b_step_heavy: k => {
    k.boom(0, 60, 30, 0.45, 0.8);
    k.rumble(0, 0.4, 0.25);
    k.splash(0.02, 0.25, 0.18, true);
  },
  // Unrendered: bone on stone, quick and hard
  b_step_bone: k => {
    k.rattle(0, 0.06, 0.45);
    k.boom(0, 140, 90, 0.08, 0.25);
  },
  // the Chandler: robes brushing the floor, his snuffer's butt tapping the stone
  b_step_robe: k => {
    k.whoosh(0, 0.18, 500, 1400, 0.12, 0.4);
    k.boom(0, 110, 80, 0.12, 0.25);
    if (Math.random() < 0.5) k.clang(0.02, rnd(900, 1100), 0.15, 0.06);
  },
  // the Last Candle: a burning tread, the flame on him fluttering
  b_step_flame: k => {
    k.boom(0, 100, 60, 0.15, 0.4);
    k.fire(0, 0.25, 0.12, 0.8);
  },

  // ======================================================== regular enemies ("e_")
  // ---- Wickling: a scrawny candle-headed imp with a cleaver; squeaky, quick, burns out when it dies
  e_wick_chitter: k => k.voice(0, 0.25, rnd(560, 640), 720, 'eh', 0.22, 0.6),
  e_cleaver: k => {
    k.whoosh(0, 0.2, 500, 1800, 0.45, 0.5);
    k.clang(0.14, rnd(1100, 1300), 0.3, 0.1);
  },
  e_wick_swipe: k => k.whoosh(0, 0.16, 700, 2200, 0.35, 0.5),
  e_wick_shove: k => {
    k.voice(0, 0.15, 500, 420, 'uh', 0.18, 0.5);
    k.boom(0.05, 150, 100, 0.08, 0.25);
  },
  e_wick_alert: k => k.voice(0, 0.28, 480, 950, 'eh', 0.25, 0.4),
  e_wick_hurt: k => k.voice(0, 0.16, 900, 560, 'eh', 0.22, 0.5),
  e_wick_die: k => {
    k.voice(0, 0.45, 800, 300, 'eh', 0.22, 0.4);
    k.snuff(0.3, 0.35);
  },
  e_step_patter: k => k.boom(0, rnd(180, 220), 140, 0.05, 0.12),

  // ---- Taper Hound: a lean dog with a candle on its back; growls, snaps, yelps
  e_growl: k => k.voice(0, 0.45, 120, 110, 'uh', 0.35, 1),
  e_bite: k => {
    k.whoosh(0, 0.1, 800, 2400, 0.25, 0.4);
    k.clang(0.07, rnd(700, 850), 0.06, 0.12); // teeth
    k.pop(0.07, 400, 0.2);
  },
  e_lunge: k => {
    k.voice(0, 0.3, 170, 130, 'ah', 0.3, 1);
    k.whoosh(0.05, 0.3, 300, 1500, 0.4);
  },
  e_bark: k => {
    k.voice(0, 0.14, 380, 280, 'ah', 0.35, 0.6);
    k.voice(0.22, 0.14, 400, 290, 'ah', 0.35, 0.6);
  },
  e_yelp: k => k.voice(0, 0.18, 950, 650, 'eh', 0.3, 0.2),
  e_whine: k => {
    k.voice(0, 0.7, 760, 380, 'oo', 0.28, 0.15);
    k.snuff(0.5, 0.25);
  },
  e_step_paws: k => k.boom(0, rnd(230, 280), 180, 0.035, 0.08),

  // ---- Powder Acolyte: a robed monk lobbing firepots; chants, hisses a fuse
  e_acolyte_chant: k => k.voice(0, 0.4, 196, 185, 'oh', 0.25, 0.1, 2, 15),
  e_fuse: k => {
    k.sizzle(0, 0.5, 0.25);
    k.fire(0.1, 0.3, 0.12, 1.6);
  },
  e_lob: k => k.whoosh(0, 0.35, 400, 1500, 0.35, 0.4),
  e_firepot_blast: k => {
    k.glass(0, 0.5);
    k.boom(0, 120, 45, 0.5, 0.75);
    k.fire(0, 0.7, 0.45, 1.1);
  },
  e_shove: k => {
    k.voice(0, 0.15, 190, 160, 'uh', 0.25, 0.4);
    k.whoosh(0, 0.18, 400, 1200, 0.3);
    k.boom(0.08, 150, 100, 0.08, 0.2);
  },
  e_acolyte_alert: k => k.voice(0, 0.3, 230, 250, 'ah', 0.3, 0.3, 1, 10),
  e_acolyte_hurt: k => k.voice(0, 0.2, 210, 165, 'uh', 0.3, 0.5),
  e_acolyte_die: k => k.voice(0, 0.8, 190, 95, 'oh', 0.3, 0.3),
  e_step_sandal: k => k.whoosh(0, 0.07, 600, 1400, 0.07, 0.3),

  // ---- Belfry Brute: a hulking bell-ringer with a bell on a chain; slow, huge, grunting
  e_brute_heave: k => {
    k.voice(0, 0.5, 80, 110, 'ah', 0.45, 0.9);
    k.chain(0.05, 0.35, 0.3);
  },
  e_brute_slam: k => {
    k.clang(0, 210, 1.3, 0.5);
    k.bell(0, 147, 2.2, 0.4);
    k.boom(0, 80, 35, 0.7, 0.85);
    k.rumble(0.02, 1.0, 0.4);
    k.debris(0.04, 0.5, 0.3);
  },
  e_brute_whoosh: k => {
    k.whoosh(0, 0.4, 150, 800, 0.75);
    k.chain(0.15, 0.25, 0.2);
  },
  e_brute_grab: k => {
    k.voice(0, 0.3, 95, 80, 'uh', 0.4, 0.9);
    k.whoosh(0.05, 0.25, 250, 900, 0.4);
  },
  e_brute_roar: k => k.voice(0, 1.0, 92, 70, 'ah', 0.55, 1, 2),
  e_brute_hurt: k => k.voice(0, 0.25, 95, 80, 'uh', 0.4, 0.8),
  e_brute_die: k => {
    k.voice(0, 1.2, 90, 50, 'oh', 0.5, 0.9);
    k.boom(0.8, 70, 30, 0.7, 0.8); // he falls
    k.rumble(0.8, 0.8, 0.35);
    k.clang(0.85, 210, 1, 0.25);
  },
  e_step_brute: k => {
    k.boom(0, 58, 35, 0.35, 0.55);
    k.rumble(0, 0.3, 0.15);
  },

  // ---- Bulwark Warden: an armoured guard with a tower shield and spear
  e_armor_shift: k => {
    for (let i = 0; i < 3; i++) k.clang(i * 0.06, rnd(500, 800), 0.12, 0.1);
    k.voice(0.02, 0.2, 140, 125, 'uh', 0.2, 0.6);
  },
  e_shield_bash: k => {
    k.clang(0, 180, 0.7, 0.5);
    k.boom(0, 110, 60, 0.25, 0.6);
  },
  e_spear_thrust: k => {
    k.whoosh(0, 0.18, 500, 2000, 0.45, 0.4);
    k.slice(0.05, 0.12, 0.2);
  },
  e_spear_overhead: k => {
    k.whoosh(0, 0.35, 250, 1200, 0.6);
    k.clang(0.25, 650, 0.5, 0.15);
  },
  e_warden_alert: k => {
    k.voice(0, 0.35, 150, 165, 'ah', 0.35, 0.5);
    k.clang(0.05, 190, 0.5, 0.25); // spear on shield
  },
  e_warden_hurt: k => {
    k.voice(0, 0.2, 145, 120, 'uh', 0.3, 0.6);
    k.clang(0, rnd(500, 700), 0.2, 0.12);
  },
  e_warden_die: k => {
    k.voice(0, 0.7, 140, 85, 'oh', 0.35, 0.6);
    k.clang(0.45, 180, 0.9, 0.4); // the shield falls
    k.boom(0.45, 100, 50, 0.4, 0.5);
    for (let i = 0; i < 4; i++) k.clang(0.55 + i * 0.07, rnd(450, 900), 0.2, 0.12);
  },
  e_step_warden: k => {
    k.boom(0, 90, 60, 0.12, 0.3);
    k.clang(0, rnd(700, 900), 0.1, 0.05);
  },

  // ---- Drowned Pilgrim: a waterlogged corpse that claws and drags you under
  e_gurgle: k => {
    k.bubbles(0, 4, 0.3, true);
    k.voice(0, 0.4, 150, 140, 'oo', 0.2, 0.7);
  },
  e_wet_claw: k => {
    k.whoosh(0, 0.2, 400, 1400, 0.35, 0.5);
    k.splash(0.12, 0.25, 0.25);
  },
  e_drag: k => {
    k.splash(0, 0.5, 0.45, true);
    k.voice(0.05, 0.6, 160, 120, 'oh', 0.25, 0.5);
    k.bubbles(0.2, 5, 0.3, true);
  },
  e_drowned_moan: k => k.voice(0, 0.8, 185, 150, 'oh', 0.3, 0.4, 2, 15),
  e_drowned_hurt: k => {
    k.voice(0, 0.2, 170, 140, 'uh', 0.25, 0.6);
    k.bubbles(0.05, 2, 0.2, true);
  },
  e_drowned_die: k => {
    k.voice(0, 0.6, 170, 90, 'oo', 0.28, 0.5);
    k.splash(0.35, 0.6, 0.45, true);
    k.bubbles(0.5, 6, 0.3, true);
  },
  e_drowned_rise: k => {
    k.splash(0, 0.7, 0.6, true);
    k.bubbles(0, 6, 0.35, true);
    k.voice(0.3, 0.9, 150, 175, 'oh', 0.28, 0.6, 2, 12); // a long wet moan as it stands
  },
  e_step_drowned: k => k.splash(0, 0.2, 0.12, true),

  // ---- Renderer: a Works butcher in an apron with a hook on a chain
  e_hook_whirl: k => {
    for (let i = 0; i < 3; i++) k.whoosh(i * 0.16, 0.16, 400, 1300, 0.25, 0.5);
    k.chain(0, 0.45, 0.2);
  },
  e_hook_throw: k => {
    k.whoosh(0, 0.3, 500, 2000, 0.4, 0.4);
    k.chain(0.02, 0.4, 0.3);
  },
  e_butcher_grunt: k => k.voice(0, 0.22, 120, 100, 'uh', 0.3, 0.8),
  e_flense: k => {
    k.whoosh(0, 0.18, 500, 1800, 0.4, 0.5);
    k.slice(0.06, 0.14, 0.25);
  },
  e_butcher_alert: k => {
    k.voice(0, 0.3, 125, 140, 'ah', 0.35, 0.8);
    k.chain(0.1, 0.2, 0.2);
  },
  e_butcher_hurt: k => k.voice(0, 0.2, 125, 100, 'uh', 0.3, 0.8),
  e_butcher_die: k => {
    k.voice(0, 0.8, 120, 70, 'oh', 0.35, 0.8);
    k.clang(0.5, 900, 0.4, 0.2); // the hook clatters down
    k.chain(0.5, 0.3, 0.25);
  },
  e_step_boot: k => k.boom(0, rnd(95, 110), 70, 0.1, 0.22),

  // ---- the Works' wax things: Vat Crawler, Vat Spawn, Wax Slime
  e_blob_rise: k => {
    k.splash(0, 0.4, 0.25, true);
    k.bubbles(0.1, 5, 0.3, true);
    k.swell(0, 0.35, 90, 0.12);
  },
  e_engulf: k => {
    k.splash(0, 0.45, 0.5, true);
    k.boom(0, 120, 60, 0.2, 0.35);
    k.pop(0.25, 140, 0.3); // a gulp
  },
  e_blob_nip: k => {
    k.splash(0, 0.15, 0.2);
    k.pop(0.03, 380, 0.2);
  },
  e_sizzle_rise: k => {
    k.sizzle(0, 0.4, 0.25);
    k.bubbles(0.1, 3, 0.25);
  },
  e_scald: k => {
    k.splash(0, 0.25, 0.35);
    k.sizzle(0.05, 0.5, 0.3);
  },
  e_blob_gurgle: k => k.bubbles(0, 6, 0.35, true),
  e_blob_chirp: k => {
    k.bubbles(0, 3, 0.3);
    k.voice(0.05, 0.12, 700, 900, 'oo', 0.12);
  },
  e_blob_hurt: k => {
    k.splash(0, 0.18, 0.3);
    k.pop(0.02, 300, 0.2);
  },
  e_blob_die: k => {
    k.splash(0, 0.6, 0.5, true);
    k.bubbles(0.15, 6, 0.35, true);
    k.sizzle(0.2, 0.6, 0.15);
  },
  e_blob_pop: k => {
    k.pop(0, 260, 0.4);
    k.splash(0.02, 0.25, 0.25);
  },
  e_slime_die: k => {
    k.sizzle(0, 0.7, 0.3);
    k.splash(0, 0.35, 0.35);
  },
  e_step_slime: k => k.splash(0, 0.15, 0.1, true),

  // ---- Mire Lantern: a floating watch-lamp that rings out when it sees you
  e_lantern_alarm: k => {
    k.bell(0, 587, 1.4, 0.35);
    k.bell(0.18, 784, 1.2, 0.3);
    k.fire(0, 0.4, 0.2, 1.4);
  },
  e_lantern_hurt: k => k.clang(0, rnd(900, 1100), 0.4, 0.3),
  e_lantern_die: k => {
    k.glass(0, 0.5);
    k.snuff(0.1, 0.4);
  },

  // ======================================================== the player ("p_")
  // ---- bare hands
  p_punch: k => {
    k.whoosh(0, 0.1, 600, 1800, 0.3, 0.5);
    k.breath(0, 0.12, 0.08, false);
  },
  p_punch_heavy: k => {
    k.whoosh(0, 0.2, 350, 1300, 0.45);
    k.voice(0, 0.18, 150, 125, 'uh', 0.18, 0.5);
  },
  p_hit_blunt: k => {
    k.boom(0, 150, 70, 0.12, 0.6);
    k.pop(0, 220, 0.2);
  },
  p_draw_fists: k => k.whoosh(0, 0.15, 500, 1200, 0.15), // knuckles flexed, sleeves pushed back
  // ---- the Wick Knife: quick and thin
  p_dagger: k => {
    k.whoosh(0, 0.1, 900, 3000, 0.3, 0.5);
    k.slice(0.02, 0.08, 0.15);
  },
  p_dagger_heavy: k => {
    k.whoosh(0, 0.16, 600, 2600, 0.4, 0.5);
    k.slice(0.04, 0.1, 0.2);
  },
  p_hit_stab: k => {
    k.slice(0, 0.06, 0.3);
    k.boom(0, 170, 110, 0.07, 0.35);
    k.splash(0.02, 0.1, 0.12);
  },
  p_draw_blade_small: k => {
    k.slice(0, 0.18, 0.2);
    k.clang(0.16, 2400, 0.2, 0.05);
  },
  // ---- the straight sword: a clean whoosh with a ring of steel
  p_sword: k => {
    k.whoosh(0, 0.18, 450, 2000, 0.45, 0.5);
    k.clang(0.08, rnd(1500, 1700), 0.35, 0.04);
  },
  p_sword_heavy: k => {
    k.whoosh(0, 0.28, 300, 1700, 0.6, 0.55);
    k.clang(0.12, 1350, 0.5, 0.06);
    k.voice(0, 0.2, 145, 120, 'ah', 0.16, 0.5);
  },
  p_hit_blade: k => {
    k.slice(0, 0.08, 0.35);
    k.boom(0, 140, 80, 0.1, 0.5);
    k.splash(0.02, 0.12, 0.15);
  },
  p_draw_blade: k => {
    k.slice(0, 0.3, 0.25); // steel from the scabbard
    k.clang(0.28, 1800, 0.35, 0.08);
  },
  // ---- the Bellfounder's Axe: slow, heavy, it lands like a bell falling
  p_axe: k => {
    k.whoosh(0, 0.34, 150, 900, 0.75);
    k.voice(0.05, 0.22, 135, 110, 'uh', 0.18, 0.6);
  },
  p_axe_heavy: k => {
    k.whoosh(0, 0.45, 110, 700, 0.9);
    k.voice(0, 0.35, 140, 100, 'ah', 0.25, 0.8);
  },
  p_hit_axe: k => {
    k.boom(0, 95, 40, 0.3, 0.8);
    k.slice(0, 0.1, 0.3);
    k.clang(0, 420, 0.4, 0.12);
    k.debris(0.02, 0.2, 0.15);
  },
  p_draw_heavy: k => {
    k.whoosh(0, 0.3, 200, 800, 0.35);
    k.boom(0.25, 120, 80, 0.12, 0.3); // hefted onto the shoulder
  },
  // ---- guns and the crossbow
  p_revolver: k => {
    k.boom(0, 260, 90, 0.18, 0.8); // the crack
    k.pop(0, 900, 0.5);
    k.whoosh(0, 0.3, 2500, 6000, 0.35, 0.05); // the report ringing off
    k.clang(0.01, 3200, 0.15, 0.05);
  },
  p_flintlock: k => {
    k.clang(0, 2600, 0.05, 0.15); // the flint snaps
    k.sizzle(0.02, 0.1, 0.3); // the pan flashes
    k.boom(0.09, 180, 45, 0.6, 1); // then the charge goes
    k.whoosh(0.09, 0.6, 1500, 5000, 0.4, 0.05);
    k.rumble(0.1, 0.8, 0.3);
    k.breath(0.3, 0.6, 0.12, false); // smoke rolling off
  },
  p_crossbow: k => {
    k.boom(0, 110, 70, 0.15, 0.6); // the string slaps the stock
    k.clang(0, 520, 0.2, 0.15);
    k.whoosh(0.02, 0.25, 1200, 3500, 0.35, 0.2); // the bolt away
  },
  p_bash: k => {
    k.whoosh(0, 0.18, 400, 1400, 0.4);
    k.clang(0.12, 700, 0.15, 0.08);
  },
  p_hit_shot: k => {
    k.boom(0, 160, 70, 0.12, 0.55);
    k.pop(0, 500, 0.3);
    k.splash(0.01, 0.12, 0.12);
  },
  p_hit_bolt: k => {
    k.boom(0, 120, 70, 0.15, 0.55);
    k.slice(0, 0.05, 0.25);
    k.clang(0.02, 900, 0.1, 0.06); // the fletching thrums
  },
  p_draw_gun: k => {
    k.whoosh(0, 0.15, 500, 1300, 0.2);
    k.clang(0.12, 1900, 0.08, 0.15); // a click as it's checked
  },
  // reload steps
  p_cyl_open: k => k.clang(0, 1500, 0.1, 0.25),
  p_shell_out: k => {
    for (let i = 0; i < 4; i++) k.clang(i * 0.03, rnd(2600, 3400), 0.15, 0.08); // brass tinkling out
  },
  p_round_in: k => k.clang(0, rnd(2000, 2300), 0.06, 0.15),
  p_cyl_close: k => {
    k.clang(0, 1300, 0.12, 0.25);
    k.clang(0.06, 1900, 0.06, 0.15);
  },
  p_powder_pour: k => {
    const at = 0;
    k.whoosh(at, 0.5, 3000, 5000, 0.12, 0.3); // grains trickling
    k.pop(0.4, 700, 0.1);
  },
  p_ramrod: k => {
    k.slice(0, 0.18, 0.18); // steel down the barrel
    k.clang(0.16, 800, 0.08, 0.15);
  },
  p_cock: k => {
    k.clang(0, 1800, 0.05, 0.2);
    k.clang(0.08, 2400, 0.05, 0.2);
  },
  p_crank: k => {
    for (let i = 0; i < 4; i++) k.clang(i * 0.05, 2100 - i * 60, 0.05, 0.12); // the ratchet
    k.whoosh(0, 0.22, 300, 700, 0.15);
  },
  p_bolt_seat: k => {
    k.slice(0, 0.1, 0.12);
    k.boom(0.08, 200, 150, 0.06, 0.2);
  },
  p_latch: k => k.clang(0, 1600, 0.1, 0.25),
  // ---- a heavy drawn back, shields
  p_charge: k => {
    k.breath(0, 0.45, 0.14, true); // a breath in
    k.whoosh(0, 0.5, 150, 500, 0.15, 0.9); // the weapon drawn back
  },
  p_block_buckler: k => {
    k.clang(0, 300, 0.4, 0.4);
    k.boom(0, 120, 70, 0.15, 0.5);
    k.debris(0, 0.1, 0.1); // sparks
  },
  p_parry: k => {
    k.clang(0, 900, 0.9, 0.45); // the bright ring of a deflection
    k.clang(0.01, 1350, 0.7, 0.25);
    k.whoosh(0, 0.2, 1000, 3000, 0.3, 0.2);
  },
  // ---- the body
  p_hurt: k => {
    k.voice(0, 0.2, rnd(165, 185), 130, 'uh', 0.28, 0.6);
    k.breath(0.1, 0.2, 0.1, false);
  },
  p_die: k => {
    k.voice(0, 0.9, 160, 80, 'oh', 0.35, 0.6);
    k.boom(0.6, 110, 50, 0.4, 0.5); // you fall
    k.breath(0.7, 0.8, 0.12, false);
  },
  p_drink: k => {
    k.bubbles(0, 5, 0.25, true); // gulps
    k.breath(0.55, 0.45, 0.14, false); // a sigh
    k.swell(0.3, 0.5, 440, 0.06);
  },
  p_roll_light: k => {
    k.whoosh(0, 0.22, 500, 1500, 0.35); // cloth and air
    k.boom(0.12, 150, 110, 0.06, 0.2);
  },
  p_roll: k => {
    k.whoosh(0, 0.28, 350, 1200, 0.4);
    k.boom(0.14, 120, 80, 0.1, 0.35);
  },
  p_roll_heavy: k => {
    k.whoosh(0, 0.34, 250, 900, 0.4);
    k.boom(0.18, 95, 50, 0.2, 0.6); // armour hitting the floor
    k.chain(0.18, 0.15, 0.2);
  },
  p_roll_flop: k => {
    k.voice(0, 0.2, 150, 120, 'uh', 0.2, 0.6);
    k.boom(0.15, 80, 40, 0.3, 0.75); // a clumsy fall
    k.chain(0.15, 0.2, 0.25);
  },
  // ---- changing gear
  p_unequip: k => k.whoosh(0, 0.18, 400, 1000, 0.2),
  p_draw: k => {
    k.whoosh(0, 0.18, 500, 1400, 0.25);
    k.clang(0.14, 1500, 0.15, 0.05);
  },
  p_strap: k => {
    k.whoosh(0, 0.2, 700, 1500, 0.2); // leather pulled tight
    k.clang(0.18, 1200, 0.15, 0.12); // the buckle
  },
  p_armour_light: k => {
    k.whoosh(0, 0.3, 400, 1100, 0.25);
    k.breath(0.05, 0.3, 0.06, false);
  },
  p_armour_heavy: k => {
    k.chain(0, 0.4, 0.3);
    k.boom(0.3, 110, 80, 0.12, 0.3);
    k.clang(0.32, 900, 0.2, 0.1);
  },
  p_mail_jingle: k => k.chain(0, 0.08, 0.12),
  // consumables, rings, notes
  p_use: k => k.whoosh(0, 0.2, 500, 1200, 0.2),
  p_belt: k => {
    k.whoosh(0, 0.1, 900, 1800, 0.12); // a pouch flap
    k.clang(0.06, 2200, 0.06, 0.05);
  },
  p_throw: k => {
    k.whoosh(0, 0.28, 300, 1100, 0.45); // the arm
    k.fire(0.02, 0.35, 0.12, 1.2); // the lit rag
  },
  p_throw_knife: k => {
    k.whoosh(0, 0.16, 1200, 3200, 0.35);
    k.clang(0.01, 3400, 0.05, 0.04);
  },
  p_eat: k => {
    for (let i = 0; i < 3; i++) {
      k.debris(0.05 + i * 0.16, 0.08, 0.35); // crunch, crunch, crunch
      k.pop(0.05 + i * 0.16, 260, 0.12);
    }
    k.breath(0.55, 0.3, 0.12, false);
  },
  p_incense: k => {
    k.pop(0, 1800, 0.12); // the match
    k.fire(0.02, 0.25, 0.14, 1.4);
    k.breath(0.15, 1.0, 0.07, false); // smoke rising
    k.swell(0.2, 0.9, 587, 0.04);
  },
  p_cartridge: k => {
    k.slice(0, 0.06, 0.12); // bite the paper
    k.debris(0.12, 0.2, 0.1); // pour
    k.clang(0.38, 700, 0.12, 0.18); // ram
    k.clang(0.5, 1600, 0.1, 0.1); // click
  },
  p_oil: k => {
    k.splash(0, 0.25, 0.12);
    k.sizzle(0.15, 0.6, 0.18); // it bites the steel
    k.fire(0.2, 0.5, 0.1, 1.3);
  },
  p_smoke: k => {
    k.pop(0, 400, 0.25); // crushed underfoot
    k.whoosh(0.02, 0.9, 200, 700, 0.35, 0.3); // a billow of grey
    k.breath(0.1, 0.9, 0.08, false);
  },
  p_drink_grog: k => {
    k.bubbles(0, 6, 0.28, true);
    k.voice(0.6, 0.35, 150, 110, 'ah', 0.16, 0.8); // a hoarse "ahh"
  },
  p_candle: k => {
    k.snuff(0, 0.15);
    k.swell(0.05, 0.4, 880, 0.05);
    k.clang(0.1, 2600, 0.2, 0.05); // tallow dropped in the pouch as coin
  },
  // changing gear on the Equipment screen: the old thing off, the new one on, a clasp
  p_swap: k => {
    k.whoosh(0, 0.13, 1400, 600, 0.35, 0.4); // off
    k.whoosh(0.13, 0.15, 600, 1600, 0.4); // on
    k.boom(0.2, 170, 120, 0.06, 0.3); // it settles against you
    k.clang(0.27, 1900, 0.08, 0.14); // the clasp
  },
  p_ring: k => {
    k.clang(0, 2800, 0.35, 0.1);
    k.bell(0.02, 1760, 0.6, 0.04);
  },
  p_paper: k => {
    k.whoosh(0, 0.18, 1800, 4000, 0.12);
    k.whoosh(0.2, 0.14, 2200, 4500, 0.08);
  },
};
