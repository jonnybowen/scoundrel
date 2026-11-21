/**
 * Resume-on-reload save module (src/ui/save.ts). Owner: Starbuck.
 * Contract: a saved run replays to the exact live state; corrupt/illegal/finished saves give null or failure and are
 * cleared; a throwing storage never throws out; tutorial (scripted-deck) runs are never saved.
 */
import { describe, expect, it } from 'vitest';
import { createSession, legalActions, type GameAction, type GameSession } from '../../src/game';
import { TUTORIAL_SEED, tutorialGameOptions } from '../../src/tutorial';
import {
  RUN_SAVE_KEY,
  RUN_SAVE_VERSION,
  attachAutosave,
  browserStorage,
  clearRun,
  loadRun,
  restoreRun,
  saveRun,
  type SaveStorage,
} from '../../src/ui/save';

class MemoryStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.writes++;
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const throwing: SaveStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

/** Deterministic play: take the first legal action, preferring not to avoid, for `n` steps or until the game ends. */
function play(session: GameSession, n: number): void {
  for (let i = 0; i < n; i++) {
    const legal = legalActions(session.state);
    if (legal.length === 0) return;
    const pick = legal.find((a) => a.type !== 'avoidRoom') ?? legal[0]!;
    const r = session.dispatch(pick);
    if (!r.ok) throw new Error(`play: ${pick.type} rejected`);
  }
}

function playToEnd(session: GameSession): void {
  play(session, 10_000);
  expect(['won', 'lost']).toContain(session.state.phase);
}

const stored = (st: MemoryStorage): unknown => JSON.parse(st.map.get(RUN_SAVE_KEY)!);

describe('save: round trip', () => {
  it('save -> load -> restore reproduces the live state exactly (rules included)', () => {
    const st = new MemoryStorage();
    const live = createSession({ seed: 0xdeadbeef, rules: { weaponLimit: 'lt' } });
    live.newGame({ seed: 0xdeadbeef, rules: { weaponLimit: 'lt' } });
    play(live, 4);
    expect(live.state.phase).not.toMatch(/won|lost/);

    expect(saveRun(st, live.state, live.history)).toEqual({ kind: 'saved', written: true });
    const rec = loadRun(st);
    expect(rec).toEqual({ version: RUN_SAVE_VERSION, seed: 0xdeadbeef, rules: live.state.rules, actions: live.history });

    const fresh = createSession({ seed: 1 });
    const batches: number[] = [];
    fresh.subscribe((events) => batches.push(events.length));
    const res = restoreRun(fresh, st);
    expect(res.ok).toBe(true);
    expect(fresh.state).toEqual(live.state);
    expect(fresh.history).toEqual(live.history);
    expect(batches).toHaveLength(1); // one combined batch: the app then calls fx.skip()
  });

  it('autosave writes after every accepted transition and a reload resumes mid-run', () => {
    const st = new MemoryStorage();
    const live = createSession({ seed: 7 });
    attachAutosave(live, st);
    live.newGame({ seed: 7 });
    expect(loadRun(st)?.actions).toEqual([]); // the deal alone is resumable
    for (let i = 1; i <= 6; i++) {
      play(live, 1);
      expect(loadRun(st)?.actions).toHaveLength(i);
    }
    // rejected actions don't broadcast, so don't save
    const before = st.writes;
    live.dispatch({ type: 'playCard', cardId: 'S99' });
    expect(st.writes).toBe(before);

    const reloaded = createSession({ seed: 123 });
    attachAutosave(reloaded, st);
    expect(restoreRun(reloaded, st).ok).toBe(true);
    expect(reloaded.state).toEqual(live.state);
    // play on after restore: the save keeps tracking
    play(reloaded, 1);
    expect(loadRun(st)?.actions).toEqual(reloaded.history);
  });
});

