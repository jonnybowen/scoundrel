/**
 * Pure rules engine. CONTRACT (owner: Tyrol).
 *
 *   createGame(opts)       -> { state, events }
 *   step(state, action)    -> { ok: true, state, events } | { ok: false, state, violation }
 *
 * Pure functions: same inputs => same outputs. No input mutation, no I/O, no clocks, no Math.random.
 * Rules: docs/RULES.md (rulings A1-A10).
 */
import { MAX_HP, ROOM_SIZE, CARDS_RESOLVED_PER_ROOM, buildDeck, cardKind, cardValue } from './cards';
import type { Card, CardId } from './cards';
import type { GameAction, RuleViolation } from './actions';
import type { GameEvent } from './events';
import { DEFAULT_RULES } from './state';
import type { FightMode, GameState, RulesOptions } from './state';
import { createRng, shuffle } from './rng';
import type { RngFactory, Seed } from './rng';

export interface NewGameOptions {
  readonly seed: Seed;
  readonly rules?: Partial<RulesOptions>;
  /** Inject a different PRNG (tests). Defaults to createRng. */
  readonly rngFactory?: RngFactory;
  /**
   * Design Review 2 (additive, impl owner Tyrol): play this exact deck instead of shuffling, top first.
   * Used by the tutorial's scripted dungeon. Any number of cards with unique ids (consistent with the accepted
   * hand-built-state ruling); the seed is still recorded but the RNG is not consulted. Everything else
   * (first deal, events, rules) is identical to a shuffled game. Replay with the same options reproduces it.
   */
  readonly deck?: readonly Card[];
}

export interface Transition {
  readonly state: GameState;
  /** Ordered events, oldest first. */
  readonly events: readonly GameEvent[];
}

export type StepResult =
  | ({ readonly ok: true } & Transition)
  | { readonly ok: false; readonly state: GameState; readonly violation: RuleViolation };

// ---------------------------------------------------------------------------------------------
// Internal helpers (mutable working copy; never touches the caller's state object)
// ---------------------------------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Draft extends Omit<Mutable<GameState>, 'deck' | 'room' | 'discard'> {
  deck: Card[];
  room: (Card | null)[];
  discard: Card[];
}

function draftOf(state: GameState): Draft {
  return {
    ...state,
    deck: state.deck.slice(),
    room: state.room.slice(),
    discard: state.discard.slice(),
  };
}

function freezeDraft(d: Draft): GameState {
  return { ...d };
}

function isMonster(card: Card): boolean {
  return cardKind(card) === 'monster';
}

function isGameOver(state: GameState): boolean {
  return state.phase === 'won' || state.phase === 'lost';
}

/** RULES.md A4: once the Dungeon is empty after a deal, the current room is the final room. */
function isFinalRoom(state: Pick<GameState, 'deck'>): boolean {
  return state.deck.length === 0;
}

function findInRoom(state: Pick<GameState, 'room'>, cardId: CardId): { card: Card; slot: number } | null {
  for (let i = 0; i < state.room.length; i++) {
    const c = state.room[i];
    if (c && c.id === cardId) return { card: c, slot: i };
  }
  return null;
}

function roomCards(state: Pick<GameState, 'room'>): Card[] {
  return state.room.filter((c): c is Card => c !== null);
}

/** Highest monster value a weapon whose last kill was `lastSlain` may fight (RULES.md A1/A2). */
function limitFromLastSlain(lastSlain: Card, rules: RulesOptions): number {
  const v = cardValue(lastSlain);
  return rules.weaponLimit === 'lt' ? v - 1 : v;
}

function weaponCanFight(state: GameState, monster: Card): boolean {
  if (!state.weapon) return false;
  const limit = weaponLimit(state);
  return limit === null || cardValue(monster) <= limit;
}

/** Monsters counted against a losing / live score (RULES.md A3). */
function remainingMonsters(state: Pick<GameState, 'deck' | 'room' | 'rules'>): Card[] {
  const fromDeck = state.deck.filter(isMonster);
  if (state.rules.lossScoreScope === 'deckOnly') return fromDeck;
  return [...fromDeck, ...roomCards(state).filter(isMonster)];
}

