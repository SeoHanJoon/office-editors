import { test } from "vitest";
import { AutoRowLines } from "./auto-row-lines";
import { DEFAULT_LAYOUT } from "./layout";
import { LineSizes } from "./line-sizes";
import { PERF_ROWS, multilineSheet, scoreSheet } from "./perf-sheets";
import { autoRowHeight } from "./render";

// 줄마다 크기가 달라질 때(Step 8) 추가된 일의 시간을 잰다.

/** 한 번에 수십 ms 걸리는 측정은 몇 번만 돈다. */
const FEW = { time: 0, iterations: 10, warmup: false };

test("행 높이 자동 맞춤: 처음 열 때 시트를 훑어 줄 수 세기", { timeout: 300_000 }, async ({ bench }) => {
  const plain = scoreSheet();
  const multiline = multilineSheet();
  await bench.compare(
    bench("성적표 (셀 80만 개, 줄바꿈 없음)", () => new AutoRowLines(plain)),
    bench("모든 행에 1~4줄 메모 (셀 90만 개, 줄바꿈 셀 7만 5천 개)", () => new AutoRowLines(multiline)),
    FEW,
  );
});

test("줄 크기 색인 만들기 (크기가 바뀌거나 셀 높이가 바뀔 때마다)", async ({ bench }) => {
  const autoRows = new AutoRowLines(multilineSheet());
  const heights = [...autoRows.entries()].map(([row, lines]) => [row, autoRowHeight(lines, DEFAULT_LAYOUT.rowHeight)] as const);
  const few = heights.slice(0, 100);
  await bench.compare(
    bench("바뀐 줄 없음", () => new LineSizes(PERF_ROWS, DEFAULT_LAYOUT.rowHeight)),
    bench("바뀐 줄 100개", () => new LineSizes(PERF_ROWS, DEFAULT_LAYOUT.rowHeight, few)),
    bench(`바뀐 줄 ${heights.length.toLocaleString()}개`, () => new LineSizes(PERF_ROWS, DEFAULT_LAYOUT.rowHeight, heights)),
  );
});

test("위치 → 줄 찾기 1,000번 (바뀐 줄 7만 5천 개)", async ({ bench }) => {
  const autoRows = new AutoRowLines(multilineSheet());
  const sizes = new LineSizes(
    PERF_ROWS,
    DEFAULT_LAYOUT.rowHeight,
    [...autoRows.entries()].map(([row, lines]) => [row, autoRowHeight(lines, DEFAULT_LAYOUT.rowHeight)] as const),
  );
  const step = sizes.total / 1000;
  await bench("lineAt + offset", () => {
    for (let i = 0; i < 1000; i++) sizes.offset(sizes.lineAt(i * step));
  }).run();
});
