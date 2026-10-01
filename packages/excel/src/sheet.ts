import { MAX_COLS, MAX_ROWS, cellKey, keyToAddress, toA1, type CellAddress } from "./address";
import { DEFAULT_FORMAT, formatKey, type CellFormat } from "./cell-format";
import { rewriteFormula, structureMapping } from "./formula-references";
import { isFormula } from "./formula-value";
import { canChangeStructure, mapLine, type StructureChange } from "./structure";

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const STRIDE = MAX_COLS;
const lineAfter = mapLine;
const formulaInput = isFormula;
const rewrite = rewriteFormula;
const addressOf = keyToAddress;
const keyOf = cellKey;

export interface SheetOptions {
  /** 행 수. 1 이상 MAX_ROWS 이하 */
  rowCount: number;
  /** 열 수. 1 이상 MAX_COLS 이하 */
  colCount: number;
  /** 처음 값. data[행][열]. 빈 문자열은 빈 셀로 본다. */
  data?: readonly (readonly string[])[];
}

/** 셀 하나에 넣을 값. 빈 문자열이면 셀을 비운다. */
export interface CellChange {
  readonly address: CellAddress;
  readonly value: string;
}

/** 줄(행 또는 열) 하나의 크기 변경. size가 null이면 직접 바꾼 크기를 지워 기본(행은 자동) 크기로 돌린다. */
export interface CustomSizeChange {
  readonly index: number;
  /** CSS px. 0보다 크다. */
  readonly size: number | null;
}

export type Axis = "row" | "col";

/** 셀 하나의 서식 변경. format이 null이면 셀 서식을 지워 행·열 서식을 따르게 한다. */
export interface CellFormatChange {
  readonly address: CellAddress;
  readonly format: CellFormat | null;
}

/** 행 또는 열 하나의 서식 변경. format이 null이면 줄 서식을 지운다. */
export interface LineFormatChange {
  readonly index: number;
  readonly format: CellFormat | null;
}

/** 서식 변경 한 번. 행·열 서식을 먼저 바꾸고 셀 서식을 바꾼다. */
export interface FormatChanges {
  readonly cells?: readonly CellFormatChange[];
  readonly rows?: readonly LineFormatChange[];
  readonly cols?: readonly LineFormatChange[];
}

/** 서식이 바뀐 뒤 불린다. setFormats에 넘긴 변경 그대로다. */
export type FormatChangeListener = (changes: FormatChanges) => void;

/** 직접 바꾼 줄 크기가 바뀐 축과 줄 번호를 받는다. setCustomSizes에 넘긴 순서 그대로다. */
export type CustomSizeListener = (axis: Axis, indexes: readonly number[]) => void;

/** 값이 바뀐 셀 주소를 받는다. setCells에 넘긴 순서 그대로다. */
export type SheetChangeListener = (addresses: readonly CellAddress[]) => void;

/**
 * 행·열을 넣거나 지운 뒤 불린다. addresses는 옮기고 참조를 고친 뒤 따로 값이 바뀐 셀이다. (변경 뒤 주소)
 * 옮겨지기만 했거나 참조만 규칙대로 고쳐진 셀은 들어 있지 않다. (듣는 쪽이 같은 규칙으로 따라갈 수 있다)
 */
export type StructureChangeListener = (change: StructureChange, addresses: readonly CellAddress[]) => void;

/** changeStructure가 없애거나 고친 것. 되돌릴 때 쓴다. */
export interface StructureResult {
  /** 지운 줄에 있던 셀 (변경 전 주소와 값) */
  readonly removed: readonly CellChange[];
  /** 참조를 고친 수식 셀 (변경 뒤 주소와 고치기 전 글자) */
  readonly rewritten: readonly CellChange[];
  /** 지운 줄에 있던 직접 바꾼 크기 (변경 전 줄 번호) */
  readonly removedSizes: readonly CustomSizeChange[];
  /** 지운 줄에 있던 셀 서식과 줄 서식 (변경 전 주소·줄 번호). 줄 서식은 change 축(rows 또는 cols)에만 있다. */
  readonly removedFormats: FormatChanges;
}

