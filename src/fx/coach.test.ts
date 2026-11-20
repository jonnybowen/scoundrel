import { describe, expect, it } from 'vitest';
import { COACH_STATIC, COACH_TIMING, createCoachFxTrack } from './coach';
import type { CoachFx, TutorialFxCue } from './types';

type Script = readonly (number | TutorialFxCue)[];

function run(script: Script, reduced = false): CoachFx[] {
  const t = createCoachFxTrack();
  t.setReducedMotion(reduced);
  const out: CoachFx[] = [];
  for (const s of script) {
    if (typeof s === 'number') t.update(s);
    else t.cue(s);
    out.push(t.value());
  }
  return out;
}

const keys = ['spotlightPulse', 'arrowBob', 'panelBump', 'nudgeShake', 'success'] as const;
function expectClose(a: CoachFx, b: CoachFx): void {
  for (const k of keys) expect(a[k]).toBeCloseTo(b[k], 9);
}

describe('CoachFxTrack', () => {
  const script: Script = ['coachShown', 16, 16, 'nudged', 33, 7, 'stepSucceeded', 100, 'coachShown', 250, 'completed', 500, 1000];

  it('is deterministic for the same cue/dt sequence', () => {
    expect(run(script)).toEqual(run(script));
  });

  it('is frame-rate independent: one big dt equals many small ones', () => {
    for (const cue of ['coachShown', 'nudged', 'stepSucceeded', 'completed'] as const) {
      for (const total of [37, 150, 333, 2000]) {
        const big = run([cue, total]).at(-1)!;
        const n = 20;
        const small = run([cue, ...Array.from({ length: n }, () => total / n)]).at(-1)!;
        expectClose(big, small);
      }
    }
  });

  it('keeps every value in its documented range', () => {
    const t = createCoachFxTrack();
    const cues: TutorialFxCue[] = ['coachShown', 'nudged', 'stepSucceeded', 'completed'];
    for (let i = 0; i < 600; i++) {
      if (i % 37 === 0) t.cue(cues[(i / 37) % cues.length]!);
      t.update(7 + (i % 5));
      const v = t.value();
      expect(v.spotlightPulse).toBeGreaterThanOrEqual(0);
      expect(v.spotlightPulse).toBeLessThanOrEqual(1);
      expect(v.arrowBob).toBeGreaterThanOrEqual(0);
      expect(v.arrowBob).toBeLessThanOrEqual(3);
      expect(v.panelBump).toBeGreaterThanOrEqual(0);
      expect(v.panelBump).toBeLessThanOrEqual(1);
      expect(v.success).toBeGreaterThanOrEqual(0);
      expect(v.success).toBeLessThanOrEqual(1);
      expect(Math.abs(v.nudgeShake)).toBeLessThanOrEqual(COACH_TIMING.shakeAmp);
    }
  });

  it('spotlight pulses and the arrow bobs over time', () => {
    const vals = run(['coachShown', ...Array.from({ length: 120 }, () => 16)]);
    const pulses = vals.map((v) => v.spotlightPulse);
    const bobs = vals.map((v) => v.arrowBob);
    expect(Math.max(...pulses) - Math.min(...pulses)).toBeGreaterThan(0.9);
    expect(Math.max(...bobs) - Math.min(...bobs)).toBeGreaterThan(2.5);
  });

  it('coachShown restarts the pulse bright and pops the panel, which decays to 0', () => {
    const t = createCoachFxTrack();
    t.update(COACH_TIMING.pulsePeriod / 2);
    expect(t.value().spotlightPulse).toBeLessThan(0.05);
    t.cue('coachShown');
    expect(t.value().spotlightPulse).toBeCloseTo(1, 9);
    expect(t.value().panelBump).toBe(1);
    t.update(COACH_TIMING.bump / 2);
    const mid = t.value().panelBump;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    t.update(COACH_TIMING.bump);
    expect(t.value().panelBump).toBe(0);
  });

  it('nudged shakes both ways, then settles to exactly 0', () => {
    const t = createCoachFxTrack();
    t.cue('nudged');
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) {
      t.update(5);
      xs.push(t.value().nudgeShake);
    }
    expect(Math.max(...xs)).toBeGreaterThan(0.5);
    expect(Math.min(...xs)).toBeLessThan(-0.5);
    t.update(COACH_TIMING.shake);
    expect(t.value().nudgeShake).toBe(0);
    expect(t.value().panelBump).toBe(0);
    expect(t.value().success).toBe(0);
  });

  it('stepSucceeded flashes the border; completed flourishes longer with a bump', () => {
    const s = createCoachFxTrack();
    s.cue('stepSucceeded');
    expect(s.value().success).toBe(1);
    s.update(COACH_TIMING.success);
    expect(s.value().success).toBe(0);

    const c = createCoachFxTrack();
    c.cue('completed');
    expect(c.value().success).toBe(1);
    expect(c.value().panelBump).toBe(1);
    c.update(COACH_TIMING.success);
    expect(c.value().success).toBeGreaterThan(0);
    c.update(COACH_TIMING.successComplete);
    expect(c.value().success).toBe(0);
    expect(c.value().panelBump).toBe(0);
  });

  it('reduced motion: static ring, no bob, bump, shake or success, whatever the cues', () => {
    for (const v of run(script, true)) expect(v).toEqual(COACH_STATIC);
    expect(COACH_STATIC.spotlightPulse).toBe(0.5);
  });

  it('turning reduced motion on mid-animation cancels it; turning it off resumes animating', () => {
    const t = createCoachFxTrack();
    t.cue('nudged');
    t.cue('completed');
    t.update(20);
    t.setReducedMotion(true);
    expect(t.value()).toEqual(COACH_STATIC);
    t.update(50);
    expect(t.value()).toEqual(COACH_STATIC);
    t.setReducedMotion(false);
    expect(t.value().panelBump).toBe(0);
    expect(t.value().success).toBe(0);
    t.update(200);
    expect(t.value().arrowBob).toBeGreaterThan(0);
  });

  it('ignores bad dt', () => {
    const base = run(['coachShown', 16]).at(-1)!;
    const t = createCoachFxTrack();
    t.cue('coachShown');
    t.update(16);
    t.update(Number.NaN);
    t.update(-50);
    t.update(Number.POSITIVE_INFINITY);
    expect(t.value()).toEqual(base);
  });
});
