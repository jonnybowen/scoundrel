/**
 * Tutorial overlays: coach panel, spotlight dimming, pointer arrow, first-launch offer, recap screen.
 * CONTRACT (Design Review 2). Impl owner: Starbuck.
 *
 * Pure drawing from GameView.chrome.tutorial / tutorialOffer, LayoutSnapshot.coach / regions / buttons / cards, and
 * FxFrame.coach. Never reads GameState, never applies rules. Draw order inside renderer.draw():
 *   board -> dim layer with spotlight holes (drawSpotlight) -> coach panel + arrow (drawCoach) -> toast,
 *   and drawRecap / drawOffer as full overlays in place of the result panel / over the title.
 * Whether anything is drawn depends on chrome.tutorial alone. FxFrame.coach only supplies animation values: it
 * appears after the first tutorialCue and never goes away, so its presence means nothing.
 * Reduced motion: static spotlight (pulse 0.5), no arrow bob, no panel bump, no nudge shake, no success flash.
 */
import type { CoachFx, FxFrame } from '../fx/types';
import type { CoachView, SpotlightTarget } from '../tutorial';
import type { ButtonId, GameView, LayoutSnapshot, Rect } from '../ui/view';
import { drawText, drawTextOutline, drawTextShadow, measureText } from './font';
import { coachParts, frameOf, logicalOf, offerParts, recapParts } from './layout';
import { PAL } from './theme';
import { BTN, button, panel, wrapText, type ButtonStyle } from './widgets';

type Ctx = CanvasRenderingContext2D;

const DIM = 'rgba(8,4,16,0.55)';
const HOLE_PAD = 3;
const MAX_STEM = 44;
/** Controls that must stay readable under the dim layer whenever they are on screen. */
const NEVER_DIMMED: readonly ButtonId[] = ['fightWeapon', 'fightBarehanded', 'cancel', 'mute', 'settings'];

const STATIC_FX: CoachFx = { spotlightPulse: 0.5, arrowBob: 0, panelBump: 0, nudgeShake: 0, success: 0 };

function coachFx(view: GameView, fx: FxFrame): CoachFx {
  if (view.chrome.settings.reducedMotion || !fx.coach) return STATIC_FX;
  return fx.coach;
}

function activeCoach(view: GameView): CoachView | null {
  const t = view.chrome.tutorial;
  if (!t || t.phase === 'recap' || view.chrome.screen !== 'game') return null;
  return t.coach;
}

/** Resolve one spotlight target to a rect. Targets that are not laid out right now are skipped (null). */
export function spotlightRect(target: SpotlightTarget, layout: LayoutSnapshot): Rect | null {
  switch (target.kind) {
    case 'card':
      return layout.cards.get(target.cardId) ?? null;
    case 'control':
      return layout.buttons.get(target.id) ?? null;
    case 'region':
      return layout.regions?.get(target.id) ?? null;
  }
}

const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 });

/** Rect with 1px chamfered corners (the chunky rounded look used everywhere else). */
function chunkyFill(ctx: Ctx, r: Rect): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

function chunkyRing(ctx: Ctx, r: Rect): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  ctx.fillRect(x + 2, y, w - 4, 1);
  ctx.fillRect(x + 2, y + h - 1, w - 4, 1);
  ctx.fillRect(x, y + 2, 1, h - 4);
  ctx.fillRect(x + w - 1, y + 2, 1, h - 4);
  ctx.fillRect(x + 1, y + 1, 1, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, 1);
  ctx.fillRect(x + 1, y + h - 2, 1, 1);
  ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
}

let dimCanvas: HTMLCanvasElement | null = null;
let dimCtx: Ctx | null = null;

function dimLayer(w: number, h: number): Ctx | null {
  if (!dimCanvas || dimCanvas.width !== w || dimCanvas.height !== h) {
    dimCanvas = document.createElement('canvas');
    dimCanvas.width = w;
    dimCanvas.height = h;
    dimCtx = dimCanvas.getContext('2d');
  }
  return dimCtx;
}

