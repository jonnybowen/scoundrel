/**
 * Tutorial step machine. CONTRACT (Design Review 2). Impl owner: Tyrol. Tests: Tigh.
 * Pure functions over plain data; no DOM, no timers, no I/O. The engine stays the rules authority.
 *
 * Flow (driven by ui/tutorialController.ts):
 *   start:      session.newGame(tutorialGameOptions()); t = startTutorial()
 *   each input: g = gate(t, session.state, query)
 *                 allowed  -> session.dispatch(action)
 *                               ok     -> t = advance(t, { type: 'events', events, state })
 *                               reject -> t = advance(t, { type: 'violation', violation, state })
 *                 blocked  -> t = advance(t, { type: 'blocked', nudge: g.nudge })
 *   NEXT:       t = advance(t, { type: 'next' })
 *   each frame: chrome = tutorialChrome(t, session.state)
 *
 * Gate rules (normative; docs/TUTORIAL.md "Gating"):
 *  1. phase 'recap' | 'desynced': every game query is blocked.
 *  2. Info step (expect null): every game query is blocked with the step's nudge.
 *  3. The expected action is allowed on any page of its step (acting early skips the remaining pages).
 *     'select' is allowed when the expected action is a playCard of that card. For playCard with an expected
 *     mode, the action's mode (absent = 'barehanded') must equal it.
 *  4. enterRoom is allowed, without advancing, while the game phase is 'choosing' and the step expects a
 *     playCard (playing a card enters the room anyway).
 *  5. Anything else is blocked with the first matching `nudges[].text`, else the step's `nudge`.
 *  The gate never consults a rule the engine does not also enforce; it only narrows legal play.
 *  (Belt and braces for rule 6: an expected move the engine would refuse is blocked too, except on a step whose
 *  trigger IS that refusal. With the scripted deck this never fires.)
 *
 * Advance rules:
 *  - 'next' moves to the next page; on the last page of an info step it completes the step. No-op on the last
 *    page of an action step.
 *  - 'events': a batch containing GameLost desyncs (checked first). Otherwise a batch containing GameWon sets
 *    phase 'recap' (stepIndex on the last step, page 0, nudge cleared) whether or not the current step's trigger
 *    matched. Otherwise the current step completes when its trigger matches any event in the batch. A batch
 *    never completes more than one step.
 *  - 'violation' completes a step whose trigger is that violation code; otherwise it is ignored.
 *  - 'blocked' sets nudge and bumps nudgeSerial. Every completion clears the nudge and resets page to 0.
 *  - After any completion, if the new step expects a playCard whose card is not in state.room, or the batch
 *    contains GameLost, phase becomes 'desynced' (cannot happen with gating; it keeps the UI from bricking).
 *
 * Terminal phases: in 'recap' and 'desynced' every input is a no-op except 'blocked' (nudge bookkeeping).
 * In 'recap' stepIndex stays on the last step. Restarting from 'desynced' is the controller's job:
 * on NEXT it calls session.newGame(tutorialGameOptions()) and startTutorial() again.
 */
import { DEFAULT_RULES, buildDeck, step as engineStep } from '../game';
import type { Card, CardId, GameAction, GameEvent, GameState, NewGameOptions } from '../game';
import { tutorialRecap, tutorialSteps } from './script';
import { LESSONS, TUTORIAL_DECK_ORDER, TUTORIAL_SEED } from './types';
import type {
  ActionMatcher,
  CoachView,
  GateResult,
  RecapView,
  TutorialChrome,
  TutorialInput,
  TutorialQuery,
  TutorialState,
  TutorialStep,
} from './types';

/** Coach text while desynced (docs/TUTORIAL.md "Gating"). */
export const DESYNC_TEXT = 'SOMETHING WENT WRONG. PRESS NEXT TO RESTART THE TUTORIAL.';
/** Nudge for any game move once the scripted run is over. */
const RECAP_NUDGE = 'THE TUTORIAL IS DONE. PRESS ENTER FOR A REAL RUN.';

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

/** createGame options for the scripted dungeon: TUTORIAL_SEED, deck = TUTORIAL_DECK_ORDER as Cards, DEFAULT_RULES. */
export function tutorialGameOptions(): NewGameOptions {
  // Card objects come from the engine's own deck builder, so the tutorial never invents card data.
  const byId = new Map<CardId, Card>(buildDeck().map((c) => [c.id, c]));
  const deck = TUTORIAL_DECK_ORDER.map((id) => {
    const card = byId.get(id);
    if (!card) throw new RangeError(`TUTORIAL_DECK_ORDER: unknown card id ${id}`);
    return card;
  });
  return { seed: TUTORIAL_SEED, deck, rules: { ...DEFAULT_RULES } };
}

