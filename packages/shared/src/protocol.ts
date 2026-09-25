import type { Arrow, Board } from './game/types.js';

// The wire format is the game model itself: plain data, no behaviour.
export type ArrowDTO = Arrow;
export type BoardDTO = Board;

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
    /** Who opens the round. */
    first: PlayerTag;
    /** Time until the first turn begins, measured from receipt so client and server clocks need not agree. */
    startsInMs: number;
  }) => void;
  /** A turn begins — at the start of a round and whenever the turn changes hands. */
  'turn:start': (payload: { player: PlayerTag; durationMs: number }) => void;
  /** Sent to *both* players: the arrow is gone from the shared board (correct) or blocked (not correct). */
  'attempt:result': (payload: {
    player: PlayerTag;
    arrowId: string;
    correct: boolean;
    scores: { p1: number; p2: number };
    remaining: number;
  }) => void;
  'round:finished': (payload: {
    roundIndex: number;
    /** Null when both scored the same. */
    winner: PlayerTag | null;
    scores: { p1: number; p2: number };
    roundWins: { p1: number; p2: number };
  }) => void;
  'match:finished': (payload: {
    /** Null for a draw. */
    winner: PlayerTag | null;
    roundWins: { p1: number; p2: number };
  }) => void;
  'opponent:disconnected': (payload: { matchId: string }) => void;
  'error:generic': (payload: { code: string; message: string }) => void;
}
