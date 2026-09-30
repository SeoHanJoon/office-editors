import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { parseA1, toA1, type CellAddress } from "./address";
import { Sheet } from "./sheet";
import type { StructureChange } from "./structure";
import { StructureCommand } from "./structure-command";

const at = (a1: string) => parseA1(a1)!;

/** 시트 내용을 { "A1": "값" } 모양으로 (비교하기 쉽게) */
function snapshot(sheet: Sheet): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [address, value] of sheet.entries()) result[toA1(address)] = value;
  return result;
}

const insertRows = (row: number, count = 1): StructureChange => ({ kind: "insert", axis: "row", index: row - 1, count });
const deleteRows = (row: number, count = 1): StructureChange => ({ kind: "delete", axis: "row", index: row - 1, count });
const insertCols = (col: number, count = 1): StructureChange => ({ kind: "insert", axis: "col", index: col, count });
const deleteCols = (col: number, count = 1): StructureChange => ({ kind: "delete", axis: "col", index: col, count });

/**
 *     A    B            C
 * 1   1    =A1+A3       =SUM(A1:A4)
 * 2   2    =$A$2*2
 * 3   3    =SUM(A3:A4)
 * 4   4                 =A4
 */
function createSheet(): Sheet {
  return new Sheet({
    rowCount: 5,
    colCount: 4,
    data: [
      ["1", "=A1+A3", "=SUM(A1:A4)"],
      ["2", "=$A$2*2"],
      ["3", "=SUM(A3:A4)"],
      ["4", "", "=A4"],
    ],
  });
}

describe("Sheet.changeStructure", () => {
  test("행을 넣으면 아래 셀이 밀리고 참조가 고쳐지며 행 수가 는다", () => {
    const sheet = createSheet();
    sheet.changeStructure(insertRows(2));
    expect(sheet.rowCount).toBe(6);
    expect(snapshot(sheet)).toEqual({
      A1: "1",
      B1: "=A1+A4",
      C1: "=SUM(A1:A5)",
      A3: "2",
      B3: "=$A$3*2",
      A4: "3",
      B4: "=SUM(A4:A5)",
      A5: "4",
      C5: "=A5",
    });
  });

  test("행을 지우면 그 행 셀이 없어지고 지운 셀 참조는 #REF!, 행 수가 준다", () => {
    const sheet = createSheet();
    const result = sheet.changeStructure(deleteRows(3));
    expect(sheet.rowCount).toBe(4);
    expect(snapshot(sheet)).toEqual({
      A1: "1",
      B1: "=A1+#REF!",
      C1: "=SUM(A1:A3)",
      A2: "2",
      B2: "=$A$2*2",
      A3: "4",
      C3: "=A3",
    });
    expect(result.removed).toEqual([
      { address: at("A3"), value: "3" },
      { address: at("B3"), value: "=SUM(A3:A4)" },
    ]);
    // 변경 뒤 주소와 고치기 전 글자
    expect(result.rewritten).toContainEqual({ address: at("B1"), value: "=A1+A3" });
    expect(result.rewritten).toContainEqual({ address: at("C3"), value: "=A4" });
  });

  test("열을 넣고 지우면 열 수가 바뀌고 참조가 고쳐진다", () => {
    const sheet = createSheet();
    sheet.changeStructure(insertCols(0, 2));
    expect(sheet.colCount).toBe(6);
    expect(sheet.get(at("D1"))).toBe("=C1+C3");
    expect(sheet.get(at("E1"))).toBe("=SUM(C1:C4)");

    sheet.changeStructure(deleteCols(2));
    expect(sheet.colCount).toBe(5);
    expect(sheet.get(at("C1"))).toBe("=#REF!+#REF!");
    expect(sheet.get(at("D1"))).toBe("=SUM(#REF!)");
  });

  test("onStructureChange로 한 번 알리고, onChange는 부르지 않는다", () => {
    const sheet = createSheet();
    const structure: [StructureChange, readonly CellAddress[]][] = [];
    const cells: unknown[] = [];
    sheet.onStructureChange((change, addresses) => structure.push([change, addresses]));
    sheet.onChange((addresses) => cells.push(addresses));

    sheet.changeStructure(insertRows(1));
    expect(structure).toEqual([[insertRows(1), []]]);
    expect(cells).toEqual([]);
  });

  test("같이 넣는 셀 중 옮기고 고친 결과와 다른 것만 알린다", () => {
    const sheet = createSheet();
    const addresses: CellAddress[][] = [];
    sheet.onStructureChange((_, changed) => addresses.push([...changed]));

    sheet.changeStructure(insertRows(1), [
      { address: at("B2"), value: "=A2+A4" }, // 고친 결과와 같음
      { address: at("A1"), value: "새 값" },
    ]);
    expect(addresses).toEqual([[at("A1")]]);
    expect(sheet.get(at("A1"))).toBe("새 값");
  });

  test("시트 끝에 행을 넣을 수 있다", () => {
    const sheet = createSheet();
    sheet.changeStructure(insertRows(6));
    expect(sheet.rowCount).toBe(6);
  });

  test.each([
    ["시트 밖에 넣기", insertRows(7)],
    ["시트 밖 지우기", deleteRows(5, 2)],
    ["모든 행 지우기", deleteRows(1, 5)],
    ["0줄", { kind: "insert", axis: "row", index: 0, count: 0 } as StructureChange],
    ["최대 크기 넘기기", insertCols(0, 16_381)],
  ])("%s는 아무것도 바꾸지 않고 에러를 던진다", (_, change) => {
    const sheet = createSheet();
    const before = snapshot(sheet);
    expect(() => sheet.changeStructure(change)).toThrow(RangeError);
    expect(snapshot(sheet)).toEqual(before);
    expect(sheet.rowCount).toBe(5);
    expect(sheet.colCount).toBe(4);
  });

  test("같이 넣는 셀이 새 크기 밖이면 아무것도 바꾸지 않는다", () => {
    const sheet = createSheet();
    const before = snapshot(sheet);
    expect(() => sheet.changeStructure(deleteRows(1), [{ address: at("A5"), value: "x" }])).toThrow(RangeError);
    expect(snapshot(sheet)).toEqual(before);
  });
});

