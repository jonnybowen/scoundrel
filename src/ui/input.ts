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
        // Design Review 2 tutorial buttons (only laid out once the tutorial is wired).
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
 *  Esc cancel/close, Space skip. */
export function keyToIntent(key: string, view: GameView): UiIntent | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const menu = view.chrome.menuOpen;
  const title = view.chrome.screen === 'title';
  if (k === 'Escape') return menu ? { type: 'closeSettings' } : view.pendingFight ? { type: 'cancel' } : null;
  if (k === 'm') return { type: 'toggleMute' };
  if (k === 'c') return { type: 'toggleCrt' };
  if (k === 's') return menu ? { type: 'closeSettings' } : { type: 'openSettings' };
  if (menu) return null;
  if (k === 'n') return { type: 'newGame' };
  if (title) return k === 'Enter' || k === ' ' ? { type: 'newGame' } : null;
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
