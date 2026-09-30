# 0030. 전체 선택과 줄 선택 단축키

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 7

## 배경
Excel은 Shift+Space로 행, Ctrl+Space로 열, Ctrl+A로 시트를 고른다.
- Mac에서 Ctrl+Space를 한/영 전환에 쓰면 OS가 먼저 가져가서 브라우저에 오지 않는다. Excel for Mac·구글 시트도 같은 문제가 있다.
- Excel의 Ctrl+A는 활성 셀이 데이터 안이면 먼저 이어진 데이터 영역을, 한 번 더 누르면 시트 전체를 고른다.

## 선택지
- Mac Ctrl+Space
  - A안 Excel처럼 두고 적어 두기: 겹치는 사람은 열 머리글 클릭이나 메뉴를 쓴다. / 일부 Mac 사용자는 단축키를 못 쓴다.
  - B안 Mac에 대체 키 추가: ⌥Space 또는 ⌘⇧Space. / Excel에 없는 키다. ⌘⇧Space는 Excel for Mac에서 시트 전체 선택이라 헷갈린다.
- Ctrl/Cmd+A
  - A안 늘 시트 전체: 구글 시트와 같다. / Excel과 다르다.
  - B안 Excel처럼 데이터 영역 먼저: Excel과 같다. / 영역 찾는 코드가 늘고 10만 행에서 속도도 봐야 한다.

## 결정
Ctrl+Space는 B안 ⌥Space, Ctrl/Cmd+A는 A안이다. (사용자 선택)
- 입력 중이 아닐 때만 동작한다. 입력 중에는 입력창의 글자 전체 선택·공백 입력이다.
- Shift+Space: 고른 범위가 걸친 행 전체 / Ctrl+Space, ⌥Space: 걸친 열 전체 / Ctrl·Cmd+A, 왼쪽 위 모서리 클릭: 시트 전체.
  - 활성 셀은 그대로 둔다. (Excel과 같음)
- ⌥Space는 Mac이 아니어도 받는다. Windows에서는 Alt+Space를 OS가 창 메뉴로 먼저 가져가서 오지 않는다.
- 한글 자판에서 Ctrl+A의 key가 "ㅁ"로 와도 자판 위치(`code`)로 판단한다. (ADR 0016과 같은 방식)

## 결과
- 한/영을 Ctrl+Space로 바꾸는 Mac에서는 ⌥Space나 열 머리글 클릭으로 열을 고른다.
- 데이터가 모서리까지 차 있지 않은 시트에서는 Excel보다 넓게 고른다. 데이터 영역 선택이 필요해지면 고친다.
