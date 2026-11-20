/**
 * App-side adapter between the pure tutorial step machine (src/tutorial, Tyrol) and the app shell.
 * CONTRACT (Design Review 2). Impl owner: Starbuck (owns src/ui and the app.ts integration).
 * NOT wired into app.ts yet: the stub throws, and nothing constructs it, so normal play is unaffected.
 *
 * The controller holds TutorialState, applies the gate before the app dispatches, feeds accepted batches and
 * violations back to the machine, and latches the coach view while FX is presenting (docs/TUTORIAL.md "FX timing").
 *
 * app.ts integration points (Starbuck), all no-ops when !controller.active:
 *  1. newGame path: tutorialStart -> controller.start(session) instead of session.newGame({ seed }).
 *  2. session.subscribe listener: also calls controller.onEvents(events, state) (after fx.enqueue).
 *  3. dispatch(): before session.dispatch, controller.gate(query); blocked -> controller.block(nudge),
 *     play 'coachBlip' (not 'uiDenied'), no toast. On a rejected dispatch: controller.onViolation(...).
 *     selectCard intents are gated as { type: 'select', cardId } before pendingFight is set.
 *  4. refresh(): ui.tutorial = controller.chrome(fx.isBusy()); the frame loop shows the recap instead of the
 *     normal result panel once GameWon has finished presenting.
 *  5. handle(): tutorialNext / tutorialSkip / tutorialDecline / tutorialPlayReal / tutorialStart, and Settings
 *     persistence of tutorialSeen (the app stays the single Settings writer).
 */
import type { GameAction, GameEvent, GameSession, GameState, RuleViolation } from '../game';
import type { GateResult, TutorialChrome, TutorialQuery, TutorialStepId } from '../tutorial';
import { notImplemented } from '../notImplemented';

/** Side effects the controller asks the app to perform (the app maps them to audio.play / fx.tutorialCue). */
export type TutorialSignal =
  /** New coach page or step text became visible (after FX went idle). */
  | { readonly type: 'coachShown'; readonly stepId: TutorialStepId; readonly page: number }
  /** An action step was completed and its presentation finished. */
  | { readonly type: 'stepSucceeded'; readonly stepId: TutorialStepId }
  /** The gate blocked a move; nudge text is now showing. */
  | { readonly type: 'nudged'; readonly serial: number }
  /** Recap became visible. */
  | { readonly type: 'completed' };

export interface TutorialController {
  /** True between start() and exit() (including the recap). */
  readonly active: boolean;
  /** Reset the machine and start the scripted game on `session` (session.newGame(tutorialGameOptions())). */
  start(session: GameSession): void;
  /** Leave the tutorial (skip, play a real run, or title). Idempotent. */
  exit(): void;
  /** Gate a player move before dispatch. Always { allowed: true } when inactive. */
  gate(query: TutorialQuery, state: GameState): GateResult;
  /** Record a blocked move's nudge. */
  block(nudge: string): void;
  /** Feed an accepted batch (from the session listener). */
  onEvents(events: readonly GameEvent[], state: GameState): void;
  /** Feed an engine rejection of a gated-in action. */
  onViolation(action: GameAction, violation: RuleViolation, state: GameState): void;
  /** NEXT pressed (the app has already handled fx.isBusy()). */
  next(): void;
  /**
   * Chrome for this frame. While `fxBusy`, returns the chrome latched when FX last went busy (so the coach never
   * describes cards the player has not seen land yet). Null when inactive.
   */
  chrome(fxBusy: boolean): TutorialChrome | null;
  /** Subscribe to presentation signals (audio cues, fx.tutorialCue). Returns an unsubscribe. */
  onSignal(listener: (signal: TutorialSignal) => void): () => void;
}

export function createTutorialController(): TutorialController {
  return notImplemented('createTutorialController', 'Starbuck');
}
