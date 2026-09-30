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

## 2. 영상 녹화

- 영상은 GitHub Actions(`.github/workflows/e2e-record.yml`)가 PR마다 자동으로 녹화한다. 로컬에서 녹화하지 않는다. (ADR 0004)

## 3. 커밋

- `git status`로 바뀐 파일을 보여주고, 커밋할 파일과 커밋 메시지를 사용자에게 확인받는다.
- `.DS_Store`, `recordings/`, `.env` 같은 파일은 올리지 않는다.
- 커밋 메시지: `<type>(step-N): <요약>` (type: feat, fix, test, docs, chore, perf, refactor)

## 4. push와 PR 생성

사용자가 확인하면 push하고 `gh pr create --assignee @me`로 PR을 만든다. (assignee는 항상 본인) 본문 형식:

```markdown
## Step N: <제목>

### 한 일
- ...

### 완료 기준
| 항목 | 결과 |
|---|---|
| ... | ✅ |

### 설계 결정 (ADR)
- [0003. 셀 데이터 저장 구조](https://github.com/<owner>/<repo>/blob/<커밋 SHA>/adr/0003-cell-storage.md)

### 테스트
- `pnpm typecheck` ✅
- `pnpm test` ✅ (N개)
- `pnpm e2e` ✅ (해당 시)

### 성능 (해당 시)
| 상황 | 목표 | 측정값 |
|---|---|---|

### 영상
GitHub Actions가 녹화해서 이 PR에 링크 댓글을 답니다.
```

- PR 본문의 파일 링크는 상대 경로(`adr/...`)로 쓰지 않는다. PR 페이지 기준으로 해석돼 404가 난다.
  push한 커밋 SHA로 고정 주소를 만든다: `$(gh repo view --json url -q .url)/blob/$(git rev-parse HEAD)/<경로>`
  (브랜치 이름 대신 SHA를 쓰면 머지 후 브랜치를 지워도 링크가 살아 있다.)

## 5. 영상 확인

PR 링크를 알려주고, `gh pr checks <번호> --watch`로 `e2e-record`가 끝나기를 기다린다.
- 성공하면 PR에 영상 링크 댓글이 달렸는지 확인해서 알려준다.
- 실패하면 `gh run view --log-failed`로 원인을 요약해 보고한다.
