# 0015. 셀 편집 Command와 시트 변경 알림

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 3

## 배경
셀 값은 모두 `command-core`의 Command로 바꿔야 undo가 된다. (ADR 0007)
셀 편집 Command의 모양과, undo/redo처럼 화면 밖에서 값이 바뀌었을 때 화면이 알아채는 방법을 정해야 한다.
Step 6 붙여넣기는 한 번에 수천 칸을 바꾸고, Step 4 수식 재계산도 어떤 셀이 바뀌었는지 알아야 한다.

## 선택지
- Command 모양
  - A안 여러 셀을 담는 `SetCellsCommand([{ address, value }, ...])` 하나: 셀 하나 입력, 범위 Delete, 붙여넣기가 모두 Command 하나 / 셀 하나만 바꿀 때도 배열로 넘김
  - B안 셀 하나짜리 `SetCellCommand` + `history.batch`: 가장 단순 / 1만 칸 붙여넣기면 Command도 1만 개
- 변경 알림
  - A안 `Sheet.onChange(listener)`가 바뀐 셀 주소를 알림: 누가 바꿨든(입력, undo, 나중의 붙여넣기) 한 곳에서 알림. 수식 재계산도 같은 알림을 씀 / 알림 기능을 새로 만듦
  - B안 Command가 끝나면 화면 콜백을 직접 부름: 새 기능이 필요 없음 / 데이터(Command)가 화면을 알게 되고, 재계산은 따로 연결해야 함

## 결정
둘 다 A안.
- `SetCellsCommand(sheet, changes)`는 execute 때 바꾸기 전 값을 읽어 두고 undo 때 되돌린다. 같은 셀이 여러 번 있어도 처음 값으로 돌아간다.
- `Sheet.setCells(changes)`는 여러 셀을 한 번에 바꾸고 `onChange`를 한 번 부른다. 시트 밖 주소가 하나라도 있으면 아무것도 바꾸지 않고 에러를 던진다. (ADR 0007: execute가 반쯤 바꾸고 실패하면 안 됨)
- `setCells`는 공개 메서드지만 Command 안에서만 부른다. 직접 부르면 undo가 깨진다.
- GridView는 알림을 받으면 다시 그리고, 자기가 실행한 편집이 아니면(undo/redo) 바뀐 셀들을 선택한다. (Excel과 같음)
- 값이 그대로인 확정(F2 뒤 바로 Enter 등)은 기록하지 않는다. Delete는 범위 안에서 값이 있는 셀만 담는다.

## 결과
- 셀 편집 한 번이 undo 한 번이다. 셀 입력에는 `mergeKey`를 쓰지 않는다.
- Delete로 지운 범위를 undo하면 값이 있던 셀들을 덮는 범위가 선택된다. 지운 범위 전체가 아니라서 Excel과 조금 다를 수 있다.
- Delete는 범위 칸을 모두 훑으므로, 아주 큰 범위(Step 5, 500만 칸)에서는 값이 있는 셀만 훑는 방법이 필요할 수 있다.