/** Dim the board outside the spotlight (rounded holes, overlap-safe), then pulse a gold ring around each hole. */
export function drawSpotlight(ctx: Ctx, view: GameView, layout: LayoutSnapshot, fx: FxFrame): void {
  const coach = activeCoach(view);
  if (!coach) return;
  const rects = coach.spotlight.map((t) => spotlightRect(t, layout)).filter((r): r is Rect => r !== null);
  const { w, h } = logicalOf(layout);
  if (coach.dim) {
    const d = dimLayer(w, h);
    if (d && dimCanvas) {
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, w, h);
      d.fillStyle = DIM;
      d.fillRect(0, 0, w, h);
      d.globalCompositeOperation = 'destination-out';
      d.fillStyle = '#000';
      for (const r of rects) chunkyFill(d, grow(r, HOLE_PAD));
      for (const id of NEVER_DIMMED) {
        const r = layout.buttons.get(id);
        if (r) chunkyFill(d, grow(r, 2));
      }
      d.globalCompositeOperation = 'source-over';
      ctx.drawImage(dimCanvas, 0, 0);
    }
  }
  const pulse = coachFx(view, fx).spotlightPulse;
  for (const r of rects) {
    ctx.fillStyle = PAL.ink;
    chunkyRing(ctx, grow(r, HOLE_PAD + 1));
    ctx.globalAlpha = 0.55 + 0.45 * pulse;
    ctx.fillStyle = PAL.gold;
    chunkyRing(ctx, grow(r, HOLE_PAD));
    if (pulse > 0.5) {
      // Outer glow ring breathes out on the top half of the pulse.
      ctx.globalAlpha = (pulse - 0.5) * 0.8;
      chunkyRing(ctx, grow(r, HOLE_PAD + 2));
    }
    ctx.globalAlpha = 1;
  }
}

// -------------------------------------------------------------------------------------------------------
// Coach panel + arrow.

function drawArrow(ctx: Ctx, target: Rect, from: Rect, bob: number): void {
  const tcx = Math.round(target.x + target.w / 2);
  const below = target.y + target.h + HOLE_PAD + 2 <= from.y - 4;
  const above = target.y - HOLE_PAD - 2 >= from.y + from.h + 4;
  if (!below && !above) return; // target beside the panel: the spotlight ring is enough
  const px = Math.max(from.x + 10, Math.min(from.x + from.w - 10, tcx));
  const py = below ? from.y - 1 : from.y + from.h + 1;
  // The tip rests a few px off the ring and bobs toward it.
  const gap = 4 - Math.round(bob);
  const ty = below ? target.y + target.h + HOLE_PAD + 1 + gap : target.y - HOLE_PAD - 1 - gap;
  const tx = tcx;
  // The stem starts at the panel edge but never runs more than MAX_STEM px: a full-length line across the board
  // (deck at the top, panel at the bottom on phones) crosses every card and reads as clutter.
  const len = Math.hypot(tx - px, ty - py);
  const k = len > MAX_STEM ? MAX_STEM / len : 1;
  const sx = Math.round(tx + (px - tx) * k);
  const sy = Math.round(ty + (py - ty) * k);
  // Dotted stem (2x2 dots with an ink shadow so it reads on any background).
  const dx = tx - sx;
  const dy = ty - sy;
  const n = Math.max(1, Math.floor(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  for (let i = 1; i < n - 1; i++) {
    const px = Math.round(sx + (dx * i) / n);
    const py = Math.round(sy + (dy * i) / n);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(px, py + 1, 2, 2);
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(px - 1, py, 2, 2);
  }
  // Chunky arrowhead pointing at the target.
  const dir = below ? 1 : -1; // rows grow away from the tip
  for (let i = 0; i < 5; i++) {
    const y = ty + dir * i;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(tx - i - 1, y, i * 2 + 3, 1);
  }
  for (let i = 0; i < 4; i++) {
    const y = ty + dir * i;
    ctx.fillStyle = i === 0 ? PAL.white : PAL.gold;
    ctx.fillRect(tx - i, y, i * 2 + 1, 1);
  }
}

const offset = (r: Rect, dx: number, dy: number): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });

