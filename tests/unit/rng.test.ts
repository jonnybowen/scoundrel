/** Seeded RNG contract (src/game/rng.ts). Tests properties only, never specific PRNG outputs. */
import { describe, expect, it } from 'vitest';
import { buildDeck, createRng, seedFromString, shuffle } from '../../src/game';
import { deepFreeze } from './helpers';

const sample = (seed: number, n = 20) => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('createRng', () => {
  it('same seed gives the same sequence', () => {
    expect(sample(42)).toEqual(sample(42));
  });

  it('different seeds give different sequences', () => {
    expect(sample(1)).not.toEqual(sample(2));
  });

  it('next() is in [0, 1)', () => {
    for (const x of sample(7, 1000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int(n) is an integer in [0, n)', () => {
    const r = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const n = (i % 44) + 1;
      const x = r.int(n);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(n);
    }
  });

  it('getState() is a serialisable number', () => {
    const s = createRng(3).getState();
    expect(typeof s).toBe('number');
    expect(JSON.parse(JSON.stringify(s))).toBe(s);
  });
});

describe('shuffle', () => {
  it('returns a new permutation and never mutates its input', () => {
    const deck = deepFreeze(buildDeck());
    const out = shuffle(deck, createRng(5));
    expect(out).not.toBe(deck);
    expect(out).toHaveLength(44);
    expect([...out].map((x) => x.id).sort()).toEqual([...deck].map((x) => x.id).sort());
    expect(deck).toEqual(buildDeck());
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const deck = buildDeck();
    expect(shuffle(deck, createRng(11))).toEqual(shuffle(deck, createRng(11)));
    const orders = new Set([1, 2, 3, 4, 5].map((s) => shuffle(deck, createRng(s)).map((x) => x.id).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('seedFromString', () => {
  it('is deterministic and yields a uint32', () => {
    const s = seedFromString('2026-11-20');
    expect(seedFromString('2026-11-20')).toBe(s);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it('different strings give different seeds', () => {
    expect(seedFromString('2026-11-20')).not.toBe(seedFromString('2026-11-21'));
  });
});
