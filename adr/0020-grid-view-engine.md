# 0020. 수식 엔진은 앱이 만들어 GridView에 넘긴다

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 4

## 배경
표 화면(`GridView`)은 셀에 계산값을 그려야 한다. 엔진을 누가 만들고 갖고 있을지 정해야 한다.

## 선택지
- A안 앱이 `new FormulaEngine(sheet)`를 만들어 `new GridView(container, sheet, history, { engine })`로 넘긴다: History(ADR 0016)와 같은 방식, 앱의 수식 바·테스트용 창구가 같은 계산값을 바로 읽음 / 쓰는 쪽이 한 줄 더 씀
- B안 GridView가 안에서 만든다: 쓰는 쪽이 간단 / 다른 화면이 계산값을 쓰려면 GridView가 엔진을 내보내야 함

## 결정
A안. `GridViewOptions.engine`은 꼭 넘겨야 한다. 그래서 `GridView`의 네 번째 인자(options)는 이제 생략할 수 없다.
앱은 화면을 없앨 때 `view.destroy()`와 함께 `engine.destroy()`를 부른다.

브라우저 테스트용 `window.__excel`(ADR 0010)에 더한다.
- `value("F2")`: 셀에 보이는 계산값 글자 (`cell("F2")`은 입력한 수식 글자 그대로)
- `state().problem`: 틀린 수식 알림(ADR 0019)이 떠 있으면 그 글자, 아니면 `null`

## 결과
- GridView는 계산값을 그리기만 하고 엔진 변경을 따로 듣지 않는다. 엔진은 `sheet.onChange` 안에서 바로 다시 계산하고, GridView는 다음 프레임에 그리므로 항상 새 값을 그린다.
- 엔진이 다른 이유로(예: 나중의 `NOW()` 같은 함수) 값을 바꾸게 되면 GridView가 `engine.onChange`를 들어야 한다. 그때 더한다.
