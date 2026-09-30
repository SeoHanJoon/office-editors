import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { parseA1, toA1 } from "./address";
import { FormulaEngine } from "./formula-engine";
import { FormulaError, formatValue } from "./formula-value";
import { bigSumSheet, chainSheet, scoreSheet } from "./perf-sheets";
import { SetCellsCommand } from "./set-cells-command";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

/** 셀("A1") → 입력 글자로 시트와 엔진을 만든다. 시트는 10행 × 10열 */
function setup(cells: Record<string, string> = {}) {
  const sheet = new Sheet({ rowCount: 10, colCount: 10 });
  sheet.setCells(Object.entries(cells).map(([a1, value]) => ({ address: at(a1), value })));
  const engine = new FormulaEngine(sheet);
  const history = new History();
  /** 알림으로 받은 "다시 계산된 셀" 기록 */
  const notified: string[][] = [];
  engine.onChange((addresses) => notified.push(addresses.map(toA1).sort()));
  return {
    sheet,
    engine,
    history,
    notified,
    /** 셀에 보이는 글자 */
    show: (a1: string) => formatValue(engine.getValue(at(a1))),
    /** 사용자 편집처럼 Command로 셀 값을 바꾼다. */
    set: (changes: Record<string, string>) =>
      history.execute(
        new SetCellsCommand(
          sheet,
          Object.entries(changes).map(([a1, value]) => ({ address: at(a1), value })),
        ),
      ),
  };
}

describe("계산값", () => {
  test("처음 시트의 수식을 계산한다", () => {
    const { show } = setup({ A1: "1", B1: "2", C1: "=A1+B1", A2: "=SUM(A1:C1)" });

    expect(show("C1")).toBe("3");
    expect(show("A2")).toBe("6");
  });

  test("수식이 아닌 입력은 값으로 읽는다", () => {
    const { engine } = setup({ A1: "12", B1: "사과", C1: "TRUE" });

    expect(engine.getValue(at("A1"))).toBe(12);
    expect(engine.getValue(at("B1"))).toBe("사과");
    expect(engine.getValue(at("C1"))).toBe(true);
    expect(engine.getValue(at("D1"))).toBeNull();
  });

  test("수식이 수식을 참조해도 순서와 상관없이 계산한다", () => {
    // 뒤쪽 셀을 먼저 참조하는 사슬
    const { show } = setup({ A1: "=B1*2", B1: "=C1+1", C1: "=D1+1", D1: "1" });

    expect(show("A1")).toBe("6");
  });

  test("문법이 틀린 수식은 #NAME?으로 둔다", () => {
    const { show } = setup({ A1: "=1+", B1: "=A1" });

    expect(show("A1")).toBe("#NAME?");
    expect(show("B1")).toBe("#NAME?");
  });

  test("시트 밖을 가리키는 참조는 빈 셀로 본다", () => {
    const { show } = setup({ A1: "=Z99+1", B1: "=SUM(A5:Z100)" });

    expect(show("A1")).toBe("1");
    expect(show("B1")).toBe("0");
  });
});

