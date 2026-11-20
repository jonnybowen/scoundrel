/**
 * Seeded RNG. CONTRACT (owner: Tyrol).
 * The engine NEVER calls Math.random(). All randomness flows through an injected Rng so that
 * a seed fully reproduces a game (tests, replays, daily-seed mode).
 */
import { notImplemented } from './notImplemented';
import type { Card } from './cards';

/** uint32 seed. */
export type Seed = number;

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Opaque serialisable internal state. */
  getState(): number;
}

export type RngFactory = (seed: Seed) => Rng;

/** Default PRNG. Recommended: mulberry32 (tiny, fast, good enough for card shuffles). */
export const createRng: RngFactory = (_seed) => notImplemented('createRng', 'Tyrol');

/** Unbiased Fisher-Yates shuffle. Returns a NEW array; never mutates input. */
export function shuffle(_cards: readonly Card[], _rng: Rng): Card[] {
  return notImplemented('shuffle', 'Tyrol');
}

/** Derive a seed from a string, e.g. "2026-11-20" for a daily dungeon. */
export function seedFromString(_s: string): Seed {
  return notImplemented('seedFromString', 'Tyrol');
}
