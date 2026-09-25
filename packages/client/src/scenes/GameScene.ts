import Phaser from 'phaser';
import { findEscapableArrows, type BoardDTO, type Direction, type PlayerTag, type RoomSummary } from '@arrows/shared';
import { RENDER, cellToPosition, getTileSize } from '../game/config.js';
import { gameEvents } from '../net/events.js';
import { SocketIONetworkClient } from '../net/SocketIONetworkClient.js';
import type { NetworkClient } from '../net/NetworkClient.js';
import type { RoundRecord } from '../game/summary.js';
import { createLobby, type Lobby } from '../ui/lobby.js';

const DIRECTION_ANGLE: Record<Direction, number> = { up: 0, right: 90, down: 180, left: 270 };

interface TileSprites {
  bg: Phaser.GameObjects.Image;
  arrow: Phaser.GameObjects.Image;
}

/** Dev-only hook so end-to-end tests can drive a real match without guessing screen coords. */
interface ArrowsDebugHook {
  getTiles: () => { id: string; x: number; y: number }[];
  getEscapable: () => string[];
  getYou: () => PlayerTag | null;
  getMatchId: () => string | null;
  /** The lobby's list of open rooms, as last sent by the server. */
  getRooms: () => RoomSummary[];
  /** These skip the lobby form and act directly under `name`. */
  createRoom: (name: string) => void;
  joinRoom: (roomId: string, name: string) => void;
  leaveRoom: () => void;
  voteRematch: () => void;
}
declare global {
  interface Window {
    __arrowsDebug?: ArrowsDebugHook;
  }
}

/**
 * Owns rendering and input only — every judgment call (is this click correct, who won the
 * round) is made server-side; this scene just reflects whatever @arrows/shared-authoritative
 * result the server sends back over `net`. No local rule logic runs here, so there is never
 * a client/server disagreement to reconcile.
 */
export class GameScene extends Phaser.Scene {
  private net!: NetworkClient;
  private lobby!: Lobby;
  /** Which screen the player is on; decides how a dropped connection is handled. */
  private phase: 'idle' | 'room' | 'match' | 'result' | 'disconnected' = 'idle';
  private openRooms: RoomSummary[] = [];
  private rounds: RoundRecord[] = [];
  private tiles = new Map<string, TileSprites>();
  private board: BoardDTO | null = null;
  private totalArrows = 0;
  private attemptTimeoutMs = 10_000;
  private matchId: string | null = null;
  private you: PlayerTag | null = null;
  private roundIndex = 0;
  private roundWins = { p1: 0, p2: 0 };
  private inputLocked = true;
  private roundOver = true;
  private matchOver = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(RENDER.COLORS.background);
    this.tiles.clear();

