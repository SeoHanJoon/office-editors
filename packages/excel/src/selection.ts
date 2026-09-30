import type { CellAddress, CellRange } from "./address";
import type { Sheet } from "./sheet";

/**
 * 선택 상태. 범위는 anchor(범위를 늘리기 시작한 셀)와 focus(Shift나 드래그로 늘린 반대쪽 끝)가 만드는 사각형이다.
 * active는 활성 셀(이름 상자에 보이고 값을 입력받는 셀)로, 늘 범위 안에 있다.
 * 보통 active는 anchor와 같고, 범위 안에서 Enter/Tab을 누를 때만 범위 안을 돈다.
 */
export interface Selection {
  readonly anchor: CellAddress;
  readonly focus: CellAddress;
  readonly active: CellAddress;
}

export type Direction = "up" | "down" | "left" | "right";

/** 시트 크기. 이동할 때 시트 밖으로 나가지 않게 막는 데 쓴다. */
export type SheetBounds = Pick<Sheet, "rowCount" | "colCount">;

/** 셀 하나만 선택한다. */
export function selectCell(address: CellAddress): Selection {
  return { anchor: address, focus: address, active: address };
}

/** anchor는 그대로 두고 반대쪽 끝을 옮겨 범위를 늘리거나 줄인다. 활성 셀은 anchor로 돌아간다. */
export function extendTo(selection: Selection, focus: CellAddress): Selection {
  return { anchor: selection.anchor, focus, active: selection.anchor };
}

/** 범위를 선택하고 활성 셀을 왼쪽 위 칸에 둔다. */
export function selectRange(range: CellRange): Selection {
  const topLeft = { row: range.top, col: range.left };
  return { anchor: topLeft, focus: { row: range.bottom, col: range.right }, active: topLeft };
}

/** from행부터 to행까지 행 전체를 고른다. 활성 셀은 from행의 A열이다. (Excel과 같음) */
export function selectRows(from: number, to: number, bounds: SheetBounds): Selection {
  const anchor = { row: from, col: 0 };
  return { anchor, focus: { row: to, col: bounds.colCount - 1 }, active: anchor };
}

/** from열부터 to열까지 열 전체를 고른다. 활성 셀은 from열의 1행이다. (Excel과 같음) */
export function selectColumns(from: number, to: number, bounds: SheetBounds): Selection {
  const anchor = { row: 0, col: from };
  return { anchor, focus: { row: bounds.rowCount - 1, col: to }, active: anchor };
}

/** 시트 전체를 고른다. 활성 셀은 그대로 둔다. (Ctrl/Cmd+A, 왼쪽 위 모서리 클릭. Excel과 같음) */
export function selectAll(selection: Selection, bounds: SheetBounds): Selection {
  return {
    anchor: { row: 0, col: 0 },
    focus: { row: bounds.rowCount - 1, col: bounds.colCount - 1 },
    active: selection.active,
  };
}

/**
 * 고른 범위가 걸친 행 전체("row") 또는 열 전체("col")로 넓힌다. 활성 셀은 그대로 둔다.
 * (Shift+Space는 행, Ctrl+Space는 열. Excel과 같음)
 * anchor·focus의 방향을 지켜서 이어서 Shift+방향키를 누르면 같은 쪽 끝이 움직인다.
 */
export function expandToLines(selection: Selection, axis: "row" | "col", bounds: SheetBounds): Selection {
  const { anchor, focus, active } = selection;
  if (axis === "row") {
    const forward = anchor.col <= focus.col;
    const [anchorCol, focusCol] = forward ? [0, bounds.colCount - 1] : [bounds.colCount - 1, 0];
    return { anchor: { row: anchor.row, col: anchorCol }, focus: { row: focus.row, col: focusCol }, active };
  }
  const forward = anchor.row <= focus.row;
  const [anchorRow, focusRow] = forward ? [0, bounds.rowCount - 1] : [bounds.rowCount - 1, 0];
  return { anchor: { row: anchorRow, col: anchor.col }, focus: { row: focusRow, col: focus.col }, active };
}

/**
 * 범위가 행 전체("row")인지 열 전체("col")인지. 둘 다 아니면 null
 * 시트 전체면 행 전체로 본다.
 */
export function wholeLines(range: CellRange, bounds: SheetBounds): "row" | "col" | null {
  if (range.left === 0 && range.right === bounds.colCount - 1) return "row";
  if (range.top === 0 && range.bottom === bounds.rowCount - 1) return "col";
  return null;
}

/**
 * Shift로 범위를 늘릴 때 화면에 보이게 할 셀. 보통은 focus다.
 * 행 전체를 고른 채 늘리면 가로로는 활성 셀 열에 두고, 열 전체면 세로로는 활성 셀 행에 둔다.
 * (focus가 끝 열·끝 행이라 그대로 보이게 하면 화면이 시트 끝으로 튄다)
 */
