import Phaser from 'phaser';
import { GAMEPLAY, findEscapableArrows, headOf, type ArrowDTO, type BoardDTO, type PlayerTag, type RoomSummary } from '@arrows/shared';
import { RENDER, cellToPosition, getCellSize, getGridLeft } from '../game/config.js';
import { bodyPoints, drawSnake, slidePath, subPath } from '../game/arrowGraphics.js';
import { gameEvents } from '../net/events.js';
import { SocketIONetworkClient } from '../net/SocketIONetworkClient.js';
import type { NetworkClient } from '../net/NetworkClient.js';
import type { Outcome, RoundRecord, SoloSummary } from '../game/summary.js';
import { createLobby, type Lobby } from '../ui/lobby.js';
import type { UIScene } from './UIScene.js';

/** One arrow on the shared board: its drawing plus the invisible tap targets over its cells. */
interface ArrowView {
  arrow: ArrowDTO;
  color: number;
  graphics: Phaser.GameObjects.Graphics;
  zones: Phaser.GameObjects.Zone[];
}

/** Dev-only hook so end-to-end tests can drive a real match without guessing screen coords. */
interface ArrowsDebugHook {
  /** Every arrow still on the board, with the centre of its head cell (a tap anywhere on it works). */
  getTiles: () => { id: string; x: number; y: number }[];
  getEscapable: () => string[];
  getYou: () => PlayerTag | null;
  getMatchId: () => string | null;
  isMyTurn: () => boolean;
  /** What the HUD is currently telling the player (banner, countdown label, seconds in the clock). */
  getHud: () => { banner: string; countdown: string; clock: string };
  /** The lobby's list of open rooms, as last sent by the server. */
  getRooms: () => RoomSummary[];
  /** These skip the lobby form and act directly under `name`. */
  createRoom: (name: string) => void;
  joinRoom: (roomId: string, name: string) => void;
  leaveRoom: () => void;
  voteRematch: () => void;
  startSolo: () => void;
  /** The board's remaining arrows and the solo game id, for driving a solo run in tests. */
  getSoloId: () => string | null;
}
declare global {
  interface Window {
    __arrowsDebug?: ArrowsDebugHook;
  }
}

/**
 * Owns rendering and input only — every judgment call (is this tap a removal, whose turn is it,
 * who won the round) is made server-side; this scene just reflects whatever @arrows/shared
 * result the server sends back over `net`. The board is shared: an arrow leaves this screen
 * only when the server says either player removed it, so both screens always agree.
 */
export class GameScene extends Phaser.Scene {
  private net!: NetworkClient;
  private lobby!: Lobby;
  /** Which screen the player is on; decides how a dropped connection is handled. */
  private phase: 'idle' | 'room' | 'match' | 'result' | 'solo' | 'disconnected' = 'idle';
  private openRooms: RoomSummary[] = [];
  private rounds: RoundRecord[] = [];
  private arrows = new Map<string, ArrowView>();
  private gridMask!: Phaser.Display.Masks.GeometryMask;
  private board: BoardDTO | null = null;
  private matchId: string | null = null;
  private you: PlayerTag | null = null;
  private roundIndex = 0;
  private roundWins = { p1: 0, p2: 0 };
  private myTurn = false;
  private roundOver = true;
  private matchOver = false;
  /** The running solo game, and when its clock starts (`performance.now()` clock). */
  private soloId: string | null = null;
  private soloStartsAt = 0;
  private soloOver = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(RENDER.COLORS.background);
    this.arrows.clear();
    this.drawGridDots();

