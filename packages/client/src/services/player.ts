/**
 * Anonymous player identity — a name and a uuid, with no account behind it.
 *
 * First visit asks for a name; every later visit is recognised by the cookie.
 * The cookie is scoped to the whole origin (`path=/`), and every game deploys
 * under one GitHub Pages origin, so the identity is deliberately *shared* by
 * all of them — the opposite of the per-game score key. Play MergeDrop, open
 * another game, and you are still the same player.
 *
 * What this is not: authentication. The id is client-generated and editable in
 * devtools, so a server must never grant anything on the strength of it alone.
 *
 * NOTE: this file is a deliberate copy of RoadDash's `src/services/player.ts` (the portal keeps
 * one too). The cookie name and `{ id, name }` shape must stay identical across every Y3GAMES
 * game so a player is the same person everywhere — change them in all places or in none.
 */

const COOKIE_NAME = 'player';

/** Chrome caps cookie lifetime at 400 days; asking for more just gets clamped. */
const COOKIE_MAX_AGE_DAYS = 400;

/**
 * localStorage mirror of the cookie.
 *
 * Safari caps script-written cookies at 7 days, which would silently turn a
 * returning player into a first-time visitor. localStorage is not immune to
 * eviction either, but the two rarely disappear at the same moment, so either
 * one can restore the other.
 */
const MIRROR_KEY = 'player';

export const MAX_NAME_LENGTH = 12;

export interface Player {
  /** Stable across visits. Generated locally; never a secret. */
  readonly id: string;
  readonly name: string;
}

/**
 * Clean up a name typed by a player.
 *
 * Returns null for anything unusable, so callers ask again rather than storing
 * an empty or control-character name. Pure — the DOM is not involved.
 */
export function normalizeName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex -- control chars break the cookie.
  const trimmed = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_NAME_LENGTH ? trimmed.slice(0, MAX_NAME_LENGTH) : trimmed;
}

/** Parse a stored identity. Returns null for anything that is not one. */
export function decodePlayer(raw: string | null): Player | null {
  if (raw === null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { id, name } = parsed as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') return null;
    if (typeof name !== 'string') return null;

    const cleaned = normalizeName(name);
    return cleaned === null ? null : { id, name: cleaned };
  } catch {
    return null;
  }
}

/** Cookie-safe encoding: names are Korean more often than not. */
export function encodePlayer(player: Player): string {
  return encodeURIComponent(JSON.stringify(player));
}

function readCookie(name: string): string | null {
  try {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const entry = part.trim();
      if (entry.startsWith(prefix)) return entry.slice(prefix.length);
    }
    return null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string): void {
  try {
    const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    // `Secure` is omitted on http so local dev over plain localhost still works.
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // Cookies disabled — the mirror below is the only copy this session.
  }
}

function readMirror(): string | null {
  try {
    return localStorage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
}

function writeMirror(value: string): void {
  try {
    localStorage.setItem(MIRROR_KEY, value);
  } catch {
    // Storage unavailable; the cookie still carries the identity.
  }
}

/**
 * The player this browser already knows, or null on a first visit.
 *
 * Reading from the mirror rewrites the cookie, which is what makes a Safari
 * cookie expiry recoverable instead of terminal.
 */
export function loadPlayer(): Player | null {
  const fromCookie = decodePlayer(readCookie(COOKIE_NAME));
  if (fromCookie !== null) return fromCookie;

  const fromMirror = decodePlayer(readMirror());
  if (fromMirror !== null) {
    writeCookie(COOKIE_NAME, encodePlayer(fromMirror));
    return fromMirror;
  }
  return null;
}

/**
 * Store `name` for this browser, keeping the existing id when there is one so a
 * rename stays the same player.
 *
 * Throws on an unusable name: callers validate with `normalizeName()` first and
 * ask the player again, rather than saving something the HUD cannot show.
 */
export function savePlayer(name: string): Player {
  const cleaned = normalizeName(name);
  if (cleaned === null) throw new Error('Player name is empty after normalisation.');

  const player: Player = { id: loadPlayer()?.id ?? crypto.randomUUID(), name: cleaned };
  const encoded = encodePlayer(player);
  writeCookie(COOKIE_NAME, encoded);
  writeMirror(encoded);
  return player;
}
