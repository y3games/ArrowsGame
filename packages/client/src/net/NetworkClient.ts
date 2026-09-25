import type { ServerToClientEvents } from '@arrows/shared';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/**
 * Transport-agnostic interface (mirrors the phaser-game skill's ScoreService pattern) —
 * GameScene depends only on this, never on socket.io-client directly.
 */
export interface NetworkClient {
  connect(): void;
  createRoom(nickname: string): void;
  joinRoom(roomId: string, nickname: string): void;
  /** Also how a player says "나가기" on the result screen. */
  leaveRoom(): void;
  voteRematch(): void;
  startSolo(level: number): void;
  soloClick(gameId: string, arrowId: string): void;
  leaveSolo(): void;
  sendReady(matchId: string, roundIndex: number): void;
  sendAttempt(matchId: string, roundIndex: number, arrowId: string): void;
  on<K extends keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]): void;
  /** Called with the new state whenever it changes (never twice in a row with the same value). */
  onConnectionChange(handler: (state: ConnectionState) => void): void;
}
