# 0017. 수식 엔진: 계산값 위치, 값 모양, 첫 함수

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 4

## 배경
Step 4에서 수식(`=A1+B1`, `=SUM(A1:A10)`)을 계산한다. `Sheet`는 사용자가 친 글자만 저장하고, 계산값은 따로 두기로 했다. (ADR 0008)
계산값을 어디에 둘지, 코드에서 값(숫자·글자·논리값·빈 셀·에러)을 어떤 모양으로 다룰지, 이번에 만들 함수 범위를 정해야 한다.

## 선택지
- 계산값 위치
  - A안 별도 `FormulaEngine`이 `Sheet.onChange`를 듣고 계산값을 따로 저장: ADR 0008과 맞고 저장·계산 역할이 나뉨 / 화면이 Sheet와 엔진을 둘 다 알아야 함
  - B안 `Sheet.getValue()`로 Sheet 안에서 같이: 쓰기 간단 / Sheet가 커지고 역할이 섞임
- 값 모양
  - A안 기본형 + 에러 클래스 (`number | string | boolean | null | FormulaError`): 계산 코드가 짧고 빠름, 숫자를 객체로 감싸지 않음 / 에러는 `instanceof`로 구분
  - B안 모든 값에 종류 태그 (`{ type: "number", value: 3 }`): 타입이 명확 / 셀마다 객체가 생겨 10만 행에서 메모리·속도 부담
- 함수 범위
  - A안 `SUM`만: 완료 기준만 맞춤 / 범위 처리 규칙을 하나로만 검증
  - B안 `SUM`·`AVERAGE`·`MIN`·`MAX`·`COUNT`: 자주 쓰는 집계 함수까지, 범위 처리 헬퍼를 넓게 검증 / Step이 커짐

## 결정
- 계산값은 A안. `new FormulaEngine(sheet)`가 처음에 시트 전체를 읽고(`Sheet.entries()` 추가), 이후 `sheet.onChange`로 바뀐 셀만 반영한다. `engine.getValue(address)`로 계산값을, `engine.onChange`로 다시 계산된 셀을 알린다.
- 값 모양은 A안. 빈 셀은 `null`, 에러는 `new FormulaError("#DIV/0!")`. 순환 참조 에러 `#CYCLE!`만 Excel에 없는 이름이다. (ADR 0018)
- 함수는 B안. 5개 모두 Excel 규칙대로 "직접 쓴 값"과 "셀·범위 참조"를 다르게 다룬다. 예: `SUM("3")`은 3을 더하지만, A1에 글자 "3"이 있으면 `SUM(A1)`은 무시한다. 아는 함수의 인자 개수가 틀리면(`=SUM()`) 문법 오류, 모르는 함수는 `#NAME?`.
- 셀 입력 해석(Excel과 같음): 숫자 모양이면 숫자, `TRUE`/`FALSE`는 논리값, `#N/A` 같은 에러 이름은 에러, `'`로 시작하면 뒤 글자를 그대로 글자로 둔다. (`'5`는 글자 "5")
- 파일은 새 폴더 없이 `packages/excel/src/`에 `formula-*.ts`로 둔다. (파서 → 구문 나무 → 계산기 → 함수 → 엔진)
- 연산자 우선순위는 Excel과 같다. `-2^2`는 4, `2^3^2`는 64.

## 결과
- 화면은 셀에 `formatValue(engine.getValue())`를 그리고, 입력창에는 `sheet.get()`(수식 글자)을 보여준다. 숫자는 오른쪽, 글자는 왼쪽, 논리값·에러는 가운데 정렬이다.
- 숫자는 유효 숫자 15자리까지 보여준다(`0.1+0.2` → `0.3`). 열 너비에 맞춰 줄이는 Excel "일반" 서식은 아직 없다.
- HyperFormula 정답 비교 테스트에서 뺀 것: 수식 안에 괄호 없이 쓴 `TRUE`/`FALSE`(HyperFormula는 `#NAME?`), `=0^-1`(Excel은 `#DIV/0!`, HyperFormula는 `#NUM!`). 이 둘은 단위 테스트에서 Excel 기준으로 확인한다.
- 아직 없는 것: `A:A`처럼 열 전체 참조, 다른 시트 참조, 날짜, `1,000` 같은 천 단위 쉼표, 동적 배열(`=A1:A3` 결과는 `#VALUE!`), 수식 입력 중 방향키로 셀 참조 넣기, 함수 이름 자동 대문자 바꾸기. 필요한 Step에서 더한다.
- 새 함수는 `/excel-function`으로 `FUNCTIONS` 표에 더한다.
