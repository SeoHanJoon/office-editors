import { cellKey, keyToAddress, type CellAddress, type CellRange } from "./address";
import { CLEAR_FORMAT, DEFAULT_FORMAT, mergeFormat, type CellFormat, type FormatPatch } from "./cell-format";
import type { Direction } from "./selection";
import type { Axis, FormatChanges, Sheet } from "./sheet";

/** 테두리 버튼의 모양 */
export type BorderKind = "all" | "outer" | "top" | "bottom" | "left" | "right" | "none";

/**
 * 시트 서식 위에 아직 적용하지 않은 변경을 쌓아 가며 읽는 초안. 여러 번 바꾼 결과를 SetFormatsCommand 하나로 만들 때 쓴다.
 * 읽기는 초안에 쌓은 것을 먼저 보고, 없으면 시트를 본다.
 */
export class FormatDraft {
  private readonly sheet: Sheet;
  /** 셀 서식 변경. 키는 cellKey, null은 셀 서식을 지운다. */
  private readonly cells = new Map<number, CellFormat | null>();
  private readonly lines: Record<Axis, Map<number, CellFormat | null>> = { row: new Map(), col: new Map() };

  constructor(sheet: Sheet) {
    this.sheet = sheet;
  }

  cellFormat(address: CellAddress): CellFormat | null {
    const key = cellKey(address);
    return this.cells.has(key) ? this.cells.get(key)! : this.sheet.cellFormat(address);
  }

  lineFormat(axis: Axis, index: number): CellFormat | null {
    const lines = this.lines[axis];
    return lines.has(index) ? lines.get(index)! : this.sheet.lineFormat(axis, index);
  }

  /** 칸에 보이는 서식 (Sheet.format과 같은 순서) */
  format(address: CellAddress): CellFormat {
    return this.cellFormat(address) ?? this.lineFormat("row", address.row) ?? this.lineFormat("col", address.col) ?? DEFAULT_FORMAT;
  }

  setCell(address: CellAddress, format: CellFormat | null): void {
    this.cells.set(cellKey(address), format);
  }

  setLine(axis: Axis, index: number, format: CellFormat | null): void {
    this.lines[axis].set(index, format);
  }

  /**
   * range의 모든 칸에 patch를 준다. 칸마다 지금 보이는 서식에 patch를 합친 서식이 된다.
   * 열(행) 전체면 칸마다 저장하지 않고 열(행) 서식을 바꾼다. 그 줄에 이미 있는 셀 서식과,
   * 우선하는 줄 서식이 겹치는 칸만 따로 고친다. 걸리는 시간이 행 수가 아니라 이미 있는 서식 수에 비례한다. (ADR 0034)
   */
  apply(range: CellRange, patch: FormatPatch): void {
    const { rowCount, colCount } = this.sheet;
    const allRows = range.top === 0 && range.bottom === rowCount - 1;
    const allCols = range.left === 0 && range.right === colCount - 1;
    if (!allRows && !allCols) {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) {
          const address = { row, col };
          this.setCell(address, mergeFormat(this.format(address), patch));
        }
      }
      return;
    }

    // 이미 있는 셀 서식: 범위 안이면 patch를 합친다.
    for (const [address, format] of this.cellEntries()) {
      if (inRange(range, address)) this.setCell(address, mergeFormat(format, patch));
    }
    if (allRows && allCols) {
      // 시트 전체: 열 서식과, 열 서식보다 우선하는 행 서식을 모두 고친다.
      for (const [row, format] of this.lineEntries("row")) this.setLine("row", row, mergeFormat(format, patch));
      for (let col = range.left; col <= range.right; col++) {
        this.setLine("col", col, mergeFormat(this.lineFormat("col", col) ?? DEFAULT_FORMAT, patch));
      }
      return;
    }
    if (allRows) {
      // 열 전체: 행 서식이 있는 행은 열 서식보다 행 서식이 우선하므로 그 칸에 셀 서식을 둔다.
      for (const [row, format] of this.lineEntries("row")) {
        for (let col = range.left; col <= range.right; col++) {
          const address = { row, col };
          if (this.cellFormat(address) === null) this.setCell(address, mergeFormat(format, patch));
        }
      }
      for (let col = range.left; col <= range.right; col++) {
        this.setLine("col", col, mergeFormat(this.lineFormat("col", col) ?? DEFAULT_FORMAT, patch));
      }
      return;
    }
    // 행 전체: 행 서식이 없던 행은 열 서식을 보여 주고 있었으므로, 열 서식이 있는 칸에 셀 서식을 둔다.
    const cols = [...this.lineEntries("col")].filter(([col]) => col >= range.left && col <= range.right);
    for (let row = range.top; row <= range.bottom; row++) {
      const rowFormat = this.lineFormat("row", row);
      if (rowFormat === null) {
        for (const [col, format] of cols) {
          const address = { row, col };
          if (this.cellFormat(address) === null) this.setCell(address, mergeFormat(format, patch));
        }
      }
      this.setLine("row", row, mergeFormat(rowFormat ?? DEFAULT_FORMAT, patch));
    }
  }

  /** 쌓은 변경. SetFormatsCommand에 넘긴다. */
  changes(): FormatChanges {
    return {
      cells: Array.from(this.cells, ([key, format]) => ({ address: keyToAddress(key), format })),
      rows: Array.from(this.lines.row, ([index, format]) => ({ index, format })),
      cols: Array.from(this.lines.col, ([index, format]) => ({ index, format })),
    };
  }

  /** 지금 셀 서식이 있는 셀 (초안 반영). 훑는 동안 초안을 바꿔도 되도록 배열로 돌려준다. */
  private cellEntries(): [CellAddress, CellFormat][] {
    const entries: [CellAddress, CellFormat][] = [];
    for (const [address, format] of this.sheet.cellFormats()) {
      if (!this.cells.has(cellKey(address))) entries.push([address, format]);
    }
    for (const [key, format] of this.cells) if (format !== null) entries.push([keyToAddress(key), format]);
    return entries;
  }

  /** 지금 줄 서식이 있는 줄 (초안 반영) */
  private lineEntries(axis: Axis): [number, CellFormat][] {
    const lines = this.lines[axis];
    const entries: [number, CellFormat][] = [];
    for (const [index, format] of this.sheet.lineFormats(axis)) if (!lines.has(index)) entries.push([index, format]);
    for (const [index, format] of lines) if (format !== null) entries.push([index, format]);
    return entries;
  }
}

