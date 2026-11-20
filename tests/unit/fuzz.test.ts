/**
 * Property/fuzz tests. Repro: every failure message names the seed.
 *
 * 1. Uniform random legal play on real 44-card games (both rule variants), with junk-action probes.
 *    Uniform play almost always dies early, so it covers mid-game only.
 * 2. A per-room search policy on real games, which regularly reaches the final room (A4).
 * 3. Random small hand-built dungeons, where wins are common, to cover the win path and scoring.
 *
 * Invariants checked after every step: never throws, every legalAction is accepted, rejected actions leave
 * state unchanged, HP in [0, 20], cards conserved, score null until the end, canAvoidRoom agrees with
 * legalActions, the game terminates, and the final score matches an independent computation.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  canAvoidRoom,
  cardKind,
  computeScore,
  createGame,
  legalActions,
  step,
  weaponLimit,
  type Card,
  type GameAction,
  type GameEvent,
  type GameState,
  type RulesOptions,
} from '../../src/game';
import { allCardIds, makeState, testRng } from './helpers';

/** Explicit per-test budget: these loops are deterministic but CPU-bound, so never rely on Vitest's 5s default. */
const FUZZ_TIMEOUT_MS = 30_000;
const SEARCH_SEEDS = 100;
const MAX_STEPS = 600; // a 44-card game needs far fewer; hitting this is a non-terminating bug
const VARIANTS: Partial<RulesOptions>[] = [{}, { weaponLimit: 'lt', lossScoreScope: 'deckOnly' }];

const junkActions: GameAction[] = [
  { type: 'enterRoom' },
  { type: 'avoidRoom' },
  { type: 'playCard', cardId: 'S14', mode: 'weapon' },
  { type: 'playCard', cardId: 'H10' },
  { type: 'playCard', cardId: 'C2', mode: 'barehanded' },
  { type: 'playCard', cardId: 'zzz' },
];

const isOver = (s: GameState) => s.phase === 'won' || s.phase === 'lost';
const monsterSum = (cs: readonly (Card | null)[]) =>
  cs.reduce((acc, x) => acc + (x && cardKind(x) === 'monster' ? x.rank : 0), 0);

function checkInvariants(s: GameState, cardSet: string[], ctx: string): void {
  expect(s.hp, ctx).toBeGreaterThanOrEqual(0);
  expect(s.hp, ctx).toBeLessThanOrEqual(20);
  expect(s.room, ctx).toHaveLength(4);
  expect(allCardIds(s).sort(), `${ctx}: cards conserved`).toEqual(cardSet);
  expect(s.resolvedThisRoom, ctx).toBeLessThanOrEqual(4);
  expect(s.score === null, ctx).toBe(!isOver(s));
  if (s.phase === 'lost') expect(s.hp, ctx).toBe(0);
  if (s.phase === 'won') expect(s.hp, ctx).toBeGreaterThan(0);
  expect(canAvoidRoom(s), ctx).toBe(legalActions(s).some((a) => a.type === 'avoidRoom'));
  if (s.deck.length === 0) expect(canAvoidRoom(s), `${ctx}: final room is never avoidable`).toBe(false);
}

/** Independent re-computation of the final score from RULES.md, compared with the engine's. */
function checkFinalScore(s: GameState, lastEvents: readonly GameEvent[], ctx: string): void {
  expect(s.score, ctx).toBe(computeScore(s));
  const last = lastEvents.at(-1);
  if (s.phase === 'won') {
    const bonus = s.hp === 20 && s.lastResolved && cardKind(s.lastResolved) === 'potion' ? s.lastResolved.rank : 0;
    expect(s.room.every((x) => x === null), `${ctx}: won with cards left`).toBe(true);
    expect(s.deck, ctx).toEqual([]);
    expect(s.score, ctx).toBe(s.hp + bonus);
    expect(last, ctx).toEqual({ type: 'GameWon', score: s.hp + bonus, hp: s.hp, potionBonus: bonus });
  } else {
    const remaining = monsterSum(s.deck) + (s.rules.lossScoreScope === 'dungeon' ? monsterSum(s.room) : 0);
    expect(s.score, ctx).toBe(0 - remaining);
    expect(last?.type, ctx).toBe('GameLost');
  }
}

type Policy = (s: GameState, pick: (n: number) => number) => GameAction;

