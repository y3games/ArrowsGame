import { GAMEPLAY, WIN_ROUNDS_NEEDED } from './config.js';

export type PlayerSlot = 0 | 1;

export interface MatchState {
  /** [p1 wins, p2 wins] */
  roundWins: [number, number];
  /** Points over all rounds so far — only used to break a tie in round wins. */
  totalScores: [number, number];
  roundIndex: number;
  /** Winner of each finished round; null for a drawn round. */
  history: (PlayerSlot | null)[];
}

export function createMatchState(): MatchState {
  return { roundWins: [0, 0], totalScores: [0, 0], roundIndex: 0, history: [] };
}

/** Returns a new MatchState with the round recorded — does not mutate the input. `winner` is null for a draw. */
export function recordRoundResult(
  state: MatchState,
  winner: PlayerSlot | null,
  roundScores: readonly [number, number] = [0, 0],
): MatchState {
  const roundWins: [number, number] = [...state.roundWins];
  if (winner !== null) roundWins[winner] += 1;
  return {
    roundWins,
    totalScores: [state.totalScores[0] + roundScores[0], state.totalScores[1] + roundScores[1]],
    roundIndex: state.roundIndex + 1,
    history: [...state.history, winner],
  };
}

export function isMatchOver(state: MatchState): boolean {
  return (
    state.roundWins[0] >= WIN_ROUNDS_NEEDED ||
    state.roundWins[1] >= WIN_ROUNDS_NEEDED ||
    state.roundIndex >= GAMEPLAY.BEST_OF
  );
}

/**
 * Null while the match is still going, and null for a draw. More round wins decide it; if the
 * wins are level (a drawn round got in the way) the higher total score does.
 */
export function getMatchWinner(state: MatchState): PlayerSlot | null {
  if (!isMatchOver(state)) return null;
  if (state.roundWins[0] !== state.roundWins[1]) return state.roundWins[0] > state.roundWins[1] ? 0 : 1;
  if (state.totalScores[0] !== state.totalScores[1]) return state.totalScores[0] > state.totalScores[1] ? 0 : 1;
  return null;
}

/** Whoever lost the round opens the next one; after a draw the opener swaps. */
export function nextFirstPlayer(previousFirst: PlayerSlot, roundWinner: PlayerSlot | null): PlayerSlot {
  if (roundWinner === null) return previousFirst === 0 ? 1 : 0;
  return roundWinner === 0 ? 1 : 0;
}
