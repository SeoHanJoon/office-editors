import { test } from "vitest";
import { AutoRowHeights } from "./auto-row-heights";
import { FormulaEngine } from "./formula-engine";
import { patchFormatChanges } from "./format-edit";
import { DEFAULT_LAYOUT } from "./layout";
import { PERF_ROWS, scoreSheet } from "./perf-sheets";
import { SetFormatsCommand } from "./set-formats-command";

// Step 10: 10만 행 시트에서 열 전체에 서식을 줘도 느려지지 않아야 한다. (README "Step 10 범위", ADR 0034)

/** 한 번에 수십 ms 걸리는 측정은 몇 번만 돈다. */
const FEW = { time: 0, iterations: 10, warmup: false };

test("10만 행 열 하나에 굵게 주기 + 되돌리기", { timeout: 300_000 }, async ({ bench }) => {
  const sheet = scoreSheet();
  const whole = { top: 0, left: 3, bottom: PERF_ROWS - 1, right: 3 };
  // 1행만 빼고 끌어 고르면 열 전체가 아니라서 셀마다 저장한다.
  const cells = { ...whole, top: 1 };
  const applyAndUndo = (range: typeof whole) => () => {
    const command = new SetFormatsCommand(sheet, patchFormatChanges(sheet, range, { bold: true }));
    command.execute();
    command.undo();
  };
  await bench.compare(
    bench("열 머리글로 고른 D열 전체 (열 서식 하나)", applyAndUndo(whole)),
    bench("D2:D100000을 끌어 고름 (셀 서식 10만 개)", applyAndUndo(cells)),
    FEW,
  );
});

test("10만 행 열 전체에 자동 줄바꿈: 행 높이 다시 재기", { timeout: 300_000 }, async ({ bench }) => {
  const sheet = scoreSheet();
  const engine = new FormulaEngine(sheet);
  sheet.setFormats({ cols: [{ index: 1, format: { wrap: true } }] });
  // 글자당 7px. 이름("학생12345")은 한 줄에 들어가므로 줄 수는 그대로이고, 10만 칸을 재는 시간만 잰다.
  const auto = new AutoRowHeights(
    sheet,
    { value: (address) => engine.getValue(address), colWidth: () => DEFAULT_LAYOUT.colWidth, measure: (text) => text.length * 7 },
    DEFAULT_LAYOUT.rowHeight,
  );
  await bench("B열 자동 줄바꿈 셀 10만 개", () => auto.rebuild()).run();
});
