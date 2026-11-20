/**
 * Tyrol's development tests for the tutorial step machine, on the real engine (no mocks of src/game).
 * Tigh owns the formal suite in tests/unit/tutorial.test.ts; this file guards the implementation while it moves.
 */
import { describe, expect, it } from 'vitest';
import { createGame, createSession, legalActions, step, type GameAction, type GameEvent, type GameState } from '../game';
import {
  advance,
  currentStep,
  DESYNC_TEXT,
  gate,
  startTutorial,
  tutorialChrome,
  tutorialGameOptions,
} from './machine';
import { tutorialRecap, tutorialSteps } from './script';
import { LESSONS, TUTORIAL_DECK_ORDER, type TutorialQuery, type TutorialState, type TutorialStepId } from './types';

const IDS: readonly TutorialStepId[] = [
  'welcome', 'monsters', 'weapons', 'potions',
  'roomRule', 'r1Equip', 'r1Fight', 'r1FightDone', 'r1Potion', 'r1Cleared',
  'r2Look', 'r2Avoid', 'r3TryAvoid', 'r3Refused',
  'r3Fight6', 'r3Dull', 'r3TooDull', 'r3Fight4',
  'r4Drink', 'r4Waste', 'r4Wasted', 'r4NewWeapon',
  'r5Return', 'r5Losing', 'r5Ace', 'r5Seven', 'r5Three',
  'r6Final', 'r6Two', 'r6Potion',
];

type Move = { readonly kind: 'next' } | { readonly kind: 'act'; readonly action: GameAction };
const N: Move = { kind: 'next' };
const P = (cardId: string, mode?: 'weapon' | 'barehanded'): Move => ({
  kind: 'act',
  action: mode ? { type: 'playCard', cardId, mode } : { type: 'playCard', cardId },
});
const AVOID: Move = { kind: 'act', action: { type: 'avoidRoom' } };

/** Canonical moves per step (docs/TUTORIAL.md e2e key list, as actions). */
const CANON: Readonly<Record<TutorialStepId, readonly Move[]>> = {
  welcome: [N, N], monsters: [N], weapons: [N], potions: [N],
  roomRule: [N, N], r1Equip: [P('D5')], r1Fight: [P('S8', 'weapon')], r1FightDone: [N], r1Potion: [P('H5')],
  r1Cleared: [N, N],
  r2Look: [N, N], r2Avoid: [AVOID], r3TryAvoid: [AVOID], r3Refused: [N],
  r3Fight6: [P('S6', 'weapon')], r3Dull: [N, N], r3TooDull: [P('C9', 'barehanded')], r3Fight4: [P('C4', 'weapon')],
  r4Drink: [N, P('H4')], r4Waste: [P('H2')], r4Wasted: [N], r4NewWeapon: [P('D10')],
  r5Return: [N], r5Losing: [N, N], r5Ace: [P('S14', 'weapon')], r5Seven: [P('C7', 'weapon')], r5Three: [P('C3', 'weapon')],
  r6Final: [N], r6Two: [P('C2', 'weapon')], r6Potion: [P('H10')],
};

/** A headless stand-in for ui/tutorialController: gate, dispatch, feed back. */
function harness() {
  const session = createSession(tutorialGameOptions());
  let t = startTutorial();
  const batches: GameEvent[][] = [];
  session.subscribe((events, state) => {
    batches.push([...events]);
    t = advance(t, { type: 'events', events, state });
  });
  return {
    session,
    get t() {
      return t;
    },
    batches,
    next() {
      t = advance(t, { type: 'next' });
    },
    try(query: TutorialQuery) {
      const g = gate(t, session.state, query);
      if (!g.allowed) {
        t = advance(t, { type: 'blocked', nudge: g.nudge });
        return g;
      }
      if (query.type === 'select') return g;
      const r = session.dispatch(query);
      if (!r.ok) t = advance(t, { type: 'violation', violation: r.violation, state: r.state });
      return g;
    },
  };
}

