import { GAMEPLAY, WIN_ROUNDS_NEEDED } from './config.js';

export type PlayerSlot = 0 | 1;

export interface MatchState {
  /** [p1 wins, p2 wins] */
  roundWins: [number, number];
  roundIndex: number;
  history: PlayerSlot[];
}

export function createMatchState(): MatchState {
  return { roundWins: [0, 0], roundIndex: 0, history: [] };
}

/** Returns a new MatchState with the round's winner recorded — does not mutate the input. */
export function recordRoundResult(state: MatchState, winner: PlayerSlot): MatchState {
  const roundWins: [number, number] = [...state.roundWins];
  roundWins[winner] += 1;
  return {
    roundWins,
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

export function getMatchWinner(state: MatchState): PlayerSlot | null {
  if (state.roundWins[0] >= WIN_ROUNDS_NEEDED) return 0;
  if (state.roundWins[1] >= WIN_ROUNDS_NEEDED) return 1;
  return null;
}
