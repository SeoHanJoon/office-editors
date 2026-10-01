# 0016. undo 기록(History)은 앱이 만들어 에디터에 넘긴다

- 상태: 채택 (툴바 undo 버튼용 변경 알림은 0035에서 더함)
- 날짜: 2026-09-30
- 관련 Step: Step 3

## 배경
Excel 표에 공통 undo(`command-core`의 `History`)를 연결하면서, History를 누가 만들고 갖고 있을지 정해야 한다.

## 선택지
- A안 앱(`apps/web`)이 `new History()`를 만들어 `new GridView(container, sheet, history)`로 넘긴다: 나중에 툴바 undo 버튼이나 표 밖 편집(시트 이름 등)이 같은 기록을 쓸 수 있음 / 쓰는 쪽이 한 줄 더 씀
- B안 GridView가 안에서 만들고 `undo()`/`redo()`만 내보낸다: 쓰는 쪽이 간단 / 표 밖 편집과 기록을 합치려면 나중에 구조를 바꿔야 함

## 결정
A안. `GridView` 생성자가 `(container, sheet, history, options?)`로 바뀐다.
undo 단축키는 키보드 포커스를 가진 GridView가 받는다. 입력 중이 아닐 때 Ctrl/Cmd+Z는 되돌리기, Ctrl/Cmd+Y와 Ctrl/Cmd+Shift+Z는 다시 하기다.
한글 자판에서는 Ctrl+Z의 key가 "ㅋ"로 올 수 있어서, key가 영문자가 아니면 자판 위치(`code`)로 판단한다.

## 결과
- 입력 중에는 Ctrl+Z가 입력창 안의 글자 되돌리기로 동작한다. (브라우저 기본)
- 툴바 undo 버튼을 붙이려면 History에 변경 알림이 필요하다. ADR 0007에서 미뤄 둔 것으로, 버튼을 만드는 때 더한다.
- Docs·PPT도 같은 방식(앱이 History를 넘김)을 따르면 에디터끼리 모양이 같아진다. 그 Step에서 다시 확인한다.
