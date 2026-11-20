/**
 * NewGameOptions.deck (Design Review 2, impl owner Tyrol). Contract in src/game/engine.ts and docs/TUTORIAL.md
 * "Contracts": the deck is used as given, top first, with no shuffle and no RNG call. It must be non-empty with
 * unique card ids, or createGame throws a RangeError. Everything after that (first deal, events, deckSize, rules)
 * is identical to a shuffled game, and replay with the same options reproduces it.
 */
import { describe, expect, it } from 'vitest';
import {
  DECK_SIZE,
  createGame,
  createRng,
  createSession,
  step,
  type Card,
  type CardId,
  type GameAction,
  type NewGameOptions,
  type Rng,
  type RngFactory,
} from '../../src/game';
import { AVOID, c, cards, deepFreeze, eventsOf, ids, play, run, types } from './helpers';

const TUTORIAL_IDS: CardId[] = ['D5', 'S8', 'C3', 'H5', 'S14', 'C7', 'H10', 'S6', 'C9', 'C4', 'H4', 'D10', 'H2', 'C2'];

/** An RNG factory whose RNG throws if consulted, plus call counters. */
function spyFactory(): { factory: RngFactory; calls: { factory: number; next: number; int: number } } {
  const calls = { factory: 0, next: 0, int: 0 };
  const factory: RngFactory = (seed) => {
    calls.factory++;
    const real = createRng(seed);
    const rng: Rng = {
      next: () => {
        calls.next++;
        return real.next();
      },
      int: (n) => {
        calls.int++;
        return real.int(n);
      },
      getState: () => real.getState(),
    };
    return rng;
  };
  return { factory, calls };
}

describe('createGame({ deck }): exact order, no shuffle', () => {
  it('deals the first 4 cards into slots 1-4 in order and keeps the rest in order, top first', () => {
    const { state } = createGame({ seed: 1, deck: cards(...TUTORIAL_IDS) });
    expect(ids(state.room)).toEqual(['D5', 'S8', 'C3', 'H5']);
    expect(ids(state.deck)).toEqual(TUTORIAL_IDS.slice(4));
    expect(state.phase).toBe('choosing');
    expect(state.roomNumber).toBe(1);
    expect(state.hp).toBe(20);
    expect(state.weapon).toBeNull();
    expect(state.discard).toEqual([]);
  });

  it('a different order gives a different deal (the order is really honoured, not sorted or canonicalised)', () => {
    const rev = [...TUTORIAL_IDS].reverse();
    const { state } = createGame({ seed: 1, deck: cards(...rev) });
    expect(ids(state.room)).toEqual(rev.slice(0, 4));
    expect(ids(state.deck)).toEqual(rev.slice(4));
  });

  it('never consults the RNG', () => {
    const { factory, calls } = spyFactory();
    createGame({ seed: 99, deck: cards(...TUTORIAL_IDS), rngFactory: factory });
    expect(calls.next).toBe(0);
    expect(calls.int).toBe(0);
  });

  it('the result does not depend on the seed or the rngFactory, apart from the recorded seed', () => {
    const a = createGame({ seed: 1, deck: cards(...TUTORIAL_IDS) });
    const b = createGame({ seed: 123456, deck: cards(...TUTORIAL_IDS), rngFactory: spyFactory().factory });
    expect(a.state.seed).toBe(1);
    expect(b.state.seed).toBe(123456);
    expect({ ...b.state, seed: 1 }).toEqual(a.state);
  });

  it('emits the same opening events as a shuffled game: GameStarted (deckSize = deck length), CardDealt x4, RoomRevealed', () => {
    const { events } = createGame({ seed: 0x5c0d, deck: cards(...TUTORIAL_IDS) });
    expect(types(events)).toEqual(['GameStarted', 'CardDealt', 'CardDealt', 'CardDealt', 'CardDealt', 'RoomRevealed']);
    const started = eventsOf(events, 'GameStarted')[0]!;
    expect(started).toEqual({ type: 'GameStarted', seed: 0x5c0d, hp: 20, deckSize: 14 });
    expect(eventsOf(events, 'CardDealt').map((e) => [e.card.id, e.slot, e.deckRemaining])).toEqual([
      ['D5', 0, 13],
      ['S8', 1, 12],
      ['C3', 2, 11],
      ['H5', 3, 10],
    ]);
    expect(eventsOf(events, 'RoomRevealed')[0]).toEqual({ type: 'RoomRevealed', roomNumber: 1, canAvoid: true });
  });

  it('the full 44-card deck in a known order reproduces a shuffled game exactly', () => {
    const shuffled = createGame({ seed: 42 });
    const order = [...shuffled.state.room.map((x) => x!), ...shuffled.state.deck];
    expect(order).toHaveLength(DECK_SIZE);
    const given = createGame({ seed: 42, deck: order });
    expect(given.state).toEqual(shuffled.state);
    expect(given.events).toEqual(shuffled.events);
  });

  it('records the rules it was given', () => {
    const { state } = createGame({ seed: 1, deck: cards(...TUTORIAL_IDS), rules: { weaponLimit: 'lt' } });
    expect(state.rules.weaponLimit).toBe('lt');
  });

  it('does not alias the caller array: mutating it afterwards does not change the game', () => {
    const deck: Card[] = cards(...TUTORIAL_IDS);
    const { state } = createGame({ seed: 1, deck });
    const snapshot = structuredClone(state);
    deck.reverse();
    deck.push(c('S2'));
    expect(state).toEqual(snapshot);
  });

  it('accepts a frozen deck and does not mutate it', () => {
    const deck = deepFreeze(cards(...TUTORIAL_IDS));
    expect(() => createGame({ seed: 1, deck })).not.toThrow();
    expect(deck.map((x) => x.id)).toEqual(TUTORIAL_IDS);
  });

  it('a short deck deals what it has; with the deck empty that room is the final room', () => {
    const { state } = createGame({ seed: 1, deck: cards('S3', 'H4') });
    expect(ids(state.room)).toEqual(['S3', 'H4', null, null]);
    expect(state.deck).toEqual([]);
    const v = step(state, AVOID);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation.code).toBe('cannotAvoidFinalRoom');
    const end = run(state, play('S3', 'barehanded'), play('H4'));
    expect(end.state.phase).toBe('won');
  });

  it('plays on through the real engine: the tutorial deck is winnable with score 30', () => {
    const moves: GameAction[] = [
      play('D5'), play('S8', 'weapon'), play('H5'), AVOID,
      play('S6', 'weapon'), play('C9', 'barehanded'), play('C4', 'weapon'),
      play('H4'), play('H2'), play('D10'),
      play('S14', 'weapon'), play('C7', 'weapon'), play('C3', 'weapon'),
      play('C2', 'weapon'), play('H10'),
    ];
    const end = run(createGame({ seed: 0x5c0d, deck: cards(...TUTORIAL_IDS) }).state, ...moves);
    expect(end.state.phase).toBe('won');
    expect(end.state.score).toBe(30);
  });
});

