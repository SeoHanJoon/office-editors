import { describe, expect, test } from "vitest";
import { MAX_COLS, MAX_ROWS } from "./address";
import { Sheet } from "./sheet";

describe("Sheet", () => {
  test("처음 값을 행·열 위치 그대로 읽는다", () => {
    const sheet = new Sheet({
      rowCount: 3,
      colCount: 3,
      data: [
        ["이름", "점수"],
        ["가", "10"],
      ],
    });

    expect(sheet.get({ row: 0, col: 0 })).toBe("이름");
    expect(sheet.get({ row: 1, col: 1 })).toBe("10");
  });

  test("입력한 글자를 바꾸지 않고 그대로 저장한다", () => {
    const sheet = new Sheet({ rowCount: 1, colCount: 3, data: [[" 12 ", "=A1+1", "0012"]] });

    expect(sheet.get({ row: 0, col: 0 })).toBe(" 12 ");
    expect(sheet.get({ row: 0, col: 1 })).toBe("=A1+1");
    expect(sheet.get({ row: 0, col: 2 })).toBe("0012");
  });

  test("빈 셀은 빈 문자열을 돌려주고 값이 없다고 알려준다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2, data: [["a"]] });

    expect(sheet.get({ row: 1, col: 1 })).toBe("");
    expect(sheet.has({ row: 1, col: 1 })).toBe(false);
    expect(sheet.has({ row: 0, col: 0 })).toBe(true);
  });

  test("값이 있는 셀만 저장한다", () => {
    const sheet = new Sheet({ rowCount: 1000, colCount: 26, data: [["a", "", "b"], [], ["", "c"]] });

    expect(sheet.size).toBe(3);
    expect(sheet.has({ row: 0, col: 1 })).toBe(false);
  });

  test("열 번호가 달라도 다른 행의 셀과 섞이지 않는다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: MAX_COLS, data: [[], ["x"]] });

    expect(sheet.has({ row: 0, col: MAX_COLS - 1 })).toBe(false);
    expect(sheet.get({ row: 1, col: 0 })).toBe("x");
  });

  test("Excel 최대 크기의 시트를 만들 수 있고 마지막 셀을 읽는다", () => {
    const sheet = new Sheet({ rowCount: MAX_ROWS, colCount: MAX_COLS });

    expect(sheet.get({ row: MAX_ROWS - 1, col: MAX_COLS - 1 })).toBe("");
  });

  test("행·열 수가 1 이상 Excel 최대 이하의 정수가 아니면 에러를 던진다", () => {
    expect(() => new Sheet({ rowCount: 0, colCount: 1 })).toThrow(RangeError);
    expect(() => new Sheet({ rowCount: 1, colCount: 1.5 })).toThrow(RangeError);
    expect(() => new Sheet({ rowCount: MAX_ROWS + 1, colCount: 1 })).toThrow(RangeError);
    expect(() => new Sheet({ rowCount: 1, colCount: MAX_COLS + 1 })).toThrow(RangeError);
  });

  test("처음 값이 시트 크기보다 크면 에러를 던진다", () => {
    expect(() => new Sheet({ rowCount: 1, colCount: 2, data: [["a"], ["b"]] })).toThrow(RangeError);
    expect(() => new Sheet({ rowCount: 2, colCount: 1, data: [["a", "b"]] })).toThrow(RangeError);
  });
});

describe("셀 값 바꾸기", () => {
  const a1 = { row: 0, col: 0 };
  const b1 = { row: 0, col: 1 };

  test("여러 셀을 한 번에 바꾸고, 빈 문자열이면 셀을 비운다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2, data: [["a", "b"]] });

    sheet.setCells([
      { address: a1, value: "한글" },
      { address: b1, value: "" },
    ]);

    expect(sheet.get(a1)).toBe("한글");
    expect(sheet.has(b1)).toBe(false);
    expect(sheet.size).toBe(1);
  });

  test("바뀐 셀 주소를 한 번에 알린다", () => {
    const sheet = new Sheet({ rowCount: 2, colCount: 2 });
    const calls: unknown[] = [];
    sheet.onChange((addresses) => calls.push(addresses));

    sheet.setCells([
      { address: a1, value: "1" },
      { address: b1, value: "2" },
    ]);

    expect(calls).toEqual([[a1, b1]]);
  });

  test("바꿀 셀이 없으면 알리지 않는다", () => {
    const sheet = new Sheet({ rowCount: 1, colCount: 1 });
    let count = 0;
    sheet.onChange(() => count++);

    sheet.setCells([]);

    expect(count).toBe(0);
  });

  test("알림을 끊으면 더 부르지 않는다", () => {
    const sheet = new Sheet({ rowCount: 1, colCount: 1 });
    let count = 0;
    const stop = sheet.onChange(() => count++);

    stop();
    sheet.setCells([{ address: a1, value: "x" }]);

    expect(count).toBe(0);
  });

  test("시트 밖 셀이 하나라도 있으면 아무것도 바꾸지 않고 에러를 던진다", () => {
    const sheet = new Sheet({ rowCount: 1, colCount: 1 });
    let count = 0;
    sheet.onChange(() => count++);

    expect(() =>
      sheet.setCells([
        { address: a1, value: "x" },
        { address: { row: 0, col: 1 }, value: "y" },
      ]),
    ).toThrow(RangeError);
    expect(() => sheet.setCells([{ address: { row: -1, col: 0 }, value: "y" }])).toThrow(RangeError);
    expect(sheet.has(a1)).toBe(false);
    expect(count).toBe(0);
  });
});
