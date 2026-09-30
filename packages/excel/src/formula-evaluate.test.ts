import { describe, expect, test } from "vitest";
import type { CellRange } from "./address";
import { evaluateFormula, textToNumber, type EvalContext, type FormulaFunction } from "./formula-evaluate";
import { parseFormula } from "./formula-parser";
import { FormulaError, type CellValue } from "./formula-value";

/** cells("A1" → 값)만 있는 시트에서 수식을 계산한다. 함수는 functions에 넣은 것만 있다. */
function calc(formula: string, cells: Record<string, CellValue> = {}, functions: Record<string, FormulaFunction> = {}) {
  const values = new Map(Object.entries(cells).map(([a1, value]) => [a1, value]));
  const key = ({ row, col }: { row: number; col: number }) => `${String.fromCharCode(65 + col)}${row + 1}`;
  const context: EvalContext = {
    value: (address) => values.get(key(address)) ?? null,
    *rangeValues(range: CellRange) {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) yield values.get(key({ row, col })) ?? null;
      }
    },
  };
  return evaluateFormula(parseFormula(formula), context, (name) => functions[name]);
}

const error = (code: FormulaError["code"]) => new FormulaError(code);

describe("사칙연산과 거듭제곱", () => {
  test("셀 값을 더한다: =A1+B1", () => {
    expect(calc("=A1+B1", { A1: 1, B1: 2 })).toBe(3);
  });

  test("우선순위대로 계산한다", () => {
    expect(calc("=1+2*3")).toBe(7);
    expect(calc("=(1+2)*3")).toBe(9);
    expect(calc("=-2^2")).toBe(4);
    expect(calc("=2^3^2")).toBe(64);
    expect(calc("=10-4-3")).toBe(3);
  });

  test("%는 100으로 나눈다", () => {
    expect(calc("=50%")).toBe(0.5);
    expect(calc("=200*10%")).toBe(20);
  });

  test("빈 셀은 0으로 계산한다", () => {
    expect(calc("=A1+5")).toBe(5);
    expect(calc("=-A1")).toBe(-0);
  });

  test("TRUE는 1, FALSE는 0으로 계산한다", () => {
    expect(calc("=TRUE+TRUE")).toBe(2);
    expect(calc("=A1*3", { A1: false })).toBe(0);
  });

  test("숫자 모양 글자는 숫자로 바꿔 계산한다", () => {
    expect(calc('="3"+1')).toBe(4);
    expect(calc("=A1*2", { A1: " 50% " })).toBe(1);
  });

  test("숫자로 바꿀 수 없는 글자는 #VALUE!", () => {
    expect(calc("=A1+1", { A1: "사과" })).toEqual(error("#VALUE!"));
    expect(calc('=""+1')).toEqual(error("#VALUE!"));
  });

  test("0으로 나누면 #DIV/0!", () => {
    expect(calc("=1/0")).toEqual(error("#DIV/0!"));
    expect(calc("=1/A1")).toEqual(error("#DIV/0!"));
  });

  test("계산할 수 없는 거듭제곱과 넘침은 #NUM!, 0의 음수 거듭제곱은 #DIV/0!", () => {
    expect(calc("=0^0")).toEqual(error("#NUM!"));
    expect(calc("=(-8)^(1/3)")).toEqual(error("#NUM!"));
    expect(calc("=10^400")).toEqual(error("#NUM!"));
    expect(calc("=0^-1")).toEqual(error("#DIV/0!"));
  });
});

describe("에러 전파", () => {
  test("참조한 셀의 에러를 그대로 돌려준다", () => {
    expect(calc("=A1+1", { A1: error("#N/A") })).toEqual(error("#N/A"));
  });

  test("양쪽이 모두 에러면 왼쪽 에러를 돌려준다", () => {
    expect(calc("=A1+B1", { A1: error("#N/A"), B1: error("#DIV/0!") })).toEqual(error("#N/A"));
    expect(calc("=#REF!&#NUM!")).toEqual(error("#REF!"));
    expect(calc("=#NULL!=#NUM!")).toEqual(error("#NULL!"));
  });

  test("모르는 이름과 모르는 함수는 #NAME?", () => {
    expect(calc("=합계+1")).toEqual(error("#NAME?"));
    expect(calc("=NOPE(1)")).toEqual(error("#NAME?"));
  });
});

