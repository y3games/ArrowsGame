import { describe, expect, it } from 'vitest';
import { generateBoard } from '../src/game/board.js';
import { findEscapableArrows } from '../src/game/rules.js';

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

function isFullyClearable(rows: number, cols: number, arrowCount: number, seed: number): boolean {
  const board = generateBoard({ rows, cols, arrowCount, rng: mulberry32(seed) });
  const remainingIds = new Set(board.arrows.map((a) => a.id));

  while (remainingIds.size > 0) {
    const escapable = findEscapableArrows(board, remainingIds);
    if (escapable.length === 0) return false; // would be a dead board — must never happen
    remainingIds.delete(escapable[0]!.id);
  }
  return true;
}

describe('generateBoard', () => {
  const sizes = [
    { rows: 8, cols: 8, arrowCount: 20 },
    { rows: 4, cols: 4, arrowCount: 6 },
    { rows: 10, cols: 10, arrowCount: 30 },
    { rows: 3, cols: 3, arrowCount: 9 },
  ];
  const seeds = [1, 2, 3, 4, 5, 42, 12345];

  for (const size of sizes) {
    for (const seed of seeds) {
      it(`produces a fully solvable ${size.rows}x${size.cols} board with ${size.arrowCount} arrows (seed ${seed})`, () => {
        expect(isFullyClearable(size.rows, size.cols, size.arrowCount, seed)).toBe(true);
      });
    }
  }

  it('places the requested number of arrows at moderate density', () => {
    const board = generateBoard({ rows: 8, cols: 8, arrowCount: 20, rng: mulberry32(7) });
    expect(board.arrows).toHaveLength(20);
  });

  it('never places two arrows on the same cell', () => {
    const board = generateBoard({ rows: 8, cols: 8, arrowCount: 20, rng: mulberry32(99) });
    const keys = new Set(board.arrows.map((a) => `${a.row},${a.col}`));
    expect(keys.size).toBe(board.arrows.length);
  });

  it('clamps arrowCount to the number of cells and still terminates', () => {
    const board = generateBoard({ rows: 2, cols: 2, arrowCount: 999, rng: mulberry32(1) });
    expect(board.arrows.length).toBeLessThanOrEqual(4);
  });
});
