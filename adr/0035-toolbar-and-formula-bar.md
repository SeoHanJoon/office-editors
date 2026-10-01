# 0035. 툴바와 수식 입력줄: 코드 위치와 셀 입력창 연결

- 상태: 채택
- 날짜: 2026-10-01
- 관련 Step: Step 10

## 배경
표 위에 툴바(실행 취소·다시 실행, 서식 버튼)와 수식 입력줄(이름 상자, 셀 글자)을 둔다.
`GridView`는 React 없이 표만 그린다. (ADR 0009) 툴바 코드를 어디에 둘지 정해야 한다.
Excel은 수식 입력줄에서 치면 셀 위에도 같은 글자가 보이고, 셀에서 치면 입력줄도 바뀐다. 이것을 따를지도 골라야 한다.

## 선택지
- 코드 위치
  - A안 `@office/ui`에 React 부품(버튼, 색 고르기 등) + `apps/web`이 Excel 툴바를 조립: Docs·PPT가 부품을 다시 쓴다. / GridView가 서식 적용·현재 서식·이동 같은 메서드를 내보내야 한다.
  - B안 모두 `apps/web`: 가장 빠르다. / Docs·PPT에서 다시 만들어야 한다.
  - C안 `excel` 패키지 DOM (오른쪽 클릭 메뉴처럼): 쓰는 쪽이 간단하다. / 색 고르기 같은 UI를 React 없이 손으로 만들어야 한다.
- 수식 입력줄과 셀 입력창
  - A안 두 곳을 동기화 (Excel과 같음): 어디서 쳐도 양쪽에 보인다. / 한글 조합 중 글자도 맞춰야 해서 연결 코드와 테스트가 늘어난다.
  - B안 따로 고치고 확정 때만 반영: 단순하다. / 입력줄에서 치는 동안 셀에는 안 보여 Excel과 다르다.

## 결정
모두 A안이다. (사용자 선택)
- `@office/ui`: React 툴바 부품. Excel을 모른다.
- `apps/web`: 부품으로 Excel 툴바와 수식 입력줄을 만들고 `GridView`·`History`에 연결한다.
- `GridView`는 React 없이 메서드와 알림만 더한다. 지금 셀의 서식 읽기, 고른 범위에 서식 주기, 주소로 이동하기, 입력 상태(입력 중인지, 입력 중인 글자)와 그 변경 알림, 바깥(입력줄)에서 입력 시작·글자 바꾸기·확정·취소.
- 입력줄에서 치면 셀 입력창이 같은 글자로 열리고, 셀에서 치면 입력줄이 같은 글자를 보여준다. 한글 조합 중 글자도 양쪽에 보인다. Enter·Tab·Esc는 셀 입력창과 같은 뜻이다.
- undo·redo 버튼 상태를 위해 `History`에 변경 알림을 더한다. (ADR 0016에서 버튼을 만들 때 더하기로 한 것)

## 결과
- `excel` 패키지는 여전히 React를 모른다. 툴바를 바꿔도 표 코드는 그대로다.
- `GridView`의 공개 메서드가 늘어난다. 입력 상태를 두 곳이 함께 쓰므로 입력 시작·확정 규칙은 `GridView` 한 곳에 둔다.
- 툴바 버튼을 누르면 포커스가 버튼으로 가므로, 누른 뒤 표로 포커스를 돌려준다.
- 구현하며 정한 것:
  - React 부품은 `@office/ui/react` 입구로 따로 내보낸다. `@office/excel`은 `@office/ui`에서 오른쪽 클릭 메뉴만 가져오므로 React를 끌어오지 않는다. `@office/ui`는 React를 peerDependency로 둔다.
  - 부품: `Toolbar`, `ToolbarButton`(`pressed`를 주면 `aria-pressed`), `ToolbarSelect`, `ToolbarMenu`, `ColorPicker`, `ToolbarSeparator`
  - `GridView`에 더한 것: `activeFormat`, `applyFormat`, `toggleFormat`, `clearFormat`, `applyBorders`, `changeDecimals`, `goTo`, `editState`, `onEditChange`, `setEditText`, `commitEdit`, `cancelEdit`
  - `History.onChange`: 편집 실행, batch 끝, undo, redo 때 알린다. batch 안의 편집은 batch가 끝날 때 한 번만 알린다.
  - 버튼은 누를 때 포커스를 가져가지 않는다. (셀 입력창이 키보드를 계속 받는다) 고르기(글자 크기, 숫자 형식)·색 고르기는 고른 뒤 표로 포커스를 돌려준다.
  - 서식 버튼은 입력 중이면 먼저 확정한다. 실행 취소·다시 실행 버튼은 입력 중에 막는다. (Excel과 같음)
  - 켜진 정렬 버튼을 다시 누르면 일반 정렬(값 종류에 따름)로 돌린다. 세로 정렬은 아래가 기본이라 버튼이 눌린 모양으로 보인다.
  - 단축키 Ctrl/Cmd+B·I·U는 입력 중이 아닐 때만 받는다. Ctrl+U는 브라우저의 소스 보기와 겹쳐서 막는다. 취소선 단축키(Ctrl+5)는 넣지 않았다.
  - 수식 입력줄: 치기 시작하면 활성 셀의 "edit" 입력이 된다. Enter·Tab은 확정하고 옮기며, Shift를 누르면 반대로 간다. Alt+Enter는 줄바꿈, Esc는 취소다.
  - 이름 상자: 틀린 주소면 빨간 테두리(`aria-invalid`)로 두고 글자를 골라 둔다. Esc를 누르면 지금 셀 주소로 돌아간다.
  - 브라우저 테스트용 `window.__excel`에 `format(a1)`을 더했다. `value(a1)`은 숫자 형식을 적용한 글자다. (ADR 0010, 0020)
- 자동 테스트로 확인하지 못한 것: 실제 입력기로 수식 입력줄에서 한글을 조합하는 것(CDP로 셀 쪽 조합만 확인했다), Ctrl+U 소스 보기가 실제로 막히는지(Playwright 키는 브라우저 단축키를 거치지 않는다)
