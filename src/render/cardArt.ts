/**
 * Procedural pixel-art cards. No asset files: sprites are tiny palette-indexed string grids, rasterised once
 * into offscreen canvases and cached by CardId. Owner: Starbuck.
 *
 * Presentation only: suit -> look. The game meaning of a suit (monster/weapon/potion) is a fixed, documented
 * mapping (RULES.md "Cards" table), used here purely to pick artwork.
 */
import type { Card, CardId, Rank, Suit } from '../game';
import { drawText, drawTextOutline, measureText } from './font';
import { CARD_H, CARD_W, KIND_STYLE, PAL, SUIT_COLOR } from './theme';

type ArtKind = 'monster' | 'weapon' | 'potion';

export function artKind(suit: Suit): ArtKind {
  return suit === 'hearts' ? 'potion' : suit === 'diamonds' ? 'weapon' : 'monster';
}

const SUIT_LETTER: Record<string, Suit> = { S: 'spades', C: 'clubs', D: 'diamonds', H: 'hearts' };

/** Parse a CardId ("S14", "D7"...) per the id format documented in game/cards.ts. Used to draw cards FX
 *  is animating that are no longer in the view (flying to discard/deck). */
export function parseCardId(id: CardId): Card | null {
  const suit = SUIT_LETTER[id.charAt(0)];
  const rank = Number(id.slice(1));
  if (!suit || !Number.isInteger(rank) || rank < 2 || rank > 14) return null;
  return { id, suit, rank: rank as Rank };
}

export function rankLabel(rank: number): string {
  return rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : rank === 14 ? 'A' : String(rank);
}

// ---------------------------------------------------------------------------------------------------------
// Sprites (12x12). '.' = transparent. Other chars index the per-sprite palette.

interface Sprite {
  readonly rows: readonly string[];
  readonly pal: Readonly<Record<string, string>>;
}

const OUT = '#120e1c';

const SLIME: Sprite = {
  rows: [
    '............',
    '............',
    '............',
    '....kkkk....',
    '...kggggk...',
    '..kgwggggk..',
    '..kgkggkgk..',
    '.kggkggkggk.',
    '.kgggggggggk',
    '.kgdgggggdgk',
    '..kkkkkkkkk.',
    '............',
  ],
  pal: { k: OUT, g: '#6fd35a', w: '#e9ffd8', d: '#3c9a3a' },
};

const BAT: Sprite = {
  rows: [
    '............',
    '............',
    'k..........k',
    'kk..k..k..kk',
    'kpk.kkkk.kpk',
    'kppkrkkrkppk',
    'kpppkkkkpppk',
    'kp.pkkkkp.pk',
    'k...kwwk...k',
    '.....kk.....',
    '............',
    '............',
  ],
  pal: { k: OUT, p: '#8a5cd6', r: '#ff4040', w: '#fdf8ec' },
};

const SKULL: Sprite = {
  rows: [
    '............',
    '...kkkkkk...',
    '..kwwwwwwk..',
    '.kwwwwwwwwk.',
    '.kwkkwwkkwk.',
    '.kwkrwwkrwk.',
    '.kwwwkkwwwk.',
    '..kwwwwwwk..',
    '...kwkwkwk..',
    '...kkkkkkk..',
    '............',
    '............',
  ],
  pal: { k: OUT, w: '#ece3cf', r: '#ff4040' },
};

const GOBLIN: Sprite = {
  rows: [
    '............',
    '....kkkk....',
    'kk.kggggk.kk',
    'kgkggggggkgk',
    '.kgykggykgk.',
    '..kggggggk..',
    '..kgkwwkgk..',
    '...kggggk...',
    '..kbbkkbbk..',
    '.kbbbbbbbbk.',
    '.kbbbbbbbbk.',
    '.kkkkkkkkkk.',
  ],
  pal: { k: OUT, g: '#7cc24a', y: '#ffd24a', w: '#fdf8ec', b: '#8a5a32' },
};

const WRAITH: Sprite = {
  rows: [
    '....kkkk....',
    '...kppppk...',
    '..kppppppk..',
    '..kpyppypk..',
    '..kppppppk..',
    '.kppkkkkppk.',
    '.kppppppppk.',
    'kppppppppppk',
    'kppppppppppk',
    'kpkppkppkppk',
    'kk.kk.kk.kk.',
    '............',
  ],
  pal: { k: OUT, p: '#a9c8f0', y: '#3fe0ff' },
};

const DEMON: Sprite = {
  rows: [
    'k..........k',
    'kk........kk',
    '.kk.kkkk.kk.',
    '..kkrrrrkk..',
    '..krrrrrrk..',
    '.krrykkyrrk.',
    '.krrrrrrrrk.',
    '.krkwkkwkrk.',
    '..krrrrrrk..',
    '...kkrrkk...',
    '....kkkk....',
    '............',
  ],
  pal: { k: OUT, r: '#e8383c', y: '#ffd24a', w: '#fdf8ec' },
};

