import { test } from "vitest";
import { FormulaEngine } from "./formula-engine";
import { AutoRowLines } from "./auto-row-lines";
import { DEFAULT_LAYOUT, gridGeometry, uniformGeometry } from "./layout";
import { PERF_ROWS, multilineSheet, scoreSheet } from "./perf-sheets";
import { autoRowHeight, drawGrid } from "./render";
import { selectCell } from "./selection";

// 스크롤 60fps 측정 방법 ③: 브라우저 없이 drawGrid 한 번의 JS 시간만 잰다.
// Canvas 호출은 아무것도 안 하는 가짜라 실제 픽셀을 그리는 시간은 빠진다. (그 시간은 apps/web의 스크롤 측정이 잰다)
// 한 프레임(16.7ms) 중 브라우저 몫을 빼면 JS에 쓸 수 있는 시간은 대략 8ms 안쪽이다.

/** 그리기 호출을 받기만 하는 가짜 Canvas. measureText는 글자당 7px로 셈한다. */
function fakeContext(): CanvasRenderingContext2D {
  const noop = () => {};
  const ctx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    setTransform: noop,
    measureText: (text: string) => ({ width: text.length * 7 }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

test("10만 행 성적표 한 화면 그리기 (1280×800)", async ({ bench }) => {
  const sheet = scoreSheet();
  const engine = new FormulaEngine(sheet);
  const ctx = fakeContext();
  const layout = DEFAULT_LAYOUT;
  const geometry = uniformGeometry(layout, sheet);
  const selection = selectCell({ row: 0, col: 0 });
  // 한 번 그릴 때마다 한 화면 조금 넘게 내려가며 시트 전체를 돈다. (같은 칸만 그리지 않게)
  const step = 37 * layout.rowHeight;
  const maxTop = PERF_ROWS * layout.rowHeight;
  let scrollTop = 0;
  await bench("drawGrid 한 번", () => {
    scrollTop = (scrollTop + step) % maxTop;
    drawGrid(ctx, { sheet, engine, selection, geometry, viewport: { scrollLeft: 0, scrollTop, width: 1280, height: 800 }, fillHandle: true });
  }).run();
});

test("행마다 높이가 다른 10만 행 한 화면 그리기 (1280×800)", async ({ bench }) => {
  const sheet = multilineSheet();
  const engine = new FormulaEngine(sheet);
  const ctx = fakeContext();
  const layout = DEFAULT_LAYOUT;
  const autoRows = new AutoRowLines(sheet);
  const rowSizes = [...autoRows.entries()].map(([row, lines]) => [row, autoRowHeight(lines, layout.rowHeight)] as const);
  const geometry = gridGeometry(layout, sheet, rowSizes, []);
  const selection = selectCell({ row: 0, col: 0 });
  const step = 800 * 1.1;
  const maxTop = geometry.rows.total;
  let scrollTop = 0;
  await bench("drawGrid 한 번 (여러 줄 셀 포함)", () => {
    scrollTop = (scrollTop + step) % maxTop;
    drawGrid(ctx, { sheet, engine, selection, geometry, viewport: { scrollLeft: 0, scrollTop, width: 1280, height: 800 }, fillHandle: true });
  }).run();
});
