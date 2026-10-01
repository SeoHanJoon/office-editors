import type { CellAddress, CellRange } from "./address";
import { LineSizes } from "./line-sizes";
import type { SheetBounds } from "./selection";

/** 칸 크기 설정 (CSS px). rowHeight·colWidth는 크기를 바꾸지 않은 줄의 기본 크기다. */
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

/** 화면 위치 계산에 쓰는 크기: 머리글 크기와 줄마다의 크기. 행·열 수는 rows.count, cols.count다. */
export interface GridGeometry {
  readonly headerHeight: number;
  readonly headerWidth: number;
  readonly rows: LineSizes;
  readonly cols: LineSizes;
}

/** 모든 줄이 기본 크기인 geometry */
export function uniformGeometry(layout: GridLayout, bounds: SheetBounds): GridGeometry {
  return {
    headerHeight: layout.headerHeight,
    headerWidth: layout.headerWidth,
    rows: new LineSizes(bounds.rowCount, layout.rowHeight),
    cols: new LineSizes(bounds.colCount, layout.colWidth),
  };
}

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
export function contentSize(geometry: GridGeometry): { width: number; height: number } {
  return {
    width: geometry.headerWidth + geometry.cols.total,
    height: geometry.headerHeight + geometry.rows.total,
  };
}

/** 화면에 조금이라도 보이는 셀 범위 */
export function visibleRange(geometry: GridGeometry, viewport: Viewport): CellRange {
  const { rows, cols } = geometry;
  const areaHeight = Math.max(viewport.height - geometry.headerHeight, 1);
  const areaWidth = Math.max(viewport.width - geometry.headerWidth, 1);
  // 끝 위치 바로 앞(경계에 딱 맞으면 그 앞 줄)까지 보인다.
  return {
    top: rows.lineAt(viewport.scrollTop),
    left: cols.lineAt(viewport.scrollLeft),
    bottom: lastLineBefore(rows, viewport.scrollTop + areaHeight),
    right: lastLineBefore(cols, viewport.scrollLeft + areaWidth),
  };
}

/** 셀이 화면(캔버스)에서 차지하는 사각형. 머리글 뒤로 가려질 수도 있다. */
export function cellRect(geometry: GridGeometry, viewport: Viewport, { row, col }: CellAddress): Rect {
  return rangeRect(geometry, viewport, { top: row, left: col, bottom: row, right: col });
}

/** 범위가 화면(캔버스)에서 차지하는 사각형 */
export function rangeRect(geometry: GridGeometry, viewport: Viewport, range: CellRange): Rect {
  const { rows, cols } = geometry;
  const x = cols.offset(range.left);
  const y = rows.offset(range.top);
  return {
    x: geometry.headerWidth + x - viewport.scrollLeft,
    y: geometry.headerHeight + y - viewport.scrollTop,
    width: cols.offset(range.right + 1) - x,
    height: rows.offset(range.bottom + 1) - y,
  };
}

/** 화면 좌표가 머리글 위인지 */
export function isInHeader(geometry: GridGeometry, x: number, y: number): boolean {
  return x < geometry.headerWidth || y < geometry.headerHeight;
}

/** 화면 좌표 아래의 행 머리글(행 번호) 또는 열 머리글(열 이름). 머리글이 아니거나 왼쪽 위 모서리면 null */
export function pointToHeader(
  geometry: GridGeometry,
  viewport: Viewport,
  x: number,
  y: number,
): { axis: "row" | "col"; index: number } | null {
  const inRowHeader = x < geometry.headerWidth;
  const inColHeader = y < geometry.headerHeight;
  if (inRowHeader === inColHeader) return null;
  const cell = pointToCell(geometry, viewport, x, y);
  return inRowHeader ? { axis: "row", index: cell.row } : { axis: "col", index: cell.col };
}

/**
 * 화면 좌표 아래의 셀. 시트 밖이면 가장 가까운 셀로 잘라 넣는다.
 * 드래그가 머리글이나 화면 밖으로 나가면 보이는 범위 바로 바깥 셀이 되어, 그 셀이 보이도록 스크롤하면 표가 따라 움직인다.
 */
export function pointToCell(geometry: GridGeometry, viewport: Viewport, x: number, y: number): CellAddress {
  return {
    row: geometry.rows.lineAt(y - geometry.headerHeight + viewport.scrollTop),
    col: geometry.cols.lineAt(x - geometry.headerWidth + viewport.scrollLeft),
  };
}

/** 셀이 머리글에 가리지 않고 다 보이도록 하는 스크롤 위치. 이미 보이면 그대로 */
export function scrollToReveal(geometry: GridGeometry, viewport: Viewport, { row, col }: CellAddress): ScrollPosition {
  const { rows, cols } = geometry;
  return {
    scrollTop: reveal(rows.offset(row), rows.size(row), viewport.scrollTop, viewport.height - geometry.headerHeight),
    scrollLeft: reveal(cols.offset(col), cols.size(col), viewport.scrollLeft, viewport.width - geometry.headerWidth),
  };
}

/** 맨 위에 걸친 행부터 셀 영역 높이에 다 들어가는 행 수. 적어도 1 */
export function pageRows(geometry: GridGeometry, viewport: Viewport): number {
  const { rows } = geometry;
  const top = rows.lineAt(viewport.scrollTop);
  const limit = rows.offset(top) + viewport.height - geometry.headerHeight;
  let count = 0;
  while (top + count < rows.count && rows.offset(top + count + 1) <= limit) count++;
  return Math.max(1, count);
}

/** end 위치 바로 앞에 걸친 줄. 끝이 줄 경계에 딱 맞으면 그 앞 줄이다. */
function lastLineBefore(sizes: LineSizes, end: number): number {
  const line = sizes.lineAt(end);
  return line > 0 && sizes.offset(line) >= end ? line - 1 : line;
}

/** 한 축에서 [start, start+size)가 [scroll, scroll+area) 안에 들어오게 하는 scroll. 넘치면 앞쪽을 맞춘다. */
function reveal(start: number, size: number, scroll: number, area: number): number {
  if (start < scroll || size > area) return start;
  if (start + size > scroll + area) return start + size - area;
  return scroll;
}
