import { describe, expect, test } from "vitest";
import type { CellRange } from "./address";
import { evaluateFormula, type EvalContext } from "./formula-evaluate";
import { lookupFunction } from "./formula-functions";
import { parseFormula } from "./formula-parser";
import { FormulaError, type CellValue } from "./formula-value";

/** A열 위에서부터 columnA 값이 들어 있는 시트에서 수식을 계산한다. 다른 셀은 비어 있다. */
function calc(formula: string, columnA: readonly CellValue[] = []) {
  const at = (row: number, col: number) => (col === 0 ? (columnA[row] ?? null) : null);
  const context: EvalContext = {
    value: ({ row, col }) => at(row, col),
    *rangeValues(range: CellRange) {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) yield at(row, col);
      }
    },
  };
  return evaluateFormula(parseFormula(formula), context, lookupFunction);
}

const error = (code: FormulaError["code"]) => new FormulaError(code);
/** 숫자, 글자, 논리값, 빈 셀, 숫자 모양 글자가 섞인 A1:A5 */
const MIXED: CellValue[] = [1, "사과", true, null, "10"];

describe("SUM", () => {
  test("범위의 숫자를 더한다: =SUM(A1:A10)", () => {
    expect(calc("=SUM(A1:A10)", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(55);
  });

  test("범위와 값을 여러 개 섞어 더한다", () => {
    expect(calc("=SUM(A1:A2, 10, A3)", [1, 2, 3])).toBe(16);
  });

  test("범위 안의 글자·논리값·빈 셀·숫자 모양 글자는 무시한다", () => {
    expect(calc("=SUM(A1:A5)", MIXED)).toBe(1);
    expect(calc("=SUM(A2)", MIXED)).toBe(0);
  });

  test("직접 쓴 논리값과 숫자 모양 글자는 숫자로 더한다", () => {
    expect(calc('=SUM(TRUE, "3", 1)')).toBe(5);
  });

  test("직접 쓴 숫자가 아닌 글자는 #VALUE!", () => {
    expect(calc('=SUM(1, "사과")')).toEqual(error("#VALUE!"));
  });

  test("범위에 에러가 있으면 에러를 돌려준다", () => {
    expect(calc("=SUM(A1:A3)", [1, error("#DIV/0!"), 2])).toEqual(error("#DIV/0!"));
    expect(calc("=SUM(1, 1/0)")).toEqual(error("#DIV/0!"));
  });

  test("빈 범위는 0, 빈 인자 자리는 0이다", () => {
    expect(calc("=SUM(B1:B10)")).toBe(0);
    expect(calc("=SUM(1,,2)")).toBe(3);
  });

  test("여러 행·열 범위를 모두 더한다", () => {
    expect(calc("=SUM(A1:C3)", [1, 2, 3, 4])).toBe(6);
  });
});

describe("AVERAGE", () => {
  test("범위 숫자의 평균이다. 글자·논리값·빈 셀은 개수에서도 뺀다", () => {
    expect(calc("=AVERAGE(A1:A3)", [1, 2, 6])).toBe(3);
    expect(calc("=AVERAGE(A1:A6)", [...MIXED, 5])).toBe(3);
  });

  test("직접 쓴 논리값과 숫자 모양 글자, 빈 인자 자리는 개수에 넣는다", () => {
    expect(calc('=AVERAGE(TRUE, "5")')).toBe(3);
    expect(calc("=AVERAGE(4,)")).toBe(2);
  });

  test("숫자가 하나도 없으면 #DIV/0!", () => {
    expect(calc("=AVERAGE(A1:A2)", ["a", null])).toEqual(error("#DIV/0!"));
  });

  test("직접 쓴 숫자가 아닌 글자는 #VALUE!, 에러는 그대로", () => {
    expect(calc('=AVERAGE("a")')).toEqual(error("#VALUE!"));
    expect(calc("=AVERAGE(A1:A2)", [1, error("#N/A")])).toEqual(error("#N/A"));
  });
});

describe("MIN / MAX", () => {
  test("범위에서 가장 작은 수와 큰 수를 찾는다", () => {
    expect(calc("=MIN(A1:A4)", [3, -2, 8, 0])).toBe(-2);
    expect(calc("=MAX(A1:A4)", [3, -2, 8, 0])).toBe(8);
  });

  test("범위 안의 글자·논리값·빈 셀은 무시한다", () => {
    expect(calc("=MIN(A1:A5)", MIXED)).toBe(1);
    expect(calc("=MAX(A1:A5)", MIXED)).toBe(1);
  });

  test("숫자가 하나도 없으면 0이다", () => {
    expect(calc("=MIN(A1:A2)", ["a", true])).toBe(0);
    expect(calc("=MAX(B1:B3)")).toBe(0);
  });

  test("직접 쓴 논리값과 숫자 모양 글자는 숫자로 본다", () => {
    expect(calc('=MAX(TRUE, "0.5")')).toBe(1);
    expect(calc('=MIN(TRUE, "0.5")')).toBe(0.5);
  });

  test("빈 인자 자리는 0으로 본다", () => {
    expect(calc("=MIN(5,)")).toBe(0);
  });

  test("직접 쓴 숫자가 아닌 글자는 #VALUE!, 에러는 그대로", () => {
    expect(calc('=MIN("a", 1)')).toEqual(error("#VALUE!"));
    expect(calc("=MAX(A1:A2)", [1, error("#NUM!")])).toEqual(error("#NUM!"));
  });

  test("큰 범위에서도 계산한다", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => i);
    expect(calc("=MAX(A1:A200000)", many)).toBe(199_999);
  });
});

describe("COUNT", () => {
  test("범위에서는 숫자만 센다", () => {
    expect(calc("=COUNT(A1:A5)", MIXED)).toBe(1);
  });

  test("직접 쓴 숫자, 논리값, 숫자 모양 글자는 센다", () => {
    expect(calc('=COUNT(1, TRUE, "3", "사과")')).toBe(3);
  });

  test("에러는 세지도 전파하지도 않는다", () => {
    expect(calc("=COUNT(A1:A3)", [1, error("#DIV/0!"), 2])).toBe(2);
    expect(calc("=COUNT(1/0, 1)")).toBe(1);
  });

  test("빈 범위는 0개다", () => {
    expect(calc("=COUNT(B1:B5)")).toBe(0);
  });
});

test("함수 이름은 대소문자를 가리지 않는다", () => {
  expect(calc("=sum(1,2)+Max(3)")).toBe(6);
});
