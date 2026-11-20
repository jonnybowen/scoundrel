import { describe, expect, it } from 'vitest';
import type { Card, GameEvent } from '../game';
import type { LayoutSnapshot, Rect } from '../ui/view';
import { createFxDirector, type FxCue } from './types';
import { FX_TIMING } from './director';

const card = (id: string): Card => {
  const suit = ({ S: 'spades', C: 'clubs', D: 'diamonds', H: 'hearts' } as const)[id[0] as 'S' | 'C' | 'D' | 'H'];
  return { id, suit, rank: Number(id.slice(1)) as Card['rank'] };
};

const rect = (x: number, y: number): Rect => ({ x, y, w: 40, h: 56 });

function layoutWith(cards: Record<string, Rect>): LayoutSnapshot {
  return {
    cards: new Map(Object.entries(cards)),
    deck: rect(10, 10),
    discard: rect(420, 10),
    weapon: rect(100, 180),
    hpMeter: { x: 10, y: 240, w: 80, h: 12 },
    buttons: new Map(),
    orientation: 'landscape',
  };
}

const room = ['S10', 'H5', 'D7', 'C3'];
const roomLayout = layoutWith({ S10: rect(120, 60), H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) });

const dealBatch: GameEvent[] = [
  { type: 'GameStarted', seed: 1, hp: 20, deckSize: 44 },
  ...room.map((id, slot): GameEvent => ({ type: 'CardDealt', card: card(id), slot, deckRemaining: 43 - slot })),
  { type: 'RoomRevealed', roomNumber: 1, canAvoid: true },
];

function collect(fx: ReturnType<typeof createFxDirector>): { cues: FxCue[]; times: number[] } {
  const cues: FxCue[] = [];
  const times: number[] = [];
  fx.onCue((c) => cues.push(c));
  return { cues, times };
}

function run(fx: ReturnType<typeof createFxDirector>, ms: number, layout: LayoutSnapshot, step = 16): void {
  for (let t = 0; t < ms; t += step) fx.update(Math.min(step, ms - t), layout);
}

