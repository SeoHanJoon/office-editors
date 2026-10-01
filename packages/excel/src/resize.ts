import type { CellRange } from "./address";
import { isFormula } from "./formula-value";
import type { GridGeometry, Viewport } from "./layout";
import type { LineSizes } from "./line-sizes";
import type { SheetBounds } from "./selection";
import type { Axis } from "./sheet";

/** 경계선에서 이 거리(px) 안이면 끌어서 크기를 바꿀 수 있다. */
export const RESIZE_HIT = 3;

/** 끌어서 줄일 수 있는 가장 작은 줄 크기 (px). 0으로 줄여 숨기는 기능은 없다. (ADR 0031) */
export const MIN_LINE_SIZE = 4;

/** 끌어서 크기를 바꿀 줄. index 줄의 오른쪽(열)·아래쪽(행) 경계선이다. */
export interface ResizeHandle {
  readonly axis: Axis;
  readonly index: number;
}

/**
 * 화면 좌표가 머리글의 경계선 위면 그 경계선의 앞 줄. 아니면 null
 * 열 머리글에서는 열 사이 세로선, 행 머리글에서는 행 사이 가로선이다. (Excel과 같음)
 */
export function pointToResizeHandle(geometry: GridGeometry, viewport: Viewport, x: number, y: number): ResizeHandle | null {
  const inRowHeader = x < geometry.headerWidth;
  const inColHeader = y < geometry.headerHeight;
  if (inRowHeader === inColHeader) return null;
  if (inColHeader) {
    const index = nearBorder(geometry.cols, x - geometry.headerWidth + viewport.scrollLeft, viewport.scrollLeft);
    return index === null ? null : { axis: "col", index };
  }
  const index = nearBorder(geometry.rows, y - geometry.headerHeight + viewport.scrollTop, viewport.scrollTop);
  return index === null ? null : { axis: "row", index };
}

/** position이 어떤 줄의 끝 경계선 가까이면 그 줄. 머리글에 가려진 경계선(scroll 이하)은 잡지 않는다. */
function nearBorder(sizes: LineSizes, position: number, scroll: number): number | null {
  const line = sizes.lineAt(position);
  const start = sizes.offset(line);
  const end = start + sizes.size(line);
  if (Math.abs(end - position) <= RESIZE_HIT) return line;
  if (position - start <= RESIZE_HIT && line > 0 && start > scroll) return line - 1;
  return null;
}

/** 경계선을 끌어 함께 바꿀 줄 [first, last]. 누른 줄이 고른 줄 전체 안이면 고른 줄 모두, 아니면 그 줄 하나다. (Excel과 같음) */
export function resizeLines(handle: ResizeHandle, range: CellRange, bounds: SheetBounds): { first: number; last: number } {
  const { axis, index } = handle;
  const whole =
    axis === "col" ? range.top === 0 && range.bottom === bounds.rowCount - 1 : range.left === 0 && range.right === bounds.colCount - 1;
  const first = axis === "col" ? range.left : range.top;
  const last = axis === "col" ? range.right : range.bottom;
  return whole && index >= first && index <= last ? { first, last } : { first: index, last: index };
}

/** 처음 크기에서 delta만큼 끈 크기. 정수 px로 맞추고 가장 작은 크기 아래로는 줄지 않는다. */
export function draggedSize(startSize: number, delta: number): number {
  return Math.max(MIN_LINE_SIZE, Math.round(startSize + delta));
}

/**
 * 셀에 그릴 글자의 줄. 입력한 글자(수식이 아닌 값)의 줄바꿈만 줄을 나눈다.
 * 수식 결과에 든 줄바꿈은 나누지 않는다. ("자동 줄바꿈" 서식이 없는 Excel과 같음, ADR 0031)
 */
export function textLines(input: string, shown: string): string[] {
  return isFormula(input) || !shown.includes("\n") ? [shown] : shown.split(/\r\n|\r|\n/);
}

/** 열 너비 자동 맞춤에 쓰는 셀 읽기. 행마다 [입력한 글자, 보이는 글자]. 빈 셀은 null */
export type ColumnCells = (row: number) => readonly [input: string, shown: string] | null;

/**
 * 열의 모든 행(rowCount개)에 보이는 글자 중 가장 넓은 줄에 맞춘 너비. 칸이 모두 비어 있으면 null (기본 너비로 돌린다)
 * measure는 글자 너비(px)를 잰다. 같은 글자는 한 번만 잰다.
 */
export function fitColumnWidth(
  rowCount: number,
  cells: ColumnCells,
  measure: (text: string) => number,
  padding: number,
): number | null {
  const widths = new Map<string, number>();
  let widest = -1;
  for (let row = 0; row < rowCount; row++) {
    const cell = cells(row);
    if (!cell) continue;
    for (const line of textLines(cell[0], cell[1])) {
      let width = widths.get(line);
      if (width === undefined) {
        width = measure(line);
        widths.set(line, width);
      }
      if (width > widest) widest = width;
    }
  }
  return widest < 0 ? null : Math.max(MIN_LINE_SIZE, Math.ceil(widest + padding * 2));
}
