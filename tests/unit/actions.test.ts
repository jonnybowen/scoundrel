/**
 * Each GameAction and every RuleViolation code (src/game/actions.ts, RULES.md turn structure, A5, A9).
 */
import { describe, expect, it } from 'vitest';
import { canAvoidRoom, legalActions, step } from '../../src/game';
import {
  AVOID,
  c,
  cards,
  ENTER,
  expectOk,
  expectViolation,
  ids,
  makeState,
  play,
  room,
  run,
  types,
} from './helpers';

describe('enterRoom', () => {
  it('moves choosing -> resolving and emits only RoomEntered', () => {
    const s = makeState({ roomNumber: 3 });
    const t = expectOk(step(s, ENTER));
    expect(t.state.phase).toBe('resolving');
    expect(t.events).toEqual([{ type: 'RoomEntered', roomNumber: 3 }]);
    expect(t.state.room).toEqual(s.room);
    expect(t.state.deck).toEqual(s.deck);
    expect(t.state.hp).toBe(20);
    expect(t.state.resolvedThisRoom).toBe(0);
  });

  it('violation alreadyEntered: enterRoom while resolving', () => {
    const s = makeState({ phase: 'resolving', room: room(null, 'S3', 'D4', 'H5'), resolvedThisRoom: 1 });
    expect(expectViolation(s, ENTER, 'alreadyEntered')).toEqual({ code: 'alreadyEntered' });
  });

  it('violation alreadyEntered: enterRoom twice', () => {
    const entered = expectOk(step(makeState(), ENTER)).state;
    expectViolation(entered, ENTER, 'alreadyEntered');
  });

  it('enterRoom in a game that is over is gameOver, not alreadyEntered', () => {
    expectViolation(makeState({ phase: 'won', score: 20, room: [null, null, null, null], deck: [] }), ENTER, 'gameOver');
  });
});

describe('avoidRoom: final room and precedence', () => {
  const finalRoom = { deck: [], room: room('C2', 'S3', 'D4', 'H5') };

  it('violation cannotAvoidFinalRoom when the deck is empty (A4)', () => {
    const s = makeState(finalRoom);
    expect(canAvoidRoom(s)).toBe(false);
    expect(legalActions(s)).not.toContainEqual({ type: 'avoidRoom' });
    expect(expectViolation(s, AVOID, 'cannotAvoidFinalRoom')).toEqual({ code: 'cannotAvoidFinalRoom' });
  });

  it('precedence: gameOver > cannotAvoidAfterEntering > cannotAvoidTwice > cannotAvoidFinalRoom', () => {
    expectViolation(makeState({ ...finalRoom, phase: 'lost', hp: 0, score: -5, avoidedLastRoom: true }), AVOID, 'gameOver');
    expectViolation(makeState({ ...finalRoom, phase: 'resolving', avoidedLastRoom: true }), AVOID, 'cannotAvoidAfterEntering');
    expectViolation(makeState({ ...finalRoom, avoidedLastRoom: true }), AVOID, 'cannotAvoidTwice');
    expectViolation(makeState({ phase: 'resolving', avoidedLastRoom: true }), AVOID, 'cannotAvoidAfterEntering');
  });
});

