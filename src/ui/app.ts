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
import { createSession } from '../game';
import type { GameAction, GameSession, RuleViolation } from '../game';
import { createAudioEngine } from '../audio/types';
import type { AudioEngine, MusicId, SfxId } from '../audio/types';
import { createFxDirector } from '../fx/types';
import type { FxDirector } from '../fx/types';
import { computeLayout, createRenderer } from '../render/types';
import type { Renderer, Viewport } from '../render/types';
import { createNeutralFx, createSilentAudio } from './fallbacks';
import { keyToIntent, targetToIntent } from './input';
import { loadSettings, saveSettings } from './settings';
import type { Settings } from './settings';
import { selectView } from './view';
import type { GameView, HitTarget, LayoutSnapshot, UiIntent, UiLocalState } from './view';

export interface AppOptions {
  readonly canvas: HTMLCanvasElement;
  /** Fixed seed (e.g. from ?seed= in the URL) for reproducible runs and e2e tests. */
  readonly seed?: number;
}

export interface App {
  start(): void;
  stop(): void;
}

const TOAST_MS = 1800;

function attempt<T>(make: () => T, fallback: () => T, what: string): T {
  try {
    return make();
  } catch (e) {
    console.warn(`[app] ${what} unavailable, using fallback:`, e);
    return fallback();
  }
}

function violationText(v: RuleViolation): string | null {
  switch (v.code) {
    case 'gameOver': return 'THE RUN IS OVER';
    case 'cannotAvoidTwice': return "CAN'T AVOID TWO ROOMS IN A ROW";
    case 'cannotAvoidAfterEntering': return 'TOO LATE TO AVOID THIS ROOM';
    case 'cannotAvoidFinalRoom': return 'NO ESCAPING THE FINAL ROOM';
    case 'alreadyEntered': return 'ALREADY IN THE ROOM';
    case 'cardNotInRoom': return 'THAT CARD IS GONE';
    case 'noWeapon': return 'NO WEAPON EQUIPPED';
    case 'weaponCannotFight': return `WEAPON TOO DULL: MAX ${v.limit}`;
    case 'modeRequired': return null;
  }
}

const sameTarget = (a: HitTarget | null, b: HitTarget | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === 'card' && b.kind === 'card') return a.cardId === b.cardId;
  if (a.kind === 'button' && b.kind === 'button') return a.id === b.id;
  return a.kind === b.kind;
};

const GAME_ACTIONS: ReadonlySet<UiIntent['type']> = new Set(['selectCard', 'chooseFight', 'enterRoom', 'avoidRoom']);

