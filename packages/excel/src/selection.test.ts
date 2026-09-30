import { describe, expect, test } from "vitest";
import { parseA1, toA1 } from "./address";
import {
  clampSelection,
  cycleInRange,
  expandToLines,
  extendTo,
  focusToReveal,
  moveBy,
  moveToDataEdge,
  selectAll,
  selectCell,
  selectColumns,
  selectRange,
  selectRows,
  selectionRange,
  wholeLines,
  type Selection,
} from "./selection";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

describe("행·열 전체 선택", () => {
  const bounds = { rowCount: 100, colCount: 10 };

  test("행 전체를 고르면 A열부터 끝 열까지이고 활성 셀은 첫 행의 A열이다", () => {
    const selection = selectRows(4, 2, bounds);
    expect(selectionRange(selection)).toEqual({ top: 2, left: 0, bottom: 4, right: 9 });
    expect(toA1(selection.active)).toBe("A5");
  });

  test("열 전체를 고르면 1행부터 끝 행까지이고 활성 셀은 첫 열의 1행이다", () => {
    const selection = selectColumns(1, 3, bounds);
    expect(selectionRange(selection)).toEqual({ top: 0, left: 1, bottom: 99, right: 3 });
    expect(toA1(selection.active)).toBe("B1");
  });

  test("행 전체인지 열 전체인지 알아본다", () => {
    expect(wholeLines(selectionRange(selectRows(2, 3, bounds)), bounds)).toBe("row");
    expect(wholeLines(selectionRange(selectColumns(2, 3, bounds)), bounds)).toBe("col");
    expect(wholeLines({ top: 0, left: 0, bottom: 99, right: 9 }, bounds)).toBe("row");
    expect(wholeLines({ top: 0, left: 0, bottom: 5, right: 5 }, bounds)).toBeNull();
  });

  test("시트가 줄면 선택을 시트 안으로 잘라 넣는다", () => {
    const selection = clampSelection(selectRows(95, 99, bounds), { rowCount: 96, colCount: 10 });
    expect(selectionRange(selection)).toEqual({ top: 95, left: 0, bottom: 95, right: 9 });
  });
});

describe("전체 선택과 줄 선택", () => {
  const bounds = { rowCount: 100, colCount: 10 };
  const range = (from: string, to: string, active = from): Selection => ({ anchor: at(from), focus: at(to), active: at(active) });

  test("시트 전체를 고르고 활성 셀은 그대로 둔다", () => {
    const selection = selectAll(selectCell(at("C5")), bounds);
    expect(selectionRange(selection)).toEqual({ top: 0, left: 0, bottom: 99, right: 9 });
    expect(toA1(selection.active)).toBe("C5");
  });

  test("걸친 행 전체로 넓히고 활성 셀은 그대로 둔다", () => {
    const selection = expandToLines(range("B3", "D5", "C4"), "row", bounds);
    expect(selectionRange(selection)).toEqual({ top: 2, left: 0, bottom: 4, right: 9 });
    expect(toA1(selection.active)).toBe("C4");
    expect(wholeLines(selectionRange(selection), bounds)).toBe("row");
  });

  test("걸친 열 전체로 넓히고 활성 셀은 그대로 둔다", () => {
    const selection = expandToLines(range("B3", "D5"), "col", bounds);
    expect(selectionRange(selection)).toEqual({ top: 0, left: 1, bottom: 99, right: 3 });
    expect(toA1(selection.active)).toBe("B3");
    expect(wholeLines(selectionRange(selection), bounds)).toBe("col");
  });

  test("넓힌 뒤에도 focus 쪽 끝이 그대로라 Shift+방향키로 이어서 늘린다", () => {
    // 아래에서 위로 고른 범위: focus가 위쪽
    const rows = expandToLines(range("B5", "B3"), "row", bounds);
    expect(rows.focus.row).toBe(2);
    expect(selectionRange(extendTo(rows, moveBy(rows.focus, "up", bounds)))).toEqual({ top: 1, left: 0, bottom: 4, right: 9 });
    const cols = expandToLines(range("D2", "B2"), "col", bounds);
    expect(cols.focus.col).toBe(1);
    expect(selectionRange(extendTo(cols, moveBy(cols.focus, "left", bounds)))).toEqual({ top: 0, left: 0, bottom: 99, right: 3 });
  });

  test("줄 전체를 늘릴 때는 그 줄 방향으로 시트 끝까지 스크롤하지 않는다", () => {
    const rows = expandToLines(range("B3", "B4"), "row", bounds);
    expect(toA1(focusToReveal(rows, bounds))).toBe("B4");
    const cols = expandToLines(range("C3", "D3"), "col", bounds);
    expect(toA1(focusToReveal(cols, bounds))).toBe("D3");
    expect(toA1(focusToReveal(selectAll(selectCell(at("E7")), bounds), bounds))).toBe("E7");
    expect(toA1(focusToReveal(range("B3", "D5"), bounds))).toBe("D5");
  });
});

