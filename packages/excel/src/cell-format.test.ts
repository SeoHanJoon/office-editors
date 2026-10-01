import { describe, expect, test } from "vitest";
import {
  CLEAR_FORMAT,
  DEFAULT_FORMAT,
  changeDecimals,
  formatCellValue,
  formatKey,
  formatWithNumberFormat,
  lineHeightFor,
  mergeFormat,
  numberFormatOf,
} from "./cell-format";
import { FormulaError } from "./formula-value";

describe("mergeFormat", () => {
  test("patch에 있는 항목만 바꾸고 base는 그대로 둔다", () => {
    const base = { bold: true, color: "#ff0000" } as const;

    const merged = mergeFormat(base, { italic: true, color: "#0000ff" });

    expect(merged).toEqual({ bold: true, italic: true, color: "#0000ff" });
    expect(base).toEqual({ bold: true, color: "#ff0000" });
  });

  test("null·false·기본값은 항목을 지운다", () => {
    const base = { bold: true, fontSize: 14, fill: "#ffff00", numberFormat: { kind: "percent", decimals: 0 } } as const;

    expect(mergeFormat(base, { bold: false, fontSize: 10, fill: null, numberFormat: { kind: "general" } })).toEqual({});
  });

  test("서식 지우기는 모든 항목을 기본으로 돌린다", () => {
    const base = { bold: true, borderTop: true, align: "center", wrap: true } as const;

    expect(mergeFormat(base, CLEAR_FORMAT)).toEqual(DEFAULT_FORMAT);
  });
});

describe("formatKey", () => {
  test("항목 순서와 상관없이 같은 서식이면 같은 키다", () => {
    expect(formatKey({ bold: true, color: "#000000" })).toBe(formatKey({ color: "#000000", bold: true }));
    expect(formatKey({ numberFormat: { kind: "number", decimals: 2 } })).not.toBe(
      formatKey({ numberFormat: { kind: "number", decimals: 1 } }),
    );
    expect(formatKey(DEFAULT_FORMAT)).toBe("");
  });
});

describe("숫자 형식", () => {
  test("숫자: 천 단위 쉼표와 소수 자릿수", () => {
    const format = { kind: "number", decimals: 2 } as const;

    expect(formatWithNumberFormat(1234567.891, format)).toBe("1,234,567.89");
    expect(formatWithNumberFormat(-1234.5, format)).toBe("-1,234.50");
    expect(formatWithNumberFormat(0, format)).toBe("0.00");
    expect(formatWithNumberFormat(999, { kind: "number", decimals: 0 })).toBe("999");
  });

  test("통화: ₩와 쉼표, 음수는 앞에 -", () => {
    expect(formatWithNumberFormat(1234567, { kind: "currency", decimals: 0 })).toBe("₩1,234,567");
    expect(formatWithNumberFormat(-50.5, { kind: "currency", decimals: 1 })).toBe("-₩50.5");
  });

  test("백분율: 100을 곱하고 %를 붙인다", () => {
    expect(formatWithNumberFormat(0.256, { kind: "percent", decimals: 0 })).toBe("26%");
    expect(formatWithNumberFormat(0.256, { kind: "percent", decimals: 1 })).toBe("25.6%");
    expect(formatWithNumberFormat(12.5, { kind: "percent", decimals: 0 })).toBe("1250%");
  });

  test("10진수 기준으로 0에서 먼 쪽으로 반올림한다", () => {
    const format = { kind: "number", decimals: 2 } as const;

    expect(formatWithNumberFormat(1.005, format)).toBe("1.01");
    expect(formatWithNumberFormat(-1.005, format)).toBe("-1.01");
    expect(formatWithNumberFormat(0.1 + 0.2, format)).toBe("0.30");
    expect(formatWithNumberFormat(2.5, { kind: "number", decimals: 0 })).toBe("3");
  });

  test("반올림해 0이 된 음수에는 -를 붙이지 않는다", () => {
    expect(formatWithNumberFormat(-0.001, { kind: "number", decimals: 2 })).toBe("0.00");
  });

  test("아주 크거나 작은 수", () => {
    expect(formatWithNumberFormat(0.0000001, { kind: "number", decimals: 2 })).toBe("0.00");
    expect(formatWithNumberFormat(1e22, { kind: "number", decimals: 0 })).toBe("1E+22");
  });

  test("형식을 처음 고르면 숫자는 2자리, 통화·백분율은 0자리다", () => {
    expect(numberFormatOf("number")).toEqual({ kind: "number", decimals: 2 });
    expect(numberFormatOf("currency")).toEqual({ kind: "currency", decimals: 0 });
    expect(numberFormatOf("percent")).toEqual({ kind: "percent", decimals: 0 });
    expect(numberFormatOf("general")).toEqual({ kind: "general" });
  });

  test("소수 자릿수 늘리기·줄이기", () => {
    expect(changeDecimals({ kind: "currency", decimals: 0 }, 1, "₩5")).toEqual({ kind: "currency", decimals: 1 });
    expect(changeDecimals({ kind: "percent", decimals: 0 }, -1, "5%")).toEqual({ kind: "percent", decimals: 0 });
    // 일반이면 지금 보이는 자릿수에서 시작해 숫자 형식이 된다.
    expect(changeDecimals({ kind: "general" }, 1, "3.25")).toEqual({ kind: "number", decimals: 3 });
    expect(changeDecimals({ kind: "general" }, -1, "3.25")).toEqual({ kind: "number", decimals: 1 });
    expect(changeDecimals({ kind: "general" }, 1, "12")).toEqual({ kind: "number", decimals: 1 });
    expect(changeDecimals({ kind: "general" }, 1, "1E-05")).toEqual({ kind: "number", decimals: 1 });
  });

  test("셀에 보이는 글자: 숫자만 숫자 형식을 따른다", () => {
    const format = { numberFormat: { kind: "number", decimals: 1 } } as const;

    expect(formatCellValue(1234, format)).toBe("1,234.0");
    expect(formatCellValue("글자", format)).toBe("글자");
    expect(formatCellValue(true, format)).toBe("TRUE");
    expect(formatCellValue(new FormulaError("#DIV/0!"), format)).toBe("#DIV/0!");
    expect(formatCellValue(null, format)).toBe("");
    expect(formatCellValue(0.1 + 0.2, DEFAULT_FORMAT)).toBe("0.3");
  });
});

describe("글자 크기", () => {
  test("기본 크기(10pt)의 줄 높이는 지금 셀 줄 높이(16px)와 같다", () => {
    expect(lineHeightFor(10)).toBe(16);
    expect(lineHeightFor(20)).toBeGreaterThan(30);
  });
});