function sumValues(cards: readonly Card[]): number {
  return cards.reduce((acc, c) => acc + cardValue(c), 0);
}

/** RULES.md win bonus + A8: HP at max and the last resolved card was any potion (healed or wasted). */
function winPotionBonus(state: Pick<GameState, 'hp' | 'maxHp' | 'lastResolved'>): number {
  const last = state.lastResolved;
  if (state.hp === state.maxHp && last && cardKind(last) === 'potion') return cardValue(last);
  return 0;
}

/** Fill empty room slots left-to-right from the deck top. Emits CardDealt per card. */
function dealInto(d: Draft, events: GameEvent[]): void {
  for (let slot = 0; slot < ROOM_SIZE; slot++) {
    if (d.room[slot] != null) continue;
    const card = d.deck.shift();
    if (!card) break;
    d.room[slot] = card;
    events.push({ type: 'CardDealt', card, slot, deckRemaining: d.deck.length });
  }
}

/** Start a fresh room: reset per-room bookkeeping, bump the counter, reveal. */
function revealNewRoom(d: Draft, events: GameEvent[], avoided: boolean): void {
  d.roomNumber += 1;
  d.phase = 'choosing';
  d.resolvedThisRoom = 0;
  d.potionUsedThisRoom = false;
  d.avoidedLastRoom = avoided;
  dealInto(d, events);
  events.push({ type: 'RoomRevealed', roomNumber: d.roomNumber, canAvoid: canAvoidRoom(freezeDraft(d)) });
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Build + shuffle the deck (or use opts.deck as given), deal the first room. Emits GameStarted, CardDealt x4, RoomRevealed. */
export function createGame(opts: NewGameOptions): Transition {
  const seed = opts.seed >>> 0;
  const rules: RulesOptions = { ...DEFAULT_RULES, ...stripUndefined(opts.rules ?? {}) };
  const deck = opts.deck !== undefined ? scriptedDeck(opts.deck) : shuffle(buildDeck(), (opts.rngFactory ?? createRng)(seed));

  const d: Draft = {
    version: 1,
    seed,
    rules,
    phase: 'choosing',
    hp: MAX_HP,
    maxHp: MAX_HP,
    deck,
    room: [null, null, null, null],
    weapon: null,
    discard: [],
    avoidedLastRoom: false,
    resolvedThisRoom: 0,
    potionUsedThisRoom: false,
    lastResolved: null,
    roomNumber: 0,
    score: null,
  };
  const events: GameEvent[] = [{ type: 'GameStarted', seed, hp: d.hp, deckSize: deck.length }];
  revealNewRoom(d, events, false);
  return { state: freezeDraft(d), events };
}

/**
 * Validate and copy a caller-supplied deck (NewGameOptions.deck). No shuffle, no RNG call.
 * Throws RangeError on an empty deck or duplicate card ids: that is a programming error, not player input.
 */
function scriptedDeck(deck: readonly Card[]): Card[] {
  if (deck.length === 0) throw new RangeError('createGame({ deck }): deck must not be empty');
  const seen = new Set<CardId>();
  for (const card of deck) {
    if (seen.has(card.id)) throw new RangeError(`createGame({ deck }): duplicate card id ${card.id}`);
    seen.add(card.id);
  }
  return deck.slice();
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) {
    if (o[k] !== undefined) out[k] = o[k];
  }
  return out;
}

/** Apply one action. Illegal actions return { ok: false } with the unchanged state; never throws. */
export function step(state: GameState, action: GameAction): StepResult {
  const reject = (violation: RuleViolation): StepResult => ({ ok: false, state, violation });
  if (isGameOver(state)) return reject({ code: 'gameOver' });

  switch (action.type) {
    case 'enterRoom': {
      if (state.phase !== 'choosing') return reject({ code: 'alreadyEntered' });
      return {
        ok: true,
        state: { ...state, phase: 'resolving' },
        events: [{ type: 'RoomEntered', roomNumber: state.roomNumber }],
      };
    }

    case 'avoidRoom': {
      const v = avoidViolation(state);
      if (v) return reject(v);
      const d = draftOf(state);
      const avoided = roomCards(d);
      const events: GameEvent[] = [{ type: 'RoomAvoided', roomNumber: d.roomNumber, cards: avoided }];
      d.deck.push(...avoided);
      d.room = [null, null, null, null];
      revealNewRoom(d, events, true);
      return { ok: true, state: freezeDraft(d), events };
    }

    case 'playCard':
      return playCard(state, action.cardId, action.mode, reject);

    default: {
      // Unknown action from untyped input (e.g. a corrupt save). Never throw.
      const unknown: { type?: unknown; cardId?: unknown } = action;
      return reject({ code: 'cardNotInRoom', cardId: String(unknown.cardId ?? unknown.type ?? '') });
    }
  }
}

