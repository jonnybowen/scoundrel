/**
 * GameState. CONTRACT (owner: Tyrol).
 * Plain, immutable, JSON-serialisable data. No classes, no functions, no DOM.
 * Render/UI may READ state; only the engine (`step`) produces new state.
 */
import type { Card } from './cards';
import type { Seed } from './rng';

export type Phase =
  /** A full room is face-up; the player may enter or (if allowed) avoid it. */
  | 'choosing'
  /** Player entered the room and is resolving cards (3 of 4, or all remaining at dungeon end). */
  | 'resolving'
  | 'won'
  | 'lost';

/** How a monster is fought. */
export type FightMode = 'weapon' | 'barehanded';

export interface EquippedWeapon {
  readonly card: Card;
  /** Monsters slain with this weapon, in order. Rendered stacked on the weapon. */
  readonly slain: readonly Card[];
}

/** Rule variants. Defaults follow docs/RULES.md; alternatives exist because the rules text is ambiguous. */
export interface RulesOptions {
  /**
   * Weapon degradation (RULES.md A1).
   * 'lte' (default, official text "lower value (less than or equal)"): a used weapon may fight
   * monsters with value <= the last monster it slew. 'lt': strictly lower.
   */
  readonly weaponLimit: 'lte' | 'lt';
  /**
   * Losing score (RULES.md A3): which monsters are subtracted.
   * 'dungeon' (default): unresolved monsters in the draw pile AND the current room.
   * 'deckOnly': draw pile only.
   */
  readonly lossScoreScope: 'dungeon' | 'deckOnly';
}

export const DEFAULT_RULES: RulesOptions = {
  weaponLimit: 'lte',
  lossScoreScope: 'dungeon',
};

export interface GameState {
  /** Schema version for saved games. Bump on a breaking shape change. */
  readonly version: 1;
  readonly seed: Seed;
  readonly rules: RulesOptions;
  readonly phase: Phase;

  readonly hp: number;
  readonly maxHp: number;

  /** Draw pile. Index 0 is the TOP (next card dealt). Avoided rooms go to the END (bottom). */
  readonly deck: readonly Card[];
  /**
   * Current room as 4 positional slots; `null` = slot empty (resolved).
   * Slots are stable so render can keep cards in place: the carried-over card keeps its slot
   * and new cards fill empty slots left-to-right.
   */
  readonly room: readonly (Card | null)[];
  readonly weapon: EquippedWeapon | null;
  /** Discarded cards: resolved potions, barehanded kills, replaced weapons + their slain stacks. */
  readonly discard: readonly Card[];

  /** True if the PREVIOUS room was avoided (so the current one may not be). */
  readonly avoidedLastRoom: boolean;
  /** Cards resolved in the current room (0..3; up to 4 in the final room, RULES.md A4). */
  readonly resolvedThisRoom: number;
  /** A potion has already healed this room; further potions this room are wasted. */
  readonly potionUsedThisRoom: boolean;
  /** Most recently resolved card (needed for the "last card was a potion" win bonus). */
  readonly lastResolved: Card | null;
  /** 1-based room counter, incremented on each deal (including after an avoid). */
  readonly roomNumber: number;
  /** Final score once phase is 'won' | 'lost', otherwise null. */
  readonly score: number | null;
}
