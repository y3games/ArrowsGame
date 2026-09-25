import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@arrows/shared';
import { RoomManager } from './rooms.js';
import { SoloGame } from './SoloGame.js';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Matches the client's limit; the client is not trusted to enforce it. */
const MAX_NICKNAME_LENGTH = 12;

function cleanNickname(socket: AppSocket, nickname: string | undefined): string {
  return nickname?.trim().slice(0, MAX_NICKNAME_LENGTH) || `Player-${socket.id.slice(0, 4)}`;
}

export function registerSocketHandlers(io: AppServer): void {
  const rooms = new RoomManager(io);
  /** socket.id -> that socket's running solo game. A socket is in a room or in solo play, never both. */
  const soloGames = new Map<string, SoloGame>();

  /** Ends a solo run (finished, abandoned or disconnected) and, if the socket is still here, sends it back to the lobby. */
  function endSolo(socket: AppSocket, game: SoloGame): void {
    game.dispose();
    if (soloGames.get(socket.id) === game) soloGames.delete(socket.id);
    if (socket.connected) rooms.onConnect(socket);
  }

  io.on('connection', (socket: AppSocket) => {
    rooms.onConnect(socket);

    socket.on('room:create', ({ nickname }) => {
      if (soloGames.has(socket.id)) return void socket.emit('room:error', { code: 'already_in_room' });
      rooms.create(socket, cleanNickname(socket, nickname));
    });
    socket.on('room:join', ({ roomId, nickname }) => {
      if (soloGames.has(socket.id)) return void socket.emit('room:error', { code: 'already_in_room' });
      rooms.join(socket, roomId, cleanNickname(socket, nickname));
    });
    socket.on('room:leave', () => rooms.leave(socket, 'leave'));
    socket.on('rematch:vote', () => rooms.vote(socket));

    socket.on('solo:start', () => {
      if (rooms.isSeated(socket)) return void socket.emit('room:error', { code: 'already_in_room' });
      // "Play again" comes straight after the previous run; a stale one must not keep running.
      soloGames.get(socket.id)?.dispose();
      const game: SoloGame = new SoloGame(socket, () => endSolo(socket, game));
      soloGames.set(socket.id, game);
      rooms.leaveLobby(socket);
      game.start();
    });
    socket.on('solo:click', ({ gameId, arrowId }) => soloGames.get(socket.id)?.handleClick(gameId, arrowId));
    socket.on('solo:leave', () => {
      const game = soloGames.get(socket.id);
      if (game) endSolo(socket, game);
    });

    socket.on('round:ready', ({ matchId }) => {
      const match = rooms.matchOf(socket);
      if (match && match.id === matchId) match.markReady(socket);
    });

    socket.on('attempt:click', ({ matchId, roundIndex, arrowId }) => {
      const match = rooms.matchOf(socket);
      if (match && match.id === matchId) match.handleAttempt(socket, roundIndex, arrowId);
    });

    socket.on('disconnect', () => {
      const game = soloGames.get(socket.id);
      if (game) endSolo(socket, game);
      rooms.leave(socket, 'leave');
    });
  });
}
