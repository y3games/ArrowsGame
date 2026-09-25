import type { ArrowTile, Board, Cell, Direction } from './types.js';
import { GAMEPLAY } from './config.js';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

/** Cells strictly between the arrow and the board edge, in the direction it points. Excludes the arrow's own cell. */
export function pathCells(arrow: Pick<ArrowTile, 'row' | 'col' | 'dir'>, rows: number, cols: number): Cell[] {
  const cells: Cell[] = [];
  switch (arrow.dir) {
    case 'up':
      for (let r = arrow.row - 1; r >= 0; r--) cells.push({ row: r, col: arrow.col });
      break;
    case 'down':
      for (let r = arrow.row + 1; r < rows; r++) cells.push({ row: r, col: arrow.col });
      break;
    case 'left':
      for (let c = arrow.col - 1; c >= 0; c--) cells.push({ row: arrow.row, col: c });
      break;
    case 'right':
      for (let c = arrow.col + 1; c < cols; c++) cells.push({ row: arrow.row, col: c });
      break;
  }
  return cells;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

export interface GenerateBoardOptions {
  rows: number;
  cols: number;
  arrowCount: number;
  /** Injectable PRNG (returns [0,1)) so board generation is deterministic in tests. */
  rng?: () => number;
}

/**
 * Builds a board that is *guaranteed* solvable by construction: arrows are placed in the
 * reverse of their eventual escape order, so an arrow only ever gets a path that is clear
 * of exactly the arrows that will still be on the board when its turn to escape comes.
 * See docs/02-architecture for the full correctness argument.
 */
export function generateBoard(options: GenerateBoardOptions): Board {
  const { rows, cols, rng = Math.random } = options;
  let arrowCount = Math.min(options.arrowCount, rows * cols);

  while (arrowCount > 0) {
    for (let attempt = 0; attempt < GAMEPLAY.BOARD_GEN_MAX_RETRIES; attempt++) {
      const board = tryGenerate(rows, cols, arrowCount, rng);
      if (board) return board;
    }
    arrowCount -= 1;
  }

  return { rows, cols, arrows: [] };
}

function tryGenerate(rows: number, cols: number, arrowCount: number, rng: () => number): Board | null {
  const occupied = new Set<string>();
  const arrows: ArrowTile[] = [];

  for (let i = 0; i < arrowCount; i++) {
    const candidates: { row: number; col: number; dir: Direction }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied.has(cellKey(r, c))) continue;
        for (const dir of DIRECTIONS) {
          const path = pathCells({ row: r, col: c, dir }, rows, cols);
          if (path.every((cell) => !occupied.has(cellKey(cell.row, cell.col)))) {
            candidates.push({ row: r, col: c, dir });
          }
        }
      }
    }

    if (candidates.length === 0) return null;

    const choice = candidates[Math.floor(rng() * candidates.length)]!;
    arrows.push({ id: `a${i}`, row: choice.row, col: choice.col, dir: choice.dir });
    occupied.add(cellKey(choice.row, choice.col));
  }

  return { rows, cols, arrows };
}
