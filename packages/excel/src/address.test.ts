import { describe, expect, test } from "vitest";
import { MAX_COLS, MAX_ROWS, columnName, parseA1, rangeToA1, toA1 } from "./address";

describe("열 이름", () => {
  test("0부터 25까지는 A부터 Z까지 한 글자다", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
  });

  test("Z 다음은 AA, AZ 다음은 BA, ZZ 다음은 AAA다", () => {
    expect(columnName(26)).toBe("AA");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
    expect(columnName(701)).toBe("ZZ");
    expect(columnName(702)).toBe("AAA");
  });

  test("마지막 열은 XFD다", () => {
    expect(columnName(MAX_COLS - 1)).toBe("XFD");
  });
});

describe("A1 주소", () => {
  test("0부터 센 주소를 1부터 세는 A1 형태로 바꾼다", () => {
    expect(toA1({ row: 0, col: 0 })).toBe("A1");
    expect(toA1({ row: 9, col: 27 })).toBe("AB10");
  });

  test("A1 형태를 0부터 센 주소로 바꾼다", () => {
    expect(parseA1("A1")).toEqual({ row: 0, col: 0 });
    expect(parseA1("AB10")).toEqual({ row: 9, col: 27 });
    expect(parseA1("XFD1048576")).toEqual({ row: MAX_ROWS - 1, col: MAX_COLS - 1 });
  });

  test("소문자도 읽는다", () => {
    expect(parseA1("b3")).toEqual({ row: 2, col: 1 });
  });

  test("바꾸고 다시 읽으면 처음 주소와 같다", () => {
    for (const address of [{ row: 0, col: 0 }, { row: 999, col: 25 }, { row: 12345, col: 702 }]) {
      expect(parseA1(toA1(address))).toEqual(address);
    }
  });

  test("형식이 틀렸거나 시트 밖이면 null을 돌려준다", () => {
    for (const text of ["", "A", "1", "A0", "A01", "1A", "A1B", " A1", "$A$1", "XFE1", "A1048577"]) {
      expect(parseA1(text)).toBeNull();
    }
  });
});

describe("범위 주소", () => {
  test("여러 셀이면 왼쪽 위와 오른쪽 아래를 콜론으로 잇는다", () => {
    expect(rangeToA1({ top: 0, left: 0, bottom: 2, right: 2 })).toBe("A1:C3");
  });

  test("셀 하나면 주소 하나만 쓴다", () => {
    expect(rangeToA1({ top: 4, left: 1, bottom: 4, right: 1 })).toBe("B5");
  });
});
