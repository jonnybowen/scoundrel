/**
 * createGame, event emission/order (src/game/events.ts), determinism (seed + history reproduces a game),
 * purity (step never mutates its input), JSON round-tripping, and the GameSession contract.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildDeck,
  createGame,
  createRng,
  createSession,
  DEFAULT_RULES,
  legalActions,
  step,
  type GameAction,
  type GameEvent,
  type GameState,
  type Rng,
} from '../../src/game';
import { c, deepFreeze, eventsOf, expectOk, makeState, play, room, testRng, types } from './helpers';

/** Random legal playthrough from `seed`, choosing actions with a test-local PRNG. */
function randomGame(seed: number, pickSeed = seed): { actions: GameAction[]; states: GameState[]; events: GameEvent[] } {
  const pick = testRng(pickSeed);
  let state = createGame({ seed }).state;
  const actions: GameAction[] = [];
  const states = [state];
  const events: GameEvent[] = [];
  for (let i = 0; i < 1000 && state.phase !== 'won' && state.phase !== 'lost'; i++) {
    const legal = legalActions(state);
    const a = legal[pick(legal.length)]!;
    const t = expectOk(step(state, a));
    actions.push(a);
    states.push(t.state);
    events.push(...t.events);
    state = t.state;
  }
  return { actions, states, events };
}

describe('createGame', () => {
  it('initial state: 20 HP, 4-card room, 40-card deck, room 1, choosing, defaults', () => {
    const { state } = createGame({ seed: 123 });
    expect(state.version).toBe(1);
    expect(state.seed).toBe(123);
    expect(state.rules).toEqual(DEFAULT_RULES);
    expect(state.phase).toBe('choosing');
    expect(state.hp).toBe(20);
    expect(state.maxHp).toBe(20);
    expect(state.room).toHaveLength(4);
    expect(state.room.every((x) => x !== null)).toBe(true);
    expect(state.deck).toHaveLength(40);
    expect(state.weapon).toBeNull();
    expect(state.discard).toEqual([]);
    expect(state.avoidedLastRoom).toBe(false);
    expect(state.resolvedThisRoom).toBe(0);
    expect(state.potionUsedThisRoom).toBe(false);
    expect(state.lastResolved).toBeNull();
    expect(state.roomNumber).toBe(1);
    expect(state.score).toBeNull();
  });

  it('room + deck is a permutation of the 44-card deck', () => {
    const { state } = createGame({ seed: 9 });
    const all = [...state.room.map((x) => x!.id), ...state.deck.map((x) => x.id)].sort();
    expect(all).toEqual(buildDeck().map((x) => x.id).sort());
  });

  it('events: GameStarted, CardDealt x4 (slots 0..3), RoomRevealed', () => {
    const { state, events } = createGame({ seed: 5 });
    expect(types(events)).toEqual(['GameStarted', 'CardDealt', 'CardDealt', 'CardDealt', 'CardDealt', 'RoomRevealed']);
    expect(events[0]).toEqual({ type: 'GameStarted', seed: 5, hp: 20, deckSize: 44 });
    const dealt = eventsOf(events, 'CardDealt');
    expect(dealt.map((e) => e.slot)).toEqual([0, 1, 2, 3]);
    expect(dealt.map((e) => e.deckRemaining)).toEqual([43, 42, 41, 40]);
    expect(dealt.map((e) => e.card)).toEqual(state.room);
    expect(events[5]).toEqual({ type: 'RoomRevealed', roomNumber: 1, canAvoid: true });
  });

  it('merges partial rules over the defaults', () => {
    expect(createGame({ seed: 1, rules: { weaponLimit: 'lt' } }).state.rules).toEqual({ weaponLimit: 'lt', lossScoreScope: 'dungeon' });
    expect(createGame({ seed: 1, rules: { lossScoreScope: 'deckOnly' } }).state.rules).toEqual({ weaponLimit: 'lte', lossScoreScope: 'deckOnly' });
  });

  it('events and state are JSON-serialisable', () => {
    const t = createGame({ seed: 77 });
    expect(JSON.parse(JSON.stringify(t.state))).toEqual(t.state);
    expect(JSON.parse(JSON.stringify(t.events))).toEqual(t.events);
  });
});

describe('determinism', () => {
  it('same seed => same deck, room and events', () => {
    expect(createGame({ seed: 2026 })).toEqual(createGame({ seed: 2026 }));
  });

  it('different seeds => different deals', () => {
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => createGame({ seed }).state.deck.map((x) => x.id).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('uses the injected rngFactory (seed only reaches the deal through it)', () => {
    const constant: Rng = { next: () => 0, int: () => 0, getState: () => 0 };
    const factory = vi.fn((_seed: number) => constant);
    const a = createGame({ seed: 1, rngFactory: factory });
    const b = createGame({ seed: 999, rngFactory: factory });
    expect(factory).toHaveBeenCalledWith(1);
    expect(factory).toHaveBeenCalledWith(999);
    expect(a.state.deck).toEqual(b.state.deck);
    expect(a.state.room).toEqual(b.state.room);
  });

  it('default factory matches explicit createRng', () => {
    expect(createGame({ seed: 31, rngFactory: createRng }).state).toEqual(createGame({ seed: 31 }).state);
  });

  it('replaying the action history from the seed reproduces every state', () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      const { actions, states } = randomGame(seed);
      let s = createGame({ seed }).state;
      actions.forEach((a, i) => {
        s = expectOk(step(s, a)).state;
        expect(s).toEqual(states[i + 1]);
      });
    }
  });
});

