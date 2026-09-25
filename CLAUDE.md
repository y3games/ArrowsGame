# ArrowsGame

## What this is

A real-time 1v1 multiplayer arrow-escape puzzle, played as a best-of-3 match decided purely by
time (no lives/hearts). Design and rules: `docs/01-planning/overview.md`.

npm-workspaces monorepo:
- `packages/shared` — pure game logic (board generation, escape rules, attempt/round/match state)
  and the Socket.IO protocol types. No Phaser import. Both client and server import it directly.
- `packages/client` — Phaser 3 + Vite + TypeScript.
- `packages/server` — Node.js + Socket.IO + TypeScript (matchmaking, per-match authoritative state).

## Commands

- `npm run dev:client` — Vite dev server on :5173
- `npm run dev:server` — Socket.IO server on :4000 (via `tsx watch`)
- `npm run test` — vitest for `packages/shared`
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

- **The server is the only clock that matters.** Every `attempt:click` is timestamped on arrival
  and judged by the same `applyAttempt()` from `@arrows/shared` that the client also runs locally
  for instant feedback. The client never mutates game state on its own — every tile
  removal/lock/round-result the player sees comes from a server event. This is what makes a wrong
  click or timeout always cost exactly a real 10 seconds, which in turn is what makes "finished
  first" and "lowest cumulative time" the same criterion (see the timing-rule rationale in
  `docs/01-planning/overview.md`).
- **Board generation is reverse-construction, not trial-and-error.** `packages/shared/src/game/board.ts`
  builds the board by placing arrows in the reverse of their eventual escape order, which
  guarantees solvability by construction rather than by generate-and-check.
- **`packages/client/src/net/events.ts`'s event bus replays the last payload on subscribe.**
  `BootScene` calls `scene.start('GameScene')` then `scene.launch('UIScene')`, and Phaser does not
  guarantee `GameScene.create()` runs after `UIScene.create()` — without replay, UIScene can miss
  the very first `round:preview`/`round:start` and show stale labels. Don't remove this thinking
  it's dead code.
- **The lobby/result/disconnect screens are HTML in `packages/client/index.html`** (wired by
  `src/ui/lobby.ts`), not Phaser objects — a canvas can't host a text field and Korean IME needs a
  real `<input>`. `GameScene` owns the flow (`startSearch` / `resetMatch`); the scene is never
  restarted between matches. "다시 하기" re-enters the queue (new random opponent), not a rematch
  with the same one.
- **`src/services/player.ts` is a deliberate copy of RoadDash's.** The `player` cookie (`{id,name}`)
  is shared by every Y3GAMES game so a player keeps one identity; keep the format identical.
- **`Match` calls `onFinished` when a match ends** and `socketHandlers.ts` releases both sockets
  from `activeMatches`. Without that, a later disconnect would replay the finished result and the
  same sockets couldn't join a new match.
- **`window.__arrowsDebug`** (in `GameScene`, gated by `import.meta.env.DEV`) exposes tile
  positions, the escapable-arrow set and `joinQueue(name)` (bypasses the lobby form) so end-to-end tests can drive a real match without
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
