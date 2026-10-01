import { cellKey, type CellAddress } from "./address";
import { DEFAULT_FONT_SIZE, fontFor, formatCellValue, lineHeightFor, type CellFormat } from "./cell-format";
import { isFormula, type CellValue } from "./formula-value";
import { CELL_PADDING, FONT_FAMILY, autoRowHeight } from "./render";
import type { Sheet } from "./sheet";
import { wrapText } from "./text-wrap";

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const formulaInput = isFormula;

/** 줄바꿈이 있는지. 셀 수십만 개를 훑을 때 indexOf 두 번보다 두 배쯤 빠르다. */
const LINE_BREAK = /[\n\r]/;

/**
 * 입력한 글자의 줄 수. 수식은 결과에 줄바꿈이 있어도 한 줄로 그리므로 1이다. (ADR 0031)
 * 빈 글자도 1이다.
 */
export function inputLineCount(input: string): number {
  if (formulaInput(input)) return 1;
  let count = 1;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 10) count++;
    else if (code === 13) {
      count++;
      if (input.charCodeAt(i + 1) === 10) i++;
    }
  }
  return count;
}

/** 행 높이를 정하는 데 서식이 영향을 주는지 (자동 줄바꿈, 기본보다 큰 글자) */
function affectsHeight(format: CellFormat): boolean {
  return format.wrap === true || (format.fontSize !== undefined && format.fontSize > DEFAULT_FONT_SIZE);
}

/** 자동 줄바꿈 셀의 높이를 재는 데 필요한 것. 화면(GridView)이 준다. */
export interface AutoRowSource {
  /** 칸의 계산값 */
  value(address: CellAddress): CellValue;
  /** 열 너비 (px) */
  colWidth(col: number): number;
  /** font(Canvas font 값)로 쓴 글자의 너비 (px) */
  measure(text: string, font: string): number;
}

/**
 * 행마다 내용에 맞춘 자동 높이. 저장하지 않고 셀 글자·서식에서 다시 만든다. (ADR 0031, 0036)
 * - 입력한 글자의 줄바꿈 수만큼 줄을 둔다. (수식 결과의 줄바꿈은 한 줄)
 * - 자동 줄바꿈 셀은 보이는 값(숫자 형식, 수식 결과)을 열 너비에 맞춰 나눈 줄 수다. 숫자는 나누지 않는다.
 * - 줄 높이는 셀 글자 크기를 따른다.
 * 기본 높이보다 높은 셀만 행 → 열 → 높이로 기억해서, 셀이 바뀌면 바뀐 셀만 보고 그 행의 최댓값을 다시 구한다.
 * 빈 셀은 글자 크기가 커도 행을 높이지 않는다.
 */
export class AutoRowHeights {
  private readonly sheet: Sheet;
  private readonly source: AutoRowSource;
  private readonly defaultHeight: number;
  /** 행 → (열 → 높이). 기본 높이보다 높은 셀만 들어 있다. */
  private cells = new Map<number, Map<number, number>>();
  /** 행 → 가장 높은 셀의 높이. 기본 높이보다 높은 행만 들어 있다. */
  private maxHeights = new Map<number, number>();

  constructor(sheet: Sheet, source: AutoRowSource, defaultHeight: number) {
    this.sheet = sheet;
    this.source = source;
    this.defaultHeight = defaultHeight;
    this.rebuild();
  }

  /** 시트 전체를 다시 훑는다. 처음, 행·열을 넣고 지운 뒤, 줄 서식이나 열 너비가 바뀐 뒤에 부른다. */
  rebuild(): void {
    this.cells = new Map();
    this.maxHeights = new Map();
    const { sheet } = this;
    // 줄바꿈이 없는 셀(거의 전부)은 글자만 보고 넘어간다.
    const multiline = sheet.findCells((input) => LINE_BREAK.test(input));
    if (!sheet.hasFormats) {
      // 서식이 없는 시트(대부분)는 줄바꿈 셀의 줄 수만 센다.
      for (const address of multiline) this.set(address, this.plainHeight(sheet.get(address)));
    } else {
      const candidates = new Map<number, CellAddress>();
      for (const address of multiline) candidates.set(cellKey(address), address);
      for (const [address, format] of sheet.cellFormats()) {
        if (affectsHeight(format) && sheet.has(address)) candidates.set(cellKey(address), address);
      }
      const rows = new Set(lineIndexes(sheet.lineFormats("row")));
      const cols = new Set(lineIndexes(sheet.lineFormats("col")));
      if (rows.size > 0 || cols.size > 0) {
        for (const [address] of sheet.entries()) {
          if (rows.has(address.row) || cols.has(address.col)) candidates.set(cellKey(address), address);
        }
      }
      for (const address of candidates.values()) this.set(address, this.cellHeight(address));
    }
    for (const row of this.cells.keys()) this.refresh(row);
  }

