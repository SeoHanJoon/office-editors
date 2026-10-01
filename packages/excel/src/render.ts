import { columnName, type CellRange } from "./address";
import type { FormulaEngine } from "./formula-engine";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_FORMAT,
  fontFor,
  fontPx,
  formatCellValue,
  lineHeightFor,
  type CellFormat,
  type HorizontalAlign,
  type VerticalAlign,
} from "./cell-format";
import { FormulaError, formatValue, type CellValue } from "./formula-value";
import { cellRect, fillHandleRect, rangeRect, visibleRange, type GridGeometry, type Rect, type Viewport } from "./layout";
import { textLines } from "./resize";
import { selectionRange, type Selection } from "./selection";
import type { Axis, Sheet } from "./sheet";
import { wrapText } from "./text-wrap";

export interface RenderState {
  readonly sheet: Sheet;
  /** 셀에 보여줄 계산값 */
  readonly engine: FormulaEngine;
  readonly selection: Selection;
  /** 복사하거나 잘라낸 범위. 점선 테두리를 그린다. 없으면 null */
  readonly copied?: CellRange | null;
  /** 선택 범위 오른쪽 아래에 채우기 핸들을 그릴지 */
  readonly fillHandle?: boolean;
  /** 채우기 핸들을 끄는 중이면 채울 범위(줄일 때는 지울 범위). 회색 점선 테두리를 그린다. 없으면 null */
  readonly fillPreview?: CellRange | null;
  /** 경계선을 끄는 중이면 새 경계선 자리. position은 캔버스 좌표(열은 x, 행은 y)다. 없으면 null */
  readonly guide?: { readonly axis: Axis; readonly position: number } | null;
  /** 머리글과 줄마다의 크기. 행·열 수가 sheet와 같아야 한다. */
  readonly geometry: GridGeometry;
  readonly viewport: Viewport;
}

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const DEFAULT = DEFAULT_FORMAT;
const showValue = formatValue;

/** 셀 글자 글꼴 이름. 글꼴 종류는 바꿀 수 없다. */
export const FONT_FAMILY = '-apple-system, "Segoe UI", "Malgun Gothic", sans-serif';

/** 기본 서식 셀 글자 글꼴 (10pt). 셀 입력창과 알림도 같은 글꼴을 쓴다. */
export const CELL_FONT = fontFor(DEFAULT_FORMAT, FONT_FAMILY);

/** 셀 안쪽 글자 여백 (px) */
export const CELL_PADDING = 4;

/** 기본 크기 셀 글자 한 줄의 높이 (px). 셀 입력창도 같은 줄 높이를 쓴다. */
export const LINE_HEIGHT = lineHeightFor(DEFAULT_FONT_SIZE);

/** 셀 글자 위아래 여백 (px). 한 줄이면 2 + 16 + 2 = 기본 행 높이 20px */
export const CELL_VERTICAL_PADDING = 2;

/** 한 줄 높이가 lineHeight인 글자 lines줄이 다 들어가는 행 높이. 기본 높이보다 작아지지 않는다. */
export function autoRowHeight(lines: number, defaultHeight: number, lineHeight = LINE_HEIGHT): number {
  return Math.max(defaultHeight, lines * lineHeight + CELL_VERTICAL_PADDING * 2);
}

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
  /** 채우기 핸들을 끄는 중에 보이는 채울 범위 테두리 */
  fillPreview: "#8a8a8a",
  /** 셀 테두리 서식 */
  border: "#000000",
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
  const formats = visibleFormats(state.sheet, lines.range);
  drawGridLines(ctx, lines);
  if (formats) drawCellFills(ctx, formats, lines);
  drawSelectionFill(ctx, state);
  if (formats) drawBorders(ctx, formats, lines);
  drawCellText(ctx, state, lines, formats);
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

/**
 * 보이는 칸의 서식. [(행 - range.top) × 보이는 열 수 + (열 - range.left)]에 있다.
 * 서식이 하나도 없는 시트면 null이다. (모든 칸이 기본 서식이라 따로 그릴 것이 없다)
 */
function visibleFormats(sheet: Sheet, range: CellRange): CellFormat[] | null {
  if (!sheet.hasFormats) return null;
  const formats: CellFormat[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) formats.push(sheet.format({ row, col }));
  }
  return formats;
}

