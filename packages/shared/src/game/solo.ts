import type { Board } from './types.js';
import { GAMEPLAY, SOLO } from './config.js';
import { isEscapable, occupiedCells } from './rules.js';

/**
 * A single-player run: clear the whole board within `TIME_LIMIT_MS`. Every blocked tap deducts
 * `PENALTY_MS` from the time left — there is no separate score, the time you finish with is it.
 */
export interface SoloState {
  board: Board;
  remainingIds: Set<string>;
  /** The clock starts at this timestamp (after the pre-game countdown). */
  startsAt: number;
  mistakes: number;
}

export function createSoloState(board: Board, startsAt: number): SoloState {
  return { board, remainingIds: new Set(board.arrows.map((a) => a.id)), startsAt, mistakes: 0 };
}

/** Time left on the clock at `now`, penalties included; never more than the full limit, never below 0. */
export function soloTimeLeftMs(state: SoloState, now: number): number {
  const untilDeadline = state.startsAt + SOLO.TIME_LIMIT_MS - now;
  return Math.max(0, Math.min(SOLO.TIME_LIMIT_MS, untilDeadline) - state.mistakes * SOLO.PENALTY_MS);
}

export type SoloMoveOutcome =
  | { type: 'removed'; arrowId: string; remaining: number; finished: boolean; timeLeftMs: number }
  | { type: 'blocked'; arrowId: string; mistakes: number; timeLeftMs: number; timedOut: boolean }
  | { type: 'rejected'; reason: 'not-started' | 'time-up' | 'finished' | 'already-removed' | 'unknown-arrow' };

/**
 * `now` is injected so this stays pure and testable with synthetic clocks; the server feeds it
 * the arrival time of each tap. A blocked tap changes nothing on the board — it only costs time,
 * and may itself use up the last of it (`timedOut`).
 */
export function applySoloMove(state: SoloState, arrowId: string, now: number): SoloMoveOutcome {
  if (now < state.startsAt) return { type: 'rejected', reason: 'not-started' };
  if (state.remainingIds.size === 0) return { type: 'rejected', reason: 'finished' };
  if (soloTimeLeftMs(state, now) <= 0) return { type: 'rejected', reason: 'time-up' };

  const arrow = state.board.arrows.find((a) => a.id === arrowId);
  if (!arrow) return { type: 'rejected', reason: 'unknown-arrow' };
  if (!state.remainingIds.has(arrowId)) return { type: 'rejected', reason: 'already-removed' };

  if (isEscapable(state.board, occupiedCells(state.board, state.remainingIds), arrow)) {
    state.remainingIds.delete(arrowId);
    return {
      type: 'removed',
      arrowId,
      remaining: state.remainingIds.size,
      finished: state.remainingIds.size === 0,
      timeLeftMs: soloTimeLeftMs(state, now),
    };
  }

  state.mistakes += 1;
  const timeLeftMs = soloTimeLeftMs(state, now);
  return { type: 'blocked', arrowId, mistakes: state.mistakes, timeLeftMs, timedOut: timeLeftMs <= 0 };
}

/** How the board for one solo level is laid out — the inputs of `generateBoard`. */
export interface SoloLevelConfig {
  level: number;
  rows: number;
  cols: number;
  minLength: number;
  maxLength: number;
  fill: number;
  straightBias: number;
  interlock: number;
  centerPull: number;
}

/** Anything a client sends is coerced to a whole level between 1 and `SOLO.MAX_LEVEL`. */
export function clampSoloLevel(level: unknown): number {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.floor(level) : 1;
  return Math.min(SOLO.MAX_LEVEL, Math.max(1, n));
}

/**
 * The difficulty curve. Every knob only ever moves in the harder direction, and they keep moving
 * until about level 20, so there is always a next step:
 *  - the map grows two rows and columns per level up to the full size (level 11);
 *  - arrows get more numerous (the middle of the map is filled more — `centerPull`), longer and
 *    more winding (lower `straightBias`), and more interlocked (longer chains of "this one must go
 *    before that one"). About 16 arrows on level 1, about 60 at full size, 100+ by level 17.
 */
export function soloLevelConfig(levelInput: number): SoloLevelConfig {
  const level = clampSoloLevel(levelInput);
  const size = (max: number): number => Math.min(max, 10 + 2 * (level - 1));
  return {
    level,
    rows: size(GAMEPLAY.GRID_ROWS),
    cols: size(GAMEPLAY.GRID_COLS),
    minLength: Math.min(5, 2 + Math.floor((level - 1) / 4)),
    maxLength: Math.min(24, 6 + level),
    fill: Math.min(0.95, 0.7 + 0.01 * level),
    straightBias: Math.max(0.1, 0.5 - 0.02 * level),
    interlock: Math.min(14, 2 + level),
    centerPull: Math.min(10, 2 + Math.floor((level - 1) / 2)),
  };
}
