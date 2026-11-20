/**
 * GameEvent stream. CONTRACT.
 * Producer: Tyrol (engine). Consumers: Starbuck (render/ui), Gaeta (fx/audio), Tigh (tests).
 *
 * Every transition returns the ordered list of events describing exactly what happened.
 * Presentation layers animate/sonify these in order; they must NOT diff GameState to infer what happened.
 * Events are past-tense facts: plain, immutable, JSON-serialisable data.
 *
 * Canonical ordering for one playCard on a monster:
 *   MonsterFought -> DamageTaken (only if damage > 0) -> MonsterSlain | GameLost
 *   -> RoomCleared (if 3rd card) -> CardDealt x N -> RoomRevealed     (or GameWon at dungeon end)
 */
import type { Card } from './cards';
import type { FightMode } from './state';
import type { Seed } from './rng';

export type GameEvent =
  | { readonly type: 'GameStarted'; readonly seed: Seed; readonly hp: number; readonly deckSize: number }
  /** One card moved from the deck top into a room slot (emitted per card, in deal order). */
  | { readonly type: 'CardDealt'; readonly card: Card; readonly slot: number; readonly deckRemaining: number }
  /** Room is fully dealt and awaiting a choice. */
  | { readonly type: 'RoomRevealed'; readonly roomNumber: number; readonly canAvoid: boolean }
  | { readonly type: 'RoomEntered'; readonly roomNumber: number }
  /** The room cards were moved to the bottom of the deck, in this order. */
  | { readonly type: 'RoomAvoided'; readonly roomNumber: number; readonly cards: readonly Card[] }
  | {
      readonly type: 'MonsterFought';
      readonly monster: Card;
      readonly mode: FightMode;
      /** Weapon used, if mode === 'weapon'. */
      readonly weapon: Card | null;
      readonly damage: number;
    }
  | {
      readonly type: 'DamageTaken';
      readonly amount: number;
      readonly hpBefore: number;
      /** Clamped at 0 (RULES.md A6); GameLost follows if 0. `amount` is the unclamped damage. */
      readonly hpAfter: number;
      readonly source: Card;
    }
  /** Monster placed on the weapon stack (byWeapon set) or discarded (barehanded). */
  | { readonly type: 'MonsterSlain'; readonly monster: Card; readonly byWeapon: Card | null }
  | {
      readonly type: 'WeaponEquipped';
      readonly weapon: Card;
      /** Previously held weapon, now discarded together with its slain stack. */
      readonly replaced: Card | null;
      readonly discarded: readonly Card[];
    }
  | {
      readonly type: 'PotionUsed';
      readonly potion: Card;
      /** Actual HP gained after capping at maxHp (may be 0 at full health). */
      readonly healed: number;
      readonly hpBefore: number;
      readonly hpAfter: number;
    }
  /** Potion discarded with no effect because one already healed this room. */
  | { readonly type: 'PotionWasted'; readonly potion: Card; readonly reason: 'alreadyUsedThisRoom' }
  /** Room resolved. `carried` is the leftover card that stays for the next room, if any. */
  | { readonly type: 'RoomCleared'; readonly roomNumber: number; readonly carried: Card | null }
  | { readonly type: 'GameWon'; readonly score: number; readonly hp: number; readonly potionBonus: number }
  | { readonly type: 'GameLost'; readonly score: number; readonly remainingMonsters: readonly Card[] };

export type GameEventType = GameEvent['type'];

/** Narrowing helper for consumers, e.g. `(e: EventOf<'DamageTaken'>) => e.amount`. */
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
