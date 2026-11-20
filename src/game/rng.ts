/**
 * Seeded RNG. CONTRACT (owner: Tyrol).
 * The engine NEVER calls Math.random(). All randomness flows through an injected Rng so that
 * a seed fully reproduces a game (tests, replays, daily-seed mode).
 */
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

/**
 * Default PRNG: mulberry32 (tiny, fast, good enough for card shuffles).
 * The seed is normalised to uint32, so any number (including negatives/floats) is accepted.
 */
export const createRng: RngFactory = (seed) => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(maxExclusive: number): number {
      if (!(maxExclusive > 0)) return 0;
      return Math.floor(next() * Math.floor(maxExclusive));
    },
    getState: () => a,
  };
};

/** Unbiased Fisher-Yates shuffle. Returns a NEW array; never mutates input. */
export function shuffle(cards: readonly Card[], rng: Rng): Card[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Derive a seed from a string, e.g. "2026-11-20" for a daily dungeon. FNV-1a 32-bit over UTF-16 code units. */
export function seedFromString(s: string): Seed {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
