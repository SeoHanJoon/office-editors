import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { parseA1, toA1, type CellRange } from "./address";
import type { CellFormat } from "./cell-format";
import {
  borderChanges,
  clearFormatChanges,
  copyFillFormatChanges,
  fillFormatChanges,
  moveFormatChanges,
  pasteFormatChanges,
  patchFormatChanges,
} from "./format-edit";
import { SetFormatsCommand } from "./set-formats-command";
import { Sheet, type FormatChanges } from "./sheet";
import { StructureCommand } from "./structure-command";

const at = (a1: string) => parseA1(a1)!;

function range(a1: string): CellRange {
  const [start, end = start] = a1.split(":");
  const from = at(start!);
  const to = at(end!);
  return { top: from.row, left: from.col, bottom: to.row, right: to.col };
}

/** 칸마다 보이는 서식. 기본 서식인 칸은 빼고 { "A1": 서식 } 모양으로 */
function shown(sheet: Sheet): Record<string, CellFormat> {
  const result: Record<string, CellFormat> = {};
  for (let row = 0; row < sheet.rowCount; row++) {
    for (let col = 0; col < sheet.colCount; col++) {
      const format = sheet.format({ row, col });
      if (Object.keys(format).length > 0) result[toA1({ row, col })] = format;
    }
  }
  return result;
}

/** 저장된 서식 항목 수 (셀 서식 + 행 서식 + 열 서식) */
function stored(sheet: Sheet): { cells: number; rows: number; cols: number } {
  return { cells: [...sheet.cellFormats()].length, rows: [...sheet.lineFormats("row")].length, cols: [...sheet.lineFormats("col")].length };
}

function run(sheet: Sheet, history: History, changes: FormatChanges): void {
  history.execute(new SetFormatsCommand(sheet, changes));
}

const BOLD = { bold: true } as const;
const RED = { fill: "#ff0000" } as const;

describe("Sheet 서식", () => {
  test("셀 → 행 → 열 → 기본 순서로 처음 찾은 서식을 보여준다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });
    sheet.setFormats({ cols: [{ index: 0, format: RED }], rows: [{ index: 1, format: BOLD }], cells: [{ address: at("A3"), format: { italic: true } }] });

    expect(sheet.format(at("A1"))).toEqual(RED);
    expect(sheet.format(at("A2"))).toEqual(BOLD);
    expect(sheet.format(at("A3"))).toEqual({ italic: true });
    expect(sheet.format(at("B1"))).toEqual({});
  });

  test("같은 서식은 같은 객체로 읽힌다 (서식 표)", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2 });
    sheet.setFormats({ cells: [{ address: at("A1"), format: { bold: true } }, { address: at("B2"), format: { bold: true } }] });

    expect(sheet.format(at("A1"))).toBe(sheet.format(at("B2")));
    expect(Object.isFrozen(sheet.format(at("A1")))).toBe(true);
  });

  test("물려받는 서식과 같은 셀 서식은 두지 않는다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2 });
    sheet.setFormats({ cols: [{ index: 0, format: RED }], cells: [{ address: at("A1"), format: RED }, { address: at("B1"), format: {} }] });

    expect(stored(sheet)).toEqual({ cells: 0, rows: 0, cols: 1 });
  });

  test("시트 밖이 하나라도 있으면 아무것도 바꾸지 않는다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2 });

    expect(() => sheet.setFormats({ cells: [{ address: at("A1"), format: BOLD }, { address: at("C1"), format: BOLD }] })).toThrow(RangeError);
    expect(() => sheet.setFormats({ rows: [{ index: 2, format: BOLD }] })).toThrow(RangeError);
    expect(shown(sheet)).toEqual({});
  });

  test("바꾸면 한 번 알린다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2 });
    const calls: FormatChanges[] = [];
    sheet.onFormatChange((changes) => calls.push(changes));

    sheet.setFormats({ cells: [{ address: at("A1"), format: BOLD }], cols: [{ index: 1, format: RED }] });
    sheet.setFormats({});

    expect(calls).toHaveLength(1);
  });
});

