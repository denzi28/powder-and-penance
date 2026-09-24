// Placeholder sound: every effect is synthesised with WebAudio from a preset in data/audio/sfx.json
// (oscillator or noise -> optional low-pass sweep -> envelope). No audio files needed.
// For "noise" presets, `freq` is the noise playback rate (1 = white noise, lower = darker).
import { DATA } from '../data/config';

export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  get noiseBuffer() {
    return this.noise;
  }

  /** Browsers require a user gesture before audio can start. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(id: string, volume = 1, pitch = 1) {
    const ctx = this.ctx;
    const p = DATA.sfx.presets[id];
    if (!ctx || !p || ctx.state !== 'running') return;
    const vol = p.volume * volume * DATA.audio.master * DATA.audio.sfx;
    if (vol <= 0.001) return;
    const t0 = ctx.currentTime;
    const end = t0 + p.duration;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + p.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    let src: AudioScheduledSourceNode;
    if (p.wave === 'noise') {
      const b = ctx.createBufferSource();
      b.buffer = this.noise;
      b.loop = true;
      b.playbackRate.value = p.freq * pitch;
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = p.wave;
      o.frequency.setValueAtTime(p.freq * pitch, t0);
      if (p.freqEnd) o.frequency.exponentialRampToValueAtTime(p.freqEnd * pitch, end);
      src = o;
    }

    let node: AudioNode = src;
    if (p.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(p.filter, t0);
      if (p.filterEnd) f.frequency.exponentialRampToValueAtTime(p.filterEnd, end);
      node.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
    src.stop(end + 0.02);
  }
}
