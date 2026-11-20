/**
 * Frame-level invariants for the FX director (Adama review gate, 2026-11-20). These step the director frame
 * by frame and check what is actually drawn, not just cue order and end state.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardId, GameEvent } from '../game';
import type { LayoutSnapshot, Rect } from '../ui/view';
import { createFxDirector, type FxDirector } from './types';
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
const deal = (ids: readonly string[]): GameEvent[] => [
  ...ids.map((id, slot): GameEvent => ({ type: 'CardDealt', card: card(id), slot, deckRemaining: 40 - slot })),
  { type: 'RoomRevealed', roomNumber: 1, canAvoid: true },
];
const dealBatch: GameEvent[] = [{ type: 'GameStarted', seed: 1, hp: 20, deckSize: 44 }, ...deal(room)];

/**
 * Runs the director frame by frame and returns, for each ghost card (one absent from layout.cards) that was
 * released from fx.cards, the opacity it had on its last drawn frame.
 */
function ghostReleaseOpacity(fx: FxDirector, layout: LayoutSnapshot, ms: number, dt: number): Map<CardId, number> {
  const out = new Map<CardId, number>();
  let prev = new Map<CardId, number>();
  for (let t = 0; t < ms; t += dt) {
    fx.update(dt, layout);
    const cur = new Map<CardId, number>();
    for (const [id, c] of fx.frame().cards) cur.set(id, c.opacity);
    for (const [id, o] of prev) if (!cur.has(id) && !layout.cards.has(id)) out.set(id, o);
    prev = cur;
  }
  return out;
}

