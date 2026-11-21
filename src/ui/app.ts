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
import type { TutorialQuery, TutorialChrome } from '../tutorial';
import { createTutorialController } from './tutorialController';
import type { TutorialSignal } from './tutorialController';
import { createAudioEngine } from '../audio/types';
import type { AudioEngine, MusicId, PlayOptions, SfxId } from '../audio/types';
import { createFxDirector } from '../fx/types';
import type { FxDirector } from '../fx/types';
import { computeLayout, createRenderer } from '../render/types';
import type { Renderer, Viewport } from '../render/types';
import { createNeutralFx, createSilentAudio } from './fallbacks';
import { keyToIntent, targetToIntent } from './input';
import { attachAutosave, browserStorage, restoreRun } from './save';
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
    tutorial: null,
    tutorialOffer: !settings.tutorialSeen,
  };
  let toastUntil = 0;
  const tutorial = createTutorialController();
  let firstSeed = opts.seed;
  /** Resume-on-reload storage (src/ui/save.ts). null when localStorage is missing or throws: the app just won't resume. */
  const runStorage = browserStorage();

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
  const sfx = (id: SfxId, opts?: PlayOptions): void => safe(() => audio.play(id, opts));
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

  // Tutorial presentation signals (docs/TUTORIAL.md "Audio and FX cues"). Cosmetic only: never touches isBusy().
  const onTutorialSignal = (sig: TutorialSignal): void => {
    switch (sig.type) {
      case 'coachShown':
        sfx('coachBlip');
        break;
      case 'stepSucceeded':
        sfx('stepSuccess');
        break;
      case 'nudged':
        sfx('coachBlip', { pitch: 0.8 });
        break;
      case 'completed':
        sfx('tutorialComplete');
        music(null);
        break;
    }
    safe(() => fx.tutorialCue?.(sig.type));
  };
  unsubscribers.push(tutorial.onSignal(onTutorialSignal));

  /** Persist that the first-launch offer has been answered (the app is the single Settings writer). */
  const markTutorialSeen = (): void => {
    if (!settings.tutorialSeen) updateSettings({ tutorialSeen: true });
  };

  // ----- session ---------------------------------------------------------------------------------------

  let session: GameSession | null = null;

  const ensureSession = (seed: number): GameSession => {
    if (session) return session;
    const created = createSession({ seed });
    // createSession does not broadcast its opening events: subscribe first, then newGame to get the deal.
    // Integration point 2: the tutorial hears every accepted batch, after FX has queued it.
    unsubscribers.push(
      created.subscribe((events, state) => {
        fx.enqueue(events);
        if (tutorial.active) safe(() => tutorial.onEvents(events, state));
      }),
    );
    // Resume-on-reload: every batch saves the run (or clears it when finished, scripted, or not reproducible).
    safe(() => unsubscribers.push(attachAutosave(created, runStorage, () => tutorial.active)));
    session = created;
    return created;
  };

  const newGame = (seed?: number): void => {
    const s = seed ?? firstSeed ?? (Math.floor(Math.random() * 0x100000000) >>> 0);
    firstSeed = undefined;
    tutorial.exit();
    try {
      const sess = ensureSession(s);
      // Finish whatever the previous run was still animating so its tweens/ghosts don't bleed into the new deal.
      safe(() => fx.skip());
      sess.newGame({ seed: s });
      ui = { ...ui, screen: 'game', menuOpen: false, pendingFight: null, showResult: false, error: null, hover: null, tutorial: null };
      music('dungeon');
    } catch (e) {
      console.error('[app] could not start a game', e);
      session = null;
      ui = { ...ui, screen: 'title', error: 'RULES ENGINE UNAVAILABLE' };
    }
  };

  /** Integration point 1: the scripted tutorial dungeon (createGame({ deck })) instead of a shuffled one. */
  const startTutorialRun = (): void => {
    markTutorialSeen();
    try {
      const sess = ensureSession(firstSeed ?? 1);
      safe(() => fx.skip());
      tutorial.start(sess);
      ui = { ...ui, screen: 'game', menuOpen: false, pendingFight: null, showResult: false, error: null, hover: null, toast: null };
      music('dungeon');
    } catch (e) {
      console.error('[app] could not start the tutorial', e);
      tutorial.exit();
      ui = { ...ui, screen: 'title', error: 'TUTORIAL UNAVAILABLE', tutorial: null };
    }
  };

  /** SKIP / X / LEAVE TUTORIAL / recap Esc: straight to the title, no confirmation. */
  const leaveTutorial = (): void => {
    markTutorialSeen();
    tutorial.exit();
    safe(() => fx.skip());
    ui = { ...ui, screen: 'title', menuOpen: false, pendingFight: null, showResult: false, hover: null, toast: null, tutorial: null };
    currentMusic = null;
    music('title');
  };

  /**
   * Boot: rebuild the last unfinished real run from storage. Seeded boots (?seed=, e2e) never resume. On failure the
   * save is cleared by restoreRun and the title stays up. Never throws: a broken storage still boots.
   */
  const tryResume = (): void => {
    if (opts.seed !== undefined) return;
    try {
      const run = restoreRun(ensureSession(0), runStorage);
      if (!run.ok) {
        if (run.reason !== 'none') console.warn('[app] could not resume the saved run:', run.reason, run.error ?? '');
        return;
      }
      // session.replay broadcast one combined batch: land on the final state instead of animating it.
      safe(() => fx.skip());
      ui = { ...ui, screen: 'game', menuOpen: false, pendingFight: null, showResult: false, error: null, hover: null, tutorial: null };
      music('dungeon');
    } catch (e) {
      console.warn('[app] resume failed', e);
      ui = { ...ui, screen: 'title' };
    }
  };
  tryResume();

  /**
   * Integration point 3 (gate): may the player do this in the tutorial right now? A blocked move never reaches the
   * engine: the coach shows a nudge with a soft blip. No toast, no uiDenied, no HP cost.
   */
  const tutorialAllows = (query: TutorialQuery): boolean => {
    if (!tutorial.active || !session) return true;
    const g = tutorial.gate(query, session.state);
    if (g.allowed) return true;
    tutorial.block(g.nudge);
    return false;
  };

  const dispatch = (action: GameAction): void => {
    const sess = session;
    if (!sess) return;
    if (!tutorialAllows(action)) return;
    const res = sess.dispatch(action);
    if (res.ok) return;
    if (res.violation.code === 'modeRequired') {
      ui = { ...ui, pendingFight: res.violation.cardId };
      return;
    }
    // The gate let it through and the engine refused: in the script only the avoid-twice lesson gets here.
    if (tutorial.active) safe(() => tutorial.onViolation(action, res.violation, sess.state));
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
    const safeArea = readSafeArea();
    return {
      cssWidth: w,
      cssHeight: h,
      devicePixelRatio: window.devicePixelRatio || 1,
      orientation: h > w ? 'portrait' : 'landscape',
      ...(safeArea ? { safeArea } : {}),
    };
  }

  /**
   * Safe-area insets in CSS px: the larger of env(safe-area-inset-*) (needs viewport-fit=cover) and Capacitor's
   * injected --safe-area-inset-* variables (its SystemBars plugin sets them from the cutout insets, which older
   * WebViews do not expose through env()). Read through a hidden probe's computed padding.
   */
  function readSafeArea(): Viewport['safeArea'] | null {
    const doc = canvas.ownerDocument;
    const win = doc.defaultView;
    if (!doc.body || !win) return null;
    let probe = doc.getElementById('safe-probe');
    if (!probe) {
      probe = doc.createElement('div');
      probe.id = 'safe-probe';
      probe.setAttribute('aria-hidden', 'true');
      const side = (s: string): string => `max(env(safe-area-inset-${s}, 0px), var(--safe-area-inset-${s}, 0px))`;
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
        + `padding:${side('top')} ${side('right')} ${side('bottom')} ${side('left')};`;
      doc.body.appendChild(probe);
    }
    const cs = win.getComputedStyle(probe);
    const px = (v: string): number => Math.max(0, parseFloat(v) || 0);
    const inset = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    return inset.top || inset.right || inset.bottom || inset.left ? inset : null;
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

  /** fx.isBusy() as passed to tutorial.chrome() by the last refresh(): true means the mirrored text is latched. */
  let chromeLatched = false;
  const refresh = (): { view: GameView; layout: LayoutSnapshot } => {
    // Integration point 4: coach chrome (latched while FX presents) and the first-launch offer.
    let chrome: TutorialChrome | null = null;
    // Whether this frame's coach text is the latched copy; #coach-live may only report ready for live text.
    chromeLatched = fx.isBusy();
    if (tutorial.active && ui.screen === 'game') {
      try {
        chrome = tutorial.chrome(chromeLatched);
      } catch (e) {
        console.error('[app] tutorial chrome failed', e);
      }
    }
    ui = { ...ui, tutorial: chrome, tutorialOffer: ui.screen === 'title' && !settings.tutorialSeen };
    const view = buildView();
    const layout = computeLayout(view, viewport);
    lastView = view;
    lastLayout = layout;
    return { view, layout };
  };

  // ----- intents ---------------------------------------------------------------------------------------

  const handle = (intent: UiIntent): void => {
    const view = lastView ?? refresh().view;
    if ((GAME_ACTIONS.has(intent.type) || intent.type === 'tutorialNext') && fx.isBusy()) {
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
        // Gate the tap itself, before the weapon/fists choice opens (docs/TUTORIAL.md "Gating" rule 3).
        if (!tutorialAllows({ type: 'select', cardId: intent.cardId })) {
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
        const action: GameAction = { type: 'playCard', cardId: id, mode: intent.mode };
        // A refused mode (fists on the lethal Ace) keeps the choice open so the player can pick the sword.
        if (!tutorialAllows(action)) return;
        ui = { ...ui, pendingFight: null };
        dispatch(action);
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
        if (tutorial.active) return; // N is ignored in the tutorial; a real run starts from the recap or the title.
        sfx('uiClick');
        newGame(intent.seed);
        return;
      // Integration point 5: tutorial intents (+ tutorialSeen persistence).
      case 'tutorialStart':
        sfx('uiClick');
        startTutorialRun();
        return;
      case 'tutorialNext':
        tutorial.next();
        return;
      case 'tutorialSkip':
        leaveTutorial();
        return;
      case 'tutorialDecline':
        sfx('uiClick');
        markTutorialSeen();
        return;
      case 'tutorialPlayReal':
        sfx('uiClick');
        markTutorialSeen();
        newGame();
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
    const utility =
      target?.kind === 'button' && (target.id === 'mute' || target.id === 'settings' || target.id === 'tutorialSkip' || ui.menuOpen);
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
    // Rebuild lastLayout now: the renderer already maps taps with the new CSS size, so a tap before the next frame
    // must hit-test against the new logical size and rects, not the previous ones.
    refresh();
  };
  // Capacitor injects --safe-area-inset-* on <html> after load and on rotation, without a resize event.
  const insetObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onResize);

  // ----- #coach-live (screen readers + e2e hook; docs/TUTORIAL.md "Accessibility and test hook") ----------

  const coachLive = ((): HTMLElement | null => {
    const doc = canvas.ownerDocument;
    let el = doc.getElementById('coach-live');
    if (!el && doc.body) {
      el = doc.createElement('div');
      el.id = 'coach-live';
      el.setAttribute('aria-live', 'polite');
      el.className = 'visually-hidden';
      doc.body.appendChild(el);
    }
    return el;
  })();
  let coachLiveKey = '';
  const mirrorCoach = (view: GameView): void => {
    if (!coachLive) return;
    const t = view.chrome.screen === 'game' ? view.chrome.tutorial ?? null : null;
    // Ready = the text mirrored this frame is live (refresh() ran with FX idle, so not latched) AND FX is still idle,
    // so the next key will be gated, not swallowed by skip. Checking only fx.isBusy() here (after fx.update) would
    // flag the just-finished step's latched text as ready on the frame FX goes idle (docs/TUTORIAL.md).
    const ready = t !== null && !chromeLatched && !fx.isBusy();
    let text = '';
    let attrs: [string, string][] = [];
    if (t?.phase === 'recap' && t.recap) {
      text = [t.recap.title, `SCORE ${t.recap.score}: ${t.recap.scoreText}`, ...t.recap.lines].join(' ');
      attrs = [['data-phase', 'recap'], ['data-step', 'recap'], ['data-page', '0']];
    } else if (t?.coach) {
      const c = t.coach;
      text = [`LESSON ${c.lesson} OF ${c.lessonCount}: ${c.title}.`, c.text, c.nudge ?? ''].filter((x) => x).join(' ');
      attrs = [['data-phase', t.phase], ['data-step', c.stepId], ['data-page', String(c.page)]];
    }
    if (t) attrs.push(['data-ready', ready ? 'true' : 'false']);
    const key = `${text}|${attrs.map((a) => a.join('=')).join(',')}`;
    if (key === coachLiveKey) return;
    coachLiveKey = key;
    coachLive.textContent = text;
    for (const a of ['data-phase', 'data-step', 'data-page', 'data-ready']) coachLive.removeAttribute(a);
    for (const [k, v] of attrs) coachLive.setAttribute(k, v);
  };

  /** e2e hook: a compact run summary on the canvas (data-screen, data-phase, data-hp, data-room, data-fx). */
  let runKey = '';
  const mirrorRun = (view: GameView): void => {
    const game = view.chrome.screen === 'game';
    const attrs: [string, string][] = [
      ['data-screen', view.chrome.screen],
      ['data-phase', game ? view.phase : ''],
      ['data-hp', game ? String(view.hp) : ''],
      ['data-room', game ? view.room.map((rc) => rc?.card.id ?? '-').join(',') : ''],
      ['data-fx', fx.isBusy() ? 'busy' : 'idle'],
    ];
    const key = attrs.map((a) => a[1]).join('|');
    if (key === runKey) return;
    runKey = key;
    for (const [k, v] of attrs) canvas.setAttribute(k, v);
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
      // The tutorial shows its recap (from chrome.tutorial) instead of the normal result panel.
      if (ui.screen === 'game' && !tutorial.active && state && (state.phase === 'won' || state.phase === 'lost') && !ui.showResult && !fx.isBusy()) {
        ui = { ...ui, showResult: true, pendingFight: null };
        music(state.phase === 'lost' ? 'gameOver' : null);
      }
      const { view, layout } = refresh();
      fx.update(dt, layout);
      renderer.draw(view, layout, fx.frame(), t);
      mirrorCoach(view);
      mirrorRun(view);
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
      insetObserver?.observe(canvas.ownerDocument.documentElement, { attributes: true, attributeFilter: ['style'] });
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
      insetObserver?.disconnect();
      for (const off of unsubscribers.splice(0)) safe(off);
      tutorial.exit();
      session = null;
      renderer.destroy();
      safe(() => audio.dispose());
    },
  };
}
