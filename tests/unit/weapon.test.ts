/**
 * Weapon degradation (RULES.md "Weapon degradation", A1 'lte'/'lt', A2 last-slain comparison)
 * and the weapon queries canUseWeaponOn / weaponLimit / previewDamage.
 */
import { describe, expect, it } from 'vitest';
import { canUseWeaponOn, previewDamage, step, weaponLimit, type GameState } from '../../src/game';
import { c, cards, expectOk, expectViolation, ids, makeState, play, room, run } from './helpers';

const withWeapon = (weapon: string, slain: string[], roomIds: (string | null)[], rules: Partial<GameState['rules']> = {}) =>
  makeState({
    phase: 'resolving',
    weapon: { card: c(weapon), slain: cards(...slain) },
    room: room(...roomIds),
    rules,
  });

describe('A2: the rulebook example (5 weapon, Queen, then 6)', () => {
  it('5 slays Q, then may fight a 6, then a later Queen must be fought barehanded', () => {
    const s0 = makeState({
      phase: 'resolving',
      room: room('D5', 'S12', 'C6', 'C12'),
      deck: cards('H2', 'H3', 'H4', 'H6', 'H7'),
    });
    const t = run(s0, play('D5'), play('S12', 'weapon'), play('C6', 'weapon'));
    // Room cleared; C12 carried in slot 3.
    expect(t.state.phase).toBe('choosing');
    expect(ids(t.state.room)).toEqual(['H2', 'H3', 'H4', 'C12']);
    expect(t.state.weapon).toEqual({ card: c('D5'), slain: cards('S12', 'C6') });
    expect(t.state.hp).toBe(20 - 7 - 1);
    expect(weaponLimit(t.state)).toBe(6);
    expect(canUseWeaponOn(t.state, 'C12')).toBe(false);

    const v = expectViolation(t.state, play('C12', 'weapon'), 'weaponCannotFight');
    expect(v).toEqual({ code: 'weaponCannotFight', cardId: 'C12', limit: 6 });

    // Barehanded still fine; the weapon stays equipped and its stack is untouched.
    const after = expectOk(step(t.state, play('C12'))).state;
    expect(after.hp).toBe(12 - 12);
    expect(after.weapon).toEqual({ card: c('D5'), slain: cards('S12', 'C6') });
  });

  it('after slaying the Queen the limit is 12, not the weapon value 5', () => {
    const s = withWeapon('D5', ['S12'], ['C11', 'H2', 'H3', 'H4']);
    expect(weaponLimit(s)).toBe(12);
    expect(canUseWeaponOn(s, 'C11')).toBe(true);
    const t = expectOk(step(s, play('C11', 'weapon')));
    expect(t.state.hp).toBe(20 - 6);
    expect(t.state.weapon?.slain).toEqual(cards('S12', 'C11'));
  });
});

describe('degradation compares against the LAST monster slain', () => {
  it('not the strongest slain', () => {
    const s = withWeapon('D8', ['S12', 'C4'], ['C10', 'S3', 'H2', 'H3']);
    expect(weaponLimit(s)).toBe(4);
    expect(canUseWeaponOn(s, 'C10')).toBe(false);
    expect(canUseWeaponOn(s, 'S3')).toBe(true);
    expectViolation(s, play('C10', 'weapon'), 'weaponCannotFight');
  });

  it('not the weapon value (a 3 weapon that slew a Q may fight a J)', () => {
    const s = withWeapon('D3', ['S12'], ['C11', 'H2', 'H3', 'H4']);
    expect(canUseWeaponOn(s, 'C11')).toBe(true);
    expect(expectOk(step(s, play('C11', 'weapon'))).state.hp).toBe(20 - 8);
  });

  it('limit tightens with each kill', () => {
    const t = run(withWeapon('D10', [], ['S14', 'C9', 'S9', 'H2']), play('S14', 'weapon'), play('C9', 'weapon'));
    expect(weaponLimit(t.state)).toBe(9);
    expect(t.state.weapon?.slain).toEqual(cards('S14', 'C9'));
  });
});

describe("A1 weaponLimit 'lte' (default)", () => {
  it('may fight a monster equal to the last slain', () => {
    const s = withWeapon('D5', ['C6'], ['S6', 'S7', 'H2', 'H3']);
    expect(s.rules.weaponLimit).toBe('lte');
    expect(weaponLimit(s)).toBe(6);
    expect(canUseWeaponOn(s, 'S6')).toBe(true);
    expect(canUseWeaponOn(s, 'S7')).toBe(false);
    expect(expectOk(step(s, play('S6', 'weapon'))).state.hp).toBe(19);
  });

  it('rejects one above the last slain with limit = last slain', () => {
    const s = withWeapon('D5', ['C6'], ['S6', 'S7', 'H2', 'H3']);
    const v = expectViolation(s, play('S7', 'weapon'), 'weaponCannotFight');
    expect(v).toEqual({ code: 'weaponCannotFight', cardId: 'S7', limit: 6 });
  });
});