describe('avoidRoom', () => {
  it('sends all 4 room cards to the deck bottom in slot order and deals a fresh room from the top', () => {
    const s = makeState({
      room: room('S10', 'C9', 'D8', 'H7'),
      deck: cards('C2', 'C3', 'C4', 'C5', 'C6', 'C7'),
      roomNumber: 1,
    });
    const t = expectOk(step(s, AVOID));
    expect(ids(t.state.room)).toEqual(['C2', 'C3', 'C4', 'C5']);
    expect(ids(t.state.deck)).toEqual(['C6', 'C7', 'S10', 'C9', 'D8', 'H7']);
    expect(t.state.phase).toBe('choosing');
    expect(t.state.avoidedLastRoom).toBe(true);
    expect(t.state.roomNumber).toBe(2); // A10
    expect(t.state.hp).toBe(20);
    expect(t.state.resolvedThisRoom).toBe(0);

    expect(types(t.events)).toEqual(['RoomAvoided', 'CardDealt', 'CardDealt', 'CardDealt', 'CardDealt', 'RoomRevealed']);
    expect(t.events[0]).toEqual({ type: 'RoomAvoided', roomNumber: 1, cards: cards('S10', 'C9', 'D8', 'H7') });
    expect(t.events.at(-1)).toEqual({ type: 'RoomRevealed', roomNumber: 2, canAvoid: false });
  });

  it('CardDealt events fill slots 0..3 in deal order with the remaining deck count', () => {
    const s = makeState({ room: room('S10', 'C9', 'D8', 'H7'), deck: cards('C2', 'C3', 'C4', 'C5', 'C6', 'C7') });
    const t = expectOk(step(s, AVOID));
    const dealt = t.events.filter((e) => e.type === 'CardDealt');
    expect(dealt).toEqual([
      { type: 'CardDealt', card: c('C2'), slot: 0, deckRemaining: 9 },
      { type: 'CardDealt', card: c('C3'), slot: 1, deckRemaining: 8 },
      { type: 'CardDealt', card: c('C4'), slot: 2, deckRemaining: 7 },
      { type: 'CardDealt', card: c('C5'), slot: 3, deckRemaining: 6 },
    ]);
  });

  it('A5: a carried-over card goes to the bottom with the rest; avoided cards can come straight back', () => {
    // Room 2 with a carried card in slot 2 (state does not distinguish carried cards; all 4 go).
    const s = makeState({ room: room('S10', 'C9', 'D8', 'H7'), deck: cards('C2', 'C3'), roomNumber: 2 });
    const t = expectOk(step(s, AVOID));
    expect(ids(t.state.room)).toEqual(['C2', 'C3', 'S10', 'C9']);
    expect(ids(t.state.deck)).toEqual(['D8', 'H7']);
  });

  it('is allowed again after facing the room that followed an avoid', () => {
    const s = makeState({
      avoidedLastRoom: true,
      room: room('H2', 'H3', 'H4', 'H5'),
      deck: cards('C2', 'C3', 'C4', 'C5', 'C6'),
    });
    expect(canAvoidRoom(s)).toBe(false);
    const t = run(s, play('H2'), play('H3'), play('H4'));
    expect(t.state.avoidedLastRoom).toBe(false);
    expect(t.state.phase).toBe('choosing');
    expect(canAvoidRoom(t.state)).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'RoomRevealed', roomNumber: 2, canAvoid: true });
    expectOk(step(t.state, AVOID));
  });

  it('violation cannotAvoidTwice when the previous room was avoided', () => {
    const s = makeState({ avoidedLastRoom: true });
    expect(canAvoidRoom(s)).toBe(false);
    expectViolation(s, AVOID, 'cannotAvoidTwice');
  });

  it('cannotAvoidTwice end to end: avoid then avoid', () => {
    const s = makeState({ room: room('S10', 'C9', 'D8', 'H7'), deck: cards('C2', 'C3', 'C4', 'C5', 'C6') });
    const t = expectOk(step(s, AVOID));
    expectViolation(t.state, AVOID, 'cannotAvoidTwice');
  });

  it('violation cannotAvoidAfterEntering after an explicit enterRoom', () => {
    const entered = expectOk(step(makeState(), ENTER)).state;
    expect(canAvoidRoom(entered)).toBe(false);
    expectViolation(entered, AVOID, 'cannotAvoidAfterEntering');
  });

  it('violation cannotAvoidAfterEntering after a card was resolved', () => {
    const s = expectOk(step(makeState(), play('H5'))).state;
    expectViolation(s, AVOID, 'cannotAvoidAfterEntering');
  });

  it('violation gameOver when won or lost', () => {
    expectViolation(makeState({ phase: 'won', score: 20, room: [null, null, null, null], deck: [] }), AVOID, 'gameOver');
    expectViolation(makeState({ phase: 'lost', hp: 0, score: -5 }), AVOID, 'gameOver');
  });
});

describe('playCard: general', () => {
  it('playing from choosing implicitly enters the room (RoomEntered first)', () => {
    const t = expectOk(step(makeState({ hp: 10 }), play('H5')));
    expect(types(t.events)[0]).toBe('RoomEntered');
    expect(t.state.phase).toBe('resolving');
    expect(t.state.resolvedThisRoom).toBe(1);
    expect(ids(t.state.room)).toEqual(['C2', 'S3', 'D4', null]);
    expect(t.state.lastResolved).toEqual(c('H5'));
  });

  it('does not emit RoomEntered again once resolving', () => {
    const t = run(makeState(), play('H5'), play('D4'));
    expect(types(t.events).filter((x) => x === 'RoomEntered')).toHaveLength(1);
  });

  it('violation cardNotInRoom for a card in the deck', () => {
    const v = expectViolation(makeState(), play('H2'), 'cardNotInRoom');
    expect(v).toEqual({ code: 'cardNotInRoom', cardId: 'H2' });
  });

  it('violation cardNotInRoom for an already resolved card', () => {
    const s = expectOk(step(makeState(), play('H5'))).state;
    expectViolation(s, play('H5'), 'cardNotInRoom');
  });

  it('violation cardNotInRoom for a nonsense id', () => {
    expectViolation(makeState(), play('X99'), 'cardNotInRoom');
  });

  it('violation gameOver when won or lost', () => {
    expectViolation(makeState({ phase: 'lost', hp: 0, score: -3 }), play('C2'), 'gameOver');
    expectViolation(makeState({ phase: 'won', score: 20, room: room('C2', null, null, null), deck: [] }), play('C2'), 'gameOver');
    expectViolation(makeState({ phase: 'lost', hp: 0, score: -3 }), ENTER, 'gameOver');
  });

  it('mode is ignored for non-monsters', () => {
    const t = expectOk(step(makeState({ hp: 10 }), play('H5', 'weapon')));
    expect(t.state.hp).toBe(15);
    const t2 = expectOk(step(makeState(), play('D4', 'barehanded')));
    expect(t2.state.weapon?.card).toEqual(c('D4'));
  });
});