describe("서식 주기 (patchFormatChanges)", () => {
  test("범위의 칸마다 보이는 서식에 patch를 합친다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });
    const history = new History();
    run(sheet, history, { cells: [{ address: at("A1"), format: RED }] });

    run(sheet, history, patchFormatChanges(sheet, range("A1:B1"), BOLD));

    expect(shown(sheet)).toEqual({ A1: { fill: "#ff0000", bold: true }, B1: BOLD });
  });

  test("열 전체는 열 서식 하나로 저장한다 (10만 행)", () => {
    const sheet = new Sheet({ rowCount: 100_000, colCount: 3 });

    sheet.setFormats(patchFormatChanges(sheet, range("B1:B100000"), BOLD));

    expect(stored(sheet)).toEqual({ cells: 0, rows: 0, cols: 1 });
    expect(sheet.format({ row: 99_999, col: 1 })).toEqual(BOLD);
  });

  test("열 전체: 그 열의 셀 서식과, 행 서식이 우선하던 칸도 함께 바뀐다", () => {
    const sheet = new Sheet({ rowCount: 4, colCount: 2 });
    sheet.setFormats({ cells: [{ address: at("A1"), format: { italic: true } }], rows: [{ index: 2, format: RED }] });

    sheet.setFormats(patchFormatChanges(sheet, range("A1:A4"), BOLD));

    expect(shown(sheet)).toEqual({
      A1: { italic: true, bold: true },
      A2: BOLD,
      A3: { fill: "#ff0000", bold: true },
      A4: BOLD,
      B3: RED,
    });
  });

  test("행 전체: 행 서식이 없던 행은 열 서식이 있던 칸에 열 서식을 이어 간다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });
    sheet.setFormats({ cols: [{ index: 1, format: RED }], cells: [{ address: at("C2"), format: { italic: true } }] });

    sheet.setFormats(patchFormatChanges(sheet, range("A2:C2"), BOLD));

    expect(shown(sheet)).toEqual({
      B1: RED,
      A2: BOLD,
      B2: { fill: "#ff0000", bold: true },
      C2: { italic: true, bold: true },
      B3: RED,
    });
    expect(stored(sheet).rows).toBe(1);
  });

  test("시트 전체: 열 서식과 행 서식을 모두 고친다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2 });
    sheet.setFormats({ rows: [{ index: 0, format: RED }] });

    sheet.setFormats(patchFormatChanges(sheet, range("A1:B3"), BOLD));

    expect(shown(sheet)).toEqual({
      A1: { fill: "#ff0000", bold: true },
      B1: { fill: "#ff0000", bold: true },
      A2: BOLD,
      B2: BOLD,
      A3: BOLD,
      B3: BOLD,
    });
    expect(stored(sheet)).toEqual({ cells: 0, rows: 1, cols: 2 });
  });

  test("서식 지우기: 행·열 서식이 있어도 고른 칸은 기본 서식이 된다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2 });
    sheet.setFormats({ rows: [{ index: 0, format: RED }], cols: [{ index: 1, format: BOLD }] });

    sheet.setFormats(clearFormatChanges(sheet, range("B1:B2")));

    expect(shown(sheet)).toEqual({ A1: RED });
  });

  test("undo 한 번에 셀·줄 서식이 모두 돌아오고, redo로 다시 된다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2 });
    const history = new History();
    run(sheet, history, { rows: [{ index: 1, format: RED }], cells: [{ address: at("A1"), format: { italic: true } }] });
    const before = shown(sheet);

    run(sheet, history, patchFormatChanges(sheet, range("A1:A3"), BOLD));
    const after = shown(sheet);
    history.undo();

    expect(shown(sheet)).toEqual(before);
    history.redo();
    expect(shown(sheet)).toEqual(after);
  });
});

