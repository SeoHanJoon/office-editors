import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { parseA1, toA1, type CellRange } from "./address";
import {
  copyText,
  fitsSheet,
  moveChanges,
  parseClipboardText,
  pasteArea,
  pasteCopyChanges,
  pasteTextChanges,
  toClipboardText,
} from "./clipboard";
import { FormulaEngine } from "./formula-engine";
import { formatValue } from "./formula-value";
import { SetCellsCommand } from "./set-cells-command";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

function range(a1: string): CellRange {
  const [start, end = start] = a1.split(":");
  const from = at(start!);
  const to = at(end!);
  return { top: from.row, left: from.col, bottom: to.row, right: to.col };
}

function createSheet(cells: Record<string, string>): Sheet {
  const sheet = new Sheet({ rowCount: 10, colCount: 6 });
  sheet.setCells(Object.entries(cells).map(([a1, value]) => ({ address: at(a1), value })));
  return sheet;
}

/** 변경을 { "A1": "값" } 모양으로 */
function asRecord(changes: readonly { address: { row: number; col: number }; value: string }[]): Record<string, string> {
  return Object.fromEntries(changes.map(({ address, value }) => [toA1(address), value]));
}

describe("클립보드 글자 쓰기 (Excel text/plain)", () => {
  test("칸은 탭, 행은 CRLF로 나누고 마지막 행 뒤에도 CRLF를 붙인다", () => {
    expect(toClipboardText([["1", "2"], ["3", "4"]])).toBe("1\t2\r\n3\t4\r\n");
  });

  test("빈 칸은 빈 글자다", () => {
    expect(toClipboardText([["1", "", "3"]])).toBe("1\t\t3\r\n");
  });

  test("줄바꿈이나 큰따옴표가 든 칸은 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다", () => {
    expect(toClipboardText([['a"b']])).toBe('"a""b"\r\n');
    expect(toClipboardText([["x\ny", "z"]])).toBe('"x\ny"\tz\r\n');
  });
});

describe("클립보드 글자 읽기", () => {
  test("탭과 줄바꿈으로 나누고, 끝의 줄바꿈 하나는 빈 행을 만들지 않는다", () => {
    expect(parseClipboardText("1\t2\r\n3\t4\r\n")).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseClipboardText("a\r\n")).toEqual([["a"]]);
    expect(parseClipboardText("a")).toEqual([["a"]]);
  });

  test("LF나 CR만 써도 행을 나눈다", () => {
    expect(parseClipboardText("1\n2\r3")).toEqual([["1"], ["2"], ["3"]]);
  });

  test("큰따옴표로 감싼 칸은 안의 줄바꿈·탭까지 한 칸이고 `\"\"`는 큰따옴표 하나다", () => {
    expect(parseClipboardText('"a\nb"\tc')).toEqual([["a\nb", "c"]]);
    expect(parseClipboardText('"a""b"\r\n"x\ty"\r\n')).toEqual([['a"b'], ["x\ty"]]);
  });

  test("칸 중간의 큰따옴표와 닫히지 않은 큰따옴표는 글자 그대로다", () => {
    expect(parseClipboardText('5"\t"열림')).toEqual([['5"', '"열림']]);
  });

  test("행마다 칸 수가 다르면 빈 칸을 채운다", () => {
    expect(parseClipboardText("1\t2\t3\n4")).toEqual([["1", "2", "3"], ["4", "", ""]]);
  });

  test("빈 칸이 있는 행을 그대로 읽는다", () => {
    expect(parseClipboardText("\t\t\r\n")).toEqual([["", "", ""]]);
  });

  test("쓴 글자를 다시 읽으면 같은 칸이 된다", () => {
    const rows = [["한글", 'a"b', "x\r\ny"], ["", "\t", "=A1+1"]];
    expect(parseClipboardText(toClipboardText(rows))).toEqual(rows);
  });
});

describe("붙여넣을 범위", () => {
  test("고른 범위가 원본 크기의 배수이면 고른 범위 전체에 반복해서 채운다", () => {
    expect(pasteArea(range("C1:C4"), 2, 1)).toEqual(range("C1:C4"));
    expect(pasteArea(range("A1:D4"), 2, 2)).toEqual(range("A1:D4"));
  });

  test("셀 하나를 복사하면 고른 범위 전체를 채운다", () => {
    expect(pasteArea(range("B2:D5"), 1, 1)).toEqual(range("B2:D5"));
  });

  test("배수가 아니면 왼쪽 위에서 원본 크기만큼 한 번 붙인다", () => {
    expect(pasteArea(range("C1:C3"), 2, 1)).toEqual(range("C1:C2"));
    expect(pasteArea(range("C1"), 2, 3)).toEqual(range("C1:E2"));
  });

  test("시트 끝을 넘는지 확인한다", () => {
    const sheet = { rowCount: 10, colCount: 6 };
    expect(fitsSheet(sheet, range("E9:F10"))).toBe(true);
    expect(fitsSheet(sheet, range("E10:F11"))).toBe(false);
    expect(fitsSheet(sheet, range("F1:G1"))).toBe(false);
  });
});

