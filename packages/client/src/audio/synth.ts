import { midiToHz, stepSeconds, type Track } from './score.js';

/**
 * The instruments and sound effects. Everything takes a `BaseAudioContext`, so the same code
 * plays live through an `AudioContext` and renders offline through an `OfflineAudioContext`
 * (which is how the sounds are checked for silence and clipping without anyone listening).
 * All sound is synthesized here — there are no audio files to download.
 */

interface ToneOptions {
  freq: number;
  start: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  attack?: number;
  release?: number;
  /** Low-pass cutoff in Hz; softens harsh waveforms. */
  cutoff?: number;
  /** Frequency the note glides to by its end (for sweeps and pops). */
  glideTo?: number;
}

export function playTone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOptions): void {
  const attack = o.attack ?? 0.005;
  const release = o.release ?? 0.06;
  const end = o.start + o.duration;

  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, o.start);
  if (o.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), end);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, o.start);
  amp.gain.linearRampToValueAtTime(o.gain, o.start + attack);
  amp.gain.setValueAtTime(o.gain, Math.max(o.start + attack, end - 0.01));
  amp.gain.exponentialRampToValueAtTime(0.0001, end + release);

  let tail: AudioNode = osc;
  if (o.cutoff !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.cutoff;
    osc.connect(filter);
    tail = filter;
  }
  tail.connect(amp).connect(dest);
  osc.start(o.start);
  osc.stop(end + release + 0.02);
}

/** One second of white noise, made once per context and shared by every drum hit. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

interface NoiseOptions {
  start: number;
  duration: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  /** Frequency the filter sweeps to by the end. */
  sweepTo?: number;
}

function playNoise(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, o: NoiseOptions): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.freq, o.start);
  if (o.sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, o.start + o.duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(o.gain, o.start);
  amp.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration);
  src.connect(filter).connect(amp).connect(dest);
  src.start(o.start);
  src.stop(o.start + o.duration + 0.02);
}

export function playKick(ctx: BaseAudioContext, dest: AudioNode, start: number, gain: number): void {
  playTone(ctx, dest, { freq: 150, glideTo: 45, start, duration: 0.14, type: 'sine', gain, attack: 0.002, release: 0.04 });
}

export function playSnare(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, start: number, gain: number): void {
  playNoise(ctx, dest, noise, { start, duration: 0.13, gain, filter: 'highpass', freq: 1800 });
  playTone(ctx, dest, { freq: 190, glideTo: 120, start, duration: 0.08, type: 'triangle', gain: gain * 0.5, attack: 0.002, release: 0.03 });
}

export function playHat(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, start: number, gain: number): void {
  playNoise(ctx, dest, noise, { start, duration: 0.045, gain, filter: 'highpass', freq: 7000 });
}

/** Everything the track plays on one step of its grid, scheduled to sound at `time`. */
export function scheduleStep(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, track: Track, step: number, time: number): void {
  const stepLen = stepSeconds(track);
  const tense = track.mood === 'tense';

  const lead = track.lead.get(step);
  if (lead) {
    playTone(ctx, dest, {
      freq: midiToHz(lead.midi),
      start: time,
      duration: lead.steps * stepLen * 0.92,
      type: track.leadWave,
      gain: tense ? 0.07 : 0.085,
      cutoff: tense ? 2600 : 3200,
    });
  }

  const bass = track.bass[step];
  if (bass !== null && bass !== undefined) {
    playTone(ctx, dest, { freq: midiToHz(bass), start: time, duration: stepLen * 0.85, type: 'triangle', gain: tense ? 0.22 : 0.2, attack: 0.008 });
  }

  if (track.kick[step]) playKick(ctx, dest, time, tense ? 0.5 : 0.42);
  if (track.snare[step]) playSnare(ctx, dest, noise, time, tense ? 0.14 : 0.12);
  if (track.hat[step]) playHat(ctx, dest, noise, time, tense ? 0.06 : 0.045);
}

/**
 * An arrow slides out: a bright upward swoosh that ends in a little "ding". The opponent's arrows
 * sound the same but lower and quieter, so you can tell whose tap it was without looking.
 */
export function playRemoveSfx(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, start: number, own: boolean): void {
  const level = own ? 1 : 0.55;
  const pitch = own ? 1 : 0.8;
  playNoise(ctx, dest, noise, { start, duration: 0.17, gain: 0.32 * level, filter: 'bandpass', freq: 500 * pitch, sweepTo: 4200 * pitch });
  playTone(ctx, dest, { freq: 520 * pitch, glideTo: 980 * pitch, start, duration: 0.11, type: 'sine', gain: 0.3 * level, attack: 0.003 });
  playTone(ctx, dest, { freq: 1568 * pitch, start: start + 0.09, duration: 0.09, type: 'triangle', gain: 0.16 * level, attack: 0.003, release: 0.09 });
}

/** A tap on a blocked arrow: a dull thud and a falling buzz — clearly "no". Same for both players. */
export function playBlockedSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playTone(ctx, dest, { freq: 200, glideTo: 70, start, duration: 0.16, type: 'sine', gain: 0.5, attack: 0.002, release: 0.05 });
  playTone(ctx, dest, { freq: 185, glideTo: 104, start, duration: 0.3, type: 'sawtooth', gain: 0.22, cutoff: 900, attack: 0.004, release: 0.08 });
  playTone(ctx, dest, { freq: 138, glideTo: 78, start: start + 0.11, duration: 0.24, type: 'square', gain: 0.1, cutoff: 700, attack: 0.004, release: 0.08 });
}

