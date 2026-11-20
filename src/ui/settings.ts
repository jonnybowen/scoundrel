/**
 * Player settings, persisted to localStorage (key 'scoundrel.settings.v1'). CONTRACT. Owner: Starbuck (UI), consumed by Gaeta.
 * Storage access must be wrapped in try/catch; defaults apply when storage is unavailable.
 */
import { notImplemented } from '../notImplemented';

export interface Settings {
  readonly muted: boolean;
  readonly masterVolume: number; // 0..1
  readonly sfxVolume: number; // 0..1
  readonly musicVolume: number; // 0..1
  readonly crtEnabled: boolean;
  readonly reducedMotion: boolean; // defaults from prefers-reduced-motion
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  masterVolume: 0.8,
  sfxVolume: 1,
  musicVolume: 0.6,
  crtEnabled: true,
  reducedMotion: false,
};

export function loadSettings(): Settings {
  return notImplemented('loadSettings', 'Starbuck');
}

export function saveSettings(_s: Settings): void {
  notImplemented('saveSettings', 'Starbuck');
}
