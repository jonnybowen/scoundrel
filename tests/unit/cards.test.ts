/** Deck composition and card semantics (RULES.md: Setup, Cards). */
import { describe, expect, it } from 'vitest';
import { buildDeck, cardKind, cardValue, DECK_SIZE, type Card } from '../../src/game';
import { c } from './helpers';

const ranksOf = (deck: Card[], suit: Card['suit']) =>
  deck
    .filter((x) => x.suit === suit)
    .map((x) => x.rank)
    .sort((a, b) => a - b);

describe('buildDeck', () => {
  it('has exactly 44 cards with unique ids', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(44);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map((x) => x.id)).size).toBe(44);
  });

  it('has all clubs and spades 2..A (26 monsters)', () => {
    const deck = buildDeck();
    const all = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    expect(ranksOf(deck, 'clubs')).toEqual(all);
    expect(ranksOf(deck, 'spades')).toEqual(all);
  });

  it('has diamonds and hearts 2..10 only: no red faces, no red aces', () => {
    const deck = buildDeck();
    const pips = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(ranksOf(deck, 'diamonds')).toEqual(pips);
    expect(ranksOf(deck, 'hearts')).toEqual(pips);
    expect(deck.filter((x) => (x.suit === 'hearts' || x.suit === 'diamonds') && x.rank > 10)).toEqual([]);
  });

  it('uses the contract id format: suit letter + rank', () => {
    const letter = { clubs: 'C', spades: 'S', diamonds: 'D', hearts: 'H' } as const;
    for (const card of buildDeck()) expect(card.id).toBe(`${letter[card.suit]}${card.rank}`);
  });

  it('is deterministic and returns a fresh array each call', () => {
    const a = buildDeck();
    const b = buildDeck();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.pop();
    expect(buildDeck()).toHaveLength(44);
  });

  it('kind counts: 26 monsters, 9 weapons, 9 potions', () => {
    const kinds = buildDeck().map(cardKind);
    expect(kinds.filter((k) => k === 'monster')).toHaveLength(26);
    expect(kinds.filter((k) => k === 'weapon')).toHaveLength(9);
    expect(kinds.filter((k) => k === 'potion')).toHaveLength(9);
  });
});

describe('cardKind / cardValue', () => {
  it.each([
    ['C2', 'monster', 2],
    ['S14', 'monster', 14],
    ['C11', 'monster', 11],
    ['S12', 'monster', 12],
    ['C13', 'monster', 13],
    ['D2', 'weapon', 2],
    ['D10', 'weapon', 10],
    ['H2', 'potion', 2],
    ['H10', 'potion', 10],
  ] as const)('%s is a %s worth %d', (id, kind, value) => {
    expect(cardKind(c(id))).toBe(kind);
    expect(cardValue(c(id))).toBe(value);
  });
});
