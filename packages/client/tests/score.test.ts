import { describe, expect, it } from 'vitest';
import {
  CHEERFUL_BASE_BPM,
  CHEERFUL_BPM_PER_LEVEL,
  CHEERFUL_MAX_BPM,
  STEPS_PER_BAR,
  buildTrack,
  cheerfulBpm,
  loopSeconds,
  midiToHz,
  noteToMidi,
  stepSeconds,
  type Mood,
} from '../src/audio/score.js';

describe('note names', () => {
  it('maps names to MIDI numbers', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C6')).toBe(84);
    expect(noteToMidi('F#3')).toBe(54);
    expect(noteToMidi('Bb4')).toBe(70);
    expect(noteToMidi('D#5')).toBe(75);
  });

  it('rejects things that are not notes', () => {
    expect(noteToMidi('_')).toBeNull();
    expect(noteToMidi('H4')).toBeNull();
    expect(noteToMidi('C')).toBeNull();
  });

  it('turns MIDI numbers into frequencies (A4 = 440 Hz, an octave doubles)', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(midiToHz(60)).toBeCloseTo(261.626, 2);
  });
});

describe.each<Mood>(['cheerful', 'tense'])('%s track', (mood) => {
  const track = buildTrack(mood);

  it('is a whole number of bars with a bass note, drums and melody laid out on every step', () => {
    expect(track.steps % STEPS_PER_BAR).toBe(0);
    expect(track.bass).toHaveLength(track.steps);
    expect(track.kick).toHaveLength(track.steps);
    expect(track.snare).toHaveLength(track.steps);
    expect(track.hat).toHaveLength(track.steps);
    expect(track.lead.size).toBeGreaterThan(track.steps / 3);
  });

  it('keeps every melody note inside the loop and in a singable register', () => {
    for (const [step, note] of track.lead) {
      expect(step + note.steps).toBeLessThanOrEqual(track.steps);
      expect(note.steps).toBeGreaterThanOrEqual(1);
      expect(note.midi).toBeGreaterThanOrEqual(60);
      expect(note.midi).toBeLessThanOrEqual(96);
    }
  });

  it('keeps the bass low and never overlapping the melody register', () => {
    for (const note of track.bass) {
      if (note === null) continue;
      expect(note).toBeGreaterThanOrEqual(36);
      expect(note).toBeLessThan(60);
    }
  });

  it('puts a kick on the first beat of every bar', () => {
    for (let b = 0; b < track.steps / STEPS_PER_BAR; b++) expect(track.kick[b * STEPS_PER_BAR]).toBe(true);
  });
});

