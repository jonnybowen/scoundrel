/**
 * Player settings, persisted to localStorage (key 'scoundrel.settings.v1'). CONTRACT. Owner: Starbuck (UI), consumed by Gaeta.
 * Storage access must be wrapped in try/catch; defaults apply when storage is unavailable.
 */

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

export const SETTINGS_KEY = 'scoundrel.settings.v1';

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

export function loadSettings(): Settings {
  const defaults: Settings = { ...DEFAULT_SETTINGS, reducedMotion: prefersReducedMotion() };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {
    return defaults;
  }
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    return {
      muted: bool(p.muted, defaults.muted),
      masterVolume: clamp01(p.masterVolume, defaults.masterVolume),
      sfxVolume: clamp01(p.sfxVolume, defaults.sfxVolume),
      musicVolume: clamp01(p.musicVolume, defaults.musicVolume),
      crtEnabled: bool(p.crtEnabled, defaults.crtEnabled),
      reducedMotion: bool(p.reducedMotion, defaults.reducedMotion),
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode, quota): settings live for this session only.
  }
}
