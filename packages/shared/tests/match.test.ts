import { describe, expect, it } from 'vitest';
import { createMatchState, getMatchWinner, isMatchOver, recordRoundResult } from '../src/game/match.js';

describe('match state (best of 3)', () => {
  it('declares no winner before anyone reaches 2 round wins', () => {
    const s0 = createMatchState();
    expect(isMatchOver(s0)).toBe(false);

    const s1 = recordRoundResult(s0, 0);
    expect(s1.roundWins).toEqual([1, 0]);
    expect(s1.roundIndex).toBe(1);
    expect(isMatchOver(s1)).toBe(false);
    expect(getMatchWinner(s1)).toBeNull();
  });

  it('ends the match 2-0 as a sweep', () => {
    let state = createMatchState();
    state = recordRoundResult(state, 0);
    state = recordRoundResult(state, 0);
    expect(state.roundWins).toEqual([2, 0]);
    expect(isMatchOver(state)).toBe(true);
    expect(getMatchWinner(state)).toBe(0);
  });

  it('ends the match 2-1 after a split first two rounds', () => {
    let state = createMatchState();
    state = recordRoundResult(state, 0);
    state = recordRoundResult(state, 1);
    expect(isMatchOver(state)).toBe(false);
    state = recordRoundResult(state, 0);
    expect(state.roundWins).toEqual([2, 1]);
    expect(state.history).toEqual([0, 1, 0]);
    expect(isMatchOver(state)).toBe(true);
    expect(getMatchWinner(state)).toBe(0);
  });

  it('does not mutate the previous state object', () => {
    const s0 = createMatchState();
    const s1 = recordRoundResult(s0, 1);
    expect(s0.roundWins).toEqual([0, 0]);
    expect(s1.roundWins).toEqual([0, 1]);
  });
});