describe('playCard: weapon', () => {
  it('equips a weapon when none is held', () => {
    const t = expectOk(step(makeState({ phase: 'resolving' }), play('D4')));
    expect(t.state.weapon).toEqual({ card: c('D4'), slain: [] });
    expect(t.events).toEqual([{ type: 'WeaponEquipped', weapon: c('D4'), replaced: null, discarded: [] }]);
    expect(ids(t.state.room)).toEqual(['C2', 'S3', null, 'H5']);
    expect(t.state.discard).toEqual([]);
  });

  it('replacing a weapon discards the old weapon and its whole slain stack', () => {
    const s = makeState({ phase: 'resolving', weapon: { card: c('D3'), slain: cards('C4', 'S2') } });
    const t = expectOk(step(s, play('D4')));
    expect(t.state.weapon).toEqual({ card: c('D4'), slain: [] });
    expect(t.events).toHaveLength(1);
    const e = t.events[0]!;
    if (e.type !== 'WeaponEquipped') throw new Error(`expected WeaponEquipped, got ${e.type}`);
    expect(e.weapon).toEqual(c('D4'));
    expect(e.replaced).toEqual(c('D3'));
    expect(ids(e.discarded).sort()).toEqual(['C4', 'D3', 'S2']);
    expect(ids(t.state.discard).sort()).toEqual(['C4', 'D3', 'S2']);
  });
});

describe('playCard: potion', () => {
  it('heals by its value', () => {
    const t = expectOk(step(makeState({ phase: 'resolving', hp: 10 }), play('H5')));
    expect(t.state.hp).toBe(15);
    expect(t.state.potionUsedThisRoom).toBe(true);
    expect(t.events).toEqual([{ type: 'PotionUsed', potion: c('H5'), healed: 5, hpBefore: 10, hpAfter: 15 }]);
    expect(t.state.discard).toEqual([c('H5')]);
  });

  it('caps at 20 and reports the actual amount healed', () => {
    const t = expectOk(step(makeState({ phase: 'resolving', hp: 18 }), play('H5')));
    expect(t.state.hp).toBe(20);
    expect(t.events).toEqual([{ type: 'PotionUsed', potion: c('H5'), healed: 2, hpBefore: 18, hpAfter: 20 }]);
  });
});

