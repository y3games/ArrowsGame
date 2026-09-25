import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  ROOM,
  addPlayer,
  canJoin,
  createRoom,
  finishPlaying,
  playersWhoDidNotVote,
  removePlayer,
  startPlaying,
  toSummary,
  voteRematch,
  type ClientToServerEvents,
  type RoomSnapshot,
  type RoomState,
  type RoomSummary,
  type ServerToClientEvents,
} from '@arrows/shared';
import { Match } from './Match.js';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Socket.IO room that every socket outside a game room sits in; it receives the room list. */
const LOBBY = 'lobby';

interface RoomEntry {
  state: RoomState;
  sockets: Map<string, AppSocket>;
  /** The match in progress; null while waiting or on the result screen. */
  match: Match | null;
  rematchTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Owns every room and which socket sits in which. The seating/vote rules are the pure
 * functions in @arrows/shared; this class only adds what they cannot know about — sockets,
 * the rematch timer and the `Match` that is running.
 */
export class RoomManager {
  private rooms = new Map<string, RoomEntry>();
  /** socket.id -> the room that socket is seated in. */
  private roomOf = new Map<string, string>();

  constructor(private readonly io: AppServer) {}

  onConnect(socket: AppSocket): void {
    socket.join(LOBBY);
    socket.emit('rooms:list', this.list());
  }

  create(socket: AppSocket, nickname: string): void {
    if (this.roomOf.has(socket.id)) {
      socket.emit('room:error', { code: 'already_in_room' });
      return;
    }
    const id = randomUUID();
    const entry: RoomEntry = {
      state: createRoom(id, { id: socket.id, nickname }),
      sockets: new Map([[socket.id, socket]]),
      match: null,
      rematchTimer: null,
    };
    this.rooms.set(id, entry);
    this.seat(socket, entry);
    socket.emit('room:joined', this.snapshot(entry));
    this.broadcastLobby();
  }

  join(socket: AppSocket, roomId: string, nickname: string): void {
    if (this.roomOf.has(socket.id)) {
      socket.emit('room:error', { code: 'already_in_room' });
      return;
    }
    const entry = this.rooms.get(roomId);
    if (!entry) {
      socket.emit('room:error', { code: 'not_found' });
      return;
    }
    if (!canJoin(entry.state)) {
      socket.emit('room:error', { code: 'full' });
      return;
    }

    entry.state = addPlayer(entry.state, { id: socket.id, nickname });
    entry.sockets.set(socket.id, socket);
    this.seat(socket, entry);
    socket.emit('room:joined', this.snapshot(entry));
    this.emitUpdated(entry, socket.id);
    // The second player is the last one needed: the match begins at once.
    this.startMatch(entry);
    this.broadcastLobby();
  }

  /**
   * Takes the socket out of its room — for an explicit leave, a rematch timeout or a dropped
   * connection alike. Whoever remains keeps the room and waits for a new opponent.
   */
  leave(socket: AppSocket, reason: 'leave' | 'timeout'): void {
    const entry = this.entryOf(socket);
    if (!entry) return;

    this.clearRematchTimer(entry);
    // Detach the match first: handleDisconnect() below reports the finish through `onFinished`,
    // and this room must not treat that as a normal end (no rematch window for a walkover).
    const match = entry.match;
    entry.match = null;

    entry.sockets.delete(socket.id);
    this.roomOf.delete(socket.id);
    entry.state = removePlayer(entry.state, socket.id);
    match?.handleDisconnect(socket);

    if (socket.connected) {
      socket.emit('room:left', { reason });
      socket.join(LOBBY);
      socket.emit('rooms:list', this.list());
    }

    if (entry.state.players.length === 0) {
      this.rooms.delete(entry.state.id);
    } else {
      this.emitUpdated(entry);
    }
    this.broadcastLobby();
  }

  vote(socket: AppSocket): void {
    const entry = this.entryOf(socket);
    if (!entry) return;

    const result = voteRematch(entry.state, socket.id);
    if (result.room === entry.state) return; // not on a result screen, or a repeat vote
    entry.state = result.room;

    if (result.start) {
      this.clearRematchTimer(entry);
      this.startMatch(entry);
      return;
    }
    for (const [id, s] of entry.sockets) {
      s.emit('rematch:status', {
        youVoted: entry.state.votes.includes(id),
        opponentVoted: entry.state.votes.some((v) => v !== id),
      });
    }
  }

  /** The running match this socket plays in, for routing `round:ready` and `attempt:click`. */
  matchOf(socket: AppSocket): Match | null {
    return this.entryOf(socket)?.match ?? null;
  }

  private startMatch(entry: RoomEntry): void {
    const [a, b] = entry.state.players;
    const sa = a && entry.sockets.get(a.id);
    const sb = b && entry.sockets.get(b.id);
    if (!a || !b || !sa || !sb) return;

    entry.state = startPlaying(entry.state);
    const match: Match = new Match({ socket: sa, nickname: a.nickname }, { socket: sb, nickname: b.nickname }, () =>
      this.onMatchFinished(entry, match),
    );
    entry.match = match;
    match.announceMatchFound();
  }

  private onMatchFinished(entry: RoomEntry, match: Match): void {
    if (entry.match !== match) return; // a player left first; leave() already dealt with it
    entry.match = null;
    entry.state = finishPlaying(entry.state);

    for (const s of entry.sockets.values()) s.emit('rematch:open', { timeoutMs: ROOM.REMATCH_WINDOW_MS });
    entry.rematchTimer = setTimeout(() => this.onRematchTimeout(entry), ROOM.REMATCH_WINDOW_MS);
  }

  private onRematchTimeout(entry: RoomEntry): void {
    entry.rematchTimer = null;
    if (entry.state.phase !== 'result') return;
    for (const player of playersWhoDidNotVote(entry.state)) {
      const s = entry.sockets.get(player.id);
      if (s) this.leave(s, 'timeout');
    }
  }

  private clearRematchTimer(entry: RoomEntry): void {
    if (entry.rematchTimer) clearTimeout(entry.rematchTimer);
    entry.rematchTimer = null;
  }

  private seat(socket: AppSocket, entry: RoomEntry): void {
    this.roomOf.set(socket.id, entry.state.id);
    socket.leave(LOBBY);
  }

  private entryOf(socket: AppSocket): RoomEntry | undefined {
    const roomId = this.roomOf.get(socket.id);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  private snapshot(entry: RoomEntry): RoomSnapshot {
    return { room: toSummary(entry.state), players: entry.state.players.map((p) => p.nickname) };
  }

  private emitUpdated(entry: RoomEntry, exceptId?: string): void {
    const snapshot = this.snapshot(entry);
    for (const [id, s] of entry.sockets) {
      if (id !== exceptId) s.emit('room:updated', snapshot);
    }
  }

  private list(): RoomSummary[] {
    return Array.from(this.rooms.values(), (entry) => toSummary(entry.state));
  }

  private broadcastLobby(): void {
    this.io.to(LOBBY).emit('rooms:list', this.list());
  }
}