    this.lobby = createLobby({
      onCreateRoom: (nickname) => this.net.createRoom(nickname),
      onJoinRoom: (roomId, nickname) => this.net.joinRoom(roomId, nickname),
      // The server answers with `room:left`, which is what actually returns us to the lobby.
      onLeaveRoom: () => this.net.leaveRoom(),
      onRematch: () => this.net.voteRematch(),
      onToLobby: () => {
        this.resetMatch();
        this.lobby.show('idle');
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.lobby.destroy());

    this.net = new SocketIONetworkClient();
    this.registerNetworkHandlers();
    this.net.connect();

    if (import.meta.env.DEV) {
      window.__arrowsDebug = {
        getTiles: () => Array.from(this.tiles.keys()).map((id) => this.tileDebugInfo(id)).filter((t): t is { id: string; x: number; y: number } => t !== null),
        getEscapable: () => (this.board ? findEscapableArrows(this.board, new Set(this.tiles.keys())).map((a) => a.id) : []),
        getYou: () => this.you,
        getMatchId: () => this.matchId,
        getRooms: () => this.openRooms,
        createRoom: (name) => this.net.createRoom(name),
        joinRoom: (roomId, name) => this.net.joinRoom(roomId, name),
        leaveRoom: () => this.net.leaveRoom(),
        voteRematch: () => this.net.voteRematch(),
      };
    }
  }

  private tileDebugInfo(id: string): { id: string; x: number; y: number } | null {
    const sprites = this.tiles.get(id);
    if (!sprites) return null;
    return { id, x: sprites.bg.x, y: sprites.bg.y };
  }

  /**
   * Back to a blank slate for the next match. The scene itself is never restarted — the
   * socket, lobby and UIScene all live across matches.
   */
  private resetMatch(): void {
    // Pending delayed calls (ready pings, input unlock, wrong-click unlock) belong to the old match.
    this.time.removeAllEvents();
    this.clearTiles();
    this.board = null;
    this.totalArrows = 0;
    this.matchId = null;
    this.you = null;
    this.roundIndex = 0;
    this.roundWins = { p1: 0, p2: 0 };
    this.inputLocked = true;
    this.roundOver = true;
    this.matchOver = false;
    this.rounds = [];
    this.phase = 'idle';
    gameEvents.clearReplay();
    gameEvents.typedEmit('match:reset', {});
  }

  private registerNetworkHandlers(): void {
    this.net.onConnectionChange((state) => {
      this.lobby.setConnection(state);
      // The server already scored an interrupted match as a loss and dropped us from our room,
      // so there is nothing to resume — tell the player and let them go back to the lobby.
      if (state === 'disconnected' && this.phase !== 'idle' && this.phase !== 'disconnected') {
        this.resetMatch();
        this.phase = 'disconnected';
        this.lobby.show('disconnected');
      }
    });

    this.net.on('rooms:list', (rooms) => {
      this.openRooms = rooms;
      this.lobby.setRooms(rooms);
    });

    this.net.on('room:joined', (snapshot) => {
      this.phase = 'room';
      this.lobby.setRoom(snapshot);
      this.lobby.show('room');
    });

    this.net.on('room:updated', (snapshot) => this.lobby.setRoom(snapshot));

    this.net.on('room:left', ({ reason }) => {
      this.resetMatch();
      this.lobby.show('idle');
      if (reason === 'timeout') this.lobby.showNotice('10초 안에 다시 하기를 누르지 않아 방에서 나왔습니다.');
    });

    this.net.on('room:error', ({ code }) => this.lobby.showError(code));

    this.net.on('rematch:open', ({ timeoutMs }) => this.lobby.openRematch(timeoutMs));
    this.net.on('rematch:status', (status) => this.lobby.setRematchStatus(status));

    this.net.on('match:found', ({ matchId, opponentNickname, you }) => {
      // A rematch starts in the same room, straight from the previous match's result screen.
      this.resetMatch();
      this.phase = 'match';
      this.lobby.show('hidden');
      this.matchId = matchId;
      this.you = you;
      gameEvents.typedEmit('net:match-found', { opponentNickname, you });
      this.time.delayedCall(1200, () => {
        if (this.matchId) this.net.sendReady(this.matchId, 0);
      });
    });

    this.net.on('round:start', ({ roundIndex, board, attemptTimeoutMs, serverStartAt }) => {
      this.roundIndex = roundIndex;
      this.beginRound(board, attemptTimeoutMs, serverStartAt);
    });

    this.net.on('attempt:result', ({ arrowId, correct, remaining, lockedUntil, finished }) => {
      if (correct) {
        this.removeTile(arrowId);
        gameEvents.typedEmit('attempt:correct', { remaining, total: this.totalArrows });
        if (finished) {
          this.roundOver = true;
          this.inputLocked = true;
        } else {
          gameEvents.typedEmit('window:start', { windowStart: performance.now(), timeoutMs: this.attemptTimeoutMs });
        }
        return;
      }

      this.flashWrong(arrowId);
      this.inputLocked = true;
      const delay = Math.max(0, (lockedUntil ?? Date.now()) - Date.now());
      gameEvents.typedEmit('attempt:wrong', { lockedUntil: performance.now() + delay });
      this.time.delayedCall(delay, () => {
        this.inputLocked = false;
        gameEvents.typedEmit('window:start', { windowStart: performance.now(), timeoutMs: this.attemptTimeoutMs });
      });
    });

    this.net.on('opponent:progress', (payload) => gameEvents.typedEmit('opponent:progress', payload));

    this.net.on('round:finished', ({ winner, roundWins, times, remaining }) => {
      this.roundOver = true;
      this.inputLocked = true;
      this.roundWins = roundWins;
      const you = this.you ?? 'p1';
      const opponent: PlayerTag = you === 'p1' ? 'p2' : 'p1';
      const record: RoundRecord = {
        youWon: winner === you,
        yourTimeMs: times[you],
        yourRemaining: remaining[you],
        opponentRemaining: remaining[opponent],
      };
      this.rounds.push(record);
      gameEvents.typedEmit('round:finished', { ...record, roundWins });

      this.time.delayedCall(2500, () => {
        if (this.matchId && !this.matchOver) this.net.sendReady(this.matchId, this.roundIndex + 1);
      });
    });

    this.net.on('match:finished', ({ winner, roundWins }) => {
      this.matchOver = true;
      this.roundOver = true;
      this.inputLocked = true;
      this.phase = 'result';
      const youWon = winner === this.you;
      gameEvents.typedEmit('match:finished', { youWon, roundWins });
      this.lobby.showResult({ youWon, roundWins, rounds: this.rounds });
    });
  }

  private beginRound(board: BoardDTO, attemptTimeoutMs: number, serverStartAt: number): void {
    this.clearTiles();
    this.attemptTimeoutMs = attemptTimeoutMs;
    this.board = board;
    this.totalArrows = board.arrows.length;
    this.roundOver = false;
    this.inputLocked = true;

    const tileSize = getTileSize();
    for (const arrow of board.arrows) {
      const { x, y } = cellToPosition(arrow.row, arrow.col);
      const bg = this.add.image(x, y, 'tile-bg').setDisplaySize(tileSize, tileSize).setInteractive({ useHandCursor: true });
      const arrowSprite = this.add
        .image(x, y, 'arrow-tri')
        .setDisplaySize(tileSize * 0.6, tileSize * 0.6)
        .setAngle(DIRECTION_ANGLE[arrow.dir]);

      bg.on('pointerup', () => this.handleClick(arrow.id));
      this.tiles.set(arrow.id, { bg, arrow: arrowSprite });
    }

    gameEvents.typedEmit('round:preview', { total: this.totalArrows, roundIndex: this.roundIndex, roundWins: this.roundWins });
    gameEvents.typedEmit('net:round-countdown', { serverStartAt });

    const delay = Math.max(0, serverStartAt - Date.now());
    this.time.delayedCall(delay, () => {
      this.inputLocked = false;
      const startedAt = performance.now();
      gameEvents.typedEmit('round:start', { startedAt });
      gameEvents.typedEmit('window:start', { windowStart: startedAt, timeoutMs: this.attemptTimeoutMs });
    });
  }

  private handleClick(arrowId: string): void {
    if (this.roundOver || this.inputLocked || !this.matchId) return;
    this.net.sendAttempt(this.matchId, this.roundIndex, arrowId);
  }

  private clearTiles(): void {
    for (const sprites of this.tiles.values()) {
      sprites.bg.destroy();
      sprites.arrow.destroy();
    }
    this.tiles.clear();
  }

  private flashWrong(arrowId: string): void {
    const sprites = this.tiles.get(arrowId);
    if (!sprites) return;
    this.tweens.add({ targets: sprites.bg, duration: RENDER.TWEEN_MS, yoyo: true, repeat: 1, alpha: 0.4 });
    sprites.bg.setTint(RENDER.COLORS.wrongFlash);
    this.time.delayedCall(RENDER.TWEEN_MS * 2, () => sprites.bg.clearTint());
  }

  private removeTile(arrowId: string): void {
    const sprites = this.tiles.get(arrowId);
    if (!sprites) return;
    this.tiles.delete(arrowId);

    sprites.bg.setTint(RENDER.COLORS.correctFlash);
    this.tweens.add({
      targets: [sprites.bg, sprites.arrow],
      duration: RENDER.TWEEN_MS,
      scale: 0,
      alpha: 0,
      onComplete: () => {
        sprites.bg.destroy();
        sprites.arrow.destroy();
      },
    });
  }
}