/**
 * 시트 한 장의 셀 값, 사용자가 직접 바꾼 행 높이·열 너비, 서식. 셀에는 사용자가 입력한 글자를 그대로 저장한다. ("12", "=A1+1")
 * 값이 있는 셀, 크기를 바꾼 줄, 서식이 있는 셀·줄만 Map에 넣으므로 빈 셀과 기본 크기·기본 서식은 메모리를 쓰지 않는다.
 * 저장할 문서 데이터는 모두 여기 있다. 자동 행 높이처럼 다시 계산할 수 있는 것은 두지 않는다. (ADR 0031)
 *
 * 서식은 셀·행·열 3단이다. 한 칸의 서식은 셀 서식 → 행 서식 → 열 서식 → 기본 순서로 처음 찾은 것이다. (ADR 0034)
 * 같은 서식은 서식 표에 한 번만 두고 셀·줄에는 그 번호만 둔다. 그래서 서식을 읽으면 같은 서식은 늘 같은 객체다.
 */
export class Sheet {
  private rows: number;
  private cols: number;
  /** 키는 cellKey(주소). 값은 빈 문자열이 아니다. */
  private cells = new Map<number, string>();
  /** 직접 바꾼 행 높이·열 너비 (CSS px). 키는 줄 번호 */
  private sizes: Record<Axis, Map<number, number>> = { row: new Map(), col: new Map() };
  /** 서식 표. 0번은 기본 서식이다. 한번 넣은 서식은 빼지 않는다. */
  private readonly formatTable: CellFormat[] = [DEFAULT_FORMAT];
  /** formatKey → 서식 표 번호 */
  private readonly formatIds = new Map<string, number>([[formatKey(DEFAULT_FORMAT), 0]]);
  /** 셀 서식. 키는 cellKey(주소), 값은 서식 표 번호. 행·열 서식을 덮으려고 기본 서식(0)도 둘 수 있다. */
  private cellFormatIds = new Map<number, number>();
  /** 행 서식·열 서식. 키는 줄 번호, 값은 서식 표 번호 */
  private lineFormatIds: Record<Axis, Map<number, number>> = { row: new Map(), col: new Map() };
  private readonly formatListeners = new Set<FormatChangeListener>();
  private readonly listeners = new Set<SheetChangeListener>();
  private readonly sizeListeners = new Set<CustomSizeListener>();
  private readonly structureListeners = new Set<StructureChangeListener>();

  constructor({ rowCount, colCount, data = [] }: SheetOptions) {
    assertCount("rowCount", rowCount, MAX_ROWS);
    assertCount("colCount", colCount, MAX_COLS);
    if (data.length > rowCount || data.some((row) => row.length > colCount)) {
      throw new RangeError(`data가 시트 크기(${rowCount}행 × ${colCount}열)보다 크다`);
    }
    this.rows = rowCount;
    this.cols = colCount;
    data.forEach((values, row) => {
      values.forEach((value, col) => {
        if (value !== "") this.cells.set(cellKey({ row, col }), value);
      });
    });
  }

  /** 행 수. 행을 넣고 지우면 바뀐다. */
  get rowCount(): number {
    return this.rows;
  }

  /** 열 수. 열을 넣고 지우면 바뀐다. */
  get colCount(): number {
    return this.cols;
  }

  /** 값이 있는 셀 수 */
  get size(): number {
    return this.cells.size;
  }

  /** 셀에 입력된 글자. 빈 셀이면 "" */
  get(address: CellAddress): string {
    return this.cells.get(cellKey(address)) ?? "";
  }

  /** 셀에 값이 있는지 */
  has(address: CellAddress): boolean {
    return this.cells.has(cellKey(address));
  }

  /** 값이 있는 셀을 모두 [주소, 입력한 글자]로 훑는다. 순서는 정해져 있지 않다. */
  *entries(): IterableIterator<[CellAddress, string]> {
    for (const [key, value] of this.cells) yield [addressOf(key), value];
  }

