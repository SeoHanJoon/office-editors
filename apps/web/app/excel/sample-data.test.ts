import { FormulaEngine, formatValue } from "@office/excel";
import { expect, test } from "vitest";
import { createSampleSheet } from "./sample-data";

test("예시 시트는 10만 행 × 50열이고 1행은 제목, 100,000행까지 값이 있다", () => {
  const sheet = createSampleSheet();

  expect([sheet.rowCount, sheet.colCount]).toEqual([100_000, 50]);
  expect(sheet.get({ row: 0, col: 0 })).toBe("번호");
  expect(sheet.get({ row: 99_999, col: 0 })).toBe("99999");
  expect(sheet.get({ row: 99_999, col: 6 })).toBe("=SUM(D100000:F100000)");
  expect(sheet.has({ row: 1, col: 8 })).toBe(false);
  expect(sheet.has({ row: 1, col: 11 })).toBe(false);
});

test("총점·평균·총점 합계 수식이 계산된다", () => {
  const sheet = createSampleSheet();
  const engine = new FormulaEngine(sheet);
  const value = (row: number, col: number) => engine.getValue({ row, col });

  const scores = [3, 4, 5].map((col) => Number(sheet.get({ row: 1, col })));
  expect(value(1, 6)).toBe(scores[0]! + scores[1]! + scores[2]!);
  expect(formatValue(value(1, 7))).toBe(formatValue((scores[0]! + scores[1]! + scores[2]!) / 3));

  let total = 0;
  for (let row = 1; row < 100_000; row++) total += value(row, 6) as number;
  expect(value(0, 10)).toBe(total);
}, 30_000);

test("만들 때마다 같은 값이 나온다", () => {
  const a = createSampleSheet();
  const b = createSampleSheet();

  expect(b.get({ row: 500, col: 1 })).toBe(a.get({ row: 500, col: 1 }));
});
