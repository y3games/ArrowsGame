import { GAMEPLAY } from '@arrows/shared';

/**
 * Rendering-only tunables. Anything that affects fairness or the network protocol
 * (grid size, arrow count, timeout duration) lives in @arrows/shared's config instead —
 * this file only ever adds to that, never overrides it.
 */
export const RENDER = {
  CANVAS_WIDTH: 640,
  CANVAS_HEIGHT: 960,
  GRID_TOP: 200,
  GRID_MARGIN_X: 40,
  TILE_GAP: 6,
  COUNTDOWN_RADIUS: 30,
  COUNTDOWN_Y: 100,
  TWEEN_MS: 160,
  COLORS: {
    background: 0x12121c,
    tile: 0x2b2f4a,
    tileHover: 0x3d4266,
    arrow: 0xe8eaf6,
    wrongFlash: 0xe03131,
    correctFlash: 0x37b24d,
    lockedOverlay: 0x000000,
    countdownTrack: 0x3d4266,
    countdownFill: 0x4c6ef5,
    countdownWarn: 0xe03131,
    text: 0xe8eaf6,
  },
} as const;

export function getTileSize(): number {
  const usableWidth = RENDER.CANVAS_WIDTH - RENDER.GRID_MARGIN_X * 2 - RENDER.TILE_GAP * (GAMEPLAY.GRID_COLS - 1);
  return Math.floor(usableWidth / GAMEPLAY.GRID_COLS);
}

export function cellToPosition(row: number, col: number): { x: number; y: number } {
  const tile = getTileSize();
  const x = RENDER.GRID_MARGIN_X + col * (tile + RENDER.TILE_GAP) + tile / 2;
  const y = RENDER.GRID_TOP + row * (tile + RENDER.TILE_GAP) + tile / 2;
  return { x, y };
}