function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function drawCoach(ctx: Ctx, view: GameView, layout: LayoutSnapshot, fx: FxFrame, timeMs: number): void {
  const coach = activeCoach(view);
  const base = layout.coach;
  if (!coach || !base) return;
  const cf = coachFx(view, fx);
  const still = view.chrome.settings.reducedMotion;
  const dx = Math.round(cf.nudgeShake);
  const dy = -Math.round(cf.panelBump * 2);
  const p = offset(base, dx, dy);

  // Arrow under the panel so its stem tucks behind the panel edge.
  const first = coach.spotlight[0];
  if (coach.arrow && first && !view.chrome.menuOpen) {
    const target = spotlightRect(first, layout);
    if (target) drawArrow(ctx, target, p, cf.arrowBob);
  }

  let edge: string = coach.nudge ? PAL.orange : PAL.gold;
  if (cf.success > 0.02) edge = mixHex(edge.startsWith('#') ? edge : PAL.gold, PAL.green, Math.min(1, cf.success * 1.5));
  panel(ctx, p, PAL.night, edge, 0.96);
  if (cf.panelBump > 0.05) {
    ctx.globalAlpha = Math.min(0.35, cf.panelBump * 0.35);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(p.x + 3, p.y + 2, p.w - 6, 1);
    ctx.globalAlpha = 1;
  }

  const parts = coachParts(base, layout.orientation);
  const skip = offset(parts.skip, dx, dy);
  const next = coach.showNext ? offset(parts.next, dx, dy) : null;
  const textX = parts.textX + dx;

  // Header: LESSON n/7 + title.
  const lessonText = `LESSON ${coach.lesson}/${coach.lessonCount}`;
  drawTextShadow(ctx, lessonText, textX, parts.headerY + dy, PAL.gold);
  drawTextShadow(ctx, coach.title, textX + measureText(lessonText) + 8, parts.headerY + dy, PAL.paper);

  // Body flows around the SKIP / NEXT buttons.
  const blockers = [skip, ...(next ? [next] : [])];
  const lineTop = (i: number): number => parts.textY + dy + i * parts.lineH;
  const widthFor = (i: number): number => {
    const top = lineTop(i) - 1;
    const bottom = top + 7;
    let right = parts.textRight + dx;
    for (const b of blockers) if (bottom > b.y && top < b.y + b.h) right = Math.min(right, b.x - 5);
    return right - textX;
  };
  const maxLines = Math.max(1, Math.floor((parts.textBottom - parts.textY) / parts.lineH));
  const textLines = wrapText(coach.text, widthFor);
  const nudgeLines = coach.nudge ? wrapText(coach.nudge, (i) => widthFor(i + textLines.length)) : [];
  const lines: { text: string; color: string }[] = [
    ...textLines.map((text) => ({ text, color: PAL.white })),
    ...nudgeLines.map((text) => ({ text, color: PAL.orange })),
  ];
  // Never let the nudge fall off the panel: if the page is long, the nudge takes the last lines.
  const shown = lines.length <= maxLines ? lines : [...lines.slice(0, Math.max(0, maxLines - nudgeLines.length)), ...lines.slice(lines.length - nudgeLines.length)].slice(0, maxLines);
  shown.forEach((l, i) => drawTextShadow(ctx, l.text, textX, lineTop(i), l.color));

  // Page dots + buttons.
  if (coach.pageCount > 1) {
    const label = `${coach.page + 1}/${coach.pageCount}`;
    const anchor = next ?? skip;
    const py = next ? next.y + Math.round((next.h - 5) / 2) - 1 : skip.y + skip.h + 4;
    drawText(ctx, label, anchor.x - 4, py, PAL.grey, 1, 'right');
  }
  const hover = view.chrome.hover;
  const hovered = (id: ButtonId): boolean => hover?.kind === 'button' && hover.id === id;
  button(ctx, skip, 'SKIP', BTN.grey, hovered('tutorialSkip'));
  if (next) {
    // NEXT gently blinks its highlight so the player knows the panel is waiting on them.
    const lit = hovered('tutorialNext') || (!still && Math.floor(timeMs / 600) % 2 === 0);
    button(ctx, next, 'NEXT', BTN.green, lit);
  }
}

// -------------------------------------------------------------------------------------------------------
// Full overlays.

