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

export interface RoomSummary {
  id: string;
  title: string;
  players: number;
  capacity: number;
  /** True once a match is running (or its result screen is up) — the room cannot be entered. */
  playing: boolean;
}

export interface RoomSnapshot {
  room: RoomSummary;
  /** Nicknames of everyone seated, host first. */
  players: string[];
}

export type RoomErrorCode = 'full' | 'not_found' | 'already_in_room';

export interface ClientToServerEvents {
  'room:create': (payload: { nickname?: string }) => void;
  'room:join': (payload: { roomId: string; nickname?: string }) => void;
  'room:leave': () => void;
  'rematch:vote': () => void;
  'round:ready': (payload: { matchId: string; roundIndex: number }) => void;
  'attempt:click': (payload: { matchId: string; roundIndex: number; arrowId: string }) => void;
}

export interface ServerToClientEvents {
  /** Open rooms; sent only to sockets that are not in a room, whenever the list changes. */
  'rooms:list': (rooms: RoomSummary[]) => void;
  /** To the socket that just entered a room (created or joined). */
  'room:joined': (payload: RoomSnapshot) => void;
  /** To everyone in a room whenever its seating changes. */
  'room:updated': (payload: RoomSnapshot) => void;
  /** To a socket that is no longer in its room: it asked to leave, or sat out the rematch window. */
  'room:left': (payload: { reason: 'leave' | 'timeout' }) => void;
  'room:error': (payload: { code: RoomErrorCode }) => void;
  /** The match just ended: both players have `timeoutMs` to vote for a rematch or be removed. */
  'rematch:open': (payload: { timeoutMs: number }) => void;
  'rematch:status': (payload: { youVoted: boolean; opponentVoted: boolean }) => void;
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
