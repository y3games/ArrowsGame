import type { Arrow, Board, Cell, Direction } from './types.js';

export const DIRECTION_DELTA: Record<Direction, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

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
  const { rows, cols, minLength, maxLength, fill, rng = Math.random } = options;
  const occupied = new Set<string>();
  const arrows: Arrow[] = [];
  const target = Math.floor(rows * cols * fill);
  const maxAttempts = rows * cols * 60;
  let covered = 0;

  for (let attempt = 0; attempt < maxAttempts && covered < target; attempt++) {
    // Once long snakes stop fitting, switch to short ones so the leftover gaps still get filled.
    const fillingGaps = attempt > maxAttempts / 2;
    const arrow = tryPlace({
      rows,
      cols,
      occupied,
      id: `a${arrows.length}`,
      minLength: fillingGaps ? 1 : minLength,
      maxLength: fillingGaps ? Math.min(3, maxLength) : maxLength,
      rng,
    });
    if (!arrow) continue;
    arrows.push(arrow);
    for (const cell of arrow.cells) occupied.add(cellKey(cell));
    covered += arrow.cells.length;
  }

  if (arrows.length === 0) {
    // Degenerate grid: a one-cell arrow on the top row pointing up always has a clear path.
    arrows.push({ id: 'a0', cells: [{ row: 0, col: 0 }], dir: 'up' });
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
  rng: () => number;
}

function tryPlace({ rows, cols, occupied, id, minLength, maxLength, rng }: PlaceOptions): Arrow | null {
  const start: Cell = { row: Math.floor(rng() * rows), col: Math.floor(rng() * cols) };
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
    const dir: Direction = heading && options.includes(heading) && rng() < 0.5 ? heading : options[Math.floor(rng() * options.length)]!;
    heading = dir;
    const next = { row: tip.row + DIRECTION_DELTA[dir].dr, col: tip.col + DIRECTION_DELTA[dir].dc };
    cells.push(next);
    own.add(cellKey(next));
  }
  if (cells.length < minLength) return null;

  // The head keeps pointing the way the last segment went; a single cell may point anywhere.
  const candidates = cells.length >= 2 && heading ? [heading] : DIRECTIONS;
  const clear = candidates.filter((dir) =>
    pathCells({ cells, dir }, rows, cols).every((c) => !occupied.has(cellKey(c)) && !own.has(cellKey(c))),
  );
  if (clear.length === 0) return null;
  return { id, cells, dir: clear[Math.floor(rng() * clear.length)]! };
}
