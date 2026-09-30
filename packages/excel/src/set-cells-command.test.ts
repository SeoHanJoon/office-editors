import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { parseA1 } from "./address";
import { SetCellsCommand } from "./set-cells-command";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

/** A1="가", B1="나"인 2행 × 2열 시트 */
function createSheet(): Sheet {
  return new Sheet({ rowCount: 2, colCount: 2, data: [["가", "나"]] });
}

/** 시트 전체 값을 [A1, B1, A2, B2] 순서로 */
function values(sheet: Sheet): string[] {
  return ["A1", "B1", "A2", "B2"].map((a1) => sheet.get(at(a1)));
}

describe("SetCellsCommand", () => {
  test("실행하면 셀 값을 바꾸고, undo하면 처음 값으로 돌아간다", () => {
    const sheet = createSheet();
    const command = new SetCellsCommand(sheet, [
      { address: at("A1"), value: "한글" },
      { address: at("A2"), value: "12" },
      { address: at("B1"), value: "" },
    ]);

    command.execute();
    expect(values(sheet)).toEqual(["한글", "", "12", ""]);

    command.undo();
    expect(values(sheet)).toEqual(["가", "나", "", ""]);
    expect(sheet.size).toBe(2);
  });

  test("undo 뒤에 다시 실행하면 같은 결과가 된다", () => {
    const sheet = createSheet();
    const command = new SetCellsCommand(sheet, [{ address: at("A1"), value: "다" }]);

    command.execute();
    command.undo();
    command.execute();

    expect(values(sheet)).toEqual(["다", "나", "", ""]);
  });

  test("같은 셀이 여러 번 들어 있으면 마지막 값이 남고, undo하면 처음 값으로 돌아간다", () => {
    const sheet = createSheet();
    const command = new SetCellsCommand(sheet, [
      { address: at("A1"), value: "x" },
      { address: at("A1"), value: "y" },
    ]);

    command.execute();
    expect(sheet.get(at("A1"))).toBe("y");

    command.undo();
    expect(sheet.get(at("A1"))).toBe("가");
  });

  test("만든 뒤에 넘긴 배열을 바꿔도 편집 내용은 그대로다", () => {
    const sheet = createSheet();
    const changes = [{ address: at("A1"), value: "x" }];
    const command = new SetCellsCommand(sheet, changes);

    changes.push({ address: at("B1"), value: "y" });
    command.execute();

    expect(values(sheet)).toEqual(["x", "나", "", ""]);
  });

  test("History로 실행하면 undo/redo가 된다", () => {
    const sheet = createSheet();
    const history = new History();

    history.execute(new SetCellsCommand(sheet, [{ address: at("A1"), value: "하나" }]));
    history.execute(new SetCellsCommand(sheet, [{ address: at("A1"), value: "둘" }]));
    expect(sheet.get(at("A1"))).toBe("둘");

    history.undo();
    expect(sheet.get(at("A1"))).toBe("하나");
    history.undo();
    expect(sheet.get(at("A1"))).toBe("가");
    history.redo();
    expect(sheet.get(at("A1"))).toBe("하나");
  });

  test("undo와 redo도 바뀐 셀을 알린다", () => {
    const sheet = createSheet();
    const history = new History();
    const changed: string[][] = [];
    sheet.onChange((addresses) => changed.push(addresses.map((a) => `${a.row},${a.col}`)));

    history.execute(new SetCellsCommand(sheet, [{ address: at("B2"), value: "x" }]));
    history.undo();
    history.redo();

    expect(changed).toEqual([["1,1"], ["1,1"], ["1,1"]]);
  });

  test("시트 밖 셀이 있으면 실행이 실패하고 History에 기록되지 않는다", () => {
    const sheet = createSheet();
    const history = new History();

    expect(() =>
      history.execute(new SetCellsCommand(sheet, [{ address: { row: 5, col: 0 }, value: "x" }])),
    ).toThrow(RangeError);
    expect(history.canUndo).toBe(false);
    expect(values(sheet)).toEqual(["가", "나", "", ""]);
  });

  test("execute 전에 undo하면 에러를 던진다", () => {
    const command = new SetCellsCommand(createSheet(), []);

    expect(() => command.undo()).toThrow();
  });
});