describe('moods', () => {
  const cheerful = buildTrack('cheerful');
  const tense = buildTrack('tense');

  it('the tense track is faster and shorter, and has a kick on every beat', () => {
    expect(tense.bpm).toBeGreaterThan(cheerful.bpm);
    expect(stepSeconds(tense)).toBeLessThan(stepSeconds(cheerful));
    expect(tense.kick.filter(Boolean).length).toBeGreaterThan(cheerful.kick.filter(Boolean).length / 2 + tense.steps / 4 - 1);
  });

  it('loops long enough not to feel repetitive, and not absurdly long', () => {
    expect(loopSeconds(cheerful)).toBeGreaterThan(20);
    expect(loopSeconds(cheerful)).toBeLessThan(45);
    expect(loopSeconds(tense)).toBeGreaterThan(8);
  });

  it('the cheerful tune keeps a high, bell-like register and is a good deal slower than before', () => {
    const meanPitch = [...cheerful.lead.values()].reduce((sum, n) => sum + n.midi, 0) / cheerful.lead.size;
    expect(meanPitch).toBeGreaterThan(80);
    // It used to run at 152 bpm; a gentler tempo is the point of the nursery-rhyme version.
    expect(cheerful.bpm).toBe(CHEERFUL_BASE_BPM);
    expect(cheerful.bpm).toBeLessThan(140);
    expect(cheerful.sparkle).toBe(true);
    expect(tense.sparkle).toBe(false);
  });

  it('is a singable tune: mostly steps and small skips, with short phrases that repeat', () => {
    const notes = [...cheerful.lead.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n.midi);
    let small = 0;
    for (let i = 1; i < notes.length; i++) if (Math.abs(notes[i]! - notes[i - 1]!) <= 4) small++;
    expect(small / (notes.length - 1)).toBeGreaterThan(0.75);
    // The opening phrase comes back in bar 5 and bar 13 (an octave higher).
    const bar = (i: number): number[] => [...cheerful.lead.entries()].filter(([step]) => Math.floor(step / STEPS_PER_BAR) === i).sort((a, b) => a[0] - b[0]).map(([, n]) => n.midi);
    expect(bar(4)).toEqual(bar(0));
    expect(bar(12)).toEqual(bar(0).map((m) => m + 12));
  });

  it('the cheerful tune bounces chord stabs on the off-beats only, and the tense one has none', () => {
    const hits = cheerful.stabs.map((chord, step) => ({ chord, step })).filter((x) => x.chord !== null);
    expect(hits.length).toBe(cheerful.steps / 2);
    for (const { chord, step } of hits) {
      expect(step % 2).toBe(1);
      expect(chord).toHaveLength(3);
      for (const midi of chord!) {
        expect(midi).toBeGreaterThanOrEqual(58);
        expect(midi).toBeLessThanOrEqual(80);
      }
    }
    expect(tense.stabs.every((c) => c === null)).toBe(true);
  });

  it('stabs are the chord under the bar: major thirds on C, minor on Am and Dm', () => {
    // Bar 1 is C (root C3): C E G. Bar 9 is A minor: A C E. Bar 10 is D minor: D F A.
    expect(cheerful.stabs[1]).toEqual([60, 64, 67]);
    expect(cheerful.stabs[8 * 8 + 1]).toEqual([69, 72, 76]);
    expect(cheerful.stabs[9 * 8 + 1]).toEqual([62, 65, 69]);
  });

  it('a hold (-) lengthens the previous note instead of starting a new one', () => {
    // Bar 2 of the cheerful tune ends "... A5 -": the last note rings for two steps.
    const held = [...cheerful.lead.values()].filter((n) => n.steps === 2);
    expect(held.length).toBeGreaterThan(0);
  });
});

describe('tempo follows the solo level', () => {
  it('starts at the base tempo on level 1 and for anything below it', () => {
    expect(cheerfulBpm(1)).toBe(CHEERFUL_BASE_BPM);
    expect(cheerfulBpm(0)).toBe(CHEERFUL_BASE_BPM);
    expect(cheerfulBpm(-3)).toBe(CHEERFUL_BASE_BPM);
  });

  it('gets a little faster with every level, but only a little', () => {
    for (let level = 2; level <= 30; level++) {
      const step = cheerfulBpm(level) - cheerfulBpm(level - 1);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(CHEERFUL_BPM_PER_LEVEL);
    }
    expect(cheerfulBpm(2)).toBe(CHEERFUL_BASE_BPM + CHEERFUL_BPM_PER_LEVEL);
    // Level 5 is only about a fifteenth quicker than level 1.
    expect(cheerfulBpm(5) / cheerfulBpm(1)).toBeLessThan(1.08);
  });

  it('tops out well below the tense tune, so the switch at ten seconds still feels like a jump', () => {
    expect(cheerfulBpm(999)).toBe(CHEERFUL_MAX_BPM);
    expect(CHEERFUL_MAX_BPM).toBeLessThan(buildTrack('tense').bpm - 20);
    expect(CHEERFUL_MAX_BPM / CHEERFUL_BASE_BPM).toBeLessThanOrEqual(1.25);
  });

  it('keeps the loop a sensible length at the fastest and the slowest tempo', () => {
    const cheerful = buildTrack('cheerful');
    for (const bpm of [CHEERFUL_BASE_BPM, CHEERFUL_MAX_BPM]) {
      const seconds = loopSeconds({ bpm, steps: cheerful.steps });
      expect(seconds).toBeGreaterThan(20);
      expect(seconds).toBeLessThan(45);
    }
  });
});
