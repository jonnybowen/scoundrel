/**
 * FxDirector implementation. Owner: Gaeta.
 *
 * Pure TS, no DOM, no timers, no randomness: everything is driven by `update(dtMs, layout)`, so the same
 * sequence of (events, dt, layout) always yields the same frames and the same cue order.
 *
 * Model
 * - Each GameEvent becomes a Step with a duration, a cue time (the moment it "lands") and a gap
 *   (how long after its start the next step may start; gap < duration means overlap, e.g. deal stagger).
 * - Every card referenced by a queued/active step is LOCKED: FX owns its on-screen pose until its last
 *   step finishes. Locked cards that have not started moving keep their previous on-screen pose, and cards
 *   still "in the deck" are hidden, so the screen never shows the future (the engine has already jumped).
 * - A card can be driven by one step at a time (ownership passes to the newest step that references it,
 *   starting from wherever the card currently is), so overlapping steps never fight.
 * - Cues fire strictly in event order. skip() and reduced motion run every remaining step to its end
 *   state immediately and still emit every cue.
 * - Cards that leave the view (discarded, swept to the deck) are kept in FxFrame.cards until their exit
 *   tween ends ("ghost" cards); render draws them from the CardId (suit letter + rank).
 */
import type { Card, CardId, GameEvent } from '../game';
import type { LayoutSnapshot, Rect } from '../ui/view';
import type { CardTransform, FxCue, FxDirector, FxFrame } from './types';
import {
  approach,
  backOut,
  backOutBy,
  clamp01,
  cubicIn,
  cubicInOut,
  cubicOut,
  hump,
  lerp,
  quadIn,
  sineInOut,
  window01,
} from './easing';

/** Timing table (ms). Exported so tests and tuning share one source. */
export const FX_TIMING = {
  start: { duration: 250, cueAt: 0, gap: 150 },
  deal: { duration: 300, cueAt: 230, gap: 80 },
  flip: { perCard: 180, stagger: 60, cueAt: 90 },
  enter: { duration: 160, cueAt: 0, gap: 120 },
  avoid: { perCard: 360, stagger: 50, cueAt: 40 },
  fight: { duration: 440, cueAt: 250, gap: 250 },
  damage: { duration: 420, cueAt: 0, gap: 260, hpTween: 350 },
  slain: { duration: 380, cueAt: 40, gap: 300 },
  equip: { duration: 460, cueAt: 320, gap: 460 },
  potion: { duration: 520, cueAt: 220, gap: 520, hpTween: 300 },
  wasted: { duration: 480, cueAt: 100, gap: 480 },
  cleared: { duration: 300, cueAt: 0, gap: 220 },
  won: { duration: 1700, cueAt: 150, gap: 1700 },
  lost: { duration: 1600, cueAt: 0, gap: 1600 },
} as const;

export const FX_COLORS = {
  damage: '#e43b44',
  heal: '#63c74d',
  gold: '#feae34',
  wasted: '#8b9bb4',
  block: '#2ce8f5',
  white: '#ffffff',
} as const;

/** Optional extension: hover feedback (tilt/lift). Additive to the FxDirector contract. */
export interface FxHover {
  setHover(cardId: CardId | null): void;
}

interface Pose {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  faceUp: number;
  opacity: number;
  flash: number;
  z: number;
}

interface PoseArgs {
  readonly id: CardId;
  /** Index of the card inside the step's card list (stagger). */
  readonly i: number;
  /** ms since the step started, clamped to [0, duration]. */
  readonly t: number;
  /** Pose the card had when this step took ownership. */
  readonly from: Pose;
}

interface StepSpec {
  readonly cards: readonly CardId[];
  readonly hidden?: readonly CardId[];
  readonly duration: number;
  readonly cueAt: number;
  readonly gap: number;
  readonly pose?: (a: PoseArgs) => Pose;
  readonly begin?: () => void;
  readonly impact?: () => void;
  readonly tick?: (t: number) => void;
  readonly end?: () => void;
}

interface Step extends StepSpec {
  readonly event: GameEvent;
  readonly index: number;
  start: number;
  begun: boolean;
  cued: boolean;
  readonly from: Map<CardId, Pose>;
}

interface Popup {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly life: number;
  readonly rise: number;
  age: number;
}

interface Persist {
  readonly dy: number;
  readonly rotation: number;
  readonly opacity: number;
}

const DEAL_EASE = backOutBy(1.4);
/** Length of one equip discard exit tween (ms); the stagger is compressed so all exits fit the step. */
const EQUIP_EXIT = 260;
const EQUIP_EXIT_STAGGER = 30;
/** The last exit finishes this long before the step ends, so the final drawn frame (~60 fps) is already at 0. */
const EQUIP_EXIT_TAIL = 32;

const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
const EMPTY_FRAME: FxFrame = {
  cards: new Map(),
  shake: { x: 0, y: 0 },
  screenFlash: null,
  hud: {},
  popups: [],
  crtPulse: 0,
};

const restAt = (r: { x: number; y: number }, z = 10): Pose => ({
  x: r.x,
  y: r.y,
  scale: 1,
  rotation: 0,
  faceUp: 1,
  opacity: 1,
  flash: 0,
  z,
});

