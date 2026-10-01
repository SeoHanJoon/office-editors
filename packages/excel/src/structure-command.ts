import type { Command } from "@office/command-core";
import type { CellFormatChange, CellChange, CustomSizeChange, LineFormatChange, Sheet, StructureResult } from "./sheet";
import { inverseChange, mapLine, type StructureChange } from "./structure";

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const lineAfter = mapLine;

/**
 * 행·열 삽입이나 삭제 한 번. 셀을 옮기고 수식 참조를 고치는 일은 Sheet.changeStructure가 한다.
 *
 * undo는 반대 변경(삽입 ↔ 삭제)을 하고, 지운 셀·줄 크기와 참조를 고치기 전 수식 글자를 되살린다.
 * 반대 변경만으로는 원래대로 돌아오지 않는 수식이 있어서다. (`#REF!`가 된 참조, 범위 첫 행을 지워 줄어든 범위)
 * 반대 변경으로 이미 원래 글자가 된 수식은 Sheet가 걸러서 알리지 않는다.
 *
 * 넣은 줄은 바로 위(왼쪽) 줄의 서식과 직접 바꾼 크기를 물려받는다. 맨 앞에 넣으면 기본 서식·크기다. (Excel과 같음, ADR 0036)
 * 물려받기는 execute마다 다시 하고, undo는 넣은 줄을 지우므로 따로 되돌릴 것이 없다.
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
    if (this.change.kind === "insert") this.inheritFromBefore();
  }

  /** 넣은 줄들에 바로 앞 줄의 줄 서식, 셀 서식, 직접 바꾼 크기를 준다. */
  private inheritFromBefore(): void {
    const { sheet } = this;
    const { axis, index, count } = this.change;
    if (index === 0) return;
    const before = index - 1;
    const byRow = axis === "row";
    const cells: CellFormatChange[] = [];
    for (const [address, format] of sheet.cellFormats()) {
      if ((byRow ? address.row : address.col) !== before) continue;
      for (let line = index; line < index + count; line++) {
        cells.push({ address: byRow ? { row: line, col: address.col } : { row: address.row, col: line }, format });
      }
    }
    const lineFormat = sheet.lineFormat(axis, before);
    const lines: LineFormatChange[] = [];
    const size = sheet.customSize(axis, before);
    const sizes: CustomSizeChange[] = [];
    for (let line = index; line < index + count; line++) {
      if (lineFormat !== null) lines.push({ index: line, format: lineFormat });
      if (size !== null) sizes.push({ index: line, size });
    }
    sheet.setFormats(byRow ? { cells, rows: lines } : { cells, cols: lines });
    sheet.setCustomSizes(axis, sizes);
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
    this.sheet.changeStructure(inverse, restore, this.result.removedSizes, this.result.removedFormats);
  }
}
