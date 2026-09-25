import { ROOM } from './config.js';
import type { RoomSummary } from '../protocol.js';

export type RoomPhase = 'waiting' | 'playing' | 'result';

export interface RoomPlayer {
  id: string;
  nickname: string;
}

export interface RoomState {
  id: string;
  /** Join order; the first entry is the host (its nickname titles the room). */
  players: RoomPlayer[];
  phase: RoomPhase;
  /** Ids of players who asked for a rematch since the last match ended. */
  votes: string[];
}

export function createRoom(id: string, host: RoomPlayer): RoomState {
  return { id, players: [host], phase: 'waiting', votes: [] };
}

export function isFull(room: RoomState): boolean {
  return room.players.length >= ROOM.CAPACITY;
}

export function hasPlayer(room: RoomState, playerId: string): boolean {
  return room.players.some((p) => p.id === playerId);
}

/** Only a waiting room with a free seat can be entered — never one mid-match or on its result screen. */
export function canJoin(room: RoomState): boolean {
  return room.phase === 'waiting' && !isFull(room);
}

/** Returns the room unchanged when the player cannot join (callers check `canJoin` for the reason). */
export function addPlayer(room: RoomState, player: RoomPlayer): RoomState {
  if (!canJoin(room) || hasPlayer(room, player.id)) return room;
  return { ...room, players: [...room.players, player] };
}

/**
 * Whoever remains goes back to waiting for a new opponent — and becomes the host if the host
 * left. An empty room stays `waiting` with no players; the caller deletes it.
 */
export function removePlayer(room: RoomState, playerId: string): RoomState {
  if (!hasPlayer(room, playerId)) return room;
  return { ...room, players: room.players.filter((p) => p.id !== playerId), phase: 'waiting', votes: [] };
}

export function startPlaying(room: RoomState): RoomState {
  return { ...room, phase: 'playing', votes: [] };
}

export function finishPlaying(room: RoomState): RoomState {
  return { ...room, phase: 'result', votes: [] };
}

/** Records a rematch vote; `start` is true once every seated player has voted. Votes only count on the result screen. */
export function voteRematch(room: RoomState, playerId: string): { room: RoomState; start: boolean } {
  if (room.phase !== 'result' || !hasPlayer(room, playerId) || room.votes.includes(playerId)) {
    return { room, start: false };
  }
  const next = { ...room, votes: [...room.votes, playerId] };
  return { room: next, start: next.votes.length >= next.players.length };
}

export function playersWhoDidNotVote(room: RoomState): RoomPlayer[] {
  return room.players.filter((p) => !room.votes.includes(p.id));
}

export function toSummary(room: RoomState): RoomSummary {
  return {
    id: room.id,
    title: `${room.players[0]?.nickname ?? ''}의 방`,
    players: room.players.length,
    capacity: ROOM.CAPACITY,
    playing: room.phase !== 'waiting',
  };
}
