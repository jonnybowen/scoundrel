/**
 * Small local easing + interpolation library. Pure functions, no state. Owner: Gaeta.
 * All easings map t in [0,1] to roughly [0,1] (back/elastic overshoot past 1 on purpose).
 */
import type { Easing } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Progress of `t` through the window [start, start + dur], clamped to 0..1. */
export const window01 = (t: number, start: number, dur: number): number => (dur <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / dur));

export const linear: Easing = (t) => t;
export const quadIn: Easing = (t) => t * t;
export const quadOut: Easing = (t) => t * (2 - t);
export const quadInOut: Easing = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const cubicIn: Easing = (t) => t * t * t;
export const cubicOut: Easing = (t) => 1 - (1 - t) ** 3;
export const cubicInOut: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const expoOut: Easing = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const sineInOut: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Overshoot then settle. `s` ~1.70158 is the classic amount; bigger = punchier. */
export const backOutBy =
  (s: number): Easing =>
  (t) => {
    const u = t - 1;
    return 1 + (s + 1) * u * u * u + s * u * u;
  };
export const backOut: Easing = backOutBy(1.70158);
export const backIn: Easing = (t) => {
  const s = 1.70158;
  return (s + 1) * t * t * t - s * t * t;
};

export const elasticOut: Easing = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** 0 -> 1 -> 0 hump, handy for lifts and squash pulses. */
export const hump = (t: number): number => Math.sin(Math.PI * clamp01(t));

/** Frame-rate independent exponential approach: fraction to move toward target this frame. */
export const approach = (dtMs: number, halfLifeMs: number): number => (halfLifeMs <= 0 ? 1 : 1 - 2 ** (-dtMs / halfLifeMs));
