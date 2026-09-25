import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import {
  GAMEPLAY,
  SOLO,
  applySoloMove,
  createSoloState,
  generateBoard,
  soloTimeLeftMs,
  type SoloState,
} from '@arrows/shared';

/**
 * One single-player run, judged by the server just like a multiplayer match: the clock and the
 * penalties live here, and the client only ever changes what it shows from what this sends.
 */
export class SoloGame {
  readonly id = randomUUID();
  private state: SoloState | null = null;
  private finished = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  /** `onFinished` fires once, when the board is cleared or the time runs out. */
  constructor(
    private readonly socket: Socket,
    private readonly onFinished: () => void,
  ) {}

  start(): void {
    const board = generateBoard({
      rows: GAMEPLAY.GRID_ROWS,
      cols: GAMEPLAY.GRID_COLS,
      minLength: GAMEPLAY.ARROW_MIN_LENGTH,
      maxLength: GAMEPLAY.ARROW_MAX_LENGTH,
      fill: GAMEPLAY.BOARD_FILL,
      straightBias: GAMEPLAY.ARROW_STRAIGHT_BIAS,
      interlock: GAMEPLAY.BOARD_INTERLOCK,
    });
    this.state = createSoloState(board, Date.now() + GAMEPLAY.ROUND_START_GRACE_MS);
    this.socket.emit('solo:started', {
      gameId: this.id,
      board,
      startsInMs: GAMEPLAY.ROUND_START_GRACE_MS,
      timeLimitMs: SOLO.TIME_LIMIT_MS,
    });
    this.armTimeout();
  }

  handleClick(gameId: string, arrowId: string): void {
    const state = this.state;
    if (!state || this.finished || gameId !== this.id) return;

    const outcome = applySoloMove(state, arrowId, Date.now());
    // Rejected taps (before the start, already gone, ...) are ignored without penalty.
    if (outcome.type === 'rejected') return;

    this.socket.emit('solo:result', {
      arrowId,
      correct: outcome.type === 'removed',
      remaining: state.remainingIds.size,
      mistakes: state.mistakes,
      timeLeftMs: outcome.timeLeftMs,
    });

    if (outcome.type === 'removed') {
      if (outcome.finished) this.finish('cleared');
      return;
    }
    if (outcome.timedOut) this.finish('timeout');
    else this.armTimeout(); // the penalty just moved the deadline closer
  }

  /** Stops the game silently — the player left or disconnected. */
  dispose(): void {
    this.finished = true;
    this.clearTimer();
  }

  private armTimeout(): void {
    const state = this.state;
    if (!state) return;
    this.clearTimer();
    const wait = state.startsAt - Date.now() + soloTimeLeftMs(state, state.startsAt);
    this.timeoutTimer = setTimeout(() => this.finish('timeout'), Math.max(0, wait));
  }

  private clearTimer(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
  }

  private finish(outcome: 'cleared' | 'timeout'): void {
    const state = this.state;
    if (!state || this.finished) return;
    this.finished = true;
    this.clearTimer();

    const now = Date.now();
    const total = state.board.arrows.length;
    this.socket.emit('solo:finished', {
      outcome,
      timeLeftMs: outcome === 'timeout' ? 0 : soloTimeLeftMs(state, now),
      elapsedMs: Math.max(0, Math.min(now - state.startsAt, SOLO.TIME_LIMIT_MS)),
      mistakes: state.mistakes,
      removed: total - state.remainingIds.size,
      total,
    });
    this.onFinished();
  }
}
