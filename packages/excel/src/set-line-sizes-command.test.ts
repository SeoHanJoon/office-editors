import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { SetLineSizesCommand } from "./set-line-sizes-command";
import { Sheet, type Axis } from "./sheet";

function createSheet(): Sheet {
  return new Sheet({ rowCount: 10, colCount: 5 });
}

/** 직접 바꾼 크기를 { 줄 번호: 크기 } 모양으로 (비교하기 쉽게) */
function sizes(sheet: Sheet, axis: Axis): Record<number, number> {
  return Object.fromEntries(sheet.lineSizes(axis));
}

describe("Sheet 줄 크기", () => {
  test("처음에는 직접 바꾼 크기가 없다", () => {
    const sheet = createSheet();

    expect(sheet.lineSize("row", 0)).toBeNull();
    expect(sizes(sheet, "row")).toEqual({});
  });

  test("여러 줄 크기를 한 번에 바꾸고 null이면 직접 바꾼 크기를 지운다", () => {
    const sheet = createSheet();

    sheet.setLineSizes("row", [
      { index: 1, size: 40 },
      { index: 3, size: 12 },
    ]);
    sheet.setLineSizes("row", [{ index: 3, size: null }]);
    sheet.setLineSizes("col", [{ index: 2, size: 100 }]);

    expect(sizes(sheet, "row")).toEqual({ 1: 40 });
    expect(sizes(sheet, "col")).toEqual({ 2: 100 });
  });

  test("바뀐 축과 줄 번호를 한 번에 알린다", () => {
    const sheet = createSheet();
    const calls: [Axis, readonly number[]][] = [];
    sheet.onLineSizeChange((axis, indexes) => calls.push([axis, indexes]));

    sheet.setLineSizes("col", [
      { index: 0, size: 30 },
      { index: 4, size: 90 },
    ]);
    sheet.setLineSizes("col", []);

    expect(calls).toEqual([["col", [0, 4]]]);
  });

  test("시트 밖 줄이나 0 이하 크기가 하나라도 있으면 아무것도 바꾸지 않고 에러를 던진다", () => {
    const sheet = createSheet();

    expect(() => sheet.setLineSizes("row", [{ index: 0, size: 30 }, { index: 10, size: 30 }])).toThrow(RangeError);
    expect(() => sheet.setLineSizes("col", [{ index: 0, size: 30 }, { index: 1, size: 0 }])).toThrow(RangeError);
    expect(() => sheet.setLineSizes("col", [{ index: 0, size: Number.NaN }])).toThrow(RangeError);
    expect(sizes(sheet, "row")).toEqual({});
    expect(sizes(sheet, "col")).toEqual({});
  });
});

describe("SetLineSizesCommand", () => {
  test("실행하면 크기를 바꾸고, undo하면 처음 크기로 돌아간다", () => {
    const sheet = createSheet();
    sheet.setLineSizes("row", [{ index: 2, size: 50 }]);
    const command = new SetLineSizesCommand(sheet, "row", [
      { index: 1, size: 30 },
      { index: 2, size: 30 },
    ]);

    command.execute();
    expect(sizes(sheet, "row")).toEqual({ 1: 30, 2: 30 });

    command.undo();
    expect(sizes(sheet, "row")).toEqual({ 2: 50 });
  });

  test("자동 크기로 돌린 것(null)도 undo하면 직접 바꾼 크기가 돌아온다", () => {
    const sheet = createSheet();
    sheet.setLineSizes("row", [{ index: 4, size: 80 }]);
    const history = new History();

    history.execute(new SetLineSizesCommand(sheet, "row", [{ index: 4, size: null }]));
    expect(sheet.lineSize("row", 4)).toBeNull();

    history.undo();
    expect(sheet.lineSize("row", 4)).toBe(80);
    history.redo();
    expect(sheet.lineSize("row", 4)).toBeNull();
  });

  test("같은 줄이 여러 번 들어 있으면 마지막 크기가 남고, undo하면 처음 크기로 돌아간다", () => {
    const sheet = createSheet();
    const command = new SetLineSizesCommand(sheet, "col", [
      { index: 0, size: 10 },
      { index: 0, size: 20 },
    ]);

    command.execute();
    expect(sheet.lineSize("col", 0)).toBe(20);
    command.undo();
    expect(sheet.lineSize("col", 0)).toBeNull();
  });

  test("execute 전에 undo하면 에러를 던진다", () => {
    expect(() => new SetLineSizesCommand(createSheet(), "row", []).undo()).toThrow();
  });
});
