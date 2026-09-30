import { describe, expect, test } from "vitest";
import { nextEnabled, placeMenu, type ContextMenuEntry } from "./context-menu";

describe("메뉴 위치", () => {
  const screen = { width: 800, height: 600 };
  const size = { width: 200, height: 300 };

  test("들어가면 누른 점에서 오른쪽 아래로 편다", () => {
    expect(placeMenu({ x: 100, y: 100 }, size, screen)).toEqual({ x: 100, y: 100 });
  });

  test("오른쪽·아래로 넘치면 누른 점의 왼쪽·위로 편다", () => {
    expect(placeMenu({ x: 700, y: 500 }, size, screen)).toEqual({ x: 500, y: 200 });
  });

  test("어느 쪽으로도 안 들어가면 화면 끝에 붙인다", () => {
    expect(placeMenu({ x: 100, y: 250 }, { width: 200, height: 400 }, screen)).toEqual({ x: 100, y: 200 });
    expect(placeMenu({ x: 10, y: 10 }, { width: 900, height: 100 }, screen)).toEqual({ x: 0, y: 10 });
  });
});

describe("↑↓로 다음 항목 찾기", () => {
  const item = (label: string, disabled = false) => ({ label, disabled, value: label });
  const entries: ContextMenuEntry<string>[] = [item("a"), "separator", item("b", true), item("c"), "separator", item("d")];

  test("구분선과 흐린 항목은 건너뛴다", () => {
    expect(nextEnabled(entries, 0, 1)).toBe(3);
    expect(nextEnabled(entries, 3, 1)).toBe(5);
    expect(nextEnabled(entries, 3, -1)).toBe(0);
  });

  test("끝에서는 반대쪽 끝으로 돈다", () => {
    expect(nextEnabled(entries, 5, 1)).toBe(0);
    expect(nextEnabled(entries, 0, -1)).toBe(5);
  });

  test("아무것도 안 가리킬 때 ↓는 첫 항목, ↑는 마지막 항목이다", () => {
    expect(nextEnabled(entries, -1, 1)).toBe(0);
    expect(nextEnabled(entries, -1, -1)).toBe(5);
  });

  test("고를 수 있는 항목이 없으면 -1이다", () => {
    expect(nextEnabled([item("x", true), "separator"], -1, 1)).toBe(-1);
  });
});
