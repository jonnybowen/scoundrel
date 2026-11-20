/**
 * Layout: home rects for every card, pile and button, per orientation. Pure. Owner: Starbuck.
 * Landscape = 480x270 logical (desktop, phones held sideways). Portrait = 270x480 logical (phones upright).
 * FX tweens cards toward these homes; render draws them; hitTest tests against them.
 */
import type { CardId } from '../game';
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
  play: r(186, 190, 108, 26),
  resultNewGame: r(186, 186, 108, 24),
  menu: r(130, 36, 220, 200),
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

export function computeLayout(view: GameView, viewport: Viewport): LayoutSnapshot {
  const orientation = viewport.orientation;
  const f = frameFor(orientation);
  const cards = new Map<CardId, Rect>();
  const buttons = new Map<ButtonId, Rect>();
  const chrome = view.chrome;
  const inGame = chrome.screen === 'game';

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
    if (inGame) buttons.set('newGame', restart);
    buttons.set('closeMenu', close);
    return { cards, deck: f.deck, discard: f.discard, weapon: f.weapon, hpMeter: f.hpMeter, buttons, orientation };
  }

  buttons.set('mute', f.mute);
  buttons.set('settings', f.settings);

  if (!inGame) {
    buttons.set('newGame', f.play);
  } else if (chrome.showResult) {
    buttons.set('newGame', f.resultNewGame);
  } else if (view.phase === 'choosing' || view.phase === 'resolving') {
    const pending = view.pendingFight ? view.room.find((rc) => rc?.card.id === view.pendingFight) : undefined;
    if (pending) {
      if (pending.canUseWeapon) buttons.set('fightWeapon', f.actions.fightWeapon);
      buttons.set('fightBarehanded', f.actions.fightBarehanded);
      buttons.set('cancel', f.actions.cancel);
    } else if (view.phase === 'choosing') {
      buttons.set('avoid', f.actions.avoid);
    }
  }

  return { cards, deck: f.deck, discard: f.discard, weapon: f.weapon, hpMeter: f.hpMeter, buttons, orientation };
}