    this.lobby = createLobby({
      onCreateRoom: (nickname) => this.net.createRoom(nickname),
      onJoinRoom: (roomId, nickname) => this.net.joinRoom(roomId, nickname),
      // The server answers with `room:left`, which is what actually returns us to the lobby.
      onLeaveRoom: () => this.net.leaveRoom(),
      onRematch: () => this.net.voteRematch(),
      onSolo: () => this.net.startSolo(),
      onSoloExit: () => {
        this.net.leaveSolo();
        this.resetMatch();
        this.lobby.show('idle');
      },
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
        getTiles: () =>
          Array.from(this.arrows.values(), ({ arrow }) => {
            const head = headOf(arrow);
            return { id: arrow.id, ...cellToPosition(head.row, head.col) };
          }),
        getEscapable: () => (this.board ? findEscapableArrows(this.board, new Set(this.arrows.keys())).map((a) => a.id) : []),
        getYou: () => this.you,
        getMatchId: () => this.matchId,
        isMyTurn: () => this.myTurn,
        getHud: () => (this.scene.get('UIScene') as UIScene).debugHud(),
        getRooms: () => this.openRooms,
        createRoom: (name) => this.net.createRoom(name),
        joinRoom: (roomId, name) => this.net.joinRoom(roomId, name),
        leaveRoom: () => this.net.leaveRoom(),
        voteRematch: () => this.net.voteRematch(),
        startSolo: () => this.net.startSolo(),
        getSoloId: () => this.soloId,
      };
    }
  }

  /** A faint dot per cell, and the mask that keeps sliding snakes from painting over the HUD. */
  private drawGridDots(): void {
    const size = getCellSize();
    const dots = this.add.graphics();
    dots.fillStyle(RENDER.COLORS.gridDot, 1);
    for (let row = 0; row < GAMEPLAY.GRID_ROWS; row++) {
      for (let col = 0; col < GAMEPLAY.GRID_COLS; col++) {
        const { x, y } = cellToPosition(row, col);
        dots.fillCircle(x, y, 2);
      }
    }
    const clip = this.make.graphics({}, false);
    clip.fillStyle(0xffffff, 1);
    clip.fillRect(getGridLeft(), RENDER.GRID_TOP, size * GAMEPLAY.GRID_COLS, size * GAMEPLAY.GRID_ROWS);
    this.gridMask = clip.createGeometryMask();
  }

  /**
   * Back to a blank slate for the next match. The scene itself is never restarted — the
   * socket, lobby and UIScene all live across matches.
   */
  private resetMatch(): void {
    // Pending delayed calls (the next-round ready ping, flashes) belong to the old match.
    this.time.removeAllEvents();
    this.clearArrows();
    this.board = null;
    this.matchId = null;
    this.you = null;
    this.roundIndex = 0;
    this.roundWins = { p1: 0, p2: 0 };
    this.myTurn = false;
    this.roundOver = true;
    this.matchOver = false;
    this.soloId = null;
    this.soloOver = false;
    this.lobby.setSoloExitVisible(false);
    this.rounds = [];
    this.phase = 'idle';
    gameEvents.clearReplay();
    gameEvents.typedEmit('match:reset', {});
  }

  private opponentOf(tag: PlayerTag): PlayerTag {
    return tag === 'p1' ? 'p2' : 'p1';
  }

  private outcomeFor(winner: PlayerTag | null): Outcome {
    if (winner === null) return 'draw';
    return winner === (this.you ?? 'p1') ? 'win' : 'lose';
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

    this.net.on('solo:started', ({ gameId, board, startsInMs, timeLimitMs }) => {
      this.resetMatch();
      this.phase = 'solo';
      this.lobby.show('hidden');
      this.lobby.setSoloExitVisible(true);
      this.soloId = gameId;
      this.board = board;
      this.drawBoard(board);
      this.soloStartsAt = performance.now() + startsInMs;
      gameEvents.typedEmit('solo:preview', { total: board.arrows.length, startsAt: this.soloStartsAt, timeLimitMs });
    });

    this.net.on('solo:result', ({ arrowId, correct, remaining, mistakes, timeLeftMs }) => {
      if (correct) this.removeArrow(arrowId, RENDER.COLORS.you);
      else this.flashBlocked(arrowId);
      gameEvents.typedEmit('solo:update', {
        deadline: performance.now() + timeLeftMs,
        mistakes,
        remaining,
        total: this.board?.arrows.length ?? 0,
      });
    });

    this.net.on('solo:finished', (summary: SoloSummary) => {
      this.soloOver = true;
      this.soloId = null;
      this.lobby.setSoloExitVisible(false);
      gameEvents.typedEmit('solo:finished', { outcome: summary.outcome, timeLeftMs: summary.timeLeftMs });
      // Let the last arrow finish sliding out before the result covers the board.
      this.time.delayedCall(summary.outcome === 'cleared' ? 900 : 500, () => this.lobby.showSoloResult(summary));
    });

    this.net.on('round:start', ({ roundIndex, board, first, startsInMs }) => {
      this.roundIndex = roundIndex;
      this.beginRound(board, first, startsInMs);
    });

    this.net.on('turn:start', ({ player, durationMs }) => {
      this.myTurn = player === this.you;
      gameEvents.typedEmit('turn:start', { yours: this.myTurn, startedAt: performance.now(), durationMs });
    });

    this.net.on('attempt:result', ({ player, arrowId, correct, scores, remaining }) => {
      const you = this.you ?? 'p1';
      const mine = player === you;
      if (correct) {
        this.removeArrow(arrowId, mine ? RENDER.COLORS.you : RENDER.COLORS.opponent);
      } else {
        this.flashBlocked(arrowId);
        // The server hands the turn over in the same tick; stop accepting taps until it says so.
        if (mine) this.myTurn = false;
      }
      this.showPointPopup(arrowId, correct, mine);
      gameEvents.typedEmit('score:update', { you: scores[you], opponent: scores[this.opponentOf(you)], remaining });
    });

    this.net.on('round:finished', ({ winner, scores, roundWins }) => {
      this.roundOver = true;
      this.myTurn = false;
      this.roundWins = roundWins;
      const you = this.you ?? 'p1';
      const record: RoundRecord = {
        result: this.outcomeFor(winner),
        yourScore: scores[you],
        opponentScore: scores[this.opponentOf(you)],
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
      this.myTurn = false;
      this.phase = 'result';
      const result = this.outcomeFor(winner);
      gameEvents.typedEmit('match:finished', { result, roundWins });
      this.lobby.showResult({ result, roundWins, rounds: this.rounds });
    });
  }

  private beginRound(board: BoardDTO, first: PlayerTag, startsInMs: number): void {
    this.drawBoard(board);
    this.roundOver = false;
    this.myTurn = false;

    gameEvents.typedEmit('round:preview', {
      total: board.arrows.length,
      roundIndex: this.roundIndex,
      roundWins: this.roundWins,
      youFirst: first === this.you,
    });
    gameEvents.typedEmit('score:update', { you: 0, opponent: 0, remaining: board.arrows.length });
    gameEvents.typedEmit('round:countdown', { startsAt: performance.now() + startsInMs });
  }

  private drawBoard(board: BoardDTO): void {
    this.clearArrows();
    this.board = board;
    board.arrows.forEach((arrow, index) => this.addArrow(arrow, RENDER.ARROW_PALETTE[index % RENDER.ARROW_PALETTE.length]!));
  }

  private addArrow(arrow: ArrowDTO, color: number): void {
    const graphics = this.add.graphics().setMask(this.gridMask);
    drawSnake(graphics, bodyPoints(arrow), color);

    const size = getCellSize();
    const zones = arrow.cells.map((cell) => {
      const { x, y } = cellToPosition(cell.row, cell.col);
      const zone = this.add.zone(x, y, size, size).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => this.handleClick(arrow.id));
      return zone;
    });
    this.arrows.set(arrow.id, { arrow, color, graphics, zones });
  }

  private handleClick(arrowId: string): void {
    if (this.phase === 'solo') {
      // Taps before the clock starts, or after the run ended, are not sent at all.
      if (this.soloId && !this.soloOver && performance.now() >= this.soloStartsAt) this.net.soloClick(this.soloId, arrowId);
      return;
    }
    if (this.roundOver || !this.myTurn || !this.matchId) return;
    this.net.sendAttempt(this.matchId, this.roundIndex, arrowId);
  }

  private clearArrows(): void {
    for (const view of this.arrows.values()) {
      view.graphics.destroy();
      for (const zone of view.zones) zone.destroy();
    }
    this.arrows.clear();
  }

  /** A tapped-and-blocked arrow shakes and flashes red — on both screens, whoever tapped. */
  private flashBlocked(arrowId: string): void {
    const view = this.arrows.get(arrowId);
    if (!view) return;
    const { graphics, arrow, color } = view;
    const points = bodyPoints(arrow);
    let step = 0;
    this.time.addEvent({
      delay: RENDER.FLASH_MS,
      repeat: 5,
      callback: () => {
        step++;
        const red = step % 2 === 1;
        drawSnake(graphics, points, red ? RENDER.COLORS.blockedFlash : color);
        graphics.x = red ? (step % 4 === 1 ? -5 : 5) : 0;
      },
    });
  }

  /** The arrow leaves the shared board by sliding out along its heading, tinted by who took it. */
  private removeArrow(arrowId: string, color: number): void {
    const view = this.arrows.get(arrowId);
    if (!view) return;
    this.arrows.delete(arrowId);
    for (const zone of view.zones) zone.destroy();

    const { points, bodyLength, travel } = slidePath(view.arrow);
    const size = getCellSize();
    const state = { distance: 0 };
    this.tweens.add({
      targets: state,
      distance: travel,
      duration: (travel / (size * RENDER.SLIDE_CELLS_PER_SEC)) * 1000,
      ease: 'Quad.easeIn',
      onUpdate: () => drawSnake(view.graphics, subPath(points, state.distance, state.distance + bodyLength), color),
      onComplete: () => view.graphics.destroy(),
    });
  }

  /** Floating "+1" / "-1" at the arrow's head, in the colour of whoever tapped. */
  private showPointPopup(arrowId: string, correct: boolean, mine: boolean): void {
    const arrow = this.board?.arrows.find((a) => a.id === arrowId);
    if (!arrow) return;
    const head = headOf(arrow);
    const { x, y } = cellToPosition(head.row, head.col);
    const color = correct ? (mine ? RENDER.COLORS.you : RENDER.COLORS.opponent) : RENDER.COLORS.blockedFlash;
    const text = this.add
      .text(x, y, correct ? '+1' : '-1', {
        fontSize: '26px',
        fontStyle: 'bold',
        color: `#${color.toString(16).padStart(6, '0')}`,
        stroke: '#12121c',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.tweens.add({ targets: text, y: y - 46, alpha: 0, duration: 800, onComplete: () => text.destroy() });
  }
}
