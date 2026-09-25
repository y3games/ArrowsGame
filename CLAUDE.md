# ArrowsGame

## What this is

A real-time 1v1 multiplayer arrow-escape puzzle: long snake-shaped arrows on a board shared by both
players, who take turns sliding them out (+1 point each; tapping a blocked arrow is -1 and ends the
turn). Best-of-3 rounds, higher score wins a round. Design and rules: `docs/01-planning/overview.md`.

npm-workspaces monorepo:
- `packages/shared` — pure game logic (board generation, escape rules, turn/round/match/room state)
  and the Socket.IO protocol types. No Phaser import. Both client and server import it directly.
- `packages/client` — Phaser 3 + Vite + TypeScript.
- `packages/server` — Node.js + Socket.IO + TypeScript (matchmaking, per-match authoritative state).

## Commands

- `npm run dev:client` — Vite dev server on :5173
- `npm run dev:server` — Socket.IO server on :4000 (via `tsx watch`)
- `npm run test` — vitest for `packages/shared` and `packages/client` (the client tests cover the music score data)
- `npm run typecheck` / `npm run lint` — across all packages
- `npm run check` — typecheck + lint + test
- `npm run build` — client (`vite build`) + server (`esbuild` bundle to `dist/index.js`)

Run the client and server dev servers in separate terminals; the client expects the server at
`http://localhost:4000` (override with `VITE_SERVER_URL`).

## Deployment

Two separate hosts (details and the one-time setup steps: `docs/03-notes/2026-09-25-m4-polish-deploy.md`):

- **Client → GitHub Pages** (`y3games/ArrowsGame`, `.github/workflows/deploy.yml`, runs on push to
  `main`). `vite.config.ts` derives `base` from `GITHUB_REPOSITORY`, so never hardcode it. The
  server URL is baked in at build time from the repository variable `VITE_SERVER_URL`
  (`packages/client/.env.example` shows the local default, `http://localhost:4000`).
- **Server → Render** (`render.yaml` Blueprint, free plan). `CORS_ORIGIN` is a comma-separated
  origin list; `GET /healthz` is the health check. The build uses `npm ci --include=dev` because
  Render sets `NODE_ENV=production`, which would otherwise skip esbuild. Free instances sleep, so a
  cold start takes 30s+ — the lobby shows "서버를 깨우는 중…" after 3s of connecting.

## Architecture

- **The server is the only clock and referee.** The board is shared, so the server owns the turn:
  every `attempt:click` is timestamped on arrival and judged by `applyMove()` from
  `@arrows/shared` (right player? turn still running? blocked?), and the turn timer
  (`FIRST_TURN_MS` 5 s for a round's opener, then `TURN_MS` 10 s, no refill on removal, no penalty
  on timeout) lives in `packages/server/src/Match.ts`. The result goes to **both** players as
  `attempt:result` and the client only ever changes the board from that event — never on its own
  tap. Remaining turn time is sent as a duration (`turn:start.durationMs`), not a server
  timestamp, so client clocks never matter.
- **Board generation is reverse-construction, not trial-and-error.** `packages/shared/src/game/board.ts`
  places snake arrows in the reverse of their eventual escape order and only accepts one whose
  straight path from the head to the edge is clear of everything placed so far (its own body
  included), which guarantees solvability by construction rather than by generate-and-check. An
  arrow is `{ id, cells (tail → head), dir }`; `dir` is the direction of the last segment.
- **`packages/client/src/net/events.ts`'s event bus replays the last payload on subscribe.**
  `BootScene` calls `scene.start('GameScene')` then `scene.launch('UIScene')`, and Phaser does not
  guarantee `GameScene.create()` runs after `UIScene.create()` — without replay, UIScene can miss
  the very first `round:preview`/`round:start` and show stale labels. Don't remove this thinking
  it's dead code.
- **The lobby/result/disconnect screens are HTML in `packages/client/index.html`** (wired by
  `src/ui/lobby.ts`), not Phaser objects — a canvas can't host a text field and Korean IME needs a
  real `<input>`. `GameScene` owns the flow (`resetMatch` and the room/match phases); the scene is
  never restarted between matches.