/** Initial machine state: phase 'coaching', step 0 ('welcome'), page 0, no nudge. */
export function startTutorial(): TutorialState {
  return { phase: 'coaching', stepIndex: 0, page: 0, nudge: null, nudgeSerial: 0 };
}

/** The step the machine is on (clamped, so it is total even for a hand-built state). */
export function currentStep(t: TutorialState): TutorialStep {
  const steps = tutorialSteps();
  const i = Math.min(Math.max(0, Math.trunc(t.stepIndex) || 0), steps.length - 1);
  return steps[i] as TutorialStep;
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Normalised fight mode of a playCard query (absent = barehanded, as the gate rules define). */
function modeOf(query: Extract<TutorialQuery, { type: 'playCard' }>): string {
  return query.mode ?? 'barehanded';
}

/** The expected-move test (gate rule 3). */
function matchesExpected(expect: ActionMatcher, query: TutorialQuery): boolean {
  if (query.type === 'select') return expect.type === 'playCard' && expect.cardId === query.cardId;
  if (expect.type === 'playCard') {
    if (query.type !== 'playCard' || expect.cardId !== query.cardId) return false;
    return expect.mode === undefined || modeOf(query) === expect.mode;
  }
  return expect.type === query.type;
}

/**
 * The specific-nudge test. A matcher with no mode matches any mode and the card-tap select; a matcher with a
 * mode matches only a playCard whose normalised mode (absent = barehanded) is that mode.
 */
function matchesNudge(when: ActionMatcher, query: TutorialQuery): boolean {
  if (query.type === 'select') {
    return when.type === 'playCard' && when.mode === undefined && when.cardId === query.cardId;
  }
  return matchesExpected(when, query);
}

function roomHas(game: GameState, cardId: CardId): boolean {
  return game.room.some((c) => c !== null && c.id === cardId);
}

/** Would the engine accept this query right now? Asks the engine itself; never re-implements a rule. */
function engineAccepts(game: GameState, query: TutorialQuery): boolean {
  if (query.type === 'select') return game.phase !== 'won' && game.phase !== 'lost' && roomHas(game, query.cardId);
  return engineStep(game, query as GameAction).ok;
}

function blocked(nudge: string): GateResult {
  return { allowed: false, nudge };
}

// ---------------------------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------------------------

/** May the player do this right now? Never mutates; see gate rules above. */
export function gate(t: TutorialState, game: GameState, query: TutorialQuery): GateResult {
  if (t.phase === 'desynced') return blocked(DESYNC_TEXT);
  if (t.phase === 'recap') return blocked(RECAP_NUDGE);

  const s = currentStep(t);
  const expect = s.expect;
  if (expect === null) return blocked(s.nudge);

  if (matchesExpected(expect, query)) {
    // Rule 6: the gate only narrows. The one deliberate exception is the step whose trigger is the refusal.
    if (s.until.kind === 'violation' || engineAccepts(game, query)) return { allowed: true };
    return blocked(s.nudge);
  }

  if (query.type === 'enterRoom' && expect.type === 'playCard' && game.phase === 'choosing') {
    return { allowed: true };
  }

  const specific = s.nudges?.find((n) => matchesNudge(n.when, query));
  return blocked(specific ? specific.text : s.nudge);
}

// ---------------------------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------------------------

/** The card an event is about, for StepTrigger.cardId. */
function eventCardId(e: GameEvent): CardId | null {
  switch (e.type) {
    case 'CardDealt':
      return e.card.id;
    case 'MonsterFought':
    case 'MonsterSlain':
      return e.monster.id;
    case 'DamageTaken':
      return e.source.id;
    case 'WeaponEquipped':
      return e.weapon.id;
    case 'PotionUsed':
    case 'PotionWasted':
      return e.potion.id;
    case 'RoomCleared':
      return e.carried ? e.carried.id : null;
    default:
      return null;
  }
}

/** Move past the current step: next index, page 0, nudge cleared. */
function complete(t: TutorialState): TutorialState {
  const last = tutorialSteps().length - 1;
  return { ...t, stepIndex: Math.min(t.stepIndex + 1, last), page: 0, nudge: null };
}

/**
 * After a completion with a known game state: is the script still playable? Checks the new step's expected card
 * or, when the new step is an info step, the next action step's. The game cannot change during info steps (every
 * move is blocked) and NEXT carries no state, so this is the last chance to catch a desync before the player is
 * stuck on an action step that can never be satisfied.
 */
function checkSync(t: TutorialState, game: GameState): TutorialState {
  const steps = tutorialSteps();
  let i = t.stepIndex;
  while (i < steps.length - 1 && (steps[i] as TutorialStep).expect === null) i++;
  const expect = (steps[i] as TutorialStep).expect;
  if (expect && expect.type === 'playCard' && !roomHas(game, expect.cardId)) return { ...t, phase: 'desynced' };
  return t;
}

/** Pure reducer. See advance rules above. */
export function advance(t: TutorialState, input: TutorialInput): TutorialState {
  if (input.type === 'blocked') return { ...t, nudge: input.nudge, nudgeSerial: t.nudgeSerial + 1 };
  if (t.phase !== 'coaching') return t;

  const s = currentStep(t);
  switch (input.type) {
    case 'next': {
      if (t.page < s.pages.length - 1) return { ...t, page: t.page + 1, nudge: null };
      if (s.until.kind === 'next' && t.stepIndex < tutorialSteps().length - 1) return complete(t);
      return t;
    }

    case 'events': {
      if (input.events.some((e) => e.type === 'GameLost')) return { ...t, phase: 'desynced' };
      if (input.events.some((e) => e.type === 'GameWon')) {
        // The game is over whether or not this step's trigger hit; stay in 'coaching' and the player is stuck.
        // stepIndex goes to the last step so currentStep() remains meaningful in the recap.
        return { ...t, stepIndex: tutorialSteps().length - 1, page: 0, nudge: null, phase: 'recap' };
      }
      const trig = s.until;
      if (trig.kind !== 'event') return t;
      const hit = input.events.some(
        (e) => e.type === trig.event && (trig.cardId === undefined || eventCardId(e) === trig.cardId),
      );
      if (!hit) return t;
      return checkSync(complete(t), input.state);
    }

    case 'violation': {
      const trig = s.until;
      if (trig.kind !== 'violation' || trig.code !== input.violation.code) return t;
      return checkSync(complete(t), input.state);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function coachView(t: TutorialState, s: TutorialStep): CoachView {
  const pageCount = s.pages.length;
  const page = Math.min(Math.max(0, t.page), pageCount - 1);
  return {
    stepId: s.id,
    lesson: LESSONS.indexOf(s.lesson) + 1,
    lessonCount: LESSONS.length,
    title: s.title,
    text: s.pages[page] ?? '',
    page,
    pageCount,
    showNext: s.expect === null || page < pageCount - 1,
    nudge: t.nudge,
    nudgeSerial: t.nudgeSerial,
    spotlight: s.spotlight,
    arrow: s.arrow && s.spotlight.length > 0,
    dim: s.spotlight.length > 0,
  };
}

function desyncView(t: TutorialState, s: TutorialStep): CoachView {
  return {
    stepId: s.id,
    lesson: LESSONS.indexOf(s.lesson) + 1,
    lessonCount: LESSONS.length,
    title: 'TUTORIAL',
    text: DESYNC_TEXT,
    page: 0,
    pageCount: 1,
    showNext: true,
    nudge: null,
    nudgeSerial: t.nudgeSerial,
    spotlight: [],
    arrow: false,
    dim: false,
  };
}

/** The recap, with the score taken from the engine's final state when the game is won. */
function recapView(game: GameState): RecapView {
  const base = tutorialRecap();
  if (game.phase !== 'won' || game.score === null) return base;
  const bonus = game.score - game.hp;
  return {
    ...base,
    score: game.score,
    scoreText: bonus > 0 ? `${game.hp} HP + ${bonus} POTION BONUS` : `${game.hp} HP`,
  };
}

/** View for render (coach panel + spotlight, or recap). */
export function tutorialChrome(t: TutorialState, game: GameState): TutorialChrome {
  const s = currentStep(t);
  switch (t.phase) {
    case 'recap':
      return { phase: 'recap', coach: null, recap: recapView(game) };
    case 'desynced':
      return { phase: 'desynced', coach: desyncView(t, s), recap: null };
    case 'coaching':
      return { phase: 'coaching', coach: coachView(t, s), recap: null };
  }
}
