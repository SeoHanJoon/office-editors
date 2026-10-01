import { describe, expect, test } from "vitest";
import { parseA1 } from "./address";
import { AutoRowLines, inputLineCount } from "./auto-row-lines";
import { SetCellsCommand } from "./set-cells-command";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

describe("입력한 글자의 줄 수", () => {
  test("줄바꿈 수 + 1이다. \\r\\n은 한 번으로 센다", () => {
    expect(inputLineCount("")).toBe(1);
    expect(inputLineCount("한 줄")).toBe(1);
    expect(inputLineCount("가\n나\n다")).toBe(3);
    expect(inputLineCount("가\r\n나\r다")).toBe(3);
    expect(inputLineCount("끝에 줄바꿈\n")).toBe(2);
  });

  test("수식은 결과에 줄바꿈이 있어도 한 줄이다", () => {
    expect(inputLineCount('="가"&CHAR(10)&"나"')).toBe(1);
  });
});

describe("행마다 가장 많은 줄 수", () => {
  test("처음 시트에서 줄바꿈이 든 셀의 행만 센다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3, data: [["a", "b\nc"], ["x"], ["1\n2\n3", "4\n5"]] });
    const auto = new AutoRowLines(sheet);

    expect([auto.lines(0), auto.lines(1), auto.lines(2), auto.lines(3)]).toEqual([2, 1, 3, 1]);
    expect(new Map(auto.entries())).toEqual(new Map([[0, 2], [2, 3]]));
  });

  test("셀이 바뀌면 그 행만 다시 세고, 바뀐 행이 있을 때만 true다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3, data: [["a\nb", "c\nd\ne"]] });
    const auto = new AutoRowLines(sheet);

    // 가장 긴 셀(3줄)을 지우면 남은 셀(2줄)에 맞춰 준다.
    sheet.setCells([{ address: at("B1"), value: "" }]);
    expect(auto.update([at("B1")])).toBe(true);
    expect(auto.lines(0)).toBe(2);

    // 줄바꿈 없는 셀을 고치면 아무것도 바뀌지 않는다.
    sheet.setCells([{ address: at("C3"), value: "그냥 글자" }]);
    expect(auto.update([at("C3")])).toBe(false);

    sheet.setCells([{ address: at("A1"), value: "한 줄" }]);
    expect(auto.update([at("A1")])).toBe(true);
    expect(auto.lines(0)).toBe(1);
    expect([...auto.entries()]).toEqual([]);
  });

  test("undo로 되돌아온 줄바꿈도 다시 센다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3 });
    const auto = new AutoRowLines(sheet);
    sheet.onChange((addresses) => auto.update(addresses));
    const command = new SetCellsCommand(sheet, [{ address: at("B4"), value: "1\n2\n3\n4" }]);

    command.execute();
    expect(auto.lines(3)).toBe(4);
    command.undo();
    expect(auto.lines(3)).toBe(1);
  });

  test("행을 넣고 지운 뒤 다시 훑으면 옮겨진 행을 센다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3, data: [[], ["a\nb"]] });
    const auto = new AutoRowLines(sheet);

    sheet.changeStructure({ kind: "insert", axis: "row", index: 0, count: 2 });
    auto.rebuild();

    expect([...auto.entries()]).toEqual([[3, 2]]);
  });
});
