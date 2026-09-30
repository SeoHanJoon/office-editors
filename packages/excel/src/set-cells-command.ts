import type { Command } from "@office/command-core";
import type { CellChange, Sheet } from "./sheet";

/**
 * 여러 셀의 값을 바꾸는 편집 한 번. 셀 하나 입력도, 범위 지우기도 이 Command 하나로 한다.
 * execute할 때 바꾸기 전 값을 기억해 두었다가 undo할 때 되돌린다.
 */
export class SetCellsCommand implements Command {
  private readonly sheet: Sheet;
  private readonly changes: readonly CellChange[];
  /** 마지막 execute 직전 값. execute 전에는 null */
  private previous: readonly CellChange[] | null = null;

  constructor(sheet: Sheet, changes: readonly CellChange[]) {
    this.sheet = sheet;
    this.changes = [...changes];
  }

  execute(): void {
    // 같은 셀이 여러 번 들어 있어도 되돌릴 값은 바꾸기 전 값이 되도록 먼저 모두 읽는다.
    const previous = this.changes.map(({ address }) => ({ address, value: this.sheet.get(address) }));
    this.sheet.setCells(this.changes);
    this.previous = previous;
  }

  undo(): void {
    if (!this.previous) throw new Error("execute 전에는 undo할 수 없다");
    this.sheet.setCells(this.previous);
  }
}
