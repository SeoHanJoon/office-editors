/** Excel 시트 한 장의 최대 행 수 (1,048,576) */
export const MAX_ROWS = 1_048_576;
/** Excel 시트 한 장의 최대 열 수 (16,384 = XFD열) */
export const MAX_COLS = 16_384;

/** 셀 위치. 0부터 센다. A1 = { row: 0, col: 0 } */
export interface CellAddress {
  readonly row: number;
  readonly col: number;
}

/** 여러 셀을 덮는 사각형 범위. 양 끝 행·열을 포함한다. */
export interface CellRange {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** 주소를 숫자 키 하나로 바꾼다. 열 수가 바뀌어도 키가 그대로이도록 Excel 최대 열 수를 곱한다. (ADR 0008) */
export function cellKey({ row, col }: CellAddress): number {
  return row * MAX_COLS + col;
}

/** cellKey로 만든 키를 주소로 되돌린다. */
export function keyToAddress(key: number): CellAddress {
  return { row: Math.floor(key / MAX_COLS), col: key % MAX_COLS };
}

/** 열 번호를 열 이름으로 바꾼다. 0 → "A", 25 → "Z", 26 → "AA" */
export function columnName(col: number): string {
  let name = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** 셀 주소를 "A1" 형태로 바꾼다. */
export function toA1({ row, col }: CellAddress): string {
  return `${columnName(col)}${row + 1}`;
}

/** "A1" 형태의 글자를 셀 주소로 바꾼다. 대소문자는 가리지 않는다. 잘못됐거나 시트 밖이면 null */
export function parseA1(text: string): CellAddress | null {
  const match = /^([A-Za-z]{1,3})([1-9]\d{0,6})$/.exec(text);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]!.toUpperCase()) col = col * 26 + (char.charCodeAt(0) - 64);
  const row = Number(match[2]);
  if (col > MAX_COLS || row > MAX_ROWS) return null;
  return { row: row - 1, col: col - 1 };
}

/** 범위를 "A1:C3" 형태로 바꾼다. 셀 하나면 "A1" */
export function rangeToA1(range: CellRange): string {
  const start = toA1({ row: range.top, col: range.left });
  if (range.top === range.bottom && range.left === range.right) return start;
  return `${start}:${toA1({ row: range.bottom, col: range.right })}`;
}
