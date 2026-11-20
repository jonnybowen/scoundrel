/**
 * Audio (Web Audio API). CONTRACT. Owner: Gaeta.
 *
 * - One AudioContext, created lazily and resumed on the first user gesture (browser autoplay policy).
 * - Bus graph: sfx -> master, music -> master -> destination. Volumes 0..1, mute is separate from volume.
 * - SFX are triggered from FxCue (animation-synced), never directly from engine dispatch.
 * - Never throws if audio is unavailable; degrades to silence.
 */
import { createAudioEngineImpl, type AudioEngineOptions } from './engine';
import type { GameEvent } from '../game';

export type SfxId =
  | 'deal'
  | 'flip'
  | 'hitLight'
  | 'hitHeavy'
  | 'slay'
  | 'equip'
  | 'heal'
  | 'potionWasted'
  | 'avoid'
  | 'roomClear'
  | 'uiHover'
  | 'uiClick'
  | 'uiDenied'
  | 'win'
  | 'lose';

/**
 * Design Review 2 (Gaeta): tutorial SFX. Merge into SfxId when the voices land in synth.ts (SFX is an exhaustive
 * Record<SfxId, ...>, so they live here until then). Played by ui/app from TutorialController signals, not FxCues:
 *  - coachBlip: soft two-note blip when new coach text or a nudge appears (quiet, under uiClick level).
 *  - stepSuccess: short rising chime when an action step completes (distinct from roomClear and win).
 *  - tutorialComplete: brief fanfare on the recap screen (shorter than win; win still plays on GameWon).
 */
export type TutorialSfxId = 'coachBlip' | 'stepSuccess' | 'tutorialComplete';

export type MusicId = 'title' | 'dungeon' | 'gameOver';

export type AudioBus = 'master' | 'sfx' | 'music';

export interface PlayOptions {
  /** Playback-rate multiplier for pitch variation (juice). Default 1. */
  readonly pitch?: number;
  /** Per-call gain 0..1. Default 1. */
  readonly gain?: number;
  /** Stereo pan -1..1 (e.g. by card slot). Default 0. */
  readonly pan?: number;
}

export interface AudioEngine {
  /** Call from a user-gesture handler. Safe to call repeatedly. */
  unlock(): Promise<void>;
  /** Preload/decode assets. Resolves even if some fail. */
  load(): Promise<void>;
  play(id: SfxId, opts?: PlayOptions): void;
  playMusic(id: MusicId, opts?: { readonly fadeMs?: number }): void;
  stopMusic(opts?: { readonly fadeMs?: number }): void;
  setVolume(bus: AudioBus, value: number): void;
  getVolume(bus: AudioBus): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Map a landed game event to sound (called from FxDirector.onCue). */
  handleEvent(event: GameEvent): void;
  dispose(): void;
}

/** `opts` is optional and additive (tests inject a context factory or disable persistence). */
export function createAudioEngine(opts?: AudioEngineOptions): AudioEngine {
  return createAudioEngineImpl(opts);
}
