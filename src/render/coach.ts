/**
 * Tutorial overlays: coach panel, spotlight dimming, pointer arrow, first-launch offer, recap screen.
 * CONTRACT (Design Review 2). Impl owner: Starbuck. NOT called by renderer.ts yet (stub throws).
 *
 * Pure drawing from GameView.chrome.tutorial / tutorialOffer, LayoutSnapshot.coach / regions / buttons / cards, and
 * FxFrame.coach. Never reads GameState, never applies rules. Draw order inside renderer.draw():
 *   board -> dim layer with spotlight holes (drawSpotlight) -> coach panel + arrow (drawCoach) -> toast,
 *   and drawRecap / drawOffer as full overlays in place of the result panel / over the title.
 * Reduced motion: static spotlight (FxFrame.coach absent or pulse 0), no arrow bob, no panel bump.
 */
import type { FxFrame } from '../fx/types';
import type { GameView, LayoutSnapshot } from '../ui/view';
import { notImplemented } from '../notImplemented';

export function drawSpotlight(ctx: CanvasRenderingContext2D, view: GameView, layout: LayoutSnapshot, fx: FxFrame): void {
  void ctx;
  void view;
  void layout;
  void fx;
  notImplemented('drawSpotlight', 'Starbuck');
}

export function drawCoach(ctx: CanvasRenderingContext2D, view: GameView, layout: LayoutSnapshot, fx: FxFrame, timeMs: number): void {
  void ctx;
  void view;
  void layout;
  void fx;
  void timeMs;
  notImplemented('drawCoach', 'Starbuck');
}

export function drawRecap(ctx: CanvasRenderingContext2D, view: GameView, layout: LayoutSnapshot): void {
  void ctx;
  void view;
  void layout;
  notImplemented('drawRecap', 'Starbuck');
}

export function drawOffer(ctx: CanvasRenderingContext2D, view: GameView, layout: LayoutSnapshot): void {
  void ctx;
  void view;
  void layout;
  notImplemented('drawOffer', 'Starbuck');
}
