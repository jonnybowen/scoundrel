/**
 * Generative looped chiptune music. Owner: Gaeta.
 *
 * A small look-ahead step sequencer (16th notes) schedules Web Audio notes slightly ahead of
 * `ctx.currentTime`, so timing is sample-accurate even though the scheduling timer is coarse.
 * Melodies come from a seeded PRNG: phrases repeat (A A B B) so it reads as a tune, and a new
 * phrase pair is generated every 8 bars so long sessions don't loop a short riff forever.
 */
import { midiToHz, noise, tone, type Voice } from './synth';
import type { MusicId } from './types';

interface Chord {
  /** Root as MIDI note (around octave 3). */
  readonly root: number;
  readonly tones: readonly number[];
}

interface Track {
  readonly bpm: number;
  readonly chords: readonly Chord[];
  /** Scale (semitones from tonic) and tonic MIDI for the lead line. */
  readonly scale: readonly number[];
  readonly tonic: number;
  readonly drums: boolean;
  /** Probability a lead note starts on an 8th. 0 = no lead. */
  readonly leadDensity: number;
  readonly arpWave: OscillatorType;
  /** Arp every N 16ths. */
  readonly arpEvery: number;
  readonly gain: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const min = (root: number): Chord => ({ root, tones: [0, 3, 7] });
const maj = (root: number): Chord => ({ root, tones: [0, 4, 7] });

export const TRACKS: Readonly<Record<MusicId, Track>> = {
  dungeon: {
    bpm: 98,
    chords: [min(57), maj(53), maj(55), maj(52)], // Am F G E
    scale: MINOR,
    tonic: 69,
    drums: true,
    leadDensity: 0.5,
    arpWave: 'square',
    arpEvery: 2,
    gain: 0.9,
  },
  title: {
    bpm: 82,
    chords: [min(50), maj(58), maj(48), maj(57)], // Dm Bb C A
    scale: MINOR,
    tonic: 62,
    drums: false,
    leadDensity: 0.35,
    arpWave: 'triangle',
    arpEvery: 1,
    gain: 0.8,
  },
  gameOver: {
    bpm: 62,
    chords: [min(57), min(50), maj(52), min(57)], // Am Dm E Am
    scale: MINOR,
    tonic: 69,
    drums: false,
    leadDensity: 0.2,
    arpWave: 'triangle',
    arpEvery: 2,
    gain: 0.7,
  },
};

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** One lead phrase = 2 bars x 8 eighth-notes; each entry is a MIDI note, or null for rest. */
function makePhrase(track: Track, seed: number): (number | null)[] {
  const rnd = lcg(seed);
  const out: (number | null)[] = [];
  let degree = 0;
  for (let i = 0; i < 16; i++) {
    const strong = i % 4 === 0;
    if (rnd() < (strong ? track.leadDensity + 0.25 : track.leadDensity)) {
      degree += Math.floor(rnd() * 5) - 2; // small steps read as melody
      degree = Math.max(-3, Math.min(9, degree));
      const oct = Math.floor(degree / 7);
      const idx = ((degree % 7) + 7) % 7;
      out.push(track.tonic + oct * 12 + (track.scale[idx] ?? 0));
    } else {
      out.push(null);
    }
  }
  // Phrase ends home on the tonic.
  out[12] = track.tonic;
  out[13] = null;
  return out;
}

export class Sequencer {
  readonly id: MusicId;
  private readonly track: Track;
  private readonly out: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private phrases: (number | null)[][] = [];
  private seed: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    id: MusicId,
    private readonly noiseBuf: AudioBuffer,
    seed = 1,
  ) {
    this.id = id;
    this.track = TRACKS[id];
    this.seed = seed;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  start(fadeMs: number): void {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(0.0001, now);
    this.out.gain.linearRampToValueAtTime(this.track.gain, now + Math.max(0.01, fadeMs / 1000));
    this.nextTime = now + 0.06;
    this.step = 0;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  /** Fade out then disconnect. Safe to call twice. */
  stop(fadeMs: number): void {
    const now = this.ctx.currentTime;
    const end = now + Math.max(0.01, fadeMs / 1000);
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), now);
      this.out.gain.linearRampToValueAtTime(0.0001, end);
    } catch {
      // context closed
    }
    const timer = this.timer;
    this.timer = null;
    setTimeout(
      () => {
        if (timer) clearInterval(timer);
        try {
          this.out.disconnect();
        } catch {
          // already disconnected
        }
      },
      fadeMs + 150,
    );
  }

  private tick(): void {
    const ctx = this.ctx;
    // After a suspend/resume the clock jumped: resync rather than burst-scheduling missed notes.
    if (this.nextTime < ctx.currentTime - 0.1) this.nextTime = ctx.currentTime + 0.05;
    const stepDur = 60 / this.track.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private phraseFor(bar: number): (number | null)[] {
    // 8-bar cycle A A B B: each 2-bar phrase plays twice; a fresh pair every cycle.
    const cycle = Math.floor(bar / 8);
    const which = Math.floor((bar % 8) / 4); // 0 = A, 1 = B
    const key = cycle * 2 + which;
    while (this.phrases.length <= key) this.phrases.push(makePhrase(this.track, this.seed * 7919 + this.phrases.length * 104729));
    return this.phrases[key]!;
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const tr = this.track;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const chord = tr.chords[bar % tr.chords.length]!;
    const v: Voice = { ctx: this.ctx, out: this.out, t0: t, pitch: 1, noise: this.noiseBuf };

    // Bass: root on beats, fifth on the "and" of 2 and 4.
    if (s % 4 === 0) tone(v, { type: 'triangle', f0: midiToHz(chord.root - 12), dur: stepDur * 2.5, gain: 0.32 });
    else if (s === 6 || s === 14) tone(v, { type: 'triangle', f0: midiToHz(chord.root - 5), dur: stepDur * 1.5, gain: 0.26 });

    // Arpeggio through chord tones, two octaves.
    if (s % tr.arpEvery === 0) {
      const k = s / tr.arpEvery;
      const tones = chord.tones;
      const n = tones[k % tones.length]! + (Math.floor(k / tones.length) % 2) * 12;
      tone(v, { type: tr.arpWave, f0: midiToHz(chord.root + 12 + n), dur: stepDur * 0.9, gain: tr.arpWave === 'square' ? 0.035 : 0.08 });
    }

    // Lead on 8ths from the current 2-bar phrase.
    if (tr.leadDensity > 0 && s % 2 === 0) {
      const phrase = this.phraseFor(bar);
      const idx = (bar % 2) * 8 + s / 2;
      const note = phrase[idx];
      if (note !== null && note !== undefined) {
        tone(v, { type: 'square', f0: midiToHz(note), dur: stepDur * 1.8, gain: 0.045, attack: 0.01 });
      }
    }

    if (tr.drums) {
      if (s === 0 || s === 8 || s === 10) tone(v, { type: 'sine', f0: 140, f1: 40, dur: 0.12, gain: 0.45, attack: 0.002 });
      if (s === 4 || s === 12) noise(v, { dur: 0.09, gain: 0.12, filter: 'bandpass', f0: 1800, q: 0.7 });
      if (s % 2 === 1) noise(v, { dur: 0.03, gain: s % 4 === 3 ? 0.05 : 0.03, filter: 'highpass', f0: 7000 });
    }
  }
}