export function createApp(opts: AppOptions): App {
  const { canvas } = opts;
  let settings: Settings = loadSettings();
  let ui: UiLocalState = {
    pendingFight: null,
    menuOpen: false,
    screen: 'title',
    hover: null,
    toast: null,
    showResult: false,
    settings,
    error: null,
  };
  let toastUntil = 0;
  let firstSeed = opts.seed;

  const renderer: Renderer = createRenderer();
  const fx: FxDirector = attempt(createFxDirector, createNeutralFx, 'fx');
  const audio: AudioEngine = attempt(() => createAudioEngine({ persist: false }), createSilentAudio, 'audio'); // app owns persistence

  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      console.warn('[app]', e);
    }
  };
  const sfx = (id: SfxId): void => safe(() => audio.play(id));
  let currentMusic: MusicId | null = null;
  const music = (id: MusicId | null): void => {
    if (id === currentMusic) return;
    currentMusic = id;
    safe(() => (id ? audio.playMusic(id, { fadeMs: 600 }) : audio.stopMusic({ fadeMs: 600 })));
  };

  const applySettings = (): void => {
    renderer.setCrt({ enabled: settings.crtEnabled });
    safe(() => fx.setReducedMotion(settings.reducedMotion));
    safe(() => {
      audio.setVolume('master', settings.masterVolume);
      audio.setVolume('sfx', settings.sfxVolume);
      audio.setVolume('music', settings.musicVolume);
      audio.setMuted(settings.muted);
    });
  };
  const updateSettings = (patch: Partial<Settings>, toast?: string): void => {
    settings = { ...settings, ...patch };
    ui = { ...ui, settings };
    saveSettings(settings);
    applySettings();
    if (toast) showToast(toast);
  };

  const showToast = (text: string): void => {
    ui = { ...ui, toast: text };
    toastUntil = performance.now() + TOAST_MS;
  };

  // Teardown list: every subscription made here is released in stop().
  const unsubscribers: (() => void)[] = [];
  safe(() => unsubscribers.push(fx.onCue(({ event }) => audio.handleEvent(event))));
  void audio.load().catch(() => undefined);

  // ----- session ---------------------------------------------------------------------------------------

  let session: GameSession | null = null;

  const newGame = (seed?: number): void => {
    const s = seed ?? firstSeed ?? (Math.floor(Math.random() * 0x100000000) >>> 0);
    firstSeed = undefined;
    try {
      if (!session) {
        session = createSession({ seed: s });
        // createSession does not broadcast its opening events: subscribe first, then newGame to get the deal.
        unsubscribers.push(session.subscribe((events) => fx.enqueue(events)));
      }
      // Finish whatever the previous run was still animating so its tweens/ghosts don't bleed into the new deal.
      safe(() => fx.skip());
      session.newGame({ seed: s });
      ui = { ...ui, screen: 'game', menuOpen: false, pendingFight: null, showResult: false, error: null, hover: null };
      music('dungeon');
    } catch (e) {
      console.error('[app] could not start a game', e);
      session = null;
      ui = { ...ui, screen: 'title', error: 'RULES ENGINE UNAVAILABLE' };
    }
  };

  const dispatch = (action: GameAction): void => {
    if (!session) return;
    const res = session.dispatch(action);
    if (res.ok) return;
    if (res.violation.code === 'modeRequired') {
      ui = { ...ui, pendingFight: res.violation.cardId };
      return;
    }
    sfx('uiDenied');
    const text = violationText(res.violation);
    if (text) showToast(text);
  };

  // ----- view / layout ---------------------------------------------------------------------------------

  let viewport: Viewport = readViewport();
  let lastView: GameView | null = null;
  let lastLayout: LayoutSnapshot | null = null;

  function readViewport(): Viewport {
    const vv = window.visualViewport;
    const w = vv?.width ?? window.innerWidth;
    const h = vv?.height ?? window.innerHeight;
    return {
      cssWidth: w,
      cssHeight: h,
      devicePixelRatio: window.devicePixelRatio || 1,
      orientation: h > w ? 'portrait' : 'landscape',
    };
  }

  const buildView = (): GameView => {
    try {
      return selectView(ui.screen === 'game' ? session?.state ?? null : null, ui);
    } catch (e) {
      console.error('[app] selectView failed', e);
      ui = { ...ui, screen: 'title', error: 'RULES ENGINE ERROR' };
      return selectView(null, ui);
    }
  };

  const refresh = (): { view: GameView; layout: LayoutSnapshot } => {
    const view = buildView();
    const layout = computeLayout(view, viewport);
    lastView = view;
    lastLayout = layout;
    return { view, layout };
  };

  // ----- intents ---------------------------------------------------------------------------------------

  const handle = (intent: UiIntent): void => {
    const view = lastView ?? refresh().view;
    if (GAME_ACTIONS.has(intent.type) && fx.isBusy()) {
      fx.skip();
      return;
    }
    switch (intent.type) {
      case 'hover': {
        if (sameTarget(ui.hover, intent.target)) return;
        ui = { ...ui, hover: intent.target };
        const t = intent.target;
        if (t?.kind === 'button') sfx('uiHover');
        else if (t?.kind === 'card' && view.room.some((rc) => rc?.card.id === t.cardId && rc.playable)) sfx('uiHover');
        safe(() => fx.setHover?.(t?.kind === 'card' ? t.cardId : null));
        return;
      }
      case 'selectCard': {
        const rc = view.room.find((r) => r?.card.id === intent.cardId);
        if (!rc) return;
        if (!rc.playable) {
          sfx('uiDenied');
          return;
        }
        if (view.pendingFight === intent.cardId) {
          ui = { ...ui, pendingFight: null };
          return;
        }
        const isMonster = rc.kind === 'monster';
        if (isMonster && rc.canUseWeapon) {
          sfx('uiClick');
          ui = { ...ui, pendingFight: intent.cardId };
          return;
        }
        ui = { ...ui, pendingFight: null };
        dispatch(isMonster ? { type: 'playCard', cardId: intent.cardId, mode: 'barehanded' } : { type: 'playCard', cardId: intent.cardId });
        return;
      }
      case 'chooseFight': {
        const id = view.pendingFight;
        if (!id) return;
        ui = { ...ui, pendingFight: null };
        dispatch({ type: 'playCard', cardId: id, mode: intent.mode });
        return;
      }
      case 'cancel':
        if (ui.pendingFight) {
          ui = { ...ui, pendingFight: null };
          sfx('uiClick');
        }
        return;
      case 'enterRoom':
        if (view.phase === 'choosing') dispatch({ type: 'enterRoom' });
        return;
      case 'avoidRoom':
        ui = { ...ui, pendingFight: null };
        dispatch({ type: 'avoidRoom' });
        return;
      case 'newGame':
        sfx('uiClick');
        newGame(intent.seed);
        return;
      case 'toggleMute':
        updateSettings({ muted: !settings.muted });
        if (!settings.muted) sfx('uiClick');
        return;
      case 'openSettings':
        sfx('uiClick');
        ui = { ...ui, menuOpen: true, pendingFight: null };
        return;
      case 'closeSettings':
        sfx('uiClick');
        ui = { ...ui, menuOpen: false };
        return;
      case 'toggleCrt':
        sfx('uiClick');
        updateSettings({ crtEnabled: !settings.crtEnabled }, ui.menuOpen ? undefined : `CRT ${settings.crtEnabled ? 'OFF' : 'ON'}`);
        return;
      case 'toggleReducedMotion':
        sfx('uiClick');
        updateSettings({ reducedMotion: !settings.reducedMotion });
        return;
      case 'changeVolume': {
        const v = Math.round(Math.min(1, Math.max(0, settings.masterVolume + intent.delta)) * 10) / 10;
        updateSettings({ masterVolume: v, muted: v === 0 ? settings.muted : false });
        sfx('uiClick');
        return;
      }
      case 'skip':
        if (fx.isBusy()) fx.skip();
        return;
    }
  };

  // ----- DOM input -------------------------------------------------------------------------------------

  let unlocked = false;
  const unlock = (): void => {
    if (unlocked) return;
    unlocked = true;
    void audio.unlock().catch(() => undefined);
    if (ui.screen === 'title') {
      currentMusic = null;
      music('title');
    }
  };

  const localPoint = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const targetAt = (e: PointerEvent): HitTarget | null => {
    if (!lastLayout) refresh();
    const [x, y] = localPoint(e);
    return lastLayout ? renderer.hitTest(x, y, lastLayout) : null;
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    handle({ type: 'hover', target: targetAt(e) });
  };
  const onPointerLeave = (): void => handle({ type: 'hover', target: null });
  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    unlock();
    const target = targetAt(e);
    const utility = target?.kind === 'button' && (target.id === 'mute' || target.id === 'settings' || ui.menuOpen);
    if (ui.screen === 'game' && fx.isBusy() && !utility) {
      fx.skip();
      return;
    }
    const view = lastView ?? refresh().view;
    if (e.pointerType === 'touch') ui = { ...ui, hover: target };
    const intent = targetToIntent(target, view);
    if (intent) {
      if (target?.kind === 'button' && intent.type !== 'toggleMute') sfx('uiClick');
      handle(intent);
    }
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    unlock();
    const view = lastView ?? refresh().view;
    const intent = keyToIntent(e.key, view);
    if (!intent) {
      if (fx.isBusy()) fx.skip();
      return;
    }
    e.preventDefault();
    handle(intent);
  };
  const onResize = (): void => {
    viewport = readViewport();
    renderer.resize(viewport);
  };

  // ----- frame loop ------------------------------------------------------------------------------------

  let raf = 0;
  let last = 0;
  let running = false;
  let errored = false;

  const frame = (t: number): void => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, t - last) : 16;
    last = t;
    try {
      if (ui.toast && t > toastUntil) ui = { ...ui, toast: null };
      const state = session?.state;
      if (ui.screen === 'game' && state && (state.phase === 'won' || state.phase === 'lost') && !ui.showResult && !fx.isBusy()) {
        ui = { ...ui, showResult: true, pendingFight: null };
        music(state.phase === 'lost' ? 'gameOver' : null);
      }
      const { view, layout } = refresh();
      fx.update(dt, layout);
      renderer.draw(view, layout, fx.frame(), t);
      errored = false;
    } catch (e) {
      if (!errored) console.error('[app] frame failed', e);
      errored = true;
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      renderer.mount(canvas);
      renderer.resize(viewport);
      applySettings();
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', onResize);
      window.visualViewport?.addEventListener('resize', onResize);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      for (const off of unsubscribers.splice(0)) safe(off);
      session = null;
      renderer.destroy();
      safe(() => audio.dispose());
    },
  };
}
