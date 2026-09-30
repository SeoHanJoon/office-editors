import { describe, expect, test } from "vitest";
import { parseA1, rangeToA1, toA1 } from "./address";
import { navigate, type KeyInput } from "./keyboard";
import { extendTo, selectCell, selectionRange, type Selection } from "./selection";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

// A1:A5에 값이 있는 10행 × 5열 시트
const sheet = new Sheet({ rowCount: 10, colCount: 5, data: [["a"], ["a"], ["a"], ["a"], ["a"]] });
const context = { sheet, pageRows: 4 };

/** "Shift+Control+ArrowDown" 같은 글자를 키 입력으로 바꾼다. */
function key(combo: string): KeyInput {
  const parts = combo.split("+");
  return {
    key: parts.at(-1)!,
    shiftKey: parts.includes("Shift"),
    ctrlKey: parts.includes("Control"),
    metaKey: parts.includes("Meta"),
    altKey: parts.includes("Alt"),
  };
}

/** 키를 누른 뒤 [활성 셀, 선택 범위]를 돌려준다. */
function press(selection: Selection, combo: string): [string, string] | null {
  const result = navigate(selection, key(combo), context);
  if (!result) return null;
  return [toA1(result.selection.active), rangeToA1(selectionRange(result.selection))];
}

describe("방향키", () => {
  test("활성 셀을 한 칸 옮긴다", () => {
    expect(press(selectCell(at("B2")), "ArrowDown")).toEqual(["B3", "B3"]);
    expect(press(selectCell(at("B2")), "ArrowUp")).toEqual(["B1", "B1"]);
    expect(press(selectCell(at("B2")), "ArrowLeft")).toEqual(["A2", "A2"]);
    expect(press(selectCell(at("B2")), "ArrowRight")).toEqual(["C2", "C2"]);
  });

  test("범위를 선택한 상태에서 누르면 범위를 풀고 활성 셀에서 한 칸 옮긴다", () => {
    const selection = extendTo(selectCell(at("B2")), at("D4"));

    expect(press(selection, "ArrowRight")).toEqual(["C2", "C2"]);
  });

  test("Shift+방향키는 활성 셀을 두고 범위를 늘린다", () => {
    const once = navigate(selectCell(at("B2")), key("Shift+ArrowRight"), context)!.selection;
    const twice = navigate(once, key("Shift+ArrowDown"), context)!.selection;

    expect(toA1(twice.active)).toBe("B2");
    expect(rangeToA1(selectionRange(twice))).toBe("B2:C3");
  });

  test("Shift+방향키로 반대로 가면 범위가 줄어든다", () => {
    const selection = extendTo(selectCell(at("B2")), at("D2"));

    expect(press(selection, "Shift+ArrowLeft")).toEqual(["B2", "B2:C2"]);
  });

  test("Ctrl+방향키는 데이터 끝으로 간다", () => {
    expect(press(selectCell(at("A1")), "Control+ArrowDown")).toEqual(["A5", "A5"]);
    expect(press(selectCell(at("A5")), "Control+ArrowDown")).toEqual(["A10", "A10"]);
  });

  test("macOS의 Cmd+방향키도 Ctrl+방향키와 같다", () => {
    expect(press(selectCell(at("A1")), "Meta+ArrowDown")).toEqual(["A5", "A5"]);
  });

  test("Ctrl+Shift+방향키는 데이터 끝까지 범위를 늘린다", () => {
    expect(press(selectCell(at("A1")), "Shift+Control+ArrowDown")).toEqual(["A1", "A1:A5"]);
  });
});

describe("Tab과 Enter", () => {
  test("Tab은 오른쪽, Shift+Tab은 왼쪽으로 옮긴다", () => {
    expect(press(selectCell(at("B2")), "Tab")).toEqual(["C2", "C2"]);
    expect(press(selectCell(at("B2")), "Shift+Tab")).toEqual(["A2", "A2"]);
  });

  test("Enter는 아래, Shift+Enter는 위로 옮긴다", () => {
    expect(press(selectCell(at("B2")), "Enter")).toEqual(["B3", "B3"]);
    expect(press(selectCell(at("B2")), "Shift+Enter")).toEqual(["B1", "B1"]);
  });

  test("범위를 선택한 상태에서 누르면 범위는 두고 그 안에서 활성 셀을 옮긴다", () => {
    const selection = extendTo(selectCell(at("B2")), at("D4"));

    expect(press(selection, "Tab")).toEqual(["C2", "B2:D4"]);
    expect(press(selection, "Enter")).toEqual(["B3", "B2:D4"]);
    expect(press(selection, "Shift+Tab")).toEqual(["D4", "B2:D4"]);
    expect(press(selection, "Shift+Enter")).toEqual(["D4", "B2:D4"]);
  });

  test("범위 안에서 옮긴 활성 셀을 기준으로 방향키가 움직인다", () => {
    const selection = { ...extendTo(selectCell(at("B2")), at("D4")), active: at("C3") };

    expect(press(selection, "ArrowRight")).toEqual(["D3", "D3"]);
  });

  test("시트 끝에서는 움직이지 않는다", () => {
    expect(press(selectCell(at("E1")), "Tab")).toEqual(["E1", "E1"]);
    expect(press(selectCell(at("A10")), "Enter")).toEqual(["A10", "A10"]);
  });
});

describe("Home", () => {
  test("Home은 그 행의 A열로 간다", () => {
    expect(press(selectCell(at("D7")), "Home")).toEqual(["A7", "A7"]);
  });

  test("Ctrl+Home은 A1로 간다", () => {
    expect(press(selectCell(at("D7")), "Control+Home")).toEqual(["A1", "A1"]);
  });

  test("Shift+Home은 A열까지 범위를 늘린다", () => {
    expect(press(selectCell(at("D7")), "Shift+Home")).toEqual(["D7", "A7:D7"]);
  });

  test("Ctrl+Shift+Home은 A1까지 범위를 늘린다", () => {
    expect(press(selectCell(at("C3")), "Shift+Control+Home")).toEqual(["C3", "A1:C3"]);
  });
});

describe("PageDown과 PageUp", () => {
  test("한 화면의 행 수만큼 옮기고 화면도 그만큼 스크롤한다", () => {
    const down = navigate(selectCell(at("B2")), key("PageDown"), context)!;
    const up = navigate(selectCell(at("B6")), key("PageUp"), context)!;

    expect(toA1(down.selection.active)).toBe("B6");
    expect(down.scrollRows).toBe(4);
    expect(toA1(up.selection.active)).toBe("B2");
    expect(up.scrollRows).toBe(-4);
  });

  test("시트 끝을 넘으면 끝 행에서 멈춘다", () => {
    expect(press(selectCell(at("B8")), "PageDown")).toEqual(["B10", "B10"]);
    expect(press(selectCell(at("B3")), "PageUp")).toEqual(["B1", "B1"]);
  });

  test("Shift+PageDown은 한 화면만큼 범위를 늘린다", () => {
    expect(press(selectCell(at("B2")), "Shift+PageDown")).toEqual(["B2", "B2:B6"]);
  });
});

describe("이동 키가 아닌 입력", () => {
  test("글자 키나 Alt 조합, 브라우저 단축키는 처리하지 않는다", () => {
    const selection = selectCell(at("B2"));

    for (const combo of ["a", "Escape", "Alt+ArrowDown", "Control+Tab", "Control+Enter", "Control+PageDown"]) {
      expect(navigate(selection, key(combo), context)).toBeNull();
    }
  });
});
