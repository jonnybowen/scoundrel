/**
 * Coach overlay animation (spotlight pulse, arrow bob, panel bump, nudge shake, success flash).
 * CONTRACT (Design Review 2). Impl owner: Gaeta.
 * The director owns one CoachFxTrack, forwards FxDirector.tutorialCue to cue(), advances it in update(),
 * and exposes value() as FxFrame.coach. It never touches the event queue or isBusy().
 *
 * Pure TS: no DOM, no timers, no randomness. Every value is a closed-form function of elapsed time since the
 * relevant cue, so a run is deterministic for a given dt sequence and (up to float rounding) independent of how
 * the time is split into frames.
 *
 * Reduced motion: the spotlight is a static ring (spotlightPulse fixed at 0.5); arrowBob, panelBump,
 * nudgeShake and success stay 0. Cues are still accepted (the sounds play elsewhere) but animate nothing.
 */
import type { CoachFx, TutorialFxCue } from './types';
import { clamp01, cubicOut } from './easing';

export interface CoachFxTrack {
  cue(cue: TutorialFxCue): void;
  update(dtMs: number): void;
  value(): CoachFx;
  setReducedMotion(on: boolean): void;
}

/** Timing table (ms) and amplitudes. Exported so tests and tuning share one source. */
export const COACH_TIMING = {
  /** Spotlight ring breathing period. Restarts bright on coachShown so a new spotlight "lands". */
  pulsePeriod: 1400,
  /** Arrow bob period and amplitude (logical px, toward the target). */
  bobPeriod: 760,
  bobAmp: 3,
  /** Panel pop when new text appears. */
  bump: 200,
  /** Bigger, slower pop for the recap. */
  bumpComplete: 320,
  /** Nudge shake: decaying horizontal wiggle. */
  shake: 280,
  shakePeriod: 70,
  shakeAmp: 2.5,
  /** Green border flash on step success; longer flourish on completion. */
  success: 480,
  successComplete: 1100,
} as const;

/** Reduced-motion / static value. */
export const COACH_STATIC: CoachFx = Object.freeze({
  spotlightPulse: 0.5,
  arrowBob: 0,
  panelBump: 0,
  nudgeShake: 0,
  success: 0,
});

interface Decay {
  age: number;
  life: number;
}

const expired = (): Decay => ({ age: Infinity, life: 1 });
const fresh = (life: number): Decay => ({ age: 0, life });
/** 1 at age 0, eased down to 0 at life. */
const remaining = (d: Decay): number => {
  if (!(d.age < d.life)) return 0;
  const u = clamp01(d.age / d.life);
  return 1 - cubicOut(u);
};

const TAU = Math.PI * 2;

class CoachTrack implements CoachFxTrack {
  private reduced = false;
  /** Time since the spotlight last (re)started, wrapped to the pulse period. */
  private pulseT = 0;
  /** Free-running bob clock, wrapped to the bob period. */
  private bobT = 0;
  private bump = expired();
  private shake = expired();
  private success = expired();
  private current: CoachFx = this.compute();

  cue(cue: TutorialFxCue): void {
    if (this.reduced) return;
    switch (cue) {
      case 'coachShown':
        this.pulseT = 0;
        this.bump = fresh(COACH_TIMING.bump);
        break;
      case 'stepSucceeded':
        this.success = fresh(COACH_TIMING.success);
        break;
      case 'nudged':
        this.shake = fresh(COACH_TIMING.shake);
        break;
      case 'completed':
        this.bump = fresh(COACH_TIMING.bumpComplete);
        this.success = fresh(COACH_TIMING.successComplete);
        break;
    }
    this.current = this.compute();
  }

  update(dtMs: number): void {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    if (!this.reduced) {
      this.pulseT = (this.pulseT + dt) % COACH_TIMING.pulsePeriod;
      this.bobT = (this.bobT + dt) % COACH_TIMING.bobPeriod;
      this.bump.age += dt;
      this.shake.age += dt;
      this.success.age += dt;
    }
    this.current = this.compute();
  }

  value(): CoachFx {
    return this.current;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    if (on) {
      this.pulseT = 0;
      this.bobT = 0;
      this.bump = expired();
      this.shake = expired();
      this.success = expired();
    }
    this.current = this.compute();
  }

  private compute(): CoachFx {
    if (this.reduced) return COACH_STATIC;
    // Starts at 1 (bright) and breathes down to 0 and back.
    const spotlightPulse = 0.5 + 0.5 * Math.cos((TAU * this.pulseT) / COACH_TIMING.pulsePeriod);
    // 0..bobAmp; a squared sine gives a soft "tap" toward the target rather than a plain wave.
    const s = Math.sin((Math.PI * this.bobT) / COACH_TIMING.bobPeriod);
    const arrowBob = COACH_TIMING.bobAmp * s * s;
    const panelBump = remaining(this.bump);
    const shakeEnv = remaining(this.shake);
    const nudgeShake =
      shakeEnv > 0 ? COACH_TIMING.shakeAmp * shakeEnv * Math.sin((TAU * this.shake.age) / COACH_TIMING.shakePeriod) : 0;
    const success = remaining(this.success);
    return { spotlightPulse, arrowBob, panelBump, nudgeShake, success };
  }
}

export function createCoachFxTrack(): CoachFxTrack {
  return new CoachTrack();
}
