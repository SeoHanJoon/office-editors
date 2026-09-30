import { test } from "vitest";
import type { CellAddress } from "./address";
import { FormulaEngine } from "./formula-engine";
import { bigSumSheet, chainSheet, fullSheet, scoreSheet } from "./perf-sheets";
import { SetCellsCommand } from "./set-cells-command";
import type { Sheet } from "./sheet";
import type { StructureChange } from "./structure";
import { StructureCommand } from "./structure-command";

// 다시 계산 속도. README "Excel 성능 목표"의 두 줄(1만 개 연결 0.05초, 큰 SUM 시트 수정 0.016초)과
// 10만 행 시트를 처음 여는 시간을 잰다. 표의 mean(ms)이 한 번 걸린 평균 시간이다.

/** 셀 하나를 사용자가 입력하듯 Command로 바꾼다. 매번 다른 값을 넣어 늘 다시 계산되게 한다. */
function editor(sheet: Sheet, address: CellAddress): () => void {
  let count = 0;
  return () => new SetCellsCommand(sheet, [{ address, value: String(++count % 1000) }]).execute();
}

/** 행·열 변경을 한 번 하고 바로 되돌린다. 시트가 계속 커지지 않게 둘을 한 번에 잰다. */
function changeAndUndo(sheet: Sheet, change: StructureChange): () => void {
  return () => {
    const command = new StructureCommand(sheet, change);
    command.execute();
    command.undo();
  };
}

/** 처음 열기처럼 한 번에 오래 걸리는 작업은 몇 번만 잰다. */
const FEW = { time: 0, iterations: 5, warmup: false };

test("연결된 셀 1만 개 다시 계산 (목표 50ms)", async ({ bench }) => {
  const sheet = chainSheet(10_000);
  new FormulaEngine(sheet);
  await bench("A1 수정 → A2~A10000 다시 계산", editor(sheet, { row: 0, col: 0 })).run();
});

test("큰 SUM 수식이 있는 시트에서 셀 하나 수정 (목표 16ms)", async ({ bench }) => {
  const sheet = bigSumSheet();
  new FormulaEngine(sheet);
  await bench("=SUM(A1:A100000) 시트에서 A501 수정", editor(sheet, { row: 500, col: 0 })).run();
});

test("행마다 범위 수식이 있는 10만 행 시트에서 셀 하나 수정", async ({ bench }) => {
  const sheet = scoreSheet();
  new FormulaEngine(sheet);
  await bench("성적표 D501 수정 → G501, H501, K1 다시 계산", editor(sheet, { row: 500, col: 3 })).run();
});

test("10만 행 시트 처음 열기", { timeout: 300_000 }, async ({ bench }) => {
  const score = scoreSheet();
  const full = fullSheet();
  await bench.compare(
    bench("성적표 (값 60만 칸 + 범위 수식 20만 개)", () => new FormulaEngine(score).destroy()),
    bench("50열을 꽉 채운 값 500만 칸", () => new FormulaEngine(full).destroy()),
    FEW,
  );
});

test("10만 행 성적표 맨 위(2행)에 행 넣기·지우기 (+ 되돌리기)", { timeout: 300_000 }, async ({ bench }) => {
  const plain = scoreSheet();
  const withEngine = scoreSheet();
  new FormulaEngine(withEngine);
  const insert: StructureChange = { kind: "insert", axis: "row", index: 1, count: 1 };
  const remove: StructureChange = { kind: "delete", axis: "row", index: 1, count: 1 };
  await bench.compare(
    bench("시트만: 행 삽입 + undo (수식 20만 개 글자 고치기)", changeAndUndo(plain, insert)),
    bench("엔진까지: 행 삽입 + undo", changeAndUndo(withEngine, insert)),
    bench("엔진까지: 행 삭제 + undo", changeAndUndo(withEngine, remove)),
    FEW,
  );
});
