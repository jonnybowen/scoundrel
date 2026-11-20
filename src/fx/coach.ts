/**
 * Coach overlay animation (spotlight pulse, arrow bob, panel bump, nudge shake, success flash).
 * CONTRACT (Design Review 2). Impl owner: Gaeta. NOT used by director.ts yet (stub throws).
 * The director owns one CoachFxTrack, forwards FxDirector.tutorialCue to cue(), advances it in update(),
 * and exposes value() as FxFrame.coach. It never touches the event queue or isBusy().
 */
import type { CoachFx, TutorialFxCue } from './types';
import { notImplemented } from '../notImplemented';

export interface CoachFxTrack {
  cue(cue: TutorialFxCue): void;
  update(dtMs: number): void;
  value(): CoachFx;
  setReducedMotion(on: boolean): void;
}

export function createCoachFxTrack(): CoachFxTrack {
  return notImplemented('createCoachFxTrack', 'Gaeta');
}
