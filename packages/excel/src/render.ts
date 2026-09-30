import { columnName, type CellRange } from "./address";
import type { FormulaEngine } from "./formula-engine";
import { FormulaError, formatValue, type CellValue } from "./formula-value";
import { cellRect, visibleRange, type GridLayout, type Rect, type Viewport } from "./layout";
import { selectionRange, type Selection } from "./selection";
import type { Sheet } from "./sheet";

export interface RenderState {
  readonly sheet: Sheet;
  /** 셀에 보여줄 계산값 */
  readonly engine: FormulaEngine;
  readonly selection: Selection;
  readonly layout: GridLayout;
  readonly viewport: Viewport;
}

/** 셀 글자 글꼴. 셀 입력창도 같은 글꼴을 쓴다. */
export const CELL_FONT = '13px -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';

/** 셀 안쪽 글자 여백 (px) */
export const CELL_PADDING = 4;

/** Excel과 비슷한 색 */
export const THEME = {
  background: "#ffffff",
  gridLine: "#e1e1e1",
  text: "#000000",
  font: CELL_FONT,
  headerBackground: "#f5f5f5",
  headerSelectedBackground: "#d3f0e0",
  headerLine: "#c8c8c8",
  headerText: "#444444",
  headerSelectedText: "#0e5c2f",
  selectionBorder: "#107c41",
  selectionFill: "rgba(16, 124, 65, 0.12)",
  problemText: "#a4262c",
  problemBackground: "#fff8f8",
  problemBorder: "#e0b4b4",
};

/**
 * 화면에 보이는 칸만 그린다. 좌표는 CSS px 기준이다.
 * (고해상도 화면 배율은 부르는 쪽이 ctx.setTransform으로 맞춘다)
 */
export function drawGrid(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { layout, viewport } = state;
  ctx.save();
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  // 셀 영역: 머리글 위로 넘치지 않게 잘라서 그린다.
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.headerWidth, layout.headerHeight, viewport.width, viewport.height);
  ctx.clip();
  drawSelectionFill(ctx, state);
  drawGridLines(ctx, state);
  drawCellText(ctx, state);
  drawSelectionBorder(ctx, state);
  ctx.restore();

  drawHeaders(ctx, state);
  ctx.restore();
}

/** 값 종류에 따른 글자 정렬. 숫자는 오른쪽, 글자는 왼쪽, 논리값과 에러는 가운데다. (Excel과 같음) */
export function valueAlign(value: CellValue): "left" | "center" | "right" {
  if (typeof value === "number") return "right";
  if (typeof value === "boolean" || value instanceof FormulaError) return "center";
  return "left";
}

function drawSelectionFill(ctx: CanvasRenderingContext2D, { layout, viewport, selection }: RenderState): void {
  const range = selectionRange(selection);
  if (range.top === range.bottom && range.left === range.right) return;
  // 범위는 옅게 칠하고 활성 셀만 흰색으로 둔다. (Excel과 같음)
  const area = rangeRect(layout, viewport, range);
  ctx.fillStyle = THEME.selectionFill;
  ctx.fillRect(area.x, area.y, area.width, area.height);
  const active = cellRect(layout, viewport, selection.active);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(active.x, active.y, active.width, active.height);
}

function drawGridLines(ctx: CanvasRenderingContext2D, { sheet, layout, viewport }: RenderState): void {
  const range = visibleRange(layout, viewport, sheet);
  const first = cellRect(layout, viewport, { row: range.top, col: range.left });
  const last = cellRect(layout, viewport, { row: range.bottom, col: range.right });
  const right = last.x + last.width;
  const bottom = last.y + last.height;

  ctx.beginPath();
  for (let col = range.left; col <= range.right + 1; col++) {
    const x = crisp(first.x + (col - range.left) * layout.colWidth);
    ctx.moveTo(x, first.y);
    ctx.lineTo(x, bottom);
  }
  for (let row = range.top; row <= range.bottom + 1; row++) {
    const y = crisp(first.y + (row - range.top) * layout.rowHeight);
    ctx.moveTo(first.x, y);
    ctx.lineTo(right, y);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.gridLine;
  ctx.stroke();
}

function drawCellText(ctx: CanvasRenderingContext2D, { sheet, engine, layout, viewport }: RenderState): void {
  const range = visibleRange(layout, viewport, sheet);
  ctx.font = THEME.font;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = "middle";
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      const value = engine.getValue({ row, col });
      const text = formatValue(value);
      if (text === "") continue;
      const rect = cellRect(layout, viewport, { row, col });
      const align = valueAlign(value);
      const x =
        align === "left" ? rect.x + CELL_PADDING : align === "right" ? rect.x + rect.width - CELL_PADDING : rect.x + rect.width / 2;
      // 글자가 칸을 넘치면 잘라낸다. (옆 칸으로 넘쳐 보이게 하는 건 나중에)
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      ctx.textAlign = align;
      ctx.fillText(text, x, rect.y + rect.height / 2);
      ctx.restore();
    }
  }
}

