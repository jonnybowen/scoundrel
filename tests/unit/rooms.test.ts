/**
 * Room lifecycle: clearing after 3 cards, carry-over slot stability, refill order, room numbering (A10),
 * and the final room (A4).
 */
import { describe, expect, it } from 'vitest';
import { canAvoidRoom, legalActions, step } from '../../src/game';
import { AVOID, c, cards, eventsOf, expectOk, expectViolation, ids, makeState, play, room, run, types } from './helpers';

describe('clearing a room', () => {
  const start = () =>
    makeState({ room: room('S2', 'C3', 'H4', 'D5'), deck: cards('C6', 'C7', 'C8', 'C9', 'C10') });

  it('after the 3rd card: RoomCleared, the 4th card carries in its slot, 3 new cards fill the rest', () => {
    const t = run(start(), play('S2'), play('C3'), play('H4'));
    expect(ids(t.state.room)).toEqual(['C6', 'C7', 'C8', 'D5']);
    expect(ids(t.state.deck)).toEqual(['C9', 'C10']);
    expect(t.state.phase).toBe('choosing');
    expect(t.state.resolvedThisRoom).toBe(0);
    expect(t.state.potionUsedThisRoom).toBe(false);
    expect(t.state.roomNumber).toBe(2);
    expect(t.state.avoidedLastRoom).toBe(false);
    expect(t.state.lastResolved).toEqual(c('H4'));
    expect(t.state.hp).toBe(19);

    const tail = t.events.slice(t.events.findIndex((e) => e.type === 'RoomCleared'));
    expect(tail).toEqual([
      { type: 'RoomCleared', roomNumber: 1, carried: c('D5') },
      { type: 'CardDealt', card: c('C6'), slot: 0, deckRemaining: 4 },
      { type: 'CardDealt', card: c('C7'), slot: 1, deckRemaining: 3 },
      { type: 'CardDealt', card: c('C8'), slot: 2, deckRemaining: 2 },
      { type: 'RoomRevealed', roomNumber: 2, canAvoid: true },
    ]);
  });

  it('a carried card in a middle slot stays put; new cards fill empty slots left to right', () => {
    const t = run(start(), play('S2'), play('C3'), play('D5'));
    expect(ids(t.state.room)).toEqual(['C6', 'C7', 'H4', 'C8']);
    expect(eventsOf(t.events, 'CardDealt').map((e) => e.slot)).toEqual([0, 1, 3]);
    expect(eventsOf(t.events, 'RoomCleared')).toEqual([{ type: 'RoomCleared', roomNumber: 1, carried: c('H4') }]);
  });

  it('the carried card can be played in the next room', () => {
    const t = run(start(), play('S2'), play('C3'), play('H4'), play('D5'));
    expect(t.state.weapon).toEqual({ card: c('D5'), slain: [] });
  });

  it('only the first 3 resolutions count: room is not cleared after 2', () => {
    const t = run(start(), play('S2'), play('C3'));
    expect(t.state.phase).toBe('resolving');
    expect(t.state.resolvedThisRoom).toBe(2);
    expect(types(t.events)).not.toContain('RoomCleared');
  });
});

describe('A10 room numbering', () => {
  it('increments on every deal, including after an avoid', () => {
    const s = makeState({ room: room('S2', 'C3', 'H4', 'D5'), deck: cards('H2', 'H3', 'H6', 'H7', 'S4', 'S5', 'S6') });
    const avoided = expectOk(step(s, AVOID)).state;
    expect(avoided.roomNumber).toBe(2);
    const [a, b, d] = avoided.room.filter((x) => x !== null).map((x) => x.id);
    const t = run(avoided, play(a!), play(b!), play(d!));
    expect(t.state.roomNumber).toBe(3);
  });
});

