import type { ContextMenuEntry, ContextMenuItem } from "@office/ui";
import { describe, expect, test } from "vitest";
import { MAX_COLS, MAX_ROWS } from "./address";
import { gridMenu, type GridMenuCommand } from "./grid-menu";

const bounds = { rowCount: 100, colCount: 10 };
const windows = { mac: false };

/** 구분선은 "---", 흐린 항목은 뒤에 "(흐림)"을 붙인 글자 목록 */
function labels(entries: ContextMenuEntry<GridMenuCommand>[]): string[] {
  return entries.map((entry) => (entry === "separator" ? "---" : entry.label + (entry.disabled ? " (흐림)" : "")));
}

function find(entries: ContextMenuEntry<GridMenuCommand>[], label: string): ContextMenuItem<GridMenuCommand> {
  const item = entries.find((entry) => entry !== "separator" && entry.label === label);
  if (!item || item === "separator") throw new Error(`메뉴에 없다: ${label}`);
  return item;
}

describe("메뉴가 뜨는 곳마다 항목", () => {
  test("행 머리글", () => {
    const menu = gridMenu("row", { top: 2, left: 0, bottom: 2, right: 9 }, bounds, windows);
    expect(labels(menu)).toEqual([
      "잘라내기", "복사", "붙여넣기", "---",
      "위에 행 넣기", "아래에 행 넣기", "---",
      "행 삭제", "---",
      "내용 지우기",
    ]);
  });

  test("열 머리글", () => {
    const menu = gridMenu("col", { top: 0, left: 1, bottom: 99, right: 1 }, bounds, windows);
    expect(labels(menu)).toEqual([
      "잘라내기", "복사", "붙여넣기", "---",
      "왼쪽에 열 넣기", "오른쪽에 열 넣기", "---",
      "열 삭제", "---",
      "내용 지우기",
    ]);
  });

  test("셀", () => {
    const menu = gridMenu("cell", { top: 2, left: 1, bottom: 2, right: 1 }, bounds, windows);
    expect(labels(menu)).toEqual([
      "잘라내기", "복사", "붙여넣기", "---",
      "내용 지우기", "---",
      "위에 행 넣기", "아래에 행 넣기", "왼쪽에 열 넣기", "오른쪽에 열 넣기", "---",
      "행 삭제", "열 삭제",
    ]);
  });
});

describe("행·열 넣기/지우기", () => {
  test("여러 줄을 골랐으면 고른 줄 수만큼 넣고 지운다", () => {
    const menu = gridMenu("row", { top: 2, left: 0, bottom: 4, right: 9 }, bounds, windows);
    expect(find(menu, "위에 행 3개 넣기").value).toEqual({ type: "structure", change: { kind: "insert", axis: "row", index: 2, count: 3 } });
    expect(find(menu, "아래에 행 3개 넣기").value).toEqual({ type: "structure", change: { kind: "insert", axis: "row", index: 5, count: 3 } });
    expect(find(menu, "행 3개 삭제").value).toEqual({ type: "structure", change: { kind: "delete", axis: "row", index: 2, count: 3 } });
  });

  test("셀 메뉴는 고른 셀이 걸친 줄 전체에 한다", () => {
    // B3:D4 → 3~4행(2줄), B~D열(3줄)
    const menu = gridMenu("cell", { top: 2, left: 1, bottom: 3, right: 3 }, bounds, windows);
    expect(find(menu, "위에 행 2개 넣기").value).toEqual({ type: "structure", change: { kind: "insert", axis: "row", index: 2, count: 2 } });
    expect(find(menu, "오른쪽에 열 3개 넣기").value).toEqual({ type: "structure", change: { kind: "insert", axis: "col", index: 4, count: 3 } });
    expect(find(menu, "열 3개 삭제").value).toEqual({ type: "structure", change: { kind: "delete", axis: "col", index: 1, count: 3 } });
  });

  test("시트를 비우게 되는 지우기는 흐리게 한다", () => {
    const all = { top: 0, left: 0, bottom: 99, right: 9 };
    expect(find(gridMenu("row", all, bounds, windows), "행 100개 삭제").disabled).toBe(true);
    expect(find(gridMenu("col", all, bounds, windows), "열 10개 삭제").disabled).toBe(true);
    expect(find(gridMenu("row", { ...all, bottom: 98 }, bounds, windows), "행 99개 삭제").disabled).toBe(false);
  });

  test("최대 크기를 넘는 넣기는 흐리게 한다", () => {
    const full = { rowCount: MAX_ROWS - 1, colCount: MAX_COLS };
    const menu = gridMenu("cell", { top: 0, left: 0, bottom: 1, right: 0 }, full, windows);
    expect(find(menu, "위에 행 2개 넣기").disabled).toBe(true);
    expect(find(menu, "왼쪽에 열 넣기").disabled).toBe(true);
    expect(find(gridMenu("cell", { top: 0, left: 0, bottom: 0, right: 0 }, full, windows), "위에 행 넣기").disabled).toBe(false);
  });
});

describe("단축키 표시", () => {
  test("Mac이면 ⌘, 아니면 Ctrl로 보여준다", () => {
    const range = { top: 2, left: 0, bottom: 2, right: 9 };
    const shortcuts = (mac: boolean) =>
      gridMenu("row", range, bounds, { mac }).flatMap((entry) => (entry === "separator" ? [] : [entry.shortcut ?? ""]));
    expect(shortcuts(false)).toEqual(["Ctrl+X", "Ctrl+C", "Ctrl+V", "Ctrl+Shift+=", "", "Ctrl+-", "Delete"]);
    expect(shortcuts(true)).toEqual(["⌘X", "⌘C", "⌘V", "⇧⌘=", "", "⌘-", "⌦"]);
  });

  test("셀 메뉴의 넣기/지우기에는 단축키를 보여주지 않는다. (셀 범위에서는 그 키가 아무것도 하지 않는다)", () => {
    const menu = gridMenu("cell", { top: 2, left: 1, bottom: 2, right: 1 }, bounds, windows);
    expect(find(menu, "위에 행 넣기").shortcut).toBeUndefined();
    expect(find(menu, "행 삭제").shortcut).toBeUndefined();
    expect(find(menu, "잘라내기").shortcut).toBe("Ctrl+X");
  });
});
