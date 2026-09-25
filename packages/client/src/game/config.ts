import { GAMEPLAY } from '@arrows/shared';

/**
 * Rendering-only tunables. Anything that affects fairness or the network protocol
 * (grid size, turn lengths, scoring) lives in @arrows/shared's config instead —
 * this file only ever adds to that, never overrides it.
 */
export const RENDER = {
  CANVAS_WIDTH: 640,
  CANVAS_HEIGHT: 960,
  GRID_TOP: 176,
  GRID_MARGIN_X: 10,
  COUNTDOWN_RADIUS: 34,
  COUNTDOWN_Y: 100,
  /** Slide-out speed, in cells per second. */
  SLIDE_CELLS_PER_SEC: 32,
  FLASH_MS: 90,
  COLORS: {
    background: 0x12121c,
    gridDot: 0x2b2f4a,
    blockedFlash: 0xe03131,
    countdownTrack: 0x3d4266,
    countdownWarn: 0xe03131,
    text: 0xe8eaf6,
    /** You are always blue, the opponent always orange — on the HUD, the ring and the slide-out. */
    you: 0x4c6ef5,
    opponent: 0xff922b,
    /** Banner fill behind white text; the opponent's orange is darkened so white stays readable. */
    opponentBanner: 0xd9600a,
    gridFrameIdle: 0x2b2f4a,
  },
  /** Body colours, picked per arrow so neighbouring snakes are easy to tell apart. */
  ARROW_PALETTE: [0xe8eaf6, 0x74c0fc, 0x69db7c, 0xffd43b, 0xf783ac, 0xb197fc, 0x63e6be, 0xffa94d],
} as const;

/** Vertical space between the round label and the score line that the board may use. */
const GRID_AREA_HEIGHT = 620;

/**
 * The board on screen right now. Its size changes from game to game (solo levels grow the map),
 * so the layout is derived from it instead of being fixed: GameScene sets it whenever a board is
 * drawn, and everything that positions things on the board reads it back.
 */
let boardSize: { rows: number; cols: number } = { rows: GAMEPLAY.GRID_ROWS, cols: GAMEPLAY.GRID_COLS };

export function setBoardSize(rows: number, cols: number): void {
  boardSize = { rows, cols };
}

export function getBoardSize(): { rows: number; cols: number } {
  return boardSize;
}

/** As big as the board can be drawn while still fitting the canvas width and the free height. */
export function getCellSize(): number {
  const byWidth = (RENDER.CANVAS_WIDTH - RENDER.GRID_MARGIN_X * 2) / boardSize.cols;
  const byHeight = GRID_AREA_HEIGHT / boardSize.rows;
  return Math.floor(Math.min(byWidth, byHeight));
}

/** Left edge of the grid, centred horizontally. */
export function getGridLeft(): number {
  return Math.floor((RENDER.CANVAS_WIDTH - getCellSize() * boardSize.cols) / 2);
}

/** Top edge of the grid, centred in the free height (small boards sit in the middle, not at the top). */
export function getGridTop(): number {
  return RENDER.GRID_TOP + Math.floor((GRID_AREA_HEIGHT - getCellSize() * boardSize.rows) / 2);
}

export function cellToPosition(row: number, col: number): { x: number; y: number } {
  const size = getCellSize();
  return { x: getGridLeft() + col * size + size / 2, y: getGridTop() + row * size + size / 2 };
}
