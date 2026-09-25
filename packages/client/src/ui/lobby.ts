import type { RoomErrorCode, RoomSnapshot, RoomSummary } from '@arrows/shared';
import { MAX_NAME_LENGTH, loadPlayer, normalizeName, savePlayer } from '../services/player.js';
import { describeRound, type Outcome, type RoundRecord } from '../game/summary.js';
import type { ConnectionState } from '../net/NetworkClient.js';

/**
 * The lobby / room / result / disconnect overlay. It is plain DOM layered over the canvas, not a
 * Phaser scene, on purpose: a canvas cannot host a text field and Korean input needs a real
 * `<input>` for the IME to compose into. The markup lives in `index.html`; this module only
 * wires it up.
 */

export type LobbyView = 'idle' | 'room' | 'result' | 'disconnected' | 'hidden';

export interface LobbyHandlers {
  /** Called with an already-normalized, already-saved nickname. */
  onCreateRoom(nickname: string): void;
  onJoinRoom(roomId: string, nickname: string): void;
  /** "나가기" — from the waiting room and from the result screen. */
  onLeaveRoom(): void;
  onRematch(): void;
  /** From the disconnected panel: there is no room to leave, just go back to the lobby. */
  onToLobby(): void;
}

export interface MatchSummary {
  result: Outcome;
  roundWins: { p1: number; p2: number };
  rounds: RoundRecord[];
}

export interface Lobby {
  show(view: LobbyView): void;
  setRooms(rooms: RoomSummary[]): void;
  /** Seating changed (or was just entered): refreshes the room panel and the result screen's controls. */
  setRoom(snapshot: RoomSnapshot): void;
  showResult(summary: MatchSummary): void;
  /** The rematch window opened; the server removes anyone who has not voted when it closes. */
  openRematch(timeoutMs: number): void;
  setRematchStatus(status: { youVoted: boolean; opponentVoted: boolean }): void;
  showError(code: RoomErrorCode): void;
  showNotice(text: string): void;
  setConnection(state: ConnectionState): void;
  destroy(): void;
}

/** Render's free tier sleeps when idle; a cold start takes 30s+, so say so instead of looking frozen. */
const SLOW_CONNECT_MS = 3_000;

const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: '이미 가득 찬 방입니다.',
  not_found: '방이 없어졌습니다.',
  already_in_room: '이미 방에 들어가 있습니다.',
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