/** A short two-note chime going up: "it's your turn". */
export function playTurnMineSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playTone(ctx, dest, { freq: 659.25, start, duration: 0.09, type: 'sine', gain: 0.3, attack: 0.004, release: 0.07 });
  playTone(ctx, dest, { freq: 987.77, start: start + 0.09, duration: 0.16, type: 'sine', gain: 0.3, attack: 0.004, release: 0.14 });
  playTone(ctx, dest, { freq: 1975.5, start: start + 0.09, duration: 0.1, type: 'triangle', gain: 0.07, attack: 0.004, release: 0.1 });
}

/** One low, soft tick: the turn went to the opponent. Quiet on purpose — it is not your move. */
export function playTurnOppSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playTone(ctx, dest, { freq: 311.13, glideTo: 261.63, start, duration: 0.11, type: 'triangle', gain: 0.2, attack: 0.004, release: 0.08 });
}

/** A beep for each second of the pre-round countdown. */
export function playCountdownSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playTone(ctx, dest, { freq: 880, start, duration: 0.09, type: 'square', gain: 0.1, cutoff: 3000, attack: 0.003, release: 0.05 });
  playTone(ctx, dest, { freq: 880, start, duration: 0.09, type: 'sine', gain: 0.2, attack: 0.003, release: 0.05 });
}

/** The countdown reached zero: a longer, higher two-beep "go!". */
export function playGoSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  for (const [offset, freq] of [[0, 1318.5], [0.11, 1760]] as const) {
    playTone(ctx, dest, { freq, start: start + offset, duration: offset === 0 ? 0.09 : 0.3, type: 'square', gain: 0.1, cutoff: 3600, attack: 0.003, release: 0.1 });
    playTone(ctx, dest, { freq, start: start + offset, duration: offset === 0 ? 0.09 : 0.3, type: 'sine', gain: 0.24, attack: 0.003, release: 0.1 });
  }
}

/** Notes played one after another, each `gap` seconds apart. */
function playRun(ctx: BaseAudioContext, dest: AudioNode, start: number, notes: number[], gap: number, options: Omit<ToneOptions, 'freq' | 'start'>): void {
  notes.forEach((freq, i) => playTone(ctx, dest, { ...options, freq, start: start + i * gap }));
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, G4 = 392, E4 = 329.63, D4 = 293.66, C4 = 261.63, B3 = 246.94;

/** A round is won: a quick bright arpeggio going up. */
export function playRoundWinSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playRun(ctx, dest, start, [C5, E5, G5, C6], 0.085, { duration: 0.12, type: 'triangle', gain: 0.3, attack: 0.004, release: 0.1 });
  playTone(ctx, dest, { freq: C6 * 2, start: start + 0.26, duration: 0.2, type: 'sine', gain: 0.08, attack: 0.004, release: 0.2 });
}

/** A round is lost: three notes stepping down, soft and a little sad. */
export function playRoundLoseSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playRun(ctx, dest, start, [G4, E4, C4], 0.14, { duration: 0.16, type: 'triangle', gain: 0.3, attack: 0.006, release: 0.12 });
}

/** A drawn round: two level notes — neither up nor down. */
export function playRoundDrawSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playRun(ctx, dest, start, [E5, E5], 0.16, { duration: 0.13, type: 'triangle', gain: 0.26, attack: 0.005, release: 0.1 });
}

/** The whole match (or solo run) is won: a fanfare that ends on a held chord. */
export function playWinSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playRun(ctx, dest, start, [C5, C5, C5, G5], 0.11, { duration: 0.1, type: 'square', gain: 0.09, cutoff: 3200, attack: 0.004, release: 0.06 });
  const chordAt = start + 0.5;
  for (const freq of [C5, E5, G5, C6]) {
    playTone(ctx, dest, { freq, start: chordAt, duration: 0.9, type: 'triangle', gain: 0.17, attack: 0.01, release: 0.4 });
    playTone(ctx, dest, { freq, start: chordAt, duration: 0.9, type: 'square', gain: 0.035, cutoff: 2600, attack: 0.01, release: 0.4 });
  }
}

/** The whole match (or solo run) is lost: a slow fall ending on a low, held note. */
export function playLoseSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playRun(ctx, dest, start, [E4, D4, C4, B3], 0.2, { duration: 0.2, type: 'triangle', gain: 0.32, attack: 0.008, release: 0.15 });
  playTone(ctx, dest, { freq: 130.81, glideTo: 98, start: start + 0.8, duration: 0.9, type: 'sawtooth', gain: 0.12, cutoff: 500, attack: 0.02, release: 0.4 });
}

/** A drawn match: a settled, neutral two-chord "ok, that's that". */
export function playDrawSfx(ctx: BaseAudioContext, dest: AudioNode, start: number): void {
  playRun(ctx, dest, start, [G4, C5], 0.22, { duration: 0.3, type: 'triangle', gain: 0.28, attack: 0.008, release: 0.25 });
}
