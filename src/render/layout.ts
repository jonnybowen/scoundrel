/**
 * Layout: home rects for every card, pile and button, per orientation. Pure. Owner: Starbuck.
 * Landscape = W x 270 logical (desktop, phones held sideways). Portrait = 270 x H logical (phones upright).
 * W/H run from 480 (16:9) to 660 (22:9) by viewport aspect (render/screen.ts); the frames stretch to use it.
 * FX tweens cards toward these homes; render draws them; hitTest tests against them.
 *
 * Design Review 2 (tutorial): the title TUTORIAL button, the first-launch offer, the coach strip, the recap
 * panel and the spotlight regions also live here, so render (coach.ts) and hitTest share one set of rects.
 */
import type { CardId } from '../game';
import type { RegionId } from '../tutorial';
import type { ButtonId, GameView, LayoutSnapshot, Rect } from '../ui/view';
import type { Viewport } from './types';
import { CARD_H, CARD_W } from './theme';
import { baseSize, screenGeometry } from './screen';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export interface Frame {
  readonly deck: Rect;
  readonly discard: Rect;
  readonly hpMeter: Rect;
  readonly weapon: Rect;
  readonly roomX: readonly number[];
  readonly roomY: number;
  /** Rightmost x the slain fan may reach. */
  readonly fanRight: number;
  readonly mute: Rect;
  readonly settings: Rect;
  readonly actions: { readonly avoid: Rect; readonly fightWeapon: Rect; readonly fightBarehanded: Rect; readonly cancel: Rect };
  readonly play: Rect;
  readonly resultNewGame: Rect;
  /** Result panel (drawn behind resultNewGame). */
  readonly result: Rect;
  readonly menu: Rect;
  /** Title-screen TUTORIAL button (under PLAY). */
  readonly tutorial: Rect;
  /** First-launch offer modal. */
  readonly offer: Rect;
  /** Coach strip (replaces the hint line while the tutorial runs). */
  readonly coach: Rect;
  /** Recap panel (replaces the result panel at the end of the tutorial). */
  readonly recap: Rect;
  /** Top bar: text row top and the score's left edge. */
  readonly topY: number;
  readonly scoreX: number;
  /** Hint line centre, toast top, title-screen footer row. */
  readonly hint: { readonly x: number; readonly y: number };
  readonly toastY: number;
  readonly footerY: number;
  /** Title screen: logo top and showcase-fan top. */
  readonly logoY: number;
  readonly showcaseY: number;
}

/**
 * Landscape (W x 270). The design is the 480-wide frame; extra width E (up to 180 at 22:9, less the safe insets)
 * widens the gaps between room cards (up to +10 each, which also lengthens the weapon tray and slain fan) and
 * pushes the deck/HP column and the discard/action column away from the centre group, a third of it as margin.
 */
