/**
 * Tyrol's colocated engine dev tests. The main rules suite lives in tests/unit (owner: Tigh).
 */
import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  canAvoidRoom,
  canUseWeaponOn,
  computeScore,
  createGame,
  createRng,
  createSession,
  legalActions,
  previewDamage,
  seedFromString,
  shuffle,
  step,
  weaponLimit,
  DEFAULT_RULES,
} from './index';
import type { Card, GameAction, GameEvent, GameState, Rank, Suit } from './index';

const c = (id: string): Card => {
  const suit: Suit = ({ C: 'clubs', S: 'spades', D: 'diamonds', H: 'hearts' } as const)[id[0] as 'C']!;
  return { id, suit, rank: Number(id.slice(1)) as Rank };
};

/** Hand-built state: room from ids (null for empty), deck from ids (top first). */
function mkState(over: Partial<Omit<GameState, 'room' | 'deck'>> & { room: (string | null)[]; deck?: string[] }): GameState {
  const { room, deck, ...rest } = over;
  return {
    version: 1,
    seed: 0,
    rules: DEFAULT_RULES,
    phase: 'choosing',
    hp: 20,
    maxHp: 20,
    weapon: null,
    discard: [],
    avoidedLastRoom: false,
    resolvedThisRoom: 0,
    potionUsedThisRoom: false,
    lastResolved: null,
    roomNumber: 1,
    score: null,
    ...rest,
    room: room.map((x) => (x ? c(x) : null)),
    deck: (deck ?? ['C2', 'C3', 'C4', 'C5', 'C6']).map(c),
  };
}

function ok(state: GameState, action: GameAction) {
  const r = step(state, action);
  if (!r.ok) throw new Error(`unexpected violation ${JSON.stringify(r.violation)}`);
  return r;
}
const types = (es: readonly GameEvent[]) => es.map((e) => e.type);

describe('deck + rng', () => {
  it('builds 44 unique cards with no red faces/aces', () => {
    const d = buildDeck();
    expect(d).toHaveLength(44);
    expect(new Set(d.map((x) => x.id)).size).toBe(44);
    expect(d.filter((x) => (x.suit === 'hearts' || x.suit === 'diamonds') && x.rank > 10)).toEqual([]);
  });
  it('shuffle is deterministic, non-mutating, a permutation', () => {
    const d = buildDeck();
    const a = shuffle(d, createRng(42));
    const b = shuffle(d, createRng(42));
    expect(a).toEqual(b);
    expect(d).toEqual(buildDeck());
    expect([...a].sort((x, y) => x.id.localeCompare(y.id))).toEqual([...d].sort((x, y) => x.id.localeCompare(y.id)));
    expect(shuffle(d, createRng(43))).not.toEqual(a);
  });
  it('rng range + seedFromString', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r.int(5)).toBeLessThan(5);
    }
    expect(seedFromString('2026-11-20')).toBe(seedFromString('2026-11-20'));
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});

