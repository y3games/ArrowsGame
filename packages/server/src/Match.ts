import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import {
  GAMEPLAY,
  applyAttempt,
  createMatchState,
  createRoundState,
  generateBoard,
  getMatchWinner,
  isMatchOver,
  recordRoundResult,
  type Board,
  type BoardDTO,
  type MatchState,
  type PlayerTag,
  type RoundState,
} from '@arrows/shared';

type Idx = 0 | 1;
const TAGS: [PlayerTag, PlayerTag] = ['p1', 'p2'];
const other = (i: Idx): Idx => (i === 0 ? 1 : 0);

interface PlayerSlot {
  socket: Socket;
  nickname: string;
  ready: boolean;
  roundState: RoundState | null;
}

/**
 * Server-authoritative state for one 1v1 match. The server is the only clock that
 * matters: every attempt is timestamped on arrival (Date.now()) and re-judged here via
 * the same @arrows/shared applyAttempt() the client runs locally for instant feedback —
 * the client's claims are never trusted directly.
 */
export class Match {
  readonly id = randomUUID();
  private players: [PlayerSlot, PlayerSlot];
  private matchState: MatchState = createMatchState();
  private board: Board | null = null;
  private roundOver = false;

  /** `onFinished` fires exactly once — when the match ends normally or a player disconnects. */
  constructor(
    a: { socket: Socket; nickname: string },
    b: { socket: Socket; nickname: string },
    private readonly onFinished: () => void = () => {},
  ) {
    this.players = [
      { socket: a.socket, nickname: a.nickname, ready: false, roundState: null },
      { socket: b.socket, nickname: b.nickname, ready: false, roundState: null },
    ];
  }

  announceMatchFound(): void {
    for (const i of [0, 1] as const) {
      const player = this.players[i];
      const opponent = this.players[other(i)];
      player.socket.emit('match:found', { matchId: this.id, opponentNickname: opponent.nickname, you: TAGS[i] });
    }
  }

  private indexOf(socket: Socket): Idx | -1 {
    if (this.players[0].socket.id === socket.id) return 0;
    if (this.players[1].socket.id === socket.id) return 1;
    return -1;
  }

  markReady(socket: Socket): void {
    const i = this.indexOf(socket);
    if (i === -1) return;
    this.players[i].ready = true;
    if (this.players[0].ready && this.players[1].ready) {
      this.startRound();
    }
  }

  private startRound(): void {
    const board = generateBoard({ rows: GAMEPLAY.GRID_ROWS, cols: GAMEPLAY.GRID_COLS, arrowCount: GAMEPLAY.ARROW_COUNT });
    this.board = board;
    const serverStartAt = Date.now() + GAMEPLAY.ROUND_START_GRACE_MS;
    this.roundOver = false;

    for (const i of [0, 1] as const) {
      this.players[i].ready = false;
      this.players[i].roundState = createRoundState(board, serverStartAt);
    }

    const boardDTO: BoardDTO = board;
    for (const player of this.players) {
      player.socket.emit('round:start', {
        roundIndex: this.matchState.roundIndex,
        board: boardDTO,
        attemptTimeoutMs: GAMEPLAY.ATTEMPT_TIMEOUT_MS,
        serverStartAt,
      });
    }
  }

  handleAttempt(socket: Socket, roundIndex: number, arrowId: string): void {
    const i = this.indexOf(socket);
    if (i === -1 || this.roundOver) return;
    if (roundIndex !== this.matchState.roundIndex) return;

    const player = this.players[i];
    if (!player.roundState) return;

    const outcome = applyAttempt(player.roundState, arrowId, Date.now());

    if (outcome.type === 'correct') {
      player.socket.emit('attempt:result', {
        arrowId,
        correct: true,
        remaining: outcome.remaining,
        lockedUntil: null,
        finished: outcome.finished,
        elapsedMs: outcome.elapsedMs,
      });

      const opponent = this.players[other(i)];
      opponent.socket.emit('opponent:progress', { remaining: outcome.remaining, total: this.board!.arrows.length });

      if (outcome.finished) {
        this.finishRound(i, outcome.elapsedMs ?? Date.now() - player.roundState.roundStartAt);
      }
      return;
    }

    if (outcome.type === 'wrong') {
      player.socket.emit('attempt:result', {
        arrowId,
        correct: false,
        remaining: player.roundState.remainingIds.size,
        lockedUntil: outcome.lockedUntil,
        finished: false,
      });
    }
    // 'rejected' (locked / already-removed / unknown-arrow): the client's own optimistic
    // state should already prevent this from happening in normal play — silently ignore.
  }

  private finishRound(winnerIndex: Idx, winnerElapsedMs: number): void {
    this.roundOver = true;
    const roundIndexJustPlayed = this.matchState.roundIndex;
    this.matchState = recordRoundResult(this.matchState, winnerIndex);

    const winnerTag = TAGS[winnerIndex];
    const times: { p1: number | null; p2: number | null } = { p1: null, p2: null };
    times[winnerTag] = winnerElapsedMs;

    const roundWins = { p1: this.matchState.roundWins[0], p2: this.matchState.roundWins[1] };
    const remaining = {
      p1: this.players[0].roundState?.remainingIds.size ?? 0,
      p2: this.players[1].roundState?.remainingIds.size ?? 0,
    };
    for (const player of this.players) {
      player.socket.emit('round:finished', {
        roundIndex: roundIndexJustPlayed,
        winner: winnerTag,
        times,
        roundWins,
        remaining,
      });
    }

    if (isMatchOver(this.matchState)) {
      const winner = getMatchWinner(this.matchState)!;
      for (const player of this.players) {
        player.socket.emit('match:finished', {
          winner: TAGS[winner],
          roundWins: { p1: this.matchState.roundWins[0], p2: this.matchState.roundWins[1] },
        });
      }
      this.onFinished();
    }
  }

  isOver(): boolean {
    return isMatchOver(this.matchState);
  }

  /**
   * Declares the remaining player the winner and returns their tag. Returns null (and sends
   * nothing) if the socket isn't in this match or the match already finished — a player leaving
   * after the result screen must not replay the result for the one who stayed.
   */
  handleDisconnect(socket: Socket): PlayerTag | null {
    const i = this.indexOf(socket);
    if (i === -1 || this.isOver()) return null;

    const opponent = this.players[other(i)];
    const opponentTag = TAGS[other(i)];
    opponent.socket.emit('opponent:disconnected', { matchId: this.id });
    opponent.socket.emit('match:finished', {
      winner: opponentTag,
      roundWins: { p1: this.matchState.roundWins[0], p2: this.matchState.roundWins[1] },
    });
    this.onFinished();
    return opponentTag;
  }
}