const GLYPHS = /^[A-Z0-9 \-+.,:!?'/<>=%()#]*$/;

describe('tutorial script', () => {
  const steps = tutorialSteps();

  it('has exactly the 30 step ids in order and uses every lesson in order', () => {
    expect(steps.map((s) => s.id)).toEqual(IDS);
    const lessons = [...new Set(steps.map((s) => s.lesson))];
    expect(lessons).toEqual([...LESSONS]);
  });

  it('keeps every coach string inside the pixel font and the 138-char page budget', () => {
    const texts: string[] = [];
    for (const s of steps) {
      expect(s.title.length).toBeLessThanOrEqual(20);
      expect(s.pages.length).toBeGreaterThan(0);
      texts.push(s.title, ...s.pages, s.nudge, ...(s.nudges ?? []).map((n) => n.text));
      for (const p of s.pages) expect(p.length, p).toBeLessThanOrEqual(138);
      expect(s.nudge.length).toBeGreaterThan(0);
      expect(s.arrow).toBe(true);
      expect(s.spotlight.length).toBeGreaterThan(0);
      expect(s.expect === null).toBe(s.until.kind === 'next');
    }
    const recap = tutorialRecap();
    texts.push(recap.title, recap.scoreText, ...recap.lines, DESYNC_TEXT);
    for (const tx of texts) expect(tx, tx).toMatch(GLYPHS);
    expect(recap.lines).toHaveLength(7);
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(steps)).toBe(true);
    expect(Object.isFrozen(steps[0]!.pages)).toBe(true);
    expect(Object.isFrozen(steps[0]!.spotlight[0])).toBe(true);
  });
});

describe('createGame({ deck })', () => {
  it('deals the tutorial deck in order without touching the RNG', () => {
    const { state, events } = createGame({
      ...tutorialGameOptions(),
      rngFactory: () => {
        throw new Error('RNG must not be created');
      },
    });
    expect(state.room.map((c) => c?.id)).toEqual(['D5', 'S8', 'C3', 'H5']);
    expect(state.deck.map((c) => c.id)).toEqual(TUTORIAL_DECK_ORDER.slice(4));
    expect(events[0]).toEqual({ type: 'GameStarted', seed: 0x5c0d, hp: 20, deckSize: 14 });
  });

  it('rejects an empty deck and duplicate ids with RangeError', () => {
    const deck = tutorialGameOptions().deck!;
    expect(() => createGame({ seed: 1, deck: [] })).toThrow(RangeError);
    expect(() => createGame({ seed: 1, deck: [...deck, deck[0]!] })).toThrow(RangeError);
  });

  it('does not alias the caller deck, and is deterministic', () => {
    const opts = tutorialGameOptions();
    const a = createGame(opts);
    expect(a.state.deck).not.toBe(opts.deck);
    expect(createGame(tutorialGameOptions())).toEqual(a);
  });
});

describe('golden playthrough', () => {
  it('advances once per step on the documented trigger, HP 20 20 10 14 10 20, wins with 30', () => {
    const h = harness();
    const hpAfterRoom: number[] = [];
    h.session.subscribe((events, state) => {
      for (const e of events) if (e.type === 'RoomCleared' || e.type === 'RoomAvoided') hpAfterRoom.push(state.hp);
    });

    IDS.forEach((id, i) => {
      expect(h.t.phase).toBe('coaching');
      expect(currentStep(h.t).id).toBe(id);
      expect(h.t.stepIndex).toBe(i);
      const moves = CANON[id];
      moves.forEach((m, k) => {
        const last = k === moves.length - 1;
        if (m.kind === 'next') h.next();
        else {
          if (m.action.type === 'playCard') expect(h.try({ type: 'select', cardId: m.action.cardId }).allowed).toBe(true);
          expect(h.try(m.action).allowed).toBe(true);
        }
        // Only the final move of a step completes it.
        if (!last) expect(currentStep(h.t).id).toBe(id);
      });
    });

    expect(hpAfterRoom).toEqual([20, 20, 10, 14, 10, 20]);
    expect(h.session.state.phase).toBe('won');
    expect(h.session.state.score).toBe(30);
    expect(h.t.phase).toBe('recap');
    const chrome = tutorialChrome(h.t, h.session.state);
    expect(chrome.coach).toBeNull();
    expect(chrome.recap).toMatchObject({ title: 'DUNGEON CLEARED!', score: 30, scoreText: '20 HP + 10 POTION BONUS' });

    // The refused avoid never entered history; replaying the log reproduces the final state.
    expect(h.session.history.filter((a) => a.type === 'avoidRoom')).toHaveLength(1);
    const replayed = createSession(tutorialGameOptions());
    replayed.replay(tutorialGameOptions(), h.session.history);
    expect(replayed.state).toEqual(h.session.state);
  });

  it('works the same under weaponLimit lt (engine is the authority)', () => {
    let s: GameState = createGame({ ...tutorialGameOptions(), rules: { weaponLimit: 'lt' } }).state;
    for (const id of IDS) {
      for (const m of CANON[id]) {
        if (m.kind === 'next' || id === 'r3TryAvoid') continue;
        const r = step(s, m.action);
        expect(r.ok, `${id}`).toBe(true);
        if (r.ok) s = r.state;
      }
    }
    expect(s.phase).toBe('won');
    expect(s.score).toBe(30);
  });
});