function landscapeFrame(lh: number, c: Rect): Frame {
  const x0 = c.x;
  const x1 = c.x + c.w;
  const E = Math.max(0, c.w - 480);
  const C = Math.round(c.x + c.w / 2);
  const gg = Math.min(10, Math.floor(E / 12));
  const gap = 10 + gg;
  const total = 4 * CARD_W + 3 * gap;
  const rx0 = Math.round(C - total / 2);
  const roomX = [0, 1, 2, 3].map((i) => rx0 + i * (CARD_W + gap));
  const m = Math.floor(Math.max(0, (E - 3 * gg) / 2) / 3);
  const L = x0 + m;
  const R = x1 - m;
  const ax = R - 110;
  return {
    deck: r(L + 24, 30, CARD_W, CARD_H),
    discard: r(R - 80, 30, CARD_W, CARD_H),
    hpMeter: r(L + 16, 134, 88, 72),
    weapon: r(rx0 + 11, 134, CARD_W, CARD_H),
    roomX,
    roomY: 30,
    fanRight: (roomX[3] ?? 0) + CARD_W - 11,
    mute: r(x1 - 36, 3, 14, 13),
    settings: r(x1 - 19, 3, 14, 13),
    actions: {
      avoid: r(ax, 150, 94, 24),
      fightWeapon: r(ax, 136, 94, 22),
      fightBarehanded: r(ax, 162, 94, 22),
      cancel: r(ax, 188, 94, 16),
    },
    play: r(C - 54, 184, 108, 24),
    resultNewGame: r(C - 54, 186, 108, 24),
    result: r(C - 110, 52, 220, 170),
    menu: r(C - 110, 36, 220, 200),
    tutorial: r(C - 44, 213, 88, 18),
    offer: r(C - 140, 62, 280, 116),
    // Below the weapon-tray captions (y 227-232) so the MAX limit badge stays visible during the dulling lessons.
    coach: r(x0 + 8, 234, c.w - 16, 33),
    recap: r(C - 200, 37, 400, 196),
    topY: 0,
    scoreX: x0 + 8,
    hint: { x: C, y: 232 },
    toastY: 246,
    footerY: lh - 12,
    logoY: 26,
    showcaseY: 82,
  };
}

/** Gap kept between the action dock and the bottom of the safe box in tall portrait play (thumb reach, clear of the gesture handle). */
export const DOCK_PAD = 10;

/**
 * Portrait (270 x H). The design is the 480-tall frame; the cards cannot grow (four 56px cards fill the 270 width,
 * and sprites only scale by whole numbers), so the extra height E (up to 180 at 22:9, less the safe insets) is spent
 * on the bands and on the action buttons. Two variants share the board geometry rules:
 *
 * - play (no tutorial): the 60px band under the buttons, which only the coach strip ever used, is reclaimed (at twice
 *   the rate E grows, so 16:9 is unchanged and anything from ~18.5:9 up is fully anchored). The action dock then sits
 *   DOCK_PAD above the safe bottom: CANCEL (fight) and AVOID (choosing) share the bottom edge, in thumb reach. The
 *   fight and avoid buttons grow up to 4px taller. The hint line moves into the dock, right above AVOID (it is hidden
 *   during a fight choice in portrait, when the fight buttons fill that space). What is left opens the bands
 *   (16% above the deck row, 34% above the room, 20% room to tray, 30% tray to dock).
 * - coach (tutorial): as before, the buttons sit above the coach strip at the bottom. The strip grows by at most 12px;
 *   the rest of E opens the same four bands (15/35/27.5/22.5%), so the strip never turns into a mostly empty box.
 *
 * Overlays centre in the content box; the title screen spreads out and anchors PLAY / TUTORIAL low.
 */
