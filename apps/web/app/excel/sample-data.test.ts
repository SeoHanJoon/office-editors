import { expect, test } from "vitest";
import { createSampleSheet } from "./sample-data";

test("예시 시트는 1,000행 × 26열이고 1행은 제목, 1,000행까지 값이 있다", () => {
  const sheet = createSampleSheet();

  expect([sheet.rowCount, sheet.colCount]).toEqual([1000, 26]);
  expect(sheet.get({ row: 0, col: 0 })).toBe("번호");
  expect(sheet.get({ row: 999, col: 0 })).toBe("999");
  expect(sheet.has({ row: 999, col: 3 })).toBe(true);
  expect(sheet.has({ row: 0, col: 4 })).toBe(false);
});

test("만들 때마다 같은 값이 나온다", () => {
  const a = createSampleSheet();
  const b = createSampleSheet();

  expect(b.get({ row: 500, col: 1 })).toBe(a.get({ row: 500, col: 1 }));
});
