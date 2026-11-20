/**
 * Web Audio engine implementation. Owner: Gaeta.
 *
 * Graph:  voices -> pan -> sfx bus ─┐
 *         sequencer -> music bus ───┴-> master -> mute -> compressor -> destination
 *
 * - The AudioContext is created lazily on unlock() (first user gesture), never at import time.
 * - Everything degrades to silent no-ops when Web Audio is missing or throws.
 * - Volumes and mute persist through the Settings contract (load/save merge, never clobbering other fields).
 * - Music requested before unlock is remembered and starts on unlock.
 */
import type { GameEvent } from '../game';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../ui/settings';
import { Sequencer } from './music';
import { SFX, createNoiseBuffer, type Voice } from './synth';
import type { AudioBus, AudioEngine, MusicId, PlayOptions, SfxId } from './types';

export interface AudioEngineOptions {
  /** Override context creation (tests). Return null for "no audio support". */
  readonly createContext?: () => AudioContext | null;
  /** Persist volume/mute via Settings. Default true. */
  readonly persist?: boolean;
}

/** Same SFX id retriggered faster than this is coalesced (skip() can land many cues in one frame). */
const RETRIGGER_S = 0.03;
const MAX_VOICES = 16;

function defaultContext(): AudioContext | null {
  try {
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
  } catch {
    return null;
  }
}