function drawSelectionBorder(ctx: CanvasRenderingContext2D, { layout, viewport, selection }: RenderState): void {
  const area = rangeRect(layout, viewport, selectionRange(selection));
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.selectionBorder;
  ctx.strokeRect(Math.round(area.x), Math.round(area.y), area.width, area.height);
}

function drawHeaders(ctx: CanvasRenderingContext2D, { sheet, layout, viewport, selection }: RenderState): void {
  const range = visibleRange(layout, viewport, sheet);
  const selected = selectionRange(selection);
  const { headerWidth, headerHeight } = layout;

  ctx.fillStyle = THEME.headerBackground;
  ctx.fillRect(0, 0, viewport.width, headerHeight);
  ctx.fillRect(0, 0, headerWidth, viewport.height);

  ctx.font = THEME.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.headerLine;

  for (let col = range.left; col <= range.right; col++) {
    const { x, width } = cellRect(layout, viewport, { row: range.top, col });
    const isSelected = col >= selected.left && col <= selected.right;
    drawHeaderCell(ctx, { x, y: 0, width, height: headerHeight }, columnName(col), isSelected, "bottom");
  }
  for (let row = range.top; row <= range.bottom; row++) {
    const { y, height } = cellRect(layout, viewport, { row, col: range.left });
    const isSelected = row >= selected.top && row <= selected.bottom;
    drawHeaderCell(ctx, { x: 0, y, width: headerWidth, height }, String(row + 1), isSelected, "right");
  }

  // 왼쪽 위 모서리 칸은 머리글이 겹치지 않도록 마지막에 덮는다.
  ctx.fillStyle = THEME.headerBackground;
  ctx.fillRect(0, 0, headerWidth, headerHeight);
  ctx.beginPath();
  ctx.moveTo(0, crisp(headerHeight));
  ctx.lineTo(headerWidth, crisp(headerHeight));
  ctx.moveTo(crisp(headerWidth), 0);
  ctx.lineTo(crisp(headerWidth), headerHeight);
  ctx.stroke();
}

function drawHeaderCell(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  isSelected: boolean,
  /** 셀 쪽을 향한 변. 선택된 머리글은 이 변에 선택 색 줄을 긋는다. */
  edge: "bottom" | "right",
): void {
  if (isSelected) {
    ctx.fillStyle = THEME.headerSelectedBackground;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.beginPath();
  ctx.moveTo(crisp(rect.x + rect.width), rect.y);
  ctx.lineTo(crisp(rect.x + rect.width), rect.y + rect.height);
  ctx.lineTo(rect.x, crisp(rect.y + rect.height));
  ctx.strokeStyle = THEME.headerLine;
  ctx.stroke();

  if (isSelected) {
    ctx.fillStyle = THEME.selectionBorder;
    if (edge === "bottom") ctx.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2);
    else ctx.fillRect(rect.x + rect.width - 2, rect.y, 2, rect.height);
  }

  ctx.fillStyle = isSelected ? THEME.headerSelectedText : THEME.headerText;
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2);
}

function rangeRect(layout: GridLayout, viewport: Viewport, range: CellRange): Rect {
  const start = cellRect(layout, viewport, { row: range.top, col: range.left });
  return {
    x: start.x,
    y: start.y,
    width: (range.right - range.left + 1) * layout.colWidth,
    height: (range.bottom - range.top + 1) * layout.rowHeight,
  };
}

/** 1px 선이 두 픽셀에 번지지 않도록 픽셀 경계 바로 앞 가운데에 맞춘다. */
function crisp(position: number): number {
  return Math.round(position) - 0.5;
}
