import type { CellAddress, CellRange } from "./address";
import { clampAddress, type SheetBounds } from "./selection";

/** 칸 크기 (CSS px). 이번 Step은 모든 행·열이 같은 크기다. */
export interface GridLayout {
  readonly rowHeight: number;
  readonly colWidth: number;
  /** 위쪽 열 머리글(A, B, C…)의 높이 */
  readonly headerHeight: number;
  /** 왼쪽 행 머리글(1, 2, 3…)의 너비 */
  readonly headerWidth: number;
}

/** Excel 기본 크기 (행 높이 20px, 열 너비 64px) */
export const DEFAULT_LAYOUT: GridLayout = {
  rowHeight: 20,
  colWidth: 64,
  headerHeight: 20,
  headerWidth: 46,
};

/** 표를 보는 창. width·height는 머리글을 포함한 화면 크기 (CSS px) */
export interface Viewport {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScrollPosition {
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

/** 머리글을 포함한 표 전체 크기. 스크롤할 수 있는 넓이가 된다. */
export function contentSize(layout: GridLayout, bounds: SheetBounds): { width: number; height: number } {
  return {
    width: layout.headerWidth + bounds.colCount * layout.colWidth,
    height: layout.headerHeight + bounds.rowCount * layout.rowHeight,
  };
}

/** 화면에 조금이라도 보이는 셀 범위 */
export function visibleRange(layout: GridLayout, viewport: Viewport, bounds: SheetBounds): CellRange {
  const top = clampAddress({ row: Math.floor(viewport.scrollTop / layout.rowHeight), col: 0 }, bounds).row;
  const left = clampAddress({ row: 0, col: Math.floor(viewport.scrollLeft / layout.colWidth) }, bounds).col;
  const areaHeight = Math.max(viewport.height - layout.headerHeight, 1);
  const areaWidth = Math.max(viewport.width - layout.headerWidth, 1);
  const end = clampAddress(
    {
      row: Math.ceil((viewport.scrollTop + areaHeight) / layout.rowHeight) - 1,
      col: Math.ceil((viewport.scrollLeft + areaWidth) / layout.colWidth) - 1,
    },
    bounds,
  );
  return { top, left, bottom: end.row, right: end.col };
}

/** 셀이 화면(캔버스)에서 차지하는 사각형. 머리글 뒤로 가려질 수도 있다. */
export function cellRect(layout: GridLayout, viewport: Viewport, { row, col }: CellAddress): Rect {
  return {
    x: layout.headerWidth + col * layout.colWidth - viewport.scrollLeft,
    y: layout.headerHeight + row * layout.rowHeight - viewport.scrollTop,
    width: layout.colWidth,
    height: layout.rowHeight,
  };
}

/** 화면 좌표가 머리글 위인지 */
export function isInHeader(layout: GridLayout, x: number, y: number): boolean {
  return x < layout.headerWidth || y < layout.headerHeight;
}

/** 화면 좌표 아래의 행 머리글(행 번호) 또는 열 머리글(열 이름). 머리글이 아니거나 왼쪽 위 모서리면 null */
export function pointToHeader(
  layout: GridLayout,
  viewport: Viewport,
  bounds: SheetBounds,
  x: number,
  y: number,
): { axis: "row" | "col"; index: number } | null {
  const inRowHeader = x < layout.headerWidth;
  const inColHeader = y < layout.headerHeight;
  if (inRowHeader === inColHeader) return null;
  const cell = pointToCell(layout, viewport, bounds, x, y);
  return inRowHeader ? { axis: "row", index: cell.row } : { axis: "col", index: cell.col };
}

/**
 * 화면 좌표 아래의 셀. 시트 밖이면 가장 가까운 셀로 잘라 넣는다.
 * 드래그가 머리글이나 화면 밖으로 나가면 보이는 범위 바로 바깥 셀이 되어, 그 셀이 보이도록 스크롤하면 표가 따라 움직인다.
 */
export function pointToCell(
  layout: GridLayout,
  viewport: Viewport,
  bounds: SheetBounds,
  x: number,
  y: number,
): CellAddress {
  return clampAddress(
    {
      row: Math.floor((y - layout.headerHeight + viewport.scrollTop) / layout.rowHeight),
      col: Math.floor((x - layout.headerWidth + viewport.scrollLeft) / layout.colWidth),
    },
    bounds,
  );
}

/** 셀이 머리글에 가리지 않고 다 보이도록 하는 스크롤 위치. 이미 보이면 그대로 */
export function scrollToReveal(layout: GridLayout, viewport: Viewport, { row, col }: CellAddress): ScrollPosition {
  return {
    scrollTop: reveal(
      row * layout.rowHeight,
      layout.rowHeight,
      viewport.scrollTop,
      viewport.height - layout.headerHeight,
    ),
    scrollLeft: reveal(
      col * layout.colWidth,
      layout.colWidth,
      viewport.scrollLeft,
      viewport.width - layout.headerWidth,
    ),
  };
}

/** 한 화면에 다 보이는 행 수. 적어도 1 */
export function pageRows(layout: GridLayout, viewport: Viewport): number {
  return Math.max(1, Math.floor((viewport.height - layout.headerHeight) / layout.rowHeight));
}

/** 한 축에서 [start, start+size)가 [scroll, scroll+area) 안에 들어오게 하는 scroll. 넘치면 앞쪽을 맞춘다. */
function reveal(start: number, size: number, scroll: number, area: number): number {
  if (start < scroll || size > area) return start;
  if (start + size > scroll + area) return start + size - area;
  return scroll;
}
