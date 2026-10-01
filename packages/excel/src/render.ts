import { columnName, type CellRange } from "./address";
import type { FormulaEngine } from "./formula-engine";
import { FormulaError, formatValue, type CellValue } from "./formula-value";
import { cellRect, rangeRect, visibleRange, type GridGeometry, type Rect, type Viewport } from "./layout";
import { selectionRange, type Selection } from "./selection";
import type { Axis, Sheet } from "./sheet";

export interface RenderState {
  readonly sheet: Sheet;
  /** 셀에 보여줄 계산값 */
  readonly engine: FormulaEngine;
  readonly selection: Selection;
  /** 복사하거나 잘라낸 범위. 점선 테두리를 그린다. 없으면 null */
  readonly copied?: CellRange | null;
  /** 경계선을 끄는 중이면 새 경계선 자리. position은 캔버스 좌표(열은 x, 행은 y)다. 없으면 null */
  readonly guide?: { readonly axis: Axis; readonly position: number } | null;
  /** 머리글과 줄마다의 크기. 행·열 수가 sheet와 같아야 한다. */
  readonly geometry: GridGeometry;
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
  /** 계산 중이라 아직 값을 모르는 수식 칸의 "…" */
  pendingText: "#a0a0a0",
  problemText: "#a4262c",
  problemBackground: "#fff8f8",
  problemBorder: "#e0b4b4",
  /** 경계선을 끄는 중에 보이는 새 경계선 */
  resizeGuide: "#444444",
};

/**
 * 화면에 보이는 칸만 그린다. 좌표는 CSS px 기준이다.
 * (고해상도 화면 배율은 부르는 쪽이 ctx.setTransform으로 맞춘다)
 */
export function drawGrid(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { geometry, viewport } = state;
  ctx.save();
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const lines = visibleLines(geometry, viewport);
  // 셀 영역: 머리글 위로 넘치지 않게 잘라서 그린다.
  ctx.save();
  ctx.beginPath();
  ctx.rect(geometry.headerWidth, geometry.headerHeight, viewport.width, viewport.height);
  ctx.clip();
  drawSelectionFill(ctx, state);
  drawGridLines(ctx, lines);
  drawCellText(ctx, state, lines);
  drawSelectionBorder(ctx, state);
  ctx.restore();

  drawHeaders(ctx, state, lines);
  drawGuide(ctx, state);
  ctx.restore();
}

/** 값 종류에 따른 글자 정렬. 숫자는 오른쪽, 글자는 왼쪽, 논리값과 에러는 가운데다. (Excel과 같음) */
export function valueAlign(value: CellValue): "left" | "center" | "right" {
  if (typeof value === "number") return "right";
  if (typeof value === "boolean" || value instanceof FormulaError) return "center";
  return "left";
}

