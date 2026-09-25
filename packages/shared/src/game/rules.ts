import type { Arrow, Board } from './types.js';
import { cellKey, pathCells } from './board.js';

/** Keys of every cell covered by the arrows still on the board. */
export function occupiedCells(board: Board, remainingIds: ReadonlySet<string>): Set<string> {
  const occupied = new Set<string>();
  for (const arrow of board.arrows) {
    if (!remainingIds.has(arrow.id)) continue;
    for (const cell of arrow.cells) occupied.add(cellKey(cell));
  }
  return occupied;
}

/** An arrow slides out only if nothing — no other arrow — sits between its head and the board edge. */
export function isEscapable(board: Board, occupied: ReadonlySet<string>, arrow: Arrow): boolean {
  return pathCells(arrow, board.rows, board.cols).every((cell) => !occupied.has(cellKey(cell)));
}

/** All arrows among `remainingIds` whose path to the edge is currently clear. */
export function findEscapableArrows(board: Board, remainingIds: ReadonlySet<string>): Arrow[] {
  const occupied = occupiedCells(board, remainingIds);
  return board.arrows.filter((a) => remainingIds.has(a.id) && isEscapable(board, occupied, a));
}
