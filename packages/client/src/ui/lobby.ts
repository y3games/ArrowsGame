import { MAX_NAME_LENGTH, loadPlayer, normalizeName, savePlayer } from '../services/player.js';
import { describeRound, type RoundRecord } from '../game/summary.js';
import type { ConnectionState } from '../net/NetworkClient.js';

/**
 * The lobby / result / disconnect overlay. It is plain DOM layered over the canvas, not a
 * Phaser scene, on purpose: a canvas cannot host a text field, and Korean input needs a real
 * `<input>` for the IME to compose into. The markup lives in `index.html`; this module only
 * wires it up.
 */

export type LobbyView = 'idle' | 'searching' | 'result' | 'disconnected' | 'hidden';

export interface LobbyHandlers {
  /** Called with an already-normalized, already-saved nickname. */
  onStart(nickname: string): void;
  onCancel(): void;
  onRematch(): void;
  onToLobby(): void;
}

export interface MatchSummary {
  youWon: boolean;
  roundWins: { p1: number; p2: number };
  rounds: RoundRecord[];
  opponentLeft: boolean;
}

export interface Lobby {
  show(view: LobbyView): void;
  showResult(summary: MatchSummary): void;
  setConnection(state: ConnectionState): void;
  destroy(): void;
}

/** Render's free tier sleeps when idle; a cold start takes 30s+, so say so instead of looking frozen. */
const SLOW_CONNECT_MS = 3_000;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

export function createLobby(handlers: LobbyHandlers): Lobby {
  const root = element('lobby');
  const panels: Record<Exclude<LobbyView, 'hidden'>, HTMLElement> = {
    idle: element('lobby-idle'),
    searching: element('lobby-searching'),
    result: element('lobby-result'),
    disconnected: element('lobby-disconnected'),
  };
  const form = element<HTMLFormElement>('lobby-form');
  const nameInput = element<HTMLInputElement>('lobby-name');
  const nameError = element('lobby-error');
  const startButton = element<HTMLButtonElement>('lobby-start');
  const status = element('lobby-status');
  const cancelButton = element<HTMLButtonElement>('lobby-cancel');
  const rematchButton = element<HTMLButtonElement>('result-rematch');
  const resultLobbyButton = element<HTMLButtonElement>('result-lobby');
  const disconnectedLobbyButton = element<HTMLButtonElement>('disconnected-lobby');
  const resultTitle = element('result-title');
  const resultScore = element('result-score');
  const resultRounds = element('result-rounds');
  const resultNote = element('result-note');

  let connection: ConnectionState = 'connecting';
  let slowTimer: number | null = null;
  let slow = false;

  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.value = loadPlayer()?.name ?? '';

  function renderConnection(): void {
    const connected = connection === 'connected';
    startButton.disabled = !connected;
    rematchButton.disabled = !connected;

    if (connected) {
      status.hidden = true;
      return;
    }
    status.hidden = false;
    if (connection === 'disconnected') {
      status.textContent = '서버 연결이 끊어졌습니다. 다시 연결하는 중…';
    } else {
      status.textContent = slow ? '서버를 깨우는 중… (최대 1분)' : '서버에 연결하는 중…';
    }
  }

  function clearSlowTimer(): void {
    if (slowTimer !== null) window.clearTimeout(slowTimer);
    slowTimer = null;
  }

  function show(view: LobbyView): void {
    root.hidden = view === 'hidden';
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== view;
    if (view === 'idle') {
      nameInput.focus();
      nameInput.select();
    }
  }

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const name = normalizeName(nameInput.value);
    if (name === null) {
      nameError.textContent = '이름을 한 글자 이상 입력해주세요.';
      nameError.hidden = false;
      nameInput.focus();
      return;
    }
    nameError.hidden = true;
    savePlayer(name);
    handlers.onStart(name);
  };

  const onCancel = (): void => handlers.onCancel();
  const onRematch = (): void => handlers.onRematch();
  const onToLobby = (): void => handlers.onToLobby();

  form.addEventListener('submit', onSubmit);
  cancelButton.addEventListener('click', onCancel);
  rematchButton.addEventListener('click', onRematch);
  resultLobbyButton.addEventListener('click', onToLobby);
  disconnectedLobbyButton.addEventListener('click', onToLobby);

  renderConnection();
  show('idle');

  return {
    show,

    showResult(summary) {
      resultTitle.textContent = summary.youWon ? '최종 승리!' : '최종 패배…';
      resultScore.textContent = `${summary.roundWins.p1} : ${summary.roundWins.p2}`;
      resultRounds.replaceChildren(
        ...summary.rounds.map((record, index) => {
          const item = document.createElement('li');
          item.textContent = describeRound(record, index);
          item.className = record.youWon ? 'won' : 'lost';
          return item;
        }),
      );
      resultNote.hidden = !summary.opponentLeft;
      resultNote.textContent = '상대방이 접속을 종료했습니다.';
      show('result');
    },

    setConnection(state) {
      connection = state;
      clearSlowTimer();
      slow = false;
      if (state === 'connecting') {
        slowTimer = window.setTimeout(() => {
          slow = true;
          renderConnection();
        }, SLOW_CONNECT_MS);
      }
      renderConnection();
    },

    destroy() {
      clearSlowTimer();
      form.removeEventListener('submit', onSubmit);
      cancelButton.removeEventListener('click', onCancel);
      rematchButton.removeEventListener('click', onRematch);
      resultLobbyButton.removeEventListener('click', onToLobby);
      disconnectedLobbyButton.removeEventListener('click', onToLobby);
    },
  };
}
