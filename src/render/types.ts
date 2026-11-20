/**
 * Rendering. CONTRACT. Owner: Starbuck.
 *
 * Pipeline: draw scene at a fixed low LOGICAL resolution into an offscreen target (crisp pixel art),
 * then a WebGL CRT post-process upscales to the screen (integer scale where possible, nearest-neighbour).
 * Fallback: if WebGL is unavailable, plain 2D canvas upscale without CRT.
 *
 * Render is a pure function of (GameView, LayoutSnapshot, FxFrame). It holds no game logic and
 * never mutates game state. It may cache GPU resources keyed by CardId.
 */
import { computeLayout as computeLayoutImpl } from './layout';
import { createCanvasRenderer } from './renderer';
import type { FxFrame } from '../fx/types';
import type { GameView, HitTarget, LayoutSnapshot } from '../ui/view';

/** Logical canvas size (landscape). Portrait swaps the axes to 270x480. Values live in theme.ts. */
export { LOGICAL_WIDTH, LOGICAL_HEIGHT } from './theme';

export interface Viewport {
  /** CSS pixel size of the display area. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  readonly orientation: 'portrait' | 'landscape';
}

export interface CrtParams {
  readonly enabled: boolean;
  readonly scanlineIntensity: number; // 0..1
  readonly curvature: number; // 0..1 barrel distortion
  readonly vignette: number; // 0..1
  readonly chromaticAberration: number; // px
  readonly noise: number; // 0..1
}

export interface Renderer {
  mount(canvas: HTMLCanvasElement): void;
  resize(viewport: Viewport): void;
  /** Pure function of its inputs (time only drives ambient shader effects). */
  draw(view: GameView, layout: LayoutSnapshot, fx: FxFrame, timeMs: number): void;
  /** Map a CSS-pixel pointer position (relative to the canvas) to a target, accounting for scale and CRT warp. */
  hitTest(cssX: number, cssY: number, layout: LayoutSnapshot): HitTarget | null;
  setCrt(params: Partial<CrtParams>): void;
  destroy(): void;
}

/** WebGL CRT renderer with automatic 2D-canvas fallback (see renderer.ts, crt.ts). */
export function createRenderer(): Renderer {
  return createCanvasRenderer();
}

/** Compute home positions for the current view. Pure; called each frame or on change. */
export function computeLayout(view: GameView, viewport: Viewport): LayoutSnapshot {
  return computeLayoutImpl(view, viewport);
}
