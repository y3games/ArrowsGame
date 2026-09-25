import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '../src/game/config.js';
import { applyMove, createRoundState, getRoundWinner, isRoundOver, otherSlot, passTurn } from '../src/game/roundState.js';
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

const START = 1_000;

function newRound(first: 0 | 1 = 0) {
  return createRoundState(board, first, START);
}

describe('round state (turn-based, shared board)', () => {
  it('opens with the shorter first turn', () => {
    const s = newRound();
    expect(s.turn).toBe(0);
    expect(s.turnEndsAt).toBe(START + GAMEPLAY.FIRST_TURN_MS);
    expect(s.scores).toEqual([0, 0]);
  });

  it('removes a free arrow, scores a point and keeps the turn', () => {
    const s = newRound();
    const outcome = applyMove(s, 0, 'y', START + 100);
    expect(outcome).toEqual({ type: 'removed', arrowId: 'y', remaining: 2, finished: false });
    expect(s.scores).toEqual([1, 0]);
    expect(s.turn).toBe(0);
    expect(s.remainingIds.has('y')).toBe(false);
  });

  it('lets one turn remove several arrows in a row', () => {
    const s = newRound();
    applyMove(s, 0, 'y', START + 100);
    applyMove(s, 0, 'x', START + 200);
    expect(applyMove(s, 0, 'z', START + 300)).toMatchObject({ type: 'removed', finished: true });
    expect(s.scores).toEqual([3, 0]);
    expect(isRoundOver(s)).toBe(true);
  });

  it('costs a point and ends the turn at once on a blocked arrow', () => {
    const s = newRound();
    const now = START + 700;
    expect(applyMove(s, 0, 'x', now)).toEqual({ type: 'blocked', arrowId: 'x' });
    expect(s.scores).toEqual([-1, 0]);
    expect(s.turn).toBe(1);
    expect(s.turnEndsAt).toBe(now + GAMEPLAY.TURN_MS);
    expect(s.remainingIds.has('x')).toBe(true);
  });

  it('rejects a move made out of turn without changing anything', () => {
    const s = newRound();
    expect(applyMove(s, 1, 'y', START + 100)).toEqual({ type: 'rejected', reason: 'not-your-turn' });
    expect(s.scores).toEqual([0, 0]);
    expect(s.remainingIds.size).toBe(3);
  });

  it('rejects moves before the countdown ends', () => {
    expect(applyMove(newRound(), 0, 'y', START - 1)).toEqual({ type: 'rejected', reason: 'not-started' });
  });

  it('rejects a move that arrives after the turn has run out', () => {
    const s = newRound();
    expect(applyMove(s, 0, 'y', START + GAMEPLAY.FIRST_TURN_MS)).toEqual({ type: 'rejected', reason: 'turn-expired' });
    expect(s.scores).toEqual([0, 0]);
  });

  it('rejects a repeat tap on an arrow that is already gone, and unknown ids', () => {
    const s = newRound();
    applyMove(s, 0, 'y', START + 100);
    expect(applyMove(s, 0, 'y', START + 200)).toEqual({ type: 'rejected', reason: 'already-removed' });
    expect(applyMove(s, 0, 'nope', START + 200)).toEqual({ type: 'rejected', reason: 'unknown-arrow' });
    expect(s.scores).toEqual([1, 0]);
  });

  it('passes the turn with no penalty and a full turn for the next player', () => {
    const s = newRound();
    const now = START + GAMEPLAY.FIRST_TURN_MS + 5;
    passTurn(s, now);
    expect(s.turn).toBe(1);
    expect(s.turnEndsAt).toBe(now + GAMEPLAY.TURN_MS);
    expect(s.scores).toEqual([0, 0]);
    expect(applyMove(s, 1, 'y', now + 10)).toMatchObject({ type: 'removed' });
  });

  it('lets a removal by one player free an arrow for the other', () => {
    const s = newRound();
    applyMove(s, 0, 'x', START + 100); // blocked -> turn passes to player 1
    applyMove(s, 1, 'y', START + 200); // removes the blocker
    passTurn(s, START + 15_000);
    expect(applyMove(s, 0, 'x', START + 15_100)).toMatchObject({ type: 'removed', arrowId: 'x' });
  });

  it('gives the round to the higher score and calls equal scores a draw', () => {
    const s = newRound();
    expect(getRoundWinner(s)).toBeNull();
    s.scores = [3, 1];
    expect(getRoundWinner(s)).toBe(0);
    s.scores = [-1, 0];
    expect(getRoundWinner(s)).toBe(1);
  });

  it('otherSlot flips the slot', () => {
    expect(otherSlot(0)).toBe(1);
    expect(otherSlot(1)).toBe(0);
  });
});