describe('createGame({ deck }): validation', () => {
  it('an empty deck is a RangeError', () => {
    expect(() => createGame({ seed: 1, deck: [] })).toThrow(RangeError);
  });

  it('duplicate card ids are a RangeError', () => {
    expect(() => createGame({ seed: 1, deck: cards('S2', 'S3', 'S2', 'H4') })).toThrow(RangeError);
    // The duplicate may be far from the top, where it would not be dealt in room 1.
    expect(() => createGame({ seed: 1, deck: cards(...TUTORIAL_IDS, 'D5') })).toThrow(RangeError);
  });

  it('a validation failure does not consult the RNG either', () => {
    const { factory, calls } = spyFactory();
    expect(() => createGame({ seed: 1, deck: [], rngFactory: factory })).toThrow(RangeError);
    expect(calls.next + calls.int).toBe(0);
  });
});

describe('no deck: default behaviour unchanged', () => {
  it('seed 42 still shuffles to the same 44-card order as before Design Review 2 (golden)', () => {
    const { state, events } = createGame({ seed: 42 });
    expect(ids(state.room)).toEqual(['C14', 'S13', 'S7', 'H6']);
    expect(state.deck.map((x) => x.id).join(' ')).toBe(
      'H10 D6 C9 D4 C6 S6 S4 H7 H4 C4 H8 D9 S10 C5 S11 D8 S14 S2 C3 H5 C13 C2 D10 H9 S3 C7 C11 H3 D5 C10 S5 D7 S12 C12 S9 C8 D3 H2 S8 D2',
    );
    expect(eventsOf(events, 'GameStarted')[0]!.deckSize).toBe(DECK_SIZE);
  });

  it('seed 7 golden (the seed the e2e probes use)', () => {
    expect(ids(createGame({ seed: 7 }).state.room)).toEqual(['H2', 'H9', 'D2', 'S10']);
  });

  it('deck: undefined is the same as omitting it', () => {
    const opts = { seed: 42, deck: undefined } as unknown as NewGameOptions;
    expect(createGame(opts)).toEqual(createGame({ seed: 42 }));
  });

  it('the shuffled path still consults the RNG', () => {
    const { factory, calls } = spyFactory();
    createGame({ seed: 5, rngFactory: factory });
    expect(calls.factory).toBe(1);
    expect(calls.next + calls.int).toBeGreaterThan(0);
  });
});

describe('replay with a given deck', () => {
  it('session.replay(opts, history) reproduces the session state', () => {
    const opts: NewGameOptions = { seed: 0x5c0d, deck: cards(...TUTORIAL_IDS) };
    const s = createSession(opts);
    for (const a of [play('D5'), play('S8', 'weapon'), play('H5'), AVOID, play('S6', 'weapon')]) {
      expect(s.dispatch(a).ok).toBe(true);
    }
    const r = createSession({ seed: 1 });
    r.replay(opts, s.history);
    expect(r.state).toEqual(s.state);
    expect(r.history).toEqual(s.history);
  });

  it('newGame with the same options twice gives deep-equal games', () => {
    const opts: NewGameOptions = { seed: 3, deck: cards(...TUTORIAL_IDS) };
    expect(createGame(opts)).toEqual(createGame(opts));
  });
});
