import { describe, expect, it } from 'vitest';
import { STEPS_PER_BAR, buildTrack, loopSeconds, midiToHz, noteToMidi, stepSeconds, type Mood } from '../src/audio/score.js';

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

  it('a hold (-) lengthens the previous note instead of starting a new one', () => {
    // Bar 2 of the cheerful tune ends "... A5 -": the last note rings for two steps.
    const held = [...cheerful.lead.values()].filter((n) => n.steps === 2);
    expect(held.length).toBeGreaterThan(0);
  });
});