const DRAGON: Sprite = {
  rows: [
    '...k....k...',
    '..kk....kk..',
    '..kokkkkok..',
    '.kooooooook.',
    '.kokyooykok.',
    'kooooooooook',
    'kokkkkkkkkok',
    'kokwkwwkwkok',
    '.kooooooook.',
    '..kooooook..',
    '...kkkkkk...',
    '............',
  ],
  pal: { k: OUT, o: '#2fc6a0', y: '#ffd24a', w: '#fdf8ec' },
};

const SWORD: Sprite = {
  rows: [
    '..........kk',
    '.........kwk',
    '........kwsk',
    '.......kwsk.',
    '......kwsk..',
    '.....kwsk...',
    '.k..kwsk....',
    '.kykwsk.....',
    '..kykk......',
    '.kbkyk......',
    'kbk.kk......',
    'kk..........',
  ],
  pal: { k: OUT, w: '#fdf8ec', s: '#9fb2c8', y: '#ffd24a', b: '#8a5a32' },
};

const POTION: Sprite = {
  rows: [
    '....kkkk....',
    '....kbbk....',
    '....kkkk....',
    '....kwgk....',
    '...kkwgkk...',
    '..kwggggggk.',
    '.kwrrrrrrrrk',
    '.krwrrrrrrrk',
    '.krrrrrrrrrk',
    '.krrrrrrrrrk',
    '..krrrrrrrk.',
    '...kkkkkkk..',
  ],
  pal: { k: OUT, b: '#a8703a', w: '#fdf8ec', g: '#bfe6f0', r: '#f0403e' },
};

function monsterSprite(rank: number): Sprite {
  if (rank <= 4) return SLIME;
  if (rank <= 7) return BAT;
  if (rank <= 10) return SKULL;
  if (rank === 11) return GOBLIN;
  if (rank === 12) return WRAITH;
  if (rank === 13) return DEMON;
  return DRAGON;
}

function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, scale: number): void {
  s.rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const c = s.pal[row.charAt(rx)];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x + rx * scale, y + ry * scale, scale, scale);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------
// Suit pips (5x5) and small icons.

const PIPS: Record<Suit, string> = {
  hearts: '0101011111111110111000100',
  diamonds: '0010001110111110111000100',
  clubs: '0111001110111110010001110',
  spades: '0010001110111111111100100',
};

export function drawPip(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, scale = 1, color?: string): void {
  const bits = PIPS[suit];
  ctx.fillStyle = color ?? SUIT_COLOR[suit];
  for (let i = 0; i < 25; i++) {
    if (bits.charCodeAt(i) === 49) ctx.fillRect(x + (i % 5) * scale, y + Math.floor(i / 5) * scale, scale, scale);
  }
}

export type IconId = 'heart' | 'sword' | 'skull' | 'fist' | 'deck' | 'cross' | 'gear' | 'speaker' | 'speakerOff';

const ICONS: Record<IconId, string> = {
  heart: '0101011111111110111000100',
  sword: '0010000100001000111000100',
  skull: '0111011111101011111101010',
  fist: '0101011111111111111101110',
  deck: '1111010010100101001011110',
  cross: '1000101010001000101010001',
  gear: '0101011111110111111101010',
  speaker: '0010001101111010110100100',
  speakerOff: '0010001100111000110000100',
};

