import type { Board } from './types.js';
import type { PlayerSlot } from './match.js';
import { GAMEPLAY } from './config.js';
import { isEscapable, occupiedCells } from './rules.js';

/**
 * One round on a board that both players share: whoever removes an arrow removes it for
 * everyone. Players alternate turns; during your turn you keep removing arrows until you tap a
 * blocked one (-1 point, turn ends at once) or the turn timer runs out (no penalty).
 */
export interface RoundState {
  board: Board;
  remainingIds: Set<string>;
  /** Points this round, indexed by player slot. */
  scores: [number, number];
  turn: PlayerSlot;
  /** No move is accepted before this timestamp (the pre-round countdown). */
  startsAt: number;
  turnEndsAt: number;
}

export const otherSlot = (slot: PlayerSlot): PlayerSlot => (slot === 0 ? 1 : 0);

/** The opening turn is shorter than the ones after it — see GAMEPLAY.FIRST_TURN_MS. */
export function createRoundState(board: Board, first: PlayerSlot, startsAt: number): RoundState {
  return {
    board,
    remainingIds: new Set(board.arrows.map((a) => a.id)),
    scores: [0, 0],
    turn: first,
    startsAt,
    turnEndsAt: startsAt + GAMEPLAY.FIRST_TURN_MS,
  };
}

export type MoveOutcome =
  | { type: 'removed'; arrowId: string; remaining: number; finished: boolean }
  | { type: 'blocked'; arrowId: string }
  | { type: 'rejected'; reason: 'not-started' | 'not-your-turn' | 'turn-expired' | 'already-removed' | 'unknown-arrow' };

/**
 * `now` is injected rather than read internally, so this stays a pure, deterministic function
 * and is fully covered by vitest with synthetic clocks. The server feeds it the arrival time of
 * each click; it never trusts anything the client says about time or whose turn it is.
 *
 * A blocked tap ends the turn here (the score changes and the turn passes); a merely expired
 * turn is handed over separately by `passTurn`, because nothing arrives to trigger it.
 */
export function applyMove(state: RoundState, player: PlayerSlot, arrowId: string, now: number): MoveOutcome {
  if (now < state.startsAt) return { type: 'rejected', reason: 'not-started' };
  if (state.turn !== player) return { type: 'rejected', reason: 'not-your-turn' };
  if (now >= state.turnEndsAt) return { type: 'rejected', reason: 'turn-expired' };

  const arrow = state.board.arrows.find((a) => a.id === arrowId);
  if (!arrow) return { type: 'rejected', reason: 'unknown-arrow' };
  if (!state.remainingIds.has(arrowId)) return { type: 'rejected', reason: 'already-removed' };

  if (isEscapable(state.board, occupiedCells(state.board, state.remainingIds), arrow)) {
    state.remainingIds.delete(arrowId);
    state.scores[player] += GAMEPLAY.SCORE_REMOVE;
    return { type: 'removed', arrowId, remaining: state.remainingIds.size, finished: state.remainingIds.size === 0 };
  }

  state.scores[player] += GAMEPLAY.SCORE_BLOCKED;
  passTurn(state, now);
  return { type: 'blocked', arrowId };
}

/** Hands the turn to the other player, who gets a full `TURN_MS` from `now`. */
export function passTurn(state: RoundState, now: number): void {
  state.turn = otherSlot(state.turn);
  state.turnEndsAt = now + GAMEPLAY.TURN_MS;
}

export function isRoundOver(state: RoundState): boolean {
  return state.remainingIds.size === 0;
}

/** The higher score wins the round; equal scores are a draw (null). */
export function getRoundWinner(state: RoundState): PlayerSlot | null {
  if (state.scores[0] === state.scores[1]) return null;
  return state.scores[0] > state.scores[1] ? 0 : 1;
}