describe('gate', () => {
  it('blocks every non-expected legal move and select with a nudge, at every step, without touching history', () => {
    const h = harness();
    for (const id of IDS) {
      const s = currentStep(h.t);
      const state = h.session.state;
      const histLen = h.session.history.length;
      const queries: TutorialQuery[] = [
        ...legalActions(state),
        ...state.room.filter((c) => c !== null).map((c) => ({ type: 'select' as const, cardId: c!.id })),
        { type: 'avoidRoom' },
      ];
      for (const q of queries) {
        const g = gate(h.t, state, q);
        const isExpected =
          s.expect !== null &&
          ((q.type === 'select' && s.expect.type === 'playCard' && s.expect.cardId === q.cardId) ||
            (q.type === 'playCard' &&
              s.expect.type === 'playCard' &&
              s.expect.cardId === q.cardId &&
              (s.expect.mode === undefined || (q.mode ?? 'barehanded') === s.expect.mode)) ||
            (q.type === 'avoidRoom' && s.expect.type === 'avoidRoom'));
        const harmlessEnter = q.type === 'enterRoom' && s.expect?.type === 'playCard' && state.phase === 'choosing';
        expect(g.allowed, `${id} ${JSON.stringify(q)}`).toBe(isExpected || harmlessEnter);
        if (!g.allowed) {
          expect(g.nudge.length).toBeGreaterThan(0);
          const before = h.t;
          const after = advance(before, { type: 'blocked', nudge: g.nudge });
          expect(after.stepIndex).toBe(before.stepIndex);
          expect(after.nudgeSerial).toBe(before.nudgeSerial + 1);
          expect(after.nudge).toBe(g.nudge);
        }
      }
      // Every action step's expect is legal, except the refused avoid of step 13.
      if (s.expect && s.expect.type !== 'enterRoom') {
        const action = s.expect as GameAction;
        const r = step(state, action);
        if (id === 'r3TryAvoid') expect(r.ok ? null : r.violation.code).toBe('cannotAvoidTwice');
        else expect(r.ok, id).toBe(true);
      }
      expect(h.session.history.length).toBe(histLen);
      for (const m of CANON[id]) {
        if (m.kind === 'next') h.next();
        else h.try(m.action);
      }
    }
  });

  it('prefers specific nudges and treats a missing mode as barehanded', () => {
    const h = harness();
    while (currentStep(h.t).id !== 'r1Fight') {
      for (const m of CANON[currentStep(h.t).id]) m.kind === 'next' ? h.next() : h.try(m.action);
    }
    const s = h.session.state;
    expect(gate(h.t, s, { type: 'playCard', cardId: 'S8', mode: 'barehanded' })).toEqual({
      allowed: false,
      nudge: 'BAREHANDED TAKES THE FULL 8. PICK THE SWORD (W).',
    });
    expect(gate(h.t, s, { type: 'playCard', cardId: 'S8' })).toMatchObject({ allowed: false });
    expect(gate(h.t, s, { type: 'playCard', cardId: 'H5' })).toEqual({
      allowed: false,
      nudge: 'TAP THE 8 OF SPADES (KEY 2), THEN THE SWORD (W).',
    });
  });

  it('allows enterRoom while choosing on a playCard step, without advancing', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) for (const _ of CANON[IDS[i]!]) h.next();
    expect(currentStep(h.t).id).toBe('r1Equip');
    expect(h.try({ type: 'enterRoom' }).allowed).toBe(true);
    expect(h.session.state.phase).toBe('resolving');
    expect(currentStep(h.t).id).toBe('r1Equip');
    expect(gate(h.t, h.session.state, { type: 'enterRoom' }).allowed).toBe(false);
  });
});

