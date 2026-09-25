import Phaser from 'phaser';
import { RENDER, getBoardSize, getCellSize, getGridLeft, getGridTop } from '../game/config.js';
import { gameEvents, type GameEventMap } from '../net/events.js';
import { formatClock, outcomeLabel } from '../game/summary.js';
import { audio } from '../audio/engine.js';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** With this much time left in a solo run the music turns tense. */
const TENSE_MUSIC_MS = 10_000;

/** Score, whose turn it is, the turn clock and the pre-round countdown. */
export class UIScene extends Phaser.Scene {
  private roundIndicatorText!: Phaser.GameObjects.Text;
  private youScoreText!: Phaser.GameObjects.Text;
  private opponentScoreText!: Phaser.GameObjects.Text;
  private scoreSeparator!: Phaser.GameObjects.Text;
  private turnBanner!: Phaser.GameObjects.Text;
  private turnFlash!: Phaser.GameObjects.Text;
  private remainingText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private countNumber!: Phaser.GameObjects.Text;
  private countLabel!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private countdownRing!: Phaser.GameObjects.Graphics;
  private gridFrame!: Phaser.GameObjects.Graphics;

  /** `performance.now()` at which the pre-round countdown ends; null outside it. */
  private countdownTarget: number | null = null;
  /** The countdown number last beeped for, so each second beeps once. */
  private lastCountNumber = 0;
  /** A round-result jingle waiting to see whether the whole match ends right after it. */
  private roundResultSfx: Phaser.Time.TimerEvent | null = null;
  private youFirst = false;
  private turn: { yours: boolean; startedAt: number; durationMs: number } | null = null;
  /** Non-null while a solo run is on screen. `deadline` is on the `performance.now()` clock. */
  private solo: { timeLimitMs: number; deadline: number; mistakes: number; over: boolean; frozenMs: number } | null = null;
  private countdownText = { text: '', color: RENDER.COLORS.you as number };

  constructor() {
    super('UIScene');
  }