  /**
   * 입력한 글자가 match를 만족하는 셀의 주소. 순서는 정해져 있지 않다.
   * entries()와 달리 맞지 않는 셀에는 주소 객체를 만들지 않아서, 드물게 있는 셀을 시트 전체에서 찾을 때 빠르다.
   */
  findCells(match: (input: string) => boolean): CellAddress[] {
    const found: CellAddress[] = [];
    this.cells.forEach((value, key) => {
      if (match(value)) found.push(addressOf(key));
    });
    return found;
  }

  /**
   * 여러 셀의 값을 한 번에 바꾸고 변경을 한 번 알린다.
   * 편집은 SetCellsCommand를 거쳐야 undo가 된다. 이 메서드는 Command 안에서만 부른다.
   * 시트 밖 주소가 하나라도 있으면 아무것도 바꾸지 않고 RangeError를 던진다.
   */
  setCells(changes: readonly CellChange[]): void {
    for (const { address } of changes) {
      if (!this.contains(address)) {
        throw new RangeError(`시트(${this.rowCount}행 × ${this.colCount}열) 밖의 셀이다: ${toA1(address)}`);
      }
    }
    for (const { address, value } of changes) {
      if (value === "") this.cells.delete(cellKey(address));
      else this.cells.set(cellKey(address), value);
    }
    if (changes.length === 0) return;
    const addresses = changes.map((change) => change.address);
    for (const listener of this.listeners) listener(addresses);
  }

  /** 값이 바뀔 때마다 listener를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: SheetChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 직접 바꾼 줄 크기 (CSS px). 바꾸지 않았으면 null */
  customSize(axis: Axis, index: number): number | null {
    return this.sizes[axis].get(index) ?? null;
  }

  /** 직접 바꾼 줄을 [줄 번호, 크기]로 훑는다. 순서는 정해져 있지 않다. */
  customSizes(axis: Axis): IterableIterator<[number, number]> {
    return this.sizes[axis].entries();
  }

