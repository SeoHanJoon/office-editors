/**
 * 편집 한 번. 하는 법(execute)과 되돌리는 법(undo)을 함께 적는다.
 * command-core는 편집 대상(셀, 문서, 슬라이드)을 모른다. 실제로 무엇을 바꾸는지는 각 에디터가 여기에 적는다.
 */
export interface Command {
  /** 편집을 적용한다. redo할 때도 다시 불린다. 에러를 던지면 아무것도 바꾸지 않았다고 본다. */
  execute(): void;
  /** execute가 바꾼 것을 execute 전 상태로 되돌린다. */
  undo(): void;
  /**
   * 값이 같은 편집이 짧은 간격으로 이어지면 undo 한 번에 함께 되돌린다. (예: 글자 입력은 "typing")
   * 없으면 합치지 않는다.
   */
  readonly mergeKey?: string;
}