function inRange(range: CellRange, { row, col }: CellAddress): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** range에 patch를 주는 변경 (툴바 서식 버튼) */
export function patchFormatChanges(sheet: Sheet, range: CellRange, patch: FormatPatch): FormatChanges {
  const draft = new FormatDraft(sheet);
  draft.apply(range, patch);
  return draft.changes();
}

/** range의 서식을 모두 기본으로 돌리는 변경 (서식 지우기) */
export function clearFormatChanges(sheet: Sheet, range: CellRange): FormatChanges {
  return patchFormatChanges(sheet, range, CLEAR_FORMAT);
}

/**
 * range에 테두리를 주는 변경. 테두리는 셀마다 네 변에 둔다. (ADR 0034)
 * - all: 모든 칸의 네 변 / outer: 범위 바깥 변만 / top·bottom·left·right: 범위의 그 변만
 * - none: 범위 칸의 네 변을 지우고, 맞닿은 바깥 칸이 범위 쪽으로 가진 변도 지운다. (두 칸이 맞닿은 선은 어느 쪽에 있어도 그려지므로)
 */
export function borderChanges(sheet: Sheet, range: CellRange, kind: BorderKind): FormatChanges {
  const draft = new FormatDraft(sheet);
  const { top, left, bottom, right } = range;
  const topRow = { ...range, bottom: top };
  const bottomRow = { ...range, top: bottom };
  const leftCol = { ...range, right: left };
  const rightCol = { ...range, left: right };
  switch (kind) {
    case "all":
      draft.apply(range, { borderTop: true, borderRight: true, borderBottom: true, borderLeft: true });
      break;
    case "outer":
      draft.apply(topRow, { borderTop: true });
      draft.apply(bottomRow, { borderBottom: true });
      draft.apply(leftCol, { borderLeft: true });
      draft.apply(rightCol, { borderRight: true });
      break;
    case "top":
      draft.apply(topRow, { borderTop: true });
      break;
    case "bottom":
      draft.apply(bottomRow, { borderBottom: true });
      break;
    case "left":
      draft.apply(leftCol, { borderLeft: true });
      break;
    case "right":
      draft.apply(rightCol, { borderRight: true });
      break;
    case "none":
      draft.apply(range, { borderTop: null, borderRight: null, borderBottom: null, borderLeft: null });
      if (top > 0) draft.apply({ ...range, top: top - 1, bottom: top - 1 }, { borderBottom: null });
      if (bottom < sheet.rowCount - 1) draft.apply({ ...range, top: bottom + 1, bottom: bottom + 1 }, { borderTop: null });
      if (left > 0) draft.apply({ ...range, left: left - 1, right: left - 1 }, { borderRight: null });
      if (right < sheet.colCount - 1) draft.apply({ ...range, left: right + 1, right: right + 1 }, { borderLeft: null });
      break;
  }
  return draft.changes();
}