const copyPose = (p: Pose): Pose => ({ ...p });

/** Stable small hash for per-card idle phase. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export class Director implements FxDirector, FxHover {
  private now = 0;
  private nextStartAt = 0;
  private layout: LayoutSnapshot | null = null;
  private reduced = false;

  private readonly queue: Step[] = [];
  private readonly active: Step[] = [];
  /** Steps whose cue has not fired yet, in event order. */
  private readonly cueOrder: Step[] = [];
  private readonly listeners = new Set<(cue: FxCue) => void>();

  /** Presented pose of locked cards; null = not resolved yet (needs a layout). */
  private readonly poses = new Map<CardId, Pose | null>();
  private readonly hiddenInit = new Set<CardId>();
  private readonly refs = new Map<CardId, number>();
  private readonly owner = new Map<CardId, Step>();
  /** Last on-screen resting rect of unlocked cards (previous frames' layout). */
  private readonly settled = new Map<CardId, Rect>();

  // Enqueue-time bookkeeping (what the queued events imply), used to pick card sets for steps.
  private readonly modelRoom = new Set<CardId>();
  private modelPendingReveal: CardId[] = [];
  private modelWeapon: CardId[] = [];
  /**
   * Enqueue-time clock: start of the step being built, relative to the current chain of steps. Steps chain
   * strictly by `gap` (start[k+1] = start[k] + gap[k]) while the director is busy, so relative times inside
   * a chain are exact. Reset when a batch arrives on an idle director.
   */
  private modelClock = 0;
  /** Per dealt card: model-clock time its deal lands, and its slot (for the deal trajectory). */
  private readonly modelDealLand = new Map<CardId, { land: number; slot: number }>();

  // Presentation-time state.
  private readonly roomPresent = new Set<CardId>();
  private readonly persist = new Map<CardId, Persist>();
  private hoverTarget: CardId | null = null;
  private readonly hoverAmt = new Map<CardId, number>();

  // Screen effects.
  private trauma = 0;
  private flash: { color: string; alpha: number; age: number; life: number } | null = null;
  private crt = 0;
  private popups: Popup[] = [];
  private hudHp: number | undefined = undefined;
  private hudScore: number | undefined = undefined;

  private current: FxFrame = EMPTY_FRAME;

  // ---------------------------------------------------------------- public API

  enqueue(events: readonly GameEvent[]): void {
    if (events.length === 0) return;
    if (this.queue.length === 0 && this.active.length === 0) {
      this.nextStartAt = Math.max(this.nextStartAt, this.now);
      this.modelClock = 0;
      this.modelDealLand.clear();
    }
    events.forEach((event, index) => {
      if (this.hudHp === undefined && (event.type === 'DamageTaken' || event.type === 'PotionUsed')) {
        this.hudHp = event.hpBefore;
      }
      const spec = this.buildStep(event);
      this.modelClock += spec.gap;
      const step: Step = { ...spec, event, index, start: 0, begun: false, cued: false, from: new Map() };
      const hidden = new Set(spec.hidden ?? []);
      for (const id of spec.cards) this.lock(id, hidden.has(id));
      this.queue.push(step);
      this.cueOrder.push(step);
    });
  }

  update(dtMs: number, layout: LayoutSnapshot): void {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    this.layout = layout;
    this.resolvePoses();
    if (this.reduced) {
      this.flush();
      this.now += dt;
    } else {
      this.advance(dt);
    }
    if (!this.isBusy()) {
      this.hudHp = undefined;
      this.hudScore = undefined;
    }
    this.updateEffects(dt);
    this.updateHover(dt);
    this.refreshSettled();
    this.current = this.buildFrame();
  }

  frame(): FxFrame {
    return this.current;
  }

  isBusy(): boolean {
    return this.queue.length > 0 || this.active.length > 0;
  }

  skip(): void {
    this.resolvePoses();
    this.flush();
    this.trauma = 0;
    this.flash = null;
    this.crt = 0;
    this.popups = [];
    this.hudHp = undefined;
    this.hudScore = undefined;
    this.current = this.layout ? this.buildFrame() : { ...EMPTY_FRAME, cards: this.lockedCards() };
  }

  onCue(listener: (cue: FxCue) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    if (on) {
      this.trauma = 0;
      this.flash = null;
      this.crt = 0;
    }
  }

  setHover(cardId: CardId | null): void {
    this.hoverTarget = cardId;
  }

  // ---------------------------------------------------------------- scheduling

  private advance(dt: number): void {
    const target = this.now + dt;
    for (let guard = 0; guard < 100000; guard++) {
      this.process();
      const next = this.nextMilestone();
      if (next === undefined || next > target) break;
      this.now = next;
    }
    this.now = target;
    this.process();
    for (const s of this.active) this.applyStep(s, this.now);
  }

  /** Fire due cues, finish ended steps, start due steps; repeat until stable at `now`. */
  private process(): void {
    for (let guard = 0; guard < 10000; guard++) {
      let changed = this.fireDueCues();
      for (const s of this.active.slice()) {
        if (s.cued && this.now >= s.start + s.duration) {
          this.finish(s);
          changed = true;
        }
      }
      while (this.queue.length > 0 && this.nextStartAt <= this.now) {
        const s = this.queue.shift()!;
        this.begin(s, this.nextStartAt);
        this.nextStartAt = s.start + s.gap;
        changed = true;
      }
      if (!changed) return;
    }
  }

  private nextMilestone(): number | undefined {
    let best: number | undefined;
    const consider = (v: number): void => {
      if (v > this.now && (best === undefined || v < best)) best = v;
    };
    if (this.queue.length > 0) consider(this.nextStartAt);
    const head = this.cueOrder[0];
    if (head && head.begun) consider(head.start + head.cueAt);
    for (const s of this.active) consider(s.start + s.duration);
    return best;
  }

  private fireDueCues(): boolean {
    let fired = false;
    while (this.cueOrder.length > 0) {
      const head = this.cueOrder[0]!;
      if (!head.begun || this.now < head.start + head.cueAt) break;
      this.cueOrder.shift();
      this.fireCue(head);
      fired = true;
    }
    return fired;
  }

  private fireCue(s: Step): void {
    if (s.cued) return;
    s.cued = true;
    s.impact?.();
    const cue: FxCue = { event: s.event, index: s.index };
    for (const l of [...this.listeners]) {
      try {
        l(cue);
      } catch {
        // A failing listener (e.g. audio) must never break animation.
      }
    }
  }

  private begin(s: Step, at: number): void {
    s.start = at;
    s.begun = true;
    for (const id of s.cards) {
      const prev = this.owner.get(id);
      if (prev && prev !== s) this.applyStepCard(prev, id, this.now);
      const p = this.poses.get(id);
      s.from.set(id, p ? copyPose(p) : restAt(this.fallbackPos(id)));
      this.owner.set(id, s);
    }
    s.begin?.();
    this.active.push(s);
  }

  private finish(s: Step): void {
    this.applyStep(s, s.start + s.duration);
    s.end?.();
    const i = this.active.indexOf(s);
    if (i >= 0) this.active.splice(i, 1);
    for (const id of s.cards) {
      if (this.owner.get(id) === s) this.owner.delete(id);
      this.unlock(id);
    }
  }

  /** Run every remaining step to completion right now, in order, emitting every cue. */
  private flush(): void {
    const steps = [...this.active, ...this.queue];
    this.queue.length = 0;
    for (const s of steps) {
      if (!s.begun) this.begin(s, this.now);
      while (this.cueOrder.length > 0) {
        const head = this.cueOrder[0]!;
        if (!head.begun) break;
        this.cueOrder.shift();
        this.fireCue(head);
        if (head === s) break;
      }
      this.fireCue(s);
      this.finish(s);
    }
    this.nextStartAt = this.now;
  }

  private applyStep(s: Step, at: number): void {
    const t = Math.min(Math.max(at - s.start, 0), s.duration);
    s.tick?.(t);
    s.cards.forEach((id) => this.applyStepCardAt(s, id, t));
  }

  private applyStepCard(s: Step, id: CardId, at: number): void {
    this.applyStepCardAt(s, id, Math.min(Math.max(at - s.start, 0), s.duration));
  }

  private applyStepCardAt(s: Step, id: CardId, t: number): void {
    if (!s.pose || this.owner.get(id) !== s) return;
    const from = s.from.get(id);
    if (!from) return;
    this.poses.set(id, s.pose({ id, i: s.cards.indexOf(id), t, from }));
  }

  // ---------------------------------------------------------------- card locking

  private lock(id: CardId, hidden: boolean): void {
    const n = this.refs.get(id) ?? 0;
    this.refs.set(id, n + 1);
    if (n === 0) {
      this.poses.set(id, null);
      if (hidden) this.hiddenInit.add(id);
      else this.hiddenInit.delete(id);
    }
  }

  private unlock(id: CardId): void {
    const n = (this.refs.get(id) ?? 1) - 1;
    if (n > 0) {
      this.refs.set(id, n);
      return;
    }
    this.refs.delete(id);
    this.poses.delete(id);
    this.hiddenInit.delete(id);
    const home = this.layout?.cards.get(id);
    if (home) this.settled.set(id, home);
    else this.settled.delete(id);
  }

  private resolvePoses(): void {
    if (!this.layout) return;
    for (const [id, p] of this.poses) {
      if (p) continue;
      if (this.hiddenInit.has(id)) {
        const d = this.deckRect();
        this.poses.set(id, { ...restAt(d, 5), faceUp: 0, opacity: 0 });
      } else {
        this.poses.set(id, restAt(this.fallbackPos(id)));
      }
    }
  }

  private fallbackPos(id: CardId): Rect {
    return this.settled.get(id) ?? this.layout?.cards.get(id) ?? this.deckRect();
  }

  private refreshSettled(): void {
    if (!this.layout) return;
    for (const [id, r] of this.layout.cards) if (!this.refs.has(id)) this.settled.set(id, r);
  }

  private lockedCards(): Map<CardId, CardTransform> {
    const m = new Map<CardId, CardTransform>();
    for (const [id, p] of this.poses) if (p) m.set(id, { ...p });
    return m;
  }

  // ---------------------------------------------------------------- layout helpers

  private deckRect(): Rect {
    return this.layout?.deck ?? ZERO_RECT;
  }
  private discardRect(): Rect {
    return this.layout?.discard ?? this.deckRect();
  }
  private weaponRect(): Rect {
    return this.layout?.weapon ?? this.deckRect();
  }
  private home(id: CardId): Rect | undefined {
    return this.layout?.cards.get(id);
  }
  private cardSize(): { w: number; h: number } {
    const d = this.deckRect();
    return { w: d.w, h: d.h };
  }
  /** Top-left a card must have for its centre to sit on point (px, py). */
  private topLeftFor(px: number, py: number): { x: number; y: number } {
    const { w, h } = this.cardSize();
    return { x: px - w / 2, y: py - h / 2 };
  }
  private hpPoint(): { x: number; y: number } {
    const r = this.layout?.hpMeter ?? ZERO_RECT;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  private screenCenter(): { x: number; y: number } {
    const l = this.layout;
    if (!l) return { x: 0, y: 0 };
    const rects: Rect[] = [l.deck, l.discard, l.weapon, l.hpMeter, ...l.cards.values()];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  private cardCenter(p: { x: number; y: number }): { x: number; y: number } {
    const { w, h } = this.cardSize();
    return { x: p.x + w / 2, y: p.y + h / 2 };
  }

  // ---------------------------------------------------------------- effects

  private addTrauma(a: number): void {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + a);
  }
  private screenFlash(color: string, alpha: number, life: number): void {
    if (this.reduced) return;
    this.flash = { color, alpha, age: 0, life };
  }
  private pulse(a: number): void {
    if (this.reduced) return;
    this.crt = Math.min(1, Math.max(this.crt, a));
  }
  private popup(text: string, at: { x: number; y: number }, color: string, life = 900): void {
    this.popups.push({ text, x: at.x, y: at.y, color, life, rise: this.reduced ? 0 : 16, age: 0 });
  }

  private updateEffects(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt / 650);
    this.crt = Math.max(0, this.crt - dt / 700);
    if (this.flash) {
      this.flash.age += dt;
      if (this.flash.age >= this.flash.life) this.flash = null;
    }
    for (const p of this.popups) p.age += dt;
    this.popups = this.popups.filter((p) => p.age < p.life);
  }

  private updateHover(dt: number): void {
    const k = approach(dt, 45);
    if (this.hoverTarget !== null && !this.hoverAmt.has(this.hoverTarget)) this.hoverAmt.set(this.hoverTarget, 0);
    for (const [id, v] of this.hoverAmt) {
      const target = id === this.hoverTarget ? 1 : 0;
      const nv = v + (target - v) * k;
      if (target === 0 && nv < 0.002) this.hoverAmt.delete(id);
      else this.hoverAmt.set(id, nv);
    }
  }

  private buildFrame(): FxFrame {
    const t = this.now;
    const cards = new Map<CardId, CardTransform>();
    for (const [id, p] of this.poses) if (p) cards.set(id, { ...p });

    const layout = this.layout;
    if (layout) {
      for (const [id, r] of layout.cards) {
        if (this.poses.has(id)) continue;
        const per = this.persist.get(id);
        const hov = this.hoverAmt.get(id) ?? 0;
        const bob = !this.reduced && this.roomPresent.has(id);
        if (!per && hov === 0 && !bob) continue;
        const phase = hashId(id) * Math.PI * 2;
        let y = r.y + (per?.dy ?? 0);
        let rotation = per?.rotation ?? 0;
        let scale = 1;
        if (bob) {
          y += Math.sin(t / 650 + phase) * 1.2 * (1 - hov);
          rotation += Math.sin(t / 900 + phase * 1.7) * 0.012 * (1 - hov);
        }
        if (hov > 0) {
          y -= 4 * hov;
          scale += 0.07 * hov;
          if (!this.reduced) rotation += Math.sin(t / 170 + phase) * 0.035 * hov;
        }
        cards.set(id, {
          x: r.x,
          y,
          scale,
          rotation,
          faceUp: 1,
          opacity: per?.opacity ?? 1,
          flash: 0,
          z: hov > 0.01 ? 30 : 0,
        });
      }
    }

    let shake = { x: 0, y: 0 };
    if (this.trauma > 0) {
      const m = this.trauma * this.trauma * 7;
      shake = {
        x: m * ((Math.sin(t * 0.071) + Math.sin(t * 0.137 + 1.3) * 0.5) / 1.5),
        y: m * ((Math.sin(t * 0.083 + 2.1) + Math.sin(t * 0.151 + 0.4) * 0.5) / 1.5),
      };
    }
    const f = this.flash;
    const screenFlash = f ? { color: f.color, alpha: f.alpha * (1 - f.age / f.life) ** 2 } : null;
    const hud: { hp?: number; score?: number } = {};
    if (this.hudHp !== undefined) hud.hp = Math.round(this.hudHp);
    if (this.hudScore !== undefined) hud.score = Math.round(this.hudScore);
    const popups = this.popups.map((p) => {
      const u = p.age / p.life;
      return {
        text: p.text,
        x: p.x,
        y: p.y - p.rise * cubicOut(u),
        alpha: u < 0.6 ? Math.min(1, p.age / 50) : 1 - (u - 0.6) / 0.4,
        color: p.color,
      };
    });
    return { cards, shake, screenFlash, hud, popups, crtPulse: this.crt };
  }

  // ---------------------------------------------------------------- event -> step

  private buildStep(e: GameEvent): StepSpec {
    switch (e.type) {
      case 'GameStarted':
        this.modelRoom.clear();
        this.modelPendingReveal = [];
        this.modelWeapon = [];
        return {
          ...FX_TIMING.start,
          cards: [],
          begin: () => {
            this.roomPresent.clear();
            this.persist.clear();
          },
          impact: () => this.pulse(0.3),
        };

      case 'CardDealt':
        return this.dealStep(e.card, e.slot);

      case 'RoomRevealed': {
        const ids = this.modelPendingReveal;
        this.modelPendingReveal = [];
        const { perCard, stagger, cueAt } = FX_TIMING.flip;
        const dealDur = FX_TIMING.deal.duration;
        // The reveal starts while later deals are still flying (deal gap < deal duration). Each card keeps
        // following its deal trajectory until it lands (`land` ms into this step), and its flip starts only
        // after that, so no card ever holds still mid-air.
        const revealAt = this.modelClock;
        const dealt = ids.map((id) => this.modelDealLand.get(id));
        const land = dealt.map((d) => (d ? Math.max(0, d.land - revealAt) : 0));
        const flipAt = ids.map((_, i) => Math.max(i * stagger, land[i]!));
        const duration = ids.length === 0 ? 0 : Math.max(...flipAt.map((f) => f + perCard));
        return {
          cards: ids,
          duration,
          cueAt: Math.min(cueAt, duration),
          gap: duration,
          impact: () => this.pulse(0.08),
          pose: ({ id, i, t, from }) => {
            const l = land[i] ?? 0;
            const slot = dealt[i]?.slot ?? 0;
            if (l > 0 && t < l) return this.dealPose(id, slot, dealDur - l + t);
            const base = l > 0 ? this.dealPose(id, slot, dealDur) : from;
            const u = window01(t, flipAt[i] ?? 0, perCard);
            const h = this.home(id) ?? base;
            const m = cubicOut(u);
            return {
              x: lerp(base.x, h.x, m),
              y: lerp(base.y, h.y, m) - 4 * hump(u),
              scale: 1 + 0.06 * hump(u),
              rotation: base.rotation * (1 - m),
              faceUp: sineInOut(u),
              opacity: 1,
              flash: 0.35 * hump(u),
              z: 40,
            };
          },
        };
      }

      case 'RoomEntered':
        return {
          ...FX_TIMING.enter,
          cards: [...this.modelRoom],
          impact: () => this.pulse(0.05),
          pose: ({ id, t, from }) => {
            const h = this.home(id) ?? from;
            const u = t / FX_TIMING.enter.duration;
            return { ...restAt(h, 20), y: h.y - 3 * hump(u), faceUp: from.faceUp };
          },
        };

      case 'RoomAvoided': {
        const ids = e.cards.map((c) => c.id);
        for (const id of ids) {
          this.modelRoom.delete(id);
          this.modelPendingReveal = this.modelPendingReveal.filter((x) => x !== id);
        }
        const { perCard, stagger, cueAt } = FX_TIMING.avoid;
        const duration = perCard + stagger * Math.max(0, ids.length - 1);
        return {
          cards: ids,
          duration,
          cueAt,
          gap: duration,
          begin: () => ids.forEach((id) => this.roomPresent.delete(id)),
          impact: () => {
            this.pulse(0.12);
            this.addTrauma(0.1);
          },
          pose: ({ i, t, from }) => {
            const u = window01(t, i * stagger, perCard);
            const d = this.deckRect();
            const m = cubicIn(u);
            const dir = i % 2 === 0 ? 1 : -1;
            return {
              x: lerp(from.x, d.x, m),
              y: lerp(from.y, d.y, m) - 8 * hump(window01(u, 0, 0.35)),
              scale: lerp(1, 0.92, u),
              rotation: from.rotation + dir * 0.5 * hump(u),
              faceUp: 1 - cubicInOut(window01(u, 0, 0.45)),
              opacity: 1 - window01(u, 0.85, 0.15),
              flash: 0,
              z: 70 - i,
            };
          },
        };
      }

      case 'MonsterFought':
        return this.fightStep(e.monster, e.weapon, e.damage);

      case 'DamageTaken': {
        const { hpTween } = FX_TIMING.damage;
        const big = e.amount >= 8;
        return {
          ...FX_TIMING.damage,
          cards: [],
          impact: () => {
            this.addTrauma(Math.min(1, 0.3 + e.amount / 14));
            this.screenFlash(FX_COLORS.damage, Math.min(0.6, 0.3 + e.amount * 0.02), big ? 420 : 300);
            this.pulse(Math.min(1, 0.2 + e.amount / 25));
            const hp = this.hpPoint();
            this.popup(`-${e.amount}`, { x: hp.x, y: hp.y - 6 }, FX_COLORS.damage, big ? 1100 : 900);
          },
          tick: (t) => {
            this.hudHp = lerp(e.hpBefore, e.hpAfter, cubicOut(window01(t, 0, hpTween)));
          },
        };
      }

      case 'MonsterSlain':
        this.modelRoom.delete(e.monster.id);
        if (e.byWeapon) this.modelWeapon = [...this.modelWeapon, e.monster.id];
        return this.slainStep(e.monster, e.byWeapon);

      case 'WeaponEquipped':
        this.modelRoom.delete(e.weapon.id);
        this.modelWeapon = [e.weapon.id];
        return this.equipStep(e.weapon, e.replaced, e.discarded);

      case 'PotionUsed': {
        this.modelRoom.delete(e.potion.id);
        const { duration, cueAt, hpTween } = FX_TIMING.potion;
        return {
          ...FX_TIMING.potion,
          cards: [e.potion.id],
          begin: () => this.roomPresent.delete(e.potion.id),
          impact: () => {
            this.screenFlash(FX_COLORS.heal, 0.22, 380);
            this.pulse(0.15);
            const hp = this.hpPoint();
            this.popup(e.healed > 0 ? `+${e.healed}` : 'FULL', { x: hp.x, y: hp.y - 6 }, FX_COLORS.heal);
          },
          tick: (t) => {
            this.hudHp = lerp(e.hpBefore, e.hpAfter, cubicOut(window01(t, cueAt, hpTween)));
          },
          pose: ({ t, from }) => {
            const rise = cubicOut(window01(t, 0, cueAt));
            const d = window01(t, cueAt, duration - cueAt);
            const lifted = { x: from.x, y: from.y - 10 * rise };
            const hp = this.hpPoint();
            const dest = this.topLeftFor(hp.x, hp.y);
            const m = cubicIn(d);
            return {
              x: lerp(lifted.x, dest.x, m),
              y: lerp(lifted.y, dest.y, m),
              scale: lerp(1 + 0.15 * rise, 0.35, m),
              rotation: from.rotation * (1 - rise),
              faceUp: 1,
              opacity: 1 - quadIn(d),
              flash: 0.7 * hump(window01(t, 100, 320)),
              z: 85,
            };
          },
        };
      }

      case 'PotionWasted': {
        this.modelRoom.delete(e.potion.id);
        const { duration } = FX_TIMING.wasted;
        let anchor = { x: 0, y: 0 };
        return {
          ...FX_TIMING.wasted,
          cards: [e.potion.id],
          begin: () => {
            this.roomPresent.delete(e.potion.id);
            const p = this.poses.get(e.potion.id);
            anchor = this.cardCenter(p ?? this.fallbackPos(e.potion.id));
          },
          impact: () => this.popup('WASTED', { x: anchor.x, y: anchor.y - 10 }, FX_COLORS.wasted, 1000),
          pose: ({ t, from }) => {
            const j = 1 - window01(t, 0, 260);
            const d = window01(t, 200, duration - 200);
            return {
              x: from.x + Math.sin(t * 0.12) * 2.5 * j,
              y: from.y + 10 * quadIn(d),
              scale: 1 - 0.15 * d,
              rotation: from.rotation + 0.12 * d,
              faceUp: 1,
              opacity: 1 - d,
              flash: 0,
              z: 60,
            };
          },
        };
      }

      case 'RoomCleared':
        return {
          ...FX_TIMING.cleared,
          cards: e.carried ? [e.carried.id] : [],
          impact: () => this.pulse(0.1),
          pose: ({ id, t, from }) => {
            const h = this.home(id) ?? from;
            const m = cubicOut(t / FX_TIMING.cleared.duration);
            return {
              ...restAt({ x: lerp(from.x, h.x, m), y: lerp(from.y, h.y, m) }, 20),
              rotation: from.rotation * (1 - m),
            };
          },
        };

      case 'GameWon': {
        const ids = [...this.modelWeapon];
        const { cueAt } = FX_TIMING.won;
        return {
          ...FX_TIMING.won,
          cards: ids,
          begin: () => this.roomPresent.clear(),
          impact: () => {
            this.screenFlash(FX_COLORS.gold, 0.45, 600);
            this.pulse(0.7);
            this.addTrauma(0.25);
            const c = this.screenCenter();
            this.popup('VICTORY', { x: c.x, y: c.y - 20 }, FX_COLORS.gold, 1500);
            if (e.potionBonus > 0) this.popup(`+${e.potionBonus} BONUS`, { x: c.x, y: c.y }, FX_COLORS.heal, 1500);
          },
          tick: (t) => {
            this.hudScore = e.score * cubicOut(window01(t, cueAt + 150, 1100));
          },
          pose: ({ id, i, t, from }) => {
            const h = this.home(id) ?? from;
            const u = window01(t, cueAt + i * 70, 400);
            return {
              ...restAt(h, 50 + i),
              y: h.y - 10 * hump(u),
              rotation: (i % 2 === 0 ? 0.1 : -0.1) * hump(u),
              flash: 0.5 * hump(u),
            };
          },
        };
      }

      case 'GameLost': {
        const ids = [...this.modelRoom];
        return {
          ...FX_TIMING.lost,
          cards: ids,
          begin: () => this.roomPresent.clear(),
          impact: () => {
            this.addTrauma(1);
            this.screenFlash(FX_COLORS.damage, 0.6, 700);
            this.pulse(1);
            const c = this.screenCenter();
            this.popup('YOU DIED', { x: c.x, y: c.y - 20 }, FX_COLORS.damage, 1500);
          },
          tick: (t) => {
            this.hudScore = e.score * cubicOut(window01(t, 400, 1000));
          },
          pose: ({ id, i, t, from }) => {
            const home = this.home(id);
            if (!home) {
              // No layout home (e.g. the killing monster, already discarded by the engine): it is a ghost,
              // so it goes to the discard and fades out fully before the step releases it.
              const d = this.discardRect();
              const u = window01(t, 100, 700);
              const m = cubicInOut(u);
              return {
                x: lerp(from.x, d.x, m),
                y: lerp(from.y, d.y, m) - 8 * hump(m),
                scale: lerp(from.scale, 0.9, m),
                rotation: from.rotation + 0.6 * m,
                faceUp: from.faceUp,
                opacity: from.opacity * (1 - u),
                flash: 0,
                z: 20,
              };
            }
            const h = home;
            const u = window01(t, 100 + i * 80, 900);
            const dir = i % 2 === 0 ? 1 : -1;
            return {
              ...restAt(h, 20),
              faceUp: from.faceUp,
              y: h.y + 8 * cubicOut(u),
              rotation: dir * 0.22 * backOut(u),
              opacity: lerp(1, 0.45, u),
            };
          },
          end: () => {
            // Persist only ever applies to cards in layout.cards (buildFrame), so ghosts are unaffected.
            ids.forEach((id, i) => this.persist.set(id, { dy: 8, rotation: (i % 2 === 0 ? 1 : -1) * 0.22, opacity: 0.45 }));
          },
        };
      }

      default:
        return { cards: [], duration: 0, cueAt: 0, gap: 0 };
    }
  }

  private dealStep(card: Card, slot: number): StepSpec {
    this.modelRoom.add(card.id);
    this.modelPendingReveal = [...this.modelPendingReveal.filter((x) => x !== card.id), card.id];
    this.modelDealLand.set(card.id, { land: this.modelClock + FX_TIMING.deal.duration, slot });
    return {
      ...FX_TIMING.deal,
      cards: [card.id],
      // Waits hidden on the deck until its turn; the pose always starts from the deck (avoided cards
      // re-enter through here too), never from wherever the card was last seen.
      hidden: [card.id],
      impact: () => this.pulse(0.04),
      end: () => this.roomPresent.add(card.id),
      pose: ({ t }) => this.dealPose(card.id, slot, t),
    };
  }

  /** Deal trajectory deck -> home, `t` ms into the deal. Shared by the deal step and the reveal step. */
  private dealPose(id: CardId, slot: number, t: number): Pose {
    const d = this.deckRect();
    const h = this.home(id) ?? d;
    const u = clamp01(t / FX_TIMING.deal.duration);
    const m = DEAL_EASE(u);
    return {
      x: lerp(d.x, h.x, m),
      y: lerp(d.y, h.y, m),
      scale: 1 + 0.1 * hump(u),
      rotation: (-0.35 + slot * 0.18) * (1 - cubicOut(u)),
      faceUp: 0,
      opacity: clamp01(u * 6),
      flash: 0,
      z: 60 + slot,
    };
  }

  private fightStep(monster: Card, weapon: Card | null, damage: number): StepSpec {
    const { duration, cueAt } = FX_TIMING.fight;
    const ids = weapon ? [monster.id, weapon.id] : [monster.id];
    let monsterAnchor = { x: 0, y: 0 };
    return {
      ...FX_TIMING.fight,
      cards: ids,
      begin: () => {
        const p = this.poses.get(monster.id);
        monsterAnchor = this.cardCenter(p ?? this.fallbackPos(monster.id));
      },
      impact: () => {
        this.addTrauma(weapon ? 0.22 : 0.32);
        this.pulse(0.12);
        if (damage === 0) this.popup('BLOCK', { x: monsterAnchor.x, y: monsterAnchor.y - 14 }, FX_COLORS.block);
      },
      pose: ({ id, t, from }) => {
        const windup = cubicOut(window01(t, 0, 150));
        const recoil = window01(t, cueAt, duration - cueAt);
        const recoilE = backOut(recoil);
        if (id === monster.id) {
          const target = weapon ? this.cardCenter(this.weaponRect()) : this.hpPoint();
          const c = this.cardCenter(from);
          const amt = quadIn(window01(t, 150, cueAt - 150)) * (1 - recoilE);
          const settle = 1 - cubicOut(recoil);
          return {
            x: from.x + (target.x - c.x) * 0.35 * amt,
            y: from.y + (target.y - c.y) * 0.35 * amt - 8 * windup * settle,
            scale: 1 + 0.12 * windup * settle,
            rotation: from.rotation - 0.08 * windup * settle,
            faceUp: 1,
            opacity: 1,
            flash: t >= cueAt ? 1 - window01(t, cueAt, 180) : 0,
            z: 80,
          };
        }
        // Weapon jabs toward the monster, landing on the impact frame.
        const h = this.home(id) ?? from;
        const mc = monsterAnchor;
        const wc = this.cardCenter(h);
        const amt = quadIn(window01(t, cueAt - 80, 80)) * (1 - cubicOut(recoil));
        return {
          ...restAt(h, 79),
          x: h.x + (mc.x - wc.x) * 0.25 * amt,
          y: h.y + (mc.y - wc.y) * 0.25 * amt,
          rotation: 0.18 * amt,
          scale: 1 + 0.06 * amt,
        };
      },
    };
  }

  private slainStep(monster: Card, byWeapon: Card | null): StepSpec {
    const { duration } = FX_TIMING.slain;
    const ids = byWeapon ? [monster.id, byWeapon.id] : [monster.id];
    return {
      ...FX_TIMING.slain,
      cards: ids,
      begin: () => this.roomPresent.delete(monster.id),
      impact: () => this.pulse(0.15),
      pose: ({ id, t, from }) => {
        if (id === monster.id) {
          const pop = hump(window01(t, 0, 140));
          const m = cubicInOut(window01(t, 60, duration - 60));
          if (byWeapon) {
            const w = this.weaponRect();
            const to = this.home(id) ?? { x: w.x + 4, y: w.y + 10 };
            return {
              x: lerp(from.x, to.x, m),
              y: lerp(from.y, to.y, m) - 6 * hump(m),
              scale: 1 + 0.18 * pop,
              rotation: lerp(from.rotation, 0, m) + 0.2 * hump(m),
              faceUp: 1,
              opacity: 1,
              flash: 0.8 * pop,
              z: 75,
            };
          }
          const to = this.discardRect();
          return {
            x: lerp(from.x, to.x, m),
            y: lerp(from.y, to.y, m) - 10 * hump(m),
            scale: 1 + 0.18 * pop - 0.1 * m,
            rotation: from.rotation + 0.9 * m,
            faceUp: 1,
            opacity: 1 - window01(t, duration - 120, 120),
            flash: 0.8 * pop,
            z: 75,
          };
        }
        // Weapon gets a small punch when the monster lands on its stack.
        const h = this.home(id) ?? from;
        const m = cubicOut(window01(t, 0, 200));
        return {
          ...restAt({ x: lerp(from.x, h.x, m), y: lerp(from.y, h.y, m) }, 70),
          rotation: from.rotation * (1 - m),
          scale: 1 + 0.08 * hump(window01(t, duration - 100, 100)),
        };
      },
    };
  }

  private equipStep(weapon: Card, replaced: Card | null, discarded: readonly Card[]): StepSpec {
    const { cueAt, duration } = FX_TIMING.equip;
    // The engine's `discarded` already contains the replaced weapon; dedupe so no card is listed twice.
    const old = [...new Set([...(replaced ? [replaced.id] : []), ...discarded.map((c) => c.id)])].filter(
      (id) => id !== weapon.id,
    );
    for (const id of old) {
      this.modelRoom.delete(id);
    }
    // Compress the stagger so the last exit still ends (opacity 0) within the step.
    const exitStagger = old.length > 1 ? Math.min(EQUIP_EXIT_STAGGER, (duration - EQUIP_EXIT_TAIL - EQUIP_EXIT) / (old.length - 1)) : 0;
    const snap = backOutBy(2.2);
    return {
      ...FX_TIMING.equip,
      cards: [weapon.id, ...old],
      begin: () => this.roomPresent.delete(weapon.id),
      impact: () => {
        this.addTrauma(0.15);
        this.pulse(0.15);
      },
      pose: ({ id, i, t, from }) => {
        if (id === weapon.id) {
          const h = this.home(id) ?? this.weaponRect();
          const lift = cubicOut(window01(t, 0, 90));
          const m = snap(window01(t, 90, cueAt - 90));
          const land = window01(t, cueAt, 140);
          const landed = t >= cueAt ? 1 - land : 0;
          return {
            x: lerp(from.x, h.x, m),
            y: lerp(from.y - 10 * lift, h.y, m),
            scale: 1 + 0.12 * lift * (1 - m) + 0.1 * landed,
            rotation: lerp(from.rotation + 0.15 * lift, 0, m),
            faceUp: 1,
            opacity: 1,
            flash: landed,
            z: 85,
          };
        }
        const u = window01(t, (i - 1) * exitStagger, EQUIP_EXIT);
        const d = this.discardRect();
        const m = cubicIn(u);
        return {
          x: lerp(from.x, d.x, m),
          y: lerp(from.y, d.y, m),
          scale: 1 - 0.1 * u,
          rotation: from.rotation + 0.5 * u,
          faceUp: 1,
          opacity: 1 - window01(u, 0.6, 0.4),
          flash: 0,
          z: 50 - i,
        };
      },
    };
  }
}

export function createFxDirectorImpl(): Director {
  return new Director();
}
