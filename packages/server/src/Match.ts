import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import {
  GAMEPLAY,
  applyMove,
  createMatchState,
  createRoundState,
  generateBoard,
  getMatchWinner,
  getRoundWinner,
  isMatchOver,
  nextFirstPlayer,
  otherSlot,
  passTurn,
  recordRoundResult,
  type MatchState,
  type PlayerSlot,
  type PlayerTag,
  type RoundState,
} from '@arrows/shared';

type Idx = PlayerSlot;
const TAGS: [PlayerTag, PlayerTag] = ['p1', 'p2'];
const other = otherSlot;

interface PlayerSlotInfo {
  socket: Socket;
  nickname: string;
  ready: boolean;
}

/**
 * Server-authoritative state for one 1v1 match on shared boards. The server is the only clock
 * that matters: every tap is timestamped on arrival (Date.now()) and judged here by the same
 * @arrows/shared `applyMove()`, and the turn timer lives here too — a client's claims about
 * whose turn it is or how much time is left are never trusted.
 */
export class Match {
  readonly id = randomUUID();
  private players: [PlayerSlotInfo, PlayerSlotInfo];
  private matchState: MatchState = createMatchState();
  private round: RoundState | null = null;
  private roundOver = true;
  private first: Idx = Math.random() < 0.5 ? 0 : 1;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  /** `onFinished` fires exactly once — when the match ends normally or a player disconnects. */
  constructor(
    a: { socket: Socket; nickname: string },
    b: { socket: Socket; nickname: string },
    private readonly onFinished: () => void = () => {},
  ) {
    this.players = [
      { socket: a.socket, nickname: a.nickname, ready: false },
      { socket: b.socket, nickname: b.nickname, ready: false },
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
    if (i === -1 || !this.roundOver) return;
    this.players[i].ready = true;
    if (this.players[0].ready && this.players[1].ready) {
      this.startRound();
    }
  }

  private startRound(): void {
    for (const player of this.players) player.ready = false;

    const board = generateBoard({
      rows: GAMEPLAY.GRID_ROWS,
      cols: GAMEPLAY.GRID_COLS,
      minLength: GAMEPLAY.ARROW_MIN_LENGTH,
      maxLength: GAMEPLAY.ARROW_MAX_LENGTH,
      fill: GAMEPLAY.BOARD_FILL,
    });
    // The first round's opener is random (set at construction); later rounds follow nextFirstPlayer().
    const startsAt = Date.now() + GAMEPLAY.ROUND_START_GRACE_MS;
    this.round = createRoundState(board, this.first, startsAt);
    this.roundOver = false;

    for (const player of this.players) {
      player.socket.emit('round:start', {
        roundIndex: this.matchState.roundIndex,
        board,
        first: TAGS[this.first],
        startsInMs: GAMEPLAY.ROUND_START_GRACE_MS,
      });
    }

    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.announceTurn(GAMEPLAY.FIRST_TURN_MS);
    }, GAMEPLAY.ROUND_START_GRACE_MS);
  }

  /** Tells both players whose turn it is and arms the timer that will end it. */
  private announceTurn(durationMs: number): void {
    const round = this.round;
    if (!round || this.roundOver) return;
    for (const player of this.players) {
      player.socket.emit('turn:start', { player: TAGS[round.turn], durationMs });
    }
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => this.onTurnTimeout(round), durationMs);
  }

  /** The turn ran out without a blocked tap: no penalty, the other player simply takes over. */
  private onTurnTimeout(round: RoundState): void {
    this.turnTimer = null;
    if (round !== this.round || this.roundOver) return;
    passTurn(round, Date.now());
    this.announceTurn(GAMEPLAY.TURN_MS);
  }

  handleAttempt(socket: Socket, roundIndex: number, arrowId: string): void {
    const i = this.indexOf(socket);
    const round = this.round;
    if (i === -1 || !round || this.roundOver) return;
    if (roundIndex !== this.matchState.roundIndex) return;

    const outcome = applyMove(round, i, arrowId, Date.now());
    // 'rejected' (wrong turn / expired / already gone / unknown): a well-behaved client's own
    // gating should already prevent this in normal play — silently ignore, no penalty.
    if (outcome.type === 'rejected') return;

    const scores = { p1: round.scores[0], p2: round.scores[1] };
    // Both players see every tap — the removal, or the failure — so the board stays in sync.
    for (const player of this.players) {
      player.socket.emit('attempt:result', {
        player: TAGS[i],
        arrowId,
        correct: outcome.type === 'removed',
        scores,
        remaining: round.remainingIds.size,
      });
    }

    if (outcome.type === 'removed') {
      if (outcome.finished) this.finishRound();
      return;
    }
    // Blocked: applyMove already handed the turn over.
    this.announceTurn(GAMEPLAY.TURN_MS);
  }

  private finishRound(): void {
    const round = this.round!;
    this.roundOver = true;
    this.clearTimers();

    const winner = getRoundWinner(round);
    const roundIndexJustPlayed = this.matchState.roundIndex;
    this.matchState = recordRoundResult(this.matchState, winner, round.scores);
    this.first = nextFirstPlayer(this.first, winner);

    const scores = { p1: round.scores[0], p2: round.scores[1] };
    const roundWins = { p1: this.matchState.roundWins[0], p2: this.matchState.roundWins[1] };
    for (const player of this.players) {
      player.socket.emit('round:finished', {
        roundIndex: roundIndexJustPlayed,
        winner: winner === null ? null : TAGS[winner],
        scores,
        roundWins,
      });
    }

    if (isMatchOver(this.matchState)) {
      const matchWinner = getMatchWinner(this.matchState);
      for (const player of this.players) {
        player.socket.emit('match:finished', {
          winner: matchWinner === null ? null : TAGS[matchWinner],
          roundWins,
        });
      }
      this.onFinished();
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private clearTimers(): void {
    this.clearTurnTimer();
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
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

    this.roundOver = true;
    this.clearTimers();
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
