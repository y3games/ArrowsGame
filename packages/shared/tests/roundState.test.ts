import { describe, expect, it } from 'vitest';
import type { Board } from '../src/game/types.js';
import { applyAttempt, createRoundState } from '../src/game/roundState.js';

/**
 * Two-arrow board where B is always escapable and A is escapable only once B is gone —
 * gives full control over correct/wrong ordering for these timing tests.
 */
function makeTwoArrowBoard(): Board {
  return {
    rows: 1,
    cols: 2,
    arrows: [
      { id: 'A', row: 0, col: 0, dir: 'right' }, // blocked while B is present
      { id: 'B', row: 0, col: 1, dir: 'right' }, // path runs off the board — always clear
    ],
  };
}

describe('applyAttempt', () => {
  it('credits real elapsed time when every click lands within its window', () => {
    const state = createRoundState(makeTwoArrowBoard(), 0);

    const first = applyAttempt(state, 'B', 3000);
    expect(first).toEqual({ type: 'correct', arrowId: 'B', remaining: 1, finished: false, elapsedMs: undefined });

    const second = applyAttempt(state, 'A', 5000);
    expect(second).toEqual({ type: 'correct', arrowId: 'A', remaining: 0, finished: true, elapsedMs: 5000 });
  });

  it('locks input for the remainder of the window after an early wrong click', () => {
    const state = createRoundState(makeTwoArrowBoard(), 0);

    const wrong = applyAttempt(state, 'A', 1000); // A is blocked by B -> wrong
    expect(wrong).toEqual({ type: 'wrong', arrowId: 'A', lockedUntil: 10_000 });

    const duringLock = applyAttempt(state, 'B', 5000);
    expect(duringLock).toEqual({ type: 'rejected', reason: 'locked' });

    const afterLock = applyAttempt(state, 'B', 10_000);
    expect(afterLock).toEqual({ type: 'correct', arrowId: 'B', remaining: 1, finished: false, elapsedMs: undefined });

    const finish = applyAttempt(state, 'A', 13_000);
    // Total time (13s) = 10s burned on the failed attempt + 3s for the two real successes after it.
    expect(finish).toEqual({ type: 'correct', arrowId: 'A', remaining: 0, finished: true, elapsedMs: 13_000 });
  });

  it('rolls the window forward on a pure timeout (no click at all) with no extra penalty beyond the 10s already spent', () => {
    const state = createRoundState(makeTwoArrowBoard(), 0);

    // Nobody clicked during [0, 10000) — the very first click arrives at 15s.
    const result = applyAttempt(state, 'B', 15_000);
    expect(result).toEqual({ type: 'correct', arrowId: 'B', remaining: 1, finished: false, elapsedMs: undefined });

    const finish = applyAttempt(state, 'A', 16_000);
    expect(finish).toEqual({ type: 'correct', arrowId: 'A', remaining: 0, finished: true, elapsedMs: 16_000 });
  });

  it('rejects a click on an arrow that was already removed', () => {
    const state = createRoundState(makeTwoArrowBoard(), 0);
    applyAttempt(state, 'B', 1000);
    expect(applyAttempt(state, 'B', 2000)).toEqual({ type: 'rejected', reason: 'already-removed' });
  });

  it('rejects a click on an arrow id that does not exist on the board', () => {
    const state = createRoundState(makeTwoArrowBoard(), 0);
    expect(applyAttempt(state, 'nope', 1000)).toEqual({ type: 'rejected', reason: 'unknown-arrow' });
  });
});
