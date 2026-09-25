import { describe, expect, it } from 'vitest';
import { findEscapableArrows, isEscapable, occupiedCells } from '../src/game/rules.js';
import type { Board } from '../src/game/types.js';

/**
 * 4x4 board. Snake "a" lies along row 1 (cols 0-2) with its head at (1,2) pointing right, straight
 * at (1,3) — the head of snake "b", which runs up column 3 and points off the top edge.
 */
const board: Board = {
  rows: 4,
  cols: 4,
  arrows: [
    { id: 'a', cells: [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }], dir: 'right' },
    { id: 'b', cells: [{ row: 3, col: 3 }, { row: 2, col: 3 }, { row: 1, col: 3 }], dir: 'up' },
  ],
};

describe('escape rule', () => {
  it('blocks a snake whose head faces another arrow', () => {
    const all = new Set(['a', 'b']);
    expect(isEscapable(board, occupiedCells(board, all), board.arrows[0]!)).toBe(false);
  });

  it('lets a snake out when its way to the edge is empty', () => {
    const all = new Set(['a', 'b']);
    expect(isEscapable(board, occupiedCells(board, all), board.arrows[1]!)).toBe(true);
  });

  it('frees a blocked snake once the blocker is gone', () => {
    expect(findEscapableArrows(board, new Set(['a', 'b'])).map((a) => a.id)).toEqual(['b']);
    expect(findEscapableArrows(board, new Set(['a'])).map((a) => a.id)).toEqual(['a']);
  });

  it('is blocked by any cell of another arrow, not just its head', () => {
    // x's path crosses (1,2), which is y's tail cell — not its head — and that is enough to block x.
    const sideways: Board = {
      rows: 3,
      cols: 3,
      arrows: [
        { id: 'x', cells: [{ row: 1, col: 0 }], dir: 'right' },
        { id: 'y', cells: [{ row: 1, col: 2 }, { row: 2, col: 2 }], dir: 'down' },
      ],
    };
    expect(findEscapableArrows(sideways, new Set(['x', 'y'])).map((a) => a.id)).toEqual(['y']);
  });

  it('ignores removed arrows', () => {
    expect(occupiedCells(board, new Set(['b'])).size).toBe(3);
  });
});
