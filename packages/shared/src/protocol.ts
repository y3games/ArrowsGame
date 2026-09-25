import type { Direction } from './game/types.js';

export interface ArrowTileDTO {
  id: string;
  row: number;
  col: number;
  dir: Direction;
}

export interface BoardDTO {
  rows: number;
  cols: number;
  arrows: ArrowTileDTO[];
}

export type PlayerTag = 'p1' | 'p2';

export interface ClientToServerEvents {
  'queue:join': (payload: { nickname?: string }) => void;
  'queue:leave': () => void;
  'round:ready': (payload: { matchId: string; roundIndex: number }) => void;
  'attempt:click': (payload: { matchId: string; roundIndex: number; arrowId: string }) => void;
}

export interface ServerToClientEvents {
  'queue:waiting': () => void;
  'match:found': (payload: { matchId: string; opponentNickname: string; you: PlayerTag }) => void;
  'round:start': (payload: {
    roundIndex: number;
    board: BoardDTO;
    attemptTimeoutMs: number;
    serverStartAt: number;
  }) => void;
  'attempt:result': (payload: {
    arrowId: string;
    correct: boolean;
    remaining: number;
    lockedUntil: number | null;
    finished: boolean;
    elapsedMs?: number;
  }) => void;
  'opponent:progress': (payload: { remaining: number; total: number }) => void;
  'round:finished': (payload: {
    roundIndex: number;
    winner: PlayerTag;
    times: { p1: number | null; p2: number | null };
    roundWins: { p1: number; p2: number };
    /** Arrows each player still had left when the round ended. */
    remaining: { p1: number; p2: number };
  }) => void;
  'match:finished': (payload: { winner: PlayerTag; roundWins: { p1: number; p2: number } }) => void;
  'opponent:disconnected': (payload: { matchId: string }) => void;
  'error:generic': (payload: { code: string; message: string }) => void;
}
