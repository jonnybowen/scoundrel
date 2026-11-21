/**
 * Resume-on-reload: persist the active run as (seed + rules + action log) and rebuild it with session.replay.
 * CONTRACT. Owner: Starbuck (UI). Key 'scoundrel.run.v1', separate from Settings (settings.ts stays the only Settings
 * writer). User directive (decisions.md, "confirmed tutorial choices and resume-on-reload").
 *
 * Rules this module enforces on its own, so the app cannot get them wrong:
 *  - It never writes a record that would not replay to the live state. Each write is checked by stepping the pure
 *    engine from the recorded options, so a scripted-deck (tutorial) run, which a seed cannot reproduce, is never
 *    saved, even if the caller's "is this the tutorial?" flag is late. (The tutorial controller deals before it
 *    marks itself active, so a flag alone is not enough.)
 *  - A run that cannot be saved (scripted, finished, or not reproducible) clears the save. The save always mirrors
 *    the current real run or nothing.
 *  - A finished run (phase 'won' | 'lost') clears the save.
 *  - Storage is injected. Every access is wrapped in try/catch: a missing or throwing localStorage still boots and
 *    plays, it just doesn't resume.
 *  - Loading validates version and shape. Corrupt JSON, a wrong version or a wrong shape gives null.
 *  - Restoring dry-runs the log on the pure engine first, then calls session.replay inside try/catch. An illegal log
 *    or a finished run reports failure, clears the save, and leaves the session untouched.
 *
 * The caller must call fx.skip() after a successful restore (DR1 review note): replay broadcasts one combined batch.
 */
import { createGame, step } from '../game';
import type { GameAction, GameSession, GameState, NewGameOptions, RulesOptions } from '../game';

export const RUN_SAVE_KEY = 'scoundrel.run.v1';
export const RUN_SAVE_VERSION = 1;

/** The persisted record. Plain JSON. `rules` is the fully resolved RulesOptions taken from GameState. */
export interface SavedRun {
  readonly version: typeof RUN_SAVE_VERSION;
  readonly seed: number;
  readonly rules: RulesOptions;
  readonly actions: readonly GameAction[];
}