describe("StructureCommand", () => {
  test.each([
    ["행 삽입", insertRows(2, 2)],
    ["첫 행 앞 삽입", insertRows(1)],
    ["행 삭제", deleteRows(3)],
    ["범위 첫 행 삭제", deleteRows(1, 2)],
    ["범위 전체 삭제", deleteRows(3, 2)],
    ["열 삽입", insertCols(1)],
    ["열 삭제", deleteCols(0)],
  ])("%s를 undo하면 처음 시트로, redo하면 같은 결과로 돌아간다", (_, change) => {
    const sheet = createSheet();
    const history = new History();
    const before = snapshot(sheet);
    history.execute(new StructureCommand(sheet, change));
    const after = snapshot(sheet);
    const size = [sheet.rowCount, sheet.colCount];

    history.undo();
    expect(snapshot(sheet)).toEqual(before);
    expect([sheet.rowCount, sheet.colCount]).toEqual([5, 4]);

    history.redo();
    expect(snapshot(sheet)).toEqual(after);
    expect([sheet.rowCount, sheet.colCount]).toEqual(size);
  });

  test("반대 변경으로 원래대로 돌아오는 수식은 undo 알림에 넣지 않는다", () => {
    const sheet = createSheet();
    const history = new History();
    history.execute(new StructureCommand(sheet, insertRows(2)));
    const addresses: CellAddress[][] = [];
    sheet.onStructureChange((_, changed) => addresses.push([...changed]));

    history.undo();
    expect(addresses).toEqual([[]]);
  });

  test("삭제를 undo하면 지운 셀과 #REF!가 된 수식만 따로 알린다", () => {
    const sheet = createSheet();
    const history = new History();
    history.execute(new StructureCommand(sheet, deleteRows(3)));
    const addresses: string[][] = [];
    sheet.onStructureChange((_, changed) => addresses.push(changed.map(toA1).sort()));

    history.undo();
    expect(addresses).toEqual([["A3", "B1", "B3"]]);
  });

  test("거꾸로 쓴 범위와 소문자 참조도 undo하면 입력한 글자 그대로 돌아온다", () => {
    const sheet = new Sheet({ rowCount: 6, colCount: 2, data: [["=sum(a5:a2)"]] });
    const history = new History();
    history.execute(new StructureCommand(sheet, deleteRows(2)));
    expect(sheet.get(at("A1"))).toBe("=sum(A4:A2)");
    history.undo();
    expect(sheet.get(at("A1"))).toBe("=sum(a5:a2)");
  });

  test("execute 전에 undo하면 에러를 던진다", () => {
    expect(() => new StructureCommand(createSheet(), insertRows(1)).undo()).toThrow();
  });
});
