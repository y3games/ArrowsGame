import type { Board } from './types.js';
import { currentWindowStart, findEscapableArrows, isEscapable } from './rules.js';
import { GAMEPLAY } from './config.js';

export interface RoundState {
  board: Board;
  remainingIds: Set<string>;
  roundStartAt: number;
  /** Start of the currently-open 10s attempt window (ms timestamp). */
  currentWindowStart: number;
  /** If set, no attempt is accepted until this timestamp. */
  lockedUntil: number | null;
  finishedAt: number | null;
}

export function createRoundState(board: Board, roundStartAt: number): RoundState {
  return {
    board,
    remainingIds: new Set(board.arrows.map((a) => a.id)),
    roundStartAt,
    currentWindowStart: roundStartAt,
    lockedUntil: null,
    finishedAt: null,
  };
}

export type AttemptOutcome =
  | { type: 'correct'; arrowId: string; remaining: number; finished: boolean; elapsedMs?: number }
  | { type: 'wrong'; arrowId: string; lockedUntil: number }
  | { type: 'rejected'; reason: 'locked' | 'already-removed' | 'unknown-arrow' };

/**
 * The heart of the game. `now` is injected rather than read internally, so this stays a pure,
 * deterministic function with no Phaser/clock dependency despite modeling real-time behavior —
 * it can be run identically on the server (authoritative, fed by socket receipt timestamps) and
 * on the client (optimistic local feedback), and is fully covered by vitest with synthetic clocks.
 *
 * On a wrong click or timeout, the attempt always ends up consuming exactly the full 10-second
 * window (an early wrong click locks input for the remainder of the window) — this is what keeps
 * a player's cumulative time exactly equal to real wall-clock elapsed time, so "finished first"
 * and "lowest time" are mathematically the same criterion.
 */
export function applyAttempt(state: RoundState, arrowId: string, now: number): AttemptOutcome {
  if (state.lockedUntil !== null) {
    if (now < state.lockedUntil) {
      return { type: 'rejected', reason: 'locked' };
    }
    state.currentWindowStart = state.lockedUntil;
    state.lockedUntil = null;
  }

  // Fast-forward through any windows where nothing was clicked at all (real timeouts).
  state.currentWindowStart = currentWindowStart(state.currentWindowStart, now, GAMEPLAY.ATTEMPT_TIMEOUT_MS);

  const arrow = state.board.arrows.find((a) => a.id === arrowId);
  if (!arrow) {
    return { type: 'rejected', reason: 'unknown-arrow' };
  }
  if (!state.remainingIds.has(arrowId)) {
    return { type: 'rejected', reason: 'already-removed' };
  }

  const occupied = new Set(
    state.board.arrows.filter((a) => state.remainingIds.has(a.id)).map((a) => `${a.row},${a.col}`),
  );

  if (isEscapable(state.board.rows, state.board.cols, occupied, arrow)) {
    state.remainingIds.delete(arrowId);
    state.currentWindowStart = now;
    const finished = state.remainingIds.size === 0;
    if (finished) state.finishedAt = now;
    return {
      type: 'correct',
      arrowId,
      remaining: state.remainingIds.size,
      finished,
      elapsedMs: finished ? now - state.roundStartAt : undefined,
    };
  }

  state.lockedUntil = state.currentWindowStart + GAMEPLAY.ATTEMPT_TIMEOUT_MS;
  return { type: 'wrong', arrowId, lockedUntil: state.lockedUntil };
}

export function getEscapableArrowIds(state: RoundState): string[] {
  return findEscapableArrows(state.board, state.remainingIds).map((a) => a.id);
}
