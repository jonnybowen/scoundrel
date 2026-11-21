/**
 * Canvas renderer. Owner: Starbuck.
 *
 * Draws the whole scene at the logical resolution (short side 270, long side by aspect; render/screen.ts) into an
 * offscreen 2D canvas (crisp pixels), then
 * presents it to the display canvas, which is ALWAYS a 2D context: either a copy of the WebGL CRT pass's
 * private canvas (crt.ts) or, when CRT is off / WebGL is unavailable, failed to initialise or is lost, a
 * nearest-neighbour 2D blit of the scene.
 * Pure function of (GameView, LayoutSnapshot, FxFrame, time); keeps only caches (card sprites, text runs,
 * background buffer). Applies no game rules: every affordance comes precomputed in GameView.
 */
import type { Card, CardId } from '../game';
import type { CardTransform, FxFrame } from '../fx/types';
import type { ButtonId, GameView, LayoutSnapshot, Rect, RoomCardView } from '../ui/view';
import type { CrtParams, Renderer, Viewport } from './types';
import { cardBack, cardFace, cardShape, drawIcon, parseCardId, rankLabel, type IconId } from './cardArt';
import { createCrtPass, warpUv, type CrtPass } from './crt';
import { drawText, drawTextOutline, drawTextShadow, measureText } from './font';
import { frameOf, logicalOf, menuRows } from './layout';
import { screenGeometry } from './screen';
import { BTN, button, panel, type ButtonStyle } from './widgets';
import { drawCoach, drawOffer, drawRecap, drawSpotlight } from './coach';

/** Tutorial buttons that coach.ts draws inside its own panels (drawButtons skips them). */
const COACH_DRAWN: ReadonlySet<ButtonId> = new Set<ButtonId>([
  'tutorialAccept', 'tutorialDecline', 'tutorialNext', 'tutorialPlayReal', 'tutorialReplay',
]);
import { CARD_H, CARD_W, DEFAULT_CRT, PAL, SWIRL_A, SWIRL_B, SWIRL_C } from './theme';

type Ctx = CanvasRenderingContext2D;

interface DrawItem {
  readonly card: Card;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly faceUp: number;
  readonly opacity: number;
  readonly flash: number;
  readonly z: number;
  readonly room: RoomCardView | null;
  readonly animated: boolean;
}

const contains = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// -------------------------------------------------------------------------------------------------------
// Ambient background: Balatro-style slow swirl, posterised, rendered at half resolution (2x2 chunky pixels).

class Background {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: Ctx | null = null;
  private img: ImageData | null = null;
  private lastT = -1;
  private frame = 0;

  draw(target: Ctx, w: number, h: number, t: number, frozen: boolean): void {
    const bw = Math.ceil(w / 2);
    const bh = Math.ceil(h / 2);
    if (!this.canvas || this.canvas.width !== bw || this.canvas.height !== bh) {
      [this.canvas, this.ctx] = makeCanvas(bw, bh);
      this.img = this.ctx.createImageData(bw, bh);
      this.lastT = -1;
    }
    const time = frozen ? 0 : t;
    // Recompute every other frame (it moves slowly) or once when frozen.
    this.frame++;
    const stale = this.lastT < 0 || (!frozen && this.frame % 2 === 0) || (frozen && this.lastT !== 0);
    if (stale && this.ctx && this.img) {
      this.fill(this.img, bw, bh, time);
      this.ctx.putImageData(this.img, 0, 0);
      this.lastT = time;
    }
    target.drawImage(this.canvas, 0, 0, bw * 2, bh * 2);
  }

