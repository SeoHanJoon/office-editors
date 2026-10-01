import { describe, expect, test } from "vitest";
import { parseA1 } from "./address";
import { AutoRowHeights, inputLineCount, type AutoRowSource } from "./auto-row-heights";
import { FormulaEngine } from "./formula-engine";
import { SetCellsCommand } from "./set-cells-command";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

/** 한 줄이면 20px, 줄마다 16px (ADR 0031) */
const lines = (count: number) => (count === 1 ? 20 : count * 16 + 4);

/** 열 너비 88px(글자 영역 80px), 글자당 10px로 재는 화면 */
function autoRows(sheet: Sheet, colWidth = 88): AutoRowHeights {
  const engine = new FormulaEngine(sheet);
  const source: AutoRowSource = {
    value: (address) => engine.getValue(address),
    colWidth: () => colWidth,
    measure: (text) => text.length * 10,
  };
  return new AutoRowHeights(sheet, source, 20);
}

describe("입력한 글자의 줄 수", () => {
  test("줄바꿈 수 + 1이다. \\r\\n은 한 번으로 센다", () => {
    expect(inputLineCount("")).toBe(1);
    expect(inputLineCount("한 줄")).toBe(1);
    expect(inputLineCount("가\n나\n다")).toBe(3);
    expect(inputLineCount("가\r\n나\r다")).toBe(3);
    expect(inputLineCount("끝에 줄바꿈\n")).toBe(2);
  });

  test("수식은 결과에 줄바꿈이 있어도 한 줄이다", () => {
    expect(inputLineCount('="가"&CHAR(10)&"나"')).toBe(1);
  });
});

describe("행마다 자동 높이: 입력한 줄바꿈", () => {
  test("처음 시트에서 줄바꿈이 든 셀의 행만 센다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3, data: [["a", "b\nc"], ["x"], ["1\n2\n3", "4\n5"]] });
    const auto = autoRows(sheet);

    expect([auto.height(0), auto.height(1), auto.height(2), auto.height(3)]).toEqual([lines(2), 20, lines(3), 20]);
    expect(new Map(auto.entries())).toEqual(new Map([[0, lines(2)], [2, lines(3)]]));
  });

  test("셀이 바뀌면 그 행만 다시 세고, 바뀐 행이 있을 때만 true다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3, data: [["a\nb", "c\nd\ne"]] });
    const auto = autoRows(sheet);

    // 가장 긴 셀(3줄)을 지우면 남은 셀(2줄)에 맞춰 준다.
    sheet.setCells([{ address: at("B1"), value: "" }]);
    expect(auto.update([at("B1")])).toBe(true);
    expect(auto.height(0)).toBe(lines(2));

    // 줄바꿈 없는 셀을 고치면 아무것도 바뀌지 않는다.
    sheet.setCells([{ address: at("C3"), value: "그냥 글자" }]);
    expect(auto.update([at("C3")])).toBe(false);

    sheet.setCells([{ address: at("A1"), value: "한 줄" }]);
    expect(auto.update([at("A1")])).toBe(true);
    expect(auto.height(0)).toBe(20);
    expect([...auto.entries()]).toEqual([]);
  });

  test("undo로 되돌아온 줄바꿈도 다시 센다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3 });
    const auto = autoRows(sheet);
    sheet.onChange((addresses) => auto.update(addresses));
    const command = new SetCellsCommand(sheet, [{ address: at("B4"), value: "1\n2\n3\n4" }]);

    command.execute();
    expect(auto.height(3)).toBe(lines(4));
    command.undo();
    expect(auto.height(3)).toBe(20);
  });

  test("행을 넣고 지운 뒤 다시 훑으면 옮겨진 행을 센다", () => {
    const sheet = new Sheet({ rowCount: 5, colCount: 3, data: [[], ["a\nb"]] });
    const auto = autoRows(sheet);

    sheet.changeStructure({ kind: "insert", axis: "row", index: 0, count: 2 });
    auto.rebuild();

    expect([...auto.entries()]).toEqual([[3, lines(2)]]);
  });
});

describe("행마다 자동 높이: 서식", () => {
  test("자동 줄바꿈 셀은 열 너비에 맞춰 나눈 줄 수다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2, data: [["가나다라 마바사아 자차"]] });
    sheet.setFormats({ cells: [{ address: at("A1"), format: { wrap: true } }] });

    expect(autoRows(sheet).height(0)).toBe(lines(2));
    // 열이 좁으면 줄이 늘어난다. (글자 영역 40px: "가나다라" / "마바사아" / "자차")
    expect(autoRows(sheet, 48).height(0)).toBe(lines(3));
  });

  test("자동 줄바꿈 셀은 수식 결과로 나누고, 숫자는 나누지 않는다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2, data: [['="가나다라마"&" 바사아자차"', "123456789012345"]] });
    sheet.setFormats({ cols: [{ index: 0, format: { wrap: true } }, { index: 1, format: { wrap: true } }] });
    const auto = autoRows(sheet);

    expect(auto.height(0)).toBe(lines(2));
  });

  test("자동 줄바꿈 셀은 계산값이 바뀌면 updateValues로 다시 잰다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2, data: [["=B1", "짧다"]] });
    sheet.setFormats({ cells: [{ address: at("A1"), format: { wrap: true } }] });
    const auto = autoRows(sheet);
    expect(auto.height(0)).toBe(20);

    sheet.setCells([{ address: at("B1"), value: "아주 긴 글자 여러 줄로" }]);
    // A1 자체는 바뀌지 않았지만 계산값이 바뀌었다.
    expect(auto.update([at("B1")])).toBe(false);
    expect(auto.updateValues([at("A1"), at("B1")])).toBe(true);
    // 글자 영역 80px: "아주 긴 글자" / "여러 줄로"
    expect(auto.height(0)).toBe(lines(2));
  });

  test("글자가 크면 한 줄이어도 행이 높아지고, 빈 셀은 높이지 않는다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2, data: [["큰 글자"]] });
    sheet.setFormats({ cells: [{ address: at("A1"), format: { fontSize: 20 } }, { address: at("A2"), format: { fontSize: 20 } }] });
    const auto = autoRows(sheet);

    // 20pt = 26.7px, 줄 높이 32px + 위아래 여백 4px
    expect(auto.height(0)).toBe(36);
    expect(auto.height(1)).toBe(20);
  });

  test("행·열 서식으로 준 자동 줄바꿈도 처음에 센다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2, data: [["", "가나다라 마바사아"], ["가나다라 마바사아"]] });
    sheet.setFormats({ rows: [{ index: 0, format: { wrap: true } }], cols: [{ index: 0, format: { wrap: true } }] });

    expect(new Map(autoRows(sheet).entries())).toEqual(new Map([[0, lines(2)], [1, lines(2)]]));
  });

  test("서식이 없는 시트는 계산값 변경을 보지 않는다", () => {
    const sheet = new Sheet({ rowCount: 3, colCount: 2, data: [["a\nb"]] });
    const auto = autoRows(sheet);

    expect(auto.updateValues([at("A1")])).toBe(false);
  });
});