describe('FxDirector frames', () => {
  for (const dt of [16, 10, 7]) {
    it(`no dealt card ever holds still away from its home (dt=${dt})`, () => {
      const fx = createFxDirector();
      fx.enqueue(dealBatch);
      const last = new Map<CardId, { x: number; y: number }>();
      for (let t = 0; t < 2000; t += dt) {
        fx.update(dt, roomLayout);
        for (const id of room) {
          const c = fx.frame().cards.get(id);
          if (!c || c.opacity === 0) {
            last.delete(id);
            continue;
          }
          const h = roomLayout.cards.get(id)!;
          const p = last.get(id);
          const offHome = Math.hypot(c.x - h.x, c.y - h.y) > 0.5;
          if (p && offHome) {
            expect(Math.hypot(c.x - p.x, c.y - p.y), `${id} frozen at (${c.x.toFixed(1)},${c.y.toFixed(1)}) t=${t + dt}`).toBeGreaterThan(1e-6);
          }
          last.set(id, { x: c.x, y: c.y });
        }
      }
      expect(fx.isBusy()).toBe(false);
    });
  }

  it('each card flips only after its deal has landed, and ends face up at home', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    for (let t = 0; t < 2000; t += 4) {
      fx.update(4, roomLayout);
      for (const id of room) {
        const c = fx.frame().cards.get(id);
        if (!c || c.faceUp === 0) continue;
        const h = roomLayout.cards.get(id)!;
        // Once flipping has begun the card is already at (or within the hop of) its home.
        expect(Math.abs(c.x - h.x), id).toBeLessThan(0.5);
        expect(Math.abs(c.y - h.y), id).toBeLessThan(5);
      }
    }
    for (const id of room) {
      const c = fx.frame().cards.get(id);
      if (c) {
        expect(c.faceUp).toBe(1);
        expect(c.x).toBeCloseTo(roomLayout.cards.get(id)!.x, 5);
      }
    }
  });

  it('equip with an 8-card slain stack: every discard ghost reaches the discard and fades out fully', () => {
    const stack = ['S9', 'S8', 'S7', 'C7', 'S6', 'C6', 'S5', 'C5'];
    const before: Record<string, Rect> = { D10: rect(100, 180), D9: rect(120, 60) };
    stack.forEach((id, i) => (before[id] = rect(110 + i * 4, 186)));
    const fx = createFxDirector();
    fx.update(16, layoutWith(before));
    fx.enqueue([
      // As the engine emits it: `discarded` already includes the replaced weapon.
      { type: 'WeaponEquipped', weapon: card('D9'), replaced: card('D10'), discarded: [card('D10'), ...stack.map(card)] },
    ]);
    const after = layoutWith({ D9: rect(100, 180) });
    const released = ghostReleaseOpacity(fx, after, 1000, 1);
    expect([...released.keys()].sort()).toEqual(['D10', ...stack].sort());
    for (const [id, o] of released) expect(o, id).toBeLessThan(0.02);
    expect(fx.isBusy()).toBe(false);
  });

  it('equip with an 8-card slain stack at 60 fps: the last drawn frame of every ghost is fully faded', () => {
    const stack = ['S9', 'S8', 'S7', 'C7', 'S6', 'C6', 'S5', 'C5'];
    const before: Record<string, Rect> = { D10: rect(100, 180), D9: rect(120, 60) };
    stack.forEach((id, i) => (before[id] = rect(110 + i * 4, 186)));
    for (const dt of [16, 10]) {
      const fx = createFxDirector();
      fx.update(16, layoutWith(before));
      fx.enqueue([{ type: 'WeaponEquipped', weapon: card('D9'), replaced: card('D10'), discarded: [card('D10'), ...stack.map(card)] }]);
      const released = ghostReleaseOpacity(fx, layoutWith({ D9: rect(100, 180) }), 1000, dt);
      expect(released.size).toBe(9);
      for (const [id, o] of released) expect(o, `${id} dt=${dt}`).toBe(0);
    }
  });

  it('equip ghosts are released with the step, at its duration (exit stagger compressed)', () => {
    const stack = ['S9', 'S8', 'S7', 'C7', 'S6', 'C6', 'S5', 'C5'];
    const before: Record<string, Rect> = { D10: rect(100, 180), D9: rect(120, 60) };
    stack.forEach((id, i) => (before[id] = rect(110 + i * 4, 186)));
    const fx = createFxDirector();
    fx.update(16, layoutWith(before));
    fx.enqueue([{ type: 'WeaponEquipped', weapon: card('D9'), replaced: card('D10'), discarded: [card('D10'), ...stack.map(card)] }]);
    const after = layoutWith({ D9: rect(100, 180) });
    fx.update(FX_TIMING.equip.duration - 1, after);
    for (const id of ['D10', ...stack]) expect(fx.frame().cards.get(id)?.opacity ?? 0, id).toBeLessThan(0.02);
    fx.update(1, after);
    for (const id of ['D10', ...stack]) expect(fx.frame().cards.has(id), id).toBe(false);
  });

  it('killing blow: the monster (no layout home) fades out during GameLost instead of vanishing', () => {
    const fx = createFxDirector();
    fx.enqueue(dealBatch);
    fx.skip();
    const after = layoutWith({ H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) });
    fx.enqueue([
      { type: 'RoomEntered', roomNumber: 1 },
      { type: 'MonsterFought', monster: card('S10'), mode: 'barehanded', weapon: null, damage: 10 },
      { type: 'DamageTaken', amount: 10, hpBefore: 3, hpAfter: 0, source: card('S10') },
      { type: 'GameLost', score: -20, remainingMonsters: [card('C3')] },
    ]);
    const released = ghostReleaseOpacity(fx, after, 4000, 16);
    expect(released.has('S10')).toBe(true);
    expect(released.get('S10')!).toBeLessThan(0.02);
    // Remaining room cards keep the persisted defeat pose.
    expect(fx.frame().cards.get('C3')?.opacity).toBeCloseTo(0.45);
  });

  describe('invariant: a ghost card has opacity ~0 on its last frame before release', () => {
    const scenarios: { name: string; setup: GameEvent[]; before: LayoutSnapshot; batch: GameEvent[]; after: LayoutSnapshot }[] = [
      {
        name: 'barehanded kill',
        setup: dealBatch,
        before: roomLayout,
        batch: [
          { type: 'RoomEntered', roomNumber: 1 },
          { type: 'MonsterFought', monster: card('S10'), mode: 'barehanded', weapon: null, damage: 10 },
          { type: 'DamageTaken', amount: 10, hpBefore: 20, hpAfter: 10, source: card('S10') },
          { type: 'MonsterSlain', monster: card('S10'), byWeapon: null },
        ],
        after: layoutWith({ H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) }),
      },
      {
        name: 'killing blow',
        setup: dealBatch,
        before: roomLayout,
        batch: [
          { type: 'RoomEntered', roomNumber: 1 },
          { type: 'MonsterFought', monster: card('S10'), mode: 'barehanded', weapon: null, damage: 25 },
          { type: 'DamageTaken', amount: 25, hpBefore: 3, hpAfter: 0, source: card('S10') },
          { type: 'GameLost', score: -40, remainingMonsters: [card('C3')] },
        ],
        after: layoutWith({ H5: rect(170, 60), D7: rect(220, 60), C3: rect(270, 60) }),
      },
      {
        name: 'potion used (full HP heals 0)',
        setup: dealBatch,
        before: roomLayout,
        batch: [
          { type: 'RoomEntered', roomNumber: 1 },
          { type: 'PotionUsed', potion: card('H5'), healed: 0, hpBefore: 20, hpAfter: 20 },
        ],
        after: layoutWith({ S10: rect(120, 60), D7: rect(220, 60), C3: rect(270, 60) }),
      },
      {
        name: 'room avoided and redealt',
        setup: dealBatch,
        before: roomLayout,
        batch: [
          { type: 'RoomAvoided', roomNumber: 1, cards: room.map(card) },
          ...deal(['S2', 'S3', 'S4', 'H2']),
        ],
        after: layoutWith({ S2: rect(120, 60), S3: rect(170, 60), S4: rect(220, 60), H2: rect(270, 60) }),
      },
      {
        name: 'equip over an 8-card stack',
        setup: [],
        before: layoutWith({
          D10: rect(100, 180),
          D9: rect(120, 60),
          ...Object.fromEntries(['S9', 'S8', 'S7', 'C7', 'S6', 'C6', 'S5', 'C5'].map((id, i) => [id, rect(110 + i * 4, 186)])),
        }),
        batch: [
          {
            type: 'WeaponEquipped',
            weapon: card('D9'),
            replaced: card('D10'),
            discarded: ['D10', 'S9', 'S8', 'S7', 'C7', 'S6', 'C6', 'S5', 'C5'].map(card),
          },
        ],
        after: layoutWith({ D9: rect(100, 180) }),
      },
    ];
    for (const s of scenarios) {
      it(s.name, () => {
        const fx = createFxDirector();
        fx.update(16, s.before);
        if (s.setup.length) {
          fx.enqueue(s.setup);
          fx.skip();
          fx.update(16, s.before);
        }
        fx.enqueue(s.batch);
        const released = ghostReleaseOpacity(fx, s.after, 5000, 1);
        expect(released.size, 'scenario must release at least one ghost').toBeGreaterThan(0);
        for (const [id, o] of released) expect(o, id).toBeLessThan(0.05);
        expect(fx.isBusy()).toBe(false);
      });
    }
  });
});
