/**
 * Placeholder smoke test (scaffold). Tigh replaces this with real rules tests.
 * Checks the contract constants and that engine stubs are wired (throw until Tyrol implements them).
 */
import { describe, expect, it } from 'vitest';
import { DECK_SIZE, MONSTER_COUNT, POTION_COUNT, WEAPON_COUNT, DEFAULT_RULES, createGame } from '../../src/game';

describe('contracts', () => {
  it('deck composition constants add up to 44', () => {
    expect(MONSTER_COUNT + WEAPON_COUNT + POTION_COUNT).toBe(DECK_SIZE);
    expect(DECK_SIZE).toBe(44);
  });

  it('default rules follow docs/RULES.md', () => {
    expect(DEFAULT_RULES).toEqual({ weaponLimit: 'lte', lossScoreScope: 'dungeon' });
  });

  it('engine is a stub until implemented', () => {
    expect(() => createGame({ seed: 1 })).toThrow(/not implemented/);
  });
});