describe('save: load rejects bad records (null)', () => {
  const good = { version: 1, seed: 5, rules: { weaponLimit: 'lte', lossScoreScope: 'dungeon' }, actions: [{ type: 'enterRoom' }] };
  const cases: [string, string][] = [
    ['corrupt JSON', '{"version":1,'],
    ['not an object', '[1,2]'],
    ['wrong version', JSON.stringify({ ...good, version: 2 })],
    ['missing version', JSON.stringify({ ...good, version: undefined })],
    ['negative seed', JSON.stringify({ ...good, seed: -1 })],
    ['fractional seed', JSON.stringify({ ...good, seed: 1.5 })],
    ['bad rules', JSON.stringify({ ...good, rules: { weaponLimit: 'sometimes', lossScoreScope: 'dungeon' } })],
    ['actions not an array', JSON.stringify({ ...good, actions: 'enterRoom' })],
    ['unknown action', JSON.stringify({ ...good, actions: [{ type: 'cheat' }] })],
    ['bad card id', JSON.stringify({ ...good, actions: [{ type: 'playCard', cardId: 'X1' }] })],
    ['bad mode', JSON.stringify({ ...good, actions: [{ type: 'playCard', cardId: 'S2', mode: 'magic' }] })],
  ];
  it.each(cases)('%s', (_name, raw) => {
    const st = new MemoryStorage();
    st.map.set(RUN_SAVE_KEY, raw);
    expect(loadRun(st)).toBeNull();
  });

  it('accepts the good record and strips unknown keys', () => {
    const st = new MemoryStorage();
    st.map.set(RUN_SAVE_KEY, JSON.stringify({ ...good, extra: 1, actions: [{ type: 'enterRoom', junk: true }] }));
    expect(loadRun(st)).toEqual({ ...good, actions: [{ type: 'enterRoom' }] });
  });

  it('absent save is null', () => {
    expect(loadRun(new MemoryStorage())).toBeNull();
    expect(loadRun(null)).toBeNull();
  });
});

