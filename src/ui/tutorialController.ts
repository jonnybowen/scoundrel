/**
 * App-side adapter between the pure tutorial step machine (src/tutorial, Tyrol) and the app shell.
 * CONTRACT (Design Review 2). Impl owner: Starbuck (owns src/ui and the app.ts integration).
 * Wired into app.ts (Design Review 2 integration, Starbuck).
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
import { advance, currentStep, gate, startTutorial, tutorialChrome, tutorialGameOptions } from '../tutorial';
import type { GateResult, TutorialChrome, TutorialInput, TutorialQuery, TutorialState, TutorialStepId } from '../tutorial';

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
  let t: TutorialState | null = null;
  let session: GameSession | null = null;
  /** Chrome handed out on the previous chrome() call, and the copy frozen when FX went busy. */
  let lastReturned: TutorialChrome | null = null;
  let latched: TutorialChrome | null = null;
  /** Key (phase/step/page) of the coach content last announced with coachShown/completed. */
  let shownKey: string | null = null;
  /** An action step completed; its success cue waits until the presentation catches up. */
  let pendingSuccess: TutorialStepId | null = null;
  const listeners = new Set<(signal: TutorialSignal) => void>();

  const emit = (signal: TutorialSignal): void => {
    for (const l of [...listeners]) {
      try {
        l(signal);
      } catch (e) {
        console.warn('[tutorial] signal listener failed', e);
      }
    }
  };

  /** Feed the machine and note whether an action step just completed (for the success chime). */
  const feed = (input: TutorialInput, successOnComplete: boolean): void => {
    if (!t) return;
    const before = t;
    const step = before.phase === 'coaching' ? currentStep(before) : null;
    t = advance(before, input);
    const completed = t.stepIndex !== before.stepIndex || (before.phase === 'coaching' && t.phase === 'recap');
    if (completed && successOnComplete && step && step.until.kind !== 'next') pendingSuccess = step.id;
  };

  const reset = (): void => {
    lastReturned = null;
    latched = null;
    shownKey = null;
    pendingSuccess = null;
  };

  const controller: TutorialController = {
    get active() {
      return t !== null;
    },

    start(s) {
      session = s;
      // Machine off while the opening deal broadcasts: those events belong to no step.
      t = null;
      reset();
      s.newGame(tutorialGameOptions());
      t = startTutorial();
    },

    exit() {
      t = null;
      session = null;
      reset();
    },

    gate(query, state) {
      if (!t) return { allowed: true };
      return gate(t, state, query);
    },

    block(nudge) {
      if (!t) return;
      t = advance(t, { type: 'blocked', nudge });
      emit({ type: 'nudged', serial: t.nudgeSerial });
    },

    onEvents(events, state) {
      feed({ type: 'events', events, state }, true);
    },

    onViolation(action, violation, state) {
      void action;
      // The one scripted refusal (avoiding twice) is the lesson itself: the engine's denied buzz plays, so no
      // success chime on top of it.
      feed({ type: 'violation', violation, state }, false);
    },

    next() {
      if (!t) return;
      if (t.phase === 'desynced') {
        // advance() ignores NEXT once desynced; restarting is the controller's job.
        if (session) controller.start(session);
        return;
      }
      feed({ type: 'next' }, false);
    },

    chrome(fxBusy) {
      if (!t || !session) return null;
      if (fxBusy) {
        // Freeze what the player saw before this batch started presenting.
        if (!latched) latched = lastReturned ?? tutorialChrome(t, session.state);
        lastReturned = latched;
        return latched;
      }
      latched = null;
      const live = tutorialChrome(t, session.state);
      const key = live.phase === 'recap' ? 'recap' : `${live.phase}:${live.coach?.stepId ?? ''}:${live.coach?.page ?? 0}`;
      lastReturned = live;
      if (key !== shownKey) {
        shownKey = key;
        const success = pendingSuccess;
        pendingSuccess = null;
        if (success) emit({ type: 'stepSucceeded', stepId: success });
        if (live.phase === 'recap') emit({ type: 'completed' });
        else if (live.coach) emit({ type: 'coachShown', stepId: live.coach.stepId, page: live.coach.page });
      }
      return live;
    },

    onSignal(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return controller;
}
