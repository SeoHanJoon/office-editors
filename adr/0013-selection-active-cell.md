# 0013. 선택 상태에 활성 셀 더하기: { anchor, focus, active }

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 3

## 배경
ADR 0012의 `{ anchor, focus }`는 활성 셀이 늘 anchor라서, 범위를 고른 채 값을 입력하고 Enter/Tab을 누를 때 활성 셀이 범위 안을 도는 Excel 동작을 담지 못한다.
0012에서 Step 3에 `active`를 더해 넓히기로 미리 정했다.

## 선택지
- A안 `{ anchor, focus, active }`: 0012에서 정한 방향. Shift 확장은 지금처럼 anchor·focus로, 활성 셀은 active로 / 필드가 하나 늘어남
- B안 `{ range, active }`: 활성 셀과 범위를 따로 둠 / Shift 확장 때 움직일 모서리를 따로 알아야 함 (0012에서 이미 뺌)

## 결정
A안. 0012에서 정한 대로 넓힌다.
- `active`는 늘 범위 안에 있다. `selectCell`은 세 값을 같게, `extendTo`는 active를 anchor로 되돌린다.
- 범위를 고른 채 Enter는 아래로(열 끝이면 다음 열 맨 위), Tab은 오른쪽으로(행 끝이면 다음 행 맨 왼쪽), Shift를 누르면 반대로 돈다. 마지막 칸 다음은 첫 칸이다. (`cycleInRange`)
- 방향키·Home·PageDown은 active에서 출발하고 범위를 푼다. Shift+방향키는 지금처럼 focus에서 출발한다.
- undo/redo로 값이 바뀌면 바뀐 셀을 모두 덮는 범위를 고르고 왼쪽 위 칸을 활성 셀로 둔다. (`selectRange`)

## 결과
- 이름 상자와 `window.__excel.state().active`는 `active`를 보여준다.
- Step 2 테스트 중 "범위에서 Tab/Enter를 누르면 범위를 푼다" 두 곳은 Excel 동작에 맞게 기대값을 바꿨다. (0011, 0012에서 Step 3에 고치기로 한 것)
- Excel은 범위 안에서 옮긴 활성 셀에서 Shift+방향키를 누르면 범위를 다르게 줄이지만, 여기서는 활성 셀을 anchor로 되돌린다. 필요해지면 고친다.
- Excel의 "Tab으로 옆으로 가다가 Enter를 누르면 처음 열의 다음 행으로 간다"는 아직 없다.
