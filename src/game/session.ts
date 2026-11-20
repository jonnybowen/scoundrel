/**
 * GameSession: the single stateful holder around the pure engine, plus the event bus.
 * CONTRACT. Impl owner: Tyrol. Consumed by ui/ (Starbuck) and fx/, audio/ (Gaeta).
 * Still DOM-free, so it is headless-testable.
 *
 * Flow:  UI intent -> session.dispatch(action) -> engine.step -> state replaced -> listeners(events, state)
 * Listeners are called synchronously, once per successful dispatch / newGame, in subscription order.
 * Rejected actions do not notify listeners (the caller gets the violation from dispatch's return value).
 */
import { createGame, step } from './engine';
import type { GameAction } from './actions';
import type { GameEvent } from './events';
import type { NewGameOptions, StepResult } from './engine';
import type { GameState } from './state';

/** Receives each batch of events from one transition, with the resulting state. */
export type GameListener = (events: readonly GameEvent[], state: GameState) => void;

export type Unsubscribe = () => void;

export interface GameSession {
  readonly state: GameState;
  /** Accepted actions since the last newGame. (seed + rules + history) reproduces the game exactly. */
  readonly history: readonly GameAction[];
  dispatch(action: GameAction): StepResult;
  newGame(opts: NewGameOptions): void;
  subscribe(listener: GameListener): Unsubscribe;
  /** Rebuild from seed + action log (load / replay / undo-by-replay). Emits one combined batch. */
  replay(opts: NewGameOptions, actions: readonly GameAction[]): void;
}

/**
 * Create a session and start a game. No listeners exist yet, so the opening events are not broadcast;
 * read `session.state` for the initial render, or call `newGame` after subscribing to receive them.
 *
 * `replay` is atomic: if any logged action is illegal (corrupt or mismatched log) it throws an Error
 * naming the action index and violation, and the session is left unchanged.
 */
export function createSession(opts: NewGameOptions): GameSession {
  let state: GameState = createGame(opts).state;
  let history: GameAction[] = [];
  let listeners: GameListener[] = [];

  const emit = (events: readonly GameEvent[], s: GameState): void => {
    for (const l of listeners.slice()) l(events, s);
  };

  return {
    get state() {
      return state;
    },
    get history() {
      return history;
    },
    dispatch(action) {
      const result: StepResult = step(state, action);
      if (result.ok) {
        state = result.state;
        history = [...history, action];
        emit(result.events, state);
      }
      return result;
    },
    newGame(newOpts) {
      const t = createGame(newOpts);
      state = t.state;
      history = [];
      emit(t.events, state);
    },
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
    replay(replayOpts, actions) {
      const t = createGame(replayOpts);
      let s = t.state;
      const events: GameEvent[] = [...t.events];
      actions.forEach((action, i) => {
        const r = step(s, action);
        if (!r.ok) {
          throw new Error(`replay: action #${i} (${JSON.stringify(action)}) rejected: ${r.violation.code}`);
        }
        s = r.state;
        events.push(...r.events);
      });
      state = s;
      history = actions.slice();
      emit(events, state);
    },
  };
}