describe('purity', () => {
  it('step never mutates its input state (deep-frozen), for accepted and rejected actions', () => {
    for (const seed of [7, 8, 9]) {
      const pick = testRng(seed * 31);
      let state = deepFreeze(createGame({ seed }).state);
      while (state.phase !== 'won' && state.phase !== 'lost') {
        const snapshot = structuredClone(state);
        // a few illegal probes first
        step(state, { type: 'playCard', cardId: 'nope' });
        step(state, { type: 'enterRoom' });
        step(state, { type: 'avoidRoom' });
        expect(state).toEqual(snapshot);
        const legal = legalActions(state);
        const t = expectOk(step(state, legal[pick(legal.length)]!));
        expect(state).toEqual(snapshot);
        state = deepFreeze(t.state);
      }
    }
  });

  it('same (state, action) => same result; a JSON copy of state behaves identically', () => {
    const s = makeState({ phase: 'resolving', room: room('S9', 'C3', 'D4', 'H5'), weapon: { card: c('D5'), slain: [] } });
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(step(s, play('S9', 'weapon'))).toEqual(step(s, play('S9', 'weapon')));
    expect(step(copy, play('S9', 'weapon'))).toEqual(step(s, play('S9', 'weapon')));
  });

  it('a rejected step returns state equal to the input', () => {
    const s = makeState({ avoidedLastRoom: true });
    const r = step(s, { type: 'avoidRoom' });
    expect(r.ok).toBe(false);
    expect(r.state).toEqual(s);
  });
});

describe('GameSession', () => {
  it('starts at createGame state with empty history', () => {
    const session = createSession({ seed: 10 });
    expect(session.state).toEqual(createGame({ seed: 10 }).state);
    expect(session.history).toEqual([]);
  });

  it('dispatch: accepted actions update state, notify listeners in order and append to history', () => {
    const session = createSession({ seed: 10 });
    const calls: string[] = [];
    session.subscribe((events, state) => {
      calls.push(`a:${types(events).join(',')}`);
      expect(state).toBe(session.state);
    });
    session.subscribe(() => calls.push('b'));
    const r = session.dispatch({ type: 'enterRoom' });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['a:RoomEntered', 'b']);
    expect(session.state.phase).toBe('resolving');
    expect(session.history).toEqual([{ type: 'enterRoom' }]);
  });

  it('rejected actions do not notify and are not recorded', () => {
    const session = createSession({ seed: 10 });
    const listener = vi.fn();
    session.subscribe(listener);
    const before = session.state;
    const r = session.dispatch({ type: 'playCard', cardId: 'nope' });
    expect(r.ok).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(session.history).toEqual([]);
    expect(session.state).toEqual(before);
  });

  it('unsubscribe stops notifications', () => {
    const session = createSession({ seed: 10 });
    const listener = vi.fn();
    const off = session.subscribe(listener);
    off();
    session.dispatch({ type: 'enterRoom' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('newGame resets state + history and broadcasts the opening events', () => {
    const session = createSession({ seed: 10 });
    session.dispatch({ type: 'enterRoom' });
    const listener = vi.fn();
    session.subscribe(listener);
    session.newGame({ seed: 11 });
    expect(session.state).toEqual(createGame({ seed: 11 }).state);
    expect(session.history).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toEqual(createGame({ seed: 11 }).events);
  });

  it('replay(seed, history) reproduces the game and emits one combined batch', () => {
    const live = createSession({ seed: 55 });
    const pick = testRng(55);
    for (let i = 0; i < 25 && live.state.phase !== 'won' && live.state.phase !== 'lost'; i++) {
      const legal = legalActions(live.state);
      live.dispatch(legal[pick(legal.length)]!);
    }
    const other = createSession({ seed: 1 });
    const listener = vi.fn();
    other.subscribe(listener);
    other.replay({ seed: 55 }, live.history);
    expect(other.state).toEqual(live.state);
    expect(other.history).toEqual(live.history);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(types(listener.mock.calls[0]![0] as GameEvent[])[0]).toBe('GameStarted');
  });

  it('replay with an illegal log throws and leaves the session unchanged (Tyrol decision)', () => {
    const session = createSession({ seed: 3 });
    session.dispatch({ type: 'enterRoom' });
    const before = structuredClone(session.state);
    expect(() => session.replay({ seed: 3 }, [{ type: 'enterRoom' }, { type: 'enterRoom' }])).toThrow();
    expect(session.state).toEqual(before);
    expect(session.history).toEqual([{ type: 'enterRoom' }]);
  });
});