function veil(ctx: Ctx, layout: LayoutSnapshot, alpha: number): void {
  const { w, h } = logicalOf(layout);
  ctx.fillStyle = `rgba(8,4,16,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

function drawLaidOutButton(ctx: Ctx, view: GameView, layout: LayoutSnapshot, id: ButtonId, label: string, style: ButtonStyle): void {
  const r = layout.buttons.get(id);
  if (!r) return;
  const hover = view.chrome.hover;
  button(ctx, r, label, style, hover?.kind === 'button' && hover.id === id);
}

const RECAP_BULLETS = [PAL.red, PAL.teal, PAL.orange, PAL.blue, PAL.green, PAL.gold, PAL.pink] as const;

export function drawRecap(ctx: Ctx, view: GameView, layout: LayoutSnapshot): void {
  const t = view.chrome.tutorial;
  const recap = t?.phase === 'recap' ? t.recap : null;
  if (!recap) return;
  veil(ctx, layout, 0.7);
  const box = layout.coach ?? frameOf(layout).recap;
  const parts = recapParts(box, layout.orientation);
  const cx = Math.round(box.x + box.w / 2);
  panel(ctx, box, PAL.night, PAL.gold, 0.97);
  drawTextOutline(ctx, recap.title, cx, parts.titleY, PAL.gold, parts.titleScale, 'center');
  const scoreStr = String(recap.score);
  const label = 'SCORE';
  const sw = measureText(scoreStr, parts.scoreScale);
  const lw = measureText(label);
  const gx = Math.round(cx - (sw + lw + 6) / 2);
  drawTextShadow(ctx, label, gx, parts.scoreY + parts.scoreScale * 5 - 5, PAL.grey);
  drawTextOutline(ctx, scoreStr, gx + lw + 6, parts.scoreY, PAL.gold, parts.scoreScale);
  drawTextShadow(ctx, recap.scoreText, cx, parts.scoreTextY, PAL.paperShade, 1, 'center');

  // Concept lines, each with a coloured pip; wrapped lines indent under the text.
  const textX = box.x + 18;
  const maxW = box.x + box.w - 10 - textX;
  let y = parts.linesY;
  recap.lines.forEach((line, i) => {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(textX - 9, y - 1, 6, 6);
    ctx.fillStyle = RECAP_BULLETS[i % RECAP_BULLETS.length] ?? PAL.gold;
    ctx.fillRect(textX - 8, y, 4, 4);
    for (const l of wrapText(line, () => maxW)) {
      drawTextShadow(ctx, l, textX, y, PAL.white);
      y += parts.lineH - (layout.orientation === 'portrait' ? 2 : 0);
    }
    if (layout.orientation === 'portrait') y += 2;
  });

  drawLaidOutButton(ctx, view, layout, 'tutorialPlayReal', 'PLAY A REAL RUN', BTN.green);
  drawLaidOutButton(ctx, view, layout, 'tutorialReplay', 'REPLAY TUTORIAL', BTN.panel);
  const hint = layout.orientation === 'portrait' ? 'ENTER PLAY  R REPLAY  ESC TITLE' : 'ENTER: PLAY A REAL RUN    R: REPLAY    ESC: TITLE';
  drawTextShadow(ctx, hint, cx, parts.hintY, PAL.grey, 1, 'center');
}

export function drawOffer(ctx: Ctx, view: GameView, layout: LayoutSnapshot): void {
  if (!view.chrome.tutorialOffer || view.chrome.screen !== 'title') return;
  veil(ctx, layout, 0.55);
  const box = frameOf(layout).offer;
  const parts = offerParts(box, layout.orientation);
  const cx = Math.round(box.x + box.w / 2);
  panel(ctx, box, PAL.night, PAL.gold, 0.97);
  drawTextOutline(ctx, 'FIRST TIME IN THE DUNGEON?', cx, parts.titleY, PAL.gold, 2, 'center');
  const body = 'LEARN BY PLAYING: A SHORT GUIDED RUN ON THE REAL BOARD. ABOUT 3 MINUTES.';
  wrapText(body, () => box.w - 24).forEach((l, i) => drawTextShadow(ctx, l, cx, parts.bodyY + i * 9, PAL.paperShade, 1, 'center'));
  drawLaidOutButton(ctx, view, layout, 'tutorialAccept', 'TEACH ME', BTN.green);
  drawLaidOutButton(ctx, view, layout, 'tutorialDecline', 'I KNOW THE RULES', BTN.grey);
  drawTextShadow(ctx, 'ENTER: TEACH ME    ESC: SKIP', cx, parts.hintY, PAL.grey, 1, 'center');
}