function portraitFrame(lw: number, c: Rect, coach: boolean): Frame {
  const y0 = c.y;
  const E = Math.max(0, c.h - 480);
  // Play reclaims the empty coach band (60 + the 6px gap under CANCEL, less the dock pad).
  const reclaim = coach ? 0 : Math.min(2 * E, 66 - DOCK_PAD);
  const coachGrow = coach ? Math.min(12, Math.round(E * 0.2)) : 0;
  const bh = coach ? 0 : Math.min(4, Math.floor((E + reclaim) / 25));
  const spread = E + reclaim - coachGrow - 2 * bh;
  const share = coach ? [0.15, 0.35, 0.275] : [0.16, 0.34, 0.2];
  const g1 = Math.round(spread * share[0]!);
  const g2 = Math.round(spread * share[1]!);
  const g3 = Math.round(spread * share[2]!);
  const g4 = spread - g1 - g2 - g3;
  const o2 = g1 + g2;
  const o3 = o2 + g3;
  const o4 = o3 + g4;
  const mid = y0 + Math.round(E / 2);
  const title = (k: number): number => y0 + Math.round(E * k);
  // Fight cluster (top to bottom): FIGHT WITH weapon, barehanded, CANCEL. AVOID shares CANCEL's bottom edge once the
  // dock has room (at 16:9 it keeps its old place, 48px higher).
  const fwY = y0 + 330 + o4;
  const fbY = fwY + 32 + bh;
  const cancelY = fbY + 32 + bh;
  const dockBottom = cancelY + 20;
  const avoidH = 28 + bh;
  const avoidY = dockBottom - Math.max(0, 48 - 2 * E) - avoidH;
  // Hint line: inside the dock right above AVOID when there is room, else between the room and the weapon tray.
  const docked = !coach && avoidY - fwY >= 24;
  const hintY = docked ? avoidY - 14 : y0 + 210 + o2 + Math.round(g3 / 2);
  // Toast: between the tray captions and the FIGHT WITH caption when that band is tall enough, else under CANCEL.
  const capBottom = y0 + 228 + o3 + 98;
  const band = fwY - 10 - capBottom;
  const toastY = !coach && band >= 13 ? capBottom + Math.floor((band - 13) / 2) : Math.min(dockBottom + 14, y0 + c.h - 13);
  // Title: PLAY / TUTORIAL anchor low (the same reclaim idea, up to 40px), logo and showcase spread above them.
  const titleLow = E + Math.min(2 * E, 40);
  return {
    deck: r(14, y0 + 28 + g1, CARD_W, CARD_H),
    discard: r(200, y0 + 28 + g1, CARD_W, CARD_H),
    hpMeter: r(78, y0 + 34 + g1, 114, 66),
    weapon: r(16, y0 + 228 + o3, CARD_W, CARD_H),
    roomX: [11, 75, 139, 203],
    roomY: y0 + 124 + o2,
    fanRight: 256,
    mute: r(234, y0 + 3, 14, 13),
    settings: r(252, y0 + 3, 14, 13),
    actions: {
      avoid: r(35, avoidY, 200, avoidH),
      fightWeapon: r(35, fwY, 200, 26 + bh),
      fightBarehanded: r(35, fbY, 200, 26 + bh),
      cancel: r(35, cancelY, 200, 20),
    },
    play: r(75, y0 + titleLow + 318, 120, 30),
    resultNewGame: r(75, mid + 300, 120, 28),
    result: r(25, mid + 150, 220, 190),
    menu: r(20, mid + 96, 230, 260),
    tutorial: r(85, y0 + titleLow + 356, 100, 24),
    offer: r(12, mid + 146, 246, 170),
    // Coach mode: below the fight/avoid/cancel buttons (which end at y 414 + o4), down to 4px above the safe bottom.
    // Only the coach frame's strip is ever used (a snapshot carries `coach` only in the tutorial).
    coach: r(6, y0 + 416 + o4, 258, 60 + coachGrow),
    recap: r(8, mid + 94, 254, 292),
    topY: y0,
    scoreX: 8,
    hint: { x: Math.round(lw / 2), y: hintY },
    toastY,
    footerY: c.y + c.h - 12,
    logoY: title(0.35) + 64,
    showcaseY: title(0.75) + 150,
  };
}

let frameCache: { key: string; frame: Frame } | null = null;

/**
 * Frame variant: 'coach' while the tutorial runs (its coach strip owns the bottom of a portrait screen), 'play'
 * otherwise. Landscape frames are identical in both modes, and so are 16:9 portrait frames.
 */
export type FrameMode = 'play' | 'coach';

/**
 * Frame for an orientation and (optionally) a logical size and safe box. Without them it is the 16:9 design frame.
 * Memoised on the last key (render, coach and hitTest all ask for the same frame every frame).
 */
export function frameFor(
  orientation: 'portrait' | 'landscape',
  logical?: { readonly w: number; readonly h: number },
  safe?: Rect,
  mode: FrameMode = 'play',
): Frame {
  const size = logical ?? baseSize(orientation);
  const box = safe ?? r(0, 0, size.w, size.h);
  const coach = orientation === 'portrait' && mode === 'coach';
  const key = `${orientation}|${size.w}x${size.h}|${box.x},${box.y},${box.w},${box.h}|${coach ? 'coach' : 'play'}`;
  if (frameCache?.key === key) return frameCache.frame;
  const frame = orientation === 'portrait' ? portraitFrame(size.w, box, coach) : landscapeFrame(size.h, box);
  frameCache = { key, frame };
  return frame;
}

