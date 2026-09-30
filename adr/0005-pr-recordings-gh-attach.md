# 0005. PR 영상은 로컬에서 녹화해 `gh --attach`로 PR 본문에 넣는다

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 0

## 배경
0004(Actions 녹화 + zip 아티팩트)로는 영상을 보려면 zip을 받아 풀어야 했다.
PR 본문이나 댓글에서 바로 재생되길 원한다. GitHub CLI v2.99.0부터 `--attach`로 영상을 올리면
브라우저에서 드래그한 것과 같은 `user-attachments` 주소가 되어 영상 플레이어로 보인다. (PR #1에서 확인)

## 선택지
- A안 `/pr`에서 로컬로 녹화하고 `gh pr create --attach`로 PR 본문에 넣기: 추가 설정 없음, 본문에서 바로 재생 / push 후 자동 갱신 안 됨
- B안 Actions에서 녹화하고 `gh pr comment --attach`로 댓글에 넣기: push마다 자동 / `GITHUB_TOKEN`이 공식 지원 목록에 없어 classic PAT를 Secret으로 둬야 함(권한이 넓고 만료 관리 필요)

## 결정
A안. PAT 없이 지금 로그인(`gh auth login`)만으로 되고, 영상이 PR 본문에 바로 보인다.
- `.github/workflows/e2e-record.yml`은 지운다.
- 본문 "영상" 칸에 테스트 이름과 `![](recordings/<폴더>/video.webm)`를 적고, 같은 파일을 `--attach`로 넘긴다. `gh`가 참조를 업로드 주소로 바꾼다.

## 결과
- PR을 열면 영상이 바로 재생된다.
- 화면을 바꾼 뒤 다시 push하면 영상은 자동으로 바뀌지 않는다. 다시 녹화하고 `gh pr edit --attach`로 본문을 고친다.
- 영상 하나는 10MB(무료 요금제)를 넘을 수 없다.
- `gh` v2.99.0 이상이 필요하다.