describe("다시 계산", () => {
  test("참조한 셀을 바꾸면 수식 결과가 바뀐다", () => {
    const { set, show } = setup({ A1: "1", B1: "2", C1: "=A1+B1" });

    set({ A1: "10" });

    expect(show("C1")).toBe("12");
  });

  test("범위 안의 셀을 바꾸면 범위 수식이 바뀐다", () => {
    const { set, show } = setup({ A1: "1", A2: "2", A10: "=SUM(A1:A9)" });

    set({ A5: "100" });

    expect(show("A10")).toBe("103");
  });

  test("바뀐 셀에 이어진 수식만 다시 계산한다", () => {
    const { set, notified } = setup({
      A1: "1",
      B1: "=A1+1",
      C1: "=B1+1",
      A2: "5",
      B2: "=A2*2",
      D1: "=SUM(A1:A1)",
      D2: "=SUM(A2:A3)",
    });

    set({ A1: "2" });

    expect(notified).toEqual([["A1", "B1", "C1", "D1"]]);
  });

  test("수식을 고치면 예전 참조는 끊고 새 참조를 따른다", () => {
    const { set, show, notified } = setup({ A1: "1", B1: "2", C1: "=A1" });

    set({ C1: "=B1" });
    notified.length = 0;
    set({ A1: "100" });

    expect(show("C1")).toBe("2");
    expect(notified).toEqual([["A1"]]);
  });

  test("수식을 지우면 그 셀은 빈 셀이 되고, 참조하던 수식은 0을 받는다", () => {
    const { set, show, engine } = setup({ A1: "=1+1", B1: "=A1" });

    set({ A1: "" });

    expect(engine.getValue(at("A1"))).toBeNull();
    expect(show("B1")).toBe("0");
  });

  test("여러 셀을 한 번에 바꿔도 한 번만 알린다", () => {
    const { set, show, notified } = setup({ C1: "=A1+B1" });

    set({ A1: "1", B1: "2" });

    expect(show("C1")).toBe("3");
    expect(notified).toEqual([["A1", "B1", "C1"]]);
  });

  test("두 갈래로 이어진 수식도 참조되는 쪽이 모두 끝난 뒤 계산한다", () => {
    // A1 → B1, C1 → D1(B1+C1)
    const { set, show } = setup({ A1: "1", B1: "=A1*10", C1: "=A1*100", D1: "=B1+C1" });

    set({ A1: "2" });

    expect(show("D1")).toBe("220");
  });

  test("undo/redo로 값이 돌아가면 수식도 다시 계산한다", () => {
    const { set, show, history } = setup({ A1: "1", B1: "=A1*2" });

    set({ A1: "5" });
    expect(show("B1")).toBe("10");
    history.undo();
    expect(show("B1")).toBe("2");
    history.redo();
    expect(show("B1")).toBe("10");
  });

  test("처음 읽을 때 범위로 이어진 수식도 참조되는 쪽부터 계산한다", () => {
    const { show } = setup({ A1: "=SUM(B1:B3)", B2: "=C1*2", C1: "5" });

    expect(show("A1")).toBe("10");
  });

  test("같은 셀을 셀과 범위로 여러 번 참조해도 한 번만 다시 계산한다", () => {
    const { set, show, notified } = setup({ A1: "1", B1: "=A1+SUM(A1:A2)+SUM(A1:A1)" });

    set({ A1: "2" });

    expect(show("B1")).toBe("6");
    expect(notified).toEqual([["A1", "B1"]]);
  });

  test("수식과 값을 함께 바꾸면 값에 이어진 수식도 다시 계산한다", () => {
    const { set, show } = setup({ A1: "1", B1: "=A1*2", C1: "=B1+1" });

    set({ A1: "3", C1: "=B1+2" });

    expect(show("B1")).toBe("6");
    expect(show("C1")).toBe("8");
  });

  test("모든 수식을 값과 함께 바꿔도 참조되는 쪽부터 계산한다", () => {
    const { set, show } = setup({ A1: "1", B1: "=A1*2", C1: "=B1+1" });

    set({ C1: "=B1+1", B1: "=A1*3", A1: "3" });

    expect(show("C1")).toBe("10");
  });

  test("1만 개가 이어진 수식도 스택이 넘치지 않고 계산한다", () => {
    const sheet = new Sheet({ rowCount: 10_000, colCount: 1 });
    sheet.setCells(
      Array.from({ length: 10_000 }, (_, row) => ({ address: { row, col: 0 }, value: row === 0 ? "1" : `=A${row}+1` })),
    );
    const engine = new FormulaEngine(sheet);

    expect(engine.getValue(at("A10000"))).toBe(10_000);
    new SetCellsCommand(sheet, [{ address: at("A1"), value: "=A10000" }]).execute();
    expect(engine.getValue(at("A10000"))).toEqual(new FormulaError("#CYCLE!"));
  });
});