/**
 * 앱 안에서 복사한 source 범위의 서식을 target 범위에 붙여넣는 변경. target이 더 크면 반복한다. (pasteCopyChanges와 같은 칸 대응)
 * 칸마다 source 칸에 보이는 서식을 셀 서식으로 둔다. 붙이기 전 서식으로 만들므로 source와 target이 겹쳐도 된다.
 */
export function pasteFormatChanges(sheet: Sheet, source: CellRange, target: CellRange): FormatChanges {
  const height = source.bottom - source.top + 1;
  const width = source.right - source.left + 1;
  const cells = [];
  for (let row = target.top; row <= target.bottom; row++) {
    const fromRow = source.top + ((row - target.top) % height);
    for (let col = target.left; col <= target.right; col++) {
      const fromCol = source.left + ((col - target.left) % width);
      cells.push({ address: { row, col }, format: sheet.format({ row: fromRow, col: fromCol }) });
    }
  }
  return { cells };
}

/**
 * 잘라낸 source 범위를 (top, left)로 옮길 때의 서식 변경. 옮긴 곳은 source 서식이 되고,
 * source 자리 중 옮긴 곳과 겹치지 않는 칸은 셀 서식을 지운다. (moveChanges와 같은 칸)
 */
export function moveFormatChanges(sheet: Sheet, source: CellRange, top: number, left: number): FormatChanges {
  const rowOffset = top - source.top;
  const colOffset = left - source.left;
  const target = { top, left, bottom: source.bottom + rowOffset, right: source.right + colOffset };
  const cells = [];
  for (let row = source.top; row <= source.bottom; row++) {
    for (let col = source.left; col <= source.right; col++) {
      if (!inRange(target, { row, col })) cells.push({ address: { row, col }, format: null });
    }
  }
  for (let row = source.top; row <= source.bottom; row++) {
    for (let col = source.left; col <= source.right; col++) {
      cells.push({ address: { row: row + rowOffset, col: col + colOffset }, format: sheet.format({ row, col }) });
    }
  }
  return { cells };
}

/**
 * source 범위를 direction 쪽으로 count칸 채울 때의 서식 변경. (채우기 핸들, fillChanges와 같은 칸)
 * 채우는 방향의 줄마다 source 칸들의 서식을 순서대로 되풀이한다. 위·왼쪽으로 채우면 거꾸로 되풀이한다.
 */
export function fillFormatChanges(sheet: Sheet, source: CellRange, direction: Direction, count: number): FormatChanges {
  const vertical = direction === "up" || direction === "down";
  const forward = direction === "down" || direction === "right";
  const [start, end] = vertical ? [source.top, source.bottom] : [source.left, source.right];
  const [crossStart, crossEnd] = vertical ? [source.left, source.right] : [source.top, source.bottom];
  const length = end - start + 1;
  const cells = [];
  for (let cross = crossStart; cross <= crossEnd; cross++) {
    const at = (along: number): CellAddress => (vertical ? { row: along, col: cross } : { row: cross, col: along });
    for (let step = 1; step <= count; step++) {
      const position = forward ? length - 1 + step : -step;
      const from = start + (((position % length) + length) % length);
      cells.push({ address: at(start + position), format: sheet.format(at(from)) });
    }
  }
  return { cells };
}

/**
 * Ctrl+D(down)·Ctrl+R(right)의 서식 변경. copyFillChanges와 같은 칸에 서식을 복사한다.
 * 한 행(열)만 골랐으면 바로 위 행(왼쪽 열)을 가져오고, 그런 줄이 없으면 바꾸지 않는다.
 */
export function copyFillFormatChanges(sheet: Sheet, range: CellRange, direction: "down" | "right"): FormatChanges {
  if (direction === "down") {
    if (range.top === range.bottom) {
      if (range.top === 0) return {};
      return pasteFormatChanges(sheet, { ...range, top: range.top - 1, bottom: range.top - 1 }, range);
    }
    return pasteFormatChanges(sheet, { ...range, bottom: range.top }, { ...range, top: range.top + 1 });
  }
  if (range.left === range.right) {
    if (range.left === 0) return {};
    return pasteFormatChanges(sheet, { ...range, left: range.left - 1, right: range.left - 1 }, range);
  }
  return pasteFormatChanges(sheet, { ...range, right: range.left }, { ...range, left: range.left + 1 });
}
