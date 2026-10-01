# 0038. Docs 편집기 모양: React 없는 DocsEditor 클래스와 기본 서식

- 상태: 채택
- 날짜: 2026-10-01
- 관련 Step: Step 11

## 배경
`packages/docs`가 앱에 무엇을 내보낼지, 이번 Step에 어떤 서식을 넣을지 정해야 한다.
Excel은 React 없는 `GridView` 클래스를 내보내고 툴바는 `apps/web`이 `@office/ui/react` 부품으로 조립한다. (ADR 0009, 0035)

## 선택지
- 공개 모양
  - A안 React 없는 클래스 `new DocsEditor(container, history)` + 서식 메서드·변경 알림: Excel과 구조가 같다 / `@tiptap/react`의 `useEditor` 같은 편의를 못 쓴다
  - B안 `@tiptap/react` 컴포넌트 `<DocsEditor history={...} />`: React 코드가 짧다 / `docs` 패키지가 React에 의존하고 Excel과 구조가 달라진다
- 서식 범위
  - A안 기본: 굵게·기울임·밑줄·취소선, 본문/제목 1~3, 글머리·번호 목록, 인용 (모두 StarterKit 안)
  - B안 A + 글자색·형광펜·정렬·링크 (확장 4개 추가)
  - C안 B + 표·이미지: 작업량이 크게 늘어 "가볍게" 방침과 멀다

## 결정
둘 다 A안. (사용자 선택)
- 의존: `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@office/command-core`
- `DocsEditor`: `activeFormat`, `toggleMark`, `setBlock`, `toggleBulletList`, `toggleOrderedList`, `toggleBlockquote`, `undo`, `redo`, `onChange`, `focus`, `getHTML`, `destroy`
- StarterKit이 기본으로 켜는 것 중 범위 밖인 코드·코드 블록·가로줄·링크는 끈다. 마크다운식 자동 변환(`# `→제목, `- `→목록, `**굵게**`)은 범위 안 서식이라 그대로 둔다.

## 결과
- `docs` 패키지는 React를 모른다. 툴바(`apps/web/app/docs`)를 바꿔도 편집기 코드는 그대로다.
- 툴바 버튼은 Excel과 같은 `@office/ui/react` 부품을 쓰고 포커스를 가져가지 않는다. 실행 취소·글자 아이콘은 `apps/web/app/excel/icons.tsx`의 것을 함께 쓴다.
- 문서 끝이 제목·목록·인용이면 Tiptap이 빈 문단을 덧붙인다. (그 아래로 커서를 옮길 수 있게, StarterKit의 trailingNode) 이 변경도 그 편집과 함께 undo된다.
- 브라우저 테스트용 `window.__docs.html()`을 개발 서버에서만 노출한다. Docs는 DOM이라 화면도 직접 확인한다.
- 이번에 넣지 않은 것 (나중 후보): 저장·불러오기, 글자색·정렬·링크, 표·이미지