describe('save: restore falls back on bad logs', () => {
  it('an illegal log fails, clears the save, and leaves the session untouched and silent', () => {
    const st = new MemoryStorage();
    const live = createSession({ seed: 42 });
    play(live, 2);
    expect(saveRun(st, live.state, live.history).kind).toBe('saved');
    const rec = stored(st) as { actions: GameAction[] };
    // two avoids in a row is always illegal
    st.map.set(RUN_SAVE_KEY, JSON.stringify({ ...rec, actions: [{ type: 'avoidRoom' }, { type: 'avoidRoom' }] }));

    const target = createSession({ seed: 9 });
    const before = target.state;
    let heard = 0;
    target.subscribe(() => heard++);
    const res = restoreRun(target, st);
    expect(res).toEqual({ ok: false, reason: 'illegal' });
    expect(target.state).toBe(before);
    expect(heard).toBe(0);
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('a corrupt save fails as "none" and is cleared', () => {
    const st = new MemoryStorage();
    st.map.set(RUN_SAVE_KEY, 'not json');
    expect(restoreRun(createSession({ seed: 1 }), st)).toEqual({ ok: false, reason: 'none' });
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('a hand-written finished log is refused as "finished"', () => {
    const live = createSession({ seed: 3 });
    playToEnd(live);
    const st = new MemoryStorage();
    st.map.set(
      RUN_SAVE_KEY,
      JSON.stringify({ version: 1, seed: live.state.seed, rules: live.state.rules, actions: live.history }),
    );
    expect(restoreRun(createSession({ seed: 1 }), st)).toEqual({ ok: false, reason: 'finished' });
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('session.replay throwing is caught and reported', () => {
    const st = new MemoryStorage();
    const live = createSession({ seed: 11 });
    saveRun(st, live.state, live.history);
    const boom = new Error('boom');
    const fake = { ...createSession({ seed: 1 }), replay: () => { throw boom; } } as GameSession;
    expect(restoreRun(fake, st)).toEqual({ ok: false, reason: 'replayThrew', error: boom });
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });
});

describe('save: throwing or missing storage', () => {
  it('never throws, loads null, and restore fails cleanly', () => {
    const live = createSession({ seed: 5 });
    play(live, 3);
    expect(saveRun(throwing, live.state, live.history)).toEqual({ kind: 'saved', written: false });
    expect(loadRun(throwing)).toBeNull();
    expect(() => clearRun(throwing)).not.toThrow();
    expect(restoreRun(createSession({ seed: 1 }), throwing)).toEqual({ ok: false, reason: 'none' });
    expect(saveRun(null, live.state, live.history)).toEqual({ kind: 'saved', written: false });
  });

  it('autosave on a throwing storage does not break play', () => {
    const s = createSession({ seed: 5 });
    attachAutosave(s, throwing);
    expect(() => {
      s.newGame({ seed: 5 });
      play(s, 10);
    }).not.toThrow();
  });

  it('browserStorage() never throws, whatever the host provides', () => {
    expect(() => browserStorage()).not.toThrow();
  });

  it('browserStorage() is null when touching globalThis.localStorage throws (sandboxed iframe / privacy mode)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError');
        },
      });
      expect(browserStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('save: autosave across back-to-back deals on one session', () => {
  it('a new seed replaces the save, then a rules change on the same seed replaces it again', () => {
    const st = new MemoryStorage();
    const s = createSession({ seed: 1 });
    attachAutosave(s, st);
    s.newGame({ seed: 1 });
    expect(loadRun(st)).toMatchObject({ seed: 1, actions: [] });

    s.newGame({ seed: 2 }); // empty log both times: only the seed check tells the deals apart
    expect(loadRun(st)).toMatchObject({ seed: 2, rules: { weaponLimit: 'lte' }, actions: [] });

    s.newGame({ seed: 2, rules: { weaponLimit: 'lt' } }); // same seed, same empty log: only the rules check differs
    expect(loadRun(st)).toMatchObject({ seed: 2, rules: { weaponLimit: 'lt' }, actions: [] });
    expect(restoreRun(createSession({ seed: 9 }), st).ok).toBe(true);
  });

  it('a seeded deal on TUTORIAL_SEED followed by the scripted tutorial deal leaves no save', () => {
    const st = new MemoryStorage();
    const s = createSession({ seed: 1 });
    attachAutosave(s, st);
    s.newGame({ seed: TUTORIAL_SEED });
    expect(loadRun(st)?.seed).toBe(TUTORIAL_SEED);
    // same seed, same rules, same empty log: the prefix matches, so only the state compare catches the scripted deck
    s.newGame(tutorialGameOptions());
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('isScripted() true on an ordinary seeded game clears the save', () => {
    const st = new MemoryStorage();
    const s = createSession({ seed: 4 });
    let scripted = false;
    attachAutosave(s, st, () => scripted);
    s.newGame({ seed: 4 });
    play(s, 2);
    expect(st.map.has(RUN_SAVE_KEY)).toBe(true);
    scripted = true;
    play(s, 1); // reproducible from the seed, but the caller says scripted: the flag must win
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
    s.newGame({ seed: 4 });
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });
});

describe('save: finished runs clear', () => {
  it('autosave clears on GameWon/GameLost', () => {
    const st = new MemoryStorage();
    const s = createSession({ seed: 99 });
    attachAutosave(s, st);
    s.newGame({ seed: 99 });
    play(s, 2);
    expect(st.map.has(RUN_SAVE_KEY)).toBe(true);
    playToEnd(s);
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('saveRun on a finished state clears', () => {
    const st = new MemoryStorage();
    st.map.set(RUN_SAVE_KEY, 'stale');
    const s = createSession({ seed: 99 });
    playToEnd(s);
    expect(saveRun(st, s.state, s.history)).toEqual({ kind: 'cleared-finished' });
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });
});

describe('save: tutorial (scripted deck) is never saved', () => {
  it('explicit scripted flag clears and writes nothing', () => {
    const st = new MemoryStorage();
    const s = createSession(tutorialGameOptions());
    expect(saveRun(st, s.state, s.history, { scripted: true })).toEqual({ kind: 'cleared-unsaveable' });
    expect(st.writes).toBe(0);
  });

  it('a scripted deck is caught even without the flag (it is not reproducible from the seed)', () => {
    const st = new MemoryStorage();
    const s = createSession(tutorialGameOptions());
    expect(saveRun(st, s.state, s.history)).toEqual({ kind: 'cleared-unsaveable' });
    expect(st.writes).toBe(0);
  });

  it('autosave: a real run in progress, then the tutorial deals on the same session (flag still false, as in the controller) -> save cleared, never written', () => {
    const st = new MemoryStorage();
    const s = createSession({ seed: 1 });
    let tutorialActive = false;
    attachAutosave(s, st, () => tutorialActive);
    s.newGame({ seed: 1 });
    play(s, 3);
    expect(st.map.has(RUN_SAVE_KEY)).toBe(true);

    const writes = st.writes;
    s.newGame(tutorialGameOptions()); // controller deals before it marks itself active
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
    tutorialActive = true;
    play(s, 4);
    expect(st.writes).toBe(writes);
    expect(st.map.has(RUN_SAVE_KEY)).toBe(false);
  });
});
