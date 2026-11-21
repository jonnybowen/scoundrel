/**
 * Viewport-adaptive screen geometry and layout (render/screen.ts, render/layout.ts). Owner: Starbuck.
 * The logical short side stays 270; the long side follows the aspect (480..660) so 19.5:9 phones fill the screen.
 * Layout must keep every rect inside the canvas and the safe box, and the board groups must not overlap.
 */
import { describe, expect, it } from 'vitest';
import { computeLayout, DOCK_PAD, frameFor, frameOf } from '../../src/render/layout';
import {
  BASE_LONG,
  CHROME_EDGE,
  CHROME_EDGE_BOTTOM,
  CHROME_EDGE_BOTTOM_TALL,
  CHROME_EDGE_TOP_TALL,
  MAX_LONG,
  PORTRAIT_DOCK_RESERVE,
  portraitEdges,
  SHORT_SIDE,
  screenGeometry,
} from '../../src/render/screen';
import type { Viewport } from '../../src/render/types';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import { selectView, type LayoutSnapshot, type Rect, type UiLocalState } from '../../src/ui/view';
import { c, cards, makeState, room } from './helpers';

const vp = (w: number, h: number, dpr: number, safeArea?: Viewport['safeArea']): Viewport => ({
  cssWidth: w,
  cssHeight: h,
  devicePixelRatio: dpr,
  orientation: h > w ? 'portrait' : 'landscape',
  ...(safeArea ? { safeArea } : {}),
});

/** Fraction of the viewport (device px) the display canvas covers. */
const fill = (v: Viewport): number => {
  const g = screenGeometry(v);
  return (g.devW * g.devH) / (v.cssWidth * v.devicePixelRatio * v.cssHeight * v.devicePixelRatio);
};

const S22_PORTRAIT = vp(412, 892, 2.625);
const S22_LANDSCAPE = vp(892, 412, 2.625);