describe("선택 범위", () => {
  test("셀 하나를 선택하면 그 셀 하나가 범위다", () => {
    expect(selectionRange(selectCell(at("B2")))).toEqual({ top: 1, left: 1, bottom: 1, right: 1 });
  });

  test("범위를 늘려도 활성 셀은 처음 셀 그대로다", () => {
    const selection = extendTo(selectCell(at("B2")), at("D4"));

    expect(selection.anchor).toEqual(at("B2"));
    expect(selection.active).toEqual(at("B2"));
    expect(selectionRange(selection)).toEqual({ top: 1, left: 1, bottom: 3, right: 3 });
  });

  test("범위를 다시 늘리면 범위 안에서 옮겨 둔 활성 셀은 anchor로 돌아간다", () => {
    const moved: Selection = { ...extendTo(selectCell(at("B2")), at("D4")), active: at("C3") };

    expect(extendTo(moved, at("E5")).active).toEqual(at("B2"));
  });

  test("selectRange는 범위를 고르고 왼쪽 위 칸을 활성 셀로 둔다", () => {
    const selection = selectRange({ top: 1, left: 1, bottom: 3, right: 2 });

    expect(toA1(selection.active)).toBe("B2");
    expect(selectionRange(selection)).toEqual({ top: 1, left: 1, bottom: 3, right: 2 });
  });

  test("위·왼쪽으로 늘려도 범위는 왼쪽 위부터 오른쪽 아래까지다", () => {
    const selection = extendTo(selectCell(at("D4")), at("B2"));

    expect(selectionRange(selection)).toEqual({ top: 1, left: 1, bottom: 3, right: 3 });
  });
});

describe("한 칸씩 이동", () => {
  const bounds = { rowCount: 10, colCount: 5 };

  test("방향대로 한 칸 옮긴다", () => {
    expect(toA1(moveBy(at("B2"), "up", bounds))).toBe("B1");
    expect(toA1(moveBy(at("B2"), "down", bounds))).toBe("B3");
    expect(toA1(moveBy(at("B2"), "left", bounds))).toBe("A2");
    expect(toA1(moveBy(at("B2"), "right", bounds))).toBe("C2");
  });

  test("시트 끝에서는 더 가지 않는다", () => {
    expect(toA1(moveBy(at("A1"), "up", bounds))).toBe("A1");
    expect(toA1(moveBy(at("A1"), "left", bounds))).toBe("A1");
    expect(toA1(moveBy(at("E10"), "down", bounds))).toBe("E10");
    expect(toA1(moveBy(at("E10"), "right", bounds))).toBe("E10");
  });

  test("여러 칸을 옮기다 시트 끝을 넘으면 끝에서 멈춘다", () => {
    expect(toA1(moveBy(at("A3"), "down", bounds, 5))).toBe("A8");
    expect(toA1(moveBy(at("A8"), "down", bounds, 5))).toBe("A10");
    expect(toA1(moveBy(at("A3"), "up", bounds, 5))).toBe("A1");
  });
});