/** 채우기 색. 격자선을 덮는다. (Excel과 같음) */
function drawCellFills(ctx: CanvasRenderingContext2D, formats: readonly CellFormat[], { range, xs, ys }: VisibleLines): void {
  const width = range.right - range.left + 1;
  for (let i = 0; i < formats.length; i++) {
    const fill = formats[i]!.fill;
    if (!fill) continue;
    const r = Math.floor(i / width);
    const c = i - r * width;
    const x = Math.round(xs[c]!);
    const y = Math.round(ys[r]!);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, Math.round(xs[c + 1]!) - x, Math.round(ys[r + 1]!) - y);
  }
}

/**
 * 테두리: 가는 검정 실선. 두 칸이 맞닿은 선은 어느 쪽 칸에 있어도 그린다. (ADR 0034)
 * 격자선과 같은 자리(경계 바로 앞 픽셀)에 긋는다.
 */
function drawBorders(ctx: CanvasRenderingContext2D, formats: readonly CellFormat[], { range, xs, ys }: VisibleLines): void {
  const width = range.right - range.left + 1;
  ctx.beginPath();
  let any = false;
  for (let i = 0; i < formats.length; i++) {
    const format = formats[i]!;
    if (!format.borderTop && !format.borderRight && !format.borderBottom && !format.borderLeft) continue;
    any = true;
    const r = Math.floor(i / width);
    const c = i - r * width;
    // 선이 맞닿은 칸 끝까지 닿도록 1px 더 긋는다.
    const left = crisp(xs[c]!);
    const right = crisp(xs[c + 1]!);
    const top = crisp(ys[r]!);
    const bottom = crisp(ys[r + 1]!);
    if (format.borderTop) {
      ctx.moveTo(left - 0.5, top);
      ctx.lineTo(right + 0.5, top);
    }
    if (format.borderBottom) {
      ctx.moveTo(left - 0.5, bottom);
      ctx.lineTo(right + 0.5, bottom);
    }
    if (format.borderLeft) {
      ctx.moveTo(left, top - 0.5);
      ctx.lineTo(left, bottom + 0.5);
    }
    if (format.borderRight) {
      ctx.moveTo(right, top - 0.5);
      ctx.lineTo(right, bottom + 0.5);
    }
  }
  if (!any) return;
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.border;
  ctx.stroke();
}

/** 범위는 옅게 덮고 활성 셀만 비워 둔다. (Excel과 같음) 채우기 색 위에 덮어서 색이 있는 칸도 골랐는지 보인다. */
function drawSelectionFill(ctx: CanvasRenderingContext2D, { geometry, viewport, selection }: RenderState): void {
  const range = selectionRange(selection);
  if (range.top === range.bottom && range.left === range.right) return;
  const area = rangeRect(geometry, viewport, range);
  const active = cellRect(geometry, viewport, selection.active);
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.width, area.height);
  ctx.rect(active.x, active.y, active.width, active.height);
  ctx.fillStyle = THEME.selectionFill;
  ctx.fill("evenodd");
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

/**
 * 셀 글자. 서식이 없으면 셀 아래쪽에 붙여 그린다. (Excel 기본 세로 정렬) 여러 줄이면 마지막 줄이 아래쪽에 온다.
 * 입력한 글자의 줄바꿈만 줄을 나누고, 수식 결과의 줄바꿈은 한 줄로 그린다. (ADR 0031)
 * 자동 줄바꿈 셀은 보이는 값을 열 너비에 맞춰 나눈다. 숫자는 나누지 않는다. (ADR 0036)
 * formats가 null이면 모든 칸이 기본 서식이다.
 */