  /**
   * 한 축의 줄 크기를 한 번에 바꾸고 변경을 한 번 알린다.
   * 편집은 SetCustomSizesCommand를 거쳐야 undo가 된다. 이 메서드는 Command 안에서만 부른다.
   * 시트 밖 줄이 있거나 크기가 0보다 큰 수가 아니면 아무것도 바꾸지 않고 RangeError를 던진다.
   */
  setCustomSizes(axis: Axis, changes: readonly CustomSizeChange[]): void {
    const count = axis === "row" ? this.rows : this.cols;
    for (const { index, size } of changes) {
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new RangeError(`시트 밖의 ${axis === "row" ? "행" : "열"}이다: ${index}`);
      }
      if (size !== null && !(size > 0 && Number.isFinite(size))) throw new RangeError(`줄 크기는 0보다 커야 한다: ${size}`);
    }
    if (changes.length === 0) return;
    const sizes = this.sizes[axis];
    for (const { index, size } of changes) {
      if (size === null) sizes.delete(index);
      else sizes.set(index, size);
    }
    const indexes = changes.map((change) => change.index);
    for (const listener of this.sizeListeners) listener(axis, indexes);
  }

  /** 직접 바꾼 줄 크기가 바뀔 때마다 listener를 부른다. 행·열을 넣고 지울 때는 부르지 않는다. (onStructureChange로 안다) */
  onCustomSizeChange(listener: CustomSizeListener): () => void {
    this.sizeListeners.add(listener);
    return () => this.sizeListeners.delete(listener);
  }

  /** 셀·행·열 서식이 하나라도 있는지. 없으면 모든 칸이 기본 서식이다. */
  get hasFormats(): boolean {
    return this.cellFormatIds.size > 0 || this.lineFormatIds.row.size > 0 || this.lineFormatIds.col.size > 0;
  }

  /** 칸에 보이는 서식. 셀 서식 → 행 서식 → 열 서식 → 기본 서식 순서로 처음 찾은 것이다. */
  format({ row, col }: CellAddress): CellFormat {
    const { cellFormatIds, lineFormatIds } = this;
    if (cellFormatIds.size === 0 && lineFormatIds.row.size === 0 && lineFormatIds.col.size === 0) return DEFAULT_FORMAT;
    const id = cellFormatIds.get(row * STRIDE + col) ?? lineFormatIds.row.get(row) ?? lineFormatIds.col.get(col) ?? 0;
    return this.formatTable[id]!;
  }

  /** 셀에 직접 준 서식. 없으면(행·열 서식을 따르면) null */
  cellFormat(address: CellAddress): CellFormat | null {
    const id = this.cellFormatIds.get(cellKey(address));
    return id === undefined ? null : this.formatTable[id]!;
  }

  /** 행 서식 또는 열 서식. 없으면 null */
  lineFormat(axis: Axis, index: number): CellFormat | null {
    const id = this.lineFormatIds[axis].get(index);
    return id === undefined ? null : this.formatTable[id]!;
  }

  /** 셀 서식이 있는 셀을 모두 [주소, 서식]으로 훑는다. 순서는 정해져 있지 않다. */
  *cellFormats(): IterableIterator<[CellAddress, CellFormat]> {
    for (const [key, id] of this.cellFormatIds) yield [addressOf(key), this.formatTable[id]!];
  }

  /** 서식이 있는 행 또는 열을 모두 [줄 번호, 서식]으로 훑는다. 순서는 정해져 있지 않다. */
  *lineFormats(axis: Axis): IterableIterator<[number, CellFormat]> {
    for (const [index, id] of this.lineFormatIds[axis]) yield [index, this.formatTable[id]!];
  }

  /**
   * 서식을 한 번에 바꾸고 변경을 한 번 알린다. 행·열 서식을 먼저 바꾸고 셀 서식을 바꾼다.
   * 셀 서식이 행·열에서 물려받는 서식과 같으면 셀 서식을 두지 않는다. (보이는 서식은 같다)
   * 편집은 SetFormatsCommand를 거쳐야 undo가 된다. 이 메서드는 Command 안에서만 부른다.
   * 시트 밖 셀·줄이 하나라도 있으면 아무것도 바꾸지 않고 RangeError를 던진다.
   */
  setFormats(changes: FormatChanges): void {
    const { cells = [], rows = [], cols = [] } = changes;
    for (const { address } of cells) {
      if (!this.contains(address)) throw new RangeError(`시트(${this.rows}행 × ${this.cols}열) 밖의 셀이다: ${toA1(address)}`);
    }
    for (const [axis, lines] of [["row", rows], ["col", cols]] as const) {
      const count = axis === "row" ? this.rows : this.cols;
      for (const { index } of lines) {
        if (!Number.isInteger(index) || index < 0 || index >= count) {
          throw new RangeError(`시트 밖의 ${axis === "row" ? "행" : "열"}이다: ${index}`);
        }
      }
    }
    if (cells.length === 0 && rows.length === 0 && cols.length === 0) return;
    for (const [axis, lines] of [["row", rows], ["col", cols]] as const) {
      const ids = this.lineFormatIds[axis];
      for (const { index, format } of lines) {
        const id = format === null ? null : this.formatId(format);
        // 기본 서식인 열 서식은 없는 것과 같다. (행 서식은 열 서식을 덮으므로 기본 서식도 둔다)
        if (id === null || (axis === "col" && id === 0)) ids.delete(index);
        else ids.set(index, id);
      }
    }
    const { row: rowIds, col: colIds } = this.lineFormatIds;
    for (const { address, format } of cells) {
      const key = cellKey(address);
      const id = format === null ? null : this.formatId(format);
      const inherited = rowIds.get(address.row) ?? colIds.get(address.col) ?? 0;
      if (id === null || id === inherited) this.cellFormatIds.delete(key);
      else this.cellFormatIds.set(key, id);
    }
    for (const listener of this.formatListeners) listener(changes);
  }

  /** 서식이 바뀔 때마다 listener를 부른다. 행·열을 넣고 지울 때는 부르지 않는다. (onStructureChange로 안다) */
  onFormatChange(listener: FormatChangeListener): () => void {
    this.formatListeners.add(listener);
    return () => this.formatListeners.delete(listener);
  }

  /** 서식 표 번호. 처음 보는 서식이면 표에 넣는다. */
  private formatId(format: CellFormat): number {
    const key = formatKey(format);
    let id = this.formatIds.get(key);
    if (id === undefined) {
      id = this.formatTable.length;
      this.formatTable.push(Object.freeze({ ...format }));
      this.formatIds.set(key, id);
    }
    return id;
  }

  /**
   * 행·열을 넣거나 지운다. 뒤쪽 셀을 옮기고, 모든 수식의 참조를 Excel처럼 고친다. (structureMapping)
   * 시트 크기도 넣은 만큼 늘고 지운 만큼 줄어든다. 직접 바꾼 줄 크기와 서식도 셀처럼 옮긴다. (새로 넣은 줄은 기본 크기·서식)
   * 그다음 cells, sizes(change 축의 줄 크기), formats를 넣는다.
   * (변경 뒤 위치. 되돌릴 때 지운 셀·크기·서식과 고치기 전 수식을 되살리는 데 쓴다. formats의 셀 서식은 물려받는 서식과 같아도 그대로 둔다)
   * 알림은 onStructureChange로 한 번만 간다. onChange는 부르지 않는다.
   *
   * 편집은 StructureCommand를 거쳐야 undo가 된다. 이 메서드는 Command 안에서만 부른다.
   * 넣을 자리·지울 줄이 시트 밖이거나, 시트가 최대 크기를 넘거나 비게 되거나, cells·sizes가 새 크기 밖이면 아무것도 바꾸지 않고 RangeError를 던진다.
   */
  changeStructure(
    change: StructureChange,
    cells: readonly CellChange[] = [],
    sizes: readonly CustomSizeChange[] = [],
    formats: FormatChanges = {},
  ): StructureResult {
    if (!canChangeStructure(change, this)) {
      throw new RangeError(`시트(${this.rows}행 × ${this.cols}열)에서 할 수 없는 행·열 변경이다: ${JSON.stringify(change)}`);
    }
    const byRow = change.axis === "row";
    const size = byRow ? this.rows : this.cols;
    const { index, count } = change;
    const newSize = change.kind === "insert" ? size + count : size - count;
    const rows = byRow ? newSize : this.rows;
    const cols = byRow ? this.cols : newSize;
    for (const { address } of cells) {
      if (!inBounds(address, rows, cols)) throw new RangeError(`변경 뒤 시트 밖의 셀이다: ${toA1(address)}`);
    }
    for (const { index: line, size } of sizes) {
      if (!Number.isInteger(line) || line < 0 || line >= newSize) throw new RangeError(`변경 뒤 시트 밖의 줄이다: ${line}`);
      if (size !== null && !(size > 0 && Number.isFinite(size))) throw new RangeError(`줄 크기는 0보다 커야 한다: ${size}`);
    }
    for (const { address } of formats.cells ?? []) {
      if (!inBounds(address, rows, cols)) throw new RangeError(`변경 뒤 시트 밖의 셀이다: ${toA1(address)}`);
    }
    for (const { index: line } of [...(formats.rows ?? []), ...(formats.cols ?? [])]) {
      if (!Number.isInteger(line) || line < 0) throw new RangeError(`시트 밖의 줄이다: ${line}`);
    }
    if ((formats.rows ?? []).some(({ index: line }) => line >= rows) || (formats.cols ?? []).some(({ index: line }) => line >= cols)) {
      throw new RangeError("변경 뒤 시트 밖의 줄 서식이다");
    }

    const mapping = structureMapping(change);
    const next = new Map<number, string>();
    const removed: CellChange[] = [];
    const rewritten: CellChange[] = [];
    // 셀이 수십만 개라 주소 객체는 없어지거나 고친 셀에만 만든다.
    for (const [key, value] of this.cells) {
      const row = Math.floor(key / STRIDE);
      const col = key - row * STRIDE;
      const line = lineAfter(change, byRow ? row : col);
      if (line === null) {
        removed.push({ address: { row, col }, value });
        continue;
      }
      const nextKey = byRow ? line * STRIDE + col : row * STRIDE + line;
      if (!formulaInput(value)) {
        next.set(nextKey, value);
        continue;
      }
      const text = rewrite(value, mapping);
      if (text !== value) rewritten.push({ address: addressOf(nextKey), value });
      next.set(nextKey, text);
    }

    // 옮기고 고친 결과와 같은 값은 넣지 않고 알리지도 않는다.
    const changed: CellAddress[] = [];
    for (const { address, value } of cells) {
      const key = keyOf(address);
      if ((next.get(key) ?? "") === value) continue;
      if (value === "") next.delete(key);
      else next.set(key, value);
      changed.push(address);
    }

    // 줄 크기는 바뀐 축만 옮긴다.
    const nextSizes = new Map<number, number>();
    const removedSizes: CustomSizeChange[] = [];
    for (const [line, size] of this.sizes[change.axis]) {
      const after = lineAfter(change, line);
      if (after === null) removedSizes.push({ index: line, size });
      else nextSizes.set(after, size);
    }
    for (const { index: line, size } of sizes) {
      if (size === null) nextSizes.delete(line);
      else nextSizes.set(line, size);
    }

    // 셀 서식은 셀처럼, 줄 서식은 줄 크기처럼 바뀐 축만 옮긴다.
    const nextCellFormats = new Map<number, number>();
    const removedCellFormats: CellFormatChange[] = [];
    for (const [key, id] of this.cellFormatIds) {
      const row = Math.floor(key / STRIDE);
      const col = key - row * STRIDE;
      const line = lineAfter(change, byRow ? row : col);
      if (line === null) removedCellFormats.push({ address: { row, col }, format: this.formatTable[id]! });
      else nextCellFormats.set(byRow ? line * STRIDE + col : row * STRIDE + line, id);
    }
    const nextLineFormats = new Map<number, number>();
    const removedLineFormats: LineFormatChange[] = [];
    for (const [line, id] of this.lineFormatIds[change.axis]) {
      const after = lineAfter(change, line);
      if (after === null) removedLineFormats.push({ index: line, format: this.formatTable[id]! });
      else nextLineFormats.set(after, id);
    }
    const lineFormatIds = { ...this.lineFormatIds, [change.axis]: nextLineFormats };
    for (const [axis, lines] of [["row", formats.rows ?? []], ["col", formats.cols ?? []]] as const) {
      for (const { index: line, format } of lines) {
        if (format === null) lineFormatIds[axis].delete(line);
        else lineFormatIds[axis].set(line, this.formatId(format));
      }
    }
    for (const { address, format } of formats.cells ?? []) {
      if (format === null) nextCellFormats.delete(cellKey(address));
      else nextCellFormats.set(cellKey(address), this.formatId(format));
    }

    this.cells = next;
    this.sizes = { ...this.sizes, [change.axis]: nextSizes };
    this.cellFormatIds = nextCellFormats;
    this.lineFormatIds = lineFormatIds;
    this.rows = rows;
    this.cols = cols;
    for (const listener of this.structureListeners) listener(change, changed);
    const removedFormats: FormatChanges = { cells: removedCellFormats, [byRow ? "rows" : "cols"]: removedLineFormats };
    return { removed, rewritten, removedSizes, removedFormats };
  }

  /** 행·열을 넣거나 지울 때마다 listener를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onStructureChange(listener: StructureChangeListener): () => void {
    this.structureListeners.add(listener);
    return () => this.structureListeners.delete(listener);
  }

  private contains(address: CellAddress): boolean {
    return inBounds(address, this.rows, this.cols);
  }
}

function inBounds({ row, col }: CellAddress, rows: number, cols: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < rows && col < cols;
}

function assertCount(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name}는 1 이상 ${max} 이하의 정수여야 한다: ${value}`);
  }
}