describe("복사한 셀", () => {
  test("클립보드에는 수식이 아니라 보이는 값이 들어간다", () => {
    const sheet = createSheet({ A1: "1", B1: "=A1+1", A2: "'5", B2: "=1/0" });
    const engine = new FormulaEngine(sheet);
    expect(copyText(sheet, engine, range("A1:C2"))).toBe("1\t2\t\r\n5\t#DIV/0!\t\r\n");
  });

  test("수식은 옮긴 만큼 상대 참조가 따라가고 $는 그대로다", () => {
    const sheet = createSheet({ A1: "1", B1: "=A1*$A$1", A2: "'5" });
    expect(asRecord(pasteCopyChanges(sheet, range("A1:B2"), range("C3:D4")))).toEqual({
      C3: "1",
      D3: "=C3*$A$1",
      C4: "'5",
      D4: "",
    });
  });

  test("고른 범위가 더 크면 반복해서 채우고, 칸마다 옮긴 거리만큼 참조를 옮긴다", () => {
    const sheet = createSheet({ A1: "=B1+1" });
    expect(asRecord(pasteCopyChanges(sheet, range("A1"), range("C1:C3")))).toEqual({
      C1: "=D1+1",
      C2: "=D2+1",
      C3: "=D3+1",
    });
  });

  test("시트 위로 나가는 참조는 #REF!가 된다", () => {
    const sheet = createSheet({ B2: "=A1+1" });
    expect(asRecord(pasteCopyChanges(sheet, range("B2"), range("B1")))).toEqual({ B1: "=#REF!+1" });
  });

  test("원본과 겹치게 붙여도 붙이기 전 값으로 만든다", () => {
    const sheet = createSheet({ A1: "1", A2: "2" });
    expect(asRecord(pasteCopyChanges(sheet, range("A1:A2"), range("A2:A3")))).toEqual({ A2: "1", A3: "2" });
  });
});

describe("밖에서 가져온 글자", () => {
  test("글자를 입력한 것처럼 그대로 넣고, 고른 범위가 배수이면 반복한다", () => {
    expect(asRecord(pasteTextChanges([["1", "=A1+1"]], range("B2:E2")))).toEqual({
      B2: "1",
      C2: "=A1+1",
      D2: "1",
      E2: "=A1+1",
    });
  });
});

describe("잘라내 옮기기", () => {
  function moveAndCheck(cells: Record<string, string>, source: string, to: string) {
    const sheet = createSheet(cells);
    const engine = new FormulaEngine(sheet);
    const history = new History();
    const before = Object.fromEntries([...sheet.entries()].map(([address, value]) => [toA1(address), value]));
    const target = at(to);
    history.execute(new SetCellsCommand(sheet, moveChanges(sheet, range(source), target.row, target.col)));
    const after = Object.fromEntries([...sheet.entries()].map(([address, value]) => [toA1(address), value]));
    const show = (a1: string) => formatValue(engine.getValue(at(a1)));
    return { sheet, history, before, after, show };
  }

  test("옮긴 셀을 가리키던 다른 수식이 새 위치를 따라간다", () => {
    const { after, show } = moveAndCheck({ A1: "1", B1: "=A1+1" }, "A1", "C1");
    expect(after).toEqual({ B1: "=C1+1", C1: "1" });
    expect(show("B1")).toBe("2");
  });

  test("옮긴 수식은 상대 참조여도 원래 셀을 가리킨다", () => {
    const { after } = moveAndCheck({ A1: "=B1", B1: "5" }, "A1", "D1");
    expect(after).toEqual({ B1: "5", D1: "=B1" });
  });

  test("함께 옮긴 셀을 가리키는 참조는 같이 따라간다", () => {
    const { after } = moveAndCheck({ A1: "5", A2: "=A1*2" }, "A1:A2", "C3");
    expect(after).toEqual({ C3: "5", C4: "=C3*2" });
  });

  test("범위 일부만 옮기면 범위 참조는 그대로다", () => {
    const { after } = moveAndCheck({ A1: "1", A2: "2", A3: "3", C1: "=SUM(A1:A3)" }, "A2", "B2");
    expect(after.C1).toBe("=SUM(A1:A3)");
  });

  test("덮어쓴 자리를 가리키던 참조는 #REF!가 된다", () => {
    const { after, show } = moveAndCheck({ A1: "1", B1: "=C1", C1: "3" }, "A1", "C1");
    expect(after).toEqual({ B1: "=#REF!", C1: "1" });
    expect(show("B1")).toBe("#REF!");
  });

  test("겹치게 한 칸 아래로 옮기면 빈 자리만 비운다", () => {
    const { after } = moveAndCheck({ A1: "1", A2: "2" }, "A1:A2", "A2");
    expect(after).toEqual({ A2: "1", A3: "2" });
  });

  test("undo 한 번이면 원래대로 돌아온다", () => {
    const { sheet, history, before, show } = moveAndCheck({ A1: "1", B1: "=A1+1", C1: "3", D1: "=C1" }, "A1", "C1");
    history.undo();
    expect(Object.fromEntries([...sheet.entries()].map(([address, value]) => [toA1(address), value]))).toEqual(before);
    expect(show("B1")).toBe("2");
    expect(show("D1")).toBe("3");
  });
});
