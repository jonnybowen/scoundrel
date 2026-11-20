/** Win/loss and scoring (RULES.md End of game and scoring, A3, A6, A8). */
import { describe, expect, it } from 'vitest';
import { computeScore, step, type GameEvent, type GameState } from '../../src/game';
import { c, cards, expectOk, ids, makeState, play, room, types } from './helpers';

const lossSetup = (extra: Partial<GameState> = {}, scope?: 'dungeon' | 'deckOnly') =>
  makeState({
    phase: 'resolving',
    hp: 5,
    room: room('S9', 'C3', 'H4', 'D2'),
    deck: cards('C10', 'H2', 'S4'),
    ...extra,
    ...(scope ? { rules: { lossScoreScope: scope } } : {}),
  });

const gameLost = (events: readonly GameEvent[]) => {
  const e = events.at(-1);
  if (e?.type !== 'GameLost') throw new Error(`expected GameLost last, got ${e?.type}`);
  return e;
};

describe('loss', () => {
  it("default 'dungeon' scope: 0 minus deck monsters and unresolved room monsters (A3)", () => {
    const t = expectOk(step(lossSetup(), play('S9')));
    expect(t.state.phase).toBe('lost');
    expect(t.state.hp).toBe(0); // A6 clamp
    expect(t.state.score).toBe(-(3 + 10 + 4));
    expect(computeScore(t.state)).toBe(-17);
    const lost = gameLost(t.events);
    expect(lost.score).toBe(-17);
    expect(ids(lost.remainingMonsters).sort()).toEqual(['C10', 'C3', 'S4']);
  });

  it("'deckOnly' scope: only monsters left in the draw pile count", () => {
    const t = expectOk(step(lossSetup({}, 'deckOnly'), play('S9')));
    expect(t.state.score).toBe(-(10 + 4));
    expect(computeScore(t.state)).toBe(-14);
    const lost = gameLost(t.events);
    expect(lost.score).toBe(-14);
    expect(ids(lost.remainingMonsters).sort()).toEqual(['C10', 'S4']);
  });

  it('A6: overkill is clamped; DamageTaken reports the full amount; event order ends with GameLost', () => {
    const t = expectOk(step(lossSetup(), play('S9')));
    expect(types(t.events)).toEqual(['MonsterFought', 'DamageTaken', 'GameLost']);
    expect(t.events[1]).toEqual({ type: 'DamageTaken', amount: 9, hpBefore: 5, hpAfter: 0, source: c('S9') });
  });

  it('the killing monster, weapon-stack monsters and discarded monsters do not count', () => {
    const s = lossSetup({ weapon: { card: c('D2'), slain: [c('C5')] }, discard: [c('S13')] });
    const t = expectOk(step(s, play('S9', 'barehanded')));
    expect(t.state.score).toBe(-17);
    expect(ids(gameLost(t.events).remainingMonsters)).not.toContain('S9');
  });

  it('dying with the weapon counts too', () => {
    const s = lossSetup({ hp: 3, weapon: { card: c('D2'), slain: [] } });
    const t = expectOk(step(s, play('S9', 'weapon')));
    expect(t.state.phase).toBe('lost');
    expect(t.state.score).toBe(-17);
    expect(t.events[1]).toEqual({ type: 'DamageTaken', amount: 7, hpBefore: 3, hpAfter: 0, source: c('S9') });
  });

  it('reaching exactly 0 HP is a loss', () => {
    const t = expectOk(step(lossSetup({ hp: 9 }), play('S9')));
    expect(t.state.phase).toBe('lost');
    expect(t.state.hp).toBe(0);
  });

  it('dying on the very last card of the dungeon is a loss with score 0, not a win', () => {
    const s = makeState({ phase: 'resolving', hp: 5, deck: [], room: room('S9', null, null, null), resolvedThisRoom: 1 });
    const t = expectOk(step(s, play('S9')));
    expect(t.state.phase).toBe('lost');
    expect(t.state.score).toBe(0);
    expect(types(t.events)).not.toContain('GameWon');
    // Death completes the final room: no MonsterSlain, no RoomCleared, no GameWon (Tyrol decision).
    expect(types(t.events)).toEqual(['MonsterFought', 'DamageTaken', 'GameLost']);
    expect(ids(t.state.room)).toEqual([null, null, null, null]);
    expect(ids(t.state.discard)).toEqual(['S9']);
  });

  describe('death on the card that would complete a non-final room (3rd card, deck not empty)', () => {
    // Two cards already resolved this room (slots 1 and 3 empty); S9 kills, H4 would have been carried.
    const completingDeath = (extra: Partial<GameState> = {}) =>
      makeState({
        phase: 'resolving',
        hp: 5,
        room: room('S9', null, 'H4', null),
        resolvedThisRoom: 2,
        deck: cards('C10', 'H2', 'S4'),
        discard: cards('D2', 'H3'),
        roomNumber: 3,
        ...extra,
      });

    const expectDeathFroze = (before: GameState, after: GameState, events: readonly GameEvent[]) => {
      // Exactly the death sequence: no MonsterSlain, RoomCleared, CardDealt or RoomRevealed.
      expect(types(events)).toEqual(['MonsterFought', 'DamageTaken', 'GameLost']);
      expect(after.phase).toBe('lost');
      expect(after.hp).toBe(0);
      // Room not cleared: the leftover stays in its slot, no new room, deck untouched.
      expect(ids(after.room)).toEqual([null, null, 'H4', null]);
      expect(after.roomNumber).toBe(before.roomNumber);
      expect(ids(after.deck)).toEqual(ids(before.deck));
      // The killing monster goes to the discard, after what was already there.
      expect(ids(after.discard)).toEqual([...ids(before.discard), 'S9']);
      // Dungeon scope: deck monsters C10 + S4; H4 is not a monster.
      expect(after.score).toBe(-(10 + 4));
      expect(gameLost(events).score).toBe(-14);
    };

    it('barehanded', () => {
      const s = completingDeath();
      const t = expectOk(step(s, play('S9')));
      expectDeathFroze(s, t.state, t.events);
      expect(t.events[0]).toEqual({ type: 'MonsterFought', monster: c('S9'), mode: 'barehanded', weapon: null, damage: 9 });
      expect(t.state.weapon).toBeNull();
    });

    it('with the weapon: weapon and its slain stack are unchanged', () => {
      const weapon = { card: c('D3'), slain: [c('C11')] };
      const s = completingDeath({ weapon });
      const t = expectOk(step(s, play('S9', 'weapon')));
      expectDeathFroze(s, t.state, t.events);
      expect(t.events[0]).toEqual({ type: 'MonsterFought', monster: c('S9'), mode: 'weapon', weapon: c('D3'), damage: 6 });
      expect(t.state.weapon).toEqual(weapon);
      expect(ids(t.state.weapon!.slain)).toEqual(['C11']);
    });
  });

  it('no further actions after a loss', () => {
    const t = expectOk(step(lossSetup(), play('S9')));
    const r = step(t.state, play('C3'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.code).toBe('gameOver');
  });
});

describe('win', () => {
  const finalRoom = (hp: number, slots: (string | null)[], extra: Partial<GameState> = {}) =>
    makeState({ phase: 'resolving', hp, deck: [], room: room(...slots), resolvedThisRoom: 4 - slots.filter(Boolean).length, ...extra });

  const won = (s: GameState, ...cardsToPlay: Parameters<typeof play>[]) => {
    let st = s;
    let last: readonly GameEvent[] = [];
    for (const args of cardsToPlay) {
      const t = expectOk(step(st, play(...args)));
      st = t.state;
      last = t.events;
    }
    expect(st.phase).toBe('won');
    const e = last.at(-1);
    if (e?.type !== 'GameWon') throw new Error(`expected GameWon last, got ${e?.type}`);
    return { state: st, event: e };
  };

  it('score is remaining HP', () => {
    const { state, event } = won(finalRoom(10, ['C2', 'H3', null, null]), ['C2'], ['H3']); // 10-2+3
    expect(event).toEqual({ type: 'GameWon', score: 11, hp: 11, potionBonus: 0 });
    expect(state.score).toBe(11);
    expect(computeScore(state)).toBe(11);
  });

  it('bonus: HP 20 and the last card was a potion -> 20 + potion value', () => {
    const { state, event } = won(finalRoom(17, ['C2', 'H5', null, null]), ['C2'], ['H5']); // 15 -> 20
    expect(event).toEqual({ type: 'GameWon', score: 25, hp: 20, potionBonus: 5 });
    expect(state.score).toBe(25);
    expect(computeScore(state)).toBe(25);
  });

  it('bonus applies to a potion drunk at full HP (heals 0)', () => {
    const { event } = won(finalRoom(20, ['H4', null, null, null]), ['H4']);
    expect(event).toEqual({ type: 'GameWon', score: 24, hp: 20, potionBonus: 4 });
  });

  it('A8: bonus applies even when the last potion was wasted', () => {
    const { event } = won(finalRoom(15, ['H5', 'H3', null, null]), ['H5'], ['H3']);
    expect(event).toEqual({ type: 'GameWon', score: 23, hp: 20, potionBonus: 3 });
  });

  it('no bonus when the last card was a potion but HP is below 20', () => {
    const { event } = won(finalRoom(10, ['C2', 'H3', null, null]), ['C2'], ['H3']);
    expect(event.potionBonus).toBe(0);
  });

  it('no bonus at 20 HP when the last card was not a potion', () => {
    const { event } = won(finalRoom(18, ['H5', 'C3', null, null], { weapon: { card: c('D9'), slain: [] } }), ['H5'], ['C3', 'weapon']);
    expect(event).toEqual({ type: 'GameWon', score: 20, hp: 20, potionBonus: 0 });
  });

  it('no bonus when the last card was a weapon', () => {
    const { event } = won(finalRoom(20, ['D3', null, null, null]), ['D3']);
    expect(event).toEqual({ type: 'GameWon', score: 20, hp: 20, potionBonus: 0 });
  });
});

describe('computeScore mid-game (Tyrol decision: hp minus remaining monsters in the A3 scope)', () => {
  it('dungeon scope counts deck + room monsters', () => {
    const s = lossSetup({ hp: 12 });
    expect(computeScore(s)).toBe(12 - (9 + 3 + 10 + 4));
    expect(s.score).toBeNull();
  });

  it('deckOnly counts only the deck', () => {
    expect(computeScore(lossSetup({ hp: 12 }, 'deckOnly'))).toBe(12 - (10 + 4));
  });
});