describe('screenGeometry', () => {
  it('19.5:9 (Galaxy S22+): 270x585 at an exact 4x, filling > 99% of the screen in both orientations', () => {
    const p = screenGeometry(S22_PORTRAIT);
    expect([p.w, p.h, p.scale]).toEqual([270, 585, 4]);
    const l = screenGeometry(S22_LANDSCAPE);
    expect([l.w, l.h, l.scale]).toEqual([585, 270, 4]);
    expect(fill(S22_PORTRAIT)).toBeGreaterThan(0.99);
    expect(fill(S22_LANDSCAPE)).toBeGreaterThan(0.99);
    // The old fixed 270x480 frame filled only ~82% of this screen.
  });

  it('16:9 screens keep the 480x270 design size', () => {
    for (const v of [vp(1280, 720, 1), vp(1920, 1080, 1), vp(960, 540, 1), vp(1366, 768, 1)]) {
      const g = screenGeometry(v);
      expect([g.w, g.h]).toEqual([BASE_LONG, SHORT_SIDE]);
      expect(fill(v)).toBeGreaterThan(0.99);
    }
  });

  it('caps at 22:9 and letterboxes beyond; squarer than 16:9 letterboxes the short axis', () => {
    expect(screenGeometry(vp(2000, 600, 1)).w).toBe(MAX_LONG);
    const tablet = screenGeometry(vp(1024, 768, 2));
    expect([tablet.w, tablet.h]).toEqual([480, 270]);
  });

  it('at dpr >= 2 goes fractional rather than waste more than 5% of the short axis (dpr-3 phone)', () => {
    const v = vp(393, 852, 3);
    const g = screenGeometry(v);
    expect(Number.isInteger(g.scale)).toBe(false);
    expect(fill(v)).toBeGreaterThan(0.98);
  });

  it('at dpr < 2 keeps the 20% rule: common 16:9 desktops stay on an exact integer scale at 480x270', () => {
    // fit 3.333 -> 3x (the 5% rule would give an uneven 3.333x at dpr 1); 5.333 -> 5x; 2.29 -> 2x.
    for (const [v, scale] of [[vp(1600, 900, 1), 3], [vp(2560, 1440, 1), 5], [vp(1100, 620, 1), 2]] as const) {
      const g = screenGeometry(v);
      expect([g.w, g.h, g.scale], `${v.cssWidth}x${v.cssHeight}@1`).toEqual([480, 270, scale]);
      expect([g.devW, g.devH]).toEqual([480 * scale, 270 * scale]);
    }
    // 1366x768 is 2.84x: 2x would waste 30%, so it still goes fractional and fills the window.
    expect(Number.isInteger(screenGeometry(vp(1366, 768, 1)).scale)).toBe(false);
  });

  it('S22+ (both orientations) and Pixel 7 sit on exactly 4x', () => {
    for (const v of [S22_PORTRAIT, S22_LANDSCAPE, vp(412, 915, 2.625), vp(915, 412, 2.625)]) {
      expect(screenGeometry(v).scale, `${v.cssWidth}x${v.cssHeight}`).toBe(4);
    }
    expect(screenGeometry(vp(412, 915, 2.625)).h).toBe(600);
  });

  it('keeps a minimum HUD margin on the long axis even with no reported insets (punch-hole, rounded corners)', () => {
    // Portrait: 36 under the top edge (clear of the punch-hole), 40 above the bottom edge (clear of the 3-button nav
    // bar's ~34 logical px strip, which can be swiped in over immersive mode while the bottom inset reads 0).
    expect(screenGeometry(S22_PORTRAIT).safe).toEqual({ x: 0, y: 36, w: 270, h: 585 - 36 - 40 });
    expect([CHROME_EDGE_TOP_TALL, CHROME_EDGE_BOTTOM_TALL]).toEqual([36, 40]);
    // Landscape: the camera can be on either short side, so both sides keep 24.
    expect(screenGeometry(S22_LANDSCAPE).safe).toEqual({ x: CHROME_EDGE, y: 0, w: 585 - 2 * CHROME_EDGE, h: 270 });
    // 16:9 has no spare length: the original frames, unchanged.
    expect(screenGeometry(vp(1280, 720, 1)).safe).toEqual({ x: 0, y: 0, w: 480, h: 270 });
    expect(screenGeometry(vp(360, 640, 3)).safe).toEqual({ x: 0, y: 0, w: 270, h: 480 });
  });

  it('S22+ HUD: ROOM, SCORE and the corner buttons sit at least CHROME_EDGE_TOP_TALL (portrait) / CHROME_EDGE (landscape) from the physical long-axis edges', () => {
    for (const v of [S22_PORTRAIT, S22_LANDSCAPE]) {
      const g = screenGeometry(v);
      const l = computeLayout(selectView(armed, ui()), v);
      const f = frameOf(l);
      for (const id of ['mute', 'settings'] as const) {
        const b = l.buttons.get(id)!;
        if (v.orientation === 'portrait') expect(b.y).toBeGreaterThanOrEqual(CHROME_EDGE_TOP_TALL);
        else {
          expect(b.x).toBeGreaterThanOrEqual(CHROME_EDGE);
          expect(g.w - (b.x + b.w)).toBeGreaterThanOrEqual(CHROME_EDGE);
        }
      }
      if (v.orientation === 'portrait') expect(f.topY).toBeGreaterThanOrEqual(CHROME_EDGE_TOP_TALL);
      else expect(f.scoreX).toBeGreaterThanOrEqual(CHROME_EDGE);
    }
  });

  it('a long-axis letterbox counts towards the minimum margin (32:9 is capped at 660 and centred)', () => {
    const g = screenGeometry(vp(3840, 1080, 1));
    expect(g.w).toBe(MAX_LONG);
    expect(g.safe.x).toBe(0);
  });

  it('maps safe-area insets onto the long axis of the canvas, taking the larger of inset and minimum', () => {
    const p = screenGeometry(vp(412, 892, 2.625, { top: 60, right: 0, bottom: 64, left: 0 }));
    // 60 css * 2.625 / 4 = 39.4 -> 40 logical (> 36); 64 css -> 42 (> 40).
    expect(p.safe).toEqual({ x: 0, y: 40, w: 270, h: 585 - 40 - 42 });
    const small = screenGeometry(vp(412, 892, 2.625, { top: 30, right: 0, bottom: 16, left: 0 }));
    // 30 css -> 20 logical and 16 css -> 11, under the minimums: 36 and 40 win.
    expect(small.safe).toEqual({ x: 0, y: CHROME_EDGE_TOP_TALL, w: 270, h: 585 - CHROME_EDGE_TOP_TALL - CHROME_EDGE_BOTTOM_TALL });
    const l = screenGeometry(vp(892, 412, 2.625, { top: 0, right: 0, bottom: 0, left: 40 }));
    // Symmetric so the centre line stays at w/2.
    expect(l.safe).toEqual({ x: 27, y: 0, w: 585 - 54, h: 270 });
  });

  it('portrait margins: floor first, then the dock reserve, then the tall margins (16:9 stays 0)', () => {
    expect(portraitEdges(0)).toEqual({ top: 0, bottom: 0 });
    expect(portraitEdges(CHROME_EDGE + CHROME_EDGE_BOTTOM)).toEqual({ top: CHROME_EDGE, bottom: CHROME_EDGE_BOTTOM });
    // Pixel 7 in a browser (550 tall): a little over the floor, and the content keeps the reserve.
    expect(portraitEdges(70)).toEqual({ top: 26, bottom: 16 });
    for (const spare of [104, 105, 120, 180]) expect(portraitEdges(spare)).toEqual({ top: 36, bottom: 40 });
    let prev = portraitEdges(0);
    for (let spare = 1; spare <= 180; spare++) {
      const e = portraitEdges(spare);
      // Never shrinks as the screen grows, and never jumps (at most 2 px per px: top and bottom each floor separately).
      expect(e.top, `spare ${spare}`).toBeGreaterThanOrEqual(prev.top);
      expect(e.bottom, `spare ${spare}`).toBeGreaterThanOrEqual(prev.bottom);
      expect(e.top + e.bottom - prev.top - prev.bottom, `spare ${spare}`).toBeLessThanOrEqual(2);
      // Once the floor margins are met, the content keeps the dock reserve before the margins grow past the floor.
      if (spare >= CHROME_EDGE + CHROME_EDGE_BOTTOM) {
        expect(spare - e.top - e.bottom, `spare ${spare}`).toBeGreaterThanOrEqual(Math.min(PORTRAIT_DOCK_RESERVE, spare - CHROME_EDGE - CHROME_EDGE_BOTTOM));
      }
      prev = e;
    }
    // The reserve is exactly what the play frame needs to anchor its dock (reclaim = min(2E, 66 - DOCK_PAD)).
    expect(2 * PORTRAIT_DOCK_RESERVE).toBe(66 - DOCK_PAD);
  });

  it('never shrinks the safe box below the 16:9 design size', () => {
    const g = screenGeometry(vp(412, 760, 2.625, { top: 60, right: 0, bottom: 60, left: 0 }));
    expect(g.safe.h).toBeGreaterThanOrEqual(BASE_LONG);
    expect(g.safe.y + g.safe.h).toBeLessThanOrEqual(g.h);
  });
});