describe("Ctrl+방향키: 데이터 끝으로 이동", () => {
  // A열: 1~3행 값, 4행 빈칸, 5행 값, 6~9행 빈칸, 10행 값
  const sheet = new Sheet({
    rowCount: 12,
    colCount: 5,
    data: [["a", "b", "", "", "c"], ["a"], ["a"], [], ["a"], [], [], [], [], ["a"]],
  });
  const jump = (from: string, direction: Parameters<typeof moveBy>[1]) =>
    toA1(moveToDataEdge(at(from), direction, sheet));

  test("값이 이어져 있으면 이어진 구간의 마지막 셀로 간다", () => {
    expect(jump("A1", "down")).toBe("A3");
  });

  test("구간 끝에서 누르면 빈칸을 건너 다음 값 있는 셀로 간다", () => {
    expect(jump("A3", "down")).toBe("A5");
    expect(jump("A5", "down")).toBe("A10");
  });

  test("빈 셀에서 누르면 처음 만나는 값 있는 셀로 간다", () => {
    expect(jump("A6", "down")).toBe("A10");
    expect(jump("A9", "up")).toBe("A5");
  });

  test("그 방향에 값 있는 셀이 없으면 시트 끝으로 간다", () => {
    expect(jump("A10", "down")).toBe("A12");
    expect(jump("B5", "down")).toBe("B12");
  });

  test("옆 방향도 같은 규칙이다", () => {
    expect(jump("A1", "right")).toBe("B1");
    expect(jump("B1", "right")).toBe("E1");
    expect(jump("E1", "left")).toBe("B1");
  });

  test("시트 끝에 있으면 그대로 있다", () => {
    expect(jump("A1", "up")).toBe("A1");
    expect(jump("A12", "down")).toBe("A12");
  });
});

describe("범위 안에서 활성 셀 돌기", () => {
  // B2:C3 범위, 활성 셀 B2
  const range = extendTo(selectCell(at("B2")), at("C3"));

  /** direction으로 times번 옮긴 활성 셀들 */
  function walk(direction: "up" | "down" | "left" | "right", times: number): string[] {
    const cells: string[] = [];
    let selection = range;
    for (let i = 0; i < times; i++) {
      selection = cycleInRange(selection, direction);
      cells.push(toA1(selection.active));
    }
    return cells;
  }

  test("Enter 방향은 아래로 가고, 열 끝이면 다음 열 맨 위, 마지막 칸 다음은 첫 칸이다", () => {
    expect(walk("down", 4)).toEqual(["B3", "C2", "C3", "B2"]);
  });

  test("Shift+Enter 방향은 그 반대로 돈다", () => {
    expect(walk("up", 4)).toEqual(["C3", "C2", "B3", "B2"]);
  });

  test("Tab 방향은 오른쪽으로 가고, 행 끝이면 다음 행 맨 왼쪽, 마지막 칸 다음은 첫 칸이다", () => {
    expect(walk("right", 4)).toEqual(["C2", "B3", "C3", "B2"]);
  });

  test("Shift+Tab 방향은 그 반대로 돈다", () => {
    expect(walk("left", 4)).toEqual(["C3", "B3", "C2", "B2"]);
  });

  test("범위는 그대로 둔다", () => {
    const next = cycleInRange(range, "down");

    expect(selectionRange(next)).toEqual(selectionRange(range));
    expect(next.anchor).toEqual(range.anchor);
    expect(next.focus).toEqual(range.focus);
  });

  test("anchor가 오른쪽 아래여도 범위의 왼쪽 위부터 센다", () => {
    const reversed = extendTo(selectCell(at("C3")), at("B2"));

    expect(toA1(cycleInRange(reversed, "down").active)).toBe("B2");
  });
});
