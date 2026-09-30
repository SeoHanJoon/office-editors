import type { CellAddress } from "./address";
import {
  clampAddress,
  extendTo,
  moveBy,
  moveToDataEdge,
  selectCell,
  type Direction,
  type Selection,
} from "./selection";
import type { Sheet } from "./sheet";

/** 키보드 이벤트에서 이동에 필요한 부분. (KeyboardEvent를 그대로 넘겨도 된다) */
export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

export interface NavigateContext {
  readonly sheet: Pick<Sheet, "rowCount" | "colCount" | "has">;
  /** 한 화면에 보이는 행 수. PageUp/PageDown이 이만큼 옮긴다. */
  readonly pageRows: number;
}

export interface NavigateResult {
  readonly selection: Selection;
  /** 화면을 이만큼 행 단위로 함께 스크롤한다. (PageUp은 음수) */
  readonly scrollRows: number;
}

/**
 * 키 입력에 따라 선택을 옮긴다. 이동 키가 아니면 null (화면은 그 키를 막지 않는다)
 * Ctrl 대신 Cmd(macOS)를 눌러도 같다. Shift를 함께 누르면 활성 셀은 두고 범위를 늘린다.
 *
 * - 방향키: 한 칸 / Ctrl+방향키: 데이터 끝
 * - Tab, Shift+Tab: 오른쪽, 왼쪽 / Enter, Shift+Enter: 아래, 위 (범위는 풀린다)
 * - Home: 그 행의 A열 / Ctrl+Home: A1
 * - PageDown, PageUp: 한 화면만큼 아래, 위
 */
export function navigate(
  selection: Selection,
  input: KeyInput,
  { sheet, pageRows }: NavigateContext,
): NavigateResult | null {
  if (input.altKey) return null;
  const mod = input.ctrlKey || input.metaKey;
  const { shiftKey } = input;
  // Shift로 범위를 늘릴 때는 반대쪽 끝을, 아니면 활성 셀을 기준으로 옮긴다.
  const from = shiftKey ? selection.focus : selection.anchor;
  const result = (to: CellAddress, scrollRows = 0): NavigateResult => ({
    selection: shiftKey ? extendTo(selection, to) : selectCell(to),
    scrollRows,
  });

  const direction = ARROWS[input.key];
  if (direction) {
    return result(mod ? moveToDataEdge(from, direction, sheet) : moveBy(from, direction, sheet));
  }

  switch (input.key) {
    case "Tab":
    case "Enter": {
      if (mod) return null;
      const forward = input.key === "Tab" ? "right" : "down";
      const backward = input.key === "Tab" ? "left" : "up";
      const to = moveBy(selection.anchor, shiftKey ? backward : forward, sheet);
      return { selection: selectCell(to), scrollRows: 0 };
    }
    case "Home":
      return result(mod ? { row: 0, col: 0 } : { row: from.row, col: 0 });
    case "PageDown":
    case "PageUp": {
      if (mod) return null;
      const rows = input.key === "PageDown" ? pageRows : -pageRows;
      return result(clampAddress({ row: from.row + rows, col: from.col }, sheet), rows);
    }
    default:
      return null;
  }
}

const ARROWS: Partial<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
