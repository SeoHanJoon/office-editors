import { MAX_COLS, MAX_ROWS, cellKey, keyToAddress, toA1, type CellAddress } from "./address";
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
}

/**
 * 시트 한 장의 셀 값. 셀에는 사용자가 입력한 글자를 그대로 저장한다. ("12", "=A1+1")
 * 값이 있는 셀만 Map에 넣으므로 빈 셀은 메모리를 쓰지 않는다.
 */
export class Sheet {
  private rows: number;
  private cols: number;
  /** 키는 cellKey(주소). 값은 빈 문자열이 아니다. */
  private cells = new Map<number, string>();
  private readonly listeners = new Set<SheetChangeListener>();
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
    for (const [key, value] of this.cells) yield [keyToAddress(key), value];
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

  /**
   * 행·열을 넣거나 지운다. 뒤쪽 셀을 옮기고, 모든 수식의 참조를 Excel처럼 고친다. (structureMapping)
   * 시트 크기도 넣은 만큼 늘고 지운 만큼 줄어든다.
   * 그다음 cells를 넣는다. (변경 뒤 주소. 되돌릴 때 지운 셀과 고치기 전 수식을 되살리는 데 쓴다)
   * 알림은 onStructureChange로 한 번만 간다. onChange는 부르지 않는다.
   *
   * 편집은 StructureCommand를 거쳐야 undo가 된다. 이 메서드는 Command 안에서만 부른다.
   * 넣을 자리·지울 줄이 시트 밖이거나, 시트가 최대 크기를 넘거나 비게 되거나, cells가 새 크기 밖이면 아무것도 바꾸지 않고 RangeError를 던진다.
   */
  changeStructure(change: StructureChange, cells: readonly CellChange[] = []): StructureResult {
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

    this.cells = next;
    this.rows = rows;
    this.cols = cols;
    for (const listener of this.structureListeners) listener(change, changed);
    return { removed, rewritten };
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
