import { describe, expect, test } from "vitest";
import { LineSizes } from "./line-sizes";
import type { GridGeometry, Viewport } from "./layout";
import { draggedSize, fitColumnWidth, MIN_LINE_SIZE, pointToResizeHandle, resizeLines, textLines } from "./resize";

// 머리글 높이 10, 너비 30. 행 높이 10, 열 너비 20, B열만 50
const geometry: GridGeometry = {
  headerHeight: 10,
  headerWidth: 30,
  rows: new LineSizes(100, 10),
  cols: new LineSizes(26, 20, [[1, 50]]),
};
const viewport = (scrollLeft = 0, scrollTop = 0): Viewport => ({ scrollLeft, scrollTop, width: 300, height: 200 });

describe("경계선 찾기", () => {
  test("열 머리글에서 열 사이 경계선 근처면 왼쪽 열이다", () => {
    // A열 끝 = 30 + 20 = 50, B열 끝 = 50 + 50 = 100
    expect(pointToResizeHandle(geometry, viewport(), 50, 5)).toEqual({ axis: "col", index: 0 });
    expect(pointToResizeHandle(geometry, viewport(), 47, 5)).toEqual({ axis: "col", index: 0 });
    expect(pointToResizeHandle(geometry, viewport(), 53, 5)).toEqual({ axis: "col", index: 0 });
    expect(pointToResizeHandle(geometry, viewport(), 98, 5)).toEqual({ axis: "col", index: 1 });
  });

  test("경계선에서 멀면 경계선이 아니다", () => {
    expect(pointToResizeHandle(geometry, viewport(), 40, 5)).toBeNull();
    expect(pointToResizeHandle(geometry, viewport(), 75, 5)).toBeNull();
  });

  test("행 머리글에서 행 사이 경계선 근처면 위 행이다", () => {
    // 1행 끝 = 10 + 10 = 20, 2행 끝 = 30
    expect(pointToResizeHandle(geometry, viewport(), 15, 21)).toEqual({ axis: "row", index: 0 });
    expect(pointToResizeHandle(geometry, viewport(), 15, 31)).toEqual({ axis: "row", index: 1 });
    expect(pointToResizeHandle(geometry, viewport(), 15, 25)).toBeNull();
  });

  test("셀 위, 왼쪽 위 모서리, 머리글에 붙은 첫 경계선은 아니다", () => {
    expect(pointToResizeHandle(geometry, viewport(), 50, 50)).toBeNull();
    expect(pointToResizeHandle(geometry, viewport(), 29, 9)).toBeNull();
    expect(pointToResizeHandle(geometry, viewport(), 31, 5)).toBeNull();
  });

  test("스크롤한 만큼 옮겨서 찾고, 머리글에 가려진 경계선은 잡지 않는다", () => {
    // 20px 스크롤하면 B열이 머리글 바로 오른쪽에서 시작한다. A·B 경계선은 머리글 뒤에 있다.
    expect(pointToResizeHandle(geometry, viewport(20), 32, 5)).toBeNull();
    expect(pointToResizeHandle(geometry, viewport(20), 80, 5)).toEqual({ axis: "col", index: 1 });
  });
});

describe("함께 바꿀 줄", () => {
  const bounds = { rowCount: 100, colCount: 26 };

  test("고른 열 전체 안의 경계선을 끌면 고른 열이 모두 바뀐다", () => {
    const range = { top: 0, left: 1, bottom: 99, right: 3 };

    expect(resizeLines({ axis: "col", index: 2 }, range, bounds)).toEqual({ first: 1, last: 3 });
  });

  test("고른 줄 밖이거나 줄 전체를 고르지 않았으면 그 줄 하나만 바뀐다", () => {
    expect(resizeLines({ axis: "col", index: 5 }, { top: 0, left: 1, bottom: 99, right: 3 }, bounds)).toEqual({ first: 5, last: 5 });
    expect(resizeLines({ axis: "col", index: 2 }, { top: 0, left: 1, bottom: 10, right: 3 }, bounds)).toEqual({ first: 2, last: 2 });
  });

  test("고른 행 전체 안이면 고른 행이 모두 바뀐다. 시트 전체를 골랐으면 모든 줄이다", () => {
    expect(resizeLines({ axis: "row", index: 4 }, { top: 3, left: 0, bottom: 6, right: 25 }, bounds)).toEqual({ first: 3, last: 6 });
    const all = { top: 0, left: 0, bottom: 99, right: 25 };
    expect(resizeLines({ axis: "col", index: 7 }, all, bounds)).toEqual({ first: 0, last: 25 });
    expect(resizeLines({ axis: "row", index: 7 }, all, bounds)).toEqual({ first: 0, last: 99 });
  });
});

describe("끈 크기", () => {
  test("끈 만큼 늘고 줄며 정수 px로 맞춘다", () => {
    expect(draggedSize(64, 36)).toBe(100);
    expect(draggedSize(64, -10.4)).toBe(54);
  });

  test("가장 작은 크기 아래로는 줄지 않는다", () => {
    expect(draggedSize(20, -100)).toBe(MIN_LINE_SIZE);
  });
});

describe("셀 글자 줄", () => {
  test("입력한 글자의 줄바꿈으로 줄을 나눈다", () => {
    expect(textLines("가\n나다\r\n라", "가\n나다\r\n라")).toEqual(["가", "나다", "라"]);
    expect(textLines("한 줄", "한 줄")).toEqual(["한 줄"]);
  });

  test("수식 결과의 줄바꿈은 나누지 않는다", () => {
    expect(textLines('=A1&"x"', "가\nx")).toEqual(["가\nx"]);
  });
});

describe("열 너비 자동 맞춤", () => {
  // 글자당 7px로 잰다.
  const measure = (text: string) => text.length * 7;

  test("모든 행 중 가장 넓은 글자에 양쪽 여백을 더한다", () => {
    const cells = ["짧음", null, "가장 긴 글자", "12"].map((text) => (text ? ([text, text] as const) : null));

    expect(fitColumnWidth(cells.length, (row) => cells[row]!, measure, 4)).toBe(7 * 7 + 8);
  });

  test("여러 줄 셀은 가장 긴 줄로 잰다", () => {
    expect(fitColumnWidth(1, () => ["ab\nabcdef\nc", "ab\nabcdef\nc"], measure, 4)).toBe(6 * 7 + 8);
  });

  test("수식은 보이는 계산값으로 잰다", () => {
    expect(fitColumnWidth(1, () => ["=SUM(A1:A100)", "15"], measure, 4)).toBe(2 * 7 + 8);
  });

  test("같은 글자는 한 번만 잰다", () => {
    const measured: string[] = [];
    fitColumnWidth(1000, () => ["같음", "같음"], (text) => (measured.push(text), 10), 4);

    expect(measured).toEqual(["같음"]);
  });

  test("열이 모두 비어 있으면 null (기본 너비로 돌린다)", () => {
    expect(fitColumnWidth(10, () => null, measure, 4)).toBeNull();
  });
});
