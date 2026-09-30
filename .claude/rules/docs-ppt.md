---
paths:
  - "packages/docs/**"
  - "packages/ppt/**"
---

# Docs · PPT 패키지 규칙 (가볍게 구현)

- 목표는 README Step 11·12의 완료 기준까지다. 그 이상 기능은 만들지 않고 제안만 한다.
- 검증된 라이브러리를 적극적으로 쓴다. (Docs는 Tiptap) 직접 구현보다 라이브러리 설정으로 해결되는지 먼저 확인한다.
- 편집 동작은 `command-core`에 연결해서 undo/redo가 Excel과 같은 방식으로 동작하게 한다.
- 테스트는 핵심 흐름(입력, 서식, undo) 위주로 적게 쓴다.