export function drawIcon(ctx: CanvasRenderingContext2D, icon: IconId, x: number, y: number, color: string, scale = 1): void {
  const bits = ICONS[icon];
  ctx.fillStyle = color;
  for (let i = 0; i < 25; i++) {
    if (bits.charCodeAt(i) === 49) ctx.fillRect(x + (i % 5) * scale, y + Math.floor(i / 5) * scale, scale, scale);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Card faces and back.

/** Pixel-rounded card silhouette: a rect with 2px cut corners. */
export function cardShape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillRect(x, y + 2, w, h - 4);
}

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function drawCorner(ctx: CanvasRenderingContext2D, card: Card): void {
  const label = rankLabel(card.rank);
  const color = SUIT_COLOR[card.suit];
  const lw = measureText(label, 2);
  const cx = 4 + Math.max(0, (10 - lw) / 2);
  drawText(ctx, label, Math.round(cx), 4, color, 2);
  drawPip(ctx, card.suit, 6, 16);
}

function renderFace(card: Card): HTMLCanvasElement {
  const [c, ctx] = newCanvas(CARD_W, CARD_H);
  const kind = artKind(card.suit);
  const style = KIND_STYLE[kind];
  // Body: dark outline, paper, bottom shade for chunkiness.
  cardShape(ctx, 0, 0, CARD_W, CARD_H, PAL.ink);
  cardShape(ctx, 1, 1, CARD_W - 2, CARD_H - 2, PAL.paperEdge);
  cardShape(ctx, 1, 1, CARD_W - 2, CARD_H - 3, PAL.paper);
  ctx.fillStyle = PAL.paperShade;
  ctx.fillRect(3, CARD_H - 5, CARD_W - 6, 1);
  // Suit-tinted inner frame.
  ctx.fillStyle = SUIT_COLOR[card.suit];
  ctx.globalAlpha = 0.35;
  ctx.fillRect(3, 3, CARD_W - 6, 1);
  ctx.fillRect(3, CARD_H - 7, CARD_W - 6, 1);
  ctx.globalAlpha = 1;

  // Corner indices (bottom-right is the top-left rotated 180 degrees, exact on the pixel grid).
  drawCorner(ctx, card);
  ctx.save();
  ctx.translate(CARD_W, CARD_H);
  ctx.rotate(Math.PI);
  drawCorner(ctx, card);
  ctx.restore();

  // Centre art panel.
  const px = 11, py = 22, pw = 34, ph = 32;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(px - 1, py - 1, pw + 2, ph + 2);
  ctx.fillStyle = style.panel;
  ctx.fillRect(px, py, pw, ph);
  // Dither the top half of the panel lighter for depth.
  ctx.fillStyle = style.panelHi;
  for (let yy = 0; yy < ph / 2; yy++) {
    for (let xx = (yy % 2); xx < pw; xx += 2) {
      if (yy < ph / 4 || (xx + yy) % 4 === 0) ctx.fillRect(px + xx, py + yy, 1, 1);
    }
  }
  const sprite = kind === 'monster' ? monsterSprite(card.rank) : kind === 'weapon' ? SWORD : POTION;
  // Larger monsters fill more of the frame: rank 2..14 nudges a 1px "power aura" border.
  if (kind === 'monster' && card.rank >= 11) {
    ctx.fillStyle = PAL.red;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(px, py + ph - 3, pw, 3);
    ctx.globalAlpha = 1;
  }
  drawSprite(ctx, sprite, px + 5, py + 4, 2);

  // Value badge, bottom-left: icon + number in the kind colour (monster damage / weapon power / heal).
  const value = String(card.rank);
  const icon: IconId = kind === 'monster' ? 'skull' : kind === 'weapon' ? 'sword' : 'heart';
  const bw = 9 + measureText(value) + 4;
  const bx = 4, by = 62;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(bx - 1, by - 1, bw + 2, 11);
  ctx.fillStyle = style.badgeDark;
  ctx.fillRect(bx, by, bw, 9);
  ctx.fillStyle = style.badge;
  ctx.fillRect(bx, by, bw, 8);
  drawIcon(ctx, icon, bx + 2, by + 2, PAL.white);
  drawText(ctx, value, bx + 9, by + 2, PAL.white);
  return c;
}

function renderBack(): HTMLCanvasElement {
  const [c, ctx] = newCanvas(CARD_W, CARD_H);
  cardShape(ctx, 0, 0, CARD_W, CARD_H, PAL.ink);
  cardShape(ctx, 1, 1, CARD_W - 2, CARD_H - 2, '#7a1d2a');
  cardShape(ctx, 3, 3, CARD_W - 6, CARD_H - 6, '#c8323f');
  // Diamond lattice.
  ctx.fillStyle = '#e25060';
  for (let y = 4; y < CARD_H - 4; y++) {
    for (let x = 4; x < CARD_W - 4; x++) {
      if ((x + y) % 6 === 0 || (x - y + 600) % 6 === 0) ctx.fillRect(x, y, 1, 1);
    }
  }
  // Centre emblem: skull on a dark lozenge.
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(16, 27, 24, 24);
  ctx.fillStyle = '#7a1d2a';
  ctx.fillRect(17, 28, 22, 22);
  drawIcon(ctx, 'skull', 21, 32, PAL.gold, 3);
  ctx.fillStyle = PAL.gold;
  ctx.fillRect(5, 5, CARD_W - 10, 1);
  ctx.fillRect(5, CARD_H - 6, CARD_W - 10, 1);
  return c;
}

const faceCache = new Map<CardId, HTMLCanvasElement>();
let backCanvas: HTMLCanvasElement | null = null;

export function cardFace(card: Card): HTMLCanvasElement {
  let c = faceCache.get(card.id);
  if (!c) {
    c = renderFace(card);
    faceCache.set(card.id, c);
  }
  return c;
}

export function cardBack(): HTMLCanvasElement {
  if (!backCanvas) backCanvas = renderBack();
  return backCanvas;
}

/** Wordmark-friendly helper: outlined label used on cards and popups. */
export function badgeText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1): void {
  drawTextOutline(ctx, text, x, y, color, scale, 'center');
}
