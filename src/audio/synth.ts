/**
 * Procedural chiptune SFX: every sound is synthesized from oscillators + a shared white-noise buffer,
 * so the game ships no audio assets. Owner: Gaeta.
 *
 * Each recipe schedules nodes starting at `v.t0` into `v.out` and returns its length in seconds.
 * `v.pitch` multiplies every frequency (juice: per-slot / per-rank variation).
 */
import type { SfxId } from './types';

export interface Voice {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly t0: number;
  readonly pitch: number;
  readonly noise: AudioBuffer;
}

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic LCG noise: no Math.random needed and identical every run.
  let s = 0x2f6b1d;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 0xffffffff) * 2 - 1;
  }
  return buf;
}

interface ToneOpts {
  readonly type: OscillatorType;
  readonly f0: number;
  readonly f1?: number;
  readonly at?: number;
  readonly dur: number;
  readonly gain: number;
  readonly attack?: number;
  /** Glide curve for f0 -> f1. */
  readonly glide?: 'exp' | 'lin';
  readonly detune?: number;
}

/** One enveloped oscillator note. */
export function tone(v: Voice, o: ToneOpts): void {
  const { ctx } = v;
  const t = v.t0 + (o.at ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(Math.max(1, o.f0 * v.pitch), t);
  if (o.f1 !== undefined) {
    const f1 = Math.max(1, o.f1 * v.pitch);
    if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(f1, t + o.dur);
    else osc.frequency.exponentialRampToValueAtTime(f1, t + o.dur);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, o.dur));
  osc.connect(g).connect(v.out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

interface NoiseOpts {
  readonly at?: number;
  readonly dur: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  readonly f0: number;
  readonly f1?: number;
  readonly q?: number;
  readonly attack?: number;
}

/** A filtered noise burst (swish, snap, crunch, fizz). */
export function noise(v: Voice, o: NoiseOpts): void {
  const { ctx } = v;
  const t = v.t0 + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0 * v.pitch, t);
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * v.pitch), t + o.dur);
  const g = ctx.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, o.dur));
  src.connect(f).connect(g).connect(v.out);
  // Random-ish but deterministic offset into the loop so repeated hits don't sound identical.
  src.start(t, (t * 7.31) % 0.9);
  src.stop(t + o.dur + 0.02);
}

const N = (m: number): number => midiToHz(m);

