import Phaser from 'phaser';
import type { PlayerTag } from '@arrows/shared';
import type { Outcome } from '../game/summary.js';

/**
 * Cross-scene communication bus (phaser-game skill: scenes never touch each other's
 * internal fields directly). Typed thinly over Phaser's own EventEmitter.
 */
export interface GameEventMap {
  'net:match-found': { opponentNickname: string; you: PlayerTag };
  /** The whole match is over or abandoned — UIScene wipes its labels and overlay. */
  'match:reset': Record<string, never>;
  /** Fired the instant a new round's arrows are drawn (before the start countdown) so labels never show stale data during it. */
  'round:preview': { total: number; roundIndex: number; roundWins: { p1: number; p2: number }; youFirst: boolean };
  /** The pre-round countdown; `startsAt` is on the `performance.now()` clock. */
  'round:countdown': { startsAt: number };
  /** A turn begins. `startedAt` and the duration are local `performance.now()` time, never server timestamps. */
  'turn:start': { yours: boolean; startedAt: number; durationMs: number };
  /** Points and arrows left, after every tap by either player. */
  'score:update': { you: number; opponent: number; remaining: number };
  'round:finished': {
    result: Outcome;
    yourScore: number;
    opponentScore: number;
    roundWins: { p1: number; p2: number };
  };
  'match:finished': { result: Outcome; roundWins: { p1: number; p2: number } };
  /** A solo run was dealt; `startsAt` is on the `performance.now()` clock. */
  'solo:preview': { total: number; startsAt: number; timeLimitMs: number };
  /** After every tap: the clock (`deadline`, `performance.now()` clock), mistakes and arrows left. */
  'solo:update': { deadline: number; mistakes: number; remaining: number; total: number };
  'solo:finished': { outcome: 'cleared' | 'timeout'; timeLeftMs: number };
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
