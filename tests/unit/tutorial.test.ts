/**
 * Interactive tutorial (Design Review 2). Written against the contract (src/tutorial/types.ts, machine.ts header)
 * and the spec (docs/TUTORIAL.md), not against the implementation. Real engine, no mocks of src/game.
 *
 * The harness below is the controller flow from the machine.ts header:
 *   g = gate(t, session.state, query)
 *   allowed -> (select: UI-local, nothing) | session.dispatch(action) -> advance(events | violation)
 *   blocked -> advance(blocked)
 *   NEXT    -> advance(next)
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  canAvoidRoom,
  canUseWeaponOn,
  createGame,
  createSession,
  legalActions,
  previewDamage,
  step,
  weaponLimit,
  type CardId,
  type GameEvent,
  type GameSession,
  type GameState,
} from '../../src/game';
import {
  LESSONS,
  TUTORIAL_DECK_ORDER,
  TUTORIAL_SEED,
  advance,
  currentStep,
  gate,
  startTutorial,
  tutorialChrome,
  tutorialGameOptions,
  tutorialRecap,
  tutorialSteps,
  type ActionMatcher,
  type SpotlightTarget,
  type TutorialQuery,
  type TutorialState,
  type TutorialStep,
  type TutorialStepId,
} from '../../src/tutorial';
import DOC from '../../docs/TUTORIAL.md?raw';
import FONT_SRC from '../../src/render/font.ts?raw';
import TUT_TYPES from '../../src/tutorial/types.ts?raw';
import TUT_MACHINE from '../../src/tutorial/machine.ts?raw';
import TUT_SCRIPT from '../../src/tutorial/script.ts?raw';
import TUT_INDEX from '../../src/tutorial/index.ts?raw';
import { AVOID, ENTER, deepFreeze, eventsOf, ids, makeState, play, room, types } from './helpers';

// ---------------------------------------------------------------------------------------------
// Spec data (docs/TUTORIAL.md)
// ---------------------------------------------------------------------------------------------

const STEP_IDS: TutorialStepId[] = [
  'welcome', 'monsters', 'weapons', 'potions',
  'roomRule', 'r1Equip', 'r1Fight', 'r1FightDone', 'r1Potion', 'r1Cleared',
  'r2Look', 'r2Avoid', 'r3TryAvoid', 'r3Refused',
  'r3Fight6', 'r3Dull', 'r3TooDull', 'r3Fight4',
  'r4Drink', 'r4Waste', 'r4Wasted', 'r4NewWeapon',
  'r5Return', 'r5Losing', 'r5Ace', 'r5Seven', 'r5Three',
  'r6Final', 'r6Two', 'r6Potion',
];

/** Lesson number (1-based) of each step, per the "Lesson n/7" headings. */
const LESSON_OF: Record<TutorialStepId, number> = Object.fromEntries(
  STEP_IDS.map((id, i) => [id, i < 4 ? 1 : i < 10 ? 2 : i < 14 ? 3 : i < 18 ? 4 : i < 22 ? 5 : i < 27 ? 6 : 7]),
) as Record<TutorialStepId, number>;