export const SFX: Readonly<Record<SfxId, (v: Voice) => number>> = {
  deal: (v) => {
    noise(v, { dur: 0.07, gain: 0.35, filter: 'bandpass', f0: 2200, f1: 5200, q: 1.2 });
    tone(v, { type: 'square', f0: 950, f1: 700, at: 0.04, dur: 0.035, gain: 0.08 });
    return 0.09;
  },
  flip: (v) => {
    noise(v, { dur: 0.03, gain: 0.25, filter: 'highpass', f0: 4000 });
    tone(v, { type: 'square', f0: N(76), dur: 0.035, gain: 0.07 });
    tone(v, { type: 'square', f0: N(83), at: 0.035, dur: 0.05, gain: 0.07 });
    return 0.09;
  },
  hitLight: (v) => {
    // Slash: bright noise swipe + falling square zap.
    noise(v, { dur: 0.11, gain: 0.4, filter: 'bandpass', f0: 5200, f1: 1800, q: 2 });
    tone(v, { type: 'square', f0: 620, f1: 160, dur: 0.1, gain: 0.12 });
    return 0.12;
  },
  hitHeavy: (v) => {
    // Thump: sine kick + crunchy low square + dark noise.
    tone(v, { type: 'sine', f0: 170, f1: 42, dur: 0.24, gain: 0.7, attack: 0.002 });
    tone(v, { type: 'square', f0: 120, f1: 55, dur: 0.16, gain: 0.14 });
    noise(v, { dur: 0.16, gain: 0.45, filter: 'lowpass', f0: 1800, f1: 300 });
    return 0.26;
  },
  slay: (v) => {
    [81, 76, 72, 69, 64].forEach((m, i) => tone(v, { type: 'square', f0: N(m), at: i * 0.045, dur: 0.06, gain: 0.08 }));
    noise(v, { at: 0.02, dur: 0.18, gain: 0.18, filter: 'bandpass', f0: 1200, f1: 400, q: 0.8 });
    return 0.3;
  },
  equip: (v) => {
    // Metallic snap: rising zip into a detuned ring.
    tone(v, { type: 'triangle', f0: 440, f1: 1320, dur: 0.07, gain: 0.18 });
    tone(v, { type: 'square', f0: 1320, at: 0.07, dur: 0.28, gain: 0.06 });
    tone(v, { type: 'square', f0: 1985, at: 0.07, dur: 0.22, gain: 0.04, detune: 12 });
    noise(v, { at: 0.065, dur: 0.04, gain: 0.3, filter: 'highpass', f0: 6000 });
    return 0.36;
  },
  heal: (v) => {
    [72, 76, 79, 84].forEach((m, i) => tone(v, { type: 'triangle', f0: N(m), at: i * 0.06, dur: 0.14, gain: 0.22 }));
    tone(v, { type: 'sine', f0: N(96), at: 0.2, dur: 0.3, gain: 0.07 });
    tone(v, { type: 'sine', f0: N(100), at: 0.26, dur: 0.3, gain: 0.05 });
    return 0.56;
  },
  potionWasted: (v) => {
    noise(v, { dur: 0.38, gain: 0.3, filter: 'highpass', f0: 7000, f1: 900 });
    tone(v, { type: 'square', f0: 320, f1: 110, dur: 0.3, gain: 0.08, glide: 'lin' });
    tone(v, { type: 'square', f0: 300, f1: 100, at: 0.02, dur: 0.3, gain: 0.05, glide: 'lin', detune: 30 });
    return 0.4;
  },
  avoid: (v) => {
    noise(v, { dur: 0.16, gain: 0.35, filter: 'bandpass', f0: 400, f1: 2600, q: 1.5, attack: 0.05 });
    noise(v, { at: 0.16, dur: 0.16, gain: 0.25, filter: 'bandpass', f0: 2600, f1: 500, q: 1.5 });
    tone(v, { type: 'triangle', f0: 330, f1: 160, dur: 0.3, gain: 0.12 });
    return 0.34;
  },
  roomClear: (v) => {
    tone(v, { type: 'square', f0: N(79), dur: 0.07, gain: 0.07 });
    tone(v, { type: 'square', f0: N(84), at: 0.075, dur: 0.14, gain: 0.07 });
    return 0.22;
  },
  uiHover: (v) => {
    tone(v, { type: 'sine', f0: 1250, dur: 0.02, gain: 0.05 });
    return 0.03;
  },
  uiClick: (v) => {
    tone(v, { type: 'square', f0: 820, f1: 600, dur: 0.035, gain: 0.08 });
    return 0.04;
  },
  uiDenied: (v) => {
    tone(v, { type: 'square', f0: 185, dur: 0.06, gain: 0.1 });
    tone(v, { type: 'square', f0: 165, at: 0.08, dur: 0.09, gain: 0.1 });
    return 0.18;
  },
  win: (v) => {
    [72, 76, 79, 84].forEach((m, i) => tone(v, { type: 'square', f0: N(m), at: i * 0.09, dur: 0.1, gain: 0.08 }));
    tone(v, { type: 'square', f0: N(84), at: 0.38, dur: 0.7, gain: 0.07 });
    tone(v, { type: 'square', f0: N(88), at: 0.38, dur: 0.7, gain: 0.05 });
    tone(v, { type: 'square', f0: N(91), at: 0.38, dur: 0.7, gain: 0.04 });
    tone(v, { type: 'triangle', f0: N(48), at: 0.38, dur: 0.75, gain: 0.25 });
    return 1.12;
  },
  lose: (v) => {
    [67, 66, 65].forEach((m, i) => tone(v, { type: 'square', f0: N(m), at: i * 0.2, dur: 0.18, gain: 0.08 }));
    tone(v, { type: 'square', f0: N(64), f1: N(52), at: 0.6, dur: 0.9, gain: 0.08, glide: 'lin' });
    tone(v, { type: 'triangle', f0: N(40), at: 0.6, dur: 1.0, gain: 0.3 });
    noise(v, { dur: 0.5, gain: 0.3, filter: 'lowpass', f0: 600, f1: 80 });
    return 1.6;
  },
};