function playOut(start: GameState, policy: Policy, seed: number, label: string): { end: GameState; sawFinalRoomSizes: number[] } {
  const pick = testRng(seed ^ 0x9e3779b9);
  const cardSet = allCardIds(start).sort();
  let s = start;
  let lastEvents: readonly GameEvent[] = [];
  const sawFinalRoomSizes: number[] = [];
  checkInvariants(s, cardSet, `${label} seed ${seed} start`);
  for (let i = 0; i < MAX_STEPS; i++) {
    const ctx = `${label} seed ${seed} step ${i}`;
    if (isOver(s)) {
      expect(legalActions(s), ctx).toEqual([]);
      checkFinalScore(s, lastEvents, ctx);
      return { end: s, sawFinalRoomSizes };
    }
    const junk = junkActions[pick(junkActions.length)]!;
    const jr = step(s, junk);
    if (!jr.ok) expect(jr.state, `${ctx}: rejected junk changed state`).toEqual(s);

    const legal = legalActions(s);
    expect(legal.length, ctx).toBeGreaterThan(0);
    const a = policy(s, pick);
    const r = step(s, a);
    if (!r.ok) throw new Error(`${ctx}: action ${JSON.stringify(a)} rejected: ${JSON.stringify(r.violation)}`);
    const wasFinal = s.deck.length === 0 && s.phase === 'choosing';
    if (r.state.phase === 'lost') {
      // Death never slays or clears, even when it lands on a room-completing card (Tyrol decision).
      const batch = r.events.map((e) => e.type);
      expect(batch, `${ctx}: losing batch`).not.toContain('MonsterSlain');
      expect(batch, `${ctx}: losing batch`).not.toContain('RoomCleared');
      expect(batch, `${ctx}: losing batch`).not.toContain('CardDealt');
      expect(batch, `${ctx}: losing batch`).not.toContain('RoomRevealed');
      expect(batch.at(-1), `${ctx}: losing batch`).toBe('GameLost');
    }
    s = r.state;
    lastEvents = r.events;
    checkInvariants(s, cardSet, ctx);
    if (!wasFinal && s.deck.length === 0 && s.phase === 'choosing') {
      sawFinalRoomSizes.push(s.room.filter((x) => x !== null).length);
    }
  }
  throw new Error(`${label} seed ${seed}: game did not terminate within ${MAX_STEPS} steps`);
}

const uniform: Policy = (s, pick) => {
  const legal = legalActions(s);
  return legal[pick(legal.length)]!;
};

/** Exhaustive search over the current room's play orders; avoids only rooms that are certain death. */
const search: Policy = (s) => {
  const value = (x: GameState) =>
    x.phase === 'lost' ? -1e6 : x.phase === 'won' ? 1e6 + x.hp : x.hp * 4 + (x.weapon ? x.weapon.card.rank * 2 + (weaponLimit(x) ?? 15) : 0);
  const best = (x: GameState, roomNo: number): { v: number; first: GameAction | null } => {
    if (isOver(x) || x.roomNumber !== roomNo) return { v: value(x), first: null };
    let out = { v: -Infinity, first: null as GameAction | null };
    for (const a of legalActions(x)) {
      if (a.type !== 'playCard') continue;
      const r = step(x, a);
      if (!r.ok) continue;
      const sub = best(r.state, roomNo);
      if (sub.v > out.v) out = { v: sub.v, first: a };
    }
    return out;
  };
  const b = best(s, s.roomNumber);
  if (b.v < -1e5 && canAvoidRoom(s)) return { type: 'avoidRoom' };
  return b.first ?? legalActions(s)[0]!;
};

describe('fuzz: uniform random play on real games', () => {
  for (const rules of VARIANTS) {
    it(`300 seeds terminate with consistent state and scores (rules ${JSON.stringify(rules)})`, () => {
      for (let seed = 1; seed <= 300; seed++) {
        playOut(createGame({ seed, rules }).state, uniform, seed, 'uniform');
      }
    }, FUZZ_TIMEOUT_MS);
  }
});

describe('fuzz: search policy on real games (reaches the A4 endgame)', () => {
  for (const rules of VARIANTS) {
    it(`${SEARCH_SEEDS} seeds; every real final room holds exactly 2 cards (rules ${JSON.stringify(rules)})`, () => {
      const finalSizes: number[] = [];
      for (let seed = 1; seed <= SEARCH_SEEDS; seed++) {
        finalSizes.push(...playOut(createGame({ seed, rules }).state, search, seed, 'search').sawFinalRoomSizes);
      }
      // 44 = 4 + 3*13 + 1: the last refill deals 1 card next to the carried card (Tyrol decision, follows from A4).
      expect(finalSizes.length, 'search policy should reach the final room sometimes').toBeGreaterThan(0);
      expect(new Set(finalSizes)).toEqual(new Set([2]));
    }, FUZZ_TIMEOUT_MS);
  }
});

describe('fuzz: random small hand-built dungeons (win path)', () => {
  /** k random cards from the real deck, monsters capped at 8 so wins happen. */
  function smallDungeon(seed: number, rules: Partial<RulesOptions>): GameState {
    const pick = testRng(seed * 7919);
    const pool = buildDeck().filter((x) => cardKind(x) !== 'monster' || x.rank <= 8);
    const chosen: Card[] = [];
    const k = 4 + pick(13); // 4..16 cards
    while (chosen.length < k) chosen.push(...pool.splice(pick(pool.length), 1));
    return makeState({ seed, rules, room: chosen.slice(0, 4), deck: chosen.slice(4) });
  }

  for (const rules of VARIANTS) {
    it(`500 dungeons: wins and losses both occur and score consistently (rules ${JSON.stringify(rules)})`, () => {
      let wins = 0;
      let bonusWins = 0;
      for (let seed = 1; seed <= 500; seed++) {
        const policy = seed % 2 === 0 ? uniform : search;
        const { end } = playOut(smallDungeon(seed, rules), policy, seed, 'small');
        if (end.phase === 'won') {
          wins++;
          if (end.score! > end.hp) bonusWins++;
        }
      }
      expect(wins).toBeGreaterThan(0);
      expect(wins).toBeLessThan(500);
      expect(bonusWins).toBeGreaterThan(0);
    }, FUZZ_TIMEOUT_MS);
  }
});
