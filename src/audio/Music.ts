// Boss music (data/audio/music.json), synthesised with WebAudio: a small orchestra in a stone hall.
// A theme is a chord progression with layered parts (percussion, low strings, string ostinatos, choir,
// brass, organ, bells...) written as step patterns, plus melodies. Every section is several detuned voices
// spread across the stereo field, and everything plays into a long cathedral reverb.
// Each layer comes in at an intensity level:
//   0 while the boss makes its entrance, 1 in the fight, 2 once the boss is below half health.
// Between phases (remains, the Chandler's turn) only the `hold` layers play. The next phase has its own
// theme. When the last phase falls, a full major chord rings out; if the player dies, the music fades.
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

/** A chord-tone token: "1" root, "3" third, "5" fifth, "7" seventh, "8" octave; each ' is an octave up, each , down. */
export function parseTones(notes: string): { tone: string; oct: number }[] {
  const words = /[ ',]/.test(notes) ? notes.split(' ').filter(Boolean) : [...notes];
  return words.map(w => ({ tone: w[0], oct: (w.match(/'/g)?.length ?? 0) - (w.match(/,/g)?.length ?? 0) }));
}

/** Instruments' own reverb sends (a layer's `rev` overrides). */
const REVERB: Record<MusicLayer['inst'], number> = {
  drum: 0.45,
  timpani: 0.55,
  snare: 0.3,
  hat: 0.2,
  cymbal: 0.6,
  anvil: 0.35,
  bell: 0.7,
  bass: 0.12,
  pad: 0.5,
  strings: 0.5,
  spiccato: 0.3,
  choir: 0.75,
  organ: 0.65,
  lead: 0.4,
  brass: 0.35,
  horn: 0.45,
  hum: 0.45,
  musicbox: 0.6,
  celesta: 0.65,
  pluck: 0.3,
  harp: 0.55,
};

export class BossMusic {
  private ctx: BaseAudioContext | null = null;
  private bus: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
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
      // notes -> dry + reverb send -> bus (fades) -> compressor -> out
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 3;
      comp.attack.value = 0.01;
      comp.release.value = 0.25;
      this.bus.connect(comp).connect(ctx.destination);
      this.dry = ctx.createGain();
      this.dry.connect(this.bus);
      this.wet = ctx.createGain();
      const verb = ctx.createConvolver();
      verb.buffer = hallImpulse(ctx, 3.6);
      const tone = ctx.createBiquadFilter(); // stone eats the highs
      tone.type = 'lowpass';
      tone.frequency.value = 5200;
      const ret = ctx.createGain();
      ret.gain.value = 0.9;
      this.wet.connect(verb).connect(tone).connect(ret).connect(this.bus);
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
        const win = won(this.last.arena) && !!this.theme;
        if (win) this.stinger(ctx, now + 0.05);
        this.bus.gain.cancelScheduledValues(now);
        this.bus.gain.setTargetAtTime(0, now + (win ? 5 : 0), win ? 1.5 : 0.35);
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
    while (this.next < now + 0.25) {
      if (this.step === 0) this.barLevel = state.level; // layers come and go on the bar
      this.playStep(ctx, th, this.next, stepDur);
      this.next += stepDur;
      if (++this.step >= th.steps) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  stop() {
    if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this.theme = null;
    this.themeId = null;
    this.last = null;
  }

  /** The chord for a bar: its root (MIDI) and its tones as semitones above the root. */
  private chord(th: MusicTheme, bar: number): { root: number; tones: Record<string, number> } {
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
    return { root, tones: { '1': 0, '3': third, '5': fifth, '7': at(deg + 6) - at(deg), '8': 12 } };
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
    const barInLoop = this.bar % th.chords.length;
    th.layers.forEach((L, li) => {
      if (this.barLevel < 0 ? !L.hold : this.barLevel < L.level) return;
      if (this.bar % L.every !== 0) return;
      if (L.melody) {
        // a melody: this bar's line, "degree:steps" words
        const line = L.melody[barInLoop % L.melody.length];
        let at = 0;
        for (const w of line.split(' ')) {
          const [d, len] = w.split(':');
          if (at === this.step && d !== 'r') this.note(ctx, L, t, this.degree(th, d) + 12 * (L.oct ?? 1), +len * stepDur, 1);
          at += +len;
        }
        return;
      }
      const pat = L.pattern!;
      const c = pat[this.step % pat.length];
      if (c !== 'x' && c !== 'X') return;
      const accent = c === 'X' ? 1.35 : 1;
      const tones = parseTones(L.notes ?? '1');
      const midi = (w: { tone: string; oct: number }) => ch.root + 12 * ((L.oct ?? 0) + w.oct) + ch.tones[w.tone];
      const len = (L.len ?? 1) * stepDur;
      if (L.chord) for (const w of tones) this.note(ctx, L, t, midi(w), len, accent);
      else this.note(ctx, L, t, midi(tones[this.arpI[li]++ % tones.length]), len, accent);
    });
  }

  private note(ctx: BaseAudioContext, L: MusicLayer, t: number, midi: number, len: number, accent: number) {
    const g = ctx.createGain();
    g.gain.value = (L.vol ?? 1) * accent * rnd(0.9, 1.05);
    let out: AudioNode = g;
    if (L.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = L.pan;
      g.connect(p);
      out = p;
    }
    out.connect(this.dry!);
    const send = ctx.createGain();
    send.gain.value = L.rev ?? REVERB[L.inst];
    out.connect(send).connect(this.wet!);
    INSTRUMENTS[L.inst](ctx, g, t + rnd(0, 0.008), midi, len);
  }

  /** The closing chord: the key's major chord across the whole orchestra, a cymbal and a timpani roll under it. */
  private stinger(ctx: BaseAudioContext, t: number) {
    const th = this.theme!;
    const out = ctx.createGain();
    out.connect(this.dry!);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    out.connect(send).connect(this.wet!);
    const r = th.root;
    for (const iv of [-12, 0, 7, 12, 16]) INSTRUMENTS.strings(ctx, out, t, r + iv, 4.5);
    for (const iv of [12, 16, 19, 24]) INSTRUMENTS.choir(ctx, out, t + 0.05, r + iv, 4.5);
    for (const iv of [0, 4, 7]) INSTRUMENTS.horn(ctx, out, t, r + iv, 3.5);
    INSTRUMENTS.bell(ctx, out, t, r + 12, 5);
    INSTRUMENTS.cymbal(ctx, out, t, r, 0);
    for (let i = 0; i < 10; i++) INSTRUMENTS.timpani(ctx, out, t - 0.9 + i * 0.09, r - 12, 0); // roll into it
    INSTRUMENTS.timpani(ctx, out, t, r - 12, 0);
    for (const iv of [0, 7, 12, 16, 19, 24]) harp(ctx, out, t + 0.1 + iv * 0.012, r + 12 + iv, 0.15);
  }
}

// ---------------------------------------------------------------- the hall
/** A synthetic impulse response: early reflections, then a dense stereo tail that darkens as it fades. */
function hallImpulse(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * secs);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const k = Math.min(0.95, 0.15 + t * 0.35); // the tail loses its brightness
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - i / len, 2.2) * (t < 0.02 ? t / 0.02 : 1) * 2.2;
    }
    for (const [ms, a] of [
      [11, 0.5],
      [23, 0.35],
      [37, 0.28],
      [53, 0.2],
    ])
      d[Math.floor(((ms + ch * 3) / 1000) * rate)] += a;
  }
  return buf;
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

function filter(ctx: BaseAudioContext, type: BiquadFilterType, f: number, out: AudioNode, q = 0.7, gain = 1) {
  const l = ctx.createBiquadFilter();
  l.type = type;
  l.frequency.value = f;
  l.Q.value = q;
  if (gain !== 1) {
    const g = ctx.createGain();
    g.gain.value = gain;
    l.connect(g).connect(out);
  } else l.connect(out);
  return l;
}

function panned(ctx: BaseAudioContext, pan: number, out: AudioNode) {
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(out);
  return p;
}

/** A slow vibrato on these oscillators, fading in after `delay`. */
function vibrato(ctx: BaseAudioContext, oscs: OscillatorNode[], t: number, end: number, rate: number, cents: number, delay = 0.25) {
  const v = ctx.createOscillator();
  v.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(cents, t + delay);
  v.connect(g);
  for (const o of oscs) g.connect(o.detune);
  v.start(t);
  v.stop(end);
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext, t: number, end: number, out: AudioNode, type: BiquadFilterType, f: number, rate = 1) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  n.playbackRate.value = rate;
  n.connect(filter(ctx, type, f, out));
  n.start(t, Math.random() * 1.5);
  n.stop(end);
}

/** A section: `n` detuned sawtooth voices spread across the stereo field, into `out`. */
function section(ctx: BaseAudioContext, f: number, t: number, end: number, out: AudioNode, n: number, spreadCents: number, width: number, type: OscillatorType = 'sawtooth') {
  const oscs: OscillatorNode[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. 0.5
    oscs.push(osc(ctx, type, f, t, end, panned(ctx, k * 2 * width, out), k * 2 * spreadCents + rnd(-2, 2)));
  }
  return oscs;
}

const INSTRUMENTS: Record<MusicLayer['inst'], Inst> = {
  // taiko: a huge low boom and the slap of the skin
  drum: (ctx, out, t) => {
    const e = env(ctx, out, t, 0.002, 0.03, 0.7, 0.7);
    const o = osc(ctx, 'sine', 78, t, e.end, e.g);
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    const e2 = env(ctx, out, t, 0.002, 0, 0.25, 0.35);
    osc(ctx, 'triangle', 140, t, e2.end, e2.g).frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const s = env(ctx, out, t, 0.001, 0, 0.09, 0.5);
    noise(ctx, t, s.end, s.g, 'lowpass', 700);
  },
  // timpani: pitched, a round boom that rings
  timpani: (ctx, out, t, m) => {
    const f = hz(m);
    const e = env(ctx, out, t, 0.004, 0, 1.3, 0.5);
    const o = osc(ctx, 'sine', f * 1.03, t, e.end, e.g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const e2 = env(ctx, out, t, 0.004, 0, 0.6, 0.22);
    osc(ctx, 'sine', f * 1.5, t, e2.end, e2.g);
    const e3 = env(ctx, out, t, 0.004, 0, 0.35, 0.12);
    osc(ctx, 'sine', f * 1.99, t, e3.end, e3.g);
    const s = env(ctx, out, t, 0.001, 0, 0.07, 0.35);
    noise(ctx, t, s.end, s.g, 'lowpass', 400);
  },
  // a snare, dry and tight (the hall adds the rest)
  snare: (ctx, out, t) => {
    const s = env(ctx, out, t, 0.001, 0, 0.18, 0.5);
    noise(ctx, t, s.end, s.g, 'bandpass', 2200);
    const e = env(ctx, out, t, 0.001, 0, 0.09, 0.3);
    osc(ctx, 'triangle', 200, t, e.end, e.g);
  },
  hat: (ctx, out, t) => {
    const s = env(ctx, out, t, 0.001, 0, 0.05, 0.14);
    noise(ctx, t, s.end, s.g, 'highpass', 7500);
  },
  // a cymbal: struck (len 0-1 steps), or swelling up into the beat over `len`
  cymbal: (ctx, out, t, _m, len) => {
    const swell = len > 0.3;
    const e = swell ? env(ctx, out, t, len, 0, 0.4, 0.35) : env(ctx, out, t, 0.002, 0, 2.8, 0.4);
    noise(ctx, t, e.end, panned(ctx, -0.3, e.g), 'highpass', 5500);
    noise(ctx, t, e.end, panned(ctx, 0.3, e.g), 'bandpass', 9000, 1.1);
  },
  // hammer on an anvil, tuned
  anvil: (ctx, out, t, m) => {
    const f = hz(m);
    for (const [r, v, d] of [
      [1, 0.22, 0.7],
      [2.76, 0.13, 0.4],
      [5.4, 0.07, 0.22],
    ] as const) {
      const e = env(ctx, out, t, 0.001, 0, d, v);
      osc(ctx, 'triangle', f * r, t, e.end, e.g);
    }
    const s = env(ctx, out, t, 0.001, 0, 0.03, 0.3);
    noise(ctx, t, s.end, s.g, 'highpass', 3000);
  },
  // a great bell: inharmonic partials, a long hum
  bell: (ctx, out, t, m, len) => {
    const f = hz(m);
    for (const [r, v, d] of [
      [0.5, 0.14, 4],
      [1, 0.3, 3.2],
      [1.19, 0.14, 2.2],
      [1.5, 0.1, 1.8],
      [2, 0.11, 1.4],
      [2.74, 0.06, 0.9],
      [3.76, 0.04, 0.6],
    ] as const) {
      const e = env(ctx, out, t, 0.002, 0, Math.max(d, len * 0.6), v);
      osc(ctx, 'sine', f * r, t, e.end, e.g);
    }
  },
  // low strings and a sub under them
  bass: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.03, Math.max(0, len - 0.1), 0.25, 0.22);
    const l = filter(ctx, 'lowpass', 520, e.g, 1.2);
    section(ctx, hz(m), t, e.end, l, 3, 10, 0.3);
    osc(ctx, 'sine', hz(m), t, e.end, e.g);
  },
  // a soft string pad
  pad: (ctx, out, t, m, len) => INSTRUMENTS.strings(ctx, out, t, m, len),
  // the string section: six bows, detuned and spread, swelling in and breathing out
  strings: (ctx, out, t, m, len) => {
    const attack = Math.min(0.35, Math.max(0.08, len * 0.25));
    const e = env(ctx, out, t, attack, Math.max(0, len - attack), 0.7, 0.07);
    const l = filter(ctx, 'lowpass', Math.min(3200, 900 + hz(m) * 3), e.g, 0.5);
    const hp = filter(ctx, 'highpass', 90, l);
    vibrato(ctx, section(ctx, hz(m), t, e.end, hp, 6, 14, 0.7), t, e.end, 5.2, 7, 0.3);
  },
  // spiccato: short bouncing bows for driving ostinatos
  spiccato: (ctx, out, t, m) => {
    const e = env(ctx, out, t, 0.004, 0.02, 0.13, 0.13);
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.frequency.setValueAtTime(3400, t);
    l.frequency.exponentialRampToValueAtTime(900, t + 0.15);
    l.connect(e.g);
    section(ctx, hz(m), t, e.end, l, 3, 9, 0.5);
  },
  // the choir: "aah" voices through vowel formants, each with its own vibrato, spread wide
  choir: (ctx, out, t, m, len) => {
    const attack = Math.min(0.5, Math.max(0.12, len * 0.3));
    const e = env(ctx, out, t, attack, Math.max(0, len - attack), 0.9, 0.5);
    const lp = filter(ctx, 'lowpass', 3800, e.g);
    const f1 = filter(ctx, 'bandpass', 780, lp, 5, 1);
    const f2 = filter(ctx, 'bandpass', 1150, lp, 6, 0.55);
    const f3 = filter(ctx, 'bandpass', 2800, lp, 9, 0.22);
    const mix = ctx.createGain();
    mix.connect(f1);
    mix.connect(f2);
    mix.connect(f3);
    for (let i = 0; i < 4; i++) {
      const p = panned(ctx, (i / 3 - 0.5) * 1.4, mix);
      const o = osc(ctx, 'sawtooth', hz(m), t, e.end, p, (i - 1.5) * 7);
      vibrato(ctx, [o], t, e.end, 4.8 + i * 0.35, 9, 0.4);
    }
    // breath
    const b = env(ctx, e.g, t, attack, Math.max(0, len - attack), 0.5, 0.02);
    noise(ctx, t, b.end, b.g, 'bandpass', 1200);
  },
  // a pipe organ: 8', 4' and 2' ranks and a 16' under them, stereo
  organ: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.03, Math.max(0, len - 0.06), 0.25, 0.06);
    const l = filter(ctx, 'lowpass', 3000, e.g);
    const f = hz(m);
    osc(ctx, 'square', f, t, e.end, panned(ctx, -0.2, l), -3);
    osc(ctx, 'square', f, t, e.end, panned(ctx, 0.2, l), 3);
    osc(ctx, 'sine', f * 2, t, e.end, l);
    osc(ctx, 'sine', f * 4, t, e.end, panned(ctx, 0.4, l)).detune.value = 2;
    osc(ctx, 'sine', f / 2, t, e.end, e.g);
  },
  // a singing solo line
  lead: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.04, Math.max(0, len - 0.05), 0.35, 0.14);
    const l = filter(ctx, 'lowpass', 2400, e.g);
    vibrato(ctx, [osc(ctx, 'triangle', hz(m), t, e.end, l), osc(ctx, 'sawtooth', hz(m), t, e.end, filter(ctx, 'lowpass', 1200, e.g, 0.7, 0.4), 4)], t, e.end, 5.5, 12, 0.35);
  },
  // the brass section: bright, blown open, three players
  brass: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.05, Math.max(0, len - 0.08), 0.3, 0.09);
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.Q.value = 1.4;
    l.frequency.setValueAtTime(350, t);
    l.frequency.exponentialRampToValueAtTime(2600, t + 0.09);
    l.frequency.exponentialRampToValueAtTime(1700, t + 0.4);
    l.connect(e.g);
    vibrato(ctx, section(ctx, hz(m), t, e.end, l, 3, 8, 0.4), t, e.end, 5, 6, 0.5);
  },
  // French horns: warm and noble, the heroic voice
  horn: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.08, Math.max(0, len - 0.1), 0.45, 0.13);
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.Q.value = 0.9;
    l.frequency.setValueAtTime(300, t);
    l.frequency.exponentialRampToValueAtTime(1300, t + 0.15);
    l.frequency.exponentialRampToValueAtTime(1000, t + 0.6);
    l.connect(e.g);
    const oscs = section(ctx, hz(m), t, e.end, l, 3, 7, 0.35);
    oscs.push(osc(ctx, 'triangle', hz(m), t, e.end, e.g));
    vibrato(ctx, oscs, t, e.end, 4.8, 5, 0.6);
  },
  // someone humming: a soft sine and triangle, a slow vibrato
  hum: (ctx, out, t, m, len) => {
    const e = env(ctx, out, t, 0.08, Math.max(0, len - 0.1), 0.3, 0.2);
    vibrato(ctx, [osc(ctx, 'sine', hz(m), t, e.end, e.g), osc(ctx, 'triangle', hz(m), t, e.end, filter(ctx, 'lowpass', 900, e.g))], t, e.end, 4.6, 10, 0.3);
  },
  // a music box: a thin tine with a glassy overtone
  musicbox: (ctx, out, t, m) => {
    const e = env(ctx, out, t, 0.002, 0, 1.4, 0.2);
    osc(ctx, 'sine', hz(m), t, e.end, e.g);
    const e2 = env(ctx, out, t, 0.002, 0, 0.4, 0.07);
    osc(ctx, 'sine', hz(m) * 4.02, t, e2.end, e2.g);
  },
  // celesta: bright, bell-like sparkle, the angelic top
  celesta: (ctx, out, t, m) => {
    const f = hz(m);
    const e = env(ctx, out, t, 0.002, 0, 1.8, 0.18);
    osc(ctx, 'sine', f, t, e.end, panned(ctx, rnd(-0.3, 0.3), e.g));
    const e2 = env(ctx, out, t, 0.002, 0, 0.7, 0.07);
    osc(ctx, 'sine', f * 3, t, e2.end, e2.g);
    const e3 = env(ctx, out, t, 0.002, 0, 0.25, 0.04);
    osc(ctx, 'sine', f * 5.98, t, e3.end, e3.g);
  },
  // a short plucked string
  pluck: (ctx, out, t, m) => {
    const e = env(ctx, out, t, 0.002, 0, 0.2, 0.1);
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.frequency.setValueAtTime(3000, t);
    l.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    l.connect(e.g);
    osc(ctx, 'sawtooth', hz(m), t, e.end, l);
  },
  harp: (ctx, out, t, m) => harp(ctx, out, t, m, 0.22),
};