describe('A4 final room', () => {
  it('deck runs out exactly on refill: 4-card final room, no avoid, all 4 must be resolved, clearing wins', () => {
    const s = makeState({ room: room('S2', 'C3', 'H4', 'D5'), deck: cards('C6', 'C7', 'C8') });
    const t1 = run(s, play('S2'), play('C3'), play('H4')); // hp 20 -2 -3 +4 = 19
    expect(t1.state.deck).toEqual([]);
    expect(ids(t1.state.room)).toEqual(['C6', 'C7', 'C8', 'D5']);
    expect(t1.events.at(-1)).toEqual({ type: 'RoomRevealed', roomNumber: 2, canAvoid: false });
    expect(canAvoidRoom(t1.state)).toBe(false);
    expectViolation(t1.state, AVOID, 'cannotAvoidFinalRoom');

    const t2 = run(t1.state, play('C6'), play('C7'), play('D5')); // 19 -6 -7 = 6
    expect(t2.state.phase).toBe('resolving');
    expect(ids(t2.state.room)).toEqual([null, null, 'C8', null]);
    expect(t2.state.resolvedThisRoom).toBe(3);
    expect(types(t2.events)).not.toContain('RoomCleared');
    expect(types(t2.events)).not.toContain('CardDealt');
    expect(legalActions(t2.state)).toContainEqual({ type: 'playCard', cardId: 'C8', mode: 'weapon' });

    const t3 = expectOk(step(t2.state, play('C8', 'weapon'))); // 6 - (8-5) = 3
    expect(t3.state.phase).toBe('won');
    expect(t3.state.hp).toBe(3);
    expect(t3.state.score).toBe(3);
    expect(t3.state.resolvedThisRoom).toBe(4);
    expect(t3.events.slice(-2)).toEqual([
      { type: 'RoomCleared', roomNumber: 2, carried: null },
      { type: 'GameWon', score: 3, hp: 3, potionBonus: 0 },
    ]);
    expect(types(t3.events)).not.toContain('RoomRevealed');
    expect(legalActions(t3.state)).toEqual([]);
  });

  it('deck has 1 card on refill: 2-card final room (the real 44-card endgame)', () => {
    const s = makeState({ room: room('S2', 'C3', 'H4', 'D5'), deck: cards('C6') });
    const t1 = run(s, play('S2'), play('C3'), play('H4'));
    expect(ids(t1.state.room)).toEqual(['C6', null, null, 'D5']);
    expect(eventsOf(t1.events, 'CardDealt')).toEqual([{ type: 'CardDealt', card: c('C6'), slot: 0, deckRemaining: 0 }]);
    expect(t1.events.at(-1)).toEqual({ type: 'RoomRevealed', roomNumber: 2, canAvoid: false });

    const t2 = run(t1.state, play('C6'));
    expect(t2.state.phase).toBe('resolving');
    const t3 = run(t2.state, play('D5'));
    expect(t3.state.phase).toBe('won');
    expect(t3.state.score).toBe(13);
  });

  it('deck empty on refill: the carried card alone is the final room', () => {
    const s = makeState({ room: room('S2', 'C3', 'H4', 'D5'), deck: [] });
    // Starting room is itself final here (deck empty): all 4 must go.
    expect(canAvoidRoom(s)).toBe(false);
    const t = run(s, play('S2'), play('C3'), play('H4'));
    expect(t.state.phase).toBe('resolving');
    expect(ids(t.state.room)).toEqual([null, null, null, 'D5']);
    const w = run(t.state, play('D5'));
    expect(w.state.phase).toBe('won');
  });

  it('avoiding a room with a short deck is fine while the deck is not empty', () => {
    const s = makeState({ room: room('S2', 'C3', 'H4', 'D5'), deck: cards('C6') });
    const t = expectOk(step(s, AVOID));
    expect(ids(t.state.room)).toEqual(['C6', 'S2', 'C3', 'H4']);
    expect(ids(t.state.deck)).toEqual(['D5']);
    expect(t.state.phase).toBe('choosing');
  });
});
