---
paths:
  - "packages/excel/**"
---

# Excel 패키지 규칙 (깊게 구현)

- 핵심 로직은 라이브러리 없이 직접 구현한다: 셀 데이터 구조, 수식 파서·계산기, 의존성 그래프, Canvas 렌더러, 복사/붙여넣기.
- HyperFormula는 **테스트에서 정답 비교용으로만** 쓴다. 실제 코드에서 import하지 않는다.
- 동작 기준은 Microsoft Excel이다. Google Sheets나 HyperFormula가 Excel과 다르면 Excel을 따른다.
- 표는 Canvas로 그리고, 셀 편집기만 DOM으로 띄운다. (한글 입력 때문)
- 셀 값을 바꾸는 코드는 모두 `command-core`의 Command를 거친다. 데이터를 직접 수정하지 않는다. (undo가 깨짐)
- 성능이 중요한 코드(렌더링, 재계산)를 바꾸면 Step 5 이후에는 `pnpm bench` 결과를 전후로 비교해서 보고한다.
