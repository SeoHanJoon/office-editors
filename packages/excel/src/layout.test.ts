import { describe, expect, test } from "vitest";
import { parseA1, rangeToA1, toA1 } from "./address";
import { LineSizes } from "./line-sizes";
import {
  cellRect,
  contentSize,
  fillHandleRect,
  isInHeader,
  isOnFillHandle,
  pageRows,
  pointToCell,
  pointToHeader,
  scrollToReveal,
  visibleRange,
  rangeRect,
  uniformGeometry,
  type GridLayout,
  type Viewport,
} from "./layout";

// 계산하기 쉬운 크기: 칸 10×20, 머리글 높이 10, 너비 30
const layout: GridLayout = { rowHeight: 10, colWidth: 20, headerHeight: 10, headerWidth: 30 };
const bounds = { rowCount: 1000, colCount: 26 };
const geometry = uniformGeometry(layout, bounds);
// 머리글을 빼면 셀 영역이 100×50 → 5열 × 5행이 보인다.
const viewport = (scrollLeft = 0, scrollTop = 0): Viewport => ({ scrollLeft, scrollTop, width: 130, height: 60 });
const at = (a1: string) => parseA1(a1)!;

test("표 전체 크기는 머리글과 모든 칸을 더한 크기다", () => {
  expect(contentSize(geometry)).toEqual({ width: 30 + 26 * 20, height: 10 + 1000 * 10 });
});

describe("보이는 범위", () => {
  test("스크롤하지 않으면 A1부터 화면에 들어가는 만큼 보인다", () => {
    expect(rangeToA1(visibleRange(geometry, viewport()))).toBe("A1:E5");
  });

  test("스크롤한 만큼 아래·오른쪽 칸이 보인다", () => {
    expect(rangeToA1(visibleRange(geometry, viewport(40, 100)))).toBe("C11:G15");
  });

  test("칸 중간까지 스크롤하면 반쯤 보이는 칸도 포함한다", () => {
    expect(rangeToA1(visibleRange(geometry, viewport(5, 5)))).toBe("A1:F6");
  });

  test("시트 끝을 넘어가지 않는다", () => {
    const range = visibleRange(geometry, viewport(26 * 20 - 100, 1000 * 10 - 50));

    expect(rangeToA1(range)).toBe("V996:Z1000");
  });

  test("시트가 화면보다 작으면 시트 전체가 보인다", () => {
    expect(rangeToA1(visibleRange(uniformGeometry(layout, { rowCount: 2, colCount: 3 }), viewport()))).toBe("A1:C2");
  });
});

describe("셀 위치", () => {
  test("셀은 머리글 오른쪽 아래에서 시작한다", () => {
    expect(cellRect(geometry, viewport(), at("A1"))).toEqual({ x: 30, y: 10, width: 20, height: 10 });
    expect(cellRect(geometry, viewport(), at("C2"))).toEqual({ x: 70, y: 20, width: 20, height: 10 });
  });

  test("스크롤하면 그만큼 위·왼쪽으로 옮겨 그린다", () => {
    expect(cellRect(geometry, viewport(40, 100), at("C11"))).toMatchObject({ x: 30, y: 10 });
  });
});

describe("좌표로 셀 찾기", () => {
  test("좌표 아래의 셀을 돌려준다", () => {
    expect(toA1(pointToCell(geometry, viewport(), 30, 10))).toBe("A1");
    expect(toA1(pointToCell(geometry, viewport(), 75, 25))).toBe("C2");
  });

  test("칸 경계는 오른쪽·아래 칸에 속한다", () => {
    expect(toA1(pointToCell(geometry, viewport(), 50, 20))).toBe("B2");
  });

  test("스크롤한 만큼 더해서 찾는다", () => {
    expect(toA1(pointToCell(geometry, viewport(40, 100), 35, 15))).toBe("C11");
  });

  test("머리글 위는 보이는 범위 바로 바깥 셀이 된다", () => {
    expect(toA1(pointToCell(geometry, viewport(40, 100), 35, 5))).toBe("C10");
    expect(toA1(pointToCell(geometry, viewport(40, 100), 15, 15))).toBe("B11");
  });

  test("시트 밖 좌표는 가장 가까운 셀이 된다", () => {
    expect(toA1(pointToCell(geometry, viewport(), -100, -100))).toBe("A1");
    expect(toA1(pointToCell(geometry, viewport(), 10_000, 100_000))).toBe("Z1000");
  });

  test("머리글 위인지 알려준다", () => {
    expect(isInHeader(geometry, 29, 50)).toBe(true);
    expect(isInHeader(geometry, 50, 9)).toBe(true);
    expect(isInHeader(geometry, 30, 10)).toBe(false);
  });
});

describe("좌표로 머리글 찾기", () => {
  test("행 번호를 누르면 그 행, 열 이름을 누르면 그 열이다", () => {
    expect(pointToHeader(geometry, viewport(), 10, 35)).toEqual({ axis: "row", index: 2 });
    expect(pointToHeader(geometry, viewport(), 75, 5)).toEqual({ axis: "col", index: 2 });
  });

  test("스크롤한 만큼 옮겨서 찾는다", () => {
    expect(pointToHeader(geometry, viewport(40, 100), 10, 15)).toEqual({ axis: "row", index: 10 });
    expect(pointToHeader(geometry, viewport(40, 100), 35, 5)).toEqual({ axis: "col", index: 2 });
  });

  test("셀 위와 왼쪽 위 모서리는 머리글이 아니다", () => {
    expect(pointToHeader(geometry, viewport(), 50, 20)).toBeNull();
    expect(pointToHeader(geometry, viewport(), 5, 5)).toBeNull();
  });
});