function safeLoadSettings(): Settings {
  try {
    return loadSettings();
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
/** Perceptual-ish volume curve. */
const curve = (v: number): number => v * v;

export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muteNode: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private failed = false;
  private disposed = false;

  private volumes: Record<AudioBus, number>;
  private muted: boolean;

  private seq: Sequencer | null = null;
  private wantedMusic: MusicId | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicSeed = 1;

  private readonly lastPlayed = new Map<SfxId, number>();
  private voiceEnds: number[] = [];
  private readonly onVisibility = (): void => this.handleVisibility();

  constructor(private readonly opts: AudioEngineOptions = {}) {
    const s = safeLoadSettings();
    this.volumes = { master: clamp01(s.masterVolume), sfx: clamp01(s.sfxVolume), music: clamp01(s.musicVolume) };
    this.muted = s.muted;
  }

  // ------------------------------------------------------------ lifecycle

  async unlock(): Promise<void> {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
      // iOS: a silent buffer played inside the gesture fully unlocks output.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
    } catch {
      // ignore: stays silent
    }
    if (this.wantedMusic && !this.seq && !this.musicTimer) this.startMusic(this.wantedMusic, 800);
  }

  async load(): Promise<void> {
    // Everything is synthesized; nothing to fetch. Prebuild the noise buffer if a context exists.
    if (this.ctx && !this.noiseBuf) {
      try {
        this.noiseBuf = createNoiseBuffer(this.ctx);
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearMusicTimer();
    this.seq?.stop(0);
    this.seq = null;
    try {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    } catch {
      // ignore
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.master = this.muteNode = this.sfxBus = this.musicBus = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  // ------------------------------------------------------------ sfx

  play(id: SfxId, opts: PlayOptions = {}): void {
    this.playAt(id, opts, 0);
  }

  private playAt(id: SfxId, opts: PlayOptions, delayS: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf || ctx.state !== 'running') return;
    try {
      const t0 = ctx.currentTime + 0.005 + delayS;
      const last = this.lastPlayed.get(id);
      if (last !== undefined && Math.abs(t0 - last) < RETRIGGER_S) return;
      this.voiceEnds = this.voiceEnds.filter((e) => e > ctx.currentTime);
      if (this.voiceEnds.length >= MAX_VOICES) return;
      this.lastPlayed.set(id, t0);

      const gain = ctx.createGain();
      gain.gain.value = clamp01(opts.gain ?? 1);
      let out: AudioNode = gain;
      if (opts.pan && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, opts.pan));
        gain.connect(p);
        out = p;
      }
      out.connect(this.sfxBus);
      const v: Voice = { ctx, out: gain, t0, pitch: Math.max(0.1, opts.pitch ?? 1), noise: this.noiseBuf };
      const len = SFX[id](v);
      this.voiceEnds.push(t0 + len);
      // Free the per-voice nodes once the sound is done.
      setTimeout(
        () => {
          try {
            gain.disconnect();
            if (out !== gain) out.disconnect();
          } catch {
            // ignore
          }
        },
        (delayS + len) * 1000 + 250,
      );
    } catch {
      // Never let audio break the game.
    }
  }

  // ------------------------------------------------------------ music

  playMusic(id: MusicId, opts: { readonly fadeMs?: number } = {}): void {
    this.clearMusicTimer();
    this.wantedMusic = id;
    if (this.seq?.id === id) return;
    this.startMusic(id, opts.fadeMs ?? 600);
  }

  stopMusic(opts: { readonly fadeMs?: number } = {}): void {
    this.clearMusicTimer();
    this.wantedMusic = null;
    this.seq?.stop(opts.fadeMs ?? 400);
    this.seq = null;
  }

  /** Start `id` after a delay (e.g. after a win/lose jingle). Cancelled by any other music call. */
  private playMusicLater(id: MusicId, delayMs: number): void {
    this.clearMusicTimer();
    this.wantedMusic = id;
    this.musicTimer = setTimeout(() => {
      this.musicTimer = null;
      if (this.wantedMusic === id) this.startMusic(id, 1200);
    }, delayMs);
  }

  private startMusic(id: MusicId, fadeMs: number): void {
    const ctx = this.ctx;
    this.seq?.stop(fadeMs);
    this.seq = null;
    if (!ctx || !this.musicBus || !this.noiseBuf || ctx.state !== 'running') return; // starts on unlock
    try {
      const seq = new Sequencer(ctx, this.musicBus, id, this.noiseBuf, this.musicSeed++);
      seq.start(fadeMs);
      this.seq = seq;
    } catch {
      this.seq = null;
    }
  }

  private clearMusicTimer(): void {
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  // ------------------------------------------------------------ volume / mute

  setVolume(bus: AudioBus, value: number): void {
    this.volumes[bus] = clamp01(value);
    this.applyGains();
    const key = bus === 'master' ? 'masterVolume' : bus === 'sfx' ? 'sfxVolume' : 'musicVolume';
    this.persist({ [key]: this.volumes[bus] });
  }

  getVolume(bus: AudioBus): number {
    return this.volumes[bus];
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains();
    this.persist({ muted });
  }

  isMuted(): boolean {
    return this.muted;
  }

  private persist(patch: Partial<Settings>): void {
    if (this.opts.persist === false) return;
    try {
      saveSettings({ ...safeLoadSettings(), ...patch });
    } catch {
      // storage unavailable: settings live for this session only
    }
  }

  private applyGains(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.muteNode || !this.sfxBus || !this.musicBus) return;
    try {
      const t = ctx.currentTime;
      this.master.gain.setTargetAtTime(curve(this.volumes.master), t, 0.02);
      this.sfxBus.gain.setTargetAtTime(curve(this.volumes.sfx), t, 0.02);
      this.musicBus.gain.setTargetAtTime(curve(this.volumes.music) * 0.55, t, 0.02);
      this.muteNode.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.015);
    } catch {
      // ignore
    }
  }

  // ------------------------------------------------------------ events

  handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'GameStarted':
        this.play('flip', { pitch: 0.7, gain: 0.6 });
        this.playMusic('dungeon', { fadeMs: 800 });
        return;
      case 'CardDealt':
        this.play('deal', { pitch: 0.94 + (e.slot % 4) * 0.045, pan: ((e.slot % 4) - 1.5) * 0.35 });
        return;
      case 'RoomRevealed':
        for (let i = 0; i < 4; i++) this.playAt('flip', { pitch: 1 + i * 0.06, gain: 0.8, pan: (i - 1.5) * 0.3 }, i * 0.06);
        return;
      case 'RoomEntered':
        this.play('uiClick', { gain: 0.7, pitch: 0.9 });
        return;
      case 'RoomAvoided':
        this.play('avoid');
        return;
      case 'MonsterFought':
        this.play('hitLight', { pitch: e.mode === 'weapon' ? 1.1 : 0.75, gain: e.mode === 'weapon' ? 1 : 0.85 });
        return;
      case 'DamageTaken':
        this.play('hitHeavy', {
          pitch: Math.max(0.7, Math.min(1.15, 1.15 - e.amount * 0.03)),
          gain: Math.min(1, 0.65 + e.amount * 0.025),
        });
        return;
      case 'MonsterSlain':
        this.play('slay', { pitch: Math.max(0.8, 1.2 - e.monster.rank * 0.02) });
        return;
      case 'WeaponEquipped':
        this.play('equip', { pitch: 0.9 + e.weapon.rank * 0.025 });
        return;
      case 'PotionUsed':
        this.play('heal', e.healed > 0 ? {} : { pitch: 0.85, gain: 0.6 });
        return;
      case 'PotionWasted':
        this.play('potionWasted');
        return;
      case 'RoomCleared':
        this.play('roomClear');
        return;
      case 'GameWon':
        this.stopMusic({ fadeMs: 250 });
        this.play('win');
        this.playMusicLater('title', 2200);
        return;
      case 'GameLost':
        this.stopMusic({ fadeMs: 150 });
        this.play('lose');
        this.playMusicLater('gameOver', 2200);
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------ internals

  private ensureContext(): AudioContext | null {
    if (this.ctx || this.failed || this.disposed) return this.ctx;
    try {
      const ctx = (this.opts.createContext ?? defaultContext)();
      if (!ctx) {
        this.failed = true;
        return null;
      }
      const master = ctx.createGain();
      const mute = ctx.createGain();
      const sfx = ctx.createGain();
      const music = ctx.createGain();
      sfx.connect(master);
      music.connect(master);
      master.connect(mute);
      let tail: AudioNode = mute;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 4;
        mute.connect(comp);
        tail = comp;
      }
      tail.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.muteNode = mute;
      this.sfxBus = sfx;
      this.musicBus = music;
      this.noiseBuf = createNoiseBuffer(ctx);
      // Set initial gains immediately (no ramp).
      master.gain.value = curve(this.volumes.master);
      sfx.gain.value = curve(this.volumes.sfx);
      music.gain.value = curve(this.volumes.music) * 0.55;
      mute.gain.value = this.muted ? 0 : 1;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
      return ctx;
    } catch {
      this.failed = true;
      this.ctx = null;
      return null;
    }
  }

  private handleVisibility(): void {
    const ctx = this.ctx;
    if (!ctx || typeof document === 'undefined') return;
    try {
      if (document.hidden) void ctx.suspend().catch(() => undefined);
      else void ctx.resume().catch(() => undefined);
    } catch {
      // ignore
    }
  }
}

export function createAudioEngineImpl(opts?: AudioEngineOptions): AudioEngine {
  return new WebAudioEngine(opts);
}