describe("순환 참조", () => {
  test("자기 자신을 참조하면 #CYCLE!", () => {
    const { show } = setup({ A1: "=A1+1", B1: "=SUM(B1:B3)" });

    expect(show("A1")).toBe("#CYCLE!");
    expect(show("B1")).toBe("#CYCLE!");
  });

  test("서로를 참조하면 순환에 든 셀이 모두 #CYCLE!", () => {
    const { set, show } = setup({ A1: "=B1", B1: "=C1" });

    set({ C1: "=A1" });

    expect([show("A1"), show("B1"), show("C1")]).toEqual(["#CYCLE!", "#CYCLE!", "#CYCLE!"]);
  });

  test("순환을 참조만 하는 셀은 그 에러를 받아 계산한다", () => {
    const { show } = setup({ A1: "=B1", B1: "=A1", C1: "=A1+1", D1: "=COUNT(A1:C1)", E1: "=D1+1" });

    expect(show("C1")).toBe("#CYCLE!");
    // COUNT는 에러를 세지 않고 전파하지도 않는다.
    expect(show("D1")).toBe("0");
    expect(show("E1")).toBe("1");
  });

  test("순환을 끊으면 다시 제대로 계산한다", () => {
    const { set, show } = setup({ A1: "=B1+1", B1: "=A1+1", C1: "=A1" });

    set({ B1: "5" });

    expect(show("A1")).toBe("6");
    expect(show("C1")).toBe("6");
  });

  test("순환을 만든 편집을 undo하면 원래 값으로 돌아간다", () => {
    const { set, show, history } = setup({ A1: "1", B1: "=A1" });

    set({ A1: "=B1" });
    expect(show("B1")).toBe("#CYCLE!");
    history.undo();

    expect(show("A1")).toBe("1");
    expect(show("B1")).toBe("1");
  });
});

test("destroy하면 시트 변경을 더는 반영하지 않는다", () => {
  const { sheet, engine, show } = setup({ A1: "1", B1: "=A1" });

  engine.destroy();
  new SetCellsCommand(sheet, [{ address: at("A1"), value: "2" }]).execute();

  expect(show("B1")).toBe("1");
});

// 성능 목표(README)는 `pnpm bench`로 잰다. 여기서는 결과가 맞는지와, 크게 느려지지 않았는지만 넉넉한 기준(목표의 약 10배)으로 본다.
describe("대용량 (10만 행)", () => {
  function timed<T>(run: () => T): { result: T; ms: number } {
    const start = performance.now();
    const result = run();
    return { result, ms: performance.now() - start };
  }

  test("연결된 셀 1만 개를 다시 계산한다", () => {
    const sheet = chainSheet(10_000);
    const engine = new FormulaEngine(sheet);

    const { ms } = timed(() => new SetCellsCommand(sheet, [{ address: at("A1"), value: "101" }]).execute());

    expect(engine.getValue(at("A10000"))).toBe(10_100);
    expect(ms).toBeLessThan(500);
  });

  test("큰 SUM이 있는 시트에서 셀 하나를 고치면 SUM이 바로 바뀐다", () => {
    const sheet = bigSumSheet();
    const engine = new FormulaEngine(sheet);
    const before = engine.getValue(at("B1")) as number;

    const { ms } = timed(() => new SetCellsCommand(sheet, [{ address: at("A501"), value: "1000" }]).execute());

    // A501에는 원래 500 % 100 = 0이 있었다.
    expect(engine.getValue(at("B1"))).toBe(before + 1000);
    expect(ms).toBeLessThan(160);
  });

  test("행마다 범위 수식이 있는 10만 행 시트를 열고 고칠 수 있다", () => {
    const sheet = scoreSheet();
    const { result: engine, ms: openMs } = timed(() => new FormulaEngine(sheet));
    const show = (a1: string) => formatValue(engine.getValue(at(a1)));

    // 10만째 행(학생 99999): 40 + (i*37 % 61) 등
    expect(show("G100000")).toBe(String(40 + ((99_999 * 37) % 61) + 40 + ((99_999 * 53) % 61) + 40 + ((99_999 * 71) % 61)));
    const total = engine.getValue(at("K1")) as number;
    expect(openMs).toBeLessThan(15_000);

    const { ms } = timed(() => new SetCellsCommand(sheet, [{ address: at("D501"), value: "0" }]).execute());

    const old = 40 + ((500 * 37) % 61);
    expect(engine.getValue(at("K1"))).toBe(total - old);
    expect(show("H501")).toBe(formatValue((0 + 40 + ((500 * 53) % 61) + 40 + ((500 * 71) % 61)) / 3));
    expect(ms).toBeLessThan(160);
  }, 30_000);
});
