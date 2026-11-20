/**
 * Player actions (commands into the engine). CONTRACT (owner: Tyrol).
 * UI translates input into these. They are the ONLY way game state changes.
 */
import type { CardId } from './cards';
import type { FightMode } from './state';

export type GameAction =
  /** Commit to the current room (phase 'choosing' -> 'resolving'). */
  | { readonly type: 'enterRoom' }
  /** Put all 4 room cards on the bottom of the deck and deal a new room. Not allowed twice in a row. */
  | { readonly type: 'avoidRoom' }
  /**
   * Resolve one room card. Playing a card while in 'choosing' implicitly enters the room.
   * `mode` applies to monsters only:
   *  - omitted + weapon can legally fight  -> violation 'modeRequired' (UI must ask; never guess for the player)
   *  - omitted + no usable weapon          -> barehanded
   *  - 'weapon' when weapon cannot fight   -> violation 'weaponCannotFight' / 'noWeapon'
   */
  | { readonly type: 'playCard'; readonly cardId: CardId; readonly mode?: FightMode };

export type GameActionType = GameAction['type'];

/** Why an action was rejected. The engine never throws on illegal player input; it returns one of these. */
export type RuleViolation =
  | { readonly code: 'gameOver' }
  | { readonly code: 'cannotAvoidTwice' }
  | { readonly code: 'cannotAvoidAfterEntering' }
  /** The final room (Dungeon empty, RULES.md A4) can never be avoided. */
  | { readonly code: 'cannotAvoidFinalRoom' }
  /** `enterRoom` while already resolving the room. */
  | { readonly code: 'alreadyEntered' }
  | { readonly code: 'cardNotInRoom'; readonly cardId: CardId }
  | { readonly code: 'noWeapon'; readonly cardId: CardId }
  | { readonly code: 'weaponCannotFight'; readonly cardId: CardId; readonly limit: number }
  | { readonly code: 'modeRequired'; readonly cardId: CardId };
