// Boss music (data/audio/music.json), synthesised with WebAudio like the rest of the sound.
// A theme is a chord progression with layered parts (drums, bass, pads, arpeggios, a melody), written as
// step patterns. Each layer comes in at an intensity level:
//   0 while the boss makes its entrance, 1 in the fight, 2 once the boss is below half health.
// Between phases (remains, the Chandler's turn) only the `hold` layers play. The next phase has its own
// theme. When the last phase falls, a closing chord rings out; if the player dies, the music fades.
import { DATA } from '../data/config';
import { harp } from './Ambient';
import type { Sfx } from './Sfx';
import type { MusicLayer, MusicTheme } from '../data/schemas';

export interface MusicState {
  /** The arena's boss (its first phase): its "boss:" flag means the fight was won. */
  arena: string;
  /** The phase being fought (picks the theme). */
  boss: string;
  /** 0 entrance, 1 fight, 2 desperate, -1 between phases. */
  level: number;
}

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class BossMusic {
  private ctx: BaseAudioContext | null = null;
  private bus: GainNode | null = null;
  private theme: MusicTheme | null = null;
  private themeId: string | null = null;
  private last: MusicState | null = null;
  private next = 0;
  private step = 0;
  private bar = 0;
  private barLevel = 0;
  /** Per-layer counters for arpeggios. */
  private arpI: number[] = [];

  constructor(private sfx: Sfx) {}

  private ready(): BaseAudioContext | null {
    const ctx = this.sfx.context;
    if (!ctx || (ctx.state !== 'running' && !(ctx instanceof OfflineAudioContext))) return null;
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      const comp = ctx.createDynamicsCompressor(); // keep the drums from clipping over the effects
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.bus.connect(comp).connect(ctx.destination);
    }
    return ctx;
  }

  /** Call every frame with the arena's state (null: no fight). */
  update(state: MusicState | null, won: (arena: string) => boolean) {
    const ctx = this.ready();
    if (!ctx || !this.bus) return;
    const now = ctx.currentTime;
    const vol = DATA.music.volume * DATA.audio.master;
    if (!state) {
      if (this.last) {
        // the fight is over: won, a closing chord; lost, a quick fade
        if (won(this.last.arena) && this.theme) this.stinger(ctx, now + 0.05);
        this.bus.gain.cancelScheduledValues(now);
        this.bus.gain.setTargetAtTime(0, now + (won(this.last.arena) ? 4 : 0), won(this.last.arena) ? 1.2 : 0.35);
        this.theme = null;
        this.themeId = null;
      }
      this.last = null;
      return;
    }
    const themeId = DATA.music.bosses[state.boss];
    if (!themeId) return;
    if (!this.last) {
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(vol, now, 0.4);
    }
    if (themeId !== this.themeId) {
      // a new fight or the next phase: start the theme from the top
      this.themeId = themeId;
      this.theme = DATA.music.themes[themeId];
      this.next = now + 0.1;
      this.step = 0;
      this.bar = 0;
      this.barLevel = state.level;
      this.arpI = this.theme.layers.map(() => 0);
    }
    this.last = state;
    const th = this.theme!;
    const stepDur = 60 / th.bpm / 4;
    while (this.next < now + 0.2) {
      if (this.step === 0) this.barLevel = state.level; // layers come and go on the bar
      this.playStep(ctx, th, this.next, stepDur);
      this.next += stepDur;
      if (++this.step >= th.steps) {
        this.step = 0;
        this.bar = (this.bar + 1) % th.chords.length;
      }
    }
  }

  stop() {
    if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this.theme = null;
    this.themeId = null;
    this.last = null;
  }

  /** The chord for a bar: its root (MIDI) and its three tones as semitones above the root. */
  private chord(th: MusicTheme, bar: number): { root: number; tones: number[] } {
    const scale = SCALES[th.scale];
    const c = th.chords[bar % th.chords.length];
    const deg = typeof c === 'number' ? c : parseInt(c, 10);
    const q = typeof c === 'string' ? c.replace(/^\d+/, '') : '';
    const at = (d: number) => scale[d % 7] + 12 * Math.floor(d / 7);
    const root = th.root + at(deg);
    let third = at(deg + 2) - at(deg);
    let fifth = at(deg + 4) - at(deg);
    if (q === 'M') (third = 4), (fifth = 7);
    if (q === 'm') (third = 3), (fifth = 7);
    return { root, tones: [0, third, fifth, at(deg + 6) - at(deg)] };
  }

  /** Scale degree (1-based, may run past 7; "+" raises it a semitone, "-" lowers it) to MIDI in the key. */
  private degree(th: MusicTheme, d: string): number {
    const scale = SCALES[th.scale];
    const n = parseInt(d, 10) - 1;
    const acc = d.endsWith('+') ? 1 : d.endsWith('-') ? -1 : 0;
    return th.root + scale[((n % 7) + 7) % 7] + 12 * Math.floor(n / 7) + acc;
  }

  private playStep(ctx: BaseAudioContext, th: MusicTheme, t: number, stepDur: number) {
    const ch = this.chord(th, this.bar);
    th.layers.forEach((L, li) => {
      if (this.barLevel < 0 ? !L.hold : this.barLevel < L.level) return;
      if (L.melody) {
        // a melody: this bar's line, "degree:steps" words
        const line = L.melody[this.bar % L.melody.length];
        let at = 0;
        for (const w of line.split(' ')) {
          const [d, len] = w.split(':');
          if (at === this.step && d !== 'r') this.note(ctx, L, t, this.degree(th, d) + 12 * (L.oct ?? 1), +len * stepDur);
          at += +len;
        }
        return;
      }
      const pat = L.pattern!;
      const c = pat[this.step % pat.length];
      if (c !== 'x' && c !== 'X') return;
      const accent = c === 'X' ? 1.3 : 1;
      const notes = L.notes ?? '1';
      const tone = (ch2: string) => ch.root + 12 * (L.oct ?? 0) + ({ '1': 0, '3': ch.tones[1], '5': ch.tones[2], '7': ch.tones[3], '8': 12 } as Record<string, number>)[ch2];
      const len = (L.len ?? 1) * stepDur;
      if (L.chord) for (const n of notes) this.note(ctx, L, t, tone(n), len, accent);
      else {
        const n = notes[this.arpI[li]++ % notes.length];
        this.note(ctx, L, t, tone(n), len, accent);
      }
    });
  }

  private note(ctx: BaseAudioContext, L: MusicLayer, t: number, midi: number, len: number, accent = 1) {
    const g = ctx.createGain();
    g.gain.value = (L.vol ?? 1) * accent;
    g.connect(this.bus!);
    INSTRUMENTS[L.inst](ctx, g, t + rnd(0, 0.006), midi, len);
  }

  /** The closing chord: the key's major chord (a hopeful end), rung on bell, pad and harp. */
  private stinger(ctx: BaseAudioContext, t: number) {
    const th = this.theme!;
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this.bus!);
    for (const iv of [0, 4, 7, 12]) {
      INSTRUMENTS.pad(ctx, g, t, th.root + iv, 4);
      harp(ctx, g, t + iv * 0.02, th.root + 12 + iv, 0.2);
    }
    INSTRUMENTS.bell(ctx, g, t, th.root + 12, 4);
  }
}

