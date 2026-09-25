import { describe, expect, it } from 'vitest';
import { createMatchState, getMatchWinner, isMatchOver, nextFirstPlayer, recordRoundResult } from '../src/game/match.js';

describe('match state (best of 3)', () => {
  it('declares no winner before anyone reaches 2 round wins', () => {
    const s0 = createMatchState();
    expect(isMatchOver(s0)).toBe(false);

    const s1 = recordRoundResult(s0, 0, [5, 2]);
    expect(s1.roundWins).toEqual([1, 0]);
    expect(s1.roundIndex).toBe(1);
    expect(isMatchOver(s1)).toBe(false);
    expect(getMatchWinner(s1)).toBeNull();
  });

  it('ends the match 2-0 as a sweep', () => {
    let state = createMatchState();
    state = recordRoundResult(state, 0, [5, 2]);
    state = recordRoundResult(state, 0, [6, 1]);
    expect(state.roundWins).toEqual([2, 0]);
    expect(isMatchOver(state)).toBe(true);
    expect(getMatchWinner(state)).toBe(0);
  });

  it('ends the match 2-1 after a split first two rounds', () => {
    let state = createMatchState();
    state = recordRoundResult(state, 0, [5, 2]);
    state = recordRoundResult(state, 1, [1, 4]);
    expect(isMatchOver(state)).toBe(false);
    state = recordRoundResult(state, 0, [3, 2]);
    expect(state.roundWins).toEqual([2, 1]);
    expect(isMatchOver(state)).toBe(true);
    expect(getMatchWinner(state)).toBe(0);
  });

  it('does not mutate the state it is given', () => {
    const s0 = createMatchState();
    recordRoundResult(s0, 1, [0, 3]);
    expect(s0).toEqual({ roundWins: [0, 0], totalScores: [0, 0], roundIndex: 0, history: [] });
  });

  it('records a drawn round without giving anyone a win', () => {
    const s = recordRoundResult(createMatchState(), null, [4, 4]);
    expect(s.roundWins).toEqual([0, 0]);
    expect(s.roundIndex).toBe(1);
    expect(s.history).toEqual([null]);
  });

  it('plays all three rounds when a draw stops anyone reaching two wins', () => {
    let state = createMatchState();
    state = recordRoundResult(state, 0, [5, 2]);
    state = recordRoundResult(state, null, [3, 3]);
    expect(isMatchOver(state)).toBe(false);
    state = recordRoundResult(state, 1, [1, 4]);
    expect(isMatchOver(state)).toBe(true);
  });

  it('breaks level round wins by total score, and calls a full tie a draw', () => {
    let state = createMatchState();
    state = recordRoundResult(state, 0, [5, 2]);
    state = recordRoundResult(state, null, [3, 3]);
    state = recordRoundResult(state, 1, [1, 4]);
    expect(state.roundWins).toEqual([1, 1]);
    expect(state.totalScores).toEqual([9, 9]);
    expect(getMatchWinner(state)).toBeNull();

    let ahead = createMatchState();
    ahead = recordRoundResult(ahead, 0, [5, 2]);
    ahead = recordRoundResult(ahead, null, [4, 4]);
    ahead = recordRoundResult(ahead, 1, [1, 2]);
    expect(getMatchWinner(ahead)).toBe(0);
  });
});

describe('nextFirstPlayer', () => {
  it('lets the loser of the last round open the next one', () => {
    expect(nextFirstPlayer(0, 0)).toBe(1);
    expect(nextFirstPlayer(0, 1)).toBe(0);
    expect(nextFirstPlayer(1, 1)).toBe(0);
  });

  it('swaps the opener after a draw', () => {
    expect(nextFirstPlayer(0, null)).toBe(1);
    expect(nextFirstPlayer(1, null)).toBe(0);
  });
});
