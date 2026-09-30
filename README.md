# Office Editors

웹에서 동작하는 **Excel · Docs · PPT** 에디터를 하나의 저장소(모노레포)에서 만드는 프로젝트입니다.

- **Excel은 깊게** — 수식 계산, 대용량 표 그리기 같은 핵심을 라이브러리 없이 직접 구현합니다.
- **Docs · PPT는 가볍게** — 검증된 라이브러리를 사용하고, 기본 편집 기능만 만듭니다.

---

## 1. 무엇을 만드나

| 에디터 | 깊이 | 직접 구현하는 것 | 가져다 쓰는 것 |
|---|---|---|---|
| **Excel** | 깊게 | 셀 데이터 구조, 수식 계산기, 표 그리기(Canvas), 복사/붙여넣기 | 거의 없음 |
| **Docs** | 가볍게 | 저장/불러오기, 공통 기능 연결 | Tiptap (문서 에디터 라이브러리) |
| **PPT** | 가볍게 | 슬라이드 목록, 도형/텍스트 배치 | 일반 HTML(DOM) |

세 에디터가 **공통으로 쓰는 부분**(실행 취소/다시 실행 등)은 한 번만 만들어서 함께 사용합니다.

---

## 2. 진행 방식

작업은 **Step 단위**로 진행합니다. 각 Step은 이렇게 끝납니다.

1. 기능을 구현한다.
2. 테스트가 통과한다.
3. 그 Step에서 내린 중요한 결정을 **ADR**로 남긴다.
4. 아래 진행 표에 체크한다.

### ADR이란?

ADR(Architecture Decision Record)은 **"왜 이렇게 만들었는지"를 적어두는 짧은 문서**입니다.
나중에 "이거 왜 이렇게 했지?"라는 질문에 답하기 위한 기록입니다.

- 위치: [`adr/`](adr/) 폴더
- 파일 이름: `번호-제목.md` (예: `0001-monorepo-tooling.md`)
- 한 Step에서 결정이 여러 개면 ADR도 여러 개 만들어도 됩니다.

ADR은 아래 형식으로 짧게 씁니다.

```markdown
# 0001. 제목

- 상태: 제안 / 채택 / 폐기
- 날짜: YYYY-MM-DD
- 관련 Step: Step 0

## 배경
어떤 문제가 있었나?

## 선택지
- A안: 장점 / 단점
- B안: 장점 / 단점

## 결정
무엇을 골랐고, 왜 골랐나?

## 결과
이 결정으로 좋아지는 점과 감수해야 하는 점
```

---

## 3. Step 목록

순서대로 진행합니다. 앞 Step의 결과 위에 다음 Step을 쌓습니다.

