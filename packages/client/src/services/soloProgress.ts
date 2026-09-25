import { clampSoloLevel } from '@arrows/shared';

/**
 * The solo level to play next, remembered in this browser only. It is a per-player convenience,
 * not a record the server keeps — storage can be empty or blocked, so every access is guarded
 * and the game simply starts from level 1 when nothing can be read.
 */
const KEY = 'arrows.soloLevel';

export function loadSoloLevel(): number {
  try {
    return clampSoloLevel(Number(window.localStorage.getItem(KEY)) || 1);
  } catch {
    return 1;
  }
}

export function saveSoloLevel(level: number): void {
  try {
    window.localStorage.setItem(KEY, String(clampSoloLevel(level)));
  } catch {
    // Storage unavailable: progress just won't survive a reload.
  }
}
