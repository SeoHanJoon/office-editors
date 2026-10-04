import { StarterKit } from "@tiptap/starter-kit";

/** 문서 편집기가 쓰는 Tiptap 기본 확장. 에디터와 테스트가 같은 문서 구조(schema)를 쓰도록 한 곳에 둔다. */
export function baseExtensions() {
  return [
    StarterKit.configure({
      // undo는 공통 History가 맡는다. (ADR 0037)
      undoRedo: false,
      // 이번 Step의 서식 범위 밖이라 끈다. (ADR 0038)
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
    }),
  ];
}