describe("A1 weaponLimit 'lt' (option)", () => {
  const lt = { weaponLimit: 'lt' } as const;

  it('rejects a monster equal to the last slain', () => {
    const s = withWeapon('D5', ['C6'], ['S6', 'S5', 'H2', 'H3'], lt);
    expect(canUseWeaponOn(s, 'S6')).toBe(false);
    expect(canUseWeaponOn(s, 'S5')).toBe(true);
    expectViolation(s, play('S6', 'weapon'), 'weaponCannotFight');
  });

  it('allows strictly lower', () => {
    const s = withWeapon('D5', ['C6'], ['S6', 'S5', 'H2', 'H3'], lt);
    const t = expectOk(step(s, play('S5', 'weapon')));
    expect(t.state.hp).toBe(20);
    expect(t.state.weapon?.slain).toEqual(cards('C6', 'S5'));
  });

  it('weaponLimit reports the highest fightable value (last slain - 1), and the violation uses it', () => {
    const s = withWeapon('D5', ['C6'], ['S6', 'S5', 'H2', 'H3'], lt);
    expect(weaponLimit(s)).toBe(5);
    const v = expectViolation(s, play('S6', 'weapon'), 'weaponCannotFight');
    expect(v).toEqual({ code: 'weaponCannotFight', cardId: 'S6', limit: weaponLimit(s) });
  });

  it('a weapon that slew a 2 can fight nothing more', () => {
    const s = withWeapon('D5', ['C2'], ['S2', 'S3', 'H2', 'H3'], lt);
    expect(canUseWeaponOn(s, 'S2')).toBe(false);
    // mode omitted -> barehanded because the weapon cannot fight
    expect(expectOk(step(s, play('S2'))).state.hp).toBe(18);
  });

  it('unused weapon under lt still fights anything', () => {
    const s = withWeapon('D2', [], ['S14', 'H2', 'H3', 'H4'], lt);
    expect(canUseWeaponOn(s, 'S14')).toBe(true);
    expect(weaponLimit(s)).toBeNull();
  });
});

describe('weapon lifecycle', () => {
  it('an unused weapon can fight any monster, even an Ace', () => {
    const s = withWeapon('D2', [], ['S14', 'H2', 'H3', 'H4']);
    expect(weaponLimit(s)).toBeNull();
    expect(canUseWeaponOn(s, 'S14')).toBe(true);
    expect(expectOk(step(s, play('S14', 'weapon'))).state.hp).toBe(8);
  });

  it('a new weapon resets degradation', () => {
    const s = withWeapon('D5', ['C2'], ['D3', 'S14', 'H2', 'H3']);
    const t = expectOk(step(s, play('D3')));
    expect(weaponLimit(t.state)).toBeNull();
    expect(canUseWeaponOn(t.state, 'S14')).toBe(true);
  });

  it('exhausted weapon stays equipped across rooms', () => {
    const s = withWeapon('D5', ['C2'], ['S9', 'H2', 'H3', 'H4']);
    const t = run(s, play('S9'), play('H2'), play('H3'));
    expect(t.state.weapon).toEqual({ card: c('D5'), slain: [c('C2')] });
  });

  it('weaponLimit is null with no weapon; canUseWeaponOn is false', () => {
    const s = makeState({ phase: 'resolving', room: room('S9', 'H2', 'H3', 'H4') });
    expect(weaponLimit(s)).toBeNull();
    expect(canUseWeaponOn(s, 'S9')).toBe(false);
  });
});

describe('previewDamage', () => {
  it('matches the damage step() would apply', () => {
    const s = withWeapon('D5', [], ['S9', 'C3', 'H2', 'H3']);
    expect(previewDamage(s, c('S9'), 'weapon')).toBe(4);
    expect(previewDamage(s, c('S9'), 'barehanded')).toBe(9);
    expect(previewDamage(s, c('C3'), 'weapon')).toBe(0);
    expect(20 - expectOk(step(s, play('S9', 'weapon'))).state.hp).toBe(previewDamage(s, c('S9'), 'weapon'));
  });
});
