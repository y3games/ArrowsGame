import { describe, expect, it } from 'vitest';
import { DIRECTION_DELTA, cellKey, generateBoard, headOf, pathCells } from '../src/game/board.js';
import { findEscapableArrows } from '../src/game/rules.js';
import { GAMEPLAY } from '../src/game/config.js';
import type { Board } from '../src/game/types.js';

/** Deterministic PRNG (mulberry32) so board-generation tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Removes any escapable arrow until none is left; true if that empties the board. */
function isFullyClearable(board: Board): boolean {
  const remainingIds = new Set(board.arrows.map((a) => a.id));
  while (remainingIds.size > 0) {
    const escapable = findEscapableArrows(board, remainingIds);
    if (escapable.length === 0) return false; // a dead board — must never happen
    remainingIds.delete(escapable[0]!.id);
  }
  return true;
}

describe('pathCells', () => {
  it('lists the cells from the head to the edge, excluding the head', () => {
    const arrow = { cells: [{ row: 4, col: 1 }, { row: 4, col: 2 }], dir: 'right' as const };
    expect(pathCells(arrow, 5, 5)).toEqual([{ row: 4, col: 3 }, { row: 4, col: 4 }]);
  });

  it('is empty for a head on the edge pointing outward', () => {
    expect(pathCells({ cells: [{ row: 0, col: 2 }], dir: 'up' }, 5, 5)).toEqual([]);
  });
});

describe('generateBoard', () => {
  const sizes = [
    { rows: 9, cols: 9, minLength: 2, maxLength: 7, fill: 0.8 },
    { rows: 4, cols: 4, minLength: 2, maxLength: 4, fill: 0.6 },
    { rows: 12, cols: 8, minLength: 3, maxLength: 9, fill: 0.7 },
    { rows: 3, cols: 3, minLength: 1, maxLength: 3, fill: 1 },
  ];
  const seeds = [1, 2, 3, 4, 5, 42, 12345];

  for (const size of sizes) {
    for (const seed of seeds) {
      const label = `${size.rows}x${size.cols} len ${size.minLength}-${size.maxLength} (seed ${seed})`;
      const board = () => generateBoard({ ...size, rng: mulberry32(seed) });

      it(`is fully solvable: ${label}`, () => {
        expect(isFullyClearable(board())).toBe(true);
      });

      it(`builds well-formed snakes that never overlap: ${label}`, () => {
        const seen = new Set<string>();
        for (const arrow of board().arrows) {
          expect(arrow.cells.length).toBeGreaterThanOrEqual(1);
          expect(arrow.cells.length).toBeLessThanOrEqual(size.maxLength);
          arrow.cells.forEach((cell, i) => {
            expect(cell.row).toBeGreaterThanOrEqual(0);
            expect(cell.row).toBeLessThan(size.rows);
            expect(cell.col).toBeGreaterThanOrEqual(0);
            expect(cell.col).toBeLessThan(size.cols);
            expect(seen.has(cellKey(cell))).toBe(false);
            seen.add(cellKey(cell));
            const prev = arrow.cells[i - 1];
            if (prev) expect(Math.abs(prev.row - cell.row) + Math.abs(prev.col - cell.col)).toBe(1);
          });
        }
      });

      it(`points each head the way its last segment went: ${label}`, () => {
        for (const arrow of board().arrows) {
          if (arrow.cells.length < 2) continue;
          const head = headOf(arrow);
          const before = arrow.cells[arrow.cells.length - 2]!;
          const { dr, dc } = DIRECTION_DELTA[arrow.dir];
          expect({ row: head.row - before.row, col: head.col - before.col }).toEqual({ row: dr, col: dc });
        }
      });
    }
  }

  it('lays out long, maze-like snakes covering most of the default board', () => {
    let covered = 0;
    let longest = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const b = generateBoard({
        rows: GAMEPLAY.GRID_ROWS,
        cols: GAMEPLAY.GRID_COLS,
        minLength: GAMEPLAY.ARROW_MIN_LENGTH,
        maxLength: GAMEPLAY.ARROW_MAX_LENGTH,
        fill: GAMEPLAY.BOARD_FILL,
        rng: mulberry32(seed),
      });
      covered += b.arrows.reduce((sum, a) => sum + a.cells.length, 0) / (b.rows * b.cols);
      longest = Math.max(longest, ...b.arrows.map((a) => a.cells.length));
    }
    expect(covered / 20).toBeGreaterThan(0.7);
    expect(longest).toBeGreaterThanOrEqual(5);
  });
});
