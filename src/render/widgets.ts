/**
 * Shared chunky UI primitives (panels, buttons, word wrap) used by renderer.ts and coach.ts. Owner: Starbuck.
 * Pure drawing helpers: no state, no rules.
 */
import type { Rect } from '../ui/view';
import { cardShape, drawIcon, type IconId } from './cardArt';
import { ADVANCE, drawTextShadow, measureText } from './font';
import { PAL } from './theme';

type Ctx = CanvasRenderingContext2D;

export function panel(ctx: Ctx, r: Rect, fill: string = PAL.panel, edge: string = PAL.panelEdge, alpha = 0.85): void {
  ctx.globalAlpha = alpha;
  cardShape(ctx, r.x, r.y, r.w, r.h, PAL.ink);
  cardShape(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, edge);
  cardShape(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, fill);
  ctx.globalAlpha = 1;
}

export interface ButtonStyle {
  readonly fill: string;
  readonly dark: string;
  readonly text?: string;
}

export const BTN = {
  orange: { fill: PAL.orange, dark: PAL.orangeDark },
  blue: { fill: PAL.blue, dark: PAL.blueDark },
  red: { fill: PAL.red, dark: PAL.redDark },
  green: { fill: PAL.green, dark: PAL.greenDark },
  grey: { fill: PAL.greyDark, dark: '#2c2840', text: PAL.grey },
  panel: { fill: PAL.panelHi, dark: PAL.panel },
} as const satisfies Record<string, ButtonStyle>;

export function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.min(255, Math.round(c + (255 - c) * 0.25));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function button(ctx: Ctx, r: Rect, label: string, style: ButtonStyle, hovered: boolean, icon?: IconId): void {
  const lift = hovered ? 1 : 0;
  const x = r.x;
  const y = r.y - lift;
  // Hard shadow, body, darker lip, top highlight.
  cardShape(ctx, x + 1, r.y + 2, r.w, r.h, PAL.shadow);
  cardShape(ctx, x, y, r.w, r.h, PAL.ink);
  cardShape(ctx, x + 1, y + 1, r.w - 2, r.h - 2, style.dark);
  cardShape(ctx, x + 1, y + 1, r.w - 2, r.h - 4, hovered ? lighten(style.fill) : style.fill);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + 3, y + 2, r.w - 6, 1);
  const textColor = style.text ?? PAL.white;
  const iconW = icon ? 7 : 0;
  const scale = r.h >= 22 && measureText(label, 2) + iconW + 8 <= r.w ? 2 : 1;
  const tw = measureText(label, scale) + iconW;
  const tx = Math.round(x + (r.w - tw) / 2);
  const ty = Math.round(y + (r.h - 2 - 5 * scale) / 2);
  if (icon) drawIcon(ctx, icon, tx, Math.round(y + (r.h - 2 - 5) / 2), textColor);
  if (label) drawTextShadow(ctx, label, tx + iconW, ty, textColor, scale);
}

/**
 * Greedy word wrap for the 3x5 font. `widthFor(line)` gives the pixel width available to line `line` (lets a
 * paragraph flow around a button in a corner). Words longer than a line are hard-split.
 */
export function wrapText(text: string, widthFor: (line: number) => number, scale = 1): string[] {
  const out: string[] = [];
  let cur = '';
  const fits = (s: string): boolean => measureText(s, scale) <= widthFor(out.length);
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    let w = word;
    while (measureText(w, scale) > widthFor(out.length)) {
      const n = Math.max(1, Math.floor((widthFor(out.length) + scale) / (ADVANCE * scale)));
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    cur = w;
  }
  if (cur) out.push(cur);
  return out;
}