  private fill(img: ImageData, w: number, h: number, t: number): void {
    const d = img.data;
    const cx = w / 2;
    const cy = h / 2;
    const ts = t * 0.00025;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);
        const s1 = Math.sin(dist * 0.11 - ts * 2.2 + Math.sin(ang * 3 + ts) * 1.4);
        const s2 = Math.sin(x * 0.05 + Math.sin(y * 0.07 + ts * 1.3) * 1.8 + ts);
        let v = (s1 + s2) * 0.25 + 0.5;
        v = Math.round(v * 5) / 5; // posterise into bands
        let a: readonly number[];
        let b: readonly number[];
        let k: number;
        if (v < 0.5) {
          a = SWIRL_A; b = SWIRL_B; k = v * 2;
        } else {
          a = SWIRL_B; b = SWIRL_C; k = (v - 0.5) * 2;
        }
        // Ordered dither at band edges, darker towards the edges of the screen.
        const edge = 1 - Math.min(1, (dist / Math.max(cx, cy)) * 0.45);
        const i = (y * w + x) * 4;
        d[i] = ((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * k) * edge;
        d[i + 1] = ((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * k) * edge;
        d[i + 2] = ((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * k) * edge;
        d[i + 3] = 255;
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------------
// Primitives.

function slotOutline(ctx: Ctx, r: Rect, color: string = PAL.panelEdge): void {
  ctx.fillStyle = color;
  for (let x = r.x + 2; x < r.x + r.w - 2; x += 4) {
    ctx.fillRect(x, r.y, 2, 1);
    ctx.fillRect(x, r.y + r.h - 1, 2, 1);
  }
  for (let y = r.y + 2; y < r.y + r.h - 2; y += 4) {
    ctx.fillRect(r.x, y, 1, 2);
    ctx.fillRect(r.x + r.w - 1, y, 1, 2);
  }
}

function hpColor(hp: number, max: number): string {
  if (hp <= max * 0.25) return PAL.red;
  if (hp <= max * 0.5) return PAL.orange;
  return PAL.green;
}


// -------------------------------------------------------------------------------------------------------

export function createCanvasRenderer(): Renderer {
  let display: HTMLCanvasElement | null = null;
  let crt: CrtPass | null = null;
  let ctx2d: Ctx | null = null;
  let crtParams: CrtParams = DEFAULT_CRT;
  let cssW = 1;
  let cssH = 1;
  let viewport: Viewport | null = null;
  const bg = new Background();
  let [scene, sctx] = makeCanvas(480, 270);

  /** The warped CRT image is what's on screen (so hitTest must mirror the warp). */
  const crtActive = (): boolean => crt !== null && crtParams.enabled && !crt.isLost();

  const ensureScene = (w: number, h: number): void => {
    if (scene.width !== w || scene.height !== h) [scene, sctx] = makeCanvas(w, h);
  };

  const applySize = (): void => {
    if (!display || !viewport) return;
    // Logical size follows the aspect (long side 480..660); the scale is integer unless that wastes >5% of the
    // short axis (render/screen.ts has the reasoning). computeLayout derives the same geometry from the viewport.
    const { w, h, devW, devH } = screenGeometry(viewport);
    const dpr = Math.max(1, viewport.devicePixelRatio || 1);
    crt?.resize(devW, devH);
    if (display.width !== devW) display.width = devW;
    if (display.height !== devH) display.height = devH;
    cssW = devW / dpr;
    cssH = devH / dpr;
    display.style.width = `${cssW}px`;
    display.style.height = `${cssH}px`;
    ensureScene(w, h);
  };

  // ----- scene drawing --------------------------------------------------------------------------------

  const drawCardItem = (ctx: Ctx, it: DrawItem, highlight: string | null, dim: boolean): void => {
    const sx = Math.abs(it.faceUp * 2 - 1);
    const showFace = it.faceUp >= 0.5;
    const img = showFace ? cardFace(it.card) : cardBack();
    const cx = Math.round(it.x + CARD_W / 2);
    const cy = Math.round(it.y + CARD_H / 2);
    ctx.save();
    ctx.translate(cx, cy);
    if (it.rotation) ctx.rotate(it.rotation);
    ctx.scale(it.scale * Math.max(0.04, sx), it.scale);
    ctx.globalAlpha = it.opacity * 0.6;
    cardShape(ctx, -CARD_W / 2 + 2, -CARD_H / 2 + 3, CARD_W, CARD_H, PAL.shadow);
    ctx.globalAlpha = it.opacity;
    if (highlight) {
      cardShape(ctx, -CARD_W / 2 - 2, -CARD_H / 2 - 2, CARD_W + 4, CARD_H + 4, highlight);
    }
    ctx.drawImage(img, -CARD_W / 2, -CARD_H / 2);
    if (dim) {
      ctx.globalAlpha = it.opacity * 0.45;
      cardShape(ctx, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, PAL.ink);
    }
    if (it.flash > 0) {
      ctx.globalAlpha = Math.min(1, it.flash) * it.opacity;
      cardShape(ctx, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, PAL.white);
    }
    // Affordance badges on room cards (top-right corner), only when face up and at rest-ish.
    if (showFace && it.room && it.opacity > 0.5) {
      ctx.globalAlpha = it.opacity;
      const bx = CARD_W / 2 - 12;
      const by = -CARD_H / 2 + 3;
      if (it.room.potionWouldBeWasted) {
        badge(ctx, bx, by, PAL.greyDark, 'cross', PAL.red);
      } else if (it.room.kind === 'monster' && !it.room.canUseWeapon) {
        // Monster the weapon cannot (or no weapon to) fight: show a fist (barehanded only).
        badge(ctx, bx, by, PAL.redDark, 'fist', PAL.white);
      }
    }
    ctx.restore();
  };

  const badge = (ctx: Ctx, x: number, y: number, fill: string, icon: IconId, color: string): void => {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x - 1, y - 1, 11, 11);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, 9, 9);
    drawIcon(ctx, icon, x + 2, y + 2, color);
  };

  const collectItems = (view: GameView, layout: LayoutSnapshot, fx: FxFrame, t: number, still: boolean): DrawItem[] => {
    const items: DrawItem[] = [];
    const seen = new Set<CardId>();
    const roomById = new Map<CardId, RoomCardView>();
    for (const rc of view.room) if (rc) roomById.set(rc.card.id, rc);
    const known = new Map<CardId, Card>();
    if (view.weapon) {
      known.set(view.weapon.card.id, view.weapon.card);
      for (const m of view.weapon.slain) known.set(m.id, m);
    }
    for (const rc of view.room) if (rc) known.set(rc.card.id, rc.card);

    const hover = view.chrome.hover;
    let zBase = 0;
    for (const [id, home] of layout.cards) {
      const card = known.get(id) ?? parseCardId(id);
      if (!card) continue;
      seen.add(id);
      const rc = roomById.get(id) ?? null;
      const tr: CardTransform | undefined = fx.cards.get(id);
      zBase++;
      if (tr) {
        items.push({ card, ...pick(tr), room: rc, animated: true });
        continue;
      }
      let y = home.y;
      let rotation = 0;
      if (rc) {
        const hovered = hover?.kind === 'card' && hover.cardId === id;
        const pending = view.pendingFight === id;
        if (!still) y += Math.round(Math.sin(t * 0.0021 + rc.slot * 1.7) * 1);
        if ((hovered && rc.playable) || pending) {
          y -= 4;
          if (!still) rotation = Math.sin(t * 0.004 + rc.slot) * 0.03;
        }
      }
      items.push({
        card, x: home.x, y, scale: 1, rotation, faceUp: 1, opacity: 1, flash: 0,
        z: rc ? 100 + zBase : zBase, room: rc, animated: false,
      });
    }
    // Cards FX is animating that are no longer in the view (flying to discard / bottom of deck).
    for (const [id, tr] of fx.cards) {
      if (seen.has(id)) continue;
      const card = parseCardId(id);
      if (card) items.push({ card, ...pick(tr), room: null, animated: true });
    }
    items.sort((a, b) => a.z - b.z);
    return items;
  };

  const pick = (tr: CardTransform): Omit<DrawItem, 'card' | 'room' | 'animated'> => ({
    x: tr.x, y: tr.y, scale: tr.scale, rotation: tr.rotation, faceUp: tr.faceUp, opacity: tr.opacity, flash: tr.flash, z: tr.z,
  });

  const drawPile = (ctx: Ctx, r: Rect, count: number, label: string, faceDim: boolean): void => {
    slotOutline(ctx, r);
    if (count > 0) {
      const layers = Math.min(5, Math.ceil(count / 9));
      for (let i = 0; i < layers; i++) {
        const off = layers - 1 - i;
        cardShape(ctx, r.x + off + 1, r.y - off + 2, CARD_W, CARD_H, PAL.shadow);
        ctx.drawImage(cardBack(), r.x + off, r.y - off);
      }
      if (faceDim) {
        ctx.globalAlpha = 0.45;
        cardShape(ctx, r.x, r.y, CARD_W, CARD_H, PAL.ink);
        ctx.globalAlpha = 1;
      }
    }
    const cx = r.x + r.w / 2;
    drawTextShadow(ctx, label, cx, r.y + r.h + 3, PAL.grey, 1, 'center');
    drawTextOutline(ctx, String(count), cx, r.y + r.h / 2 - 5, PAL.white, 2, 'center');
  };

  const drawHp = (ctx: Ctx, r: Rect, hp: number, maxHp: number, t: number, still: boolean): void => {
    panel(ctx, r);
    const color = hpColor(hp, maxHp);
    const low = hp <= maxHp * 0.25 && hp > 0;
    const beat = !still && low ? (Math.sin(t * 0.012) > 0.3 ? 1 : 0) : 0;
    const hs = 3 + beat;
    drawIcon(ctx, 'heart', r.x + 8 - beat * 2, r.y + 8 - beat * 2, PAL.red, hs);
    const num = String(Math.max(0, Math.round(hp)));
    drawTextOutline(ctx, num, r.x + 30, r.y + 8, color, 3);
    drawTextShadow(ctx, `/${maxHp}`, r.x + 30 + measureText(num, 3) + 3, r.y + 18, PAL.grey);
    // Segmented bar, one segment per HP.
    const segs = maxHp;
    const barW = r.w - 16;
    const segW = Math.max(2, Math.floor((barW + 1) / segs) - 1);
    const used = segs * (segW + 1) - 1;
    const bx = Math.round(r.x + (r.w - used) / 2);
    const by = r.y + r.h - 18;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(bx - 2, by - 2, used + 4, 12);
    for (let i = 0; i < segs; i++) {
      const on = i < hp;
      ctx.fillStyle = on ? color : '#2c2640';
      ctx.fillRect(bx + i * (segW + 1), by, segW, 8);
      if (on) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(bx + i * (segW + 1), by, segW, 2);
      }
    }
    drawTextShadow(ctx, 'HEALTH', r.x + r.w / 2, r.y + r.h - 8 + 1, PAL.grey, 1, 'center');
  };

  const buttonLabel = (id: ButtonId, view: GameView): { label: string; style: ButtonStyle; icon?: IconId } => {
    const s = view.chrome.settings;
    const pending = view.pendingFight ? view.room.find((rc) => rc?.card.id === view.pendingFight) : undefined;
    switch (id) {
      case 'avoid':
        return { label: 'AVOID', style: view.canAvoid ? BTN.orange : BTN.grey };
      case 'enter':
        return { label: 'ENTER', style: BTN.green };
      case 'fightWeapon':
        return { label: `-${pending?.damageWithWeapon ?? 0}`, style: BTN.blue, icon: 'sword' };
      case 'fightBarehanded':
        return { label: `-${pending?.damageBarehanded ?? 0}`, style: BTN.red, icon: 'fist' };
      case 'cancel':
        return { label: 'CANCEL', style: BTN.grey };
      case 'newGame':
        if (view.chrome.menuOpen) return { label: 'RESTART RUN', style: BTN.red };
        return { label: view.chrome.screen === 'title' ? 'PLAY' : 'NEW RUN', style: BTN.green };
      case 'mute':
        if (view.chrome.menuOpen) return { label: `SOUND: ${s.muted ? 'OFF' : 'ON'}`, style: BTN.panel };
        return { label: '', style: s.muted ? BTN.red : BTN.panel, icon: s.muted ? 'speakerOff' : 'speaker' };
      case 'settings':
        return { label: '', style: BTN.panel, icon: 'gear' };
      case 'crt':
        return { label: `CRT: ${s.crtEnabled ? 'ON' : 'OFF'}`, style: BTN.panel };
      case 'motion':
        return { label: `MOTION: ${s.reducedMotion ? 'LOW' : 'FULL'}`, style: BTN.panel };
      case 'volDown':
        return { label: '-', style: BTN.blue };
      case 'volUp':
        return { label: '+', style: BTN.blue };
      case 'closeMenu':
        return { label: 'BACK', style: BTN.green };
      // Design Review 2 tutorial buttons (labels per docs/TUTORIAL.md; never laid out until Starbuck wires them).
      case 'tutorial':
        return { label: 'TUTORIAL', style: BTN.blue };
      case 'tutorialAccept':
        return { label: 'TEACH ME', style: BTN.green };
      case 'tutorialDecline':
        return { label: 'I KNOW THE RULES', style: BTN.grey };
      case 'tutorialNext':
        return { label: 'NEXT', style: BTN.green };
      case 'tutorialSkip':
        return { label: view.chrome.menuOpen ? 'LEAVE TUTORIAL' : 'SKIP', style: view.chrome.menuOpen ? BTN.red : BTN.grey };
      case 'tutorialPlayReal':
        return { label: 'PLAY A REAL RUN', style: BTN.green };
      case 'tutorialReplay':
        return { label: 'REPLAY TUTORIAL', style: BTN.panel };
    }
  };

  const drawButtons = (ctx: Ctx, view: GameView, layout: LayoutSnapshot): void => {
    const hover = view.chrome.hover;
    for (const [id, r] of layout.buttons) {
      if (COACH_DRAWN.has(id) || (id === 'tutorialSkip' && !view.chrome.menuOpen)) continue;
      const { label, style, icon } = buttonLabel(id, view);
      const hovered = hover?.kind === 'button' && hover.id === id;
      button(ctx, r, label, style, hovered, icon);
    }
    // Fight-choice caption + volume readout.
    const fw = layout.buttons.get('fightWeapon') ?? layout.buttons.get('fightBarehanded');
    if (fw) drawTextShadow(ctx, 'FIGHT WITH', fw.x + fw.w / 2, fw.y - 9, PAL.gold, 1, 'center');
    const vd = layout.buttons.get('volDown');
    const vu = layout.buttons.get('volUp');
    if (vd && vu) {
      const cx = (vd.x + vd.w + vu.x) / 2;
      const vol = Math.round(view.chrome.settings.masterVolume * 100);
      drawTextShadow(ctx, `VOLUME ${vol}%`, cx, vd.y + vd.h / 2 - 3, PAL.white, 1, 'center');
    }
  };

  const drawTooltip = (ctx: Ctx, view: GameView, layout: LayoutSnapshot, lw: number): void => {
    const hover = view.chrome.hover;
    let rc: RoomCardView | undefined;
    if (view.pendingFight) rc = view.room.find((r) => r?.card.id === view.pendingFight) ?? undefined;
    else if (hover?.kind === 'card') rc = view.room.find((r) => r?.card.id === hover.cardId) ?? undefined;
    if (!rc) {
      if (hover?.kind === 'weapon' && view.weapon) {
        const lim = view.weapon.limit;
        const text = lim === null ? 'FRESH: FIGHTS ANY MONSTER' : `FIGHTS MONSTERS UP TO ${lim}`;
        tip(ctx, layout.weapon.x + layout.weapon.w / 2, layout.weapon.y - 22, [{ text, color: PAL.white }], lw);
      }
      return;
    }
    const home = layout.cards.get(rc.card.id);
    if (!home) return;
    const parts: { text: string; color: string; icon?: IconId }[] = [];
    // Every branch reads precomputed GameView fields (kind, damage*, lethal, canUseWeapon); no rules here.
    if (rc.kind === 'monster') {
      if (rc.damageWithWeapon !== null) parts.push({ text: `-${rc.damageWithWeapon}`, color: PAL.blue, icon: 'sword' });
      if (rc.damageBarehanded !== null) parts.push({ text: `-${rc.damageBarehanded}`, color: PAL.red, icon: 'fist' });
      if (rc.lethal) parts.push({ text: 'LETHAL', color: PAL.red, icon: 'skull' });
      else if (view.weapon && !rc.canUseWeapon) parts.push({ text: 'BLADE TOO DULL', color: PAL.grey });
    } else if (rc.kind === 'potion') {
      parts.push(rc.potionWouldBeWasted ? { text: 'WASTED', color: PAL.grey, icon: 'cross' } : { text: `HEAL ${rc.card.rank}`, color: PAL.green, icon: 'heart' });
    } else {
      parts.push({ text: `EQUIP ${rc.card.rank}`, color: PAL.blue, icon: 'sword' });
      if (view.weapon) parts.push({ text: `DROPS ${rankLabel(view.weapon.card.rank)}`, color: PAL.grey });
    }
    tip(ctx, home.x + home.w / 2, home.y + home.h + 3, parts, lw);
  };

  const tip = (ctx: Ctx, cx: number, y: number, parts: { text: string; color: string; icon?: IconId }[], lw: number): void => {
    const widths = parts.map((p) => measureText(p.text) + (p.icon ? 8 : 0));
    const w = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * 6 + 10;
    const x = Math.max(2, Math.min(lw - w - 2, Math.round(cx - w / 2)));
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x, y, w, 13);
    ctx.fillStyle = PAL.panel;
    ctx.fillRect(x + 1, y + 1, w - 2, 11);
    let px = x + 5;
    parts.forEach((p, i) => {
      if (p.icon) {
        drawIcon(ctx, p.icon, px, y + 4, p.color);
        px += 8;
      }
      drawText(ctx, p.text, px, y + 4, p.color);
      px += (widths[i] ?? 0) - (p.icon ? 8 : 0) + 6;
    });
  };

