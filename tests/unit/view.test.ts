/**
 * selectView review-gate fields (Adama's render-ui approval, follow-up b). Adopted from Tyrol's scratch
 * view.check.test.ts and extended: the final room (deck empty) and lethal with a weapon held.
 * Render branches only on these fields, so they must carry the rules: cardsLeftToResolve, kind, lethal.
 */
import { describe, expect, it } from 'vitest';
import { canUseWeaponOn, previewDamage, type CardId, type GameState } from '../../src/game';
import { selectView, type GameView, type RoomCardView, type UiLocalState } from '../../src/ui/view';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import { c, cards, makeState, room } from './helpers';

const ui: UiLocalState = {
  pendingFight: null,
  menuOpen: false,
  screen: 'game',
  hover: null,
  toast: null,
  showResult: false,
  settings: DEFAULT_SETTINGS,
  error: null,
};

const rc = (v: GameView, id: CardId): RoomCardView => {
  const r = v.room.find((x) => x?.card.id === id);
  if (!r) throw new Error(`${id} not in view`);
  return r;
};

describe('selectView: kind', () => {
  it('comes from cardKind', () => {
    const v = selectView(makeState({ room: room('C2', 'S3', 'D4', 'H5') }), ui);
    expect(v.room.map((r) => r?.kind)).toEqual(['monster', 'monster', 'weapon', 'potion']);
  });
});

describe('selectView: cardsLeftToResolve', () => {
  it('normal room: 3 minus resolved', () => {
    expect(selectView(makeState(), ui).cardsLeftToResolve).toBe(3);
    expect(selectView(makeState({ phase: 'resolving', room: room(null, 'S3', 'D4', 'H5'), resolvedThisRoom: 1 }), ui).cardsLeftToResolve).toBe(2);
    expect(selectView(makeState({ phase: 'resolving', room: room(null, null, 'D4', 'H5'), resolvedThisRoom: 2 }), ui).cardsLeftToResolve).toBe(1);
  });

  it('final room (deck empty): every remaining card, even 4', () => {
    expect(selectView(makeState({ deck: [], room: room('C2', 'S3', 'D4', 'H5') }), ui).cardsLeftToResolve).toBe(4);
    expect(selectView(makeState({ phase: 'resolving', deck: [], room: room(null, null, null, 'H5'), resolvedThisRoom: 3 }), ui).cardsLeftToResolve).toBe(1);
    expect(selectView(makeState({ phase: 'resolving', deck: [], room: room('S9', null, null, null), resolvedThisRoom: 1 }), ui).cardsLeftToResolve).toBe(1);
  });

  it('final room with gaps (the tutorial room 6 shape: H10 - C2 -)', () => {
    const s = makeState({ deck: [], room: room('H10', null, 'C2', null), weapon: { card: c('D10'), slain: cards('S14', 'C7', 'C3') } });
    const v = selectView(s, ui);
    expect(v.cardsLeftToResolve).toBe(2);
    expect(v.canAvoid).toBe(false);
    expect(v.deckCount).toBe(0);
    const after = makeState({ phase: 'resolving', deck: [], room: room('H10', null, null, null), resolvedThisRoom: 1, weapon: s.weapon });
    expect(selectView(after, ui).cardsLeftToResolve).toBe(1);
  });

  it('final room after one card: all 3 remaining (a normal room would say 3 - 1 = 2)', () => {
    const s = makeState({ phase: 'resolving', deck: [], room: room('S2', 'S3', 'H4', null), resolvedThisRoom: 1 });
    expect(selectView(s, ui).cardsLeftToResolve).toBe(3);
  });

  it('0 when the game is over and on the title', () => {
    expect(selectView(makeState({ phase: 'won', score: 5 }), ui).cardsLeftToResolve).toBe(0);
    expect(selectView(makeState({ phase: 'lost', hp: 0, score: -5 }), ui).cardsLeftToResolve).toBe(0);
    expect(selectView(null, { ...ui, screen: 'title' }).cardsLeftToResolve).toBe(0);
  });
});