| Step | 대상 | 할 일 | 완료 기준 | ADR |
|---|---|---|---|---|
| **0** ✅ | 공통 | 모노레포 뼈대 만들기 (pnpm, Turborepo, TypeScript, Vitest, Playwright 녹화 설정) + `apps/web` 빈 페이지 1개와 그 페이지를 여는 브라우저 테스트 1개 | `pnpm test`, `pnpm typecheck`, `pnpm e2e`가 통과하고, `pnpm e2e:record`로 `recordings/`에 영상이 생김 | [0001](adr/0001-monorepo-tooling.md), [0002](adr/0002-internal-packages-as-source.md), [0003](adr/0003-test-setup.md), [0004](adr/0004-pr-recordings-in-ci.md) (폐기), [0005](adr/0005-pr-recordings-gh-attach.md), [0006](adr/0006-pr-as-is-to-be-videos.md) |
| **1** ✅ | 공통 | 실행 취소/다시 실행 기반 만들기 (`command-core`) | undo/redo 테스트 통과 | [0007](adr/0007-command-history.md) |
| **2** ✅ | Excel | 셀 데이터 구조 + 화면에 표 그리기 + 셀 선택·키보드 이동 (범위 선택, 빠른 이동 키 포함) | 1,000행 표가 화면에 보이고 선택이 됨 | [0008](adr/0008-cell-storage.md), [0009](adr/0009-grid-view.md), [0010](adr/0010-e2e-grid-state.md), [0011](adr/0011-split-cell-input-step.md), [0012](adr/0012-selection-model.md) |
| **3** ✅ | Excel | 셀 값 입력 (셀 위 DOM 입력창, 한글 입력) + 공통 undo 연결 | 셀에 값(한글 포함)을 입력하고 undo/redo가 동작함 | [0013](adr/0013-selection-active-cell.md), [0014](adr/0014-cell-editor-ime.md), [0015](adr/0015-set-cells-command.md), [0016](adr/0016-shared-history.md) |
| **4** ✅ | Excel | 수식 계산 (`=A1+B1`, `=SUM(A1:A10)`), 순환 참조 감지 | 수식 결과가 맞게 나옴 | [0017](adr/0017-formula-engine.md), [0018](adr/0018-dependency-graph-and-cycles.md), [0019](adr/0019-reject-invalid-formula.md), [0020](adr/0020-grid-view-engine.md) |
| **5** ✅ | Excel | 대용량 성능 개선 (10만 행) + 성능 측정 | 아래 성능 목표 달성 | [0021](adr/0021-range-index-interval-tree.md), [0022](adr/0022-performance-measurement.md), [0023](adr/0023-large-sample-sheet.md), [0024](adr/0024-background-first-calculation.md) |
| **6** | Excel | 복사/붙여넣기, 행·열 삽입/삭제 시 수식 참조 자동 수정 | 실제 Excel과 복붙 호환 | 예정 |
| **7** | Docs | Tiptap으로 기본 문서 편집 + 공통 undo 연결 | 글쓰기·서식·undo 동작 | 예정 |
| **8** | PPT | 슬라이드 추가/삭제, 텍스트·도형 배치 + 공통 undo 연결 | 슬라이드 3장 편집 가능 | 예정 |
| **9** | 확장 (선택) | 실시간 협업(Yjs) 또는 AI 편집 | 해당 Step 시작 시 정의 | 예정 |

> 각 Step이 끝나면 체크(✅)하고, ADR 칸에 링크를 넣습니다.

### Excel 성능 목표 (Step 5)

| 상황 | 목표 | 측정값 |
|---|---|---|
| 10만 행 × 50열 스크롤 | 끊김 없이(60fps) | 60fps, 밀린 프레임 0 (세로 천천히·빠르게, 가로 모두), 그리기 최대 0.0033초 |
| 연결된 셀 1만 개 다시 계산 | 0.05초 이내 | 0.0082초 |
| 큰 `SUM` 수식이 있는 시트에서 셀 하나 수정 | 0.016초 이내 | 0.0044초 (`=SUM(A1:A100000)`) |
| 10만 행 시트(수식 20만 개) 첫 화면 — 셀까지 그려짐 | 0.5초 이내 | 0.23~0.38초 (수식 계산 완료 1.4~1.8초, 그동안 "…" 표시) |

> 2026-09-30, Apple M1 Mac, `pnpm bench` 기준. 스크롤은 개발 서버의 Chromium(1280×720)에서 쟀다. 측정 방법은 [ADR 0022](adr/0022-performance-measurement.md) 참고.

---

## 4. 테스트 방식

Excel은 촘촘하게, Docs · PPT는 핵심 흐름만 테스트합니다.

### 단위 테스트 (Vitest)

브라우저 없이 함수와 데이터만 확인합니다. 테스트 대부분을 여기에 둡니다.

| 대상 | 확인하는 것 |
|---|---|
| `command-core` | undo/redo, 연속 입력 합치기, 여러 편집을 한 번에 되돌리기 |
| Excel 수식 파서 | 수식을 올바르게 읽는지, 잘못된 수식에 에러를 내는지 |
| Excel 수식 계산 | 함수별 결과값, `#DIV/0!` 같은 에러 값 |
| 의존성 그래프 | 필요한 셀만 다시 계산하는지, 순환 참조를 잡는지 |
| 행·열 삽입 | 행을 끼우면 `=A5`가 `=A6`으로 바뀌는지 |

### 정답 비교 테스트 (Excel 수식)

