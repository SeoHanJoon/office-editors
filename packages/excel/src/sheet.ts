import { MAX_COLS, MAX_ROWS, type CellAddress } from "./address";

export interface SheetOptions {
  /** 행 수. 1 이상 MAX_ROWS 이하 */
  rowCount: number;
  /** 열 수. 1 이상 MAX_COLS 이하 */
  colCount: number;
  /** 처음 값. data[행][열]. 빈 문자열은 빈 셀로 본다. */
  data?: readonly (readonly string[])[];
}

/**
 * 시트 한 장의 셀 값. 셀에는 사용자가 입력한 글자를 그대로 저장한다. ("12", "=A1+1")
 * 값이 있는 셀만 Map에 넣으므로 빈 셀은 메모리를 쓰지 않는다.
 */
export class Sheet {
  readonly rowCount: number;
  readonly colCount: number;
  /** 키는 cellKey(주소). 값은 빈 문자열이 아니다. */
  private readonly cells = new Map<number, string>();

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
}

/** 주소를 숫자 키 하나로 바꾼다. 열 수가 바뀌어도 키가 그대로이도록 Excel 최대 열 수를 곱한다. */
function cellKey({ row, col }: CellAddress): number {
  return row * MAX_COLS + col;
}

function assertCount(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name}는 1 이상 ${max} 이하의 정수여야 한다: ${value}`);
  }
}
