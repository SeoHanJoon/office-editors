# 0012. 선택 상태 모양: { anchor, focus }

- 상태: 폐기 (→ 0013)
- 날짜: 2026-09-30
- 관련 Step: Step 2

## 배경
셀 하나 선택, Shift+방향키·드래그·Shift+클릭으로 범위 선택을 담을 모양을 정해야 한다. `@office/excel`이 내보내는 공개 인터페이스(`Selection`)다.
다른 제품은 대부분 활성 셀과 범위를 따로 둔다. Excel은 `ActiveCell` + `Selection`, Google Sheets는 `getCurrentCell()` + `getActiveRangeList()`, Handsontable은 범위마다 `from`/`to` + `highlight`(활성 셀)이다.

## 선택지
- A안 `{ anchor, focus }`: anchor가 활성 셀, focus는 늘린 반대쪽 끝. 단순하고 Shift 확장이 자연스러움 / 활성 셀이 범위 모서리가 아닌 경우(Enter로 범위 안 돌기)를 못 담음
- B안 `{ range, active }`: 활성 셀이 범위 안 어디든 올 수 있음 / Shift 확장 때 어느 모서리를 움직일지 따로 알아야 해서 계산이 복잡
- C안 범위 목록 + 활성 셀: Ctrl+클릭 여러 범위까지 담음 / 지금 쓰지 않는 기능을 위한 모양

## 결정
지금은 A안. Step 2에서는 활성 셀이 늘 anchor와 같아서 더 넓은 모양이 쓰일 곳이 없다.
Step 3에서 범위 안 Enter/Tab 돌기를 만들 때 `active`를 더해 `{ anchor, focus, active }`로 넓힌다. Handsontable·Excel과 같은 방향이다. 그때 새 ADR을 쓴다.

## 결과
- Shift+방향키는 focus를, 방향키·클릭은 anchor를 기준으로 움직인다. 선택 범위는 `selectionRange()`로 구한다.
- 범위를 고른 채 Tab/Enter를 누르면 지금은 범위를 풀고 한 칸 옮긴다. (Excel과 다름, Step 3에서 고침)
- `Selection`을 쓰는 곳은 `keyboard.ts`, `render.ts`, `grid-view.ts`, `apps/web/app/excel/spreadsheet.tsx`다. Step 3에서 넓힐 때 이 네 곳을 고친다.
