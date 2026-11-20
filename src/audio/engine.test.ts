import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../game';
import { createAudioEngine } from './types';

const events: GameEvent[] = [
  { type: 'GameStarted', seed: 1, hp: 20, deckSize: 44 },
  { type: 'CardDealt', card: { id: 'S10', suit: 'spades', rank: 10 }, slot: 0, deckRemaining: 43 },
  { type: 'GameLost', score: -10, remainingMonsters: [] },
];

describe('AudioEngine without Web Audio (Node)', () => {
  it('degrades to silent no-ops and never throws', async () => {
    const audio = createAudioEngine({ persist: false });
    await expect(audio.unlock()).resolves.toBeUndefined();
    await expect(audio.load()).resolves.toBeUndefined();
    expect(() => {
      audio.play('deal', { pitch: 1.2, pan: -0.5, gain: 0.5 });
      audio.playMusic('dungeon', { fadeMs: 100 });
      audio.stopMusic();
      for (const e of events) audio.handleEvent(e);
    }).not.toThrow();
    audio.dispose();
  });

  it('tracks volume (clamped) and mute independently', () => {
    const audio = createAudioEngine({ persist: false });
    audio.setVolume('music', 2);
    audio.setVolume('sfx', -1);
    audio.setVolume('master', 0.25);
    expect(audio.getVolume('music')).toBe(1);
    expect(audio.getVolume('sfx')).toBe(0);
    expect(audio.getVolume('master')).toBe(0.25);
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.getVolume('master')).toBe(0.25);
    audio.dispose();
  });

  it('treats a throwing context factory as no audio support', async () => {
    const audio = createAudioEngine({
      persist: false,
      createContext: () => {
        throw new Error('blocked');
      },
    });
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(() => audio.play('win')).not.toThrow();
    audio.dispose();
  });
});
