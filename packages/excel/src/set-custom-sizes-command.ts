import type { Command } from "@office/command-core";
import type { Axis, CustomSizeChange, Sheet } from "./sheet";

/**
 * 한 축의 줄 크기를 바꾸는 편집 한 번. 경계선을 끌거나 두 번 클릭해 여러 줄을 함께 바꿔도 이 Command 하나다.
 * execute할 때 바꾸기 전 크기를 기억해 두었다가 undo할 때 되돌린다.
 */
export class SetCustomSizesCommand implements Command {
  private readonly sheet: Sheet;
  readonly axis: Axis;
  private readonly changes: readonly CustomSizeChange[];
  /** 마지막 execute 직전 크기. execute 전에는 null */
  private previous: readonly CustomSizeChange[] | null = null;

  constructor(sheet: Sheet, axis: Axis, changes: readonly CustomSizeChange[]) {
    this.sheet = sheet;
    this.axis = axis;
    this.changes = [...changes];
  }

  execute(): void {
    // 같은 줄이 여러 번 들어 있어도 되돌릴 크기는 바꾸기 전 크기가 되도록 먼저 모두 읽는다.
    const previous = this.changes.map(({ index }) => ({ index, size: this.sheet.customSize(this.axis, index) }));
    this.sheet.setCustomSizes(this.axis, this.changes);
    this.previous = previous;
  }

  undo(): void {
    if (!this.previous) throw new Error("execute 전에는 undo할 수 없다");
    this.sheet.setCustomSizes(this.axis, this.previous);
  }
}