// ---------------------------------------------------------------- instruments
type Inst = (ctx: BaseAudioContext, out: AudioNode, t: number, midi: number, len: number) => void;

function env(ctx: BaseAudioContext, out: AudioNode, t: number, attack: number, hold: number, release: number, peak: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  g.connect(out);
  return { g, end: t + attack + hold + release + 0.05 };
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f: number, t: number, end: number, out: AudioNode, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  o.connect(out);
  o.start(t);
  o.stop(end);
  return o;
}

function lowpass(ctx: BaseAudioContext, f: number, out: AudioNode, q = 0.7) {
  const l = ctx.createBiquadFilter();
  l.type = 'lowpass';
  l.frequency.value = f;
  l.Q.value = q;
  l.connect(out);
  return l;
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext, t: number, end: number, out: AudioNode, type: BiquadFilterType, f: number, rate = 1) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  n.playbackRate.value = rate;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  n.connect(flt).connect(out);
  n.start(t, Math.random() * 0.5);
  n.stop(end);
}

const INSTRUMENTS: Record<MusicLayer['inst'], Inst> = {
  // a big low drum: a falling thump with a skin slap
  drum: (ctx, out, t) => {
    const e = env(ctx, out, t, 0.003, 0.02, 0.35, 0.9);
    const o = osc(ctx, 'sine', 95, t, e.end, e.g);
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const s = env(ctx, out, t, 0.001, 0, 0.06, 0.35);
    noise(ctx, t, s.end, s.g, 'lowpass', 900);
  },
  snare: (ctx, out, t) => {
    const s = env(ctx, out, t, 0.001, 0, 0.16, 0.45);
    noise(ctx, t, s.end, s.g, 'bandpass', 1800);
    const e = env(ctx, out, t, 0.001, 0, 0.08, 0.25);
    osc(ctx, 'triangle', 190, t, e.end, e.g);
  },
  hat: (ctx, out, t) => {
    const s = env(ctx, out, t, 0.001, 0, 0.045, 0.16);
    noise(ctx, t, s.end, s.g, 'highpass', 7000);
  },
  // hammer on an anvil, tuned
  anvil: (ctx, out, t, m) => {
    const f = hz(m);
    for (const [r, v, d] of [
      [1, 0.25, 0.6],
      [2.76, 0.14, 0.35],
      [5.4, 0.08, 0.2],
    ] as const) {
      const e = env(ctx, out, t, 0.001, 0, d, v);
      osc(ctx, 'triangle', f * r, t, e.end, e.g);
    }
    const s = env(ctx, out, t, 0.001, 0, 0.03, 0.3);
    noise(ctx, t, s.end, s.g, 'highpass', 3000);
  },
  // a church bell: inharmonic partials, a long hum
  bell: (ctx, out, t, m, len) => {
    const f = hz(m);
    for (const [r, v, d] of [
      [0.5, 0.12, 3],
      [1, 0.28, 2.5],
      [1.19, 0.13, 1.8],
      [1.5, 0.09, 1.5],
      [2, 0.1, 1.2],
      [2.74, 0.06, 0.8],
    ] as const) {
      const e = env(ctx, out, t, 0.002, 0, Math.max(d, len * 0.5), v);
      osc(ctx, 'sine', f * r, t, e.end, e.g);
    }
  },
  // a sawtooth bass under a low-pass, with a sine beneath it
  bass: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.005, Math.max(0, len - 0.08), 0.12, 0.32);
    osc(ctx, 'sawtooth', hz(m), t, e.end, lowpass(ctx, 380, e.g, 2));
    osc(ctx, 'sine', hz(m), t, e.end, e.g);
  },
  // strings / a soft pad: detuned saws, slow in and out
  pad: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, Math.min(0.5, len * 0.3), Math.max(0, len * 0.6), Math.max(0.4, len * 0.4), 0.09);
    const l = lowpass(ctx, 1300, e.g);
    for (const d of [-8, 0, 7]) osc(ctx, 'sawtooth', hz(m), t, e.end, l, d);
  },
  // voices: saws through two vowel formants
  choir: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, Math.min(0.6, len * 0.35), Math.max(0, len * 0.5), Math.max(0.5, len * 0.4), 0.3);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 650;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1080;
    f2.Q.value = 4;
    f1.connect(e.g);
    f2.connect(e.g);
    for (const d of [-7, 6]) {
      const o = osc(ctx, 'sawtooth', hz(m), t, e.end, f1, d);
      o.connect(f2);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vg = ctx.createGain();
      vg.gain.value = 5;
      vib.connect(vg).connect(o.detune);
      vib.start(t);
      vib.stop(e.end);
    }
  },
  // a pipe organ: stacked octaves, square and saw, steady
  organ: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.02, Math.max(0, len - 0.06), 0.1, 0.08);
    const l = lowpass(ctx, 2600, e.g);
    osc(ctx, 'square', hz(m), t, e.end, l);
    osc(ctx, 'sawtooth', hz(m) * 2, t, e.end, l, 3);
    osc(ctx, 'sine', hz(m) / 2, t, e.end, e.g);
  },
  // a singing lead: triangle and a little square, with vibrato that grows as the note holds
  lead: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.02, Math.max(0, len - 0.05), 0.15, 0.16);
    const l = lowpass(ctx, 2200, e.g);
    const a = osc(ctx, 'triangle', hz(m), t, e.end, l);
    const b = osc(ctx, 'square', hz(m), t, e.end, lowpass(ctx, 900, e.g));
    b.detune.value = 4;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(12, t + Math.min(0.6, len));
    vib.connect(vg);
    vg.connect(a.detune);
    vg.connect(b.detune);
    vib.start(t);
    vib.stop(e.end);
  },
  // a brassy horn: a saw that opens up as it's blown
  brass: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.04, Math.max(0, len - 0.08), 0.12, 0.14);
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.Q.value = 1.5;
    l.frequency.setValueAtTime(300, t);
    l.frequency.exponentialRampToValueAtTime(1800, t + 0.08);
    l.frequency.exponentialRampToValueAtTime(1100, t + 0.3);
    l.connect(e.g);
    osc(ctx, 'sawtooth', hz(m), t, e.end, l);
    osc(ctx, 'sawtooth', hz(m), t, e.end, l, 9);
  },
  // someone humming: a soft sine and triangle, a slow vibrato
  hum: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.06, Math.max(0, len - 0.1), 0.18, 0.2);
    const a = osc(ctx, 'sine', hz(m), t, e.end, e.g);
    const b = osc(ctx, 'triangle', hz(m), t, e.end, lowpass(ctx, 800, e.g));
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vg = ctx.createGain();
    vg.gain.value = 9;
    vib.connect(vg);
    vg.connect(a.detune);
    vg.connect(b.detune);
    vib.start(t);
    vib.stop(e.end);
  },
  // a music box: a thin tine with a glassy overtone
  musicbox: (ctx, out, t, m) => {
    const e = env(ctx, out, t, 0.002, 0, 1.1, 0.22);
    osc(ctx, 'sine', hz(m), t, e.end, e.g);
    const e2 = env(ctx, out, t, 0.002, 0, 0.3, 0.08);
    osc(ctx, 'sine', hz(m) * 4.02, t, e2.end, e2.g);
  },
  // a short plucked saw for fast arpeggios
  pluck: (ctx, out, t, m) => {
    const e = env(ctx, out, t, 0.002, 0, 0.18, 0.12);
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.frequency.setValueAtTime(3000, t);
    l.frequency.exponentialRampToValueAtTime(400, t + 0.18);
    l.connect(e.g);
    osc(ctx, 'sawtooth', hz(m), t, e.end, l);
  },
  harp: (ctx, out, t, m) => harp(ctx, out, t, m, 0.2),
};
