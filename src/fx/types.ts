/**
 * Animation / juice. CONTRACT. Owner: Gaeta. Consumers: render/ (reads FxFrame), ui/ (input gating), audio/ (cues).
 *
 * Model: the engine is synchronous and has already moved on; FX *presents* the event batch over time.
 * - FxDirector queues GameEvent batches and plays them in order.
 * - Each frame it produces an FxFrame: per-card transform overrides relative to layout home positions,
 *   plus screen-level effects. Render composes layout + FxFrame.
 * - When an event "lands" on screen, FxDirector emits an FxCue. Audio plays SFX on cues, so sound
 *   is synced to animation, not to dispatch time.
 */
import { createFxDirectorImpl } from './director';
import type { CardId, GameEvent } from '../game';
import type { LayoutSnapshot } from '../ui/view';

export interface CardTransform {
  /** Absolute logical-pixel position of the card's top-left (overrides layout home). */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** Radians. */
  readonly rotation: number;
  /** 0 = face down, 1 = face up; render interpolates a flip around 0.5. */
  readonly faceUp: number;
  readonly opacity: number;
  /** 0..1 white flash overlay (hit feedback). */
  readonly flash: number;
  /** Draw order; higher on top. */
  readonly z: number;
}

export interface FxFrame {
  /**
   * Cards currently being animated. Cards not present render at their layout home, at rest.
   * May include "ghost" cards that are no longer in GameView/layout (discarded, swept back into the deck)
   * while their exit tween plays; render draws those from the CardId (suit letter + rank). A card held
   * back by FX (not yet dealt on screen) is present with opacity 0.
   */
  readonly cards: ReadonlyMap<CardId, CardTransform>;
  /** Screen shake offset in logical pixels. */
  readonly shake: { readonly x: number; readonly y: number };
  /** Full-screen tint flash, e.g. red on damage, green on heal. */
  readonly screenFlash: { readonly color: string; readonly alpha: number } | null;
  /** HUD numbers mid-tween (HP counts down/up). Render falls back to GameView values when undefined. */
  readonly hud: { readonly hp?: number; readonly score?: number };
  /** Floating text pops ("-7", "+5", "WASTED"). x/y is the text's centre anchor in logical pixels. */
  readonly popups: readonly { readonly text: string; readonly x: number; readonly y: number; readonly alpha: number; readonly color: string }[];
  /** Extra CRT intensity bump (0..1) for big moments; render/post-process adds it to base params. */
  readonly crtPulse: number;
}

/** An event reaching the screen; audio and haptics key off these. */
export interface FxCue {
  readonly event: GameEvent;
  /** Index of the event inside its batch. */
  readonly index: number;
}

export interface FxDirector {
  /** Queue an event batch (from GameSession listener). */
  enqueue(events: readonly GameEvent[]): void;
  /** Advance time. `layout` gives home positions to tween toward. */
  update(dtMs: number, layout: LayoutSnapshot): void;
  frame(): FxFrame;
  /** True while a batch is still playing. ui/ blocks new game actions while busy (hover still works). */
  isBusy(): boolean;
  /** Fast-forward everything queued to the end state (tap-to-skip). Still emits all cues, audio may coalesce. */
  skip(): void;
  onCue(listener: (cue: FxCue) => void): () => void;
  /** Accessibility: shorten/disable motion, shake and flashes. Cues still fire. */
  setReducedMotion(on: boolean): void;
  /**
   * Optional (additive, Gaeta 2026-11-20): card under the pointer gets a lift + tilt wobble.
   * ui/ forwards hover HitTargets of kind 'card' here; null clears. Purely cosmetic, never blocks.
   */
  setHover?(cardId: CardId | null): void;
}

export function createFxDirector(): FxDirector {
  return createFxDirectorImpl();
}

export type Easing = (t: number) => number;
