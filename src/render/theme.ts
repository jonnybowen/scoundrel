/**
 * Visual tokens: palette, logical resolutions, card metrics, CRT defaults. Owner: Starbuck.
 * Every colour and size the renderer uses lives here so the look can be retuned in one place.
 */
import type { CrtParams } from './types';

/**
 * Base (16:9) logical resolution; portrait swaps the axes (270x480). The live size adapts to the viewport aspect
 * (short side 270, long side 480..660): see render/screen.ts and LayoutSnapshot.logical.
 */
export const LOGICAL_WIDTH = 480;
export const LOGICAL_HEIGHT = 270;

export function logicalSize(orientation: 'portrait' | 'landscape'): { w: number; h: number } {
  return orientation === 'portrait' ? { w: LOGICAL_HEIGHT, h: LOGICAL_WIDTH } : { w: LOGICAL_WIDTH, h: LOGICAL_HEIGHT };
}

export const CARD_W = 56;
export const CARD_H = 78;

/** Balatro-ish palette: saturated chips/mult red+blue, warm paper, deep purple-teal table. */
export const PAL = {
  ink: '#120e1c',
  night: '#1d1730',
  panel: '#251e38',
  panelHi: '#3a3153',
  panelEdge: '#4d4270',
  felt: '#1e3f45',
  feltHi: '#2b5a5e',
  paper: '#f4e9d2',
  paperShade: '#dccaa6',
  paperEdge: '#b9a37c',
  white: '#fdf8ec',
  grey: '#8d86a0',
  greyDark: '#4b4560',
  red: '#fe5f55',
  redDark: '#a8282e',
  blue: '#1fa2ff',
  blueDark: '#1060b0',
  orange: '#ff9a2e',
  orangeDark: '#b35a12',
  gold: '#ffd24a',
  green: '#5fd068',
  greenDark: '#2e8a45',
  teal: '#3fc5b0',
  purple: '#9a6cf0',
  pink: '#ff7eb6',
  shadow: 'rgba(8,4,16,0.55)',
} as const;

/** Suit colours. Four distinct hues so suits never rely on red/black alone. */
export const SUIT_COLOR = {
  hearts: '#f0403e',
  diamonds: '#ff8a1e',
  clubs: '#2f6fd0',
  spades: '#2a2245',
} as const;

/** Kind accents: centre-panel background and badge colours. */
export const KIND_STYLE = {
  monster: { panel: '#2a1f3d', panelHi: '#40305c', badge: PAL.red, badgeDark: PAL.redDark },
  weapon: { panel: '#5a3417', panelHi: '#8a521f', badge: PAL.blue, badgeDark: PAL.blueDark },
  potion: { panel: '#1f4a4a', panelHi: '#2f6f69', badge: PAL.green, badgeDark: PAL.greenDark },
} as const;

/** Background swirl colours (rgb triples), blended per pixel in the ambient background. */
export const SWIRL_A: readonly [number, number, number] = [36, 22, 58];
export const SWIRL_B: readonly [number, number, number] = [22, 64, 70];
export const SWIRL_C: readonly [number, number, number] = [84, 28, 48];

export const DEFAULT_CRT: CrtParams = {
  enabled: true,
  scanlineIntensity: 0.45,
  curvature: 0.35,
  vignette: 0.55,
  chromaticAberration: 0.6,
  noise: 0.25,
};
