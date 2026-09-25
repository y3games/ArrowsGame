import Phaser from 'phaser';
import { RENDER } from '../game/config.js';
import { gameEvents, type GameEventMap } from '../net/events.js';
import { outcomeLabel } from '../game/summary.js';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export class UIScene extends Phaser.Scene {
  private roundIndicatorText!: Phaser.GameObjects.Text;
  private youScoreText!: Phaser.GameObjects.Text;
  private opponentScoreText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private remainingText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private countdownRing!: Phaser.GameObjects.Graphics;

  /** `performance.now()` at which the pre-round countdown ends; null outside it. */
  private countdownTarget: number | null = null;
  private youFirst = false;
  private turn: { yours: boolean; startedAt: number; durationMs: number } | null = null;

  constructor() {
    super('UIScene');
  }

  create(): void {
    const centerX = RENDER.CANVAS_WIDTH / 2;
    this.add.text(centerX, 40, '화살표 탈출 미로', { fontSize: '28px', color: '#e8eaf6' }).setOrigin(0.5);

    this.roundIndicatorText = this.add.text(centerX, 150, '', { fontSize: '18px', color: '#a5adce' }).setOrigin(0.5);

    this.youScoreText = this.add
      .text(centerX - 120, 812, '', { fontSize: '30px', fontStyle: 'bold', color: css(RENDER.COLORS.you) })
      .setOrigin(0.5);
    this.add.text(centerX, 812, ':', { fontSize: '30px', color: '#a5adce' }).setOrigin(0.5);
    this.opponentScoreText = this.add
      .text(centerX + 120, 812, '', { fontSize: '30px', fontStyle: 'bold', color: css(RENDER.COLORS.opponent) })
      .setOrigin(0.5);

    this.turnText = this.add.text(centerX, 858, '', { fontSize: '24px', color: '#a5adce' }).setOrigin(0.5);
    this.remainingText = this.add.text(centerX, 898, '', { fontSize: '20px', color: '#a5adce' }).setOrigin(0.5);

    this.countdownRing = this.add.graphics();

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

    gameEvents.typedOn('net:match-found', this.onMatchFound, this);
    gameEvents.typedOn('match:reset', this.onMatchReset, this);
    gameEvents.typedOn('round:preview', this.onRoundPreview, this);
    gameEvents.typedOn('round:countdown', this.onRoundCountdown, this);
    gameEvents.typedOn('turn:start', this.onTurnStart, this);
    gameEvents.typedOn('score:update', this.onScoreUpdate, this);
    gameEvents.typedOn('round:finished', this.onRoundFinished, this);
    gameEvents.typedOn('match:finished', this.onMatchFinished, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('net:match-found', this.onMatchFound, this);
      gameEvents.off('match:reset', this.onMatchReset, this);
      gameEvents.off('round:preview', this.onRoundPreview, this);
      gameEvents.off('round:countdown', this.onRoundCountdown, this);
      gameEvents.off('turn:start', this.onTurnStart, this);
      gameEvents.off('score:update', this.onScoreUpdate, this);
      gameEvents.off('round:finished', this.onRoundFinished, this);
      gameEvents.off('match:finished', this.onMatchFinished, this);
    });
  }

  private showOverlay(text: string): void {
    this.overlayText.setText(text).setVisible(true);
  }

  private onMatchReset = (): void => {
    this.countdownTarget = null;
    this.turn = null;
    this.roundIndicatorText.setText('');
    this.youScoreText.setText('');
    this.opponentScoreText.setText('');
    this.turnText.setText('');
    this.remainingText.setText('');
    this.countdownRing.clear();
    this.overlayText.setVisible(false);
  };

  private onMatchFound = (payload: GameEventMap['net:match-found']): void => {
    this.showOverlay(`상대를 찾았습니다!\n${payload.opponentNickname}`);
  };

  private onRoundPreview = (payload: GameEventMap['round:preview']): void => {
    this.turn = null;
    this.youFirst = payload.youFirst;
    this.roundIndicatorText.setText(`라운드 ${payload.roundIndex + 1} · 승 ${payload.roundWins.p1} : ${payload.roundWins.p2}`);
    this.turnText.setText('');
  };

  private onRoundCountdown = (payload: GameEventMap['round:countdown']): void => {
    this.countdownTarget = payload.startsAt;
  };

  private onTurnStart = (payload: GameEventMap['turn:start']): void => {
    this.countdownTarget = null;
    this.overlayText.setVisible(false);
    this.turn = payload;
    this.turnText
      .setText(payload.yours ? '내 차례 — 화살표를 눌러 제거하세요' : '상대 차례')
      .setColor(payload.yours ? css(RENDER.COLORS.you) : css(RENDER.COLORS.opponent));
  };

  private onScoreUpdate = (payload: GameEventMap['score:update']): void => {
    this.youScoreText.setText(`나 ${payload.you}`);
    this.opponentScoreText.setText(`상대 ${payload.opponent}`);
    this.remainingText.setText(`남은 화살표: ${payload.remaining}`);
  };

  private onRoundFinished = (payload: GameEventMap['round:finished']): void => {
    this.turn = null;
    this.countdownTarget = null;
    this.turnText.setText('');
    const headline =
      payload.result === 'win' ? '이 라운드 승리!' : payload.result === 'lose' ? '이 라운드 패배…' : '이 라운드 무승부';
    this.showOverlay(
      `${headline}\n나 ${payload.yourScore} : ${payload.opponentScore} 상대\n(라운드 승 ${payload.roundWins.p1} : ${payload.roundWins.p2})\n다음 라운드 준비 중...`,
    );
  };

  /** The final result (with per-round summary and buttons) is the lobby's HTML panel, not this overlay. */
  private onMatchFinished = (payload: GameEventMap['match:finished']): void => {
    this.turn = null;
    this.countdownTarget = null;
    this.turnText.setText(outcomeLabel(payload.result));
    this.overlayText.setVisible(false);
  };

  update(): void {
    if (this.countdownTarget !== null) {
      const remainingMs = this.countdownTarget - performance.now();
      if (remainingMs <= 0) {
        this.countdownTarget = null;
      } else {
        this.showOverlay(`${Math.ceil(remainingMs / 1000)}\n${this.youFirst ? '내가 먼저 시작합니다' : '상대가 먼저 시작합니다'}`);
      }
    }

    if (!this.turn) {
      this.countdownRing.clear();
      return;
    }
    this.drawTurnRing(this.turn);
  }

  /** The time left in the current turn: blue while it is yours, orange while it is the opponent's. */
  private drawTurnRing(turn: { yours: boolean; startedAt: number; durationMs: number }): void {
    const remainingMs = turn.startedAt + turn.durationMs - performance.now();
    const fraction = Phaser.Math.Clamp(remainingMs / turn.durationMs, 0, 1);

    const x = RENDER.CANVAS_WIDTH / 2;
    const y = RENDER.COUNTDOWN_Y;
    const radius = RENDER.COUNTDOWN_RADIUS;

    this.countdownRing.clear();
    this.countdownRing.lineStyle(8, RENDER.COLORS.countdownTrack, 1);
    this.countdownRing.strokeCircle(x, y, radius);

    const base = turn.yours ? RENDER.COLORS.you : RENDER.COLORS.opponent;
    const color = turn.yours && fraction < 0.3 ? RENDER.COLORS.countdownWarn : base;
    this.countdownRing.lineStyle(8, color, 1);
    this.countdownRing.beginPath();
    const start = -Math.PI / 2;
    this.countdownRing.arc(x, y, radius, start, start + Math.PI * 2 * fraction, false);
    this.countdownRing.strokePath();
  }
}
