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
 *
 * Advance rules:
 *  - 'next' moves to the next page; on the last page of an info step it completes the step. No-op on the last
 *    page of an action step.
 *  - 'events' completes the current step when its trigger matches any event in the batch; then, if the batch
 *    contains GameWon, phase becomes 'recap'. A batch never completes more than one step.
 *  - 'violation' completes a step whose trigger is that violation code; otherwise it is ignored.
 *  - 'blocked' sets nudge and bumps nudgeSerial. Every completion clears the nudge and resets page to 0.
 *  - After any completion, if the new step expects a playCard whose card is not in state.room, or the batch
 *    contains GameLost, phase becomes 'desynced' (cannot happen with gating; it keeps the UI from bricking).
 */
import type { GameState, NewGameOptions } from '../game';
import { notImplemented } from '../game/notImplemented';
import type { GateResult, TutorialChrome, TutorialInput, TutorialQuery, TutorialState, TutorialStep } from './types';

/** createGame options for the scripted dungeon: TUTORIAL_SEED, deck = TUTORIAL_DECK_ORDER as Cards, DEFAULT_RULES. */
export function tutorialGameOptions(): NewGameOptions {
  return notImplemented('tutorialGameOptions', 'Tyrol');
}

/** Initial machine state: phase 'coaching', step 0 ('welcome'), page 0, no nudge. */
export function startTutorial(): TutorialState {
  return notImplemented('startTutorial', 'Tyrol');
}

/** The step the machine is on. */
export function currentStep(t: TutorialState): TutorialStep {
  void t;
  return notImplemented('currentStep', 'Tyrol');
}

/** May the player do this right now? Never mutates; see gate rules above. */
export function gate(t: TutorialState, game: GameState, query: TutorialQuery): GateResult {
  void t;
  void game;
  void query;
  return notImplemented('gate', 'Tyrol');
}

/** Pure reducer. See advance rules above. */
export function advance(t: TutorialState, input: TutorialInput): TutorialState {
  void t;
  void input;
  return notImplemented('advance', 'Tyrol');
}

/** View for render (coach panel + spotlight, or recap). */
export function tutorialChrome(t: TutorialState, game: GameState): TutorialChrome {
  void t;
  void game;
  return notImplemented('tutorialChrome', 'Tyrol');
}
