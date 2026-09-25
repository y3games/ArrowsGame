/**
 * Every number here affects fairness or network correctness — both client and
 * server import this file directly so they can never drift apart. Rendering-only
 * tunables (colors, tween durations, canvas size) live in the client package instead.
 */
export const GAMEPLAY = {
  GRID_ROWS: 30,
  GRID_COLS: 30,
  /** Snake length range (cells) while the board is being laid out; gaps are later filled with shorter ones. */
  ARROW_MIN_LENGTH: 4,
  ARROW_MAX_LENGTH: 16,
  /** Share of the grid the arrows should cover (what the layout can actually reach is a bit lower). */
  BOARD_FILL: 0.88,
  /** Lower = more winding snakes (a snake keeps going straight with this chance when it could turn). */
  ARROW_STRAIGHT_BIAS: 0.3,
  /** Candidates drawn per placement; higher interlocks the arrows more. See `generateBoard`. */
  BOARD_INTERLOCK: 10,
  /** How hard early snakes are pulled toward the middle (more arrows, a fuller centre). See `generateBoard`. */
  BOARD_CENTER_PULL: 4,
  /** The player who opens a round has less time than the turns that follow. */
  FIRST_TURN_MS: 5_000,
  TURN_MS: 10_000,
  ROUND_START_GRACE_MS: 3_000,
  SCORE_REMOVE: 1,
  SCORE_BLOCKED: -1,
  BEST_OF: 3,
} as const;

export const WIN_ROUNDS_NEEDED = Math.ceil(GAMEPLAY.BEST_OF / 2);

/** Single player: clear the whole board before the clock runs out; every blocked tap costs time. */
export const SOLO = {
  TIME_LIMIT_MS: 180_000,
  PENALTY_MS: 10_000,
  /** Level 1 is played on a map of this many rows and columns; each level adds `SIZE_STEP` until the full size. */
  START_SIZE: 24,
  SIZE_STEP: 2,
  /** The board reaches its full size (GRID_ROWS x GRID_COLS) at this level; later levels only get more tangled. */
  FULL_SIZE_LEVEL: 4,
  /** Levels above this are refused — a sanity bound on what a client may ask for, not a designed ceiling. */
  MAX_LEVEL: 999,
} as const;

export const ROOM = {
  CAPACITY: 2,
  /** After a match ends, a player who has not asked for a rematch within this window is removed from the room. */
  REMATCH_WINDOW_MS: 10_000,
} as const;
