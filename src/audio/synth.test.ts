/**
 * Synth voice tests with a recording fake BaseAudioContext (Node has no Web Audio). Each voice's schedule is
 * captured as plain data so we can check determinism and the shape of the tutorial voices.
 */
import { describe, expect, it } from 'vitest';
import { SFX, type Voice } from './synth';
import { createAudioEngine, type SfxId, type TutorialSfxId } from './types';

interface Note {
  kind: 'osc' | 'noise';
  type?: string;
  start: number;
  freq: number;
  peak: number;
}

function fakeVoice(pitch = 1): { v: Voice; notes: Note[]; log: string[] } {
  const notes: Note[] = [];
  const log: string[] = [];
  const param = (onSet: (val: number, t: number) => void = () => undefined) => ({
    value: 0,
    setValueAtTime(val: number, t: number) {
      log.push(`set ${val.toFixed(4)} @${t.toFixed(4)}`);
      onSet(val, t);
      return this;
    },
    linearRampToValueAtTime(val: number, t: number) {
      log.push(`lin ${val.toFixed(4)} @${t.toFixed(4)}`);
      onSet(val, t);
      return this;
    },
    exponentialRampToValueAtTime(val: number, t: number) {
      log.push(`exp ${val.toFixed(4)} @${t.toFixed(4)}`);
      return this;
    },
  });
  const node = () => ({
    connect(n: unknown) {
      return n;
    },
  });
  let currentNote: Note | null = null;
  const ctx = {
    sampleRate: 8000,
    createOscillator() {
      const n: Note = { kind: 'osc', start: 0, freq: 0, peak: 0 };
      notes.push(n);
      currentNote = n;
      const o = {
        ...node(),
        set type(t: string) {
          n.type = t;
        },
        frequency: param((val) => {
          if (n.freq === 0) n.freq = val;
        }),
        detune: param(),
        start(t: number) {
          n.start = t;
        },
        stop() {},
      };
      return o;
    },
    createBufferSource() {
      const n: Note = { kind: 'noise', start: 0, freq: 0, peak: 0 };
      notes.push(n);
      currentNote = n;
      return { ...node(), buffer: null, loop: false, start: (t: number) => (n.start = t), stop() {} };
    },
    createBiquadFilter() {
      return { ...node(), type: 'lowpass', Q: { value: 1 }, frequency: param() };
    },
    createGain() {
      const owner = currentNote;
      return {
        ...node(),
        gain: param((val) => {
          if (owner && val > owner.peak) owner.peak = val;
        }),
      };
    },
  };
  const v: Voice = {
    ctx: ctx as unknown as BaseAudioContext,
    out: node() as unknown as AudioNode,
    t0: 1,
    pitch,
    noise: {} as AudioBuffer,
  };
  return { v, notes, log };
}

function render(id: SfxId, pitch = 1) {
  const f = fakeVoice(pitch);
  const len = SFX[id](f.v);
  return { len, notes: f.notes, log: f.log };
}

const TUTORIAL: TutorialSfxId[] = ['coachBlip', 'stepSuccess', 'tutorialComplete'];
const LEGACY: SfxId[] = [
  'deal', 'flip', 'hitLight', 'hitHeavy', 'slay', 'equip', 'heal', 'potionWasted',
  'avoid', 'roomClear', 'uiHover', 'uiClick', 'uiDenied', 'win', 'lose',
];

describe('SFX table', () => {
  it('has a voice for every legacy id and every tutorial id (merged into SfxId)', () => {
    for (const id of [...LEGACY, ...TUTORIAL]) expect(typeof SFX[id]).toBe('function');
    expect(Object.keys(SFX).sort()).toEqual([...LEGACY, ...TUTORIAL].sort());
  });

  it('every voice is deterministic and returns a positive length covering its notes', () => {
    for (const id of [...LEGACY, ...TUTORIAL]) {
      const a = render(id);
      const b = render(id);
      expect(a.log).toEqual(b.log);
      expect(a.len).toBeGreaterThan(0);
      for (const n of a.notes) expect(n.start - 1).toBeLessThan(a.len);
    }
  });
});

describe('tutorial voices', () => {
  it('coachBlip is soft and short: peak under uiClick, two pitches, rising', () => {
    const blip = render('coachBlip');
    const click = render('uiClick');
    const peak = (ns: Note[]) => Math.max(...ns.map((n) => n.peak));
    expect(peak(blip.notes)).toBeLessThan(peak(click.notes));
    expect(blip.len).toBeLessThanOrEqual(0.15);
    expect(blip.notes.every((n) => n.kind === 'osc' && n.type !== 'square')).toBe(true);
    const pitches = [...new Set(blip.notes.map((n) => n.freq))];
    expect(pitches.length).toBe(2);
    expect(pitches[1]).toBeGreaterThan(pitches[0]!);
  });

  it('coachBlip at pitch 0.8 (nudge) is the same shape, lower', () => {
    const a = render('coachBlip');
    const b = render('coachBlip', 0.8);
    expect(b.notes.map((n) => n.start)).toEqual(a.notes.map((n) => n.start));
    b.notes.forEach((n, i) => expect(n.freq).toBeCloseTo(a.notes[i]!.freq * 0.8, 6));
  });

  it('stepSuccess is a short rising chime, distinct from roomClear and heal', () => {
    const s = render('stepSuccess');
    expect(s.len).toBeLessThan(0.5);
    const main = s.notes.filter((n) => n.type === 'triangle').sort((x, y) => x.start - y.start);
    expect(main.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < main.length; i++) expect(main[i]!.freq).toBeGreaterThan(main[i - 1]!.freq);
    expect(s.log).not.toEqual(render('roomClear').log);
    expect(s.log).not.toEqual(render('heal').log);
  });

  it('tutorialComplete is a small fanfare: shorter than win, ends on a chord', () => {
    const t = render('tutorialComplete');
    const win = render('win');
    expect(t.len).toBeLessThan(win.len);
    expect(t.len).toBeGreaterThan(0.5);
    const last = Math.max(...t.notes.map((n) => n.start));
    const chord = t.notes.filter((n) => Math.abs(n.start - last) < 0.06);
    expect(chord.length).toBeGreaterThanOrEqual(3);
  });
});

describe('AudioEngine with tutorial ids (Node, no Web Audio)', () => {
  it('accepts the tutorial ids without throwing', () => {
    const audio = createAudioEngine({ persist: false });
    expect(() => {
      audio.play('coachBlip');
      audio.play('coachBlip', { pitch: 0.8 });
      audio.play('stepSuccess');
      audio.play('tutorialComplete');
    }).not.toThrow();
    audio.dispose();
  });
});