function avoidViolation(state: GameState): RuleViolation | null {
  if (isGameOver(state)) return { code: 'gameOver' };
  if (state.phase !== 'choosing') return { code: 'cannotAvoidAfterEntering' };
  if (state.avoidedLastRoom) return { code: 'cannotAvoidTwice' };
  if (isFinalRoom(state)) return { code: 'cannotAvoidFinalRoom' };
  return null;
}

function playCard(
  state: GameState,
  cardId: CardId,
  mode: FightMode | undefined,
  reject: (v: RuleViolation) => StepResult,
): StepResult {
  const found = findInRoom(state, cardId);
  if (!found) return reject({ code: 'cardNotInRoom', cardId });
  const { card, slot } = found;

  // Validate the fight mode before touching anything (no implicit room entry on a rejected play).
  let fightMode: FightMode = 'barehanded';
  if (isMonster(card)) {
    const usable = weaponCanFight(state, card);
    if (mode === 'weapon') {
      if (!state.weapon) return reject({ code: 'noWeapon', cardId });
      if (!usable) return reject({ code: 'weaponCannotFight', cardId, limit: weaponLimit(state) ?? 0 });
      fightMode = 'weapon';
    } else if (mode === undefined) {
      if (usable) return reject({ code: 'modeRequired', cardId }); // A9
      fightMode = 'barehanded';
    } else {
      fightMode = 'barehanded';
    }
  }

  const d = draftOf(state);
  const events: GameEvent[] = [];
  if (d.phase === 'choosing') {
    d.phase = 'resolving';
    events.push({ type: 'RoomEntered', roomNumber: d.roomNumber });
  }

  d.room[slot] = null;
  d.resolvedThisRoom += 1;
  d.lastResolved = card;

  switch (cardKind(card)) {
    case 'weapon': {
      const old = d.weapon;
      const discarded = old ? [old.card, ...old.slain] : [];
      d.discard.push(...discarded);
      d.weapon = { card, slain: [] };
      events.push({ type: 'WeaponEquipped', weapon: card, replaced: old ? old.card : null, discarded });
      break;
    }

    case 'potion': {
      d.discard.push(card);
      if (d.potionUsedThisRoom) {
        events.push({ type: 'PotionWasted', potion: card, reason: 'alreadyUsedThisRoom' });
      } else {
        const hpBefore = d.hp;
        const hpAfter = Math.min(d.maxHp, hpBefore + cardValue(card));
        d.hp = hpAfter;
        d.potionUsedThisRoom = true; // A7: counts even when it heals 0
        events.push({ type: 'PotionUsed', potion: card, healed: hpAfter - hpBefore, hpBefore, hpAfter });
      }
      break;
    }

    case 'monster': {
      const weapon = fightMode === 'weapon' && d.weapon ? d.weapon : null;
      const damage = weapon ? Math.max(0, cardValue(card) - cardValue(weapon.card)) : cardValue(card);
      events.push({ type: 'MonsterFought', monster: card, mode: fightMode, weapon: weapon ? weapon.card : null, damage });
      if (damage > 0) {
        const hpBefore = d.hp;
        const hpAfter = Math.max(0, hpBefore - damage); // A6
        d.hp = hpAfter;
        events.push({ type: 'DamageTaken', amount: damage, hpBefore, hpAfter, source: card });
      }
      if (d.hp <= 0) {
        // The killing monster is resolved (A3: it does not count against the score); it goes to the discard.
        d.discard.push(card);
        const counted = remainingMonsters(d);
        const score = d.hp - sumValues(counted);
        d.phase = 'lost';
        d.score = score;
        events.push({ type: 'GameLost', score, remainingMonsters: counted });
        return { ok: true, state: freezeDraft(d), events };
      }
      if (weapon) {
        d.weapon = { card: weapon.card, slain: [...weapon.slain, card] };
      } else {
        d.discard.push(card);
      }
      events.push({ type: 'MonsterSlain', monster: card, byWeapon: weapon ? weapon.card : null });
      break;
    }
  }

  // Room completion.
  if (isFinalRoom(d)) {
    if (roomCards(d).length === 0) {
      events.push({ type: 'RoomCleared', roomNumber: d.roomNumber, carried: null });
      const potionBonus = winPotionBonus(d);
      const score = d.hp + potionBonus;
      d.phase = 'won';
      d.score = score;
      events.push({ type: 'GameWon', score, hp: d.hp, potionBonus });
    }
  } else if (d.resolvedThisRoom >= CARDS_RESOLVED_PER_ROOM) {
    const carried = roomCards(d)[0] ?? null;
    events.push({ type: 'RoomCleared', roomNumber: d.roomNumber, carried });
    revealNewRoom(d, events, false);
  }

  return { ok: true, state: freezeDraft(d), events };
}