describe("선택한 셀이 보이게 스크롤", () => {
  test("이미 다 보이는 셀이면 스크롤하지 않는다", () => {
    expect(scrollToReveal(geometry, viewport(40, 100), at("E13"))).toEqual({ scrollLeft: 40, scrollTop: 100 });
  });

  test("아래·오른쪽으로 벗어난 셀은 화면 끝에 딱 맞게 스크롤한다", () => {
    expect(scrollToReveal(geometry, viewport(), at("F6"))).toEqual({ scrollLeft: 20, scrollTop: 10 });
  });

  test("위·왼쪽으로 벗어난 셀은 머리글 바로 아래·오른쪽에 오게 스크롤한다", () => {
    expect(scrollToReveal(geometry, viewport(40, 100), at("A1"))).toEqual({ scrollLeft: 0, scrollTop: 0 });
  });

  test("반쯤 가려진 셀도 다 보이게 스크롤한다", () => {
    expect(scrollToReveal(geometry, viewport(5, 5), at("A1"))).toEqual({ scrollLeft: 0, scrollTop: 0 });
    expect(scrollToReveal(geometry, viewport(5, 5), at("F6"))).toEqual({ scrollLeft: 20, scrollTop: 10 });
  });

  test("화면이 칸보다 작으면 칸의 왼쪽 위를 맞춘다", () => {
    const tiny: Viewport = { scrollLeft: 0, scrollTop: 0, width: 35, height: 15 };

    expect(scrollToReveal(geometry, tiny, at("C3"))).toEqual({ scrollLeft: 40, scrollTop: 20 });
  });
});

describe("한 화면의 행 수", () => {
  test("다 보이는 행만 센다", () => {
    expect(pageRows(geometry, viewport())).toBe(5);
    expect(pageRows(geometry, { ...viewport(), height: 64 })).toBe(5);
  });

  test("화면이 아주 작아도 1행은 된다", () => {
    expect(pageRows(geometry, { ...viewport(), height: 12 })).toBe(1);
  });
});

describe("줄마다 크기가 다를 때", () => {
  // 2행(row 1) 높이 30, 4행(row 3) 높이 5, B열(col 1) 너비 50
  const varied = {
    ...geometry,
    rows: new LineSizes(1000, 10, [
      [1, 30],
      [3, 5],
    ]),
    cols: new LineSizes(26, 20, [[1, 50]]),
  };

  test("표 전체 크기에 바뀐 크기를 더한다", () => {
    expect(contentSize(varied)).toEqual({ width: 30 + 26 * 20 + 30, height: 10 + 1000 * 10 + 20 - 5 });
  });

  test("셀 위치와 크기가 앞 줄의 크기를 따라간다", () => {
    expect(cellRect(varied, viewport(), at("B2"))).toEqual({ x: 50, y: 20, width: 50, height: 30 });
    expect(cellRect(varied, viewport(), at("C4"))).toEqual({ x: 100, y: 60, width: 20, height: 5 });
    expect(rangeRect(varied, viewport(), parseRange("A1:C4"))).toEqual({ x: 30, y: 10, width: 90, height: 55 });
  });

  test("좌표로 셀을 찾는다", () => {
    expect(toA1(pointToCell(varied, viewport(), 99, 49))).toBe("B2");
    expect(toA1(pointToCell(varied, viewport(), 100, 60))).toBe("C4");
    expect(toA1(pointToCell(varied, viewport(), 100, 65))).toBe("C5");
  });

  test("보이는 범위가 크기에 맞게 줄어든다", () => {
    // 셀 영역 100×50: 열은 A(20)+B(50)+C(20)+D(일부), 행은 1(10)+2(30)+3(10) 딱 맞음
    expect(rangeToA1(visibleRange(varied, viewport()))).toBe("A1:D3");
  });

  test("큰 셀은 위쪽을 맞춰 보이게 한다", () => {
    expect(scrollToReveal(varied, { ...viewport(), height: 30 }, at("B2"))).toEqual({ scrollLeft: 0, scrollTop: 10 });
  });

  test("한 화면 행 수는 실제 높이로 센다", () => {
    expect(pageRows(varied, viewport())).toBe(3);
  });
});

function parseRange(text: string) {
  const [start, end] = text.split(":").map(at);
  return { top: start!.row, left: start!.col, bottom: end!.row, right: end!.col };
}

describe("채우기 핸들", () => {
  // B2:C3의 오른쪽 아래 모서리는 (30 + 3×20, 10 + 3×10) = (90, 40)
  const range = { top: 1, left: 1, bottom: 2, right: 2 };

  test("범위 오른쪽 아래 모서리를 가운데로 그린다", () => {
    expect(fillHandleRect(geometry, viewport(), range)).toEqual({ x: 86.5, y: 36.5, width: 7, height: 7 });
  });

  test("모서리에서 5px 안을 누르면 핸들이다", () => {
    expect(isOnFillHandle(geometry, viewport(), range, 90, 40)).toBe(true);
    expect(isOnFillHandle(geometry, viewport(), range, 95, 35)).toBe(true);
    expect(isOnFillHandle(geometry, viewport(), range, 96, 40)).toBe(false);
    expect(isOnFillHandle(geometry, viewport(), range, 90, 46)).toBe(false);
  });

  test("스크롤하면 핸들도 함께 움직인다", () => {
    expect(isOnFillHandle(geometry, viewport(20, 10), range, 70, 30)).toBe(true);
  });

  test("머리글에 가려진 핸들은 잡지 않는다", () => {
    // 2행까지 스크롤해 올리면 모서리 y = 10 + 30 - 30 = 10 (머리글 경계)
    expect(isOnFillHandle(geometry, viewport(0, 30), range, 90, 8)).toBe(false);
  });
});