function drawCellText(
  ctx: CanvasRenderingContext2D,
  { sheet, engine }: RenderState,
  { range, xs, ys }: VisibleLines,
  formats: readonly CellFormat[] | null,
): void {
  ctx.font = THEME.font;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = "middle";
  let font = THEME.font;
  const visibleCols = range.right - range.left + 1;
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
      if (value === null) continue;
      const format = formats ? formats[(row - range.top) * visibleCols + (col - range.left)]! : DEFAULT;
      const text = format === DEFAULT ? showValue(value) : formatCellValue(value, format);
      if (text === "") continue;
      const cellFont = format === DEFAULT ? THEME.font : fontFor(format, FONT_FAMILY);
      if (cellFont !== font) {
        ctx.font = cellFont;
        font = cellFont;
      }
      const align = format.align ?? valueAlign(value);
      const textX = align === "left" ? x + CELL_PADDING : align === "right" ? x + width - CELL_PADDING : x + width / 2;
      const lineHeight = format.fontSize === undefined ? LINE_HEIGHT : lineHeightFor(format.fontSize);
      let lines: string[] | null;
      if (format.wrap && typeof value !== "number") {
        lines = wrapText(text, width - CELL_PADDING * 2, (part) => ctx.measureText(part).width);
      } else {
        // 줄바꿈이 없는 셀(거의 전부)은 입력한 글자를 읽지 않는다.
        lines = text.indexOf("\n") < 0 && text.indexOf("\r") < 0 ? null : textLines(sheet.get({ row, col }), text);
      }
      const count = lines ? lines.length : 1;
      const firstY = firstLineY(format.verticalAlign ?? "bottom", y, height, count, lineHeight);
      // 글자가 칸을 넘치면 잘라낸다. (옆 칸으로 넘쳐 보이게 하는 건 나중에)
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.textAlign = align;
      if (format.color) ctx.fillStyle = format.color;
      for (let i = 0; i < count; i++) {
        const line = lines ? lines[i]! : text;
        const lineY = firstY + i * lineHeight;
        ctx.fillText(line, textX, lineY);
        if (format.underline || format.strike) decorate(ctx, format, line, textX, lineY, align);
      }
      ctx.restore();
    }
  }
}

/**
 * 첫 줄 가운데의 y. 글자 덩어리(줄 수 × 줄 높이)를 위·가운데·아래에 맞춘다.
 * 아래 맞춤은 덩어리가 칸보다 높으면 마지막 줄이 칸 가운데보다 위로 가지 않게 한다. (한 줄도 안 들어가는 낮은 행은 가운데)
 */
function firstLineY(align: VerticalAlign, y: number, height: number, lines: number, lineHeight: number): number {
  const block = lines * lineHeight;
  if (align === "top") return y + CELL_VERTICAL_PADDING + lineHeight / 2;
  if (align === "middle") return y + (height - block) / 2 + lineHeight / 2;
  const lastY = Math.max(y + height - CELL_VERTICAL_PADDING - lineHeight / 2, y + height / 2);
  return lastY - (lines - 1) * lineHeight;
}

/** 밑줄과 취소선. 글자 너비만큼 글자색으로 긋는다. lineY는 줄 가운데다. */
function decorate(
  ctx: CanvasRenderingContext2D,
  format: CellFormat,
  line: string,
  textX: number,
  lineY: number,
  align: HorizontalAlign,
): void {
  const width = ctx.measureText(line).width;
  const start = align === "left" ? textX : align === "right" ? textX - width : textX - width / 2;
  const size = fontPx(format.fontSize ?? DEFAULT_FONT_SIZE);
  const thickness = Math.max(1, Math.round(size / 14));
  ctx.beginPath();
  if (format.underline) ctx.rect(start, Math.round(lineY + size * 0.42), width, thickness);
  if (format.strike) ctx.rect(start, Math.round(lineY + size * 0.05), width, thickness);
  ctx.fill();
}

/** 계산 중인 수식 칸: 가운데에 회색 "…" */
function drawPending(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillStyle = THEME.pendingText;
  ctx.textAlign = "center";
  ctx.fillText("…", rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.fillStyle = THEME.text;
}

function drawSelectionBorder(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { geometry, viewport, selection, copied, fillHandle, fillPreview } = state;
  const range = selectionRange(selection);
  const area = rangeRect(geometry, viewport, range);
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.selectionBorder;
  ctx.strokeRect(Math.round(area.x), Math.round(area.y), area.width, area.height);
  if (fillHandle) {
    // 흰 테두리를 두른 초록 네모 (Excel과 같음)
    const handle = fillHandleRect(geometry, viewport, range);
    const x = Math.round(handle.x);
    const y = Math.round(handle.y);
    ctx.fillStyle = THEME.background;
    ctx.fillRect(x - 1, y - 1, handle.width + 2, handle.height + 2);
    ctx.fillStyle = THEME.selectionBorder;
    ctx.fillRect(x, y, handle.width, handle.height);
  }
  if (fillPreview) {
    const preview = rangeRect(geometry, viewport, fillPreview);
    ctx.strokeStyle = THEME.fillPreview;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(Math.round(preview.x), Math.round(preview.y), preview.width, preview.height);
    ctx.setLineDash([]);
    ctx.strokeStyle = THEME.selectionBorder;
  }
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
