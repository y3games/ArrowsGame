import Phaser from 'phaser';
import type { PlayerTag } from '@arrows/shared';

/**
 * Cross-scene communication bus (phaser-game skill: scenes never touch each other's
 * internal fields directly). Typed thinly over Phaser's own EventEmitter.
 */
export interface GameEventMap {
  'net:match-found': { opponentNickname: string; you: PlayerTag };
  'net:round-countdown': { serverStartAt: number };
  /** The whole match is over or abandoned — UIScene wipes its labels and overlay. */
  'match:reset': Record<string, never>;
  /** Fired the instant a new round's tiles are drawn (before the start countdown) so labels never show stale data during it. */
  'round:preview': { total: number; roundIndex: number; roundWins: { p1: number; p2: number } };
  /** Fired when the countdown ends and input actually unlocks — starts the stopwatch. */
  'round:start': { startedAt: number };
  'window:start': { windowStart: number; timeoutMs: number };
  'attempt:correct': { remaining: number; total: number };
  'attempt:wrong': { lockedUntil: number };
  'opponent:progress': { remaining: number; total: number };
  'round:finished': {
    youWon: boolean;
    roundWins: { p1: number; p2: number };
    /** The winner's clear time; null when the opponent won. */
    yourTimeMs: number | null;
    yourRemaining: number;
    opponentRemaining: number;
  };
  'match:finished': { youWon: boolean; roundWins: { p1: number; p2: number } };
}

class TypedEmitter extends Phaser.Events.EventEmitter {
  // GameScene and UIScene are launched independently by BootScene, so their create()
  // order isn't guaranteed — replaying the last payload on subscribe means UIScene
  // never misses a "current state" event just because it started listening a tick late.
  private lastPayloads = new Map<keyof GameEventMap, GameEventMap[keyof GameEventMap]>();

  typedEmit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    this.lastPayloads.set(event, payload);
    this.emit(event, payload);
  }

  typedOn<K extends keyof GameEventMap>(event: K, fn: (payload: GameEventMap[K]) => void, context?: unknown): void {
    this.on(event, fn, context);
    const last = this.lastPayloads.get(event);
    if (last !== undefined) {
      fn.call(context, last as GameEventMap[K]);
    }
  }

  /**
   * Drop the remembered payloads (not the listeners). Called when a match is reset so a
   * subscriber that attaches later is not handed the previous match's results. The replay
   * itself must stay — see the note on `lastPayloads`.
   */
  clearReplay(): void {
    this.lastPayloads.clear();
  }
}

export const gameEvents = new TypedEmitter();
