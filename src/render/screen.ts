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
 * - CHROME_EDGE = 24 (landscape left and right, since the camera can be on either short side; also the portrait top
 *   floor on shorter tall screens): in landscape the 24 px side margin puts SCORE at x 32 and the settings button's
 *   right edge 29 px in, both outside the corner and clear of the hole. Landscape top and bottom are the long edges
 *   (no cutout, no nav bar), so landscape takes no top or bottom margin.
 * - CHROME_EDGE_BOTTOM = 8 (portrait bottom floor): a 24 px corner arc passes 6 px in (the coach strip's inset) at
 *   8.1 px up, so 8 keeps the strip's corners on the glass.
 * - CHROME_EDGE_TOP_TALL = 36 and CHROME_EDGE_BOTTOM_TALL = 40 (portrait, once the screen is tall enough; on-device
 *   review 2026-11-21): at 24 the ROOM row sat ~34 device px under the punch-hole (hole bottom y 74, ROOM y ~108),
 *   which read as cramped. At 36 the corner buttons start at y 36 + 3 = 39 (156 device px), ~82 device px (~5.3 mm)
 *   under the hole. At the bottom, the S22+ runs 3-button navigation: in immersive mode the bar is hidden and the
 *   safe-bottom inset reads 0, but a swipe brings it back over a strip 135 device px (~34 logical) tall, which covered
 *   AVOID's bottom edge. At 40 the play dock's bottom edge (DOCK_PAD 10 above the safe bottom) is 50 logical px up,
 *   16 px (64 device px) clear of that strip; the tutorial coach strip ends 44 up (10 clear) and the title footer 52.
 *   A gesture-nav phone's handle (~16 logical) is cleared by a wide margin too.
 *
 * The tall margins are not taken all at once (see portraitEdges): the play frame needs PORTRAIT_DOCK_RESERVE logical
 * px of extra height to anchor its action dock low, so the floor margins come first, then that reserve, and only then
 * the extra margin. Nothing gets worse than the floor margins on a shorter tall screen (a phone browser with its own
 * toolbars), and 16:9 (no spare) keeps margin 0.
 */
export const CHROME_EDGE = 24;
export const CHROME_EDGE_BOTTOM = 8;
export const CHROME_EDGE_TOP_TALL = 36;
export const CHROME_EDGE_BOTTOM_TALL = 40;
/**
 * Extra content height the portrait play frame needs before its action dock is fully anchored (layout.ts reclaims
 * the coach band at 2E up to 66 - DOCK_PAD = 56, so E = 28). A unit test keeps the two in step.
 */
export const PORTRAIT_DOCK_RESERVE = 28;

/**
 * Minimum portrait top and bottom margins (logical px) for a canvas `spare` px longer than 16:9, before insets:
 * 0..32 spare: the floor margins 24/8 scaled down proportionally (so 16:9 is 0/0); 32..60: 24/8 while the content
 * gets the dock reserve; 60..104: the margins grow towards 36/40, sharing the extra 12:32; 104 up: 36/40.
 * S22+ (spare 105): 36/40. Pixel 7 full screen (spare 120): 36/40. 22:9 (spare 180): 36/40.
 */
export function portraitEdges(spare: number): { top: number; bottom: number } {
  const s = Math.max(0, spare);
  const floorSum = CHROME_EDGE + CHROME_EDGE_BOTTOM;
  if (s < floorSum) {
    return { top: Math.floor((CHROME_EDGE * s) / floorSum), bottom: Math.floor((CHROME_EDGE_BOTTOM * s) / floorSum) };
  }
  const growTop = CHROME_EDGE_TOP_TALL - CHROME_EDGE;
  const growBottom = CHROME_EDGE_BOTTOM_TALL - CHROME_EDGE_BOTTOM;
  const extra = Math.min(growTop + growBottom, Math.max(0, s - floorSum - PORTRAIT_DOCK_RESERVE));
  const top = CHROME_EDGE + Math.floor((growTop * extra) / (growTop + growBottom));
  return { top, bottom: CHROME_EDGE_BOTTOM + extra - (top - CHROME_EDGE) };
}

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
    const spare = h - BASE_LONG;
    const min = portraitEdges(spare);
    let top = Math.max(edge(min.top, lb), toLogical(s.top, lb));
    let bottom = Math.max(edge(min.bottom, lb), toLogical(s.bottom, lb));
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