/** The frame a LayoutSnapshot was built from (a snapshot carries `coach` exactly when the tutorial runs). */
export function frameOf(layout: LayoutSnapshot): Frame {
  return frameFor(layout.orientation, layout.logical, layout.safe, layout.coach ? 'coach' : 'play');
}

/** Logical canvas size of a LayoutSnapshot (the 16:9 base size when it carries none). */
export function logicalOf(layout: LayoutSnapshot): { w: number; h: number } {
  return layout.logical ? { w: layout.logical.w, h: layout.logical.h } : baseSize(layout.orientation);
}

/** Settings-menu rows, shared by layout (buttons) and render (labels). */
export function menuRows(menu: Rect): { readonly title: number; readonly rows: readonly Rect[] } {
  const x = menu.x + 16;
  const w = menu.w - 32;
  const top = menu.y + 30;
  const gap = menu.h >= 240 ? 34 : 26;
  const h = menu.h >= 240 ? 26 : 20;
  return { title: menu.y + 10, rows: [0, 1, 2, 3, 4, 5].map((i) => r(x, top + i * gap, w, h)) };
}

/** Felt panel behind the four room slots (also the 'room' spotlight region). */
export function roomPanelRect(f: Frame): Rect {
  const x0 = (f.roomX[0] ?? 0) - 8;
  return r(x0, f.roomY - 8, (f.roomX[3] ?? 0) + CARD_W + 8 - x0, CARD_H + 16);
}

/** Weapon tray behind the weapon and slain fan; captions (WEAPON / MAX n) sit on `capY` under it. */
export function trayRect(f: Frame): Rect & { readonly capY: number } {
  const t = r(f.weapon.x - 6, f.weapon.y - 6, f.fanRight - f.weapon.x + 12, CARD_H + 18);
  return { ...t, capY: t.y + t.h + 3 };
}

// ---------------------------------------------------------------------------------------------------------
// Tutorial panels: inner geometry shared by layout (hit rects) and render/coach.ts (drawing).

export interface CoachParts {
  readonly skip: Rect;
  readonly next: Rect;
  /** Text column: left edge, header baseline, first text line, line height, bottom limit, right edge. */
  readonly textX: number;
  readonly headerY: number;
  readonly textY: number;
  readonly lineH: number;
  readonly textBottom: number;
  readonly textRight: number;
}

export function coachParts(panel: Rect, orientation: 'portrait' | 'landscape'): CoachParts {
  const right = panel.x + panel.w;
  if (orientation === 'portrait') {
    return {
      skip: r(right - 40, panel.y + 4, 36, 13),
      // At least 20 logical px tall (80 CSS px at 4x) for thumbs.
      next: r(right - 62, panel.y + panel.h - 25, 58, 21),
      textX: panel.x + 6,
      headerY: panel.y + 6,
      textY: panel.y + 15,
      lineH: 7,
      textBottom: panel.y + panel.h - 3,
      textRight: right - 6,
    };
  }
  return {
    skip: r(right - 40, panel.y + 3, 36, 11),
    next: r(right - 50, panel.y + 16, 46, 14),
    textX: panel.x + 6,
    headerY: panel.y + 4,
    textY: panel.y + 12,
    lineH: 7,
    textBottom: panel.y + panel.h - 2,
    textRight: right - 6,
  };
}

export interface OfferParts {
  readonly accept: Rect;
  readonly decline: Rect;
  readonly titleY: number;
  readonly bodyY: number;
  readonly hintY: number;
}

