import { describe, expect, it } from 'vitest';
import { GAMEPLAY, SOLO } from '../src/game/config.js';
import { generateBoard } from '../src/game/board.js';
import { findEscapableArrows } from '../src/game/rules.js';
import { applySoloMove, clampSoloLevel, createSoloState, soloLevelConfig, soloTimeLeftMs } from '../src/game/solo.js';
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

describe('solo level curve', () => {
  const levels = Array.from({ length: 30 }, (_, i) => i + 1);

  it('starts small and easy, and reaches the full map at the full-size level', () => {
    const first = soloLevelConfig(1);
    expect([first.rows, first.cols]).toEqual([SOLO.START_SIZE, SOLO.START_SIZE]);
    expect(SOLO.START_SIZE).toBe(24);
    expect(first.minLength).toBe(2);
    const full = soloLevelConfig(SOLO.FULL_SIZE_LEVEL);
    expect([full.rows, full.cols]).toEqual([GAMEPLAY.GRID_ROWS, GAMEPLAY.GRID_COLS]);
    expect(soloLevelConfig(SOLO.FULL_SIZE_LEVEL - 1).rows).toBeLessThan(GAMEPLAY.GRID_ROWS);
  });

  it('never gets easier: every knob moves only in the harder direction', () => {
    for (const level of levels.slice(1)) {
      const prev = soloLevelConfig(level - 1);
      const cur = soloLevelConfig(level);
      expect(cur.rows).toBeGreaterThanOrEqual(prev.rows);
      expect(cur.cols).toBeGreaterThanOrEqual(prev.cols);
      expect(cur.minLength).toBeGreaterThanOrEqual(prev.minLength);
      expect(cur.maxLength).toBeGreaterThanOrEqual(prev.maxLength);
      expect(cur.interlock).toBeGreaterThanOrEqual(prev.interlock);
      expect(cur.centerPull).toBeGreaterThanOrEqual(prev.centerPull);
      expect(cur.fill).toBeGreaterThanOrEqual(prev.fill);
      expect(cur.straightBias).toBeLessThanOrEqual(prev.straightBias);
    }
  });

  it('keeps getting harder after the map stops growing', () => {
    const atFull = soloLevelConfig(SOLO.FULL_SIZE_LEVEL);
    const later = soloLevelConfig(SOLO.FULL_SIZE_LEVEL + 6);
    expect(later.rows).toBe(atFull.rows);
    expect(later.straightBias).toBeLessThan(atFull.straightBias);
    expect(later.maxLength).toBeGreaterThan(atFull.maxLength);
    expect(later.centerPull).toBeGreaterThan(atFull.centerPull);
  });

  it('keeps stepping up until about level 20', () => {
    const a = soloLevelConfig(12);
    const b = soloLevelConfig(20);
    expect(b.maxLength).toBeGreaterThan(a.maxLength);
    expect(b.straightBias).toBeLessThan(a.straightBias);
    expect(b.centerPull).toBeGreaterThan(a.centerPull);
  });

  it('coerces nonsense levels into range', () => {
    expect(clampSoloLevel(undefined)).toBe(1);
    expect(clampSoloLevel(0)).toBe(1);
    expect(clampSoloLevel(-5)).toBe(1);
    expect(clampSoloLevel(3.9)).toBe(3);
    expect(clampSoloLevel(Number.NaN)).toBe(1);
    expect(clampSoloLevel('7')).toBe(1);
    expect(clampSoloLevel(10 ** 9)).toBe(SOLO.MAX_LEVEL);
  });

  it('generates a solvable board of the right size, with no one-cell arrows, at every level', () => {
    for (const level of [1, 2, 5, 8, 11, 12, 20, 30]) {
      const c = soloLevelConfig(level);
      const b = generateBoard(c);
      expect(b.rows).toBe(c.rows);
      expect(b.cols).toBe(c.cols);
      expect(b.arrows.every((a) => a.cells.length >= 2)).toBe(true);
      const remaining = new Set(b.arrows.map((a) => a.id));
      while (remaining.size > 0) {
        const free = findEscapableArrows(b, remaining);
        expect(free.length).toBeGreaterThan(0);
        for (const a of free) remaining.delete(a.id);
      }
    }
  });

  it('puts more arrows on the board as the levels go up', () => {
    const count = (level: number): number => {
      let total = 0;
      for (let i = 0; i < 6; i++) total += generateBoard(soloLevelConfig(level)).arrows.length;
      return total / 6;
    };
    expect(count(SOLO.FULL_SIZE_LEVEL)).toBeGreaterThan(count(1) + 15);
    expect(count(10)).toBeGreaterThan(count(SOLO.FULL_SIZE_LEVEL) + 10);
  });

  it('starts sparse enough to be a friendly first level', () => {
    const arrows = generateBoard(soloLevelConfig(1)).arrows.length;
    expect(arrows).toBeGreaterThan(30);
    expect(arrows).toBeLessThan(65);
  });
});
