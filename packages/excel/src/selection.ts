import type { CellAddress, CellRange } from "./address";
import type { Sheet } from "./sheet";

/**
 * 선택 상태. anchor는 활성 셀(이름 상자에 보이는 셀)이고, focus는 Shift나 드래그로 늘린 반대쪽 끝이다.
 * 셀 하나만 선택하면 anchor와 focus가 같다.
 */
export interface Selection {
  readonly anchor: CellAddress;
  readonly focus: CellAddress;
}

export type Direction = "up" | "down" | "left" | "right";

/** 시트 크기. 이동할 때 시트 밖으로 나가지 않게 막는 데 쓴다. */
export type SheetBounds = Pick<Sheet, "rowCount" | "colCount">;

/** 셀 하나만 선택한다. */
export function selectCell(address: CellAddress): Selection {
  return { anchor: address, focus: address };
}

/** 활성 셀은 그대로 두고 반대쪽 끝을 옮겨 범위를 늘리거나 줄인다. */
export function extendTo(selection: Selection, focus: CellAddress): Selection {
  return { anchor: selection.anchor, focus };
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
  return sameAddress(a.anchor, b.anchor) && sameAddress(a.focus, b.focus);
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

const DELTA: Record<Direction, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