export function offerParts(panel: Rect, orientation: 'portrait' | 'landscape'): OfferParts {
  if (orientation === 'portrait') {
    const bw = 190;
    const bx = panel.x + Math.round((panel.w - bw) / 2);
    return {
      titleY: panel.y + 14,
      bodyY: panel.y + 36,
      accept: r(bx, panel.y + 68, bw, 30),
      decline: r(bx, panel.y + 106, bw, 30),
      hintY: panel.y + 150,
    };
  }
  const bw = 120;
  const gap = 12;
  const bx = panel.x + Math.round((panel.w - (bw * 2 + gap)) / 2);
  return {
    titleY: panel.y + 12,
    bodyY: panel.y + 32,
    accept: r(bx, panel.y + 60, bw, 26),
    decline: r(bx + bw + gap, panel.y + 60, bw, 26),
    hintY: panel.y + 98,
  };
}

export interface RecapParts {
  readonly play: Rect;
  readonly replay: Rect;
  readonly titleY: number;
  readonly scoreY: number;
  readonly scoreTextY: number;
  readonly linesY: number;
  readonly lineH: number;
  readonly hintY: number;
  readonly titleScale: number;
  readonly scoreScale: number;
}

export function recapParts(panel: Rect, orientation: 'portrait' | 'landscape'): RecapParts {
  if (orientation === 'portrait') {
    const bw = 210;
    const bx = panel.x + Math.round((panel.w - bw) / 2);
    return {
      titleY: panel.y + 12,
      titleScale: 3,
      scoreY: panel.y + 36,
      scoreScale: 4,
      scoreTextY: panel.y + 60,
      linesY: panel.y + 78,
      lineH: 9,
      play: r(bx, panel.y + 198, bw, 30),
      replay: r(bx, panel.y + 236, bw, 30),
      hintY: panel.y + 276,
    };
  }
  const bw = 150;
  const gap = 10;
  const bx = panel.x + Math.round((panel.w - (bw * 2 + gap)) / 2);
  return {
    titleY: panel.y + 9,
    titleScale: 3,
    scoreY: panel.y + 30,
    scoreScale: 3,
    scoreTextY: panel.y + 50,
    linesY: panel.y + 64,
    lineH: 11,
    play: r(bx, panel.y + 150, bw, 24),
    replay: r(bx + bw + gap, panel.y + 150, bw, 24),
    hintY: panel.y + 182,
  };
}

/** Spotlight regions (docs/TUTORIAL.md "Layout and mobile"). Rects hug what the player should look at. */
function regionsFor(f: Frame, orientation: 'portrait' | 'landscape'): ReadonlyMap<RegionId, Rect> {
  const tray = trayRect(f);
  const m = new Map<RegionId, Rect>();
  m.set('hp', f.hpMeter);
  m.set('score', r(f.scoreX - 3, f.topY + 2, 58, 11));
  m.set('deck', r(f.deck.x - 2, f.deck.y - 4, f.deck.w + 4, f.deck.h + 15));
  m.set('discard', r(f.discard.x - 2, f.discard.y - 4, f.discard.w + 4, f.discard.h + 15));
  m.set('room', roomPanelRect(f));
  m.set('weapon', r(f.weapon.x - 2, f.weapon.y - 2, f.weapon.w + 4, f.weapon.h + 4));
  m.set('weaponLimit', r(tray.x + tray.w - 42, tray.capY - 3, 40, 11));
  const fanX = f.weapon.x + 18;
  m.set('slainStack', r(fanX, f.weapon.y + 4, f.fanRight - fanX + 2, CARD_H + 4));
  void orientation;
  return m;
}

