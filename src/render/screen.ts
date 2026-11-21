/**
 * Screen geometry: logical canvas size, upscale factor and safe content box for a viewport. Pure. Owner: Starbuck.
 *
 * The short side is always SHORT_SIDE (270) logical px. The long side follows the viewport aspect from 16:9 (480)
 * up to 22:9 (660), so a 19.5:9 phone gets 270x585 instead of a 270x480 canvas with black bars. Past 22:9 the
 * canvas stops growing and is centred (letterboxed); below 16:9 the short side letterboxes.
 *
 * Both Renderer.resize (canvas size) and computeLayout (rects) call screenGeometry with the same Viewport, so the
 * scene they draw and the rects hitTest checks always agree. LayoutSnapshot carries `logical` and `safe` so the
 * renderer and coach overlays never have to recompute them.
 */
import type { Rect } from '../ui/view';
import type { SafeInsets, Viewport } from './types';

export const SHORT_SIDE = 270;
/** 16:9 long side: the design size every frame was drawn for. */
export const BASE_LONG = 480;
/** 22:9 cap. Wider screens letterbox the long axis. */
export const MAX_LONG = 660;
/**
 * Integer upscale unless it would leave more than this fraction of the short axis empty (decision 2026-11-20 (c)):
 * the recorded rule, used when dpr < 2. At dpr 1 an uneven nearest-neighbour pixel is a whole visible screen pixel,
 * so common 16:9 desktops keep an exact integer scale (1600x900 -> 3x, 2560x1440 -> 5x, 1100x620 -> 2x).
 */
export const INTEGER_WASTE = 0.2;
/**
 * The same threshold at dpr >= 2 (amendment, fullscreen-layout revision). Device pixels are small enough there that
 * the uneven widths of a fractional scale do not show, more so under the CRT pass, so the screen is filled instead:
 * a dpr-3 phone (1179 px = 4.37 x 270) goes fractional rather than showing 8% bars. Exact near-multiples still snap
 * (S22+ and Pixel 7 at dpr 2.625: 1080 device px = 4 x 270).
 */
export const INTEGER_WASTE_HIDPI = 0.05;
/**
 * Minimum logical margins kept clear of the physical screen edge for HUD chrome, whatever the safe-area insets say
 * (CSS insets never cover rounded corners, and the Capacitor cutout inset is unverified on a device). The safe box
 * is max(inset, minimum) on each side of the long axis, taken out of the spare length beyond 16:9, so a 16:9 screen
 * (no spare) keeps the original frames.
 *
 * Galaxy S22+ (1080x2340, ~393 ppi, so ~15.5 device px per mm; 4 device px per logical px): the punch-hole is a
 * ~3 mm hole centred ~3 mm below the top edge, so it ends ~4.5 mm = ~70 device px = ~18 logical px down, right
 * above the centred ROOM label. The display corners have a radius of ~6 mm = ~95 device px = ~24 logical px.
 * - CHROME_EDGE = 24 (portrait top, landscape left and right, since the camera can be on either short side):
 *   ROOM / SCOUNDREL text starts at 24 + 5 = 29, ~11 logical px (~2.8 mm) under the hole. The corner buttons'
 *   outer corner (4 px in from the side, 27 px down) is outside a 24 px radius. In landscape the 24 px side margin
 *   puts SCORE at x 32 and the settings button's right edge 29 px in, both outside the corner and clear of the hole.
 *   Portrait has 105 logical px spare on the S22+ (585 - 480), so 24 costs under a quarter of it.
 * - CHROME_EDGE_BOTTOM = 8 (portrait bottom): the bottom corners are rounded too; the coach strip is inset 6 px from
 *   the sides, and a 24 px corner arc passes 6 px in at 8.1 px up, so 8 keeps its corners on the glass. It also
 *   lifts the title footer off the gesture handle.
 */
export const CHROME_EDGE = 24;
export const CHROME_EDGE_BOTTOM = 8;

export type Insets = SafeInsets;

export interface ScreenGeometry {
  /** Logical canvas size. */
  readonly w: number;
  readonly h: number;
  /** Device pixels per logical pixel. */
  readonly scale: number;
  /** Display canvas backing size in device px. */
  readonly devW: number;
  readonly devH: number;
  /** Safe content box in logical px: clear of the display cutout and gesture bar (insets mapped onto the canvas). */
  readonly safe: Rect;
}

