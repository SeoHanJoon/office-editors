# 0022. 성능 측정: pnpm bench와 스크롤 fps 세 가지 방법

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 5

## 배경
README의 성능 목표(10만 행 스크롤 60fps, 1만 개 연결 다시 계산 0.05초, 큰 `SUM` 시트 수정 0.016초)를 잴 방법이 필요하다.
또 측정 결과를 테스트에서 실패 조건으로 쓸지도 정해야 한다. 시간은 컴퓨터마다 달라서 테스트가 가끔 깨질 수 있다.

## 선택지
- 스크롤 fps 측정
  - ① 프레임 간격: 페이지에서 프레임마다 스크롤을 옮기며 requestAnimationFrame 간격을 잰다 / 단순함, 그리기 시간은 따로 안 보임
  - ② Chrome 성능 기록(trace): 화면에 나간 프레임과 버린 프레임, 콜백 시간을 센다 / 가장 정확함, Chrome 기록 형식에 기댐
  - ③ 그리기 시간만: 브라우저 없이 가짜 Canvas로 `drawGrid`의 JS 시간을 잰다 / 빠르고 안정적, 실제 픽셀 그리기는 빠짐
- 목표 강제: bench는 측정만 하고 테스트에는 넉넉한 기준만 / 목표값 그대로 테스트에서 강제 / 강제 안 함

## 결정
- fps는 세 방법을 **모두** 만들어 계속 둔다. 서로 보는 것이 달라서 함께 봐야 원인을 좁힐 수 있다. (① 사용자가 느끼는 끊김, ② 브라우저가 실제로 버린 프레임, ③ 우리 코드의 JS 몫)
- `pnpm bench` = `turbo run bench --concurrency=1` (측정끼리 CPU를 나눠 쓰지 않게 하나씩, 캐시 없이)
  - `packages/excel`: `vitest bench` — `formula-engine.bench.ts`(다시 계산, 처음 열기), `render.bench.ts`(③)
  - `apps/web`: `playwright.perf.config.ts`로 `perf/scroll.perf.ts` 실행 — 페이지 열기, ①, ② (개발 서버, 1280×720)
  - 측정용 시트는 `perf-sheets.ts` 한 곳에서 만든다.
- 목표는 bench에서 측정만 한다. `pnpm test`에는 결과가 맞는지와, 목표의 약 10배를 넘지 않는지만 확인하는 대용량 테스트를 둔다.

## 결과
- Step 5 측정값(Apple M1 Mac 기준): 스크롤 세 가지 모두 60fps·밀린 프레임 0, 그리기 콜백 최대 3.5ms, `drawGrid` JS 0.29ms, 1만 개 연결 7.2ms, 큰 `SUM` 수정 4.5ms.
- Vitest 5의 bench는 파일 사이 import를 부를 때마다 개수를 세는 장치가 붙어서, 반복문이 많은 코드는 실제보다 느리게 나온다. 반복문을 고치기 전, 같은 수정이 일반 테스트에서 7.0ms, bench에서 12.6ms였다. (큰 반복문 안에서 다른 파일의 이름을 덜 부르도록 고친 뒤 4.5ms) 경고("module export getters")가 뜨지만 결과가 보수적인 쪽이라 목표 판정에는 그대로 쓴다. Node가 파일을 직접 불러오는 옵션(`experimental.viteModuleRunner: false`)은 import에 `.ts` 확장자가 없어서 쓸 수 없다.
- 브라우저 측정은 `next dev`에서 한다. 배포 빌드에서는 `window.__excel`이 없어서 페이지 준비를 알기 어렵기 때문이다.
- `pnpm bench`는 1분 30초 정도 걸린다.