describe('playCard: monster', () => {
  const monsterRoom = room('S9', 'C3', 'D4', 'H5');

  it('no weapon, mode omitted: barehanded for full damage, monster discarded', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom });
    const t = expectOk(step(s, play('S9')));
    expect(t.state.hp).toBe(11);
    expect(t.events).toEqual([
      { type: 'MonsterFought', monster: c('S9'), mode: 'barehanded', weapon: null, damage: 9 },
      { type: 'DamageTaken', amount: 9, hpBefore: 20, hpAfter: 11, source: c('S9') },
      { type: 'MonsterSlain', monster: c('S9'), byWeapon: null },
    ]);
    expect(t.state.discard).toEqual([c('S9')]);
    expect(t.state.lastResolved).toEqual(c('S9'));
  });

  it('explicit barehanded with no weapon is fine', () => {
    const t = expectOk(step(makeState({ phase: 'resolving', room: monsterRoom }), play('S9', 'barehanded')));
    expect(t.state.hp).toBe(11);
  });

  it('with weapon: takes max(0, monster - weapon) and stacks the monster on the weapon', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom, weapon: { card: c('D5'), slain: [] } });
    const t = expectOk(step(s, play('S9', 'weapon')));
    expect(t.state.hp).toBe(16);
    expect(t.state.weapon).toEqual({ card: c('D5'), slain: [c('S9')] });
    expect(t.state.discard).toEqual([]);
    expect(t.events).toEqual([
      { type: 'MonsterFought', monster: c('S9'), mode: 'weapon', weapon: c('D5'), damage: 4 },
      { type: 'DamageTaken', amount: 4, hpBefore: 20, hpAfter: 16, source: c('S9') },
      { type: 'MonsterSlain', monster: c('S9'), byWeapon: c('D5') },
    ]);
  });

  it('weapon stronger than monster: 0 damage and no DamageTaken event', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom, weapon: { card: c('D9'), slain: [] } });
    const t = expectOk(step(s, play('C3', 'weapon')));
    expect(t.state.hp).toBe(20);
    expect(t.events).toEqual([
      { type: 'MonsterFought', monster: c('C3'), mode: 'weapon', weapon: c('D9'), damage: 0 },
      { type: 'MonsterSlain', monster: c('C3'), byWeapon: c('D9') },
    ]);
  });

  it('weapon equal to monster: 0 damage', () => {
    const s = makeState({ phase: 'resolving', room: room('S9', 'C3', 'D4', 'H5'), weapon: { card: c('D9'), slain: [] } });
    expect(expectOk(step(s, play('S9', 'weapon'))).state.hp).toBe(20);
  });

  it('barehanded is always allowed even when the weapon could fight', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom, weapon: { card: c('D5'), slain: [] } });
    const t = expectOk(step(s, play('S9', 'barehanded')));
    expect(t.state.hp).toBe(11);
    expect(t.state.weapon).toEqual({ card: c('D5'), slain: [] });
    expect(t.state.discard).toEqual([c('S9')]);
    expect(t.events[0]).toEqual({ type: 'MonsterFought', monster: c('S9'), mode: 'barehanded', weapon: null, damage: 9 });
  });

  it('A9 violation modeRequired: mode omitted while the weapon could fight', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom, weapon: { card: c('D5'), slain: [] } });
    const v = expectViolation(s, play('S9'), 'modeRequired');
    expect(v).toEqual({ code: 'modeRequired', cardId: 'S9' });
  });

  it('modeRequired also applies when playing from choosing (no implicit enter on rejection)', () => {
    const s = makeState({ room: monsterRoom, weapon: { card: c('D5'), slain: [] } });
    expectViolation(s, play('S9'), 'modeRequired');
  });

  it('mode omitted while the weapon cannot fight: barehanded', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom, weapon: { card: c('D5'), slain: [c('C4')] } });
    const t = expectOk(step(s, play('S9')));
    expect(t.state.hp).toBe(11);
    expect(t.state.weapon).toEqual({ card: c('D5'), slain: [c('C4')] });
  });

  it('violation noWeapon: mode weapon with nothing equipped', () => {
    const v = expectViolation(makeState({ phase: 'resolving', room: monsterRoom }), play('S9', 'weapon'), 'noWeapon');
    expect(v).toEqual({ code: 'noWeapon', cardId: 'S9' });
  });

  it('violation weaponCannotFight: mode weapon above the degradation limit', () => {
    const s = makeState({ phase: 'resolving', room: monsterRoom, weapon: { card: c('D5'), slain: [c('C4')] } });
    const v = expectViolation(s, play('S9', 'weapon'), 'weaponCannotFight');
    expect(v).toEqual({ code: 'weaponCannotFight', cardId: 'S9', limit: 4 });
  });
});

describe('legalActions', () => {
  it('lists enterRoom and avoidRoom in a fresh avoidable room', () => {
    const acts = legalActions(makeState());
    expect(acts).toContainEqual({ type: 'enterRoom' });
    expect(acts).toContainEqual({ type: 'avoidRoom' });
  });

  it('omits avoidRoom after an avoid and once resolving', () => {
    expect(legalActions(makeState({ avoidedLastRoom: true }))).not.toContainEqual({ type: 'avoidRoom' });
    expect(legalActions(makeState({ phase: 'resolving' }))).not.toContainEqual({ type: 'avoidRoom' });
  });

  it('is empty when the game is over', () => {
    expect(legalActions(makeState({ phase: 'lost', hp: 0, score: -1 }))).toEqual([]);
    expect(legalActions(makeState({ phase: 'won', score: 20, room: [null, null, null, null], deck: [] }))).toEqual([]);
  });

  it('every listed action is accepted by step', () => {
    const states = [
      makeState(),
      makeState({ phase: 'resolving', room: room('S9', 'C3', 'D4', 'H5'), weapon: { card: c('D5'), slain: [] } }),
      makeState({ phase: 'resolving', room: room('S9', 'C3', 'D4', 'H5'), weapon: { card: c('D5'), slain: [c('C4')] } }),
    ];
    for (const s of states) {
      for (const a of legalActions(s)) expect(step(s, a).ok, JSON.stringify(a)).toBe(true);
    }
  });

  it('never offers a mode-less monster play when the weapon could fight it', () => {
    const s = makeState({ phase: 'resolving', room: room('S9', 'C3', 'D4', 'H5'), weapon: { card: c('D5'), slain: [] } });
    const acts = legalActions(s);
    expect(acts).not.toContainEqual({ type: 'playCard', cardId: 'S9' });
    expect(acts).toContainEqual({ type: 'playCard', cardId: 'S9', mode: 'weapon' });
    expect(acts).toContainEqual({ type: 'playCard', cardId: 'S9', mode: 'barehanded' });
  });
});
