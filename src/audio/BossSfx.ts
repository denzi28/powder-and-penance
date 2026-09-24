// Boss sound effects, synthesised in layers (the plain presets in data/audio/sfx.json are one voice each).
// Any effect id starting "b_" is one of these: a strike's `sfx` (the swing or impact), its `windupSfx`
// (the tell: a grunt, a chain, a breath), a boss's `roarSfx` / `slamSfx`, or a lob's landing `sfx`.
// They play into a stone-hall reverb, panned toward where the boss is.
import { DATA } from '../data/config';
import { hallImpulse } from './Music';
import type { Sfx } from './Sfx';
import type { BossSound } from '../data/schemas';

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

  static has(id: string): id is BossSound {
    return id in RECIPES;
  }

  /** @param pan -1 left .. 1 right */
  play(id: BossSound, volume = 1, pan = 0) {
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
const RECIPES: Record<BossSound, Recipe> = {
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
};