// ---------------------------------------------------------------------------------------------------------

const ui = (over: Partial<UiLocalState> = {}): UiLocalState => ({
  pendingFight: null,
  menuOpen: false,
  screen: 'game',
  hover: null,
  toast: null,
  showResult: false,
  settings: DEFAULT_SETTINGS,
  error: null,
  ...over,
});

const armed = makeState({
  room: room('S10', 'C4', 'D7', 'H5'),
  weapon: { card: c('D9'), slain: cards('S8', 'C7', 'S6', 'C5', 'S3', 'C2') },
});

const inside = (r: Rect, box: Rect): boolean => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const VIEWPORTS: [string, Viewport][] = [
  ['desktop 16:9', vp(1280, 720, 1)],
  ['Pixel 7 portrait', vp(412, 839, 2.625)],
  ['S22+ portrait', S22_PORTRAIT],
  ['S22+ landscape', S22_LANDSCAPE],
  ['S22+ portrait, cutout + gesture insets', vp(412, 892, 2.625, { top: 32, right: 0, bottom: 24, left: 0 })],
  ['S22+ landscape, cutout inset', vp(892, 412, 2.625, { top: 0, right: 0, bottom: 0, left: 32 })],
  ['22:9 portrait', vp(360, 880, 3)],
  ['22:9 landscape', vp(1320, 540, 1)],
];

