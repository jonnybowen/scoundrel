/**
 * Pure rules engine. CONTRACT (owner: Tyrol).
 *
 *   createGame(opts)       -> { state, events }
 *   step(state, action)    -> { ok: true, state, events } | { ok: false, state, violation }
 *
 * Pure functions: same inputs => same outputs. No input mutation, no I/O, no clocks, no Math.random.
 */
import { notImplemented } from './notImplemented';
import type { Card, CardId } from './cards';
import type { GameAction, RuleViolation } from './actions';
import type { GameEvent } from './events';
import type { FightMode, GameState, RulesOptions } from './state';
import type { RngFactory, Seed } from './rng';

export interface NewGameOptions {
  readonly seed: Seed;
  readonly rules?: Partial<RulesOptions>;
  /** Inject a different PRNG (tests). Defaults to createRng. */
  readonly rngFactory?: RngFactory;
}

export interface Transition {
  readonly state: GameState;
  /** Ordered events, oldest first. */
  readonly events: readonly GameEvent[];
}

export type StepResult =
  | ({ readonly ok: true } & Transition)
  | { readonly ok: false; readonly state: GameState; readonly violation: RuleViolation };

/** Build + shuffle the deck, deal the first room. Emits GameStarted, CardDealt x4, RoomRevealed. */
export function createGame(_opts: NewGameOptions): Transition {
  return notImplemented('createGame', 'Tyrol');
}

/** Apply one action. Illegal actions return { ok: false } with the unchanged state; never throws. */
export function step(_state: GameState, _action: GameAction): StepResult {
  return notImplemented('step', 'Tyrol');
}

/** Every action currently legal (for UI affordances, hints, and property tests). */
export function legalActions(_state: GameState): GameAction[] {
  return notImplemented('legalActions', 'Tyrol');
}

export function canAvoidRoom(_state: GameState): boolean {
  return notImplemented('canAvoidRoom', 'Tyrol');
}

/** True if the equipped weapon may fight this room monster under the degradation rule. */
export function canUseWeaponOn(_state: GameState, _monsterId: CardId): boolean {
  return notImplemented('canUseWeaponOn', 'Tyrol');
}

/**
 * Highest monster value the equipped weapon may still fight, or null when there is no weapon
 * or the weapon is unused (no limit). Render shows this as the weapon's durability badge.
 */
export function weaponLimit(_state: GameState): number | null {
  return notImplemented('weaponLimit', 'Tyrol');
}

/** Damage preview for UI hover: HP that `playCard` would cost with the given mode. */
export function previewDamage(_state: GameState, _monster: Card, _mode: FightMode): number {
  return notImplemented('previewDamage', 'Tyrol');
}

/** Score per docs/RULES.md. Valid at any time (live score); final once phase is won/lost. */
export function computeScore(_state: GameState): number {
  return notImplemented('computeScore', 'Tyrol');
}
