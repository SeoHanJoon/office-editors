import { describe, expect, test } from "vitest";
import { parseA1, rangeToA1, toA1 } from "./address";
import {
  cellRect,
  contentSize,
  isInHeader,
  pageRows,
  pointToCell,
  scrollToReveal,
  visibleRange,
  type GridLayout,
  type Viewport,
} from "./layout";

// 계산하기 쉬운 크기: 칸 10×20, 머리글 높이 10, 너비 30
const layout: GridLayout = { rowHeight: 10, colWidth: 20, headerHeight: 10, headerWidth: 30 };
const bounds = { rowCount: 1000, colCount: 26 };
// 머리글을 빼면 셀 영역이 100×50 → 5열 × 5행이 보인다.
const viewport = (scrollLeft = 0, scrollTop = 0): Viewport => ({ scrollLeft, scrollTop, width: 130, height: 60 });
const at = (a1: string) => parseA1(a1)!;

test("표 전체 크기는 머리글과 모든 칸을 더한 크기다", () => {
  expect(contentSize(layout, bounds)).toEqual({ width: 30 + 26 * 20, height: 10 + 1000 * 10 });
});

describe("보이는 범위", () => {
  test("스크롤하지 않으면 A1부터 화면에 들어가는 만큼 보인다", () => {
    expect(rangeToA1(visibleRange(layout, viewport(), bounds))).toBe("A1:E5");
  });

  test("스크롤한 만큼 아래·오른쪽 칸이 보인다", () => {
    expect(rangeToA1(visibleRange(layout, viewport(40, 100), bounds))).toBe("C11:G15");
  });

  test("칸 중간까지 스크롤하면 반쯤 보이는 칸도 포함한다", () => {
    expect(rangeToA1(visibleRange(layout, viewport(5, 5), bounds))).toBe("A1:F6");
  });

  test("시트 끝을 넘어가지 않는다", () => {
    const range = visibleRange(layout, viewport(26 * 20 - 100, 1000 * 10 - 50), bounds);

    expect(rangeToA1(range)).toBe("V996:Z1000");
  });

  test("시트가 화면보다 작으면 시트 전체가 보인다", () => {
    expect(rangeToA1(visibleRange(layout, viewport(), { rowCount: 2, colCount: 3 }))).toBe("A1:C2");
  });
});

describe("셀 위치", () => {
  test("셀은 머리글 오른쪽 아래에서 시작한다", () => {
    expect(cellRect(layout, viewport(), at("A1"))).toEqual({ x: 30, y: 10, width: 20, height: 10 });
    expect(cellRect(layout, viewport(), at("C2"))).toEqual({ x: 70, y: 20, width: 20, height: 10 });
  });

  test("스크롤하면 그만큼 위·왼쪽으로 옮겨 그린다", () => {
    expect(cellRect(layout, viewport(40, 100), at("C11"))).toMatchObject({ x: 30, y: 10 });
  });
});

describe("좌표로 셀 찾기", () => {
  test("좌표 아래의 셀을 돌려준다", () => {
    expect(toA1(pointToCell(layout, viewport(), bounds, 30, 10))).toBe("A1");
    expect(toA1(pointToCell(layout, viewport(), bounds, 75, 25))).toBe("C2");
  });

  test("칸 경계는 오른쪽·아래 칸에 속한다", () => {
    expect(toA1(pointToCell(layout, viewport(), bounds, 50, 20))).toBe("B2");
  });

  test("스크롤한 만큼 더해서 찾는다", () => {
    expect(toA1(pointToCell(layout, viewport(40, 100), bounds, 35, 15))).toBe("C11");
  });

  test("머리글 위는 보이는 범위 바로 바깥 셀이 된다", () => {
    expect(toA1(pointToCell(layout, viewport(40, 100), bounds, 35, 5))).toBe("C10");
    expect(toA1(pointToCell(layout, viewport(40, 100), bounds, 15, 15))).toBe("B11");
  });

  test("시트 밖 좌표는 가장 가까운 셀이 된다", () => {
    expect(toA1(pointToCell(layout, viewport(), bounds, -100, -100))).toBe("A1");
    expect(toA1(pointToCell(layout, viewport(), bounds, 10_000, 100_000))).toBe("Z1000");
  });

  test("머리글 위인지 알려준다", () => {
    expect(isInHeader(layout, 29, 50)).toBe(true);
    expect(isInHeader(layout, 50, 9)).toBe(true);
    expect(isInHeader(layout, 30, 10)).toBe(false);
  });
});

describe("선택한 셀이 보이게 스크롤", () => {
  test("이미 다 보이는 셀이면 스크롤하지 않는다", () => {
    expect(scrollToReveal(layout, viewport(40, 100), at("E13"))).toEqual({ scrollLeft: 40, scrollTop: 100 });
  });

  test("아래·오른쪽으로 벗어난 셀은 화면 끝에 딱 맞게 스크롤한다", () => {
    expect(scrollToReveal(layout, viewport(), at("F6"))).toEqual({ scrollLeft: 20, scrollTop: 10 });
  });

  test("위·왼쪽으로 벗어난 셀은 머리글 바로 아래·오른쪽에 오게 스크롤한다", () => {
    expect(scrollToReveal(layout, viewport(40, 100), at("A1"))).toEqual({ scrollLeft: 0, scrollTop: 0 });
  });

  test("반쯤 가려진 셀도 다 보이게 스크롤한다", () => {
    expect(scrollToReveal(layout, viewport(5, 5), at("A1"))).toEqual({ scrollLeft: 0, scrollTop: 0 });
    expect(scrollToReveal(layout, viewport(5, 5), at("F6"))).toEqual({ scrollLeft: 20, scrollTop: 10 });
  });

  test("화면이 칸보다 작으면 칸의 왼쪽 위를 맞춘다", () => {
    const tiny: Viewport = { scrollLeft: 0, scrollTop: 0, width: 35, height: 15 };

    expect(scrollToReveal(layout, tiny, at("C3"))).toEqual({ scrollLeft: 40, scrollTop: 20 });
  });
});

describe("한 화면의 행 수", () => {
  test("다 보이는 행만 센다", () => {
    expect(pageRows(layout, viewport())).toBe(5);
    expect(pageRows(layout, { ...viewport(), height: 64 })).toBe(5);
  });

  test("화면이 아주 작아도 1행은 된다", () => {
    expect(pageRows(layout, { ...viewport(), height: 12 })).toBe(1);
  });
});
