export type Direction = 'up' | 'down' | 'left' | 'right';

export interface ArrowTile {
  id: string;
  row: number;
  col: number;
  dir: Direction;
}

export interface Board {
  rows: number;
  cols: number;
  arrows: ArrowTile[];
}

export interface Cell {
  row: number;
  col: number;
}
