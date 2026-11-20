/**
 * Card model. CONTRACT (owner: Tyrol). Changes require a Design Review (Adama).
 * See docs/RULES.md for the canonical rules this models.
 */
import { notImplemented } from './notImplemented';

export type Suit = 'clubs' | 'spades' | 'diamonds' | 'hearts';

/** Numeric rank. Face cards and aces use their monster value: J=11, Q=12, K=13, A=14. */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** What a card does in Scoundrel, derived purely from its suit. */
export type CardKind = 'monster' | 'weapon' | 'potion';

/** Unique within a game, never reused. Format: suit letter + rank, e.g. "S14", "D7", "H10", "C2". */
export type CardId = string;

/**
 * Stable card identity. Render/FX key all sprites and tweens by `id`, never by array index.
 */
export interface Card {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
}

/** Deck composition constants (data, not logic). */
export const DECK_SIZE = 44;
export const MONSTER_COUNT = 26; // all clubs + spades, 2..A
export const WEAPON_COUNT = 9; // diamonds 2..10
export const POTION_COUNT = 9; // hearts 2..10
export const MAX_HP = 20;
export const ROOM_SIZE = 4;
export const CARDS_RESOLVED_PER_ROOM = 3;

/** clubs/spades -> monster, diamonds -> weapon, hearts -> potion. */
export function cardKind(_card: Card): CardKind {
  return notImplemented('cardKind', 'Tyrol');
}

/** The card's numeric value (== rank). Damage for monsters, strength for weapons, heal for potions. */
export function cardValue(_card: Card): number {
  return notImplemented('cardValue', 'Tyrol');
}

/** Build the unshuffled 44-card Scoundrel deck in a canonical, documented order. */
export function buildDeck(): Card[] {
  return notImplemented('buildDeck', 'Tyrol');
}
