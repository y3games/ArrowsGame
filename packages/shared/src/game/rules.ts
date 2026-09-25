import type { ArrowTile, Board } from './types.js';
import { pathCells } from './board.js';

export function isEscapable(
  rows: number,
  cols: number,
  occupied: ReadonlySet<string>,
  arrow: Pick<ArrowTile, 'row' | 'col' | 'dir'>,
): boolean {
  return pathCells(arrow, rows, cols).every((cell) => !occupied.has(`${cell.row},${cell.col}`));
}

/**
 * Start of the attempt window that `now` falls in, given a window that opened at `windowStart`.
 * Windows that elapsed with no click at all are skipped in whole `timeoutMs` steps; a `now`
 * before `windowStart` still belongs to that first window.
 */
export function currentWindowStart(windowStart: number, now: number, timeoutMs: number): number {
  if (now < windowStart) return windowStart;
  return windowStart + Math.floor((now - windowStart) / timeoutMs) * timeoutMs;
}

/** All arrows among `remainingIds` whose path to the edge is currently clear. */
export function findEscapableArrows(board: Board, remainingIds: ReadonlySet<string>): ArrowTile[] {
  const remaining = board.arrows.filter((a) => remainingIds.has(a.id));
  const occupied = new Set(remaining.map((a) => `${a.row},${a.col}`));
  return remaining.filter((a) => isEscapable(board.rows, board.cols, occupied, a));
}
