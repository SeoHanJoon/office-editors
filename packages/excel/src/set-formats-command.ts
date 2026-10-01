import type { Command } from "@office/command-core";
import type { FormatChanges, Sheet } from "./sheet";

/**
 * 서식을 바꾸는 편집 한 번. 툴바 버튼 한 번, 서식 붙여넣기 한 번이 이 Command 하나다.
 * execute할 때 바꾸기 전 셀 서식·줄 서식을 기억해 두었다가 undo할 때 되돌린다.
 */
export class SetFormatsCommand implements Command {
  private readonly sheet: Sheet;
  private readonly changes: FormatChanges;
  /** 마지막 execute 직전 서식. execute 전에는 null */
  private previous: FormatChanges | null = null;

  constructor(sheet: Sheet, changes: FormatChanges) {
    this.sheet = sheet;
    this.changes = { cells: [...(changes.cells ?? [])], rows: [...(changes.rows ?? [])], cols: [...(changes.cols ?? [])] };
  }

  /** 바꿀 것이 없는지 */
  get empty(): boolean {
    const { cells = [], rows = [], cols = [] } = this.changes;
    return cells.length === 0 && rows.length === 0 && cols.length === 0;
  }

  execute(): void {
    // 같은 셀·줄이 여러 번 들어 있어도 되돌릴 서식은 바꾸기 전 서식이 되도록 먼저 모두 읽는다.
    const { cells = [], rows = [], cols = [] } = this.changes;
    const previous: FormatChanges = {
      cells: cells.map(({ address }) => ({ address, format: this.sheet.cellFormat(address) })),
      rows: rows.map(({ index }) => ({ index, format: this.sheet.lineFormat("row", index) })),
      cols: cols.map(({ index }) => ({ index, format: this.sheet.lineFormat("col", index) })),
    };
    this.sheet.setFormats(this.changes);
    this.previous = previous;
  }

  undo(): void {
    if (!this.previous) throw new Error("execute 전에는 undo할 수 없다");
    this.sheet.setFormats(this.previous);
  }
}