describe('FxDirector', () => {
  it('is idle with an empty frame before anything is queued', () => {
    const fx = createFxDirector();
    fx.update(16, roomLayout);
    expect(fx.isBusy()).toBe(false);
    expect(fx.frame().screenFlash).toBeNull();
    expect(fx.frame().popups).toHaveLength(0);
  });

  it('emits every cue exactly once and in event order, then goes idle', () => {
    const fx = createFxDirector();
    const { cues } = collect(fx);
    fx.enqueue(dealBatch);
    expect(fx.isBusy()).toBe(true);
    expect(cues).toHaveLength(0); // nothing lands at dispatch time
    run(fx, 5000, roomLayout);
    expect(cues.map((c) => c.index)).toEqual(dealBatch.map((_, i) => i));
    expect(cues.map((c) => c.event.type)).toEqual(dealBatch.map((e) => e.type));
    expect(fx.isBusy()).toBe(false);
  });

  it('is deterministic and frame-rate independent for cue order and completion', () => {
    const a = createFxDirector();
    const b = createFxDirector();
    const ca = collect(a).cues;
    const cb = collect(b).cues;
    a.enqueue(dealBatch);
    b.enqueue(dealBatch);
    run(a, 3000, roomLayout, 16);
    run(b, 3000, roomLayout, 250); // huge frames still play every step in order
    expect(cb.map((c) => c.index)).toEqual(ca.map((c) => c.index));
    expect(a.isBusy()).toBe(false);
    expect(b.isBusy()).toBe(false);
  });

  it('fires the first deal cue at its landing time, not before', () => {
    const fx = createFxDirector();
    const { cues } = collect(fx);
    fx.enqueue(dealBatch);
    const firstDealAt = FX_TIMING.start.gap + FX_TIMING.deal.cueAt;
    fx.update(firstDealAt - 1, roomLayout);
    expect(cues.filter((c) => c.event.type === 'CardDealt')).toHaveLength(0);
    fx.update(1, roomLayout);
    expect(cues.filter((c) => c.event.type === 'CardDealt')).toHaveLength(1);
  });

  it('hides not-yet-dealt cards so the screen never shows the future', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    fx.update(1, roomLayout);
    for (const id of room) {
      const t = fx.frame().cards.get(id);
      expect(t, id).toBeDefined();
      expect(t!.opacity).toBe(0);
      expect(t!.faceUp).toBe(0);
    }
  });

  it('ends with dealt cards face-up at their layout home', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    run(fx, 4000, roomLayout);
    for (const id of room) {
      const t = fx.frame().cards.get(id);
      // Either released (renders at home) or idle-bobbing within ~1px of home, face up.
      if (t) {
        expect(t.faceUp).toBe(1);
        expect(t.x).toBeCloseTo(roomLayout.cards.get(id)!.x, 5);
        expect(Math.abs(t.y - roomLayout.cards.get(id)!.y)).toBeLessThan(1.5);
      }
    }
  });

  it('skip() snaps to the end state and flushes all cues synchronously', () => {
    const fx = createFxDirector();
    const { cues } = collect(fx);
    fx.enqueue(dealBatch);
    fx.update(16, roomLayout);
    fx.skip();
    expect(cues.map((c) => c.index)).toEqual(dealBatch.map((_, i) => i));
    expect(fx.isBusy()).toBe(false);
    expect(fx.frame().popups).toHaveLength(0);
    expect(fx.frame().shake).toEqual({ x: 0, y: 0 });
  });

  it('reduced motion completes on the next update, still emitting every cue, with no shake or flash', () => {
    const fx = createFxDirector();
    const { cues } = collect(fx);
    fx.setReducedMotion(true);
    fx.update(16, roomLayout);
    fx.enqueue([
      { type: 'MonsterFought', monster: card('S10'), mode: 'barehanded', weapon: null, damage: 10 },
      { type: 'DamageTaken', amount: 10, hpBefore: 20, hpAfter: 10, source: card('S10') },
      { type: 'MonsterSlain', monster: card('S10'), byWeapon: null },
    ]);
    fx.update(16, layoutWith({ H5: rect(170, 60) }));
    expect(cues.map((c) => c.event.type)).toEqual(['MonsterFought', 'DamageTaken', 'MonsterSlain']);
    expect(fx.isBusy()).toBe(false);
    expect(fx.frame().shake).toEqual({ x: 0, y: 0 });
    expect(fx.frame().screenFlash).toBeNull();
    expect(fx.frame().crtPulse).toBe(0);
    expect(fx.frame().popups.map((p) => p.text)).toContain('-10');
  });

  it('holds HUD hp at hpBefore until damage lands, then tweens to hpAfter and releases', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    run(fx, 4000, roomLayout);
    const after = layoutWith({ H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) });
    fx.enqueue([
      { type: 'MonsterFought', monster: card('S10'), mode: 'barehanded', weapon: null, damage: 10 },
      { type: 'DamageTaken', amount: 10, hpBefore: 20, hpAfter: 10, source: card('S10') },
      { type: 'MonsterSlain', monster: card('S10'), byWeapon: null },
    ]);
    fx.update(16, after);
    expect(fx.frame().hud.hp).toBe(20);
    // Monster is gone from layout but still drawn where it was (a ghost) until it is slain.
    expect(fx.frame().cards.get('S10')?.opacity).toBe(1);
    run(fx, FX_TIMING.fight.gap + FX_TIMING.damage.hpTween + 20, after);
    expect(fx.frame().hud.hp).toBe(10);
    expect(fx.frame().shake.x !== 0 || fx.frame().shake.y !== 0).toBe(true);
    run(fx, 3000, after);
    expect(fx.isBusy()).toBe(false);
    expect(fx.frame().hud.hp).toBeUndefined();
    expect(fx.frame().cards.has('S10')).toBe(false);
  });

  it('a throwing cue listener does not break playback', () => {
    const fx = createFxDirector();
    fx.onCue(() => {
      throw new Error('boom');
    });
    const { cues } = collect(fx);
    fx.enqueue(dealBatch);
    run(fx, 4000, roomLayout);
    expect(cues).toHaveLength(dealBatch.length);
  });

  it('unsubscribe stops cues', () => {
    const fx = createFxDirector();
    const got: FxCue[] = [];
    const off = fx.onCue((c) => got.push(c));
    off();
    fx.enqueue(dealBatch);
    fx.skip();
    expect(got).toHaveLength(0);
  });

  it('persists the defeat pose on remaining room cards and clears it on a new game', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    fx.skip();
    fx.enqueue([{ type: 'GameLost', score: -30, remainingMonsters: [card('S10'), card('C3')] }]);
    fx.skip();
    fx.update(16, roomLayout);
    expect(fx.frame().cards.get('C3')?.opacity).toBeCloseTo(0.45);
    fx.enqueue(dealBatch);
    fx.skip();
    fx.setReducedMotion(true); // disable idle bob so released cards have no transform
    fx.update(16, roomLayout);
    expect(fx.frame().cards.has('C3')).toBe(false);
  });

  it('killing blow (Fought -> DamageTaken -> GameLost, no MonsterSlain) cues in order and releases the monster', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    fx.skip();
    const { cues } = collect(fx);
    const after = layoutWith({ H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) });
    fx.enqueue([
      { type: 'MonsterFought', monster: card('S10'), mode: 'barehanded', weapon: null, damage: 25 },
      { type: 'DamageTaken', amount: 25, hpBefore: 3, hpAfter: 0, source: card('S10') },
      { type: 'GameLost', score: -40, remainingMonsters: [card('C3')] },
    ]);
    run(fx, 4000, after);
    expect(cues.map((c) => c.event.type)).toEqual(['MonsterFought', 'DamageTaken', 'GameLost']);
    expect(fx.isBusy()).toBe(false);
    expect(fx.frame().cards.has('S10')).toBe(false);
  });
});
