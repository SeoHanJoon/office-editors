# 0037. Docs undo: Tiptap 편집을 공통 History의 Command로 바꾼다

- 상태: 채택
- 날짜: 2026-10-01
- 관련 Step: Step 11

## 배경
Docs는 Tiptap(안에서 ProseMirror를 씀)으로 만든다. Tiptap에는 자체 undo가 있지만 Excel은 `command-core`의 `History`를 쓴다. (ADR 0007, 0016)
두 에디터의 undo를 같은 방식으로 맞출지, 맞춘다면 어떻게 이을지 정해야 한다.
ProseMirror는 편집 한 번을 "트랜잭션"으로 만들고, 트랜잭션은 문서를 바꾸는 "step"들을 담는다. step은 반대 step을 만들 수 있다.

## 선택지
- A안 트랜잭션 → Command: Tiptap undo를 끄고, 문서를 바꾸는 트랜잭션마다 Command(execute=적용, undo=반대 step 적용)를 만들어 `History`로 실행 / ADR 0007 그대로, Excel과 같은 기록 하나 / 가로채는 코드와 커서 위치 되돌리기를 직접 만든다
- B안 Tiptap undo를 대신 시키는 Command: 되돌리기는 Tiptap이 하고 `History`에는 "Tiptap에게 undo하라"는 Command만 넣는다 / 한글 조합 묶기 등 검증된 동작 / 기록이 두 곳이라 개수·순서를 맞춰야 하고, Tiptap이 직접 문서를 바꿔 ADR 0007("history.execute로만 바꾼다")에서 벗어난다
- C안 문서 통째 저장: Command가 편집 전·후 문서를 들고 있다 / 가장 단순 / 긴 문서면 기록 100개 × 문서 크기만큼 메모리
- D안 Tiptap undo만 쓰기: 공통 History를 쓰지 않는다 / 가장 빠름 / Step 11의 "공통 undo 연결"을 하지 않게 된다
- 이어서 친 글자 묶기: 시간(0.5초)만 / 시간 + 단어·줄 경계

## 결정
A안, 묶기는 시간 + 단어·줄 경계. (사용자 선택. D안을 골랐다가 "Excel처럼 공통 History를 쓰자"로 바꿨다)
- Tiptap 3의 확장 훅 `dispatchTransaction`으로 문서를 바꾸는 트랜잭션을 모두 가로채 `History.execute`로 넘긴다. 처음 execute는 받은 트랜잭션을 그대로 적용한다. (한글 조합 중인 트랜잭션을 다시 만들면 조합이 깨지므로)
- 적용하면서 플러그인이 덧붙인 트랜잭션(예: 문서 끝에 빈 문단 붙이기)도 같은 Command에 담는다. 플러그인이 걸러내 적용되지 않으면 기록하지 않는다.
- undo는 반대 step을 적용하고 편집 전 커서 위치로, redo는 step을 다시 적용하고 편집 뒤 커서 위치로 간다. 이렇게 만든 트랜잭션에는 표시를 붙여 다시 기록하지 않는다.
- 묶기는 `command-core`를 고치지 않고 `mergeKey`로 한다. 같은 자리에서 이어 치거나 지우면 같은 키, 띄어쓰기 뒤 새 단어·커서 이동·줄 바꾸기·서식이면 새 키다. 0.5초 간격은 `History`가 그대로 본다.

## 결과
- Excel과 Docs가 같은 `History`·`Command`·`onChange`를 쓴다. 툴바 undo 버튼도 같은 방식으로 붙는다. (ADR 0016의 "Docs도 같은 방식인지"를 확인)
- Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z와 브라우저 메뉴의 실행 취소(`beforeinput`)를 모두 `History`로 보낸다. 한글 조합 중에는 undo·redo를 막는다.
- 문서를 바꾸면서 기록하지 않는 길(Command 밖에서 `view.updateState`로 바꾸기, 협업 등)이 생기면 기록이 어긋난다. 그런 기능을 넣을 때 다시 본다.
- 서식을 고르지 않은 채 굵게를 켜는 것(다음에 칠 글자 서식)은 문서를 바꾸지 않아 기록하지 않는다. (Word와 같음)
- 핵심 변환은 DOM 없이 ProseMirror 문서 상태만으로 단위 테스트한다. 실제 입력·한글 조합·단축키는 Playwright로 확인한다.