  /** 값이나 셀 서식이 바뀐 셀을 반영한다. 높이가 바뀐 행이 있으면 true */
  update(addresses: readonly CellAddress[]): boolean {
    const touched = new Set<number>();
    for (const address of addresses) {
      const height = this.cellHeight(address);
      if (height !== null || this.cells.get(address.row)?.has(address.col)) {
        this.set(address, height);
        touched.add(address.row);
      }
    }
    let changed = false;
    for (const row of touched) changed = this.refresh(row) || changed;
    return changed;
  }

  /**
   * 계산값이 바뀐 셀을 반영한다. 계산값으로 높이가 바뀌는 것은 자동 줄바꿈 셀뿐이라 그 셀만 본다.
   * 처음 열 때 나눠서 계산하는 동안 수십만 셀이 오므로, 서식이 없는 시트는 바로 돌아간다.
   */
  updateValues(addresses: readonly CellAddress[]): boolean {
    if (!this.sheet.hasFormats) return false;
    return this.update(addresses.filter((address) => this.sheet.format(address).wrap));
  }

  /**
   * cols 중에 자동 줄바꿈인 칸이 있을 수 있는지. 열 너비가 바뀌었을 때 다시 잴지 정한다.
   * 열 서식, 행 서식, 그 열의 셀 서식 중 하나라도 자동 줄바꿈이면 true다.
   */
  wrapsIn(cols: readonly number[]): boolean {
    const { sheet } = this;
    if (!sheet.hasFormats) return false;
    if (cols.some((col) => sheet.lineFormat("col", col)?.wrap)) return true;
    for (const [, format] of sheet.lineFormats("row")) if (format.wrap) return true;
    const set = new Set(cols);
    for (const [address, format] of sheet.cellFormats()) if (format.wrap && set.has(address.col)) return true;
    return false;
  }

  /** 행의 자동 높이. 기본 높이보다 높은 셀이 없으면 기본 높이 */
  height(row: number): number {
    return this.maxHeights.get(row) ?? this.defaultHeight;
  }

  /** 기본 높이보다 높은 행을 [행, 높이]로 훑는다. 순서는 정해져 있지 않다. */
  entries(): IterableIterator<[number, number]> {
    return this.maxHeights.entries();
  }

  /** 기본 서식 셀에 필요한 높이: 입력한 글자의 줄 수만 본다. 기본 높이 이하면 null */
  private plainHeight(input: string): number | null {
    const height = autoRowHeight(inputLineCount(input), this.defaultHeight);
    return height > this.defaultHeight ? height : null;
  }

  /** 셀 하나에 필요한 높이. 기본 높이 이하면 null */
  private cellHeight(address: CellAddress): number | null {
    const input = this.sheet.get(address);
    if (input === "") return null;
    const format = this.sheet.format(address);
    if (!affectsHeight(format)) return LINE_BREAK.test(input) ? this.plainHeight(input) : null;
    const lineHeight = lineHeightFor(format.fontSize ?? DEFAULT_FONT_SIZE);
    let lines = inputLineCount(input);
    if (format.wrap) {
      const value = this.source.value(address);
      if (typeof value === "number") {
        lines = 1;
      } else {
        const font = fontFor(format, FONT_FAMILY);
        const width = this.source.colWidth(address.col) - CELL_PADDING * 2;
        lines = wrapText(formatCellValue(value, format), width, (text) => this.source.measure(text, font)).length;
      }
    }
    const height = autoRowHeight(lines, this.defaultHeight, lineHeight);
    return height > this.defaultHeight ? height : null;
  }

  private set({ row, col }: CellAddress, height: number | null): void {
    let byCol = this.cells.get(row);
    if (height !== null) {
      if (!byCol) this.cells.set(row, (byCol = new Map()));
      byCol.set(col, height);
    } else if (byCol) {
      byCol.delete(col);
      if (byCol.size === 0) this.cells.delete(row);
    }
  }

  /** 행의 가장 높은 셀 높이를 다시 구한다. 바뀌었으면 true */
  private refresh(row: number): boolean {
    let max = this.defaultHeight;
    for (const height of this.cells.get(row)?.values() ?? []) max = Math.max(max, height);
    if (max === this.height(row)) return false;
    if (max > this.defaultHeight) this.maxHeights.set(row, max);
    else this.maxHeights.delete(row);
    return true;
  }
}

/** 행 높이에 영향을 주는 줄 서식의 줄 번호 */
function* lineIndexes(lines: Iterable<[number, CellFormat]>): Generator<number> {
  for (const [index, format] of lines) if (affectsHeight(format)) yield index;
}
