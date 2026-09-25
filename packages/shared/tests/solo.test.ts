import { describe, expect, it } from 'vitest';
import { SOLO } from '../src/game/config.js';
import { applySoloMove, createSoloState, soloTimeLeftMs } from '../src/game/solo.js';
import type { Board } from '../src/game/types.js';

/**
 * 2x3 board:  x -> y   .
 *             .  .   z(v)
 * x (0,0) points right at y (0,1), so it is blocked until y is gone; y points up and leaves at
 * once; z (1,2) points down and leaves at once.
 */
const board: Board = {
  rows: 2,
  cols: 3,
  arrows: [
    { id: 'x', cells: [{ row: 0, col: 0 }], dir: 'right' },
    { id: 'y', cells: [{ row: 0, col: 1 }], dir: 'up' },
    { id: 'z', cells: [{ row: 1, col: 2 }], dir: 'down' },
  ],
};

const START = 10_000;
const newGame = () => createSoloState(board, START);

describe('solo clock', () => {
  it('gives the full three minutes, and holds it during the countdown', () => {
    expect(SOLO.TIME_LIMIT_MS).toBe(180_000);
    expect(soloTimeLeftMs(newGame(), START - 2_000)).toBe(SOLO.TIME_LIMIT_MS);
    expect(soloTimeLeftMs(newGame(), START)).toBe(SOLO.TIME_LIMIT_MS);
  });

  it('counts down in real time and stops at zero', () => {
    expect(soloTimeLeftMs(newGame(), START + 45_000)).toBe(SOLO.TIME_LIMIT_MS - 45_000);
    expect(soloTimeLeftMs(newGame(), START + SOLO.TIME_LIMIT_MS + 5_000)).toBe(0);
  });

  it('takes ten seconds off for every mistake', () => {
    const s = newGame();
    s.mistakes = 2;
    expect(soloTimeLeftMs(s, START + 30_000)).toBe(SOLO.TIME_LIMIT_MS - 30_000 - 2 * SOLO.PENALTY_MS);
  });
});

describe('solo moves', () => {
  it('removes a free arrow and keeps the time', () => {
    const s = newGame();
    expect(applySoloMove(s, 'y', START + 1_000)).toEqual({
      type: 'removed',
      arrowId: 'y',
      remaining: 2,
      finished: false,
      timeLeftMs: SOLO.TIME_LIMIT_MS - 1_000,
    });
    expect(s.mistakes).toBe(0);
  });

  it('costs ten seconds on a blocked arrow and leaves the board alone', () => {
    const s = newGame();
    const out = applySoloMove(s, 'x', START + 5_000);
    expect(out).toEqual({
      type: 'blocked',
      arrowId: 'x',
      mistakes: 1,
      timeLeftMs: SOLO.TIME_LIMIT_MS - 5_000 - SOLO.PENALTY_MS,
      timedOut: false,
    });
    expect(s.remainingIds.size).toBe(3);
  });

  it('stacks penalties', () => {
    const s = newGame();
    applySoloMove(s, 'x', START + 1_000);
    const out = applySoloMove(s, 'x', START + 2_000);
    expect(out).toMatchObject({ type: 'blocked', mistakes: 2, timeLeftMs: SOLO.TIME_LIMIT_MS - 2_000 - 2 * SOLO.PENALTY_MS });
  });

  it('finishes when the last arrow goes', () => {
    const s = newGame();
    applySoloMove(s, 'y', START + 100);
    applySoloMove(s, 'x', START + 200);
    expect(applySoloMove(s, 'z', START + 300)).toMatchObject({ type: 'removed', remaining: 0, finished: true });
    expect(applySoloMove(s, 'z', START + 400)).toEqual({ type: 'rejected', reason: 'finished' });
  });

  it('runs out of time when a mistake eats the last seconds', () => {
    const s = newGame();
    const now = START + SOLO.TIME_LIMIT_MS - 4_000;
    expect(applySoloMove(s, 'x', now)).toMatchObject({ type: 'blocked', timeLeftMs: 0, timedOut: true });
    expect(applySoloMove(s, 'y', now + 10)).toEqual({ type: 'rejected', reason: 'time-up' });
  });

  it('rejects taps before the countdown ends, after time is up, and on bad ids', () => {
    expect(applySoloMove(newGame(), 'y', START - 1)).toEqual({ type: 'rejected', reason: 'not-started' });
    expect(applySoloMove(newGame(), 'y', START + SOLO.TIME_LIMIT_MS)).toEqual({ type: 'rejected', reason: 'time-up' });
    const s = newGame();
    expect(applySoloMove(s, 'nope', START + 1)).toEqual({ type: 'rejected', reason: 'unknown-arrow' });
    applySoloMove(s, 'y', START + 2);
    expect(applySoloMove(s, 'y', START + 3)).toEqual({ type: 'rejected', reason: 'already-removed' });
  });
});
