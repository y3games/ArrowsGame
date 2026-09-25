import Phaser from 'phaser';
import { currentWindowStart } from '@arrows/shared';
import { RENDER } from '../game/config.js';
import { gameEvents, type GameEventMap } from '../net/events.js';
import { formatSeconds } from '../game/summary.js';

export class UIScene extends Phaser.Scene {
  private roundIndicatorText!: Phaser.GameObjects.Text;
  private remainingText!: Phaser.GameObjects.Text;
  private opponentText!: Phaser.GameObjects.Text;
  private stopwatchText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private countdownRing!: Phaser.GameObjects.Graphics;

  private startedAt = 0;
  private total = 0;
  private remaining = 0;
  private windowStart = 0;
  private timeoutMs = 10_000;
  private lockedUntil: number | null = null;
  private roundActive = false;
  private countdownTarget: number | null = null;

  constructor() {
    super('UIScene');
  }

  create(): void {
    this.add
      .text(RENDER.CANVAS_WIDTH / 2, 40, '화살표 탈출 미로', { fontSize: '28px', color: '#e8eaf6' })
      .setOrigin(0.5);

    this.roundIndicatorText = this.add
      .text(RENDER.CANVAS_WIDTH / 2, 150, '', { fontSize: '18px', color: '#a5adce' })
      .setOrigin(0.5);

    this.opponentText = this.add
      .text(RENDER.CANVAS_WIDTH / 2, 795, '', { fontSize: '18px', color: '#a5adce' })
      .setOrigin(0.5);

    this.remainingText = this.add
      .text(RENDER.CANVAS_WIDTH / 2, 830, '', { fontSize: '22px', color: '#e8eaf6' })
      .setOrigin(0.5);

    this.stopwatchText = this.add
      .text(RENDER.CANVAS_WIDTH / 2, 870, '', { fontSize: '20px', color: '#a5adce' })
      .setOrigin(0.5);

    this.countdownRing = this.add.graphics();

    this.overlayText = this.add
      .text(RENDER.CANVAS_WIDTH / 2, RENDER.CANVAS_HEIGHT / 2, '', {
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
    gameEvents.typedOn('net:round-countdown', this.onRoundCountdown, this);
    gameEvents.typedOn('match:reset', this.onMatchReset, this);
    gameEvents.typedOn('round:preview', this.onRoundPreview, this);
    gameEvents.typedOn('round:start', this.onRoundStart, this);
    gameEvents.typedOn('window:start', this.onWindowStart, this);
    gameEvents.typedOn('attempt:correct', this.onAttemptCorrect, this);
    gameEvents.typedOn('attempt:wrong', this.onAttemptWrong, this);
    gameEvents.typedOn('opponent:progress', this.onOpponentProgress, this);
    gameEvents.typedOn('round:finished', this.onRoundFinished, this);
    gameEvents.typedOn('match:finished', this.onMatchFinished, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('net:match-found', this.onMatchFound, this);
      gameEvents.off('net:round-countdown', this.onRoundCountdown, this);
      gameEvents.off('match:reset', this.onMatchReset, this);
      gameEvents.off('round:preview', this.onRoundPreview, this);
      gameEvents.off('round:start', this.onRoundStart, this);
      gameEvents.off('window:start', this.onWindowStart, this);
      gameEvents.off('attempt:correct', this.onAttemptCorrect, this);
      gameEvents.off('attempt:wrong', this.onAttemptWrong, this);
      gameEvents.off('opponent:progress', this.onOpponentProgress, this);
      gameEvents.off('round:finished', this.onRoundFinished, this);
      gameEvents.off('match:finished', this.onMatchFinished, this);
    });
  }

  private showOverlay(text: string): void {
    this.overlayText.setText(text).setVisible(true);
  }

  private onMatchReset = (): void => {
    this.roundActive = false;
    this.countdownTarget = null;
    this.lockedUntil = null;
    this.total = 0;
    this.remaining = 0;
    this.roundIndicatorText.setText('');
    this.opponentText.setText('');
    this.remainingText.setText('');
    this.stopwatchText.setText('');
    this.countdownRing.clear();
    this.overlayText.setVisible(false);
  };

  private onMatchFound = (payload: GameEventMap['net:match-found']): void => {
    this.showOverlay(`상대를 찾았습니다!\n${payload.opponentNickname}`);
  };

  private onRoundCountdown = (payload: GameEventMap['net:round-countdown']): void => {
    this.roundActive = false;
    this.countdownTarget = payload.serverStartAt;
  };

  private onRoundPreview = (payload: GameEventMap['round:preview']): void => {
    this.total = payload.total;
    this.remaining = payload.total;
    this.roundIndicatorText.setText(`라운드 ${payload.roundIndex + 1} · ${payload.roundWins.p1} : ${payload.roundWins.p2}`);
    this.opponentText.setText(`상대 남은 화살표: ${payload.total} / ${payload.total}`);
    this.updateRemainingText();
  };

  private onRoundStart = (payload: GameEventMap['round:start']): void => {
    this.countdownTarget = null;
    this.startedAt = payload.startedAt;
    this.roundActive = true;
    this.lockedUntil = null;
    this.overlayText.setVisible(false);
  };

  private onWindowStart = (payload: GameEventMap['window:start']): void => {
    this.windowStart = payload.windowStart;
    this.timeoutMs = payload.timeoutMs;
    this.lockedUntil = null;
  };

  private onAttemptCorrect = (payload: GameEventMap['attempt:correct']): void => {
    this.remaining = payload.remaining;
    this.updateRemainingText();
  };

  private onAttemptWrong = (payload: GameEventMap['attempt:wrong']): void => {
    this.lockedUntil = payload.lockedUntil;
  };

  private onOpponentProgress = (payload: GameEventMap['opponent:progress']): void => {
    this.opponentText.setText(`상대 남은 화살표: ${payload.remaining} / ${payload.total}`);
  };

  private onRoundFinished = (payload: GameEventMap['round:finished']): void => {
    this.roundActive = false;
    const headline = payload.youWon
      ? `이 라운드 승리!${payload.yourTimeMs !== null ? ` · ${formatSeconds(payload.yourTimeMs)}` : ''}`
      : '이 라운드 패배… · 상대가 먼저 클리어';
    const detail = payload.youWon
      ? `상대 남은 화살표 ${payload.opponentRemaining}개`
      : `내 남은 화살표 ${payload.yourRemaining}개`;
    this.showOverlay(
      `${headline}\n${detail}\n(${payload.roundWins.p1} : ${payload.roundWins.p2})\n다음 라운드 준비 중...`,
    );
  };

  /** The final result (with per-round summary and buttons) is the lobby's HTML panel, not this overlay. */
  private onMatchFinished = (): void => {
    this.roundActive = false;
    this.overlayText.setVisible(false);
  };

  private updateRemainingText(): void {
    this.remainingText.setText(`남은 화살표: ${this.remaining} / ${this.total}`);
  }

  update(): void {
    if (this.countdownTarget !== null) {
      const remainingMs = this.countdownTarget - Date.now();
      if (remainingMs <= 0) {
        this.countdownTarget = null;
      } else {
        this.showOverlay(`${Math.ceil(remainingMs / 1000)}`);
      }
    }

    if (!this.roundActive) {
      this.countdownRing.clear();
      return;
    }

    this.drawCountdownRing();
    const elapsedSec = (performance.now() - this.startedAt) / 1000;
    this.stopwatchText.setText(`경과 시간: ${formatSeconds(elapsedSec * 1000)}`);
  }

  private drawCountdownRing(): void {
    const now = performance.now();
    const locked = this.lockedUntil !== null;
    // After a pure timeout the server rolls straight into a fresh window; mirror that here so
    // the ring refills instead of sticking at empty.
    const windowStart = currentWindowStart(this.windowStart, now, this.timeoutMs);
    const remainingMs = locked ? this.lockedUntil! - now : windowStart + this.timeoutMs - now;
    const fraction = Phaser.Math.Clamp(remainingMs / this.timeoutMs, 0, 1);

    const x = RENDER.CANVAS_WIDTH / 2;
    const y = RENDER.COUNTDOWN_Y;
    const radius = RENDER.COUNTDOWN_RADIUS;

    this.countdownRing.clear();
    this.countdownRing.lineStyle(8, RENDER.COLORS.countdownTrack, 1);
    this.countdownRing.strokeCircle(x, y, radius);

    const color = locked || fraction < 0.3 ? RENDER.COLORS.countdownWarn : RENDER.COLORS.countdownFill;
    this.countdownRing.lineStyle(8, color, 1);
    this.countdownRing.beginPath();
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * fraction;
    this.countdownRing.arc(x, y, radius, start, end, false);
    this.countdownRing.strokePath();
  }
}