같은 시트를 [HyperFormula](https://hyperformula.handsontable.com/)로도 계산해 결과가 같은지 비교합니다.
HyperFormula는 테스트에서 정답을 얻는 데만 쓰고, 실제 코드에는 넣지 않습니다.

### 브라우저 테스트 (Playwright) + 영상 녹화

사용자가 실제로 하는 동작을 브라우저에서 확인하고, **그 과정을 영상으로 녹화**해 PR에 첨부합니다.

- Excel: 셀 입력, 방향키 이동, 복사/붙여넣기, 한글 입력
- Docs · PPT: 입력, 서식 적용, undo

Excel 표는 Canvas로 그리기 때문에 결과는 화면이 아니라 내부 데이터를 꺼내서 확인합니다.

```bash
pnpm e2e          # 브라우저 테스트 실행 (녹화 없음)
pnpm e2e:record   # 녹화하면서 실행 → recordings/ 폴더에 영상(.webm) 저장
```

**PR 올릴 때:** `/pr`이 브라우저 테스트를 녹화해 `gh --attach`로 PR 본문에 넣습니다. PR에서 바로 재생됩니다. (GitHub CLI v2.99.0 이상 필요)
기존 화면을 바꾼 PR이면 바뀌기 전(as-is, `main`)과 후(to-be)를 나란히 올리고, 새 기능이면 to-be만 올립니다.

### 성능 측정 (Step 5부터)

`pnpm bench` 한 번으로 모두 잽니다. 결과는 표로만 보여주고, 목표를 넘어도 실패하지 않습니다.

- 재계산 속도·처음 열기: `packages/excel/src/*.bench.ts` (vitest bench)
- 스크롤 60fps: 세 가지로 잽니다.
  - ① 프레임 간격: 브라우저에서 스크롤하며 프레임 사이 시간을 잼 (`apps/web/perf/`)
  - ② Chrome 성능 기록: 화면에 나간 프레임과 버린 프레임을 셈 (`apps/web/perf/`)
  - ③ 그리기 시간만: 브라우저 없이 표 그리기 코드의 시간만 잼 (`packages/excel/src/render.bench.ts`)
- `pnpm test`의 대용량 테스트는 결과가 맞는지와 목표의 약 10배 안에 끝나는지만 봅니다.

### 규칙

- 테스트 파일은 코드 옆에 둡니다. (예: `parser.ts` 옆에 `parser.test.ts`)
- 모든 Step의 완료 기준에는 "`pnpm test` 통과"가 포함됩니다.
- 버그를 고치면 그 버그를 잡는 테스트를 함께 추가합니다.

---

## 5. 폴더 구조

```
apps/
  web/            화면 (Next.js) — 세 에디터를 여기서 띄움
packages/
  command-core/   공통: 실행 취소/다시 실행
  excel/          Excel 에디터 (수식 계산, 표 그리기)
  docs/           Docs 에디터 (Tiptap 기반)
  ppt/            PPT 에디터
  ui/             공통 버튼·메뉴 등 UI
adr/              설계 결정 기록 (Step마다 추가)
```

**규칙:** `excel`, `docs`, `ppt`는 서로를 직접 불러오지 않습니다. 공통으로 필요한 건 `command-core`나 `ui`에 둡니다.

---

## 6. 실행 방법

Node.js 24.21 (LTS, `.nvmrc` 참고)과 pnpm이 필요합니다. (Step 0 완료 후 사용 가능)

```bash
nvm use          # .nvmrc의 Node 버전으로 전환
pnpm install     # 설치
pnpm --filter @office/web exec playwright install chromium  # 브라우저 테스트용 Chromium 설치 (처음 한 번)
pnpm dev         # 개발 서버 실행
pnpm test        # 단위 테스트
pnpm e2e         # 브라우저 테스트
pnpm e2e:record  # 브라우저 테스트 + 영상 녹화
pnpm typecheck   # 타입 검사
pnpm bench       # 성능 측정 (Step 5 이후)
```

---

## 기술 스택

TypeScript, React 19, Next.js, Tiptap, Vitest, Playwright, pnpm workspaces, Turborepo
