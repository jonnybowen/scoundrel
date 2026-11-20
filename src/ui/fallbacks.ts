/**
 * Neutral stand-ins used by the app when a collaborator module is unavailable (stub throws, no Web Audio...).
 * They keep the game playable: identity FX (cards snap to layout, cues fire immediately) and silent audio.
 */
import type { GameEvent } from '../game';
import type { AudioEngine } from '../audio/types';
import type { FxCue, FxDirector, FxFrame } from '../fx/types';

export const NEUTRAL_FX_FRAME: FxFrame = {
  cards: new Map(),
  shake: { x: 0, y: 0 },
  screenFlash: null,
  hud: {},
  popups: [],
  crtPulse: 0,
};

export function createNeutralFx(): FxDirector {
  const listeners = new Set<(cue: FxCue) => void>();
  return {
    enqueue(events: readonly GameEvent[]) {
      events.forEach((event, index) => listeners.forEach((l) => l({ event, index })));
    },
    update() {},
    frame: () => NEUTRAL_FX_FRAME,
    isBusy: () => false,
    skip() {},
    onCue(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setReducedMotion() {},
  };
}

export function createSilentAudio(): AudioEngine {
  let muted = false;
  const vol = { master: 1, sfx: 1, music: 1 };
  return {
    unlock: () => Promise.resolve(),
    load: () => Promise.resolve(),
    play() {},
    playMusic() {},
    stopMusic() {},
    setVolume(bus, v) {
      vol[bus] = v;
    },
    getVolume: (bus) => vol[bus],
    setMuted(m) {
      muted = m;
    },
    isMuted: () => muted,
    handleEvent() {},
    dispose() {},
  };
}
