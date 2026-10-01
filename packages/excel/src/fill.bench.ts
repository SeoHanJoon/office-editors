import { test } from "vitest";
import { autoFillEnd, fillChanges } from "./fill";
import { FormulaEngine } from "./formula-engine";
import { scoreSheet } from "./perf-sheets";
import { SetCellsCommand } from "./set-cells-command";

// 채우기 핸들을 두 번 눌러 10만 행을 채우는 시간. (목표 없이 잰다)
// 옆 열에 값이 이어진 곳을 찾고, 채울 값을 만들고, 시트에 넣어 다시 계산한 뒤 되돌리기까지 한 번에 잰다.

const FEW = { time: 0, iterations: 5, warmup: false };

test("10만 행 성적표에서 핸들 두 번 눌러 채우기 (+ 되돌리기)", { timeout: 300_000 }, async ({ bench }) => {
  const formula = scoreSheet();
  const numbers = scoreSheet();
  new FormulaEngine(formula);
  new FormulaEngine(numbers);
  // I2에 수식, 숫자 두 칸(I2:I3)을 넣고 H열 끝(10만 행)까지 채운다.
  new SetCellsCommand(formula, [{ address: { row: 1, col: 8 }, value: "=G2*2" }]).execute();
  new SetCellsCommand(numbers, [
    { address: { row: 1, col: 8 }, value: "1" },
    { address: { row: 2, col: 8 }, value: "3" },
  ]).execute();

  await bench.compare(
    bench("수식 =G2*2 → I3:I100000", () => {
      const source = { top: 1, left: 8, bottom: 1, right: 8 };
      const end = autoFillEnd(formula, source)!;
      const command = new SetCellsCommand(formula, fillChanges(formula, source, "down", end - source.bottom));
      command.execute();
      command.undo();
    }),
    bench("숫자 1, 3 → I4:I100000", () => {
      const source = { top: 1, left: 8, bottom: 2, right: 8 };
      const end = autoFillEnd(numbers, source)!;
      const command = new SetCellsCommand(numbers, fillChanges(numbers, source, "down", end - source.bottom));
      command.execute();
      command.undo();
    }),
    FEW,
  );
});
