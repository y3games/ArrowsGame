import type { Board } from './types.js';
import { SOLO } from './config.js';
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