- **Solo mode is a `SoloGame` on the server** (`packages/server/src/SoloGame.ts`, pure rules in
  `packages/shared/src/game/solo.ts`): clear the board within `SOLO.TIME_LIMIT_MS` (3 min), each
  blocked tap costs `SOLO.PENALTY_MS` (10 s) off the time left, the server timer ends the run. A
  socket is in a room *or* in solo play, never both (`socketHandlers.ts` guards both directions);
  while soloing it leaves the `lobby` Socket.IO room and re-enters via `RoomManager.onConnect()`.
  Solo is level-based: `solo:start {level}` → `soloLevelConfig(level)` (map 24×24 growing to the full
  30×30 at level 4, then ever more/longer/more tangled arrows until about level 20). The next level
  to play lives only in the browser (`src/services/soloProgress.ts`, localStorage); the server just
  coerces whatever level it is asked for. The board size therefore varies per game — the client lays
  it out from `setBoardSize()`/`getCellSize()` in `game/config.ts`, never from a fixed grid constant.
- **All audio is synthesized in the browser, no files** (`packages/client/src/audio/`): `score.ts` is
  the music as MIDI-style note data (pure, tested), `synth.ts` the instruments and the effects (they
  take a `BaseAudioContext`, so the same code renders offline for checks), `engine.ts` the sequencer.
  Browsers block sound until the first click/key, so `AudioEngine.attach()` waits for a gesture and
  `setMood()` before that only remembers the choice. Two tunes: `cheerful` loops forever, `tense`
  replaces it while a solo run has ≤ 10 s left (`UIScene` drives it every frame; multiplayer never
  goes tense). The ♪ button (top right, above the lobby overlay) mutes and is remembered. Effects
  beyond remove/blocked (turn change, countdown beeps, round/match results) are triggered from
  `UIScene`, which already reacts to those events; the round-result jingle waits 200 ms so a match
  ending right after it can replace it with its own fanfare. Phaser's own audio is switched off
  (`audio: { noAudio: true }` in `main.ts`) so there is exactly one AudioContext.
- **Every arrow has at least 2 cells** (`MIN_ARROW_LENGTH`). `generateBoard` has a `centerPull` option
  because reverse construction otherwise leaves the middle of big maps empty.
- **Players meet in rooms, not a random queue.** The lobby lists open rooms (`rooms:list`, `n/2`);
  a room seats 2, and the match starts automatically when the second player joins. Seating/vote rules are the
  pure functions in `packages/shared/src/game/room.ts`; `packages/server/src/rooms.ts`
  (`RoomManager`) adds sockets, the rematch timer and the running `Match`. After a match both
  players get `rematch:open` and 10 s (`ROOM.REMATCH_WINDOW_MS`) to vote "다시 하기"; both voting
  starts a new `Match` in the same room, and whoever has not voted is removed (`room:left`,
  reason `timeout`). Whoever remains keeps the room at 1/2 and waits for a new opponent.
- **`src/services/player.ts` is a deliberate copy of RoadDash's.** The `player` cookie (`{id,name}`)
  is shared by every Y3GAMES game so a player keeps one identity; keep the format identical.
- **`Match` calls `onFinished` when a match ends** and `RoomManager` turns that into the result
  phase + rematch window. `RoomManager.leave()` detaches `entry.match` *before* calling
  `Match.handleDisconnect()` so a walkover is not mistaken for a normal finish (no rematch window,
  the winner just stays in the room at 1/2). Without `onFinished`, a later disconnect would replay
  the finished result.
- **`window.__arrowsDebug`** (in `GameScene`, gated by `import.meta.env.DEV`) exposes tile
  positions, the escapable-arrow set, the room list and `createRoom` / `joinRoom` / `leaveRoom` /
  `voteRematch` (they bypass the lobby form) so end-to-end tests can drive a real match without
  guessing canvas coordinates. Dead-code-eliminated from production builds.

## Gotchas

- `packages/shared`'s imports use explicit `.js` extensions on `.ts` files (e.g. `from
  './game/types.js'`) — this is the standard TS-ESM pattern, required for both `tsc` and `tsx` to
  resolve correctly. Don't "fix" these to `.ts`.
- The server's production build (`npm run build -w @arrows/server`) bundles `@arrows/shared`'s
  TypeScript source directly via esbuild rather than compiling it separately — `@arrows/shared`
  has no `dist/`, so a plain `tsc` build of the server alone would fail to resolve it at runtime.
- Socket.IO requires a persistent process, so `packages/server` cannot deploy to GitHub
  Pages/static hosting the way the client can — it needs an actual Node host.
