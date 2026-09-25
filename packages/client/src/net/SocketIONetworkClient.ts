import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@arrows/shared';
import type { ConnectionState, NetworkClient } from './NetworkClient.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

export class SocketIONetworkClient implements NetworkClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private connectionHandlers: ((state: ConnectionState) => void)[] = [];
  private state: ConnectionState | null = null;
  private everConnected = false;

  constructor() {
    this.socket = io(SERVER_URL, { autoConnect: false });
    this.socket.on('connect', () => {
      this.everConnected = true;
      this.setState('connected');
    });
    this.socket.on('disconnect', () => this.setState('disconnected'));
    // Before the first successful connection a failure just means "still trying" (cold start);
    // after it, a failure means the link we had is gone.
    this.socket.on('connect_error', () => this.setState(this.everConnected ? 'disconnected' : 'connecting'));
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const handler of this.connectionHandlers) handler(next);
  }

  connect(): void {
    this.setState('connecting');
    this.socket.connect();
  }

  onConnectionChange(handler: (state: ConnectionState) => void): void {
    this.connectionHandlers.push(handler);
    if (this.state !== null) handler(this.state);
  }

  createRoom(nickname: string): void {
    this.socket.emit('room:create', { nickname });
  }

  joinRoom(roomId: string, nickname: string): void {
    this.socket.emit('room:join', { roomId, nickname });
  }

  leaveRoom(): void {
    this.socket.emit('room:leave');
  }

  voteRematch(): void {
    this.socket.emit('rematch:vote');
  }

  startSolo(level: number): void {
    this.socket.emit('solo:start', { level });
  }

  soloClick(gameId: string, arrowId: string): void {
    this.socket.emit('solo:click', { gameId, arrowId });
  }

  leaveSolo(): void {
    this.socket.emit('solo:leave');
  }

  sendReady(matchId: string, roundIndex: number): void {
    this.socket.emit('round:ready', { matchId, roundIndex });
  }

  sendAttempt(matchId: string, roundIndex: number, arrowId: string): void {
    this.socket.emit('attempt:click', { matchId, roundIndex, arrowId });
  }

  on<K extends keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]): void {
    const onAny = this.socket.on.bind(this.socket) as (ev: string, fn: (...args: unknown[]) => void) => void;
    onAny(event, handler as unknown as (...args: unknown[]) => void);
  }
}