describe("테두리 (borderChanges)", () => {
  const ALL = { borderTop: true, borderRight: true, borderBottom: true, borderLeft: true } as const;

  test("모든 테두리: 범위 칸마다 네 변", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });

    sheet.setFormats(borderChanges(sheet, range("A1:B1"), "all"));

    expect(shown(sheet)).toEqual({ A1: ALL, B1: ALL });
  });

  test("바깥쪽 테두리: 범위 바깥 변만", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });

    sheet.setFormats(borderChanges(sheet, range("A1:B2"), "outer"));

    expect(shown(sheet)).toEqual({
      A1: { borderTop: true, borderLeft: true },
      B1: { borderTop: true, borderRight: true },
      A2: { borderBottom: true, borderLeft: true },
      B2: { borderBottom: true, borderRight: true },
    });
  });

  test("아래쪽 테두리: 마지막 행의 아래 변만", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });

    sheet.setFormats(borderChanges(sheet, range("A1:B2"), "bottom"));

    expect(shown(sheet)).toEqual({ A2: { borderBottom: true }, B2: { borderBottom: true } });
  });

  test("테두리 없음: 범위 칸과, 맞닿은 바깥 칸의 범위 쪽 변을 지운다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 3 });
    sheet.setFormats(borderChanges(sheet, range("A1:C3"), "all"));

    sheet.setFormats(borderChanges(sheet, range("B2"), "none"));

    expect(shown(sheet)).toMatchObject({
      B1: { borderTop: true, borderRight: true, borderLeft: true },
      A2: { borderTop: true, borderBottom: true, borderLeft: true },
      C2: { borderTop: true, borderRight: true, borderBottom: true },
      B3: { borderRight: true, borderBottom: true, borderLeft: true },
    });
    expect(shown(sheet).B2).toBeUndefined();
    expect(shown(sheet).B1?.borderBottom).toBeUndefined();
  });

  test("열 전체 바깥쪽 테두리도 열 서식으로 저장한다", () => {
    const sheet = new Sheet({ rowCount: 100_000, colCount: 3 });

    sheet.setFormats(borderChanges(sheet, range("B1:B100000"), "outer"));

    expect(stored(sheet)).toEqual({ cells: 2, rows: 0, cols: 1 });
    expect(sheet.format({ row: 500, col: 1 })).toEqual({ borderLeft: true, borderRight: true });
    expect(sheet.format({ row: 0, col: 1 })).toEqual({ borderTop: true, borderLeft: true, borderRight: true });
  });
});

describe("서식 복사 (붙여넣기, 잘라내기, 채우기)", () => {
  function createSheet(): Sheet {
    const sheet = new Sheet({ rowCount: 6, colCount: 4 });
    sheet.setFormats({ cells: [{ address: at("A1"), format: BOLD }, { address: at("A2"), format: RED }] });
    return sheet;
  }

  test("붙여넣기: 원본 칸에 보이는 서식을 반복해서 넣는다", () => {
    const sheet = createSheet();

    sheet.setFormats(pasteFormatChanges(sheet, range("A1:A2"), range("C1:C4")));

    expect(shown(sheet)).toMatchObject({ C1: BOLD, C2: RED, C3: BOLD, C4: RED });
  });

  test("붙여넣기: 기본 서식 칸을 붙이면 붙인 곳의 서식이 지워진다", () => {
    const sheet = createSheet();

    sheet.setFormats(pasteFormatChanges(sheet, range("B1"), range("A1")));

    expect(shown(sheet).A1).toBeUndefined();
  });

  test("잘라내기: 옮긴 곳은 원본 서식, 원본 자리는 서식이 지워진다", () => {
    const sheet = createSheet();

    sheet.setFormats(moveFormatChanges(sheet, range("A1:A2"), 1, 0));

    expect(shown(sheet)).toEqual({ A2: BOLD, A3: RED });
  });

  test("채우기 핸들: 아래로는 순서대로, 위로는 거꾸로 되풀이한다", () => {
    const sheet = new Sheet({ rowCount: 8, colCount: 2 });
    sheet.setFormats({ cells: [{ address: at("A4"), format: BOLD }, { address: at("A5"), format: RED }] });

    sheet.setFormats(fillFormatChanges(sheet, range("A4:A5"), "down", 3));
    sheet.setFormats(fillFormatChanges(sheet, range("A4:A5"), "up", 3));

    expect(shown(sheet)).toEqual({ A1: RED, A2: BOLD, A3: RED, A4: BOLD, A5: RED, A6: BOLD, A7: RED, A8: BOLD });
  });

  test("Ctrl+D: 첫 행의 서식을 아래 칸에, 한 행만 골랐으면 위 행에서 가져온다", () => {
    const sheet = createSheet();

    sheet.setFormats(copyFillFormatChanges(sheet, range("A1:B3"), "down"));
    sheet.setFormats(copyFillFormatChanges(sheet, range("A4"), "down"));

    expect(shown(sheet)).toEqual({ A1: BOLD, A2: BOLD, A3: BOLD, A4: BOLD });
    expect(copyFillFormatChanges(sheet, range("A1"), "down")).toEqual({});
  });
});

