/**
 * Test helpers for the Scoundrel rules suite (owner: Tigh).
 *
 * Tests build explicit GameStates instead of relying on shuffle internals: GameState is plain JSON by
 * contract (src/game/state.ts) and step() is a pure function of (state, action), so a hand-built state
 * is a legitimate input. Hand-built states are internally consistent but usually hold fewer than 44 cards;
 * the engine must not derive anything from "the full deck" when stepping.
 */
import { expect } from 'vitest';
import {
  DEFAULT_RULES,
  type Card,
  type CardId,
  type GameAction,
  type GameEvent,
  type GameEventType,
  type GameState,
  type RuleViolation,
  type RulesOptions,
  type StepResult,
  type Suit,
  type Rank,
  type Transition,
  step,
} from '../../src/game';

const SUIT_BY_LETTER: Record<string, Suit> = { C: 'clubs', S: 'spades', D: 'diamonds', H: 'hearts' };

/** Card from its contract id, e.g. c('S14') = ace of spades, c('D7') = 7 of diamonds. */
export function c(id: CardId): Card {
  const m = /^([CSDH])(\d{1,2})$/.exec(id);
  if (!m) throw new Error(`bad card id ${id}`);
  const suit = SUIT_BY_LETTER[m[1]!]!;
  const rank = Number(m[2]) as Rank;
  return { id, suit, rank };
}

export function cards(...ids: CardId[]): Card[] {
  return ids.map(c);
}

/** 4 positional room slots; pass null for an empty (resolved) slot. */
export function room(...slots: (CardId | null)[]): (Card | null)[] {
  if (slots.length !== 4) throw new Error('room needs exactly 4 slots');
  return slots.map((s) => (s === null ? null : c(s)));
}

/**
 * A non-final filler deck: no monsters (so it never affects loss scores) and high cards that tests
 * do not otherwise put in rooms (so ids stay unique). Tests that care about the deck set it explicitly.
 */
export const FILLER_DECK: readonly CardId[] = ['H10', 'D10', 'H9', 'D9', 'H8', 'D7', 'H7', 'H6'];

export interface StateInit extends Partial<Omit<GameState, 'rules'>> {
  rules?: Partial<RulesOptions>;
}

/** A consistent default state: room 1, phase 'choosing', 20 HP, no weapon, non-empty deck. */
export function makeState(init: StateInit = {}): GameState {
  const { rules, ...rest } = init;
  return {
    version: 1,
    seed: 1,
    phase: 'choosing',
    hp: 20,
    maxHp: 20,
    deck: cards(...FILLER_DECK),
    room: room('C2', 'S3', 'D4', 'H5'),
    weapon: null,
    discard: [],
    avoidedLastRoom: false,
    resolvedThisRoom: 0,
    potionUsedThisRoom: false,
    lastResolved: null,
    roomNumber: 1,
    score: null,
    ...rest,
    rules: { ...DEFAULT_RULES, ...rules },
  };
}

export function play(cardId: CardId, mode?: 'weapon' | 'barehanded'): GameAction {
  return mode === undefined ? { type: 'playCard', cardId } : { type: 'playCard', cardId, mode };
}
export const ENTER: GameAction = { type: 'enterRoom' };
export const AVOID: GameAction = { type: 'avoidRoom' };

/** Assert the step was accepted and return the transition. */
export function expectOk(r: StepResult): Transition {
  if (!r.ok) throw new Error(`expected ok, got violation ${JSON.stringify(r.violation)}`);
  return r;
}

/** Assert the step was rejected and return the violation. */
export function expectRejected(r: StepResult): RuleViolation {
  if (r.ok) throw new Error(`expected a violation, got ok with events ${types(r.events).join(',')}`);
  return r.violation;
}

/** Apply actions in order; every one must be accepted. Returns final state and all events. */
export function run(state: GameState, ...actions: GameAction[]): Transition {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const t = expectOk(step(s, a));
    s = t.state;
    events.push(...t.events);
  }
  return { state: s, events };
}

/** Assert an action is rejected with `code` and that the returned state is unchanged. */
export function expectViolation(state: GameState, action: GameAction, code: RuleViolation['code']): RuleViolation {
  const before = structuredClone(state);
  const r = step(state, action);
  const v = expectRejected(r);
  expect(v.code).toBe(code);
  expect(r.state).toEqual(before);
  expect(state).toEqual(before);
  return v;
}

export function types(events: readonly GameEvent[]): GameEventType[] {
  return events.map((e) => e.type);
}

export function eventsOf<T extends GameEventType>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export function ids(list: readonly (Card | null)[]): (CardId | null)[] {
  return list.map((x) => (x === null ? null : x.id));
}

/** Recursively freeze so any in-place mutation by the engine throws (ESM test modules are strict). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** Every card id the state accounts for: deck, room, weapon + its slain stack, discard. */
export function allCardIds(s: GameState): CardId[] {
  const out: CardId[] = [];
  for (const x of s.deck) out.push(x.id);
  for (const x of s.room) if (x) out.push(x.id);
  if (s.weapon) {
    out.push(s.weapon.card.id);
    for (const x of s.weapon.slain) out.push(x.id);
  }
  for (const x of s.discard) out.push(x.id);
  return out;
}

/** Test-local PRNG (mulberry32) for picking actions in fuzz tests. Independent of the engine's RNG. */
export function testRng(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const f = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(f * n);
  };
}
