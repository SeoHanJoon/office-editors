# 0002. 내부 패키지는 빌드 없이 TS 소스로 가져다 쓴다

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 0

## 배경
`apps/web`이 `packages/*`의 코드를 가져다 쓰는 방법을 정해야 한다.
패키지 이름 규칙과 Step 0에서 어떤 패키지를 만들지도 함께 정한다.

## 선택지
- A안 TS 소스 직접 사용: 각 패키지의 `exports`가 `src/index.ts`를 가리키고 Next.js가 컴파일 / 빌드 단계 없음, 수정 즉시 반영 / 외부 배포하려면 나중에 빌드 추가 필요
- B안 패키지별 빌드(tsc → dist): 배포 가능한 형태, 경계가 엄격 / dev 중 watch 빌드 필요, 설정·속도 부담

## 결정
A안. 이 저장소의 패키지는 외부에 배포하지 않고 `apps/web`에서만 쓰므로 빌드 단계는 비용만 든다.
- 패키지 이름은 `@office/<폴더 이름>` (예: `@office/excel`). 앱은 `@office/web`, 루트는 `office-editors`.
- Step 0에서 5개 패키지(`command-core`, `ui`, `excel`, `docs`, `ppt`)를 모두 빈 뼈대로 만들어 연결을 확인한다.

## 결과
- `apps/web/next.config.ts`의 `transpilePackages`에 내부 패키지를 모두 적어야 한다. 새 패키지를 만들면 여기에 추가한다.
- 패키지에는 `build` 스크립트가 없다. typecheck는 각 패키지가 `tsc --noEmit`으로 따로 한다.
