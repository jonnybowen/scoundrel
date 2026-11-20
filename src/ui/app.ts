/**
 * App composition root: wires session -> fx -> audio, input -> session, and the frame loop.
 * Owner: Starbuck (UI), with Gaeta for the fx/audio hookup. This is the ONLY module that knows every layer.
 *
 *   session.subscribe((events) => fx.enqueue(events))
 *   fx.onCue(({ event }) => audio.handleEvent(event))
 *   rAF loop: view = selectView(session.state, ui); layout = computeLayout(view, viewport);
 *             fx.update(dt, layout); renderer.draw(view, layout, fx.frame(), t)
 *   pointer/keys -> renderer.hitTest -> UiIntent -> (if !fx.isBusy()) session.dispatch(action)
 *   first pointerdown/keydown -> audio.unlock()
 */
import { notImplemented } from '../notImplemented';

export interface AppOptions {
  readonly canvas: HTMLCanvasElement;
  /** Fixed seed (e.g. from ?seed= in the URL) for reproducible runs and e2e tests. */
  readonly seed?: number;
}

export interface App {
  start(): void;
  stop(): void;
}

export function createApp(_opts: AppOptions): App {
  return notImplemented('createApp', 'Starbuck');
}
