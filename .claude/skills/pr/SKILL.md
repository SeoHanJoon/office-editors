---
name: pr
description: 현재 Step 브랜치를 커밋하고 push한 뒤 GitHub PR을 만든다. 화면 변경이 있으면 Playwright 영상을 녹화하고, PR 본문에 영상을 첨부하는 방법을 안내한다.
disable-model-invocation: true
---

# PR 올리기

## 1. 준비 확인

- 현재 브랜치가 `main`이면 멈춘다.
- `pnpm typecheck`와 `pnpm test`가 통과하는지 확인한다. 실패하면 멈춘다.
- README에서 이 Step이 ✅인지 확인한다. 아니면 `/step-finish`를 먼저 하라고 안내한다.

## 2. 영상 녹화 (화면 변경이 있을 때)

- `apps/`나 에디터 패키지의 화면 코드가 바뀌었으면 녹화한다.

```bash
pnpm e2e:record
```

- 영상은 `recordings/`에 `.webm`으로 저장된다. 이 폴더는 커밋하지 않는다. (`.gitignore` 확인)
- 어떤 테스트가 어떤 영상인지 파일 이름과 함께 목록을 만든다.

## 3. 커밋

- `git status`로 바뀐 파일을 보여주고, 커밋할 파일과 커밋 메시지를 사용자에게 확인받는다.
- `.DS_Store`, `recordings/`, `.env` 같은 파일은 올리지 않는다.
- 커밋 메시지: `<type>(step-N): <요약>` (type: feat, fix, test, docs, chore, perf, refactor)

## 4. push와 PR 생성

사용자가 확인하면 push하고 `gh pr create`로 PR을 만든다. 본문 형식:

```markdown
## Step N: <제목>

### 한 일
- ...

### 완료 기준
| 항목 | 결과 |
|---|---|
| ... | ✅ |

### 설계 결정 (ADR)
- [0003. 셀 데이터 저장 구조](adr/0003-cell-storage.md)

### 테스트
- `pnpm typecheck` ✅
- `pnpm test` ✅ (N개)
- `pnpm e2e` ✅ (해당 시)

### 성능 (해당 시)
| 상황 | 목표 | 측정값 |
|---|---|---|

### 영상
<!-- 아래 영상 파일을 여기에 드래그해서 첨부 -->
```

## 5. 영상 첨부 안내

`gh`로는 PR 본문에 영상을 올릴 수 없다. PR 링크와 함께 아래를 알려준다.

- 첨부할 영상 파일의 전체 경로 목록
- "GitHub에서 PR 본문을 편집하고, '영상' 섹션에 위 파일들을 드래그하세요."