describe('selectView: lethal', () => {
  it('barehanded only: lethal when the monster value is at least HP', () => {
    const v = selectView(makeState({ hp: 5, room: room('S5', 'C4', 'S14', 'H5') }), ui);
    expect(rc(v, 'S5').lethal).toBe(true); // 5 >= 5: exactly lethal
    expect(rc(v, 'C4').lethal).toBe(false);
    expect(rc(v, 'S14').lethal).toBe(true);
    expect(rc(v, 'H5').lethal).toBe(false); // not a monster
  });

  it('weapon usable: lethal uses the cheaper weapon cost', () => {
    const w = selectView(makeState({ hp: 5, weapon: { card: c('D4'), slain: [] }, room: room('S5', 'C9', 'S14', 'H5') }), ui);
    expect(rc(w, 'S5').lethal).toBe(false); // weapon: 1 damage, fists 5 would kill
    expect(rc(w, 'C9').lethal).toBe(true); // weapon 5 = hp 5
    expect(rc(w, 'S14').lethal).toBe(true);
  });

  it('weapon held but too dull for this monster: lethal uses the fists cost (the only option)', () => {
    // Limit 6 after slaying a 6: the 9 cannot be fought with the weapon, the 4 can.
    const s = makeState({ hp: 9, weapon: { card: c('D5'), slain: cards('S6') }, room: room('C9', 'C4', 'S2', 'H5') });
    const v = selectView(s, ui);
    expect(rc(v, 'C9').canUseWeapon).toBe(false);
    expect(rc(v, 'C9').damageWithWeapon).toBeNull();
    expect(rc(v, 'C9').lethal).toBe(true); // fists 9 >= 9, even though a weapon (5) is held
    expect(rc(v, 'C4').lethal).toBe(false);
    // Same hp, monster 1 lower: 8 < 9 is survivable.
    const v2 = selectView(makeState({ hp: 9, weapon: { card: c('D5'), slain: cards('S6') }, room: room('C8', 'C4', 'S2', 'H5') }), ui);
    expect(rc(v2, 'C8').lethal).toBe(false);
  });

  it('lethal is exactly "the cheapest available option takes all HP", over a grid of states', () => {
    // Note: fists are never cheaper than an available weapon under the rules (weapon damage = max(0, m - w) <= m),
    // so "cheapest" here is min(fists, weapon when usable). The oracle below is independent of selectView.
    const monsters: CardId[] = ['S2', 'C5', 'S8', 'C11', 'S14'];
    for (const hp of [1, 3, 6, 9, 14, 20]) {
      for (const weapon of [null, { card: c('D3'), slain: [] }, { card: c('D7'), slain: cards('S9') }, { card: c('D10'), slain: cards('C4') }]) {
        for (const m of monsters) {
          const s: GameState = makeState({ hp, weapon, room: room(m, 'H2', 'D2', null) });
          const card = s.room[0]!;
          const fists = previewDamage(s, card, 'barehanded');
          const usable = weapon !== null && canUseWeaponOn(s, m);
          const cheapest = usable ? Math.min(fists, previewDamage(s, card, 'weapon')) : fists;
          const v = rc(selectView(s, ui), m);
          expect(v.lethal, `hp ${hp} weapon ${weapon?.card.id ?? '-'} ${m}`).toBe(cheapest >= hp);
          expect(v.canUseWeapon).toBe(usable);
          expect(v.damageBarehanded).toBe(fists);
        }
      }
    }
  });

  it('false after game over; barehanded damage still previewed', () => {
    const v = selectView(makeState({ phase: 'lost', hp: 0, score: -10, room: room('S14', null, null, null) }), ui);
    expect(rc(v, 'S14').lethal).toBe(false);
    expect(rc(v, 'S14').damageBarehanded).toBe(14);
  });
});
