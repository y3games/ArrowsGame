/**
 * The background music as data, MIDI-style: notes are written out bar by bar and a sequencer
 * plays them (see `engine.ts`). Nothing here touches the Web Audio API, so it is plain, testable
 * data — the sound itself is made by `synth.ts`.
 *
 * A bar is eight eighth-note steps. A step is a note name (`E5`, `F#4`, `Bb3`), `_` for a rest
 * or `-` to keep the previous note ringing.
 */

export type Mood = 'cheerful' | 'tense';

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" → 60, "A5" → 81, "F#3" → 54, "Bb4" → 70. Returns null for anything that is not a note name. */
export function noteToMidi(name: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return 12 * (Number(octave) + 1) + SEMITONE[letter!]! + shift;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export const STEPS_PER_BAR = 8;

interface BarDef {
  /** Eight steps of the melody. */
  lead: string;
  /** Root of the chord under this bar, in the bass register. */
  root: string;
}

type BassStyle = 'oompah' | 'drive';
type DrumStyle = 'bouncy' | 'urgent';

interface TrackDef {
  bpm: number;
  leadWave: OscillatorType;
  bassStyle: BassStyle;
  drumStyle: DrumStyle;
  bars: BarDef[];
}

const bar = (root: string, lead: string): BarDef => ({ root, lead });

/**
 * Cheerful: C major, bouncy, 16 bars (about half a minute) that loop forever. The first eight
 * bars state the tune, the last eight answer it and turn back to the start.
 */
const CHEERFUL: TrackDef = {
  bpm: 132,
  leadWave: 'square',
  bassStyle: 'oompah',
  drumStyle: 'bouncy',
  bars: [
    bar('C3', 'E5 G5 C6 G5 E5 G5 E5 D5'),
    bar('A2', 'C5 E5 A5 E5 C5 E5 A5 -'),
    bar('F2', 'F5 A5 C6 A5 F5 A5 G5 F5'),
    bar('G2', 'G5 B5 D6 B5 G5 B5 D6 -'),
    bar('C3', 'E5 G5 C6 G5 E5 G5 E5 D5'),
    bar('A2', 'C5 E5 A5 E5 A5 C6 B5 A5'),
    bar('F2', 'F5 A5 C6 A5 G5 F5 E5 D5'),
    bar('G2', 'G5 B5 D6 B5 G5 F5 E5 D5'),
    bar('F2', 'A5 - A5 C6 A5 F5 A5 -'),
    bar('G2', 'B5 - B5 D6 B5 G5 B5 -'),
    bar('C3', 'C6 - C6 E6 C6 G5 E5 G5'),
    bar('A2', 'E5 A5 C6 A5 E6 - C6 A5'),
    bar('F2', 'F5 A5 C6 F6 - E6 D6 C6'),
    bar('G2', 'D6 - B5 G5 B5 D6 - -'),
    bar('C3', 'C6 E6 G6 E6 C6 G5 E5 C5'),
    bar('C3', 'C5 - E5 - G5 - _ _'),
  ],
};

/**
 * Tense: A minor with an E major dominant, faster, a heartbeat kick on every beat and a bass that
 * never lets up. Eight bars, also a loop. It replaces the cheerful tune for the last seconds of a
 * solo run.
 */
const TENSE: TrackDef = {
  bpm: 172,
  leadWave: 'sawtooth',
  bassStyle: 'drive',
  drumStyle: 'urgent',
  bars: [
    bar('A2', 'E5 _ E5 _ E5 F5 E5 D#5'),
    bar('A2', 'E5 _ A5 _ E5 _ C6 B5'),
    bar('F2', 'F5 _ F5 _ F5 G5 F5 E5'),
    bar('E2', 'G#5 _ B5 _ E6 _ D#6 _'),
    bar('A2', 'A5 _ A5 C6 E6 _ D6 C6'),
    bar('A2', 'B5 _ B5 D6 F6 _ E6 D6'),
    bar('F2', 'C6 _ C6 A5 F5 _ A5 C6'),
    bar('E2', 'B5 _ G#5 _ B5 _ E6 -'),
  ],
};

const DEFS: Record<Mood, TrackDef> = { cheerful: CHEERFUL, tense: TENSE };

/** One melody note, placed on the step grid. */
export interface LeadNote {
  midi: number;
  /** How many steps it rings for (a `-` extends the previous note). */
  steps: number;
}

export interface Track {
  mood: Mood;
  bpm: number;
  leadWave: OscillatorType;
  /** Total steps in one pass of the loop. */
  steps: number;
  /** Melody notes by the step they start on. */
  lead: Map<number, LeadNote>;
  /** Bass MIDI note per step, or null for a rest. */
  bass: (number | null)[];
  kick: boolean[];
  snare: boolean[];
  hat: boolean[];
}

const BASS_PATTERN: Record<BassStyle, (root: number) => (number | null)[]> = {
  // Root and fifth on the beat: "oom-pah".
  oompah: (r) => [r, null, r + 7, null, r, null, r + 7, null],
  // Pounding eighths with the octave jumping in on the off-beats.
  drive: (r) => [r, r, r + 12, r, r, r, r + 12, r],
};

const DRUM_PATTERN: Record<DrumStyle, { kick: number[]; snare: number[]; hat: number[] }> = {
  bouncy: { kick: [0, 4], snare: [2, 6], hat: [1, 3, 5, 7] },
  urgent: { kick: [0, 2, 4, 6], snare: [6, 7], hat: [0, 1, 2, 3, 4, 5, 6, 7] },
};

/** Turns the written-out bars into a step-by-step track ready for the sequencer. */
export function buildTrack(mood: Mood): Track {
  const def = DEFS[mood];
  const steps = def.bars.length * STEPS_PER_BAR;
  const lead = new Map<number, LeadNote>();
  const bass: (number | null)[] = [];
  const kick = new Array<boolean>(steps).fill(false);
  const snare = new Array<boolean>(steps).fill(false);
  const hat = new Array<boolean>(steps).fill(false);
  const drums = DRUM_PATTERN[def.drumStyle];

  let ringing: LeadNote | null = null;
  def.bars.forEach((b, barIndex) => {
    const tokens = b.lead.trim().split(/\s+/);
    if (tokens.length !== STEPS_PER_BAR) throw new Error(`${mood} bar ${barIndex + 1}: expected ${STEPS_PER_BAR} steps, got ${tokens.length}`);
    const root = noteToMidi(b.root);
    if (root === null) throw new Error(`${mood} bar ${barIndex + 1}: bad root ${b.root}`);
    bass.push(...BASS_PATTERN[def.bassStyle](root));

    tokens.forEach((token, i) => {
      const step = barIndex * STEPS_PER_BAR + i;
      if (token === '_') {
        ringing = null;
      } else if (token === '-') {
        if (ringing) ringing.steps += 1;
      } else {
        const midi = noteToMidi(token);
        if (midi === null) throw new Error(`${mood} bar ${barIndex + 1}: bad note ${token}`);
        ringing = { midi, steps: 1 };
        lead.set(step, ringing);
      }
    });
    for (const i of drums.kick) kick[barIndex * STEPS_PER_BAR + i] = true;
    for (const i of drums.snare) snare[barIndex * STEPS_PER_BAR + i] = true;
    for (const i of drums.hat) hat[barIndex * STEPS_PER_BAR + i] = true;
  });

  return { mood, bpm: def.bpm, leadWave: def.leadWave, steps, lead, bass, kick, snare, hat };
}

/** Seconds per step: an eighth note. */
export function stepSeconds(track: Pick<Track, 'bpm'>): number {
  return 60 / track.bpm / 2;
}

/** How long one pass of the loop lasts. */
export function loopSeconds(track: Pick<Track, 'bpm' | 'steps'>): number {
  return track.steps * stepSeconds(track);
}
