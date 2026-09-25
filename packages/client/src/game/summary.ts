/** What the player saw at the end of one round, from their own point of view. */
export interface RoundRecord {
  youWon: boolean;
  /** The winner's clear time; null when the opponent won. */
  yourTimeMs: number | null;
  yourRemaining: number;
  opponentRemaining: number;
}

/** "42.3초" — one decimal place everywhere a duration is shown. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

/** One line of the end-of-match summary, e.g. "1라운드 승리 · 42.3초 · 상대 5개 남음". */
export function describeRound(record: RoundRecord, index: number): string {
  const label = `${index + 1}라운드`;
  if (record.youWon) {
    const time = record.yourTimeMs !== null ? ` · ${formatSeconds(record.yourTimeMs)}` : '';
    return `${label} 승리${time} · 상대 ${record.opponentRemaining}개 남음`;
  }
  return `${label} 패배 · 내 ${record.yourRemaining}개 남음`;
}