/**
 * Every action currently legal (for UI affordances, hints, and property tests).
 * Order: enterRoom, avoidRoom (if allowed), then playCard per room slot left-to-right.
 * Monsters are always listed with an explicit mode: 'barehanded', plus 'weapon' when the weapon can fight it.
 * Weapons and potions are listed without a mode.
 */
export function legalActions(state: GameState): GameAction[] {
  if (isGameOver(state)) return [];
  const out: GameAction[] = [];
  if (state.phase === 'choosing') {
    out.push({ type: 'enterRoom' });
    if (canAvoidRoom(state)) out.push({ type: 'avoidRoom' });
  }
  for (const card of state.room) {
    if (!card) continue;
    if (isMonster(card)) {
      out.push({ type: 'playCard', cardId: card.id, mode: 'barehanded' });
      if (weaponCanFight(state, card)) out.push({ type: 'playCard', cardId: card.id, mode: 'weapon' });
    } else {
      out.push({ type: 'playCard', cardId: card.id });
    }
  }
  return out;
}

export function canAvoidRoom(state: GameState): boolean {
  return avoidViolation(state) === null;
}

/** True if the equipped weapon may fight this room monster under the degradation rule. */
export function canUseWeaponOn(state: GameState, monsterId: CardId): boolean {
  const found = findInRoom(state, monsterId);
  if (!found || !isMonster(found.card)) return false;
  return weaponCanFight(state, found.card);
}

/**
 * Highest monster value the equipped weapon may still fight, or null when there is no weapon
 * or the weapon is unused (no limit). Render shows this as the weapon's durability badge.
 * 'lte': last slain value; 'lt': last slain value - 1 (RULES.md A1/A2).
 */
export function weaponLimit(state: GameState): number | null {
  const w = state.weapon;
  if (!w) return null;
  const last = w.slain[w.slain.length - 1];
  if (!last) return null;
  return limitFromLastSlain(last, state.rules);
}

/**
 * Damage preview for UI hover: HP that `playCard` would cost with the given mode.
 * Unclamped (matches MonsterFought.damage / DamageTaken.amount). Non-monsters cost 0.
 * 'weapon' with no weapon equipped previews barehanded damage; the degradation limit is NOT checked
 * here (use canUseWeaponOn for legality).
 */
export function previewDamage(state: GameState, monster: Card, mode: FightMode): number {
  if (!isMonster(monster)) return 0;
  if (mode === 'weapon' && state.weapon) {
    return Math.max(0, cardValue(monster) - cardValue(state.weapon.card));
  }
  return cardValue(monster);
}

/**
 * Score per docs/RULES.md. Valid at any time (live score); final once phase is won/lost.
 * Live score (mid-game) = hp - remaining monsters (same scope as the loss score, A3). It equals the
 * loss score at hp 0 and the win score (minus potion bonus) once no monsters remain.
 */
export function computeScore(state: GameState): number {
  if (state.phase === 'won') return state.hp + winPotionBonus(state);
  return state.hp - sumValues(remainingMonsters(state));
}
