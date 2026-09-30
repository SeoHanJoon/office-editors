---
name: pr
description: 현재 Step 브랜치를 커밋하고 push한 뒤 GitHub PR을 만든다. 화면 변경이 있으면 Playwright 영상을 as-is(base)와 to-be(이 PR)로 녹화해 `gh --attach`로 PR 본문에 넣는다.
disable-model-invocation: true
---

# PR 올리기

## 1. 준비 확인

- 현재 브랜치가 `main`이면 멈춘다.
- `pnpm typecheck`와 `pnpm test`가 통과하는지 확인한다. 실패하면 멈춘다.
- README에서 이 Step이 ✅인지 확인한다. 아니면 `/step-finish`를 먼저 하라고 안내한다.

## 2. 영상 녹화 (화면 변경이 있을 때)

`git diff main...HEAD`로 상황을 보고 어떤 영상을 만들지 정한다. 판단 결과는 사용자에게 한 줄로 알린다.

| 상황 | 영상 |
|---|---|
| 화면 코드 변경 없음 (`apps/`, 에디터 패키지 화면 코드, `e2e/` 모두 그대로) | 없음 |
| 새 화면·기능이라 base에는 보여줄 게 없음 | to-be만 |
| 기존 화면의 동작·모양이 바뀜 (버그 수정, 개선) | as-is + to-be |

테스트마다 따로 판단한다. 예: 기존 테스트는 as-is + to-be, 새 기능 테스트는 to-be만.
버그 수정용으로 새로 쓴 테스트는 as-is에서 버그가 보이므로 as-is + to-be로 둔다.

to-be를 먼저 녹화하고 as-is를 녹화한다. (`pnpm e2e:record`가 시작할 때 `recordings/`를 비우므로 순서가 바뀌면 as-is가 지워진다)

```bash
pnpm e2e:record                                  # to-be → recordings/<테스트 이름>-chromium/video.webm
.claude/skills/pr/record-as-is.sh main           # as-is → recordings/as-is/<테스트 이름>-chromium/video.webm
```

- `record-as-is.sh`는 base 브랜치를 임시 폴더(git worktree)에 꺼내 **이 PR의 테스트 파일**을 base 코드 위에서 녹화한다. 같은 시나리오를 비교하기 위해서다. (ADR 0006)
- as-is에서 테스트가 실패해도 영상은 남는다. 동작을 바꾼 PR이면 정상이다. 본문에 "as-is에서 실패(예상)"라고 적는다.
- 종료 코드 3이면 base에 브라우저 테스트가 없는 것이다. to-be만 올린다.
- `recordings/`는 커밋하지 않는다. (`.gitignore` 확인)
- 영상 하나가 10MB를 넘으면 올라가지 않는다. 넘으면 사용자에게 알린다.

## 3. 커밋

- `git status`로 바뀐 파일을 보여주고, 커밋할 파일과 커밋 메시지를 사용자에게 확인받는다.
- `.DS_Store`, `recordings/`, `.env` 같은 파일은 올리지 않는다.
- 커밋 메시지: `<type>(step-N): <요약>` (type: feat, fix, test, docs, chore, perf, refactor)

## 4. push와 PR 생성

사용자가 확인하면 push하고 `gh pr create --assignee @me --body-file <본문> --attach <영상>...`로 PR을 만든다. (assignee는 항상 본인, 영상마다 `--attach`를 반복) 본문 형식:

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
#### home.spec.ts › 첫 페이지를 열면 제목과 연결된 패키지가 보인다
| as-is (`main`) | to-be (이 PR) |
|---|---|
| ![](recordings/as-is/<테스트 이름>-chromium/video.webm) | ![](recordings/<테스트 이름>-chromium/video.webm) |

#### new-feature.spec.ts › (to-be만 있는 테스트)
![](recordings/<테스트 이름>-chromium/video.webm)
```

- PR 본문의 파일 링크는 상대 경로(`adr/...`)로 쓰지 않는다. PR 페이지 기준으로 해석돼 404가 난다.
  push한 커밋 SHA로 고정 주소를 만든다: `$(gh repo view --json url -q .url)/blob/$(git rev-parse HEAD)/<경로>`
  (브랜치 이름 대신 SHA를 쓰면 머지 후 브랜치를 지워도 링크가 살아 있다.)
- 영상 참조 `![](recordings/...)`는 예외다. 같은 경로를 `--attach`로 넘기면 `gh`가 업로드 주소로 바꾼다. (ADR 0005)
  표 칸 안에서도 영상 플레이어로 보인다. as-is와 to-be를 나란히 놓을 때 표를 쓴다.
- 화면 변경이 없으면 "영상" 칸은 빼고 `--attach`도 쓰지 않는다.

## 5. 영상 확인

PR 링크를 알려주고, 영상이 플레이어로 들어갔는지 확인한다.

```bash
gh api repos/{owner}/{repo}/pulls/<번호> -H "Accept: application/vnd.github.html+json" -q .body_html | grep -o '<video' | wc -l
```

- 영상 수만큼 나오지 않으면 본문의 `recordings/` 참조가 그대로 남았는지 보고 원인을 보고한다.
- 이미 올린 PR에서 화면을 다시 바꿨으면 2단계대로 다시 녹화하고 `gh pr edit <번호> --body-file <본문> --attach <영상>...`으로 영상을 바꾼다.