/** The subset of Web Storage this module uses (inject a fake in tests). */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** window.localStorage, or null when it is missing or merely touching it throws (sandboxed iframes, some privacy modes). */
export function browserStorage(): SaveStorage | null {
  try {
    const s = (globalThis as { localStorage?: SaveStorage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

// ----- storage primitives (never throw) -----------------------------------------------------------------

function writeRaw(storage: SaveStorage | null, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RUN_SAVE_KEY, value);
    return true;
  } catch {
    return false; // quota / private mode: the run lives for this session only
  }
}

/** Delete the save. Safe with a null or throwing storage. */
export function clearRun(storage: SaveStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(RUN_SAVE_KEY);
  } catch {
    // nothing to do
  }
}

// ----- validation --------------------------------------------------------------------------------------

const CARD_ID = /^[CSDH]\d{1,2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isRules(v: unknown): v is RulesOptions {
  return (
    isObj(v) &&
    (v.weaponLimit === 'lte' || v.weaponLimit === 'lt') &&
    (v.lossScoreScope === 'dungeon' || v.lossScoreScope === 'deckOnly')
  );
}

function isAction(v: unknown): v is GameAction {
  if (!isObj(v)) return false;
  switch (v.type) {
    case 'enterRoom':
    case 'avoidRoom':
      return true;
    case 'playCard':
      return (
        typeof v.cardId === 'string' &&
        CARD_ID.test(v.cardId) &&
        (v.mode === undefined || v.mode === 'weapon' || v.mode === 'barehanded')
      );
    default:
      return false;
  }
}

/** Shape check only (no legality). Normalises actions to their known fields so stray keys are not replayed. */
export function parseSavedRun(raw: unknown): SavedRun | null {
  if (!isObj(raw)) return null;
  if (raw.version !== RUN_SAVE_VERSION) return null;
  const { seed, rules, actions } = raw;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if (!isRules(rules)) return null;
  if (!Array.isArray(actions) || !actions.every(isAction)) return null;
  return {
    version: RUN_SAVE_VERSION,
    seed,
    rules: { weaponLimit: rules.weaponLimit, lossScoreScope: rules.lossScoreScope },
    actions: actions.map((a): GameAction => {
      if (a.type !== 'playCard') return { type: a.type };
      return a.mode === undefined ? { type: 'playCard', cardId: a.cardId } : { type: 'playCard', cardId: a.cardId, mode: a.mode };
    }),
  };
}

/** Read the save. Returns a shape-valid record or null (absent, unreadable, corrupt JSON, wrong version, wrong shape). */
export function loadRun(storage: SaveStorage | null): SavedRun | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(RUN_SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return parseSavedRun(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ----- replay (pure) -----------------------------------------------------------------------------------

export const runOptions = (run: Pick<SavedRun, 'seed' | 'rules'>): NewGameOptions => ({ seed: run.seed, rules: run.rules });

/** Step the pure engine through the log. Never throws; null if any action is illegal. */
export function replayState(run: Pick<SavedRun, 'seed' | 'rules' | 'actions'>): GameState | null {
  let s: GameState;
  try {
    s = createGame(runOptions(run)).state;
  } catch {
    return null;
  }
  for (const action of run.actions) {
    const r = step(s, action);
    if (!r.ok) return null;
    s = r.state;
  }
  return s;
}

const isOver = (s: GameState): boolean => s.phase === 'won' || s.phase === 'lost';
const sameState = (a: GameState, b: GameState): boolean => JSON.stringify(a) === JSON.stringify(b);

// ----- save --------------------------------------------------------------------------------------------

export type SaveOutcome =
  /** Record written (or storage unavailable but the run was saveable: 'saved' with written=false). */
  | { readonly kind: 'saved'; readonly written: boolean }
  /** Run is over: save cleared. */
  | { readonly kind: 'cleared-finished' }
  /** Caller said scripted, or the log does not reproduce the live state from (seed, rules): save cleared. */
  | { readonly kind: 'cleared-unsaveable' };

export interface SaveOptions {
  /** True for scripted-deck runs (the tutorial). Optional: the reproducibility check catches them anyway. */
  readonly scripted?: boolean;
  /**
   * Skip the reproducibility check because the caller has already verified it. Used by attachAutosave's
   * incremental check; leave unset otherwise.
   */
  readonly verified?: boolean;
}

/**
 * Save the live run after an accepted transition (deal, action, replay). Seed and rules come from the state, the
 * log from session.history. Finished, scripted or non-reproducible runs clear the save instead.
 */
export function saveRun(
  storage: SaveStorage | null,
  state: GameState,
  history: readonly GameAction[],
  opts: SaveOptions = {},
): SaveOutcome {
  if (isOver(state)) {
    clearRun(storage);
    return { kind: 'cleared-finished' };
  }
  const run: SavedRun = { version: RUN_SAVE_VERSION, seed: state.seed, rules: state.rules, actions: history.slice() };
  if (opts.scripted || (!opts.verified && !reproduces(run, state))) {
    clearRun(storage);
    return { kind: 'cleared-unsaveable' };
  }
  return { kind: 'saved', written: writeRaw(storage, JSON.stringify(run)) };
}

function reproduces(run: SavedRun, live: GameState): boolean {
  const s = replayState(run);
  return s !== null && sameState(s, live);
}

/**
 * Subscribe a saver to the session: every broadcast batch (newGame deal, dispatch, replay) saves or clears.
 * Verification is incremental: while the log only grows, only the new actions are stepped, so each save costs one
 * engine step plus a JSON compare. Returns the unsubscribe. `isScripted` is read on every batch.
 */
export function attachAutosave(
  session: GameSession,
  storage: SaveStorage | null,
  isScripted: () => boolean = () => false,
): () => void {
  // Last state reproduced from (seed, rules, verifiedLog); null = start over from createGame.
  let verified: { seed: number; rules: RulesOptions; log: readonly GameAction[]; state: GameState } | null = null;

  const verify = (state: GameState, history: readonly GameAction[]): boolean => {
    const base = verified;
    const prefix =
      base !== null &&
      base.seed === state.seed &&
      JSON.stringify(base.rules) === JSON.stringify(state.rules) &&
      base.log.length <= history.length &&
      base.log.every((a, i) => a === history[i] || JSON.stringify(a) === JSON.stringify(history[i]));
    let s: GameState | null;
    if (prefix && base) {
      s = base.state;
      for (let i = base.log.length; i < history.length && s; i++) {
        const r = step(s, history[i]!);
        s = r.ok ? r.state : null;
      }
    } else {
      s = replayState({ seed: state.seed, rules: state.rules, actions: history });
    }
    if (s === null || !sameState(s, state)) {
      verified = null;
      return false;
    }
    verified = { seed: state.seed, rules: state.rules, log: history.slice(), state: s };
    return true;
  };

  return session.subscribe((_events, state) => {
    let scripted = false;
    try {
      scripted = isScripted();
    } catch {
      scripted = false;
    }
    if (scripted || isOver(state)) {
      verified = null;
      saveRun(storage, state, session.history, { scripted });
      return;
    }
    const ok = verify(state, session.history);
    saveRun(storage, state, session.history, ok ? { verified: true } : { scripted: true });
  });
}

// ----- restore -----------------------------------------------------------------------------------------

export type RestoreResult =
  | { readonly ok: true; readonly run: SavedRun }
  | { readonly ok: false; readonly reason: 'none' | 'illegal' | 'finished' | 'replayThrew'; readonly error?: unknown };

/**
 * Boot path: load the save and rebuild it on `session` with session.replay. On any failure the save is cleared,
 * the session is left unchanged, and the caller shows the title. On success the caller must call fx.skip().
 * The dry run on the pure engine means session.replay should not throw, but it is still wrapped (it is atomic).
 */
export function restoreRun(session: GameSession, storage: SaveStorage | null): RestoreResult {
  const run = loadRun(storage);
  if (!run) {
    // Absent, or present but unreadable/corrupt: either way nothing to resume, and a bad record must not linger.
    clearRun(storage);
    return { ok: false, reason: 'none' };
  }
  const end = replayState(run);
  if (!end) {
    clearRun(storage);
    return { ok: false, reason: 'illegal' };
  }
  if (isOver(end)) {
    clearRun(storage);
    return { ok: false, reason: 'finished' };
  }
  try {
    session.replay(runOptions(run), run.actions);
  } catch (error) {
    clearRun(storage);
    return { ok: false, reason: 'replayThrew', error };
  }
  return { ok: true, run };
}
