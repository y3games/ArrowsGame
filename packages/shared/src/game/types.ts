export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Cell {
  row: number;
  col: number;
}

/**
 * One snake-shaped arrow. `cells` runs tail → head and each cell touches the next one. The head
 * points `dir`, which for arrows longer than one cell is the direction of the last segment — the
 * body trails straight behind the head. Tapping slides the whole snake out along `dir`.
 */
export interface Arrow {
  id: string;
  cells: Cell[];
  dir: Direction;
}

export interface Board {
  rows: number;
  cols: number;
  arrows: Arrow[];
}
