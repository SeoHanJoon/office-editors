/** 메뉴 항목 하나. 고르면 value를 돌려준다. */
export interface ContextMenuItem<T> {
  readonly label: string;
  /** 항목 오른쪽에 흐리게 보여줄 단축키 ("Ctrl+C", "⌘C") */
  readonly shortcut?: string;
  /** 할 수 없는 항목. 흐리게 보이고 고를 수 없다. */
  readonly disabled?: boolean;
  readonly value: T;
}

/** 메뉴 한 줄: 항목 또는 구분선 */
export type ContextMenuEntry<T> = ContextMenuItem<T> | "separator";