const GLYPHS_RE = /^[A-Z0-9 \-+.,:!?'/<>=%()#]*$/;
const MAX_PAGE = 138;
const LINE = 46;
const NEXT_NUDGE = 'PRESS NEXT (ENTER) TO CONTINUE.';
const DESYNC_TEXT = 'SOMETHING WENT WRONG. PRESS NEXT TO RESTART THE TUTORIAL.';

const SELECT = (cardId: CardId): TutorialQuery => ({ type: 'select', cardId });
type Move = 'next' | TutorialQuery;

/** The canonical player for each step (docs "Lesson script" + the e2e key sequence). */
const CANON: Record<TutorialStepId, Move[]> = {
  welcome: ['next', 'next'],
  monsters: ['next'],
  weapons: ['next'],
  potions: ['next'],
  roomRule: ['next', 'next'],
  r1Equip: [play('D5')],
  r1Fight: [SELECT('S8'), play('S8', 'weapon')],
  r1FightDone: ['next'],
  r1Potion: [play('H5')],
  r1Cleared: ['next', 'next'],
  r2Look: ['next', 'next'],
  r2Avoid: [AVOID],
  r3TryAvoid: [AVOID],
  r3Refused: ['next'],
  r3Fight6: [SELECT('S6'), play('S6', 'weapon')],
  r3Dull: ['next', 'next'],
  r3TooDull: [play('C9', 'barehanded')],
  r3Fight4: [SELECT('C4'), play('C4', 'weapon')],
  r4Drink: ['next', play('H4')],
  r4Waste: [play('H2')],
  r4Wasted: ['next'],
  r4NewWeapon: [play('D10')],
  r5Return: ['next'],
  r5Losing: ['next', 'next'],
  r5Ace: [SELECT('S14'), play('S14', 'weapon')],
  r5Seven: [SELECT('C7'), play('C7', 'weapon')],
  r5Three: [SELECT('C3'), play('C3', 'weapon')],
  r6Final: ['next'],
  r6Two: [SELECT('C2'), play('C2', 'weapon')],
  r6Potion: [play('H10')],
};

/** Specific nudges from the doc's Nudge column: [step, wrong query, exact text]. */
const SPECIFIC_NUDGES: [TutorialStepId, TutorialQuery, string][] = [
  ['r1Equip', AVOID, 'NO RUNNING YET. WE WILL TRY AVOIDING SOON.'],
  ['r1Fight', play('S8', 'barehanded'), 'BAREHANDED TAKES THE FULL 8. PICK THE SWORD (W).'],
  ['r1Fight', play('S8'), 'BAREHANDED TAKES THE FULL 8. PICK THE SWORD (W).'], // absent mode = barehanded
  ['r1Potion', play('C3', 'barehanded'), 'LEAVE THE 3. IT STAYS FOR THE NEXT ROOM.'],
  ['r1Potion', play('C3', 'weapon'), 'LEAVE THE 3. IT STAYS FOR THE NEXT ROOM.'],
  ['r1Potion', SELECT('C3'), 'LEAVE THE 3. IT STAYS FOR THE NEXT ROOM.'],
  ['r3Fight6', play('S6', 'barehanded'), 'USE THE SWORD (W). IT BLOCKS 5 OF THE 6.'],
  ['r3TooDull', play('H4'), 'SAVE THE POTION. IT WILL STAY FOR THE NEXT ROOM.'],
  ['r3TooDull', SELECT('H4'), 'SAVE THE POTION. IT WILL STAY FOR THE NEXT ROOM.'],
  ['r3Fight4', play('C4', 'barehanded'), 'NO NEED TO BLEED. THE SWORD (W) BLOCKS ALL 4.'],
  ['r3Fight4', play('H4'), 'SAVE THE POTION. IT WILL STAY FOR THE NEXT ROOM.'],
  ['r4Drink', play('H2'), 'THE 4 OF HEARTS FIRST (KEY 4). BIGGER IS BETTER.'],
  ['r4NewWeapon', play('C2', 'barehanded'), 'LEAVE THE 2 OF CLUBS FOR LATER.'],
  ['r4NewWeapon', SELECT('C2'), 'LEAVE THE 2 OF CLUBS FOR LATER.'],
  ['r5Ace', play('S14', 'barehanded'), 'THAT WOULD KILL YOU! PICK THE SWORD (W).'],
  ['r5Three', play('C2', 'weapon'), 'KEEP THE 2 FOR LAST. TAKE THE 3 (KEY 4).'],
  ['r5Three', play('C2', 'barehanded'), 'KEEP THE 2 FOR LAST. TAKE THE 3 (KEY 4).'],
  ['r6Two', play('H10'), 'POTION LAST. TRUST ME.'],
];

// ---------------------------------------------------------------------------------------------
// Doc parsing: docs/TUTORIAL.md is the source of truth for words, spotlights and gates.
// ---------------------------------------------------------------------------------------------

interface DocRow {
  n: number;
  id: string;
  type: 'next' | 'action';
  spot: SpotlightTarget[];
  arrow: boolean;
  pages: string[];
  expect: ActionMatcher | null;
  until: { kind: string; event?: string; cardId?: string; code?: string };
  nudge: string | null; // null = "same"/"default"
  nudges: { when: ActionMatcher; text: string }[];
}

function matcherFrom(tokens: string[]): ActionMatcher {
  const t = tokens[0] === 'playCard' ? tokens.slice(1) : tokens;
  if (t[0] === 'avoidRoom') return { type: 'avoidRoom' };
  if (t[0] === 'enterRoom') return { type: 'enterRoom' };
  const cardId = t[0] as CardId;
  return t[1] ? { type: 'playCard', cardId, mode: t[1] as 'weapon' | 'barehanded' } : { type: 'playCard', cardId };
}

function parseDoc(): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of DOC.split(/\r?\n/)) {
    const m = /^\| (\d+) \| `(\w+)` \|/.exec(line);
    if (!m) continue;
    const cols = line.split('|').map((s) => s.trim());
    const [, n, idCol, type, spot, pages, gateCol, nudgeCol] = cols as [string, string, string, string, string, string, string, string];
    const spotItems = spot.split(',').map((s) => s.trim());
    const spotlight = spotItems.map((s: string): SpotlightTarget => {
      const [kind, id] = s.replace('→', '').trim().split(/\s+/) as [string, string];
      if (kind === 'card') return { kind: 'card', cardId: id as CardId };
      if (kind === 'control') return { kind: 'control', id: id as 'avoid' };
      return { kind: 'region', id: id as 'hp' };
    });
    const exp = /expect `([^`]+)`/.exec(gateCol);
    const until = /until (\*\*violation\*\* )?`(\w+)`(?: (\w+))?/.exec(gateCol);
    const nudgeHead = /^"([^"]*)"/.exec(nudgeCol);
    const nudges = [...nudgeCol.matchAll(/`([^`]+)`: "([^"]*)"/g)].map((x) => ({ when: matcherFrom(x[1]!.split(' ')), text: x[2]! }));
    rows.push({
      n: Number(n),
      id: idCol.replace(/`/g, ''),
      type: type as 'next' | 'action',
      spot: spotlight,
      arrow: spotItems[0]!.startsWith('→'),
      pages: [...pages.matchAll(/"([^"]*)"/g)].map((x) => x[1]!),
      expect: exp ? matcherFrom(exp[1]!.split(' ')) : null,
      until: !until
        ? { kind: 'next' }
        : until[1]
          ? { kind: 'violation', code: until[2]! }
          : { kind: 'event', event: until[2]!, ...(until[3] ? { cardId: until[3] } : {}) },
      nudge: nudgeHead ? nudgeHead[1]! : null,
      nudges,
    });
  }
  return rows;
}

function docRecapLines(): string[] {
  const sec = DOC.split('### Recap')[1]!.split('## Gating')[0]!;
  return [...sec.matchAll(/^\s+\d\. `([^`]+)`/gm)].map((x) => x[1]!);
}

/** Greedy word wrap, as a 46-column panel would. */
function wrap(text: string, width = LINE): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/** Glyph keys of the real 3x5 font (src/render/font.ts GLYPHS is private, so read its source). */
function fontGlyphs(): Set<string> {
  const block = FONT_SRC.split('const GLYPHS')[1]!.split('};')[0]!;
  const out = new Set<string>();
  for (const m of block.matchAll(/(?:'(.)'|"(.)"|\b([A-Za-z]))\s*:\s*'[01]{15}'/g)) out.add(m[1] ?? m[2] ?? m[3]!);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

interface Harness {
  session: GameSession;
  t: TutorialState;
  batches: { events: readonly GameEvent[]; state: GameState }[];
  /** Feed one player move through the gate. Returns what happened. */
  move(m: Move): 'next' | 'select' | 'accepted' | 'refused' | 'blocked';
  step(): TutorialStep;
}

function harness(): Harness {
  const session = createSession(tutorialGameOptions());
  const h: Harness = {
    session,
    t: startTutorial(),
    batches: [],
    step: () => currentStep(h.t),
    move(m) {
      if (m === 'next') {
        h.t = advance(h.t, { type: 'next' });
        return 'next';
      }
      const g = gate(h.t, session.state, m);
      if (!g.allowed) {
        h.t = advance(h.t, { type: 'blocked', nudge: g.nudge });
        return 'blocked';
      }
      if (m.type === 'select') return 'select';
      const r = session.dispatch(m);
      if (r.ok) {
        h.batches.push({ events: r.events, state: r.state });
        h.t = advance(h.t, { type: 'events', events: r.events, state: r.state });
        return 'accepted';
      }
      h.t = advance(h.t, { type: 'violation', violation: r.violation, state: r.state });
      return 'refused';
    },
  };
  return h;
}

/** Play the canonical moves up to (not including) the given step. */
function harnessAt(id: TutorialStepId): Harness {
  const h = harness();
  for (const sid of STEP_IDS) {
    if (sid === id) break;
    for (const m of CANON[sid]) h.move(m);
  }
  expect(h.t.phase).toBe('coaching');
  expect(h.step().id).toBe(id);
  return h;
}

const qkey = (q: TutorialQuery): string => JSON.stringify(q);

/** Every query a player could try against this state: legal actions, plus both modes and no mode, avoid, enter, selects. */
function allQueries(s: GameState): TutorialQuery[] {
  const out = new Map<string, TutorialQuery>();
  const add = (q: TutorialQuery): void => void out.set(qkey(q), q);
  for (const a of legalActions(s)) add(a);
  add(ENTER);
  add(AVOID);
  for (const card of s.room) {
    if (!card) continue;
    add(SELECT(card.id));
    add(play(card.id));
    if (card.suit === 'clubs' || card.suit === 'spades') {
      add(play(card.id, 'weapon'));
      add(play(card.id, 'barehanded'));
    }
  }
  return [...out.values()];
}

function matches(m: ActionMatcher, q: TutorialQuery): boolean {
  if (m.type !== 'playCard') return q.type === m.type;
  if (q.type === 'select') return q.cardId === m.cardId;
  if (q.type !== 'playCard' || q.cardId !== m.cardId) return false;
  return m.mode === undefined || (q.mode ?? 'barehanded') === m.mode;
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('tutorial deck and options', () => {
  it('TUTORIAL_DECK_ORDER is the documented 14-card dungeon', () => {
    expect([...TUTORIAL_DECK_ORDER]).toEqual(['D5', 'S8', 'C3', 'H5', 'S14', 'C7', 'H10', 'S6', 'C9', 'C4', 'H4', 'D10', 'H2', 'C2']);
    const docDeck = /```\n(D5 .*?)\s{2,}\(14 cards\)/.exec(DOC.replace(/\r/g, ''))![1]!;
    expect(docDeck.split(/[\s|]+/).filter(Boolean)).toEqual([...TUTORIAL_DECK_ORDER]);
  });

  it('tutorialGameOptions: TUTORIAL_SEED, the scripted deck as Cards in order, DEFAULT_RULES', () => {
    const o = tutorialGameOptions();
    expect(o.seed).toBe(TUTORIAL_SEED);
    expect(o.deck?.map((x) => x.id)).toEqual([...TUTORIAL_DECK_ORDER]);
    for (const card of o.deck ?? []) expect(`${card.suit[0]!.toUpperCase()}${card.rank}`).toBe(card.id);
    expect({ ...DEFAULT_RULES, ...(o.rules ?? {}) }).toEqual(DEFAULT_RULES);
    const g = createGame(o).state;
    expect(ids(g.room)).toEqual(['D5', 'S8', 'C3', 'H5']);
    expect(g.rules).toEqual(DEFAULT_RULES);
  });
});

describe('script integrity', () => {
  const steps = (): readonly TutorialStep[] => tutorialSteps();
  const doc = parseDoc();

  it('the doc parser found all 30 steps (guards the doc-sync tests below)', () => {
    expect(doc.map((r) => r.id)).toEqual(STEP_IDS);
    expect(doc.map((r) => r.n)).toEqual(STEP_IDS.map((_, i) => i + 1));
  });

  it('the doc pages themselves obey the glyph, length and 3x46 wrap rules (spec self-check)', () => {
    for (const r of doc) {
      for (const p of r.pages) {
        expect(p, r.id).toMatch(GLYPHS_RE);
        expect(p.length, `${r.id}: ${p}`).toBeLessThanOrEqual(MAX_PAGE);
        expect(wrap(p).length, `${r.id}: ${wrap(p).join(' / ')}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('src/tutorial imports only src/game (purity gate)', () => {
    const files: [string, string][] = [['types.ts', TUT_TYPES], ['machine.ts', TUT_MACHINE], ['script.ts', TUT_SCRIPT], ['index.ts', TUT_INDEX]];
    for (const [f, src] of files) {
      for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(m[1]!, `${f} imports ${m[1]}`).toMatch(/^(\.\/[\w]+|\.\.\/game(\/[\w]+)?)$/);
      }
    }
  });

  it('step ids are exactly TutorialStepId, in order, unique', () => {
    expect(steps().map((s) => s.id)).toEqual(STEP_IDS);
  });

  it('every lesson is used, in order, matching the lesson headings', () => {
    expect(LESSONS).toHaveLength(7);
    const seen = steps().map((s) => LESSONS.indexOf(s.lesson) + 1);
    expect(seen).toEqual(STEP_IDS.map((id) => LESSON_OF[id]));
  });

  it('page text matches docs/TUTORIAL.md word for word', () => {
    for (const s of steps()) expect(s.pages, s.id).toEqual(doc.find((r) => r.id === s.id)!.pages);
  });

  it('spotlight and arrow match the doc Spot column', () => {
    for (const s of steps()) {
      const r = doc.find((x) => x.id === s.id)!;
      expect(s.spotlight, s.id).toEqual(r.spot);
      expect(s.arrow, s.id).toBe(r.arrow);
    }
  });

  it('type, expect and trigger match the doc Gate column', () => {
    for (const s of steps()) {
      const r = doc.find((x) => x.id === s.id)!;
      if (r.type === 'next') {
        expect(s.expect, s.id).toBeNull();
        expect(s.until, s.id).toEqual({ kind: 'next' });
      } else {
        expect(s.expect, s.id).toEqual(r.expect);
        expect(s.until, s.id).toEqual(r.until);
      }
    }
  });

  it('nudges match the doc Nudge column (default text and every specific nudge)', () => {
    for (const s of steps()) {
      const r = doc.find((x) => x.id === s.id)!;
      expect(s.nudge, s.id).toBe(r.nudge ?? NEXT_NUDGE);
      for (const n of r.nudges) expect(s.nudges ?? [], s.id).toContainEqual(n);
    }
  });

  it('every page, title and nudge uses only the documented glyphs, and the font really has each one', () => {
    const font = fontGlyphs();
    expect(font.size).toBeGreaterThan(40); // parser sanity
    const texts: [string, string][] = [];
    for (const s of steps()) {
      texts.push([`${s.id}.title`, s.title]);
      s.pages.forEach((p, i) => texts.push([`${s.id}.page${i}`, p]));
      texts.push([`${s.id}.nudge`, s.nudge]);
      for (const n of s.nudges ?? []) texts.push([`${s.id}.nudges`, n.text]);
    }
    const recap = tutorialRecap();
    texts.push(['recap.title', recap.title], ['recap.scoreText', recap.scoreText]);
    recap.lines.forEach((l, i) => texts.push([`recap.line${i}`, l]));
    for (const [where, text] of texts) {
      expect(text, where).toMatch(GLYPHS_RE);
      expect(text.length, where).toBeGreaterThan(0);
      for (const ch of text) expect(font.has(ch), `${where}: font lacks ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it('every page is at most 138 chars and word-wraps into 3 lines of 46 (nudges too)', () => {
    for (const s of steps()) {
      for (const p of [...s.pages, s.nudge, ...(s.nudges ?? []).map((n) => n.text)]) {
        expect(p.length, `${s.id}: ${p}`).toBeLessThanOrEqual(MAX_PAGE);
        const lines = wrap(p);
        expect(lines.length, `${s.id}: ${lines.join(' / ')}`).toBeLessThanOrEqual(3);
        for (const l of lines) expect(l.length).toBeLessThanOrEqual(LINE);
      }
    }
  });

  it('titles are upper case and at most 20 chars', () => {
    for (const s of steps()) {
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.title.length, s.id).toBeLessThanOrEqual(20);
      expect(s.title).toBe(s.title.toUpperCase());
    }
  });

  it('next steps have no expect; action steps have one page count of 1 or 2 and a non-next trigger', () => {
    for (const s of steps()) {
      expect(s.pages.length, s.id).toBeGreaterThanOrEqual(1);
      if (s.expect === null) expect(s.until.kind).toBe('next');
      else expect(s.until.kind).not.toBe('next');
    }
  });

  it('the recap matches the doc', () => {
    const r = tutorialRecap();
    expect(r.title).toBe('DUNGEON CLEARED!');
    expect(r.score).toBe(30);
    expect(r.scoreText).toBe('20 HP + 10 POTION BONUS');
    expect(r.lines).toEqual(docRecapLines());
    expect(r.lines).toHaveLength(7);
  });
});

describe('golden playthrough on the real engine', () => {
  it('advances exactly once per step, on the documented trigger, and wins with HP 20,20,10,14,10,20 and score 30', () => {
    const h = harness();
    const steps = tutorialSteps();
    const hpAfterRoom: number[] = [];
    const reveals: (CardId | null)[][] = [ids(h.session.state.room)];
    let accepted = 0;

    STEP_IDS.forEach((id, idx) => {
      expect(h.t.phase, id).toBe('coaching');
      expect(h.t.stepIndex, id).toBe(idx);
      expect(h.step().id).toBe(id);
      expect(h.t.nudge).toBeNull();
      const def = steps[idx]!;

      // Every spotlit card is actually on the board when the step is shown.
      for (const sp of def.spotlight) {
        if (sp.kind === 'card') expect(ids(h.session.state.room), `${id} spotlights ${sp.cardId}`).toContain(sp.cardId);
      }
      // The expected move is legal (step 13 excepted: the engine must refuse it).
      if (def.expect && def.expect.type !== 'enterRoom') {
        const want = def.expect;
        const legal = legalActions(h.session.state).filter((a) => matches(want, a));
        if (id === 'r3TryAvoid') expect(legal, id).toEqual([]);
        else expect(legal.length, `${id}: expected move is legal`).toBeGreaterThan(0);
      }

      const moves = CANON[id];
      moves.forEach((m, i) => {
        const before = h.t;
        const res = h.move(m);
        expect(res, `${id} move ${i}`).not.toBe('blocked');
        if (res === 'accepted') accepted++;
        const last = i === moves.length - 1;
        if (!last) {
          expect(h.t.stepIndex, `${id}: no early advance`).toBe(idx);
          if (m === 'next') expect(h.t.page).toBe(before.page + 1);
        } else if (id === 'r6Potion') {
          expect(h.t.phase).toBe('recap');
        } else {
          expect(h.t.stepIndex, `${id}: advanced on its trigger`).toBe(idx + 1);
          expect(h.t.page).toBe(0);
        }
        if (res === 'accepted') {
          const evs = h.batches.at(-1)!.events;
          const s = h.batches.at(-1)!.state;
          if (evs.some((e) => e.type === 'RoomAvoided' || e.type === 'RoomRevealed' || e.type === 'GameWon')) hpAfterRoom.push(s.hp);
          if (evs.some((e) => e.type === 'RoomRevealed')) reveals.push(ids(s.room));
          // Action steps complete on their documented event.
          if (last && def.until.kind === 'event') {
            const trig = def.until;
            expect(
              evs.some((e) => e.type === trig.event && (trig.cardId === undefined || JSON.stringify(e).includes(`"id":"${trig.cardId}"`))),
              `${id}: batch contains ${trig.event}`,
            ).toBe(true);
          }
        }
        if (res === 'refused') expect(id).toBe('r3TryAvoid');
      });
    });

    expect(hpAfterRoom).toEqual([20, 20, 10, 14, 10, 20]);
    expect(reveals).toEqual([
      ['D5', 'S8', 'C3', 'H5'],
      ['S14', 'C7', 'C3', 'H10'],
      ['S6', 'C9', 'C4', 'H4'],
      ['D10', 'H2', 'C2', 'H4'],
      ['S14', 'C7', 'C2', 'C3'],
      ['H10', null, 'C2', null],
    ]);
    const end = h.session.state;
    expect(end.phase).toBe('won');
    expect(end.score).toBe(30);
    const won = eventsOf(h.batches.at(-1)!.events, 'GameWon')[0]!;
    expect(won).toMatchObject({ score: 30, hp: 20, potionBonus: 10 });
    expect(h.session.history).toHaveLength(accepted);
    expect(accepted).toBe(15);

    const chrome = tutorialChrome(h.t, end);
    expect(chrome.phase).toBe('recap');
    expect(chrome.coach).toBeNull();
    expect(chrome.recap).toEqual(tutorialRecap());
  });

  it('the scripted moves also win under weaponLimit lt (doc claim)', () => {
    const s = createSession({ ...tutorialGameOptions(), rules: { ...DEFAULT_RULES, weaponLimit: 'lt' } });
    for (const id of STEP_IDS) {
      for (const m of CANON[id]) {
        if (m === 'next' || m.type === 'select' || id === 'r3TryAvoid') continue;
        expect(s.dispatch(m).ok, `${id} ${qkey(m)}`).toBe(true);
      }
    }
    expect(s.state.phase).toBe('won');
    expect(s.state.score).toBe(30);
  });
});

describe('the directive concepts are really exercised by the engine', () => {
  it('monsters, weapons, potions (room 1): weapon blocks 5 of the 8, potion heal capped at 20', () => {
    const h = harnessAt('r1Fight');
    expect(h.session.state.weapon?.card.id).toBe('D5');
    h.move(SELECT('S8'));
    h.move(play('S8', 'weapon'));
    expect(h.session.state.hp).toBe(17);
    expect(h.session.state.weapon?.slain.map((x) => x.id)).toEqual(['S8']);
    while (h.step().id !== 'r1Potion') h.move('next');
    h.move(play('H5'));
    const used = eventsOf(h.batches.at(-1)!.events, 'PotionUsed')[0]!;
    expect(used.potion.id).toBe('H5');
    expect(h.session.state.hp).toBe(20);
  });

  it('rooms: play 3, leave 1 (the 3 of clubs is carried into room 2 in its slot)', () => {
    const h = harnessAt('r1Potion');
    h.move(play('H5'));
    const evs = h.batches.at(-1)!.events;
    expect(eventsOf(evs, 'RoomCleared')[0]!.carried?.id).toBe('C3');
    expect(ids(h.session.state.room)).toEqual(['S14', 'C7', 'C3', 'H10']);
  });

  it('avoiding: room 2 avoided, then the engine itself refuses the second avoid (cannotAvoidTwice) with no state change', () => {
    const h = harnessAt('r2Avoid');
    h.move(AVOID);
    expect(types(h.batches.at(-1)!.events)).toContain('RoomAvoided');
    expect(h.session.state.deck.slice(-4).map((x) => x.id)).toEqual(['S14', 'C7', 'C3', 'H10']);
    expect(h.step().id).toBe('r3TryAvoid');
    expect(canAvoidRoom(h.session.state)).toBe(false);

    // The gate lets it through (the refusal IS the lesson)...
    expect(gate(h.t, h.session.state, AVOID)).toEqual({ allowed: true });
    const before = h.session.state;
    const hist = h.session.history.length;
    // ...and the engine refuses it.
    const r = h.session.dispatch(AVOID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.violation.code).toBe('cannotAvoidTwice');
    expect(h.session.state).toBe(before);
    expect(h.session.history).toHaveLength(hist);
    h.t = advance(h.t, { type: 'violation', violation: r.violation, state: r.state });
    expect(h.step().id).toBe('r3Refused');
  });

  it('a different violation does not complete the avoid-twice step', () => {
    const h = harnessAt('r3TryAvoid');
    const t2 = advance(h.t, { type: 'violation', violation: { code: 'cannotAvoidFinalRoom' }, state: h.session.state });
    expect(t2.stepIndex).toBe(h.t.stepIndex);
  });

  it('weapon degradation: after killing the 6 the weapon cannot fight the 9 (engine refuses), but still fights the 4', () => {
    const h = harnessAt('r3TooDull');
    const s = h.session.state;
    expect(weaponLimit(s)).toBe(6);
    expect(canUseWeaponOn(s, 'C9')).toBe(false);
    expect(canUseWeaponOn(s, 'C4')).toBe(true);
    expect(legalActions(s)).not.toContainEqual(play('C9', 'weapon'));
    const r = step(s, play('C9', 'weapon'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation).toEqual({ code: 'weaponCannotFight', cardId: 'C9', limit: 6 });
    // The gate never lets the impossible move through (it would only reach an engine refusal).
    const g = gate(h.t, s, play('C9', 'weapon'));
    expect(g.allowed).toBe(false);
    h.move(play('C9', 'barehanded'));
    expect(h.session.state.hp).toBe(19 - 9);
    expect(weaponLimit(h.session.state)).toBe(6); // barehanded kill does not touch the weapon
    h.move(SELECT('C4'));
    h.move(play('C4', 'weapon'));
    expect(h.session.state.hp).toBe(10);
    expect(h.session.state.weapon?.slain.map((x) => x.id)).toEqual(['S8', 'S6', 'C4']);
  });

  it('one potion per room: the 4 heals, the 2 is wasted (PotionWasted, HP unchanged)', () => {
    const h = harnessAt('r4Drink');
    h.move(play('H4'));
    expect(h.session.state.hp).toBe(14);
    expect(h.step().id).toBe('r4Waste');
    h.move(play('H2'));
    const evs = h.batches.at(-1)!.events;
    expect(eventsOf(evs, 'PotionWasted')[0]).toMatchObject({ potion: { id: 'H2' }, reason: 'alreadyUsedThisRoom' });
    expect(types(evs)).not.toContain('PotionUsed');
    expect(h.session.state.hp).toBe(14);
    expect(h.step().id).toBe('r4Wasted');
  });

  it('a new weapon replaces the old one and its kills, and starts with no limit', () => {
    const h = harnessAt('r4NewWeapon');
    h.move(play('D10'));
    const s = h.session.state;
    expect(s.weapon?.card.id).toBe('D10');
    expect(s.weapon?.slain).toEqual([]);
    expect(weaponLimit(s)).toBeNull();
    expect(s.discard.map((x) => x.id)).toEqual(expect.arrayContaining(['D5', 'S8', 'S6', 'C4']));
  });

  it('avoided cards come back: room 5 holds the ace, the 7 and the 3 again', () => {
    const h = harnessAt('r5Return');
    expect(ids(h.session.state.room)).toEqual(['S14', 'C7', 'C2', 'C3']);
    expect(h.session.state.deck.map((x) => x.id)).toEqual(['H10']);
  });

  it('losing: the barehanded ace really is lethal in the engine, and the gate refuses it with the nudge', () => {
    const h = harnessAt('r5Ace');
    const s = h.session.state;
    expect(s.hp).toBe(14);
    expect(previewDamage(s, s.room[0]!, 'barehanded')).toBe(14);
    expect(previewDamage(s, s.room[0]!, 'weapon')).toBe(4);
    const lethal = step(s, play('S14', 'barehanded'));
    expect(lethal.ok && lethal.state.phase).toBe('lost');
    if (lethal.ok) {
      const lost = eventsOf(lethal.events, 'GameLost')[0]!;
      expect(lost.score).toBeLessThan(0);
    }
    const g = gate(h.t, s, play('S14', 'barehanded'));
    expect(g).toEqual({ allowed: false, nudge: 'THAT WOULD KILL YOU! PICK THE SWORD (W).' });
  });

  it('the final room: deck empty, cannot avoid, every card must be played, win with the potion bonus', () => {
    const h = harnessAt('r6Final');
    const s = h.session.state;
    expect(s.deck).toEqual([]);
    expect(canAvoidRoom(s)).toBe(false);
    const r = step(s, AVOID);
    expect(!r.ok && r.violation.code).toBe('cannotAvoidFinalRoom');
    h.move('next');
    h.move(SELECT('C2'));
    h.move(play('C2', 'weapon'));
    expect(h.session.state.phase).toBe('resolving'); // the final room is not done until every card is played
    expect(h.step().id).toBe('r6Potion');
    h.move(play('H10'));
    expect(h.session.state.phase).toBe('won');
    expect(h.session.state.score).toBe(30);
    expect(h.t.phase).toBe('recap');
  });
});

describe('gate', () => {
  it('at every step, exactly the expected move (plus select/enterRoom rules) is allowed; everything else is blocked with a nudge', () => {
    const h = harness();
    const steps = tutorialSteps();
    for (const [idx, id] of STEP_IDS.entries()) {
      const def = steps[idx]!;
      const s = h.session.state;
      const sBefore = structuredClone(s);
      for (let page = 0; page < def.pages.length; page++) {
        for (const q of allQueries(s)) {
          const g = gate(h.t, s, q);
          let want: boolean;
          if (def.expect === null) want = false;
          else if (q.type === 'enterRoom') want = def.expect.type === 'playCard' && s.phase === 'choosing';
          else want = matches(def.expect, q);
          expect(g.allowed, `${id} p${page} ${qkey(q)}`).toBe(want);
          if (!g.allowed) {
            expect(g.nudge.length, `${id} ${qkey(q)} nudge`).toBeGreaterThan(0);
            // Feeding the block does not advance and does not touch the game.
            const t2 = advance(h.t, { type: 'blocked', nudge: g.nudge });
            expect(t2.stepIndex).toBe(h.t.stepIndex);
            expect(t2.page).toBe(h.t.page);
            expect(t2.phase).toBe('coaching');
            expect(t2.nudge).toBe(g.nudge);
            expect(t2.nudgeSerial).toBe(h.t.nudgeSerial + 1);
          } else if (q.type !== 'select' && id !== 'r3TryAvoid') {
            // Rule 6: the gate never allows something the engine would refuse.
            expect(step(s, q).ok, `${id} gate allowed an illegal ${qkey(q)}`).toBe(true);
          }
        }
        // Next page, if the step has more than one, without leaving the step.
        if (page < def.pages.length - 1) h.move('next');
      }
      expect(h.session.state).toEqual(sBefore);
      // Finish the step canonically (skip the NEXT presses we already made).
      const rest = CANON[id].slice(def.expect === null ? def.pages.length - 1 : CANON[id].filter((m) => m === 'next').length);
      for (const m of rest) h.move(m);
    }
    expect(h.t.phase).toBe('recap');
  });

  it('specific nudges take precedence over the step nudge', () => {
    for (const [id, q, text] of SPECIFIC_NUDGES) {
      const h = harnessAt(id);
      expect(gate(h.t, h.session.state, q), `${id} ${qkey(q)}`).toEqual({ allowed: false, nudge: text });
    }
  });

  it('a wrong move gets the step nudge when no specific nudge matches', () => {
    const h = harnessAt('r1Equip');
    expect(gate(h.t, h.session.state, play('H5'))).toEqual({ allowed: false, nudge: 'FIRST, PICK UP THE 5 OF DIAMONDS (KEY 1).' });
    const n = harnessAt('welcome');
    expect(gate(n.t, n.session.state, play('D5'))).toEqual({ allowed: false, nudge: NEXT_NUDGE });
  });

  it('blocked moves never reach the engine: no HP lost, history and state unchanged, step unchanged (controller flow)', () => {
    const h = harnessAt('r1Fight');
    const before = h.session.state;
    const hist = h.session.history;
    for (const q of [play('S8', 'barehanded'), play('H5'), play('C3', 'barehanded'), AVOID, SELECT('H5')]) {
      expect(h.move(q)).toBe('blocked');
    }
    expect(h.session.state).toBe(before);
    expect(h.session.history).toBe(hist);
    expect(h.session.state.hp).toBe(20);
    expect(h.step().id).toBe('r1Fight');
    expect(h.t.nudgeSerial).toBe(5);
    expect(h.t.nudge).toBe('TAP THE 8 OF SPADES (KEY 2), THEN THE SWORD (W).');
  });

  it('a successful advance clears the nudge', () => {
    const h = harnessAt('r1Equip');
    h.move(play('H5'));
    expect(h.t.nudge).not.toBeNull();
    h.move(play('D5'));
    expect(h.step().id).toBe('r1Fight');
    expect(h.t.nudge).toBeNull();
  });

  it('enterRoom is harmless while choosing on a playCard step: allowed, accepted by the engine, does not advance', () => {
    const h = harnessAt('r1Equip');
    expect(h.session.state.phase).toBe('choosing');
    expect(h.move(ENTER)).toBe('accepted');
    expect(h.step().id).toBe('r1Equip');
    expect(h.session.state.phase).toBe('resolving');
    // Once resolving, enterRoom is no longer allowed (the engine would refuse it).
    expect(gate(h.t, h.session.state, ENTER).allowed).toBe(false);
    h.move(play('D5'));
    expect(h.step().id).toBe('r1Fight');
  });

  it('enterRoom is blocked on an avoid step', () => {
    const h = harnessAt('r2Avoid');
    expect(gate(h.t, h.session.state, ENTER).allowed).toBe(false);
  });

  it('recap and desynced block every game move', () => {
    const h = harnessAt('r6Potion');
    h.move(play('H10'));
    expect(h.t.phase).toBe('recap');
    for (const q of [ENTER, AVOID, play('H10'), SELECT('C2')]) expect(gate(h.t, h.session.state, q).allowed).toBe(false);
    const d = harnessAt('r1Equip');
    const lost = makeState({ phase: 'lost', hp: 0, score: -5 });
    const t = advance(d.t, { type: 'events', events: [{ type: 'GameLost', score: -5, remainingMonsters: [] }], state: lost });
    expect(t.phase).toBe('desynced');
    for (const q of allQueries(d.session.state)) expect(gate(t, d.session.state, q).allowed).toBe(false);
  });

  it('gate is pure: it never mutates its inputs (deep-frozen) and is repeatable', () => {
    const h = harnessAt('r3Fight4');
    const t = deepFreeze(structuredClone(h.t));
    const s = deepFreeze(structuredClone(h.session.state));
    for (const q of allQueries(s)) expect(gate(t, s, deepFreeze(q))).toEqual(gate(t, s, q));
  });
});

describe('NEXT', () => {
  it('pages through a multi-page info step, then completes it on the last page', () => {
    const h = harnessAt('welcome');
    expect(h.t.page).toBe(0);
    h.move('next');
    expect(h.t.page).toBe(1);
    expect(h.step().id).toBe('welcome');
    h.move('next');
    expect(h.step().id).toBe('monsters');
    expect(h.t.page).toBe(0);
  });

  it('NEXT is a no-op on the last page of an action step', () => {
    const h = harnessAt('r1Equip');
    const before = h.t;
    h.move('next');
    expect(h.t).toEqual(before);
    const r = harnessAt('r4Drink');
    r.move('next');
    expect(r.t.page).toBe(1);
    const p1 = r.t;
    r.move('next');
    expect(r.t).toEqual(p1);
  });

  it('acting early on page 1 of r4Drink completes it', () => {
    const h = harnessAt('r4Drink');
    expect(h.t.page).toBe(0);
    expect(h.move(play('H4'))).toBe('accepted');
    expect(h.step().id).toBe('r4Waste');
    expect(h.t.page).toBe(0);
  });

  it('NEXT clears a nudge', () => {
    const h = harnessAt('welcome');
    h.move(play('D5'));
    expect(h.t.nudge).toBe(NEXT_NUDGE);
    h.move('next');
    expect(h.t.nudge).toBeNull();
  });

  it('a batch completes at most one step', () => {
    const h = harnessAt('r1Equip');
    const s = h.session.state;
    const evs: GameEvent[] = [
      { type: 'WeaponEquipped', weapon: s.room[0]!, replaced: null, discarded: [] },
      { type: 'MonsterSlain', monster: s.room[1]!, byWeapon: s.room[0]! },
    ];
    const t = advance(h.t, { type: 'events', events: evs, state: s });
    expect(t.stepIndex).toBe(h.t.stepIndex + 1);
  });

  it('an unrelated batch does not complete an action step', () => {
    const h = harnessAt('r1Equip');
    const t = advance(h.t, { type: 'events', events: [{ type: 'RoomEntered', roomNumber: 1 }], state: h.session.state });
    expect(t.stepIndex).toBe(h.t.stepIndex);
  });

  it('an event about the wrong card does not complete the step', () => {
    const h = harnessAt('r3Fight6');
    const s = h.session.state;
    const t = advance(h.t, {
      type: 'events',
      events: [{ type: 'MonsterSlain', monster: s.room[2]!, byWeapon: null }],
      state: s,
    });
    expect(t.stepIndex).toBe(h.t.stepIndex);
  });
});

describe('chrome (coach view)', () => {
  it('reflects the step on every page of the playthrough', () => {
    const h = harness();
    const steps = tutorialSteps();
    for (const [idx, id] of STEP_IDS.entries()) {
      const def = steps[idx]!;
      for (const m of [...CANON[id], null]) {
        if (h.t.phase !== 'coaching' || h.t.stepIndex !== idx) break;
        const c = tutorialChrome(h.t, h.session.state);
        expect(c.phase).toBe('coaching');
        expect(c.recap).toBeNull();
        const v = c.coach!;
        expect(v.stepId).toBe(id);
        expect(v.lesson).toBe(LESSON_OF[id]);
        expect(v.lessonCount).toBe(7);
        expect(v.title).toBe(def.title);
        expect(v.page).toBe(h.t.page);
        expect(v.pageCount).toBe(def.pages.length);
        expect(v.text).toBe(def.pages[h.t.page]);
        const lastPage = h.t.page === def.pages.length - 1;
        expect(v.showNext, `${id} p${h.t.page}`).toBe(def.expect === null ? true : !lastPage);
        expect(v.spotlight).toEqual(def.spotlight);
        expect(v.arrow).toBe(def.arrow);
        expect(v.dim).toBe(def.spotlight.length > 0);
        expect(v.nudge).toBe(h.t.nudge);
        expect(v.nudgeSerial).toBe(h.t.nudgeSerial);
        if (m !== null) h.move(m);
      }
    }
  });

  it('shows the nudge after a blocked move', () => {
    const h = harnessAt('r2Avoid');
    h.move(play('S14', 'barehanded'));
    expect(tutorialChrome(h.t, h.session.state).coach?.nudge).toBe('NOT THIS ROOM. PRESS AVOID (KEY A).');
  });
});

describe('desync: the stuck-state fallback', () => {
  it('a GameLost batch sends the machine to desynced, with restart text the player can act on', () => {
    const h = harnessAt('r5Ace');
    const lethal = step(h.session.state, play('S14', 'barehanded'));
    if (!lethal.ok) throw new Error('expected lethal to be accepted by the engine');
    const t = advance(h.t, { type: 'events', events: lethal.events, state: lethal.state });
    expect(t.phase).toBe('desynced');
    const c = tutorialChrome(t, lethal.state);
    expect(c.phase).toBe('desynced');
    expect(c.recap).toBeNull();
    expect(c.coach?.text).toBe(DESYNC_TEXT);
    expect(c.coach?.text).toMatch(GLYPHS_RE);
    expect(c.coach?.showNext).toBe(true);
  });

  it('a completion whose next expected card is missing from the room sends the machine to desynced', () => {
    const h = harnessAt('r1Equip');
    // WeaponEquipped D5 completes r1Equip; r1Fight expects S8, which this (forged) room lacks.
    const forged = makeState({
      phase: 'resolving',
      room: room(null, 'C3', 'H5', null),
      weapon: { card: h.session.state.room[0]!, slain: [] },
      resolvedThisRoom: 1,
    });
    const evs = h.session.dispatch(play('D5'));
    if (!evs.ok) throw new Error('D5 should be accepted');
    const t = advance(h.t, { type: 'events', events: evs.events, state: forged });
    expect(t.phase).toBe('desynced');
  });

  it('the real state after the same batch does not desync (control for the case above)', () => {
    const h = harnessAt('r1Equip');
    h.move(play('D5'));
    expect(h.t.phase).toBe('coaching');
  });

  it('a GameLost batch on an info step also desyncs', () => {
    const h = harnessAt('welcome');
    const t = advance(h.t, { type: 'events', events: [{ type: 'GameLost', score: -1, remainingMonsters: [] }], state: makeState({ phase: 'lost', hp: 0 }) });
    expect(t.phase).toBe('desynced');
  });
});

describe('determinism and purity', () => {
  it('startTutorial and tutorialGameOptions are deep-equal across calls and plain JSON', () => {
    expect(startTutorial()).toEqual(startTutorial());
    expect(startTutorial()).toEqual({ phase: 'coaching', stepIndex: 0, page: 0, nudge: null, nudgeSerial: 0 });
    expect(JSON.parse(JSON.stringify(startTutorial()))).toEqual(startTutorial());
    expect(tutorialGameOptions()).toEqual(tutorialGameOptions());
    expect(createGame(tutorialGameOptions())).toEqual(createGame(tutorialGameOptions()));
    expect(tutorialSteps()).toEqual(tutorialSteps());
  });

  it('two playthroughs give identical machine states and chrome at every move; machine state stays plain JSON', () => {
    const a = harness();
    const b = harness();
    for (const id of STEP_IDS) {
      for (const m of CANON[id]) {
        a.move(m);
        b.move(m);
        expect(a.t).toEqual(b.t);
        expect(JSON.parse(JSON.stringify(a.t))).toEqual(a.t);
        expect(tutorialChrome(a.t, a.session.state)).toEqual(tutorialChrome(b.t, b.session.state));
      }
    }
  });

  it('advance never mutates its (deep-frozen) inputs', () => {
    const h = harness();
    for (const id of STEP_IDS) {
      for (const m of CANON[id]) {
        const t = deepFreeze(structuredClone(h.t));
        if (m === 'next') {
          expect(() => advance(t, deepFreeze({ type: 'next' }))).not.toThrow();
        } else if (m.type !== 'select') {
          const r = step(h.session.state, m);
          const input = r.ok
            ? deepFreeze({ type: 'events' as const, events: structuredClone(r.events), state: structuredClone(r.state) })
            : deepFreeze({ type: 'violation' as const, violation: structuredClone(r.violation), state: structuredClone(r.state) });
          expect(() => advance(t, input)).not.toThrow();
        }
        expect(() => advance(t, deepFreeze({ type: 'blocked', nudge: 'X' }))).not.toThrow();
        h.move(m);
      }
    }
  });

  it('replaying the canonical action log reproduces the final state', () => {
    const h = harness();
    for (const id of STEP_IDS) for (const m of CANON[id]) h.move(m);
    const r = createSession({ seed: 1 });
    r.replay(tutorialGameOptions(), h.session.history);
    expect(r.state).toEqual(h.session.state);
  });
});