export function computeLayout(view: GameView, viewport: Viewport): LayoutSnapshot {
  const orientation = viewport.orientation;
  const geo = screenGeometry(viewport);
  const logical = { w: geo.w, h: geo.h };
  const cards = new Map<CardId, Rect>();
  const buttons = new Map<ButtonId, Rect>();
  const chrome = view.chrome;
  const inGame = chrome.screen === 'game';
  const tutorial = inGame ? chrome.tutorial ?? null : null;
  const recap = tutorial?.phase === 'recap' && tutorial.recap !== null;
  const offer = !inGame && chrome.tutorialOffer === true;
  const f = frameFor(orientation, logical, geo.safe, tutorial ? 'coach' : 'play');

  const snapshot = (): LayoutSnapshot => {
    const base = { cards, deck: f.deck, discard: f.discard, weapon: f.weapon, hpMeter: f.hpMeter, buttons, orientation, logical, safe: geo.safe };
    if (tutorial) return { ...base, regions: regionsFor(f, orientation), coach: recap ? f.recap : f.coach };
    return base;
  };

  if (inGame) {
    // Weapon + slain fan first (lower in draw order), room cards last (on top).
    if (view.weapon) {
      cards.set(view.weapon.card.id, f.weapon);
      const n = view.weapon.slain.length;
      const start = f.weapon.x + 20;
      const maxStep = 14;
      const room = f.fanRight - (start + CARD_W);
      const step = n > 1 ? Math.max(4, Math.min(maxStep, Math.floor(room / (n - 1)))) : maxStep;
      view.weapon.slain.forEach((m, i) => cards.set(m.id, r(start + i * step, f.weapon.y + 6, CARD_W, CARD_H)));
    }
    view.room.forEach((rc, slot) => {
      if (rc) cards.set(rc.card.id, r(f.roomX[slot] ?? 0, f.roomY, CARD_W, CARD_H));
    });
  }

  if (chrome.menuOpen) {
    const { rows } = menuRows(f.menu);
    const [crt, motion, vol, mute, restart, close] = rows as [Rect, Rect, Rect, Rect, Rect, Rect];
    buttons.set('crt', crt);
    buttons.set('motion', motion);
    buttons.set('volDown', r(vol.x, vol.y, 28, vol.h));
    buttons.set('volUp', r(vol.x + vol.w - 28, vol.y, 28, vol.h));
    buttons.set('mute', mute);
    // In the tutorial the restart row becomes LEAVE TUTORIAL (never the newGame id; see docs/TUTORIAL.md).
    if (tutorial) buttons.set('tutorialSkip', restart);
    else if (inGame) buttons.set('newGame', restart);
    buttons.set('closeMenu', close);
    return snapshot();
  }

  buttons.set('mute', f.mute);
  buttons.set('settings', f.settings);

  if (!inGame) {
    if (offer) {
      const o = offerParts(f.offer, orientation);
      buttons.set('tutorialAccept', o.accept);
      buttons.set('tutorialDecline', o.decline);
    } else {
      buttons.set('newGame', f.play);
      buttons.set('tutorial', f.tutorial);
    }
    return snapshot();
  }

  if (tutorial) {
    if (recap) {
      const p = recapParts(f.recap, orientation);
      buttons.set('tutorialPlayReal', p.play);
      buttons.set('tutorialReplay', p.replay);
      return snapshot();
    }
    const c = coachParts(f.coach, orientation);
    buttons.set('tutorialSkip', c.skip);
    if (tutorial.coach?.showNext) buttons.set('tutorialNext', c.next);
  } else if (chrome.showResult) {
    buttons.set('newGame', f.resultNewGame);
    return snapshot();
  }

  if (view.phase === 'choosing' || view.phase === 'resolving') {
    const pending = view.pendingFight ? view.room.find((rc) => rc?.card.id === view.pendingFight) : undefined;
    if (pending) {
      if (pending.canUseWeapon) buttons.set('fightWeapon', f.actions.fightWeapon);
      buttons.set('fightBarehanded', f.actions.fightBarehanded);
      buttons.set('cancel', f.actions.cancel);
    } else if (view.phase === 'choosing') {
      buttons.set('avoid', f.actions.avoid);
    }
  }

  return snapshot();
}
