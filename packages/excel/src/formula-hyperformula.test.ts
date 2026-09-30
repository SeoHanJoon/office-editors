/**
 * 정답 비교 테스트: 같은 시트를 HyperFormula로도 계산해 결과가 같은지 본다.
 * HyperFormula는 여기서만 쓴다. (실제 코드에서는 import하지 않음, .claude/rules/excel.md)
 * HyperFormula가 Excel과 다른 경우는 비교에서 빼고 이유를 적는다.
 */
import { DetailedCellError, HyperFormula } from "hyperformula";
import { describe, expect, test } from "vitest";
import { FormulaEngine } from "./formula-engine";
import { FormulaError, type CellValue } from "./formula-value";
import { Sheet } from "./sheet";

/**
 * 모든 비교에 쓰는 값. 숫자, 숫자 모양 글자, 글자, 논리값, 빈 셀, 에러가 섞여 있다.
 *     A      B       C       D
 * 1   1      10      사과    TRUE
 * 2   2      '5      (빈칸)  -3.5     ← B2는 작은따옴표를 붙여 친 글자 "5"
 * 3   3      0       abc     =1/0
 * 4   0.1    0.2     FALSE   (빈칸)
 */
const DATA = [
  ["1", "10", "사과", "TRUE"],
  ["2", "'5", "", "-3.5"],
  ["3", "0", "abc", "=1/0"],
  ["0.1", "0.2", "FALSE", ""],
];
const HF_DATA = DATA.map((row) => row.map((value) => (value === "" ? null : value)));

/** 비교하기 쉬운 모양: 숫자는 유효 숫자 15자리, 에러는 에러 이름 */
function normalize(value: CellValue | DetailedCellError | undefined): unknown {
  if (value instanceof FormulaError) return value.code;
  if (value instanceof DetailedCellError) return value.value;
  if (typeof value === "number") return Number(value.toPrecision(15));
  return value ?? null;
}

function ours(formula: string): unknown {
  const sheet = new Sheet({ rowCount: 10, colCount: 10, data: [...DATA, [], [], ["", "", "", "", "", "", formula]] });
  const engine = new FormulaEngine(sheet);
  return normalize(engine.getValue({ row: 6, col: 6 }));
}

function theirs(formula: string): unknown {
  const data = [...HF_DATA, [], [], [null, null, null, null, null, null, formula]];
  const hf = HyperFormula.buildFromArray(data, { licenseKey: "gpl-v3" });
  try {
    return normalize(hf.getCellValue({ sheet: 0, row: 6, col: 6 }) as CellValue | DetailedCellError);
  } finally {
    hf.destroy();
  }
}

describe("HyperFormula와 같은 결과", () => {
  test.each([
    // 사칙연산과 우선순위
    "=A1+B1",
    "=A1+A2*A3",
    "=(A1+A2)*A3",
    "=-A3^2",
    "=2^3^2",
    "=A3/A1",
    "=50%*B1",
    "=A4+B4",
    "=A1-A4-B4",
    // 빈 셀, 논리값, 숫자 모양 글자
    "=C2+1",
    "=D1*2",
    "=B2+1",
    "=C1+1",
    // 에러
    "=A1/B3",
    "=D3+1",
    "=(-8)^(1/3)",
    "=#N/A+1",
    "=NOPE(1)",
    // 연결과 비교
    '=A1&"개"',
    "=D1&C2&A4",
    "=A1<B1",
    '=C1="사과"',
    '="ABC"="abc"',
    '=C3<"B"',
    "=A1=D1",
    '=99<"1"',
    "=C2=0",
    '=C2=""',
    // SUM
    "=SUM(A1:A3)",
    "=SUM(A1:D4)",
    "=SUM(A1:C2)",
    '=SUM(1, D1, "3")',
    '=SUM("사과")',
    "=SUM(D1:D3)",
    "=SUM(A1:A3, 10, B1)",
    "=SUM(C1:C4)",
    "=SUM(A4:B4)",
    // AVERAGE
    "=AVERAGE(A1:A3)",
    "=AVERAGE(A1:C3)",
    '=AVERAGE(1, "5")',
    "=AVERAGE(C1:C4)",
    "=AVERAGE(D1:D3)",
    // MIN / MAX
    "=MIN(A1:B3)",
    "=MAX(A1:B3)",
    "=MIN(C1:C4)",
    "=MAX(D1:D2)",
    '=MAX(-1, "0.5")',
    '=MIN("a", 1)',
    "=MAX(A1:D3)",
    // COUNT
    "=COUNT(A1:D4)",
    '=COUNT(1, "3", "사과")',
    "=COUNT(C1:C4)",
    "=COUNT(1/0, 1)",
    // 섞어 쓰기
    "=SUM(A1:A3)/COUNT(A1:A3)=AVERAGE(A1:A3)",
    "=MAX(A1:A3)-MIN(A1:A3)",
  ])("%s", (formula) => {
    expect(ours(formula)).toEqual(theirs(formula));
  });

  // 비교에서 뺀 것 (HyperFormula가 Excel과 다름)
  // - 수식 안에 괄호 없이 쓴 TRUE/FALSE (`=SUM(1, TRUE)`): Excel은 논리값, HyperFormula는 #NAME?
  //   → 직접 쓴 논리값 규칙은 formula-functions.test.ts에서 Excel 기준으로 확인한다.
  // - `=0^-1`: Excel은 #DIV/0!, HyperFormula는 #NUM! → formula-evaluate.test.ts에서 확인한다.

  test("순환 참조는 둘 다 #CYCLE!", () => {
    const formula = "=G7+1";
    expect(ours(formula)).toBe("#CYCLE!");
    expect(theirs(formula)).toBe("#CYCLE!");
  });
});
