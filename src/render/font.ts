/**
 * Embedded 3x5 bitmap font, drawn as filled pixel rects (no font files, no antialiasing).
 * Each glyph is 5 rows of 3 bits. Advance is 4px per glyph at scale 1.
 */

const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001110',
  ' ': '000000000000000', '-': '000000111000000', '+': '000010111010000', '.': '000000000000010',
  ',': '000000000010100', ':': '000010000010000', '!': '010010010000010', '?': '110001010000010',
  "'": '010010000000000', '/': '001001010100100', '<': '001010100010001', '>': '100010001010100',
  '=': '000111000111000', '%': '101001010100101', '(': '010100100100010', ')': '010001001001010',
  '#': '101111101111101', x: '000101010101000', '*': '000101010101000',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;

export function measureText(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return (text.length * ADVANCE - 1) * scale;
}

export type Align = 'left' | 'center' | 'right';

/** Draw text with its top-left (or top-centre/right) at x,y. Lower-case letters render as upper case. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  align: Align = 'left',
): void {
  const w = measureText(text, scale);
  if (w <= 0) return;
  const left = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const key = `${color}|${scale}|${text}`;
  let img = cache.get(key);
  if (!img) {
    if (cache.size > 600) cache.clear();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = GLYPH_H * scale;
    const cctx = c.getContext('2d');
    if (!cctx) return;
    rasterize(cctx, text, 0, 0, color, scale);
    img = c;
    cache.set(key, img);
  }
  ctx.drawImage(img, left, Math.round(y));
}

const cache = new Map<string, HTMLCanvasElement>();

function rasterize(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale: number): void {
  let cx = x;
  const cy = y;
  ctx.fillStyle = color;
  for (const raw of text) {
    const g = GLYPHS[raw] ?? GLYPHS[raw.toUpperCase()] ?? GLYPHS['?'];
    if (g) {
      for (let i = 0; i < 15; i++) {
        if (g.charCodeAt(i) === 49) {
          ctx.fillRect(cx + (i % 3) * scale, cy + Math.floor(i / 3) * scale, scale, scale);
        }
      }
    }
    cx += ADVANCE * scale;
  }
}

/** Text with a hard 1-scale-pixel drop shadow (the chunky Balatro look, and contrast on busy backgrounds). */
export function drawTextShadow(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  align: Align = 'left',
  shadow = 'rgba(10,6,20,0.85)',
): void {
  drawText(ctx, text, x + scale, y + scale, shadow, scale, align);
  drawText(ctx, text, x, y, color, scale, align);
}

/** Text with a full 1px outline at scale 1 granularity (used on cards and popups). */
export function drawTextOutline(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  align: Align = 'left',
  outline = '#120e1c',
): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] as const) {
    drawText(ctx, text, x + dx, y + dy, outline, scale, align);
  }
  drawText(ctx, text, x, y, color, scale, align);
}