  create(): void {
    const centerX = RENDER.CANVAS_WIDTH / 2;
    this.add.text(centerX, 40, '화살표 탈출 미로', { fontSize: '28px', color: '#e8eaf6' }).setOrigin(0.5);

    this.gridFrame = this.add.graphics();
    this.countdownRing = this.add.graphics();
    this.clockText = this.add
      .text(centerX, RENDER.COUNTDOWN_Y, '', { fontSize: '26px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);

    this.roundIndicatorText = this.add.text(centerX, 148, '', { fontSize: '18px', color: '#a5adce' }).setOrigin(0.5);

    this.youScoreText = this.add
      .text(centerX - 120, 826, '', { fontSize: '30px', fontStyle: 'bold', color: css(RENDER.COLORS.you) })
      .setOrigin(0.5);
    this.scoreSeparator = this.add.text(centerX, 826, ':', { fontSize: '30px', color: '#a5adce' }).setOrigin(0.5);
    this.opponentScoreText = this.add
      .text(centerX + 120, 826, '', { fontSize: '30px', fontStyle: 'bold', color: css(RENDER.COLORS.opponent) })
      .setOrigin(0.5);

    // Whose turn it is must be unmistakable, so it gets its own filled banner in the player's colour.
    this.turnBanner = this.add
      .text(centerX, 874, '', { fontSize: '28px', fontStyle: 'bold', color: '#ffffff', padding: { x: 22, y: 8 } })
      .setOrigin(0.5);
    this.remainingText = this.add.text(centerX, 922, '', { fontSize: '20px', color: '#a5adce' }).setOrigin(0.5);

    this.turnFlash = this.add
      .text(centerX, RENDER.CANVAS_HEIGHT / 2, '', {
        fontSize: '72px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#12121c',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(9)
      .setAlpha(0);

    this.overlayText = this.add
      .text(centerX, RENDER.CANVAS_HEIGHT / 2, '', {
        fontSize: '30px',
        color: '#e8eaf6',
        align: 'center',
        backgroundColor: '#12121cd0',
        padding: { x: 24, y: 16 },
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.countNumber = this.add
      .text(centerX, RENDER.CANVAS_HEIGHT / 2 - 50, '', {
        fontSize: '110px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#12121c',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);
    this.countLabel = this.add
      .text(centerX, RENDER.CANVAS_HEIGHT / 2 + 40, '', {
        fontSize: '38px',
        fontStyle: 'bold',
        color: '#ffffff',
        padding: { x: 26, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.drawGridFrame(null);

    gameEvents.typedOn('net:match-found', this.onMatchFound, this);
    gameEvents.typedOn('match:reset', this.onMatchReset, this);
    gameEvents.typedOn('round:preview', this.onRoundPreview, this);
    gameEvents.typedOn('round:countdown', this.onRoundCountdown, this);
    gameEvents.typedOn('turn:start', this.onTurnStart, this);
    gameEvents.typedOn('score:update', this.onScoreUpdate, this);
    gameEvents.typedOn('round:finished', this.onRoundFinished, this);
    gameEvents.typedOn('match:finished', this.onMatchFinished, this);
    gameEvents.typedOn('solo:preview', this.onSoloPreview, this);
    gameEvents.typedOn('solo:update', this.onSoloUpdate, this);
    gameEvents.typedOn('solo:finished', this.onSoloFinished, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('net:match-found', this.onMatchFound, this);
      gameEvents.off('match:reset', this.onMatchReset, this);
      gameEvents.off('round:preview', this.onRoundPreview, this);
      gameEvents.off('round:countdown', this.onRoundCountdown, this);
      gameEvents.off('turn:start', this.onTurnStart, this);
      gameEvents.off('score:update', this.onScoreUpdate, this);
      gameEvents.off('round:finished', this.onRoundFinished, this);
      gameEvents.off('match:finished', this.onMatchFinished, this);
      gameEvents.off('solo:preview', this.onSoloPreview, this);
      gameEvents.off('solo:update', this.onSoloUpdate, this);
      gameEvents.off('solo:finished', this.onSoloFinished, this);
    });
  }

  /** Dev/test only: what the player is being told right now. */
  debugHud(): { banner: string; countdown: string; clock: string } {
    return {
      banner: this.turnBanner.text,
      countdown: this.countLabel.visible ? this.countLabel.text : '',
      clock: this.clockText.text,
    };
  }

  private showOverlay(text: string): void {
    this.overlayText.setText(text).setVisible(true);
  }

  private hideCountdown(): void {
    this.countdownTarget = null;
    this.lastCountNumber = 0;
    this.countNumber.setVisible(false);
    this.countLabel.setVisible(false);
  }

  /** A frame around the board in the colour of whoever's turn it is — readable at a glance. */
  private drawGridFrame(turn: { yours: boolean } | null): void {
    const size = getCellSize();
    const { rows, cols } = getBoardSize();
    const pad = 4;
    const color = turn === null ? RENDER.COLORS.gridFrameIdle : turn.yours ? RENDER.COLORS.you : RENDER.COLORS.opponent;
    this.gridFrame.clear();
    this.gridFrame.lineStyle(4, color, 1);
    this.gridFrame.strokeRoundedRect(
      getGridLeft() - pad,
      getGridTop() - pad,
      size * cols + pad * 2,
      size * rows + pad * 2,
      8,
    );
  }

  private setBanner(turn: { yours: boolean } | null): void {
    if (turn === null) {
      this.turnBanner.setText('').setBackgroundColor('');
      return;
    }
    this.turnBanner
      .setText(turn.yours ? '내 차례' : '상대 차례')
      .setBackgroundColor(css(turn.yours ? RENDER.COLORS.you : RENDER.COLORS.opponentBanner));
  }

  private onMatchReset = (): void => {
    this.hideCountdown();
    this.roundResultSfx?.remove();
    this.roundResultSfx = null;
    this.turn = null;
    this.solo = null;
    audio.setMood('cheerful');
    audio.setLevel(1);
    this.roundIndicatorText.setText('');
    this.youScoreText.setText('');
    this.opponentScoreText.setText('');
    this.setBanner(null);
    this.drawGridFrame(null);
    this.remainingText.setText('');
    this.clockText.setText('');
    this.countdownRing.clear();
    this.overlayText.setVisible(false);
    this.turnFlash.setAlpha(0);
    this.youScoreText.setColor(css(RENDER.COLORS.you)).setX(RENDER.CANVAS_WIDTH / 2 - 120);
    this.scoreSeparator.setVisible(true);
  };

  private onMatchFound = (payload: GameEventMap['net:match-found']): void => {
    this.showOverlay(`상대를 찾았습니다!\n${payload.opponentNickname}`);
  };

  private onRoundPreview = (payload: GameEventMap['round:preview']): void => {
    this.turn = null;
    this.youFirst = payload.youFirst;
    this.solo = null;
    this.roundIndicatorText.setText(`라운드 ${payload.roundIndex + 1} · 승 ${payload.roundWins.p1} : ${payload.roundWins.p2}`);
    this.setBanner(null);
    this.drawGridFrame(null);
  };

  private onRoundCountdown = (payload: GameEventMap['round:countdown']): void => {
    this.overlayText.setVisible(false);
    this.countdownTarget = payload.startsAt;
    this.countdownText = this.youFirst
      ? { text: '내가 먼저 시작합니다', color: RENDER.COLORS.you }
      : { text: '상대가 먼저 시작합니다', color: RENDER.COLORS.opponentBanner };
  };

  private onSoloPreview = (payload: GameEventMap['solo:preview']): void => {
    this.turn = null;
    this.overlayText.setVisible(false);
    this.solo = { timeLimitMs: payload.timeLimitMs, deadline: payload.startsAt + payload.timeLimitMs, mistakes: 0, over: false, frozenMs: 0 };
    audio.setLevel(payload.level);
    this.roundIndicatorText.setText(`레벨 ${payload.level} · 3분 안에 모두 제거하세요 (실수 시 -10초)`);
    this.youScoreText.setText('실수 0회').setColor(css(RENDER.COLORS.countdownWarn)).setX(RENDER.CANVAS_WIDTH / 2);
    this.scoreSeparator.setVisible(false);
    this.opponentScoreText.setText('');
    this.remainingText.setText(`남은 화살표: ${payload.total}`);
    this.turnBanner.setText(`레벨 ${payload.level}`).setBackgroundColor(css(RENDER.COLORS.you));
    this.drawGridFrame({ yours: true });
    this.countdownTarget = payload.startsAt;
    this.countdownText = { text: `레벨 ${payload.level} · ${payload.total}개`, color: RENDER.COLORS.you };
  };

  private onSoloUpdate = (payload: GameEventMap['solo:update']): void => {
    const solo = this.solo;
    if (!solo) return;
    if (payload.mistakes > solo.mistakes) this.popText('-10초', RENDER.COLORS.countdownWarn);
    solo.deadline = payload.deadline;
    solo.mistakes = payload.mistakes;
    this.youScoreText.setText(`실수 ${payload.mistakes}회`);
    this.remainingText.setText(`남은 화살표: ${payload.remaining} / ${payload.total}`);
  };

  private onSoloFinished = (payload: GameEventMap['solo:finished']): void => {
    if (this.solo) {
      this.solo.over = true;
      this.solo.frozenMs = payload.timeLeftMs;
    }
    audio.setMood('cheerful');
    audio.playSfx(payload.outcome === 'cleared' ? 'win' : 'lose');
    this.hideCountdown();
    this.turnBanner.setText(payload.outcome === 'cleared' ? '레벨 클리어!' : '시간 초과');
  };

  /** A short pop in the middle of the board. */
  private popText(text: string, color: number, from = 1.15, to = 1): void {
    this.tweens.killTweensOf(this.turnFlash);
    this.turnFlash.setText(text).setColor(css(color)).setAlpha(1).setScale(from);
    this.tweens.add({ targets: this.turnFlash, alpha: 0, scale: to, delay: 350, duration: 650 });
  }

  private onTurnStart = (payload: GameEventMap['turn:start']): void => {
    this.hideCountdown();
    this.overlayText.setVisible(false);
    this.turn = payload;
    this.setBanner(payload);
    this.drawGridFrame(payload);
    // A little after any effect for the tap that ended the previous turn, so the two don't blur together.
    audio.playSfx(payload.yours ? 'turn-mine' : 'turn-opp', true, 0.18);

    // A brief pop in the middle of the board, so a turn change can't go unnoticed.
    if (payload.yours) this.popText('내 차례!', RENDER.COLORS.you, 1.15, 1);
    else this.popText('상대 차례', RENDER.COLORS.opponent, 0.8, 0.7);
  };

  private onScoreUpdate = (payload: GameEventMap['score:update']): void => {
    this.youScoreText.setText(`나 ${payload.you}`);
    this.opponentScoreText.setText(`상대 ${payload.opponent}`);
    this.remainingText.setText(`남은 화살표: ${payload.remaining}`);
  };

  private onRoundFinished = (payload: GameEventMap['round:finished']): void => {
    this.turn = null;
    this.hideCountdown();
    this.setBanner(null);
    this.drawGridFrame(null);
    this.turnFlash.setAlpha(0);
    // If the match is over too, its own fanfare replaces this jingle (see onMatchFinished).
    this.roundResultSfx?.remove();
    this.roundResultSfx = this.time.delayedCall(200, () => {
      audio.playSfx(payload.result === 'win' ? 'round-win' : payload.result === 'lose' ? 'round-lose' : 'round-draw');
    });
    const headline =
      payload.result === 'win' ? '이 라운드 승리!' : payload.result === 'lose' ? '이 라운드 패배…' : '이 라운드 무승부';
    this.showOverlay(
      `${headline}\n나 ${payload.yourScore} : ${payload.opponentScore} 상대\n(라운드 승 ${payload.roundWins.p1} : ${payload.roundWins.p2})\n다음 라운드 준비 중...`,
    );
  };

  /** The final result (with per-round summary and buttons) is the lobby's HTML panel, not this overlay. */
  private onMatchFinished = (payload: GameEventMap['match:finished']): void => {
    this.turn = null;
    this.hideCountdown();
    this.drawGridFrame(null);
    this.setBanner(null);
    this.roundResultSfx?.remove();
    this.roundResultSfx = null;
    audio.playSfx(payload.result);
    this.turnBanner.setText(outcomeLabel(payload.result));
    this.overlayText.setVisible(false);
  };

  update(): void {
    if (this.countdownTarget !== null) {
      const remainingMs = this.countdownTarget - performance.now();
      if (remainingMs <= 0) {
        // A solo run starts the instant the countdown ends; a match starts with the server's first turn:start.
        if (this.solo) audio.playSfx('go');
        this.hideCountdown();
      } else {
        const number = Math.ceil(remainingMs / 1000);
        if (number !== this.lastCountNumber) {
          this.lastCountNumber = number;
          audio.playSfx('countdown');
        }
        this.countNumber.setText(`${Math.ceil(remainingMs / 1000)}`).setVisible(true);
        this.countLabel
          .setText(this.countdownText.text)
          .setBackgroundColor(css(this.countdownText.color))
          .setVisible(true);
      }
    }

    if (this.solo) {
      this.drawSoloClock(this.solo);
      return;
    }
    if (!this.turn) {
      this.countdownRing.clear();
      this.clockText.setText('');
      return;
    }
    this.drawTurnClock(this.turn);
  }

  /** The solo clock: a ring that empties over the whole time limit, with m:ss inside. */
  private drawSoloClock(solo: { timeLimitMs: number; deadline: number; over: boolean; frozenMs: number }): void {
    const remainingMs = solo.over ? solo.frozenMs : Math.max(0, solo.deadline - performance.now());
    // The last ten seconds of a run switch the music to the tense tune (and back once it is over).
    audio.setMood(!solo.over && remainingMs > 0 && remainingMs <= TENSE_MUSIC_MS ? 'tense' : 'cheerful');
    const fraction = Phaser.Math.Clamp(remainingMs / solo.timeLimitMs, 0, 1);
    const urgent = remainingMs <= 30_000;
    const color = urgent ? RENDER.COLORS.countdownWarn : RENDER.COLORS.you;

    const x = RENDER.CANVAS_WIDTH / 2;
    const y = RENDER.COUNTDOWN_Y;
    const radius = RENDER.COUNTDOWN_RADIUS;
    this.countdownRing.clear();
    this.countdownRing.lineStyle(8, RENDER.COLORS.countdownTrack, 1);
    this.countdownRing.strokeCircle(x, y, radius);
    this.countdownRing.lineStyle(8, color, 1);
    this.countdownRing.beginPath();
    const start = -Math.PI / 2;
    this.countdownRing.arc(x, y, radius, start, start + Math.PI * 2 * fraction, false);
    this.countdownRing.strokePath();

    this.clockText
      .setFontSize(20)
      .setText(formatClock(remainingMs))
      .setColor(urgent ? css(RENDER.COLORS.countdownWarn) : '#ffffff');
  }

  /** The time left in the current turn, as a ring with the seconds inside: blue for you, orange for the opponent. */
  private drawTurnClock(turn: { yours: boolean; startedAt: number; durationMs: number }): void {
    const remainingMs = Math.max(0, turn.startedAt + turn.durationMs - performance.now());
    const fraction = Phaser.Math.Clamp(remainingMs / turn.durationMs, 0, 1);

    const x = RENDER.CANVAS_WIDTH / 2;
    const y = RENDER.COUNTDOWN_Y;
    const radius = RENDER.COUNTDOWN_RADIUS;

    this.countdownRing.clear();
    this.countdownRing.lineStyle(8, RENDER.COLORS.countdownTrack, 1);
    this.countdownRing.strokeCircle(x, y, radius);

    const base = turn.yours ? RENDER.COLORS.you : RENDER.COLORS.opponent;
    const urgent = turn.yours && remainingMs <= 3000;
    const color = urgent ? RENDER.COLORS.countdownWarn : base;
    this.countdownRing.lineStyle(8, color, 1);
    this.countdownRing.beginPath();
    const start = -Math.PI / 2;
    this.countdownRing.arc(x, y, radius, start, start + Math.PI * 2 * fraction, false);
    this.countdownRing.strokePath();

    this.clockText.setFontSize(26).setText(`${Math.ceil(remainingMs / 1000)}`).setColor(urgent ? css(RENDER.COLORS.countdownWarn) : '#ffffff');
  }
}