  const hintText = (view: GameView): string => {
    if (view.pendingFight) return 'WEAPON OR FISTS?  (W / B)';
    if (view.phase === 'choosing') return view.canAvoid ? 'FACE THE ROOM, OR AVOID IT' : 'FACE THE ROOM';
    if (view.phase === 'resolving') {
      const left = view.cardsLeftToResolve;
      return left > 0 ? `RESOLVE ${left} MORE CARD${left === 1 ? '' : 'S'}` : '';
    }
    return '';
  };

  const drawGame = (ctx: Ctx, view: GameView, layout: LayoutSnapshot, fx: FxFrame, t: number, still: boolean, lw: number, lh: number): void => {
    const f = frameOf(layout);
    const portrait = layout.orientation === 'portrait';

    // Table: felt strip behind the room, weapon tray.
    const roomPanel: Rect = { x: (f.roomX[0] ?? 0) - 8, y: f.roomY - 8, w: (f.roomX[3] ?? 0) + CARD_W + 8 - ((f.roomX[0] ?? 0) - 8), h: CARD_H + 16 };
    panel(ctx, roomPanel, PAL.felt, PAL.feltHi, 0.8);
    if (!portrait) drawTextShadow(ctx, `ROOM ${view.roomNumber}`, roomPanel.x + 4, roomPanel.y - 7, PAL.gold);
    for (let s = 0; s < 4; s++) {
      if (!view.room[s]) slotOutline(ctx, { x: f.roomX[s] ?? 0, y: f.roomY, w: CARD_W, h: CARD_H }, PAL.feltHi);
    }
    const tray: Rect = { x: layout.weapon.x - 6, y: layout.weapon.y - 6, w: f.fanRight - layout.weapon.x + 12, h: CARD_H + 18 };
    panel(ctx, tray, PAL.panel, PAL.panelEdge, 0.75);
    // Tray captions sit under the tray: the gap above it is where room-card tooltips hang (they used to overlap).
    const capY = tray.y + tray.h + 3;
    if (view.weapon) {
      const lim = view.weapon.limit;
      drawTextShadow(ctx, 'WEAPON', tray.x + 4, capY, PAL.blue);
      const limText = lim === null ? 'FRESH' : `MAX ${lim}`;
      drawTextShadow(ctx, limText, tray.x + tray.w - 4, capY, lim === null ? PAL.green : PAL.gold, 1, 'right');
    } else {
      drawTextShadow(ctx, 'WEAPON', tray.x + 4, capY, PAL.grey);
      slotOutline(ctx, layout.weapon);
      drawIcon(ctx, 'fist', layout.weapon.x + 20, layout.weapon.y + 26, PAL.greyDark, 3);
      drawText(ctx, 'BARE', layout.weapon.x + layout.weapon.w / 2, layout.weapon.y + 46, PAL.greyDark, 1, 'center');
      drawText(ctx, 'HANDED', layout.weapon.x + layout.weapon.w / 2, layout.weapon.y + 53, PAL.greyDark, 1, 'center');
      // The empty tray is a big blank panel early in a run: say what it is for (static copy, no rules applied).
      // The tutorial teaches this itself, so its board stays quiet.
      if (!view.chrome.tutorial) {
        const cx = Math.round((layout.weapon.x + layout.weapon.w + tray.x + tray.w) / 2);
        const cy = layout.weapon.y + Math.round(layout.weapon.h / 2);
        drawText(ctx, 'NO WEAPON', cx, cy - 10, PAL.greyDark, 1, 'center');
        drawText(ctx, 'EQUIP A DIAMOND', cx, cy + 1, PAL.greyDark, 1, 'center');
        drawText(ctx, 'TO BLOCK DAMAGE', cx, cy + 9, PAL.greyDark, 1, 'center');
      }
    }

    // GameView's deck count drops before the deal lands; count cards FX is still holding back (opacity 0).
    let held = 0;
    for (const rc of view.room) if (rc && fx.cards.get(rc.card.id)?.opacity === 0) held++;
    drawPile(ctx, layout.deck, view.deckCount + held, 'DUNGEON', false);
    drawPile(ctx, layout.discard, view.discardCount, 'DISCARD', true);
    drawHp(ctx, layout.hpMeter, fx.hud.hp ?? view.hp, view.maxHp, t, still);

    // Cards.
    const over = view.phase === 'won' || view.phase === 'lost';
    const blink = still ? true : Math.floor(t / 180) % 2 === 0;
    for (const it of collectItems(view, layout, fx, t, still)) {
      const pending = view.pendingFight === it.card.id;
      const hovered = view.chrome.hover?.kind === 'card' && view.chrome.hover.cardId === it.card.id;
      let highlight: string | null = null;
      if (pending) highlight = blink ? PAL.gold : PAL.orange;
      else if (hovered && it.room?.playable) highlight = PAL.white;
      const dim = !!it.room && !it.room.playable && !it.animated && !over;
      drawCardItem(ctx, it, highlight, dim);
    }

    drawButtons(ctx, view, layout);
    if (!view.chrome.menuOpen && !view.chrome.showResult) drawTooltip(ctx, view, layout, lw);

    // The coach panel replaces the hint line while the tutorial runs.
    const hint = view.chrome.tutorial ? '' : hintText(view);
    if (hint && !view.chrome.showResult) {
      const { x: hx, y: hy } = f.hint;
      if (!(portrait && (view.pendingFight || view.chrome.hover?.kind === 'card'))) {
        drawTextShadow(ctx, hint, hx, hy, PAL.white, 1, 'center');
      }
    }

    // Top bar: score.
    const score = fx.hud.score ?? view.score;
    if (score !== null) {
      drawTextShadow(ctx, 'SCORE', f.scoreX, f.topY + 5, PAL.grey);
      drawTextShadow(ctx, String(Math.round(score)), f.scoreX + 24, f.topY + 5, score < 0 ? PAL.red : PAL.gold);
    }
    if (portrait) drawTextShadow(ctx, `ROOM ${view.roomNumber}`, lw / 2, f.topY + 5, PAL.gold, 1, 'center');
    else drawTextShadow(ctx, 'SCOUNDREL', lw / 2, f.topY + 5, PAL.paperShade, 1, 'center');

    // FX popups.
    for (const p of fx.popups) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      drawTextOutline(ctx, p.text, p.x, p.y - 5, p.color, 2, 'center'); // popup x/y is the text centre
    }
    ctx.globalAlpha = 1;
    void lh;
  };

  const drawTitle = (ctx: Ctx, view: GameView, layout: LayoutSnapshot, t: number, still: boolean, lw: number): void => {
    const portrait = layout.orientation === 'portrait';
    const f = frameOf(layout);
    const title = 'SCOUNDREL';
    const scale = 5;
    const logoY = f.logoY;
    const w = measureText(title, scale);
    let x = Math.round(lw / 2 - w / 2);
    for (let i = 0; i < title.length; i++) {
      const ch = title.charAt(i);
      const bob = still ? 0 : Math.round(Math.sin(t * 0.004 - i * 0.6) * 2);
      drawText(ctx, ch, x + 3, logoY + bob + 4, PAL.ink, scale);
      drawText(ctx, ch, x + 2, logoY + bob + 2, PAL.redDark, scale);
      drawText(ctx, ch, x, logoY + bob, i % 2 === 0 ? PAL.gold : PAL.white, scale);
      x += 4 * scale;
    }
    drawTextShadow(ctx, 'A DUNGEON CRAWL IN 44 CARDS', lw / 2, logoY + 34, PAL.paperShade, 1, 'center');

    // Showcase fan: monster, weapon, potion.
    const showcase: Card[] = [
      { id: 'S14', suit: 'spades', rank: 14 },
      { id: 'D7', suit: 'diamonds', rank: 7 },
      { id: 'H9', suit: 'hearts', rank: 9 },
    ];
    const cy = f.showcaseY;
    showcase.forEach((card, i) => {
      const off = i - 1;
      const bob = still ? 0 : Math.sin(t * 0.002 + i * 2) * 2;
      drawCardItem(ctx, {
        card, x: lw / 2 - CARD_W / 2 + off * 50, y: cy + Math.abs(off) * 6 + bob, scale: 1,
        rotation: off * 0.14 + (still ? 0 : Math.sin(t * 0.0015 + i) * 0.02), faceUp: 1, opacity: 1, flash: 0, z: i, room: null, animated: false,
      }, null, false);
    });
    const labels = ['MONSTERS HURT', 'WEAPONS BLOCK', 'POTIONS HEAL'];
    const ly = cy + CARD_H + 10;
    if (!portrait) {
      labels.forEach((l, i) => drawTextShadow(ctx, l, lw / 2 + (i - 1) * 64, ly, [PAL.red, PAL.blue, PAL.green][i] ?? PAL.white, 1, 'center'));
    } else {
      labels.forEach((l, i) => drawTextShadow(ctx, l, lw / 2, ly + i * 9, [PAL.red, PAL.blue, PAL.green][i] ?? PAL.white, 1, 'center'));
    }

    drawButtons(ctx, view, layout);
    const play = layout.buttons.get('newGame');
    const below = layout.buttons.get('tutorial') ?? play;
    if (play && below && !view.chrome.menuOpen) {
      if (still || Math.floor(t / 500) % 2 === 0) drawTextShadow(ctx, 'ENTER: PLAY    T: TUTORIAL', lw / 2, below.y + below.h + 6, PAL.grey, 1, 'center');
      if (view.chrome.error) drawTextShadow(ctx, view.chrome.error.toUpperCase().slice(0, 60), lw / 2, below.y + below.h + 16, PAL.red, 1, 'center');
    }
    drawTextShadow(ctx, 'RULES BY ZACH GAGE AND KURT BIEG', lw / 2, f.footerY, PAL.greyDark, 1, 'center');
  };

  const drawResult = (ctx: Ctx, view: GameView, layout: LayoutSnapshot, lw: number, lh: number): void => {
    ctx.fillStyle = 'rgba(8,4,16,0.6)';
    ctx.fillRect(0, 0, lw, lh);
    const r: Rect = frameOf(layout).result;
    panel(ctx, r, PAL.night, view.phase === 'won' ? PAL.gold : PAL.redDark, 0.95);
    const won = view.phase === 'won';
    drawTextOutline(ctx, won ? 'ESCAPED!' : 'SLAIN', lw / 2, r.y + 14, won ? PAL.gold : PAL.red, 4, 'center');
    drawTextShadow(ctx, won ? 'YOU CLEARED THE DUNGEON' : 'THE DUNGEON CLAIMS ANOTHER', lw / 2, r.y + 40, PAL.paperShade, 1, 'center');
    drawTextShadow(ctx, 'FINAL SCORE', lw / 2, r.y + 58, PAL.grey, 1, 'center');
    const score = view.score ?? 0;
    drawTextOutline(ctx, String(score), lw / 2, r.y + 70, score < 0 ? PAL.red : PAL.gold, 5, 'center');
    drawTextShadow(ctx, `ROOMS ${view.roomNumber}`, lw / 2, r.y + 102, PAL.grey, 1, 'center');
    drawButtons(ctx, view, layout);
  };

  const drawMenu = (ctx: Ctx, view: GameView, layout: LayoutSnapshot, lw: number, lh: number): void => {
    ctx.fillStyle = 'rgba(8,4,16,0.65)';
    ctx.fillRect(0, 0, lw, lh);
    const f = frameOf(layout);
    panel(ctx, f.menu, PAL.night, PAL.panelEdge, 0.97);
    const { title } = menuRows(f.menu);
    drawTextOutline(ctx, 'SETTINGS', lw / 2, title, PAL.gold, 2, 'center');
    drawButtons(ctx, view, layout);
    drawTextShadow(ctx, 'M MUTE  C CRT  ESC BACK', lw / 2, f.menu.y + f.menu.h - 10, PAL.greyDark, 1, 'center');
  };

  const drawToast = (ctx: Ctx, text: string, lw: number, layout: LayoutSnapshot): void => {
    const w = measureText(text) + 14;
    const x = Math.round(lw / 2 - w / 2);
    // In the tutorial the coach strip owns the bottom of the screen: the toast floats just above it.
    const y = layout.coach ? layout.coach.y - 15 : frameOf(layout).toastY;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x, y, w, 13);
    ctx.fillStyle = PAL.redDark;
    ctx.fillRect(x + 1, y + 1, w - 2, 11);
    drawText(ctx, text, lw / 2, y + 4, PAL.white, 1, 'center');
  };

  // ----- Renderer ------------------------------------------------------------------------------------

  return {
    mount(canvas) {
      display = canvas;
      // Claim the display for 2D first and unconditionally; the CRT pass renders on its own canvas.
      ctx2d = canvas.getContext('2d', { alpha: false });
      if (ctx2d) ctx2d.imageSmoothingEnabled = false;
      else console.error('[render] display canvas has no 2D context; nothing can be presented');
      crt = createCrtPass(canvas.ownerDocument);
      if (!crt) console.info('[render] CRT pass unavailable, presenting with the 2D blit');
      applySize();
    },

    resize(vp) {
      viewport = vp;
      applySize();
    },

    draw(view, layout, fx, timeMs) {
      if (!display) return;
      const { w: lw, h: lh } = logicalOf(layout);
      ensureScene(lw, lh);
      const ctx = sctx;
      const still = view.chrome.settings.reducedMotion;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      bg.draw(ctx, lw, lh, timeMs, still);

      ctx.save();
      ctx.translate(Math.round(fx.shake.x), Math.round(fx.shake.y));
      if (view.chrome.screen === 'title') drawTitle(ctx, view, layout, timeMs, still, lw);
      else drawGame(ctx, view, layout, fx, timeMs, still, lw, lh);
      ctx.restore();

      // Tutorial overlays are driven by chrome.tutorial alone (FxFrame.coach only animates them).
      const tutorial = view.chrome.screen === 'game' ? view.chrome.tutorial ?? null : null;
      const recap = tutorial?.phase === 'recap';
      if (tutorial && !recap) {
        drawSpotlight(ctx, view, layout, fx);
        drawCoach(ctx, view, layout, fx, timeMs);
      }

      if (view.chrome.menuOpen) drawMenu(ctx, view, layout, lw, lh);
      else if (recap) drawRecap(ctx, view, layout);
      else if (view.chrome.screen === 'game' && view.chrome.showResult && !tutorial) drawResult(ctx, view, layout, lw, lh);
      else if (view.chrome.screen === 'title' && view.chrome.tutorialOffer) drawOffer(ctx, view, layout);
      if (view.chrome.toast) drawToast(ctx, view.chrome.toast, lw, layout);

      // Top-right utility buttons are drawn in drawButtons; draw a hover hint for them.
      if (fx.screenFlash && fx.screenFlash.alpha > 0) {
        ctx.globalAlpha = Math.min(1, fx.screenFlash.alpha);
        ctx.fillStyle = fx.screenFlash.color;
        ctx.fillRect(0, 0, lw, lh);
        ctx.globalAlpha = 1;
      }

      // Present. The CRT output is copied in the same task it is drawn (preserveDrawingBuffer is off).
      if (!ctx2d) return;
      ctx2d.imageSmoothingEnabled = false;
      const params: CrtParams = still ? { ...crtParams, noise: 0 } : crtParams;
      if (crtActive() && crt && crt.render(scene, params, still ? 0 : timeMs, still ? 0 : fx.crtPulse)) {
        ctx2d.drawImage(crt.canvas, 0, 0, display.width, display.height);
      } else {
        ctx2d.drawImage(scene, 0, 0, display.width, display.height);
      }
    },

    hitTest(cssX, cssY, layout) {
      const { w: lw, h: lh } = logicalOf(layout);
      let u = cssX / cssW;
      let v = cssY / cssH;
      if (crtActive()) [u, v] = warpUv(u, v, crtParams.curvature);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      const x = u * lw;
      const y = v * lh;
      for (const [id, r] of layout.buttons) if (contains(r, x, y)) return { kind: 'button', id };
      if (layout.buttons.has('closeMenu') || layout.buttons.has('newGame')) return null;
      // Tutorial: modal recap / offer swallow taps; on the coach strip a tap anywhere counts as NEXT when shown.
      if (layout.buttons.has('tutorialPlayReal') || layout.buttons.has('tutorialAccept')) return null;
      if (layout.coach && contains(layout.coach, x, y)) {
        return layout.buttons.has('tutorialNext') ? { kind: 'button', id: 'tutorialNext' } : null;
      }
      const f = frameOf(layout);
      const entries = [...layout.cards.entries()].reverse();
      for (const [cardId, r] of entries) {
        const isRoom = r.y === f.roomY;
        const hit = isRoom ? { x: r.x, y: r.y - 4, w: r.w, h: r.h + 4 } : r;
        if (contains(hit, x, y)) return isRoom ? { kind: 'card', cardId } : { kind: 'weapon' };
      }
      if (contains(layout.weapon, x, y)) return { kind: 'weapon' };
      if (contains(layout.deck, x, y)) return { kind: 'deck' };
      return null;
    },

    setCrt(params) {
      crtParams = { ...crtParams, ...params };
    },

    destroy() {
      crt?.destroy();
      crt = null;
      ctx2d = null;
      display = null;
    },
  };
}

