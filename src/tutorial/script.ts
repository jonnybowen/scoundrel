/**
 * The lesson script as data: one TutorialStep per TutorialStepId, in order. Impl owner: Tyrol.
 * Source of truth for the words and gates is docs/TUTORIAL.md "Lesson script"; keep them in sync.
 * The scripted deck is TUTORIAL_DECK_ORDER in ./types.
 */
import { notImplemented } from '../game/notImplemented';
import type { RecapView, TutorialStep } from './types';

/** All steps, in script order. Length and ids must match TutorialStepId exactly (Tigh tests this). */
export function tutorialSteps(): readonly TutorialStep[] {
  return notImplemented('tutorialSteps', 'Tyrol');
}

/** Recap screen content (docs/TUTORIAL.md "Recap"). */
export function tutorialRecap(): RecapView {
  return notImplemented('tutorialRecap', 'Tyrol');
}
