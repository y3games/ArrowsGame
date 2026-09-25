import { audio } from '../audio/engine.js';

/** The always-visible sound on/off button (it sits above the lobby overlay too). */
export function bindSoundToggle(): void {
  const button = document.getElementById('sound-toggle');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing #sound-toggle in index.html');

  const render = (): void => {
    const muted = audio.isMuted();
    button.textContent = muted ? '♪ 소리 꺼짐' : '♪ 소리 켜짐';
    button.setAttribute('aria-pressed', String(!muted));
    button.classList.toggle('off', muted);
  };
  button.addEventListener('click', () => audio.setMuted(!audio.isMuted()));
  audio.onMuteChange(render);
  render();
}
