/** One potion heals per room (RULES.md Health potion, A7). */
import { describe, expect, it } from 'vitest';
import { step } from '../../src/game';
import { c, cards, expectOk, makeState, play, room, run } from './helpers';

describe('potion once per room', () => {
  it('a second potion in the same room is wasted: PotionWasted, no heal, discarded', () => {
    const s = makeState({ phase: 'resolving', hp: 10, room: room('H5', 'H3', 'C2', 'S2') });
    const t1 = expectOk(step(s, play('H5')));
    expect(t1.state.hp).toBe(15);
    const t2 = expectOk(step(t1.state, play('H3')));
    expect(t2.state.hp).toBe(15);
    expect(t2.events).toEqual([{ type: 'PotionWasted', potion: c('H3'), reason: 'alreadyUsedThisRoom' }]);
    expect(t2.state.discard.map((x) => x.id)).toContain('H3');
    expect(t2.state.lastResolved).toEqual(c('H3'));
    expect(t2.state.resolvedThisRoom).toBe(2);
  });

  it('the wasted potion is wasted even if HP is low after a fight', () => {
    const s = makeState({ phase: 'resolving', hp: 20, room: room('H5', 'S9', 'H3', 'C2') });
    const t = run(s, play('H5'), play('S9'), play('H3'));
    expect(t.state.hp).toBe(11);
  });

  it('A7: a potion at full HP heals 0 but still uses up the room potion', () => {
    const s = makeState({ phase: 'resolving', hp: 20, room: room('H5', 'S9', 'H3', 'C2') });
    const t1 = expectOk(step(s, play('H5')));
    expect(t1.events).toEqual([{ type: 'PotionUsed', potion: c('H5'), healed: 0, hpBefore: 20, hpAfter: 20 }]);
    expect(t1.state.potionUsedThisRoom).toBe(true);
    const t2 = run(t1.state, play('S9'), play('H3'));
    expect(t2.state.hp).toBe(11);
    expect(t2.events.at(-1)?.type).not.toBe('PotionUsed');
  });

  it('the potion allowance resets in the next room, including for a carried potion', () => {
    const s = makeState({ hp: 10, room: room('H2', 'C2', 'C3', 'H4'), deck: cards('S2', 'S3', 'S4', 'S5') });
    const t = run(s, play('H2'), play('C2'), play('C3')); // 10 +2 -2 -3 = 7, H4 carried
    expect(t.state.potionUsedThisRoom).toBe(false);
    const t2 = expectOk(step(t.state, play('H4')));
    expect(t2.state.hp).toBe(11);
    expect(t2.events.map((e) => e.type)).toContain('PotionUsed');
  });

  it('a weapon or monster between potions does not reset the allowance', () => {
    const s = makeState({ phase: 'resolving', hp: 5, room: room('H5', 'D3', 'H4', 'C2') });
    const t = run(s, play('H5'), play('D3'), play('H4'));
    expect(t.state.hp).toBe(10);
  });
});