describe("글자 연결 (&)", () => {
  test("숫자·논리값·빈 셀을 글자로 바꿔 잇는다", () => {
    expect(calc('="값: "&A1', { A1: 1.5 })).toBe("값: 1.5");
    expect(calc("=TRUE&A1&0.1*3")).toBe("TRUE0.3");
  });
});

describe("비교", () => {
  test("숫자를 비교한다", () => {
    expect(calc("=1<2")).toBe(true);
    expect(calc("=2<=1")).toBe(false);
    expect(calc("=A1=3", { A1: 3 })).toBe(true);
    expect(calc("=1<>1")).toBe(false);
  });

  test("글자는 대소문자를 가리지 않고 비교한다", () => {
    expect(calc('="abc"="ABC"')).toBe(true);
    expect(calc('="a"<"B"')).toBe(true);
  });

  test("종류가 다르면 숫자 < 글자 < 논리값이다", () => {
    expect(calc('=99<"1"')).toBe(true);
    expect(calc('="z"<FALSE')).toBe(true);
    expect(calc('=1="1"')).toBe(false);
  });

  test("빈 셀은 상대 종류의 기본값(0, 빈 글자, FALSE)과 같다", () => {
    expect(calc("=A1=0")).toBe(true);
    expect(calc('=A1=""')).toBe(true);
    expect(calc("=A1=FALSE")).toBe(true);
    expect(calc("=A1=B1")).toBe(true);
  });
});

describe("결과 모양", () => {
  test("빈 셀 하나를 가리키면 0이다", () => {
    expect(calc("=A1")).toBe(0);
  });

  test("글자와 논리값은 그대로 돌려준다", () => {
    expect(calc("=A1", { A1: "글자" })).toBe("글자");
    expect(calc("=+A1", { A1: "글자" })).toBe("글자");
  });

  test("범위 하나가 결과이거나 연산에 쓰이면 #VALUE!", () => {
    expect(calc("=A1:A3")).toEqual(error("#VALUE!"));
    expect(calc("=A1:A3+1")).toEqual(error("#VALUE!"));
  });
});

describe("함수 인자", () => {
  test("직접 쓴 값, 셀·범위 참조, 빈 자리를 구분해서 넘긴다", () => {
    const seen: unknown[] = [];
    const spy: FormulaFunction = (args) => {
      for (const arg of args) seen.push(arg.kind === "reference" ? { kind: arg.kind, values: [...arg.values] } : arg);
      return 0;
    };

    calc('=F("3", A1, (A1), A1:B2, , 1+1)', { A1: 1, B2: 2 }, { F: spy });

    expect(seen).toEqual([
      { kind: "value", value: "3" },
      { kind: "reference", values: [1] },
      { kind: "reference", values: [1] },
      { kind: "reference", values: [1, null, null, 2] },
      { kind: "missing" },
      { kind: "value", value: 2 },
    ]);
  });

  test("거꾸로 쓴 범위(B2:A1)도 같은 범위다", () => {
    const seen: CellValue[][] = [];
    const spy: FormulaFunction = ([arg]) => {
      if (arg?.kind === "reference") seen.push([...arg.values]);
      return 0;
    };

    calc("=F(B2:A1)", { A1: 1, B2: 2 }, { F: spy });

    expect(seen).toEqual([[1, null, null, 2]]);
  });
});

describe("숫자 모양 글자 바꾸기", () => {
  test("앞뒤 빈 칸과 끝의 %를 허용한다", () => {
    expect(textToNumber(" 12 ")).toBe(12);
    expect(textToNumber("50%")).toBe(0.5);
    expect(textToNumber("abc")).toBeNull();
    expect(textToNumber("%")).toBeNull();
  });
});