describe("행·열 넣기·지우기와 서식", () => {
  function createSheet(): Sheet {
    const sheet = new Sheet({ rowCount: 5, colCount: 3 });
    sheet.setFormats({
      cells: [{ address: at("B2"), format: BOLD }],
      rows: [{ index: 1, format: RED }],
      cols: [{ index: 2, format: { italic: true } }],
    });
    sheet.setCustomSizes("row", [{ index: 1, size: 40 }]);
    return sheet;
  }

  test("행을 지우면 서식이 따라 올라오고, undo로 지운 서식이 돌아온다", () => {
    const sheet = createSheet();
    const history = new History();
    const before = shown(sheet);

    history.execute(new StructureCommand(sheet, { kind: "delete", axis: "row", index: 0, count: 1 }));

    expect(sheet.format(at("B1"))).toEqual(BOLD);
    expect(sheet.format(at("A1"))).toEqual(RED);
    history.undo();
    expect(shown(sheet)).toEqual(before);
  });

  test("서식이 있는 행을 지우고 undo하면 그 행의 서식이 돌아온다", () => {
    const sheet = createSheet();
    const history = new History();
    const before = shown(sheet);

    history.execute(new StructureCommand(sheet, { kind: "delete", axis: "row", index: 1, count: 2 }));
    expect(stored(sheet)).toEqual({ cells: 0, rows: 0, cols: 1 });
    history.undo();

    expect(shown(sheet)).toEqual(before);
  });

  test("넣은 행은 바로 위 행의 셀 서식·행 서식·직접 바꾼 높이를 물려받는다", () => {
    const sheet = createSheet();
    const history = new History();

    history.execute(new StructureCommand(sheet, { kind: "insert", axis: "row", index: 2, count: 2 }));

    for (const a1 of ["B3", "B4"]) expect(sheet.format(at(a1))).toEqual(BOLD);
    for (const a1 of ["A3", "A4"]) expect(sheet.format(at(a1))).toEqual(RED);
    expect([sheet.customSize("row", 2), sheet.customSize("row", 3)]).toEqual([40, 40]);
    // 원래 3행은 5행으로 밀렸다. 서식이 없던 행이라 열 서식만 보인다.
    expect(sheet.format(at("B5"))).toEqual({});
    expect(sheet.format(at("C5"))).toEqual({ italic: true });
  });

  test("넣은 열은 왼쪽 열의 서식을 물려받고, 맨 앞에 넣으면 기본 서식이다", () => {
    const sheet = createSheet();
    const history = new History();

    history.execute(new StructureCommand(sheet, { kind: "insert", axis: "col", index: 3, count: 1 }));
    history.execute(new StructureCommand(sheet, { kind: "insert", axis: "col", index: 0, count: 1 }));

    expect(sheet.format(at("E1"))).toEqual({ italic: true });
    expect(sheet.lineFormat("col", 0)).toBeNull();
  });

  test("넣기를 undo하면 물려받은 것도 사라지고, redo하면 다시 물려받는다", () => {
    const sheet = createSheet();
    const history = new History();
    const before = shown(sheet);

    history.execute(new StructureCommand(sheet, { kind: "insert", axis: "row", index: 2, count: 1 }));
    const after = shown(sheet);
    history.undo();

    expect(shown(sheet)).toEqual(before);
    expect(sheet.customSize("row", 2)).toBeNull();
    history.redo();
    expect(shown(sheet)).toEqual(after);
  });
});
