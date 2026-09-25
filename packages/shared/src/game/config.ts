/**
 * Every number here affects fairness or network correctness — both client and
 * server import this file directly so they can never drift apart. Rendering-only
 * tunables (colors, tween durations, canvas size) live in the client package instead.
 */
export const GAMEPLAY = {
  GRID_ROWS: 8,
  GRID_COLS: 8,
  ARROW_COUNT: 20,
  ATTEMPT_TIMEOUT_MS: 10_000,
  ROUND_START_GRACE_MS: 3_000,
  BEST_OF: 3,
  BOARD_GEN_MAX_RETRIES: 200,
} as const;

export const WIN_ROUNDS_NEEDED = Math.ceil(GAMEPLAY.BEST_OF / 2);

export const ROOM = {
  CAPACITY: 2,
  /** After a match ends, a player who has not asked for a rematch within this window is removed from the room. */
  REMATCH_WINDOW_MS: 10_000,
} as const;
