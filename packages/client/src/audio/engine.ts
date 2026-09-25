import { buildTrack, stepSeconds, type Mood, type Track } from './score.js';
import { noiseBuffer, playBlockedSfx, playRemoveSfx, scheduleStep } from './synth.js';

const MUTE_KEY = 'arrows.muted';
const MUSIC_LEVEL = 0.45;
const SFX_LEVEL = 1;
const MASTER_LEVEL = 0.5;
/** How far ahead of the clock notes are handed to the audio thread, and how often we top that up. */
const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;
const FADE_S = 0.25;

export type SfxKind = 'remove' | 'blocked';

interface Player {
  mood: Mood;
  track: Track;
  gain: GainNode;
  step: number;
  nextTime: number;
  timer: ReturnType<typeof setInterval>;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Background music (a looping sequencer) and the sound effects, all synthesized live.
 *
 * Browsers refuse to make sound until the player has interacted with the page, so nothing is
 * created before the first click/key press (`attach`). Until then `setMood` just remembers what
 * to play, and effects are dropped.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private tracks = new Map<Mood, Track>();
  private player: Player | null = null;
  private mood: Mood = 'cheerful';
  private muted = readMuted();
  private listeners = new Set<() => void>();
  private sfxPlayed = 0;

  /** Starts listening for the first user gesture, which is what allows sound at all. */
  attach(): void {
    const unlock = (): void => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        for (const type of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(type, unlock, true);
      }
    };
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, true);

    // A hidden tab throttles timers, which would leave gaps in the music; just pause it instead.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
      this.master.connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = MUSIC_LEVEL;
      this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = SFX_LEVEL;
      this.sfxBus.connect(this.master);
      this.noise = noiseBuffer(ctx);
    }
    void this.ctx.resume().then(() => this.startMusic());
  }

  private track(mood: Mood): Track {
    let track = this.tracks.get(mood);
    if (!track) {
      track = buildTrack(mood);
      this.tracks.set(mood, track);
    }
    return track;
  }

  /** Begins the music for the current mood, if the context is allowed to play and nothing is playing yet. */
  private startMusic(): void {
    if (this.player && this.player.mood === this.mood) return;
    this.switchTo(this.mood);
  }

  private switchTo(mood: Mood): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.noise || ctx.state !== 'running') return;

    // The old tune fades out while the new one starts from its first beat.
    const old = this.player;
    if (old) {
      clearInterval(old.timer);
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_S);
      setTimeout(() => old.gain.disconnect(), (FADE_S + 0.5) * 1000);
    }

    const gain = ctx.createGain();
    gain.connect(this.musicBus);
    const track = this.track(mood);
    const player: Player = {
      mood,
      track,
      gain,
      step: 0,
      nextTime: ctx.currentTime + 0.06,
      timer: setInterval(() => this.tick(player), TICK_MS),
    };
    this.player = player;
    this.tick(player);
  }

  private tick(player: Player): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    // If the tab was suspended for a while the clock has run on: skip ahead rather than play catch-up.
    if (player.nextTime < ctx.currentTime) player.nextTime = ctx.currentTime + 0.02;
    while (player.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      scheduleStep(ctx, player.gain, this.noise, player.track, player.step, player.nextTime);
      player.nextTime += stepSeconds(player.track);
      player.step = (player.step + 1) % player.track.steps;
    }
  }

  /** Which tune should be playing. Cheap to call every frame — it only does anything on a change. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.switchTo(mood);
  }

  playSfx(kind: SfxKind, own = true): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise || ctx.state !== 'running') return;
    const start = ctx.currentTime + 0.005;
    if (kind === 'remove') playRemoveSfx(ctx, this.sfxBus, this.noise, start, own);
    else playBlockedSfx(ctx, this.sfxBus, start);
    this.sfxPlayed++;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Storage unavailable: the choice just won't survive a reload.
    }
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.03);
    }
    for (const listener of this.listeners) listener();
  }

  onMuteChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Dev/test only: what the engine is doing right now. */
  debugState(): { state: string; mood: Mood; playing: Mood | null; muted: boolean; sfxPlayed: number } {
    return {
      state: this.ctx?.state ?? 'locked',
      mood: this.mood,
      playing: this.player?.mood ?? null,
      muted: this.muted,
      sfxPlayed: this.sfxPlayed,
    };
  }
}

/** The one engine for the page. */
export const audio = new AudioEngine();
