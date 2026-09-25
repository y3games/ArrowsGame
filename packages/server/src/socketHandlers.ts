import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@arrows/shared';
import { dequeue, enqueue, isQueued } from './matchmaking.js';
import { Match } from './Match.js';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Matches the client's limit; the client is not trusted to enforce it. */
const MAX_NICKNAME_LENGTH = 12;

/** socket.id -> the Match that socket is currently playing in. */
const activeMatches = new Map<string, Match>();

/**
 * A finished match must not linger: the same sockets re-enter the queue for a rematch, and a
 * later disconnect of either one must not be attributed to the old match.
 */
function releaseMatch(match: Match): void {
  for (const s of match.sockets) {
    if (activeMatches.get(s.id) === match) activeMatches.delete(s.id);
    s.leave(match.id);
  }
}

export function registerSocketHandlers(io: AppServer): void {
  io.on('connection', (socket: AppSocket) => {
    socket.on('queue:join', ({ nickname }) => {
      // Ignore repeats: a socket mid-match or already waiting must not be queued again.
      if (activeMatches.has(socket.id)) return;
      if (isQueued(socket)) {
        socket.emit('queue:waiting');
        return;
      }

      const pair = enqueue(socket, nickname?.trim().slice(0, MAX_NICKNAME_LENGTH) || `Player-${socket.id.slice(0, 4)}`);
      if (!pair) {
        socket.emit('queue:waiting');
        return;
      }

      const [a, b] = pair;
      const match: Match = new Match(a, b, () => releaseMatch(match));
      activeMatches.set(a.socket.id, match);
      activeMatches.set(b.socket.id, match);
      for (const s of match.sockets) s.join(match.id);
      match.announceMatchFound();
    });

    socket.on('queue:leave', () => dequeue(socket));

    socket.on('round:ready', ({ matchId }) => {
      const match = activeMatches.get(socket.id);
      if (match && match.id === matchId) match.markReady(socket);
    });

    socket.on('attempt:click', ({ matchId, roundIndex, arrowId }) => {
      const match = activeMatches.get(socket.id);
      if (match && match.id === matchId) match.handleAttempt(socket, roundIndex, arrowId);
    });

    socket.on('disconnect', () => {
      dequeue(socket);
      const match = activeMatches.get(socket.id);
      if (!match) return;
      match.handleDisconnect(socket);
      releaseMatch(match); // no-op if handleDisconnect already released it
    });
  });
}
