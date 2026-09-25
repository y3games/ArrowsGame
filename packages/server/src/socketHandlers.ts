import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@arrows/shared';
import { RoomManager } from './rooms.js';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Matches the client's limit; the client is not trusted to enforce it. */
const MAX_NICKNAME_LENGTH = 12;

function cleanNickname(socket: AppSocket, nickname: string | undefined): string {
  return nickname?.trim().slice(0, MAX_NICKNAME_LENGTH) || `Player-${socket.id.slice(0, 4)}`;
}

export function registerSocketHandlers(io: AppServer): void {
  const rooms = new RoomManager(io);

  io.on('connection', (socket: AppSocket) => {
    rooms.onConnect(socket);

    socket.on('room:create', ({ nickname }) => rooms.create(socket, cleanNickname(socket, nickname)));
    socket.on('room:join', ({ roomId, nickname }) => rooms.join(socket, roomId, cleanNickname(socket, nickname)));
    socket.on('room:leave', () => rooms.leave(socket, 'leave'));
    socket.on('rematch:vote', () => rooms.vote(socket));

    socket.on('round:ready', ({ matchId }) => {
      const match = rooms.matchOf(socket);
      if (match && match.id === matchId) match.markReady(socket);
    });

    socket.on('attempt:click', ({ matchId, roundIndex, arrowId }) => {
      const match = rooms.matchOf(socket);
      if (match && match.id === matchId) match.handleAttempt(socket, roundIndex, arrowId);
    });

    socket.on('disconnect', () => rooms.leave(socket, 'leave'));
  });
}
