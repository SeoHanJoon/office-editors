import { MAX_COLS, MAX_ROWS, cellKey, keyToAddress, toA1, type CellAddress } from "./address";

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
 * 시트 한 장의 셀 값. 셀에는 사용자가 입력한 글자를 그대로 저장한다. ("12", "=A1+1")
 * 값이 있는 셀만 Map에 넣으므로 빈 셀은 메모리를 쓰지 않는다.
 */
export class Sheet {
  readonly rowCount: number;
  readonly colCount: number;
  /** 키는 cellKey(주소). 값은 빈 문자열이 아니다. */
  private readonly cells = new Map<number, string>();
  private readonly listeners = new Set<SheetChangeListener>();

  constructor({ rowCount, colCount, data = [] }: SheetOptions) {
    assertCount("rowCount", rowCount, MAX_ROWS);
    assertCount("colCount", colCount, MAX_COLS);
    if (data.length > rowCount || data.some((row) => row.length > colCount)) {
      throw new RangeError(`data가 시트 크기(${rowCount}행 × ${colCount}열)보다 크다`);
    }
    this.rowCount = rowCount;
    this.colCount = colCount;
    data.forEach((values, row) => {
      values.forEach((value, col) => {
        if (value !== "") this.cells.set(cellKey({ row, col }), value);
      });
    });
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

  private contains({ row, col }: CellAddress): boolean {
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < this.rowCount && col < this.colCount;
  }
}

function assertCount(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name}는 1 이상 ${max} 이하의 정수여야 한다: ${value}`);
  }
}
