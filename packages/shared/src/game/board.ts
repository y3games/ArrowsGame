import type { Arrow, Board, Cell, Direction } from './types.js';

export const DIRECTION_DELTA: Record<Direction, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

/** A one-cell arrow is just a dot with a triangle — every arrow is a snake of at least this many cells. */
export const MIN_ARROW_LENGTH = 2;

export function cellKey(cell: Cell): string {
  return `${cell.row},${cell.col}`;
}

export function headOf(arrow: Pick<Arrow, 'cells'>): Cell {
  return arrow.cells[arrow.cells.length - 1]!;
}

/** Cells strictly between the arrow's head and the board edge, in the direction it points. */
export function pathCells(arrow: Pick<Arrow, 'cells' | 'dir'>, rows: number, cols: number): Cell[] {
  const head = headOf(arrow);
  const { dr, dc } = DIRECTION_DELTA[arrow.dir];
  const cells: Cell[] = [];
  for (let r = head.row + dr, c = head.col + dc; r >= 0 && r < rows && c >= 0 && c < cols; r += dr, c += dc) {
    cells.push({ row: r, col: c });
  }
  return cells;
}

export interface GenerateBoardOptions {
  rows: number;
  cols: number;
  minLength: number;
  maxLength: number;
  /** Share of the grid the arrows should cover, 0..1. */
  fill: number;
  /**
   * Chance, per step, of carrying straight on when the snake could also turn. Lower values give
   * more winding snakes, which makes the board harder to read.
   */
  straightBias?: number;
  /**
   * How many candidate snakes to draw per placement; the one lying across the most existing
   * arrows' escape paths wins. Higher values interlock the arrows more (longer chains of "this one
   * must go before that one"). 1 means no preference.
   */
  interlock?: number;
  /**
   * How hard early snakes are pulled toward the middle: each start cell is the one closest to the
   * centre out of this many random draws. Arrows placed first keep the longest clear paths, so
   * without a pull the middle of a big board stays empty while the edges pack full. 1 = no pull.
   */
  centerPull?: number;
  /** Injectable PRNG (returns [0,1)) so board generation is deterministic in tests. */
  rng?: () => number;
}

/**
 * Builds a board that is *guaranteed* solvable by construction: arrows are placed in the
 * reverse of their eventual escape order. A new arrow is only accepted when the straight path
 * from its head to the edge is clear of every arrow placed before it — and those are exactly
 * the arrows that will still be on the board when its turn to escape comes. Anything placed
 * later escapes earlier, so it never has to be considered.
 */
export function generateBoard(options: GenerateBoardOptions): Board {
  const { rows, cols, fill, straightBias = 0.5, interlock = 1, centerPull = 1, rng = Math.random } = options;
  const minLength = Math.max(MIN_ARROW_LENGTH, options.minLength);
  const maxLength = Math.max(minLength, options.maxLength);
  const occupied = new Set<string>();
  /** How many placed arrows would have to pass through each cell on their way out. */
  const crossings = new Map<string, number>();
  const arrows: Arrow[] = [];
  const target = Math.floor(rows * cols * fill);
  const maxAttempts = rows * cols * 60;
  // Placements that fail in a row before a phase is given up on: long snakes first, then short ones to fill the gaps.
  const patience = Math.max(200, rows * cols);
  let fillingGaps = false;
  let failures = 0;
  let covered = 0;

  for (let attempt = 0; attempt < maxAttempts && covered < target; attempt++) {
    let best: Arrow | null = null;
    let bestScore = -1;
    for (let k = 0; k < (fillingGaps ? 1 : interlock); k++) {
      const arrow = tryPlace({
        rows,
        cols,
        occupied,
        id: `a${arrows.length}`,
        minLength: fillingGaps ? MIN_ARROW_LENGTH : minLength,
        maxLength: fillingGaps ? Math.min(3, maxLength) : maxLength,
        straightBias,
        // Only the long-snake phase is pulled inwards; filling gaps must take whatever cells are left.
        centerPull: fillingGaps ? 1 : centerPull,
        rng,
      });
      if (!arrow) continue;
      // Sitting in another arrow's way is what creates dependencies: that arrow must wait for this one.
      const score = arrow.cells.reduce((sum, cell) => sum + (crossings.get(cellKey(cell)) ?? 0), 0);
      if (score > bestScore) {
        best = arrow;
        bestScore = score;
      }
    }
    if (!best) {
      if (++failures <= patience) continue;
      if (fillingGaps) break;
      // Long snakes stopped fitting: switch to short ones so the leftover gaps still get filled.
      fillingGaps = true;
      failures = 0;
      continue;
    }
    failures = 0;
    arrows.push(best);
    for (const cell of best.cells) occupied.add(cellKey(cell));
    for (const cell of pathCells(best, rows, cols)) crossings.set(cellKey(cell), (crossings.get(cellKey(cell)) ?? 0) + 1);
    covered += best.cells.length;
  }

  if (arrows.length === 0) {
    // Degenerate grid: two cells along the top row, head at the right end, nothing in its way.
    arrows.push({ id: 'a0', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }], dir: 'right' });
  }
  return { rows, cols, arrows };
}

interface PlaceOptions {
  rows: number;
  cols: number;
  occupied: ReadonlySet<string>;
  id: string;
  minLength: number;
  maxLength: number;
  straightBias: number;
  centerPull: number;
  rng: () => number;
}

function tryPlace({ rows, cols, occupied, id, minLength, maxLength, straightBias, centerPull, rng }: PlaceOptions): Arrow | null {
  let start: Cell = { row: Math.floor(rng() * rows), col: Math.floor(rng() * cols) };
  for (let i = 1; i < centerPull; i++) {
    const other: Cell = { row: Math.floor(rng() * rows), col: Math.floor(rng() * cols) };
    if (distanceToCenter(other, rows, cols) < distanceToCenter(start, rows, cols)) start = other;
  }
  if (occupied.has(cellKey(start))) return null;

  const length = minLength + Math.floor(rng() * (maxLength - minLength + 1));
  const cells: Cell[] = [start];
  const own = new Set([cellKey(start)]);
  let heading: Direction | null = null;

  while (cells.length < length) {
    const tip = cells[cells.length - 1]!;
    const options = DIRECTIONS.filter((dir) => {
      const next = { row: tip.row + DIRECTION_DELTA[dir].dr, col: tip.col + DIRECTION_DELTA[dir].dc };
      return (
        next.row >= 0 && next.row < rows && next.col >= 0 && next.col < cols &&
        !occupied.has(cellKey(next)) && !own.has(cellKey(next))
      );
    });
    if (options.length === 0) break;
    // Favour carrying straight on so snakes have some long runs, not only zig-zags.
    const dir: Direction = heading && options.includes(heading) && rng() < straightBias ? heading : options[Math.floor(rng() * options.length)]!;
    heading = dir;
    const next = { row: tip.row + DIRECTION_DELTA[dir].dr, col: tip.col + DIRECTION_DELTA[dir].dc };
    cells.push(next);
    own.add(cellKey(next));
  }
  if (cells.length < minLength) return null;

  // The head keeps pointing the way the last segment went (there are always at least two cells).
  if (!heading) return null;
  const clear = pathCells({ cells, dir: heading }, rows, cols).every((c) => !occupied.has(cellKey(c)) && !own.has(cellKey(c)));
  return clear ? { id, cells, dir: heading } : null;
}

function distanceToCenter(cell: Cell, rows: number, cols: number): number {
  return Math.hypot(cell.row - (rows - 1) / 2, cell.col - (cols - 1) / 2);
}
