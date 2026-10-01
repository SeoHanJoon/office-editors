import type { CellAddress } from "./address";
import { isFormula } from "./formula-value";
import type { Sheet } from "./sheet";

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const formulaInput = isFormula;

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

/**
 * 행마다 가장 많은 줄 수. 행 높이 자동 맞춤에 쓴다. 저장하지 않고 셀 글자에서 다시 만든다. (ADR 0031)
 * 두 줄 이상인 셀만 행 → 열 → 줄 수로 기억해서, 셀이 바뀌면 바뀐 셀만 보고 그 행의 최댓값을 다시 구한다.
 */
export class AutoRowLines {
  private readonly sheet: Sheet;
  /** 행 → (열 → 줄 수). 두 줄 이상인 셀만 들어 있다. */
  private cells = new Map<number, Map<number, number>>();
  /** 행 → 가장 많은 줄 수. 2 이상인 행만 들어 있다. */
  private maxLines = new Map<number, number>();

  constructor(sheet: Sheet) {
    this.sheet = sheet;
    this.rebuild();
  }

  /** 시트 전체를 다시 훑는다. 처음과 행·열을 넣고 지운 뒤에 부른다. */
  rebuild(): void {
    this.cells = new Map();
    this.maxLines = new Map();
    for (const [address, input] of this.sheet.entries()) {
      // 줄바꿈이 없는 셀(거의 전부)은 글자만 한 번 보고 넘어간다.
      if (input.indexOf("\n") < 0 && input.indexOf("\r") < 0) continue;
      this.set(address, inputLineCount(input));
    }
    for (const row of this.cells.keys()) this.refresh(row);
  }

  /** 값이 바뀐 셀을 반영한다. 가장 많은 줄 수가 바뀐 행이 있으면 true */
  update(addresses: readonly CellAddress[]): boolean {
    const touched = new Set<number>();
    for (const address of addresses) {
      const lines = inputLineCount(this.sheet.get(address));
      if (lines > 1 || this.cells.get(address.row)?.has(address.col)) {
        this.set(address, lines);
        touched.add(address.row);
      }
    }
    let changed = false;
    for (const row of touched) changed = this.refresh(row) || changed;
    return changed;
  }

  /** 행에서 가장 많은 줄 수. 줄바꿈이 든 셀이 없으면 1 */
  lines(row: number): number {
    return this.maxLines.get(row) ?? 1;
  }

  /** 두 줄 이상인 행을 [행, 줄 수]로 훑는다. 순서는 정해져 있지 않다. */
  entries(): IterableIterator<[number, number]> {
    return this.maxLines.entries();
  }

  private set({ row, col }: CellAddress, lines: number): void {
    let byCol = this.cells.get(row);
    if (lines > 1) {
      if (!byCol) this.cells.set(row, (byCol = new Map()));
      byCol.set(col, lines);
    } else if (byCol) {
      byCol.delete(col);
      if (byCol.size === 0) this.cells.delete(row);
    }
  }

  /** 행의 가장 많은 줄 수를 다시 구한다. 바뀌었으면 true */
  private refresh(row: number): boolean {
    let max = 1;
    for (const lines of this.cells.get(row)?.values() ?? []) max = Math.max(max, lines);
    if (max === this.lines(row)) return false;
    if (max > 1) this.maxLines.set(row, max);
    else this.maxLines.delete(row);
    return true;
  }
}
