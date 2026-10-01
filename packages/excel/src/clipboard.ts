import { cellKey, type CellRange } from "./address";
import { formatCellValue } from "./cell-format";
import type { FormulaEngine } from "./formula-engine";
import { copyMapping, moveMapping, rewriteFormula } from "./formula-references";
import { isFormula } from "./formula-value";
import type { CellChange, Sheet } from "./sheet";

/**
 * 셀 값들을 Excel이 클립보드에 넣는 text/plain 모양으로 쓴다.
 * 칸은 탭, 행은 CRLF로 나누고 마지막 행 뒤에도 CRLF를 붙인다.
 * 줄바꿈·탭·큰따옴표가 든 칸은 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. (`a"b` → `"a""b"`)
 */
export function toClipboardText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quote).join("\t") + "\r\n").join("");
}

function quote(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * 클립보드 text/plain을 칸으로 나눈다. (Excel이 다른 프로그램의 글자를 붙여넣을 때와 같음)
 * - 탭으로 칸을, 줄바꿈(CRLF, LF, CR)으로 행을 나눈다. 끝에 붙은 줄바꿈 하나는 빈 행을 만들지 않는다.
 * - 큰따옴표로 시작하는 칸은 닫는 큰따옴표까지 한 칸이다. 안의 탭·줄바꿈도 칸 내용이고 `""`는 `"` 하나다.
 * - 칸 중간의 큰따옴표는 글자 그대로다.
 * 행마다 칸 수가 다르면 가장 긴 행에 맞춰 빈 칸("")을 채운다. 빈 글자는 빈 칸 하나다.
 */
export function parseClipboardText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let pos = 0;
  for (;;) {
    let value = "";
    if (text[pos] === '"') {
      // 닫는 큰따옴표를 찾는다. 없으면 여는 큰따옴표도 글자로 보고 아래에서 보통 칸으로 읽는다.
      let i = pos + 1;
      let quoted = "";
      let closed = false;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            quoted += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        quoted += text[i];
        i++;
      }
      if (closed) {
        value = quoted;
        pos = i;
      }
    }
    // 보통 칸(또는 닫는 큰따옴표 뒤에 남은 글자)은 탭이나 줄바꿈까지다.
    let end = pos;
    while (end < text.length && text[end] !== "\t" && text[end] !== "\n" && text[end] !== "\r") end++;
    value += text.slice(pos, end);
    row.push(value);
    pos = end;
    if (pos >= text.length) break;
    if (text[pos] === "\t") {
      pos++;
      continue;
    }
    pos += text[pos] === "\r" && text[pos + 1] === "\n" ? 2 : 1;
    rows.push(row);
    row = [];
    if (pos >= text.length) break; // 끝에 붙은 줄바꿈
  }
  if (row.length > 0) rows.push(row);
  let width = 0;
  for (const cells of rows) width = Math.max(width, cells.length);
  for (const cells of rows) while (cells.length < width) cells.push("");
  return rows;
}

/**
 * 붙여넣을 범위. 고른 범위가 원본(rows × cols)의 배수이면 고른 범위 전체에 원본을 반복해서 채운다.
 * 아니면 고른 범위의 왼쪽 위에서 원본 크기만큼 한 번 붙인다. (Excel과 같음)
 */
export function pasteArea(selection: CellRange, rows: number, cols: number): CellRange {
  const height = selection.bottom - selection.top + 1;
  const width = selection.right - selection.left + 1;
  if (height % rows === 0 && width % cols === 0) return selection;
  return { top: selection.top, left: selection.left, bottom: selection.top + rows - 1, right: selection.left + cols - 1 };
}

/** 범위가 시트 안에 다 들어가는지 */
export function fitsSheet(sheet: Pick<Sheet, "rowCount" | "colCount">, range: CellRange): boolean {
  return range.top >= 0 && range.left >= 0 && range.bottom < sheet.rowCount && range.right < sheet.colCount;
}