export function focusToReveal(selection: Selection, bounds: SheetBounds): CellAddress {
  const range = selectionRange(selection);
  const allCols = range.left === 0 && range.right === bounds.colCount - 1;
  const allRows = range.top === 0 && range.bottom === bounds.rowCount - 1;
  return {
    row: allRows ? selection.active.row : selection.focus.row,
    col: allCols ? selection.active.col : selection.focus.col,
  };
}

/** 선택의 세 주소를 시트 안으로 잘라 넣는다. (행·열을 지워 시트가 줄었을 때) */
export function clampSelection({ anchor, focus, active }: Selection, bounds: SheetBounds): Selection {
  return { anchor: clampAddress(anchor, bounds), focus: clampAddress(focus, bounds), active: clampAddress(active, bounds) };
}

/** 선택이 덮는 사각형 범위 */
export function selectionRange({ anchor, focus }: Selection): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  };
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return sameAddress(a.anchor, b.anchor) && sameAddress(a.focus, b.focus) && sameAddress(a.active, b.active);
}

export function sameAddress(a: CellAddress, b: CellAddress): boolean {
  return a.row === b.row && a.col === b.col;
}

/** 주소를 시트 안으로 잘라 넣는다. */
export function clampAddress({ row, col }: CellAddress, bounds: SheetBounds): CellAddress {
  return {
    row: Math.min(Math.max(row, 0), bounds.rowCount - 1),
    col: Math.min(Math.max(col, 0), bounds.colCount - 1),
  };
}

/** direction 쪽으로 count칸 옮긴다. 시트 끝에서는 멈춘다. */
export function moveBy(
  address: CellAddress,
  direction: Direction,
  bounds: SheetBounds,
  count = 1,
): CellAddress {
  const [dRow, dCol] = DELTA[direction];
  return clampAddress({ row: address.row + dRow * count, col: address.col + dCol * count }, bounds);
}

/**
 * Ctrl+방향키 이동 (Excel과 같음)
 * - 지금 셀과 다음 셀에 모두 값이 있으면: 값이 이어진 구간의 마지막 셀로 간다.
 * - 아니면: 그 방향으로 처음 만나는 값 있는 셀로 간다. 없으면 시트 끝으로 간다.
 */
export function moveToDataEdge(
  address: CellAddress,
  direction: Direction,
  sheet: SheetBounds & Pick<Sheet, "has">,
): CellAddress {
  const next = (from: CellAddress): CellAddress | null => {
    const to = moveBy(from, direction, sheet);
    return sameAddress(to, from) ? null : to;
  };

  let current = address;
  let ahead = next(current);
  if (!ahead) return current;

  if (sheet.has(current) && sheet.has(ahead)) {
    while (ahead && sheet.has(ahead)) {
      current = ahead;
      ahead = next(current);
    }
    return current;
  }

  current = ahead;
  while (!sheet.has(current)) {
    ahead = next(current);
    if (!ahead) break;
    current = ahead;
  }
  return current;
}

/**
 * 범위 안에서 활성 셀을 한 칸 옮긴다. 범위는 그대로 둔다. (범위를 고른 채 Enter/Tab을 누를 때, Excel과 같음)
 * - "down"(Enter): 아래로, 열 끝이면 다음 열 맨 위로 / "up"(Shift+Enter): 그 반대
 * - "right"(Tab): 오른쪽으로, 행 끝이면 다음 행 맨 왼쪽으로 / "left"(Shift+Tab): 그 반대
 * 범위의 마지막 칸 다음은 첫 칸이다.
 */
export function cycleInRange(selection: Selection, direction: Direction): Selection {
  const { top, left, bottom, right } = selectionRange(selection);
  const rows = bottom - top + 1;
  const cols = right - left + 1;
  const { row, col } = selection.active;
  // 범위 칸에 차례 번호를 붙이고 한 칸 앞뒤로 옮긴다. Enter는 열 먼저, Tab은 행 먼저 센다.
  const byColumn = direction === "up" || direction === "down";
  const step = direction === "down" || direction === "right" ? 1 : -1;
  const total = rows * cols;
  const index = byColumn ? (col - left) * rows + (row - top) : (row - top) * cols + (col - left);
  const next = (index + step + total) % total;
  const active = byColumn
    ? { row: top + (next % rows), col: left + Math.floor(next / rows) }
    : { row: top + Math.floor(next / cols), col: left + (next % cols) };
  return { ...selection, active };
}

/** 선택이 셀 하나뿐인지 */
export function isSingleCell({ anchor, focus }: Selection): boolean {
  return sameAddress(anchor, focus);
}

const DELTA: Record<Direction, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
