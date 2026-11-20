/**
 * Design Review 2: FxDirector.tutorialCue drives FxFrame.coach only. It never queues, never makes isBusy()
 * true and never moves game-event cues or card frames.
 */
import { describe, expect, it } from 'vitest';
import type { Card, GameEvent } from '../game';
import type { LayoutSnapshot, Rect } from '../ui/view';
import { createFxDirector, type FxDirector, type TutorialFxCue } from './types';
import { COACH_STATIC } from './coach';

const card = (id: string): Card => {
  const suit = ({ S: 'spades', C: 'clubs', D: 'diamonds', H: 'hearts' } as const)[id[0] as 'S' | 'C' | 'D' | 'H'];
  return { id, suit, rank: Number(id.slice(1)) as Card['rank'] };
};
const rect = (x: number, y: number): Rect => ({ x, y, w: 40, h: 56 });
const layout: LayoutSnapshot = {
  cards: new Map(Object.entries({ S10: rect(120, 60), H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) })),
  deck: rect(10, 10),
  discard: rect(420, 10),
  weapon: rect(100, 180),
  hpMeter: { x: 10, y: 240, w: 80, h: 12 },
  buttons: new Map(),
  orientation: 'landscape',
};
const dealBatch: GameEvent[] = [
  { type: 'GameStarted', seed: 1, hp: 20, deckSize: 44 },
  ...['S10', 'H5', 'D7', 'C3'].map(
    (id, slot): GameEvent => ({ type: 'CardDealt', card: card(id), slot, deckRemaining: 43 - slot }),
  ),
  { type: 'RoomRevealed', roomNumber: 1, canAvoid: true },
];
const cues: TutorialFxCue[] = ['coachShown', 'nudged', 'stepSucceeded', 'completed'];

/** Runs a deal batch; optionally spams tutorial cues every few frames. Returns per-frame cue log and card frames. */
function trace(fx: FxDirector, withTutorial: boolean) {
  const cueFrames: [number, number][] = [];
  let frameNo = 0;
  fx.onCue((c) => cueFrames.push([frameNo, c.index]));
  fx.enqueue(dealBatch);
  const cards: unknown[] = [];
  const busy: boolean[] = [];
  for (frameNo = 0; frameNo < 200; frameNo++) {
    if (withTutorial && frameNo % 3 === 0) fx.tutorialCue!(cues[frameNo % cues.length]!);
    fx.update(16, layout);
    const f = fx.frame();
    cards.push([...f.cards.entries()]);
    busy.push(fx.isBusy());
  }
  return { cueFrames, cards, busy };
}

describe('FxDirector.tutorialCue', () => {
  it('never makes an idle director busy', () => {
    const fx = createFxDirector();
    for (const c of cues) {
      fx.tutorialCue!(c);
      expect(fx.isBusy()).toBe(false);
      fx.update(16, layout);
      expect(fx.isBusy()).toBe(false);
    }
  });

  it('does not change busy duration, cue timing or card frames of a game batch', () => {
    const plain = trace(createFxDirector(), false);
    const tut = trace(createFxDirector(), true);
    expect(tut.cueFrames).toEqual(plain.cueFrames);
    expect(tut.busy).toEqual(plain.busy);
    expect(tut.cards).toEqual(plain.cards);
    expect(plain.busy.at(-1)).toBe(false);
  });

  it('emits no FxCue of its own', () => {
    const fx = createFxDirector();
    let n = 0;
    fx.onCue(() => n++);
    for (const c of cues) fx.tutorialCue!(c);
    fx.update(1000, layout);
    expect(n).toBe(0);
  });

  it('leaves FxFrame.coach absent until a tutorial cue arrives', () => {
    const fx = createFxDirector();
    fx.update(16, layout);
    expect(fx.frame().coach).toBeUndefined();
    fx.tutorialCue!('coachShown');
    expect(fx.frame().coach?.panelBump).toBe(1);
    fx.update(16, layout);
    const c = fx.frame().coach!;
    expect(c.panelBump).toBeGreaterThan(0);
    expect(c.panelBump).toBeLessThan(1);
  });

  it('is deterministic across directors', () => {
    const a = createFxDirector();
    const b = createFxDirector();
    const seq = (fx: FxDirector) => {
      const out = [];
      for (let i = 0; i < 60; i++) {
        if (i % 7 === 0) fx.tutorialCue!(cues[i % cues.length]!);
        fx.update(9 + (i % 4), layout);
        out.push(fx.frame().coach);
      }
      return out;
    };
    expect(seq(a)).toEqual(seq(b));
  });

  it('keeps animating the coach while idle (no game batch needed)', () => {
    const fx = createFxDirector();
    fx.tutorialCue!('coachShown');
    const bobs = new Set<number>();
    for (let i = 0; i < 40; i++) {
      fx.update(16, layout);
      bobs.add(fx.frame().coach!.arrowBob);
    }
    expect(bobs.size).toBeGreaterThan(10);
    expect(fx.isBusy()).toBe(false);
  });

  it('reduced motion: coach is the static ring, while game cues still fire', () => {
    const fx = createFxDirector();
    fx.setReducedMotion(true);
    let n = 0;
    fx.onCue(() => n++);
    fx.enqueue(dealBatch);
    for (const c of cues) {
      fx.tutorialCue!(c);
      expect(fx.frame().coach).toEqual(COACH_STATIC);
      fx.update(16, layout);
      expect(fx.frame().coach).toEqual(COACH_STATIC);
    }
    expect(n).toBe(dealBatch.length);
    expect(fx.isBusy()).toBe(false);
  });

  it('skip() does not cancel coach animation or make it busy', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    fx.update(16, layout);
    fx.tutorialCue!('stepSucceeded');
    fx.skip();
    expect(fx.isBusy()).toBe(false);
    expect(fx.frame().coach?.success).toBe(1);
  });
});