/** 범위의 셀에 보이는 값을 클립보드 글자로. 수식 셀은 계산값, 계산 중인 셀은 빈 칸이다. 숫자는 숫자 형식대로 쓴다. (Excel과 같음) */
export function copyText(sheet: Sheet, engine: FormulaEngine, range: CellRange): string {
  const rows: string[][] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col++) {
      const address = { row, col };
      cells.push(sheet.has(address) ? formatCellValue(engine.getValue(address), sheet.format(address)) : "");
    }
    rows.push(cells);
  }
  return toClipboardText(rows);
}

/**
 * 앱 안에서 복사한 source 범위를 target 범위에 붙여넣는 변경. target이 source보다 크면 반복해서 채운다.
 * 셀에 입력된 글자를 그대로 옮기고, 수식은 옮긴 거리만큼 상대 참조를 옮긴다. 빈 셀은 target 칸을 비운다.
 * 붙이기 전의 source 글자로 만들므로 source와 target이 겹쳐도 된다.
 */
export function pasteCopyChanges(sheet: Sheet, source: CellRange, target: CellRange): CellChange[] {
  const height = source.bottom - source.top + 1;
  const width = source.right - source.left + 1;
  const changes: CellChange[] = [];
  for (let row = target.top; row <= target.bottom; row++) {
    const fromRow = source.top + ((row - target.top) % height);
    for (let col = target.left; col <= target.right; col++) {
      const fromCol = source.left + ((col - target.left) % width);
      const text = sheet.get({ row: fromRow, col: fromCol });
      const value = isFormula(text) ? rewriteFormula(text, copyMapping(row - fromRow, col - fromCol)) : text;
      changes.push({ address: { row, col }, value });
    }
  }
  return changes;
}

/** 밖에서 가져온 글자 칸(values)을 target 범위에 붙여넣는 변경. target이 더 크면 반복해서 채운다. 글자는 입력한 것처럼 그대로 넣는다. */
export function pasteTextChanges(values: readonly (readonly string[])[], target: CellRange): CellChange[] {
  const height = values.length;
  const width = values[0]!.length;
  const changes: CellChange[] = [];
  for (let row = target.top; row <= target.bottom; row++) {
    const cells = values[(row - target.top) % height]!;
    for (let col = target.left; col <= target.right; col++) {
      changes.push({ address: { row, col }, value: cells[(col - target.left) % width]! });
    }
  }
  return changes;
}

/**
 * 잘라낸 source 범위를 (top, left)로 옮기는 변경. (Excel의 잘라내기 → 붙여넣기)
 * - source 셀들의 글자를 옮기고, source 자리 중 옮긴 곳과 겹치지 않는 칸은 비운다.
 * - 시트의 모든 수식(옮긴 수식 포함)의 참조를 moveMapping대로 고친다. 옮긴 셀을 가리키던 참조는 새 위치를 따라간다.
 * 수식을 모두 훑으므로 수식 수에 비례해 걸린다.
 */
export function moveChanges(sheet: Sheet, source: CellRange, top: number, left: number): CellChange[] {
  const rowOffset = top - source.top;
  const colOffset = left - source.left;
  const mapping = moveMapping(source, rowOffset, colOffset);
  const target: CellRange = {
    top,
    left,
    bottom: source.bottom + rowOffset,
    right: source.right + colOffset,
  };
  const inside = (range: CellRange, row: number, col: number) =>
    row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
  const changes = new Map<number, CellChange>();

  // 옮기지 않는 수식: 참조만 고친다. (target 안의 수식은 덮어쓰이므로 건너뛴다)
  for (const [address, text] of sheet.entries()) {
    if (!isFormula(text) || inside(source, address.row, address.col) || inside(target, address.row, address.col)) continue;
    const value = rewriteFormula(text, mapping);
    if (value !== text) changes.set(cellKey(address), { address, value });
  }
  for (let row = source.top; row <= source.bottom; row++) {
    for (let col = source.left; col <= source.right; col++) {
      const address = { row, col };
      if (!inside(target, row, col)) changes.set(cellKey(address), { address, value: "" });
    }
  }
  for (let row = source.top; row <= source.bottom; row++) {
    for (let col = source.left; col <= source.right; col++) {
      const text = sheet.get({ row, col });
      const address = { row: row + rowOffset, col: col + colOffset };
      changes.set(cellKey(address), { address, value: isFormula(text) ? rewriteFormula(text, mapping) : text });
    }
  }
  return [...changes.values()];
}