function layouts(v: Viewport): [string, LayoutSnapshot][] {
  const choosing = selectView(armed, ui());
  const pending = selectView(armed, ui({ pendingFight: 'S10' }));
  return [
    ['title', computeLayout(selectView(null, ui({ screen: 'title' })), v)],
    ['choosing', computeLayout(choosing, v)],
    ['fight choice', computeLayout(pending, v)],
    ['menu', computeLayout(selectView(armed, ui({ menuOpen: true })), v)],
    ['result', computeLayout(selectView(armed, ui({ showResult: true })), v)],
  ];
}

describe.each(VIEWPORTS)('computeLayout at %s', (_name, v) => {
  const g = screenGeometry(v);

  it('carries the logical size and safe box it was built for', () => {
    const l = computeLayout(selectView(armed, ui()), v);
    expect(l.logical).toEqual({ w: g.w, h: g.h });
    expect(l.safe).toEqual(g.safe);
  });

  it('keeps every card, pile and button inside the safe box', () => {
    for (const [what, l] of layouts(v)) {
      const rects: [string, Rect][] = [
        ['deck', l.deck], ['discard', l.discard], ['weapon', l.weapon], ['hpMeter', l.hpMeter],
        ...[...l.cards].map(([id, r]): [string, Rect] => [`card ${id}`, r]),
        ...[...l.buttons].map(([id, r]): [string, Rect] => [`button ${id}`, r]),
      ];
      for (const [id, r] of rects) expect(inside(r, g.safe), `${what}: ${id} ${JSON.stringify(r)} in ${JSON.stringify(g.safe)}`).toBe(true);
    }
  });

  it('room cards, piles, HP, weapon tray and fight buttons never overlap each other', () => {
    const l = computeLayout(selectView(armed, ui({ pendingFight: 'S10' })), v);
    const roomCards = ['S10', 'C4', 'D7', 'H5'].map((id) => l.cards.get(id)!);
    const solid: [string, Rect][] = [
      ...roomCards.map((r, i): [string, Rect] => [`room${i}`, r]),
      ['deck', l.deck], ['discard', l.discard], ['hp', l.hpMeter], ['weapon', l.weapon],
      ...[...l.buttons].map(([id, r]): [string, Rect] => [id, r]),
    ];
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const [a, ra] = solid[i]!;
        const [b, rb] = solid[j]!;
        expect(overlaps(ra, rb), `${a} overlaps ${b}`).toBe(false);
      }
    }
  });
});

describe('layout uses the extra length', () => {
  it('portrait 19.5:9 spreads the bands down the taller screen', () => {
    const base = computeLayout(selectView(armed, ui({ pendingFight: 'S10' })), vp(270, 480, 1));
    const tall = computeLayout(selectView(armed, ui({ pendingFight: 'S10' })), S22_PORTRAIT);
    expect(tall.cards.get('S10')!.y).toBeGreaterThan(base.cards.get('S10')!.y + 20);
    expect(tall.weapon.y).toBeGreaterThan(base.weapon.y + 40);
    expect(tall.buttons.get('cancel')!.y).toBeGreaterThan(base.buttons.get('cancel')!.y + 50);
  });

  it('landscape 19.5:9 widens the room gaps and moves the side columns out', () => {
    const base = computeLayout(selectView(armed, ui()), vp(480, 270, 1));
    const wide = computeLayout(selectView(armed, ui()), S22_LANDSCAPE);
    const gap = (l: LayoutSnapshot): number => l.cards.get('C4')!.x - l.cards.get('S10')!.x;
    expect(gap(wide)).toBeGreaterThan(gap(base));
    // 105 extra width less the 2 x CHROME_EDGE side margins leaves 57 to spread.
    expect(wide.discard.x - wide.deck.x).toBeGreaterThan(base.discard.x - base.deck.x + 40);
  });
});

