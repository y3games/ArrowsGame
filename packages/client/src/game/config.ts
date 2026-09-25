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
  GRID_MARGIN_X: 12,
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

export function getCellSize(): number {
  return Math.floor((RENDER.CANVAS_WIDTH - RENDER.GRID_MARGIN_X * 2) / GAMEPLAY.GRID_COLS);
}

/** Left edge of the grid, centred horizontally. */
export function getGridLeft(): number {
  return Math.floor((RENDER.CANVAS_WIDTH - getCellSize() * GAMEPLAY.GRID_COLS) / 2);
}

export function cellToPosition(row: number, col: number): { x: number; y: number } {
  const size = getCellSize();
  return { x: getGridLeft() + col * size + size / 2, y: RENDER.GRID_TOP + row * size + size / 2 };
}
