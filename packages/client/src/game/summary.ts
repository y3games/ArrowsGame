export type Outcome = 'win' | 'lose' | 'draw';

/** What happened in one round, from the player's own point of view. */
export interface RoundRecord {
  result: Outcome;
  yourScore: number;
  opponentScore: number;
}

const OUTCOME_LABEL: Record<Outcome, string> = { win: '승리', lose: '패배', draw: '무승부' };

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_LABEL[outcome];
}

/** One line of the end-of-match summary, e.g. "1라운드 승리 · 내 12점 : 상대 9점". */
export function describeRound(record: RoundRecord, index: number): string {
  return `${index + 1}라운드 ${OUTCOME_LABEL[record.result]} · 내 ${record.yourScore}점 : 상대 ${record.opponentScore}점`;
}

/** "2:05" — minutes and seconds, rounded up so the clock never shows 0:00 while time is left. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface SoloSummary {
  level: number;
  outcome: 'cleared' | 'timeout';
  timeLeftMs: number;
  elapsedMs: number;
  mistakes: number;
  removed: number;
  total: number;
}
