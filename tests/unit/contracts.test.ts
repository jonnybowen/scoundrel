/** Contract constants (src/game/cards.ts, src/game/state.ts). */
import { describe, expect, it } from 'vitest';
import { DECK_SIZE, MONSTER_COUNT, POTION_COUNT, WEAPON_COUNT, DEFAULT_RULES, MAX_HP, ROOM_SIZE, CARDS_RESOLVED_PER_ROOM, cardIdOf } from '../../src/game';

describe('contracts', () => {
  it('deck composition constants add up to 44', () => {
    expect(MONSTER_COUNT + WEAPON_COUNT + POTION_COUNT).toBe(DECK_SIZE);
    expect(DECK_SIZE).toBe(44);
    expect([MONSTER_COUNT, WEAPON_COUNT, POTION_COUNT]).toEqual([26, 9, 9]);
  });

  it('game constants follow docs/RULES.md', () => {
    expect(MAX_HP).toBe(20);
    expect(ROOM_SIZE).toBe(4);
    expect(CARDS_RESOLVED_PER_ROOM).toBe(3);
  });

  it('default rules follow docs/RULES.md', () => {
    expect(DEFAULT_RULES).toEqual({ weaponLimit: 'lte', lossScoreScope: 'dungeon' });
  });

  it('cardIdOf builds the contract id format', () => {
    expect(cardIdOf('spades', 14)).toBe('S14');
    expect(cardIdOf('diamonds', 7)).toBe('D7');
    expect(cardIdOf('hearts', 10)).toBe('H10');
    expect(cardIdOf('clubs', 2)).toBe('C2');
  });
});