describe('tall portrait: no dead band under the action dock', () => {
  const bottomOf = (r: Rect): number => r.y + r.h;
  const lowest = (l: LayoutSnapshot): number => Math.max(...[...l.buttons.values()].map(bottomOf));
  const TALL: [string, Viewport][] = [
    ['S22+ portrait', S22_PORTRAIT],
    ['S22+ portrait, cutout + gesture insets', vp(412, 892, 2.625, { top: 32, right: 0, bottom: 24, left: 0 })],
    ['Pixel 7 portrait', vp(412, 839, 2.625)],
    ['Pixel 7 portrait (full height)', vp(412, 915, 2.625)],
    ['22:9 portrait', vp(360, 880, 3)],
  ];

  it.each(TALL)('%s: AVOID (choosing) and CANCEL (fight) sit DOCK_PAD above the safe bottom', (_n, v) => {
    const g = screenGeometry(v);
    const safeBottom = g.safe.y + g.safe.h;
    const choosing = computeLayout(selectView(armed, ui()), v);
    const fight = computeLayout(selectView(armed, ui({ pendingFight: 'S10' })), v);
    expect(choosing.buttons.has('avoid')).toBe(true);
    for (const l of [choosing, fight]) {
      expect(safeBottom - lowest(l), 'gap under the lowest button').toBe(DOCK_PAD);
    }
    // The S22+ dead band (~125 logical px under AVOID before the portrait-fill change) cannot come back: the whole
    // gap to the glass is the bottom margin plus DOCK_PAD.
    expect(safeBottom - bottomOf(choosing.buttons.get('avoid')!)).toBeLessThanOrEqual(12);
    expect(g.h - bottomOf(choosing.buttons.get('avoid')!)).toBeLessThanOrEqual(CHROME_EDGE_BOTTOM_TALL + DOCK_PAD + 2);
  });

  it('S22+ portrait: the board spreads over the whole height (before/after extents)', () => {
    const l = computeLayout(selectView(armed, ui()), S22_PORTRAIT);
    const f = frameOf(l);
    // Deck row, room, tray and dock spread over the height (pre-fill: deck 61, room 177, weapon 297, AVOID 420-448;
    // portrait-fill with the 24/8 margins: deck 71, room 208, weapon 336, AVOID 535-567).
    expect(l.deck.y).toBe(77);
    expect(f.roomY).toBe(200);
    expect(l.weapon.y).toBe(320);
    expect(l.buttons.get('avoid')).toEqual({ x: 35, y: 504, w: 200, h: 31 });
    // The hint line sits in the dock, right above AVOID.
    expect(f.hint.y).toBe(490);
  });

  // S22+ with 3-button navigation: the bar is hidden in immersive mode (bottom inset 0) but a swipe brings it back
  // over the bottom 135 device px (~34 logical). Every button, the coach strip and the title footer stay above it.
  const NAV_STRIP = 34;
  it('S22+ portrait: buttons, coach strip and footer clear the 3-button nav strip; the HUD clears the punch-hole', () => {
    const g = screenGeometry(S22_PORTRAIT);
    const choosing = computeLayout(selectView(armed, ui()), S22_PORTRAIT);
    const fight = computeLayout(selectView(armed, ui({ pendingFight: 'S10' })), S22_PORTRAIT);
    for (const l of [choosing, fight]) expect(g.h - NAV_STRIP - lowest(l), 'button clear of the nav strip').toBeGreaterThanOrEqual(12);
    const coach = frameFor('portrait', { w: g.w, h: g.h }, g.safe, 'coach');
    expect(g.h - NAV_STRIP - bottomOf(coach.coach), 'coach strip clear of the nav strip').toBeGreaterThanOrEqual(8);
    const title = frameFor('portrait', { w: g.w, h: g.h }, g.safe, 'play');
    expect(g.h - NAV_STRIP - (title.footerY + 5), 'title footer clear of the nav strip').toBeGreaterThanOrEqual(8);
    // The punch-hole ends ~18.5 logical px (74 device px) down; the corner buttons start at 39.
    expect(choosing.buttons.get('settings')!.y - 18.5).toBeGreaterThanOrEqual(16);
  });

  it('16:9 portrait frames are unchanged in both modes (play and tutorial coach)', () => {
    for (const mode of ['play', 'coach'] as const) {
      const f = frameFor('portrait', { w: 270, h: 480 }, { x: 0, y: 0, w: 270, h: 480 }, mode);
      expect(f.actions).toEqual({
        avoid: { x: 35, y: 338, w: 200, h: 28 },
        fightWeapon: { x: 35, y: 330, w: 200, h: 26 },
        fightBarehanded: { x: 35, y: 362, w: 200, h: 26 },
        cancel: { x: 35, y: 394, w: 200, h: 20 },
      });
      expect([f.deck.y, f.roomY, f.weapon.y, f.hint.y, f.toastY]).toEqual([28, 124, 228, 210, 428]);
      expect(f.coach).toEqual({ x: 6, y: 416, w: 258, h: 60 });
      expect([f.play.y, f.tutorial.y, f.logoY, f.showcaseY, f.footerY]).toEqual([318, 356, 64, 150, 468]);
    }
  });

  // Every portrait height from 16:9 to 22:9 (no insets beyond the minimum edges).
  const heights = Array.from({ length: 181 }, (_, i) => 480 + i);
  const safeFor = (h: number): Rect => {
    const { top, bottom } = portraitEdges(h - 480);
    return { x: 0, y: top, w: 270, h: h - top - bottom };
  };

  it('safeFor matches screenGeometry at S22+, Pixel 7 and 22:9', () => {
    for (const v of [S22_PORTRAIT, vp(412, 915, 2.625), vp(360, 880, 3)]) {
      const g = screenGeometry(v);
      expect(safeFor(g.h)).toEqual(g.safe);
    }
  });

  it('play frames, 480..660 tall: dock, hint and toast stay inside the box and clear of each other', () => {
    for (const h of heights) {
      const box = safeFor(h);
      const f = frameFor('portrait', { w: 270, h }, box, 'play');
      const a = f.actions;
      const tag = `h=${h}`;
      for (const r of [a.avoid, a.fightWeapon, a.fightBarehanded, a.cancel]) expect(inside(r, box), tag).toBe(true);
      expect(bottomOf(a.fightWeapon), tag).toBeLessThanOrEqual(a.fightBarehanded.y);
      expect(bottomOf(a.fightBarehanded), tag).toBeLessThanOrEqual(a.cancel.y);
      expect(bottomOf(a.avoid), tag).toBeLessThanOrEqual(bottomOf(a.cancel));
      // Tray captions end above the FIGHT WITH caption (9 above the first fight button).
      expect(f.weapon.y + 98, tag).toBeLessThanOrEqual(a.fightWeapon.y - 9 + 5);
      // Hint (5px tall text) never overlaps AVOID and never reaches up into the tray.
      expect(f.hint.y + 5, tag).toBeLessThanOrEqual(a.avoid.y);
      expect(f.hint.y, tag).toBeGreaterThanOrEqual(f.roomY + CARD_H_ROOM);
      // Toast (13 tall) stays on the canvas and off every action button.
      const toast = { x: 60, y: f.toastY, w: 150, h: 13 };
      expect(f.toastY + 13, tag).toBeLessThanOrEqual(h);
      for (const r of [a.avoid, a.fightWeapon, a.fightBarehanded, a.cancel]) expect(overlaps(toast, r), tag).toBe(false);
      // Title buttons and footer stay ordered inside the box.
      expect(bottomOf(f.tutorial) + 11, tag).toBeLessThanOrEqual(f.footerY);
      if (box.h - 480 >= 28) expect(box.y + box.h - bottomOf(a.cancel), tag).toBe(DOCK_PAD);
    }
  });

  it('coach frames, 480..660 tall: the buttons stay above a coach strip that ends 4px above the safe bottom (as at 16:9)', () => {
    for (const h of heights) {
      const box = safeFor(h);
      const f = frameFor('portrait', { w: 270, h }, box, 'coach');
      const tag = `h=${h}`;
      expect(bottomOf(f.coach), tag).toBe(box.y + box.h - 4);
      expect(f.coach.h, tag).toBeGreaterThanOrEqual(60);
      expect(f.coach.h, tag).toBeLessThanOrEqual(72);
      expect(bottomOf(f.actions.cancel), tag).toBeLessThanOrEqual(f.coach.y);
      expect(f.weapon.y + 98, tag).toBeLessThanOrEqual(f.actions.fightWeapon.y - 9 + 5);
    }
  });
});

const CARD_H_ROOM = 78;