export function createLobby(handlers: LobbyHandlers): Lobby {
  const root = element('lobby');
  const panels: Record<Exclude<LobbyView, 'hidden'>, HTMLElement> = {
    idle: element('lobby-idle'),
    room: element('lobby-room'),
    result: element('lobby-result'),
    disconnected: element('lobby-disconnected'),
  };
  const form = element<HTMLFormElement>('lobby-form');
  const nameInput = element<HTMLInputElement>('lobby-name');
  const nameError = element('lobby-error');
  const notice = element('lobby-notice');
  const createButton = element<HTMLButtonElement>('lobby-create');
  const status = element('lobby-status');
  const roomList = element<HTMLUListElement>('room-list');
  const roomEmpty = element('room-empty');
  const roomTitle = element('room-title');
  const roomCount = element('room-count');
  const roomHint = element('room-hint');
  const roomLeaveButton = element<HTMLButtonElement>('room-leave');
  const rematchButton = element<HTMLButtonElement>('result-rematch');
  const resultLeaveButton = element<HTMLButtonElement>('result-leave');
  const disconnectedLobbyButton = element<HTMLButtonElement>('disconnected-lobby');
  const resultTitle = element('result-title');
  const resultScore = element('result-score');
  const resultRounds = element('result-rounds');
  const resultNote = element('result-note');
  const resultCountdown = element('result-countdown');

  let connection: ConnectionState = 'connecting';
  let slowTimer: number | null = null;
  let slow = false;

  let rooms: RoomSummary[] = [];
  let seated = 0;
  let capacity = 2;

  let rematchOpen = false;
  let youVoted = false;
  let opponentVoted = false;
  let rematchDeadline = 0;
  let rematchTimer: number | null = null;

  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.value = loadPlayer()?.name ?? '';

  /** Validates and saves the nickname; null (with the error shown) when it is unusable. */
  function readName(): string | null {
    const name = normalizeName(nameInput.value);
    if (name === null) {
      showError('이름을 한 글자 이상 입력해주세요.');
      nameInput.focus();
      return null;
    }
    clearMessages();
    savePlayer(name);
    return name;
  }

  function showError(text: string): void {
    notice.hidden = true;
    nameError.textContent = text;
    nameError.hidden = false;
  }

  function clearMessages(): void {
    nameError.hidden = true;
    notice.hidden = true;
  }

  function renderConnection(): void {
    const connected = connection === 'connected';
    createButton.disabled = !connected;
    renderRooms();
    renderResult();

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

  function renderRooms(): void {
    roomEmpty.hidden = rooms.length > 0;
    roomList.replaceChildren(
      ...rooms.map((room) => {
        const item = document.createElement('li');
        const title = document.createElement('span');
        title.className = 'room-title';
        title.textContent = room.title;
        const count = document.createElement('span');
        count.className = 'room-count';
        count.textContent = `${room.players}/${room.capacity}`;
        const join = document.createElement('button');
        join.type = 'button';
        const closed = room.playing || room.players >= room.capacity;
        join.textContent = room.playing ? '게임 중' : closed ? '가득 참' : '입장';
        join.disabled = closed || connection !== 'connected';
        join.addEventListener('click', () => {
          const name = readName();
          if (name !== null) handlers.onJoinRoom(room.id, name);
        });
        item.append(title, count, join);
        return item;
      }),
    );
  }

  function renderRoomPanel(): void {
    roomCount.textContent = `${seated}/${capacity}`;
    roomHint.textContent = seated >= capacity ? '곧 게임이 시작됩니다…' : '상대를 기다리는 중…';
  }

  function stopRematchTimer(): void {
    if (rematchTimer !== null) window.clearInterval(rematchTimer);
    rematchTimer = null;
  }

  /** Buttons and hints on the result screen, derived from the rematch vote and who is still seated. */
  function renderResult(): void {
    const opponentHere = seated >= capacity;
    rematchButton.hidden = !(rematchOpen && opponentHere);
    rematchButton.disabled = youVoted || connection !== 'connected';
    resultCountdown.hidden = rematchButton.hidden;

    if (!opponentHere) {
      resultNote.hidden = false;
      resultNote.textContent = '상대가 방을 나갔습니다. 새 상대를 기다리는 중…';
    } else {
      resultNote.hidden = true;
    }

    const secondsLeft = Math.max(0, Math.ceil((rematchDeadline - performance.now()) / 1000));
    if (youVoted) {
      resultCountdown.textContent = `상대의 응답을 기다리는 중… (${secondsLeft}초)`;
    } else if (opponentVoted) {
      resultCountdown.textContent = `상대가 다시 하기를 눌렀습니다 · ${secondsLeft}초 후 자동으로 나갑니다`;
    } else {
      resultCountdown.textContent = `${secondsLeft}초 안에 선택하지 않으면 자동으로 나갑니다`;
    }
  }

  function clearSlowTimer(): void {
    if (slowTimer !== null) window.clearTimeout(slowTimer);
    slowTimer = null;
  }

  function show(view: LobbyView): void {
    root.hidden = view === 'hidden';
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== view;
    if (view !== 'result') {
      rematchOpen = false;
      stopRematchTimer();
    }
    if (view === 'idle') {
      nameInput.focus();
      nameInput.select();
    }
  }

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const name = readName();
    if (name !== null) handlers.onCreateRoom(name);
  };

  const onLeaveRoom = (): void => handlers.onLeaveRoom();
  const onRematch = (): void => handlers.onRematch();
  const onToLobby = (): void => handlers.onToLobby();

  form.addEventListener('submit', onSubmit);
  roomLeaveButton.addEventListener('click', onLeaveRoom);
  resultLeaveButton.addEventListener('click', onLeaveRoom);
  rematchButton.addEventListener('click', onRematch);
  disconnectedLobbyButton.addEventListener('click', onToLobby);

  renderConnection();
  show('idle');

  return {
    show,

    setRooms(next) {
      rooms = next;
      renderRooms();
    },

    setRoom(snapshot) {
      seated = snapshot.room.players;
      capacity = snapshot.room.capacity;
      roomTitle.textContent = snapshot.room.title;
      renderRoomPanel();
      renderResult();
    },

    showResult(summary) {
      rematchOpen = false;
      youVoted = false;
      opponentVoted = false;
      stopRematchTimer();
      resultTitle.textContent = { win: '최종 승리!', lose: '최종 패배…', draw: '무승부' }[summary.result];
      resultScore.textContent = `${summary.roundWins.p1} : ${summary.roundWins.p2}`;
      resultRounds.replaceChildren(
        ...summary.rounds.map((record, index) => {
          const item = document.createElement('li');
          item.textContent = describeRound(record, index);
          item.className = { win: 'won', lose: 'lost', draw: 'draw' }[record.result];
          return item;
        }),
      );
      renderResult();
      show('result');
    },

    openRematch(timeoutMs) {
      rematchOpen = true;
      youVoted = false;
      opponentVoted = false;
      // Display only — the server's own timer decides who actually gets removed.
      rematchDeadline = performance.now() + timeoutMs;
      stopRematchTimer();
      rematchTimer = window.setInterval(renderResult, 250);
      renderResult();
    },

    setRematchStatus(next) {
      youVoted = next.youVoted;
      opponentVoted = next.opponentVoted;
      renderResult();
    },

    showError(code) {
      showError(ERROR_TEXT[code]);
    },

    showNotice(text) {
      nameError.hidden = true;
      notice.textContent = text;
      notice.hidden = false;
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
      stopRematchTimer();
      form.removeEventListener('submit', onSubmit);
      roomLeaveButton.removeEventListener('click', onLeaveRoom);
      resultLeaveButton.removeEventListener('click', onLeaveRoom);
      rematchButton.removeEventListener('click', onRematch);
      disconnectedLobbyButton.removeEventListener('click', onToLobby);
    },
  };
}
