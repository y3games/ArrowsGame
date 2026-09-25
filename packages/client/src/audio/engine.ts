import { buildTrack, cheerfulBpm, stepSeconds, type Mood, type Track } from './score.js';
import {
  noiseBuffer,
  playBlockedSfx,
  playCountdownSfx,
  playDrawSfx,
  playGoSfx,
  playLoseSfx,
  playRemoveSfx,
  playRoundDrawSfx,
  playRoundLoseSfx,
  playRoundWinSfx,
  playTurnMineSfx,
  playTurnOppSfx,
  playWinSfx,
  scheduleStep,
} from './synth.js';

const MUTE_KEY = 'arrows.muted';
const MUSIC_LEVEL = 0.45;
const SFX_LEVEL = 1;
const MASTER_LEVEL = 0.5;
/** How far ahead of the clock notes are handed to the audio thread, and how often we top that up. */
const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;
const FADE_S = 0.25;

/**
 * remove/blocked: an arrow left / a tap on a blocked one. turn-mine/turn-opp: the turn changed
 * hands. countdown/go: the pre-round (or pre-run) countdown. round-*: a round ended.
 * win/lose/draw: the whole match, or a solo run, ended.
 */
export type SfxKind =
  | 'remove'
  | 'blocked'
  | 'turn-mine'
  | 'turn-opp'
  | 'countdown'
  | 'go'
  | 'round-win'
  | 'round-lose'
  | 'round-draw'
  | 'win'
  | 'lose'
  | 'draw';

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
  /** The solo level, which nudges the cheerful tune's tempo up; 1 everywhere outside a solo run. */
  private level = 1;
  private muted = readMuted();
  private listeners = new Set<() => void>();
  private sfxPlayed = 0;
  /** The most recent effects, oldest first — only for tests to look at. */
  private sfxLog: SfxKind[] = [];

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
      player.nextTime += stepSeconds({ bpm: this.bpmFor(player.mood, player.track) });
      player.step = (player.step + 1) % player.track.steps;
    }
  }

  /** The tempo a tune is played at right now — the tense one never changes, the cheerful one follows the level. */
  private bpmFor(mood: Mood, track: Track): number {
    return mood === 'cheerful' ? cheerfulBpm(this.level) : track.bpm;
  }

  /** Called with the solo level when a run starts (and 1 when it ends): the music picks up the pace a little per level. */
  setLevel(level: number): void {
    this.level = Math.max(1, Math.floor(level));
  }

  /** Which tune should be playing. Cheap to call every frame — it only does anything on a change. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.switchTo(mood);
  }

  /**
   * `own` is false for the opponent's removals (lower and quieter). `delay` postpones the sound a
   * little, so two effects triggered by the same event do not pile on top of each other.
   */
  playSfx(kind: SfxKind, own = true, delay = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    const noise = this.noise;
    if (!ctx || !bus || !noise || ctx.state !== 'running') return;
    const start = ctx.currentTime + 0.005 + delay;
    switch (kind) {
      case 'remove': playRemoveSfx(ctx, bus, noise, start, own); break;
      case 'blocked': playBlockedSfx(ctx, bus, start); break;
      case 'turn-mine': playTurnMineSfx(ctx, bus, start); break;
      case 'turn-opp': playTurnOppSfx(ctx, bus, start); break;
      case 'countdown': playCountdownSfx(ctx, bus, start); break;
      case 'go': playGoSfx(ctx, bus, start); break;
      case 'round-win': playRoundWinSfx(ctx, bus, start); break;
      case 'round-lose': playRoundLoseSfx(ctx, bus, start); break;
      case 'round-draw': playRoundDrawSfx(ctx, bus, start); break;
      case 'win': playWinSfx(ctx, bus, start); break;
      case 'lose': playLoseSfx(ctx, bus, start); break;
      case 'draw': playDrawSfx(ctx, bus, start); break;
    }
    this.sfxPlayed++;
    this.sfxLog.push(kind);
    if (this.sfxLog.length > 60) this.sfxLog.shift();
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
  debugState(): { state: string; mood: Mood; playing: Mood | null; bpm: number | null; muted: boolean; sfxPlayed: number; sfxLog: SfxKind[] } {
    return {
      state: this.ctx?.state ?? 'locked',
      mood: this.mood,
      playing: this.player?.mood ?? null,
      bpm: this.player ? this.bpmFor(this.player.mood, this.player.track) : null,
      muted: this.muted,
      sfxPlayed: this.sfxPlayed,
      sfxLog: [...this.sfxLog],
    };
  }
}

/** The one engine for the page. */
export const audio = new AudioEngine();
