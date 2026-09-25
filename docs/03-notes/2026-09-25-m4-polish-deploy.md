# 로비·재대결·결과 화면·배포 설정 (2026-09-25)

> 이후 무작위 대기열 매칭은 방 기능으로 대체되었다. 아래 "다시 하기"/`queue:join` 설명은 당시 기준이며
> 현재 방식은 [방 만들기·입장·다시 하기 투표](2026-09-25-rooms.md)를 참고한다.

## 무엇을 했는가

- **버그·견고성**
  - 10초 시간 초과 뒤 카운트다운 링이 0에서 멈추던 문제: `@arrows/shared`에 순수 함수
    `currentWindowStart(windowStart, now, timeoutMs)`를 추가하고 서버의 `applyAttempt()`와
    `UIScene` 링이 같은 함수를 쓰도록 했다(루프 → `Math.floor`).
  - 매치가 끝난 뒤 상대가 나가면 결과가 다시 뜨던 문제: `Match`가 종료 시 `onFinished`를 호출하고
    `socketHandlers.ts`가 두 소켓을 `activeMatches`/room에서 제거한다. `handleDisconnect()`는 이미 끝난
    매치면 아무것도 보내지 않는다. 중복 `queue:join`(이미 매치 중이거나 대기 중)은 무시한다.
  - 서버 연결 끊김: `NetworkClient.onConnectionChange()` 추가. 대기/매치 중 끊기면 "서버 연결이
    끊어졌습니다" 화면 + "로비로". 첫 연결이 3초 넘게 걸리면 "서버를 깨우는 중… (최대 1분)".
- **로비·재대결**: 캔버스 밖 HTML 오버레이(`index.html`, `src/ui/lobby.ts`). 닉네임 입력, 대기 취소,
  결과 화면의 "다시 하기"(새 상대를 무작위 매칭)와 "로비로". 닉네임은 Y3GAMES 공용 `player` 쿠키
  형식으로 읽고 저장한다(`src/services/player.ts`, RoadDash 파일의 의도적 복사).
- **결과 화면**: `round:finished`에 `remaining`(양쪽 남은 화살표 수) 추가. 라운드 종료 오버레이에
  내 기록/남은 화살표 수를, 매치 종료 화면에 라운드별 한 줄 요약을 보여 준다.
- **배포 설정**: `vite.config.ts`의 `base`를 `GITHUB_REPOSITORY`에서 파생, `.github/workflows`의
  `deploy.yml`(Pages)·`ci.yml`(PR), 서버 `GET /healthz`와 쉼표 구분 `CORS_ORIGIN`, `render.yaml`,
  루트 `engines.node >= 22`.

## 왜 필요했는가

새로고침 없이 여러 판을 이어서 할 수 있고, 실제 인터넷에 배포할 수 있는 상태가 되어야 했다.
"다시 하기"를 같은 상대와의 재대결이 아닌 대기열 재진입으로 한 것은 양쪽 동의 프로토콜이 필요해
범위를 벗어나기 때문이다. Render는 카드 등록이 필요 없고 로컬에 Docker가 없어서 Fly.io 대신 골랐다.

## 사용자가 직접 할 배포 단계

외부 계정에 영향을 주는 작업이라 자동으로 하지 않았다. 순서대로 진행한다.

1. 커밋 후 GitHub 저장소 생성·푸시: `gh repo create y3games/ArrowsGame --public --source . --push`
2. Pages 활성화(워크플로 방식): 저장소 Settings → Pages → Source를 "GitHub Actions"로 설정
   (CLI: `gh api -X POST repos/y3games/ArrowsGame/pages -f build_type=workflow`).
3. Render 대시보드에서 New → Blueprint로 저장소를 연결하면 `render.yaml`이 읽힌다.
4. 배포된 서버 URL(예: `https://arrows-game-server.onrender.com`)을 저장소 변수로 등록:
   `gh variable set VITE_SERVER_URL --body "<서버 URL>" -R y3games/ArrowsGame`
5. Actions에서 "Deploy to GitHub Pages" 워크플로를 다시 실행(`workflow_dispatch`).
   → `https://y3games.github.io/ArrowsGame/`에서 접속.

## 배포 결과

- 클라이언트: https://y3games.github.io/ArrowsGame/ (저장소 `y3games/ArrowsGame`, PUBLIC)
- 서버: https://arrows-game-server.onrender.com — `VITE_SERVER_URL` 저장소 변수로 등록하고 배포 워크플로를
  다시 실행해 번들에 반영했다. 위 단계 1~5를 모두 완료했다.

## 참고사항 / 남은 이슈

- `packages/client/.env.example`(`VITE_SERVER_URL=http://localhost:4000`)은 만들어 두었다. 다만 작업
  세션의 권한 규칙이 `.env*` 읽기를 막아 내용을 다시 열어 확인하지는 못했다.
- Render 무료 플랜은 유휴 시 잠들어 첫 접속이 30초 이상 걸린다. 콜드 스타트에서 안내 문구가 어떻게
  보이는지는 확인하지 못했다(확인 시점에 서버가 이미 깨어 있었다).
- 배포 환경에서는 상대의 접속 종료를 서버가 감지하기까지 약 10초 걸린다(로컬은 즉시).
- 해결됨: 게임 중 화면 아래쪽 HUD 텍스트("상대 남은 화살표" 등)가 8×8 보드의 마지막 줄 타일(하단 y≈754)과
  겹치던 문제. `UIScene`의 HUD 텍스트 y 좌표를 795/830/870으로 내려 보드 아래에 배치했다.
- 접속이 끊긴 매치는 복구하지 않는다(재접속은 범위 밖). 서버가 이미 상대 승리로 처리한다.
