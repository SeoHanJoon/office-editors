import type { Command } from "@office/command-core";
import type { CellChange, Sheet, StructureResult } from "./sheet";
import { inverseChange, mapLine, type StructureChange } from "./structure";

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const lineAfter = mapLine;

/**
 * 행·열 삽입이나 삭제 한 번. 셀을 옮기고 수식 참조를 고치는 일은 Sheet.changeStructure가 한다.
 *
 * undo는 반대 변경(삽입 ↔ 삭제)을 하고, 지운 셀·줄 크기와 참조를 고치기 전 수식 글자를 되살린다.
 * 반대 변경만으로는 원래대로 돌아오지 않는 수식이 있어서다. (`#REF!`가 된 참조, 범위 첫 행을 지워 줄어든 범위)
 * 반대 변경으로 이미 원래 글자가 된 수식은 Sheet가 걸러서 알리지 않는다.
 */
export class StructureCommand implements Command {
  private readonly sheet: Sheet;
  readonly change: StructureChange;
  /** 마지막 execute가 없애거나 고친 것. execute 전에는 null */
  private result: StructureResult | null = null;

  constructor(sheet: Sheet, change: StructureChange) {
    this.sheet = sheet;
    this.change = { ...change };
  }

  execute(): void {
    this.result = this.sheet.changeStructure(this.change);
  }

  undo(): void {
    if (!this.result) throw new Error("execute 전에는 undo할 수 없다");
    const inverse = inverseChange(this.change);
    const byRow = inverse.axis === "row";
    const restore: CellChange[] = [...this.result.removed];
    for (const { address, value } of this.result.rewritten) {
      // 고친 수식은 지운 줄에 있지 않으므로 반대 변경으로 늘 제자리를 찾는다.
      const line = lineAfter(inverse, byRow ? address.row : address.col)!;
      restore.push({ address: byRow ? { row: line, col: address.col } : { row: address.row, col: line }, value });
    }
    this.sheet.changeStructure(inverse, restore, this.result.removedSizes);
  }
}
