/**
 * Layout: home rects for every card, pile and button, per orientation. Pure. Owner: Starbuck.
 * Landscape = 480x270 logical (desktop, phones held sideways). Portrait = 270x480 logical (phones upright).
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

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

interface Frame {
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
  readonly menu: Rect;
  /** Title-screen TUTORIAL button (under PLAY). */
  readonly tutorial: Rect;
  /** First-launch offer modal. */
  readonly offer: Rect;
  /** Coach strip (replaces the hint line while the tutorial runs). */
  readonly coach: Rect;
  /** Recap panel (replaces the result panel at the end of the tutorial). */
  readonly recap: Rect;
}

const LANDSCAPE: Frame = {
  deck: r(24, 30, CARD_W, CARD_H),
  discard: r(400, 30, CARD_W, CARD_H),
  hpMeter: r(16, 134, 88, 72),
  weapon: r(124, 134, CARD_W, CARD_H),
  roomX: [113, 179, 245, 311],
  roomY: 30,
  fanRight: 356,
  mute: r(444, 3, 14, 13),
  settings: r(461, 3, 14, 13),
  actions: {
    avoid: r(370, 150, 94, 24),
    fightWeapon: r(370, 136, 94, 22),
    fightBarehanded: r(370, 162, 94, 22),
    cancel: r(370, 188, 94, 16),
  },
  play: r(186, 184, 108, 24),
  resultNewGame: r(186, 186, 108, 24),
  menu: r(130, 36, 220, 200),
  tutorial: r(196, 213, 88, 18),
  offer: r(100, 62, 280, 116),
  // Below the weapon-tray captions (y 227-232) so the MAX limit badge stays visible during the dulling lessons.
  coach: r(8, 234, 464, 33),
  recap: r(40, 37, 400, 196),
};

const PORTRAIT: Frame = {
  deck: r(14, 28, CARD_W, CARD_H),
  discard: r(200, 28, CARD_W, CARD_H),
  hpMeter: r(78, 34, 114, 66),
  weapon: r(16, 228, CARD_W, CARD_H),
  roomX: [11, 75, 139, 203],
  roomY: 124,
  fanRight: 256,
  mute: r(234, 3, 14, 13),
  settings: r(252, 3, 14, 13),
  actions: {
    avoid: r(35, 338, 200, 28),
    fightWeapon: r(35, 330, 200, 26),
    fightBarehanded: r(35, 362, 200, 26),
    cancel: r(35, 394, 200, 20),
  },
  play: r(75, 318, 120, 30),
  resultNewGame: r(75, 300, 120, 28),
  menu: r(20, 96, 230, 260),
  tutorial: r(85, 356, 100, 24),
  offer: r(12, 146, 246, 170),
  // Below the fight/avoid/cancel buttons (which end at y 414).
  coach: r(6, 416, 258, 60),
  recap: r(8, 94, 254, 292),
};

export function frameFor(orientation: 'portrait' | 'landscape'): Frame {
  return orientation === 'portrait' ? PORTRAIT : LANDSCAPE;
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
  m.set('score', r(5, 2, 58, 11));
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
  const f = frameFor(orientation);
  const cards = new Map<CardId, Rect>();
  const buttons = new Map<ButtonId, Rect>();
  const chrome = view.chrome;
  const inGame = chrome.screen === 'game';
  const tutorial = inGame ? chrome.tutorial ?? null : null;
  const recap = tutorial?.phase === 'recap' && tutorial.recap !== null;
  const offer = !inGame && chrome.tutorialOffer === true;

  const snapshot = (): LayoutSnapshot => {
    const base = { cards, deck: f.deck, discard: f.discard, weapon: f.weapon, hpMeter: f.hpMeter, buttons, orientation };
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