describe('createGame', () => {
  it('emits GameStarted, 4 CardDealt, RoomRevealed', () => {
    const { state, events } = createGame({ seed: 1 });
    expect(types(events)).toEqual(['GameStarted', 'CardDealt', 'CardDealt', 'CardDealt', 'CardDealt', 'RoomRevealed']);
    expect(events[0]).toEqual({ type: 'GameStarted', seed: 1, hp: 20, deckSize: 44 });
    expect(state.deck).toHaveLength(40);
    expect(state.room.every((x) => x)).toBe(true);
    expect(events[5]).toEqual({ type: 'RoomRevealed', roomNumber: 1, canAvoid: true });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('avoid', () => {
  it('sends room to bottom in slot order and forbids twice in a row', () => {
    const s0 = createGame({ seed: 5 }).state;
    const r = ok(s0, { type: 'avoidRoom' });
    expect(types(r.events)).toEqual(['RoomAvoided', 'CardDealt', 'CardDealt', 'CardDealt', 'CardDealt', 'RoomRevealed']);
    expect(r.state.deck.slice(-4)).toEqual(s0.room);
    expect(r.state.roomNumber).toBe(2);
    expect(step(r.state, { type: 'avoidRoom' })).toMatchObject({ ok: false, violation: { code: 'cannotAvoidTwice' } });
  });
  it('cannot avoid after entering or in final room', () => {
    const s = mkState({ room: ['C2', 'C3', 'H4', 'D5'] });
    const e = ok(s, { type: 'enterRoom' });
    expect(step(e.state, { type: 'avoidRoom' })).toMatchObject({ ok: false, violation: { code: 'cannotAvoidAfterEntering' } });
    const fin = mkState({ room: ['C2', 'C3', null, null], deck: [] });
    expect(canAvoidRoom(fin)).toBe(false);
    expect(step(fin, { type: 'avoidRoom' })).toMatchObject({ ok: false, violation: { code: 'cannotAvoidFinalRoom' } });
  });
});

describe('weapons and monsters', () => {
  it('5 weapon, Queen, then 6, then Queen barehanded only (A2)', () => {
    let s = mkState({ room: ['D5', 'S12', 'C6', 'H2'], deck: ['S11', 'C12', 'H3', 'C3'] });
    s = ok(s, { type: 'playCard', cardId: 'D5' }).state;
    expect(weaponLimit(s)).toBeNull();
    expect(step(s, { type: 'playCard', cardId: 'S12' })).toMatchObject({ ok: false, violation: { code: 'modeRequired' } });
    const q = ok(s, { type: 'playCard', cardId: 'S12', mode: 'weapon' });
    expect(types(q.events)).toEqual(['MonsterFought', 'DamageTaken', 'MonsterSlain']);
    s = q.state;
    expect(s.hp).toBe(13);
    expect(weaponLimit(s)).toBe(12);
    const six = ok(s, { type: 'playCard', cardId: 'C6', mode: 'weapon' });
    expect(types(six.events)).toEqual(['MonsterFought', 'DamageTaken', 'MonsterSlain', 'RoomCleared', 'CardDealt', 'CardDealt', 'CardDealt', 'RoomRevealed']);
    s = six.state;
    expect(weaponLimit(s)).toBe(6);
    expect(s.room.map((x) => x?.id)).toEqual(['S11', 'C12', 'H3', 'H2']); // carried H2 keeps slot 3
    expect(canUseWeaponOn(s, 'C12')).toBe(false);
    expect(step(s, { type: 'playCard', cardId: 'C12', mode: 'weapon' })).toMatchObject({
      ok: false,
      violation: { code: 'weaponCannotFight', limit: 6 },
    });
    // No usable weapon -> mode may be omitted (barehanded).
    const bh = ok(s, { type: 'playCard', cardId: 'C12' });
    // hp 12 - 12 = 0: dies, so no MonsterSlain.
    expect(types(bh.events)).toEqual(['RoomEntered', 'MonsterFought', 'DamageTaken', 'GameLost']);
    expect(bh.state.hp).toBe(0);
  });
  it("'lt' option is strict", () => {
    const s = mkState({
      rules: { ...DEFAULT_RULES, weaponLimit: 'lt' },
      room: ['C6', 'C5', 'H2', 'H3'],
      weapon: { card: c('D3'), slain: [c('S6')] },
    });
    expect(weaponLimit(s)).toBe(5);
    expect(canUseWeaponOn(s, 'C6')).toBe(false);
    expect(canUseWeaponOn(s, 'C5')).toBe(true);
    const lte = { ...s, rules: DEFAULT_RULES };
    expect(canUseWeaponOn(lte, 'C6')).toBe(true);
  });
  it('equipping replaces and discards weapon + stack', () => {
    const s = mkState({ room: ['D7', 'C2', 'H2', 'H3'], weapon: { card: c('D3'), slain: [c('S6'), c('C4')] } });
    const r = ok(s, { type: 'playCard', cardId: 'D7' });
    expect(r.events).toContainEqual({ type: 'WeaponEquipped', weapon: c('D7'), replaced: c('D3'), discarded: [c('D3'), c('S6'), c('C4')] });
    expect(r.state.weapon).toEqual({ card: c('D7'), slain: [] });
    expect(r.state.discard).toEqual([c('D3'), c('S6'), c('C4')]);
  });
  it('previewDamage', () => {
    const s = mkState({ room: ['C9', 'C2', 'H2', 'H3'], weapon: { card: c('D3'), slain: [] } });
    expect(previewDamage(s, c('C9'), 'weapon')).toBe(6);
    expect(previewDamage(s, c('C2'), 'weapon')).toBe(0);
    expect(previewDamage(s, c('C9'), 'barehanded')).toBe(9);
  });
  it('zero-damage weapon fight emits no DamageTaken', () => {
    const s = mkState({ room: ['C2', 'C3', 'H2', 'H3'], weapon: { card: c('D5'), slain: [] }, phase: 'resolving' });
    expect(types(ok(s, { type: 'playCard', cardId: 'C2', mode: 'weapon' }).events)).toEqual(['MonsterFought', 'MonsterSlain']);
  });
});

describe('potions', () => {
  it('one heal per room; full-HP potion still counts (A7)', () => {
    const s = mkState({ room: ['H5', 'H6', 'C2', 'C3'], hp: 20 });
    const a = ok(s, { type: 'playCard', cardId: 'H5' });
    expect(a.events).toContainEqual({ type: 'PotionUsed', potion: c('H5'), healed: 0, hpBefore: 20, hpAfter: 20 });
    const b = ok({ ...a.state, hp: 10 }, { type: 'playCard', cardId: 'H6' });
    expect(types(b.events)).toEqual(['PotionWasted']);
    expect(b.state.hp).toBe(10);
  });
  it('heal caps at 20 and resets next room', () => {
    const s = mkState({ room: ['H9', 'C2', 'C3', 'H4'], hp: 15, deck: ['H8', 'C4', 'C5', 'C6'] });
    let r = ok(s, { type: 'playCard', cardId: 'H9' });
    expect(r.state.hp).toBe(20);
    r = ok(r.state, { type: 'playCard', cardId: 'C2' });
    r = ok(r.state, { type: 'playCard', cardId: 'C3' });
    expect(r.state.potionUsedThisRoom).toBe(false);
    r = ok(r.state, { type: 'playCard', cardId: 'H8' });
    expect(r.state.hp).toBe(20);
    expect(types(r.events)).toContain('PotionUsed');
  });
});

describe('end of game', () => {
  it('loss: clamps hp, score subtracts deck + unresolved room monsters (A3, A6)', () => {
    const s = mkState({ room: ['S14', 'C5', 'H2', 'D3'], hp: 4, deck: ['C10', 'H5'] });
    const r = ok(s, { type: 'playCard', cardId: 'S14' });
    expect(types(r.events)).toEqual(['RoomEntered', 'MonsterFought', 'DamageTaken', 'GameLost']);
    expect(r.events[2]).toEqual({ type: 'DamageTaken', amount: 14, hpBefore: 4, hpAfter: 0, source: c('S14') });
    expect(r.state.phase).toBe('lost');
    expect(r.state.score).toBe(-15);
    expect(computeScore(r.state)).toBe(-15);
    expect(step(r.state, { type: 'enterRoom' })).toMatchObject({ ok: false, violation: { code: 'gameOver' } });
    expect(legalActions(r.state)).toEqual([]);
    const deckOnly = ok({ ...s, rules: { ...DEFAULT_RULES, lossScoreScope: 'deckOnly' } }, { type: 'playCard', cardId: 'S14' });
    expect(deckOnly.state.score).toBe(-10);
  });
  it('final room must resolve all cards; potion bonus at 20 HP (A4, A8)', () => {
    const s = mkState({ room: ['C2', null, 'H5', null], deck: [], hp: 18, phase: 'resolving', resolvedThisRoom: 0 });
    let r = ok(s, { type: 'playCard', cardId: 'C2' });
    expect(r.state.phase).toBe('resolving');
    r = ok(r.state, { type: 'playCard', cardId: 'H5' });
    expect(types(r.events)).toEqual(['PotionUsed', 'RoomCleared', 'GameWon']);
    expect(r.events[2]).toEqual({ type: 'GameWon', score: 25, hp: 20, potionBonus: 5 });
  });
  it('no bonus below 20 HP', () => {
    const s = mkState({ room: ['H2', null, null, null], deck: [], hp: 10 });
    const r = ok(s, { type: 'playCard', cardId: 'H2' });
    expect(r.state.score).toBe(12);
  });
});

describe('full random games', () => {
  function playRandom(seed: number) {
    const pick = createRng(seed ^ 0x9e3779b9);
    let { state } = createGame({ seed });
    const log: GameAction[] = [];
    let guard = 0;
    while (state.phase !== 'won' && state.phase !== 'lost' && guard++ < 500) {
      const acts = legalActions(state);
      expect(acts.length).toBeGreaterThan(0);
      for (const a of acts) expect(step(state, a).ok).toBe(true);
      const a = acts[pick.int(acts.length)]!;
      const before = JSON.stringify(state);
      const r = ok(state, a);
      expect(JSON.stringify(state)).toBe(before); // no input mutation
      // card conservation
      const all = [...r.state.deck, ...r.state.room.filter(Boolean), ...r.state.discard, ...(r.state.weapon ? [r.state.weapon.card, ...r.state.weapon.slain] : [])];
      expect(all).toHaveLength(44);
      state = r.state;
      log.push(a);
    }
    return { state, log };
  }
  it('play to completion, conserve cards, replay reproduces', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state, log } = playRandom(seed);
      expect(['won', 'lost']).toContain(state.phase);
      expect(state.score).toBe(computeScore(state));
      const sess = createSession({ seed: 999 });
      const batches: (readonly GameEvent[])[] = [];
      sess.subscribe((e) => batches.push(e));
      sess.replay({ seed }, log);
      expect(sess.state).toEqual(state);
      expect(sess.history).toEqual(log);
      expect(batches).toHaveLength(1);
      expect(batches[0]![batches[0]!.length - 1]!.type).toBe(state.phase === 'won' ? 'GameWon' : 'GameLost');
    }
  });
});

describe('session', () => {
  it('dispatch notifies on success only; unsubscribe works', () => {
    const s = createSession({ seed: 3 });
    const seen: string[][] = [];
    const un = s.subscribe((e) => seen.push(types(e)));
    expect(s.dispatch({ type: 'playCard', cardId: 'nope' }).ok).toBe(false);
    expect(seen).toEqual([]);
    expect(s.dispatch({ type: 'enterRoom' }).ok).toBe(true);
    expect(seen).toEqual([['RoomEntered']]);
    expect(s.history).toEqual([{ type: 'enterRoom' }]);
    un();
    s.newGame({ seed: 4 });
    expect(seen).toHaveLength(1);
    expect(s.history).toEqual([]);
  });
  it('replay throws atomically on an illegal log', () => {
    const s = createSession({ seed: 3 });
    const before = s.state;
    expect(() => s.replay({ seed: 3 }, [{ type: 'avoidRoom' }, { type: 'avoidRoom' }])).toThrow(/cannotAvoidTwice/);
    expect(s.state).toBe(before);
  });
});
