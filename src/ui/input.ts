/**
 * Input mapping: pointer targets and keys -> UiIntent. Pure; no DOM listeners here (app.ts owns those).
 */
import type { GameView, HitTarget, UiIntent } from './view';

export function targetToIntent(target: HitTarget | null, view: GameView): UiIntent | null {
  if (!target) return view.pendingFight ? { type: 'cancel' } : null;
  switch (target.kind) {
    case 'card':
      return view.room.some((rc) => rc?.card.id === target.cardId) ? { type: 'selectCard', cardId: target.cardId } : null;
    case 'weapon':
    case 'deck':
      return view.pendingFight ? { type: 'cancel' } : null;
    case 'button':
      switch (target.id) {
        case 'enter': return { type: 'enterRoom' };
        case 'avoid': return { type: 'avoidRoom' };
        case 'fightWeapon': return { type: 'chooseFight', mode: 'weapon' };
        case 'fightBarehanded': return { type: 'chooseFight', mode: 'barehanded' };
        case 'cancel': return { type: 'cancel' };
        case 'newGame': return { type: 'newGame' };
        case 'mute': return { type: 'toggleMute' };
        case 'settings': return { type: 'openSettings' };
        case 'crt': return { type: 'toggleCrt' };
        case 'motion': return { type: 'toggleReducedMotion' };
        case 'volDown': return { type: 'changeVolume', delta: -0.1 };
        case 'volUp': return { type: 'changeVolume', delta: 0.1 };
        case 'closeMenu': return { type: 'closeSettings' };
        // Design Review 2 tutorial buttons.
        case 'tutorial': return { type: 'tutorialStart' };
        case 'tutorialAccept': return { type: 'tutorialStart' };
        case 'tutorialDecline': return { type: 'tutorialDecline' };
        case 'tutorialNext': return { type: 'tutorialNext' };
        case 'tutorialSkip': return { type: 'tutorialSkip' };
        case 'tutorialPlayReal': return { type: 'tutorialPlayReal' };
        case 'tutorialReplay': return { type: 'tutorialStart' };
      }
  }
}

/** Keyboard: 1-4 slot, W/B fight choice, A avoid, Enter enter/start, M mute, N new game, S settings, C CRT,
 *  Esc cancel/close, Space skip. Tutorial (docs/TUTORIAL.md "Keyboard map"): T start (title), Enter accept (offer) /
 *  NEXT when shown / play a real run (recap), ArrowRight NEXT, X leave, R replay (recap), Esc decline (offer) /
 *  title (recap). N is ignored while the tutorial runs. */
export function keyToIntent(key: string, view: GameView): UiIntent | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const menu = view.chrome.menuOpen;
  const title = view.chrome.screen === 'title';
  const offer = title && view.chrome.tutorialOffer === true;
  const tutorial = !title ? view.chrome.tutorial ?? null : null;
  const recap = tutorial?.phase === 'recap';
  if (k === 'Escape') {
    if (menu) return { type: 'closeSettings' };
    if (offer) return { type: 'tutorialDecline' };
    if (view.pendingFight) return { type: 'cancel' };
    if (recap) return { type: 'tutorialSkip' };
    return null;
  }
  if (k === 'm') return { type: 'toggleMute' };
  if (k === 'c') return { type: 'toggleCrt' };
  if (k === 's') return menu ? { type: 'closeSettings' } : { type: 'openSettings' };
  if (menu) return null;
  if (offer) return k === 'Enter' || k === 't' ? { type: 'tutorialStart' } : null;
  if (title) {
    if (k === 't') return { type: 'tutorialStart' };
    return k === 'Enter' || k === ' ' || k === 'n' ? { type: 'newGame' } : null;
  }
  if (tutorial) {
    if (k === 'x') return { type: 'tutorialSkip' };
    if (k === 'n') return null;
    if (recap) {
      if (k === 'Enter') return { type: 'tutorialPlayReal' };
      if (k === 'r') return { type: 'tutorialStart' };
      return null;
    }
    const showNext = tutorial.coach?.showNext === true;
    if (k === 'ArrowRight') return showNext ? { type: 'tutorialNext' } : null;
    if (k === 'Enter' && showNext) return { type: 'tutorialNext' };
  }
  if (k === 'n') return { type: 'newGame' };
  // Result screen: Enter only (Space is the skip key and is often mashed during the final animation).
  if (view.chrome.showResult) return k === 'Enter' ? { type: 'newGame' } : null;
  if (k === ' ') return { type: 'skip' };
  if (k >= '1' && k <= '4') {
    const rc = view.room[Number(k) - 1];
    return rc ? { type: 'selectCard', cardId: rc.card.id } : null;
  }
  if (k === 'w') return view.pendingFight ? { type: 'chooseFight', mode: 'weapon' } : null;
  if (k === 'b') return view.pendingFight ? { type: 'chooseFight', mode: 'barehanded' } : null;
  if (k === 'a') return { type: 'avoidRoom' };
  if (k === 'Enter') return { type: 'enterRoom' };
  return null;
}