/** 보이는 범위와, 그 줄들의 화면 경계 위치. xs[i]는 range.left + i 열의 왼쪽 끝이고 마지막 값은 오른쪽 끝이다. (ys도 같다) */
interface VisibleLines {
  readonly range: CellRange;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** 보이는 줄의 경계 위치를 한 번에 구해 둔다. 칸마다 위치를 찾지 않게 한다. */
function visibleLines(geometry: GridGeometry, viewport: Viewport): VisibleLines {
  const range = visibleRange(geometry, viewport);
  const xs = [geometry.headerWidth + geometry.cols.offset(range.left) - viewport.scrollLeft];
  for (let col = range.left; col <= range.right; col++) xs.push(xs[xs.length - 1]! + geometry.cols.size(col));
  const ys = [geometry.headerHeight + geometry.rows.offset(range.top) - viewport.scrollTop];
  for (let row = range.top; row <= range.bottom; row++) ys.push(ys[ys.length - 1]! + geometry.rows.size(row));
  return { range, xs, ys };
}

function drawSelectionFill(ctx: CanvasRenderingContext2D, { geometry, viewport, selection }: RenderState): void {
  const range = selectionRange(selection);
  if (range.top === range.bottom && range.left === range.right) return;
  // 범위는 옅게 칠하고 활성 셀만 흰색으로 둔다. (Excel과 같음)
  const area = rangeRect(geometry, viewport, range);
  ctx.fillStyle = THEME.selectionFill;
  ctx.fillRect(area.x, area.y, area.width, area.height);
  const active = cellRect(geometry, viewport, selection.active);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(active.x, active.y, active.width, active.height);
}

function drawGridLines(ctx: CanvasRenderingContext2D, { xs, ys }: VisibleLines): void {
  const left = xs[0]!;
  const right = xs[xs.length - 1]!;
  const top = ys[0]!;
  const bottom = ys[ys.length - 1]!;
  ctx.beginPath();
  for (const position of xs) {
    const x = crisp(position);
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (const position of ys) {
    const y = crisp(position);
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.gridLine;
  ctx.stroke();
}

function drawCellText(ctx: CanvasRenderingContext2D, { engine }: RenderState, { range, xs, ys }: VisibleLines): void {
  ctx.font = THEME.font;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = "middle";
  for (let row = range.top; row <= range.bottom; row++) {
    const y = ys[row - range.top]!;
    const height = ys[row - range.top + 1]! - y;
    for (let col = range.left; col <= range.right; col++) {
      const x = xs[col - range.left]!;
      const width = xs[col - range.left + 1]! - x;
      if (engine.isPending({ row, col })) {
        drawPending(ctx, { x, y, width, height });
        continue;
      }
      const value = engine.getValue({ row, col });
      const text = formatValue(value);
      if (text === "") continue;
      const align = valueAlign(value);
      const textX = align === "left" ? x + CELL_PADDING : align === "right" ? x + width - CELL_PADDING : x + width / 2;
      // 글자가 칸을 넘치면 잘라낸다. (옆 칸으로 넘쳐 보이게 하는 건 나중에)
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.textAlign = align;
      ctx.fillText(text, textX, y + height / 2);
      ctx.restore();
    }
  }
}

/** 계산 중인 수식 칸: 가운데에 회색 "…" */
function drawPending(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillStyle = THEME.pendingText;
  ctx.textAlign = "center";
  ctx.fillText("…", rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.fillStyle = THEME.text;
}

function drawSelectionBorder(ctx: CanvasRenderingContext2D, { geometry, viewport, selection, copied }: RenderState): void {
  const area = rangeRect(geometry, viewport, selectionRange(selection));
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.selectionBorder;
  ctx.strokeRect(Math.round(area.x), Math.round(area.y), area.width, area.height);
  if (!copied) return;
  // 복사한 범위: Excel처럼 점선 (움직이지는 않는다)
  const copy = rangeRect(geometry, viewport, copied);
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(Math.round(copy.x), Math.round(copy.y), copy.width, copy.height);
  ctx.setLineDash([]);
}

function drawHeaders(
  ctx: CanvasRenderingContext2D,
  { geometry, viewport, selection }: RenderState,
  { range, xs, ys }: VisibleLines,
): void {
  const selected = selectionRange(selection);
  const { headerWidth, headerHeight } = geometry;

  ctx.fillStyle = THEME.headerBackground;
  ctx.fillRect(0, 0, viewport.width, headerHeight);
  ctx.fillRect(0, 0, headerWidth, viewport.height);

  ctx.font = THEME.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.headerLine;

  for (let col = range.left; col <= range.right; col++) {
    const x = xs[col - range.left]!;
    const width = xs[col - range.left + 1]! - x;
    const isSelected = col >= selected.left && col <= selected.right;
    drawHeaderCell(ctx, { x, y: 0, width, height: headerHeight }, columnName(col), isSelected, "bottom");
  }
  for (let row = range.top; row <= range.bottom; row++) {
    const y = ys[row - range.top]!;
    const height = ys[row - range.top + 1]! - y;
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

/** 끄는 중인 경계선 자리: 머리글부터 화면 끝까지 점선 (Excel과 같음) */
function drawGuide(ctx: CanvasRenderingContext2D, { guide, viewport }: RenderState): void {
  if (!guide) return;
  const position = crisp(guide.position);
  ctx.beginPath();
  if (guide.axis === "col") {
    ctx.moveTo(position, 0);
    ctx.lineTo(position, viewport.height);
  } else {
    ctx.moveTo(0, position);
    ctx.lineTo(viewport.width, position);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.resizeGuide;
  ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 1px 선이 두 픽셀에 번지지 않도록 픽셀 경계 바로 앞 가운데에 맞춘다. */
function crisp(position: number): number {
  return Math.round(position) - 0.5;
}