export function screenGeometry(vp: Viewport): ScreenGeometry {
  const portrait = vp.orientation === 'portrait';
  const dpr = Math.max(1, vp.devicePixelRatio || 1);
  const availW = Math.max(1, vp.cssWidth * dpr);
  const availH = Math.max(1, vp.cssHeight * dpr);
  const shortDev = portrait ? availW : availH;
  const longDev = portrait ? availH : availW;
  const fit = Math.min(shortDev / SHORT_SIDE, longDev / BASE_LONG);
  const waste = dpr >= 2 ? INTEGER_WASTE_HIDPI : INTEGER_WASTE;
  let scale = Math.floor(fit + 1e-9);
  if (scale < 1 || scale < fit * (1 - waste)) scale = fit;
  // The long axis follows the viewport aspect, never more than fits at this scale. When the integer snap leaves a
  // short-axis letterbox, the canvas keeps the viewport's shape (a 16:9 window stays 480x270 with even bars).
  const aspectLong = Math.round((SHORT_SIDE * longDev) / shortDev);
  const long = Math.max(BASE_LONG, Math.min(MAX_LONG, aspectLong, Math.floor(longDev / scale + 1e-6)));
  const w = portrait ? SHORT_SIDE : long;
  const h = portrait ? long : SHORT_SIDE;
  const devW = Math.max(1, Math.round(w * scale));
  const devH = Math.max(1, Math.round(h * scale));
  return { w, h, scale, devW, devH, safe: safeBox(vp, w, h, scale, availW, availH, devW, devH, dpr) };
}

/**
 * Logical safe box. Insets are CSS px from the viewport edges; the canvas is centred, so whatever letterbox already
 * sits between the edge and the canvas is subtracted first. Each side is max(inset, CHROME_EDGE*) so the HUD clears the
 * punch-hole and rounded corners even when the insets report 0. Only the long axis is inset (the cutout and the gesture
 * bar sit on the short edges of a phone); landscape insets both sides by the larger one so the centre line stays at
 * w/2 (titles and panels centre on it). The box never shrinks below the 16:9 design size: content may then reach
 * into the inset rather than overlap itself.
 */
function safeBox(vp: Viewport, w: number, h: number, scale: number, availW: number, availH: number, devW: number, devH: number, dpr: number): Rect {
  const s = vp.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const toLogical = (cssInset: number, letterboxDev: number): number =>
    Math.max(0, Math.ceil((Math.max(0, cssInset) * dpr - letterboxDev) / scale - 1e-6));
  // A minimum margin is measured from the physical edge too, so a long-axis letterbox counts towards it.
  const edge = (minimum: number, letterboxDev: number): number => Math.max(0, Math.ceil(minimum - letterboxDev / scale - 1e-6));
  if (vp.orientation === 'portrait') {
    const lb = (availH - devH) / 2;
    let top = Math.max(edge(CHROME_EDGE, lb), toLogical(s.top, lb));
    let bottom = Math.max(edge(CHROME_EDGE_BOTTOM, lb), toLogical(s.bottom, lb));
    const spare = h - BASE_LONG;
    if (top + bottom > spare) {
      const k = spare / (top + bottom);
      top = Math.floor(top * k);
      bottom = Math.floor(bottom * k);
    }
    return { x: 0, y: top, w, h: h - top - bottom };
  }
  const lb = (availW - devW) / 2;
  const side = Math.min(Math.floor((w - BASE_LONG) / 2), Math.max(edge(CHROME_EDGE, lb), toLogical(s.left, lb), toLogical(s.right, lb)));
  return { x: side, y: 0, w: w - side * 2, h };
}

/** Logical size when only the orientation is known (tests, or a LayoutSnapshot built without geometry). */
export function baseSize(orientation: 'portrait' | 'landscape'): { w: number; h: number } {
  return orientation === 'portrait' ? { w: SHORT_SIDE, h: BASE_LONG } : { w: BASE_LONG, h: SHORT_SIDE };
}
