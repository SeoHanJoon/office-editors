# 0001. 모노레포 도구: pnpm + Turborepo

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 0

## 배경
Excel · Docs · PPT 에디터와 공통 패키지(`command-core`, `ui`)를 한 저장소에서 관리해야 한다.
패키지마다 typecheck·test를 돌리면서도 바뀐 것만 다시 검사하고 싶다.

## 선택지
- A안 pnpm workspaces + Turborepo: 설치 빠르고 디스크 절약, Turbo 캐시로 바뀐 패키지만 다시 실행 / 도구가 두 개
- B안 pnpm workspaces만 (`pnpm -r run`): 도구 하나로 단순 / 캐시가 없어 매번 전체 실행
- C안 Nx: 기능이 많음 / 설정과 학습 부담이 큼

## 결정
A안. README 기술 스택에서 이미 정한 조합이고, 패키지가 늘어날수록 캐시 이점이 커진다.
Node 24.21(`.nvmrc`), pnpm 10, TypeScript 7, Next.js 16, React 19를 쓴다.

## 결과
- `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm dev`는 모두 `turbo run <작업>`이다.
- 패키지는 빌드 결과물이 없어서 Turbo가 패키지 간 의존을 모른다. 그래서 `transit`이라는 빈 작업으로 의존 관계를 이어 준다.
  이게 없으면 `excel`을 고쳐도 `apps/web`의 typecheck가 옛 캐시(성공)를 재사용한다. (Step 0에서 실제로 재현함)
- 공통 TS 설정은 루트 `tsconfig.base.json` 하나를 각 패키지가 `extends`한다.
- `turbo`는 AI 에이전트를 감지하면 루트 `AGENTS.md`에 안내 블록을 자동으로 쓴다.
