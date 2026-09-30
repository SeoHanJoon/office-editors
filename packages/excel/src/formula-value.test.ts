import { describe, expect, test } from "vitest";
import { FormulaError, formatValue, parseLiteral, parseNumber } from "./formula-value";

describe("숫자 모양 글자", () => {
  test("정수, 소수, 부호, 지수 표기는 숫자로 읽는다", () => {
    for (const [input, expected] of [
      ["0", 0],
      ["12", 12],
      ["-3", -3],
      ["+4", 4],
      ["1.5", 1.5],
      [".5", 0.5],
      ["5.", 5],
      ["1e3", 1000],
      ["2.5E-2", 0.025],
      ["007", 7],
    ] as const) {
      expect(parseNumber(input), input).toBe(expected);
    }
  });

  test("글자, 빈 칸이 섞인 입력, 수식은 숫자로 읽지 않는다", () => {
    for (const input of ["", "abc", "12a", " 12", "1 2", "=1+2", "-", ".", "1e"]) {
      expect(parseNumber(input), input).toBeNull();
    }
  });
});

describe("셀 입력을 값으로 바꾸기", () => {
  test("빈 입력은 빈 셀(null)이다", () => {
    expect(parseLiteral("")).toBeNull();
  });

  test("숫자 모양이면 숫자, 아니면 글자 그대로다", () => {
    expect(parseLiteral("12")).toBe(12);
    expect(parseLiteral("김민준")).toBe("김민준");
    expect(parseLiteral(" 12")).toBe(" 12");
  });

  test("TRUE/FALSE는 대소문자와 상관없이 논리값이다", () => {
    expect(parseLiteral("true")).toBe(true);
    expect(parseLiteral("FALSE")).toBe(false);
  });

  test("에러 이름을 치면 에러 값이다", () => {
    expect(parseLiteral("#N/A")).toEqual(new FormulaError("#N/A"));
    expect(parseLiteral("#div/0!")).toEqual(new FormulaError("#DIV/0!"));
    expect(parseLiteral("#CYCLE!")).toBe("#CYCLE!");
  });
});

describe("계산값을 글자로 보여주기", () => {
  test("빈 셀은 빈 글자, 논리값은 대문자, 에러는 에러 이름이다", () => {
    expect(formatValue(null)).toBe("");
    expect(formatValue(true)).toBe("TRUE");
    expect(formatValue(new FormulaError("#DIV/0!"))).toBe("#DIV/0!");
    expect(formatValue("글자")).toBe("글자");
  });

  test("숫자는 유효 숫자 15자리까지만 보여준다", () => {
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(1 / 3)).toBe("0.333333333333333");
    expect(formatValue(-0)).toBe("0");
    expect(formatValue(1.5)).toBe("1.5");
  });

  test("아주 크거나 작은 숫자는 E 표기로 보여준다", () => {
    expect(formatValue(1e21)).toBe("1E+21");
    expect(formatValue(1.5e-7)).toBe("1.5E-7");
  });
});