describe('NEXT and paging', () => {
  it('pages, completes info steps, and is a no-op on the last page of an action step', () => {
    let t = startTutorial();
    t = advance(t, { type: 'next' });
    expect(t).toMatchObject({ stepIndex: 0, page: 1 });
    t = advance(t, { type: 'next' });
    expect(t).toMatchObject({ stepIndex: 1, page: 0 });
    const r1Equip: TutorialState = { ...startTutorial(), stepIndex: IDS.indexOf('r1Equip') };
    expect(advance(r1Equip, { type: 'next' })).toBe(r1Equip);
  });

  it('acting early on page 1 of r4Drink completes it', () => {
    const h = harness();
    while (currentStep(h.t).id !== 'r4Drink') {
      for (const m of CANON[currentStep(h.t).id]) m.kind === 'next' ? h.next() : h.try(m.action);
    }
    expect(h.t.page).toBe(0);
    expect(tutorialChrome(h.t, h.session.state).coach?.showNext).toBe(true);
    expect(h.try({ type: 'playCard', cardId: 'H4' }).allowed).toBe(true);
    expect(currentStep(h.t).id).toBe('r4Waste');
    expect(tutorialChrome(h.t, h.session.state).coach).toMatchObject({ showNext: false, lesson: 5, lessonCount: 7 });
  });
});

describe('desync', () => {
  it('a GameLost batch desyncs', () => {
    const state = createGame(tutorialGameOptions()).state;
    const t = advance(startTutorial(), {
      type: 'events',
      events: [{ type: 'GameLost', score: -5, remainingMonsters: [] }],
      state,
    });
    expect(t.phase).toBe('desynced');
    const chrome = tutorialChrome(t, state);
    expect(chrome.coach).toMatchObject({ text: DESYNC_TEXT, showNext: true });
    expect(gate(t, state, { type: 'enterRoom' }).allowed).toBe(false);
  });

  it('a missing expected card after a completion desyncs', () => {
    const equip: TutorialState = { ...startTutorial(), stepIndex: IDS.indexOf('r1Equip') };
    const state = createGame(tutorialGameOptions()).state;
    const noS8: GameState = { ...state, room: state.room.map((c) => (c?.id === 'S8' ? null : c)) };
    const t = advance(equip, {
      type: 'events',
      events: [{ type: 'WeaponEquipped', weapon: state.room[0]!, replaced: null, discarded: [] }],
      state: noS8,
    });
    expect(t).toMatchObject({ phase: 'desynced', stepIndex: IDS.indexOf('r1Fight') });
  });

  it('looks through info steps to the next action step when checking sync', () => {
    // r1Fight -> r1FightDone (info) -> r1Potion expects H5. NEXT carries no state, so check at completion.
    const fight: TutorialState = { ...startTutorial(), stepIndex: IDS.indexOf('r1Fight') };
    const state = createGame(tutorialGameOptions()).state;
    const noH5: GameState = { ...state, room: state.room.map((c) => (c?.id === 'H5' ? null : c)) };
    const t = advance(fight, {
      type: 'events',
      events: [{ type: 'MonsterSlain', monster: state.room[1]!, byWeapon: state.room[0]! }],
      state: noH5,
    });
    expect(t.phase).toBe('desynced');
  });
});

describe('recap', () => {
  it('a GameWon batch on a non-matching step (r6Two) still goes to recap on the last step', () => {
    // Regression for Adama's DR2 reject R1: recap used to require the current step's trigger to hit too.
    const state = createGame(tutorialGameOptions()).state;
    const r6Two: TutorialState = {
      ...startTutorial(),
      stepIndex: IDS.indexOf('r6Two'),
      nudge: 'STALE NUDGE',
      nudgeSerial: 3,
    };
    const t = advance(r6Two, {
      type: 'events',
      events: [{ type: 'GameWon', score: 20, hp: 20, potionBonus: 0 }],
      state,
    });
    expect(t).toEqual({ phase: 'recap', stepIndex: IDS.length - 1, page: 0, nudge: null, nudgeSerial: 3 });
  });
});

describe('determinism', () => {
  it('start and options are deep-equal across calls', () => {
    expect(startTutorial()).toEqual(startTutorial());
    expect(tutorialGameOptions()).toEqual(tutorialGameOptions());
  });
});
