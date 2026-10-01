import { History } from "@office/command-core";
import { describe, expect, test } from "vitest";
import { parseA1, toA1, type CellRange } from "./address";
import { autoFillEnd, clearChanges, copyFillChanges, fillChanges, fillDrag, fillEntryChanges, lineSeries } from "./fill";
import type { Direction } from "./selection";
import { SetCellsCommand } from "./set-cells-command";
import { Sheet } from "./sheet";

const at = (a1: string) => parseA1(a1)!;

function range(a1: string): CellRange {
  const [start, end = start] = a1.split(":");
  const from = at(start!);
  const to = at(end!);
  return { top: from.row, left: from.col, bottom: to.row, right: to.col };
}

function createSheet(cells: Record<string, string>, rowCount = 20): Sheet {
  const sheet = new Sheet({ rowCount, colCount: 6 });
  sheet.setCells(Object.entries(cells).map(([a1, value]) => ({ address: at(a1), value })));
  return sheet;
}

/** 변경을 { "A1": "값" } 모양으로 */
function asRecord(changes: readonly { address: { row: number; col: number }; value: string }[]): Record<string, string> {
  return Object.fromEntries(changes.map(({ address, value }) => [toA1(address), value]));
}

/** 한 줄(texts)을 앞으로 count칸 이어간 값. 수식은 원래 칸 번호를 "#n"으로 */
function next(texts: readonly string[], count: number): string[] {
  const series = lineSeries(texts);
  return Array.from({ length: count }, (_, step) => {
    const { from, value } = series(texts.length + step);
    return value ?? `#${from}`;
  });
}

/** 한 줄을 뒤로(위·왼쪽) count칸 이어간 값. 원래 칸에 가까운 것부터 */
function previous(texts: readonly string[], count: number): string[] {
  const series = lineSeries(texts);
  return Array.from({ length: count }, (_, step) => series(-1 - step).value ?? "");
}

describe("이어가는 규칙 (ADR 0033)", () => {
  test("숫자 한 칸만 있으면 복사한다", () => {
    expect(next(["5"], 3)).toEqual(["5", "5", "5"]);
  });

  test("숫자 두 칸 이상은 같은 간격으로 이어간다", () => {
    expect(next(["1", "3"], 3)).toEqual(["5", "7", "9"]);
    expect(next(["10", "8", "6"], 2)).toEqual(["4", "2"]);
    expect(next(["0.1", "0.2"], 2)).toEqual(["0.3", "0.4"]);
  });

  test("간격이 들쭉날쭉하면 가장 잘 맞는 직선을 따른다 (Excel과 같음)", () => {
    expect(next(["1", "2", "4"], 2)).toEqual(["5.33333333333333", "6.83333333333333"]);
  });

  test("같은 숫자 두 칸은 그대로 이어진다", () => {
    expect(next(["7", "7"], 2)).toEqual(["7", "7"]);
  });

  test("끝에 숫자가 붙은 글자는 숫자만 1씩 늘린다", () => {
    expect(next(["항목1"], 3)).toEqual(["항목2", "항목3", "항목4"]);
    expect(next(["Item 9"], 2)).toEqual(["Item 10", "Item 11"]);
  });

  test("글자+숫자 두 칸은 그 간격을 따른다", () => {
    expect(next(["항목1", "항목3"], 2)).toEqual(["항목5", "항목7"]);
  });

  test("숫자의 자릿수를 지킨다", () => {
    expect(next(["A007"], 2)).toEqual(["A008", "A009"]);
    expect(next(["A099"], 1)).toEqual(["A100"]);
  });

  test("숫자 부분은 끝에 붙은 숫자 전체다", () => {
    expect(next(["a1b22"], 1)).toEqual(["a1b23"]);
  });

  test("16자리 이상 숫자가 붙은 글자는 복사한다", () => {
    expect(next(["x1234567890123456"], 1)).toEqual(["x1234567890123456"]);
  });

  test("요일과 월은 목록 순서대로 돈다", () => {
    expect(next(["금"], 3)).toEqual(["토", "일", "월"]);
    expect(next(["토요일"], 2)).toEqual(["일요일", "월요일"]);
    expect(next(["11월"], 3)).toEqual(["12월", "1월", "2월"]);
    expect(next(["Sat"], 2)).toEqual(["Sun", "Mon"]);
    expect(next(["December"], 1)).toEqual(["January"]);
  });

  test("목록 두 칸은 그 간격을 따르고, 끝을 넘어가는 간격도 안다", () => {
    expect(next(["Jan", "Apr"], 3)).toEqual(["Jul", "Oct", "Jan"]);
    expect(next(["토", "일"], 2)).toEqual(["월", "화"]);
    expect(next(["화", "월"], 2)).toEqual(["일", "토"]);
  });

  test("영어 목록은 대소문자 모양을 따른다", () => {
    expect(next(["mon"], 1)).toEqual(["tue"]);
    expect(next(["MON"], 1)).toEqual(["TUE"]);
    expect(next(["Mon"], 1)).toEqual(["Tue"]);
  });

  test("짧은 목록과 긴 목록에 다 있는 글자는 짧은 목록을 쓴다", () => {
    expect(next(["May"], 1)).toEqual(["Jun"]);
  });

  test("숫자도 목록도 아닌 글자는 복사한다", () => {
    expect(next(["안녕"], 2)).toEqual(["안녕", "안녕"]);
    expect(next(["TRUE"], 1)).toEqual(["TRUE"]);
  });

  test("빈 칸은 빈 칸으로 되풀이한다", () => {
    expect(next(["1", ""], 4)).toEqual(["2", "", "3", ""]);
  });

  test("종류가 섞이면 묶음마다 따로 이어가고 순서를 되풀이한다 (Microsoft 문서 예)", () => {
    expect(next(["text1", "textA"], 4)).toEqual(["text2", "textA", "text3", "textA"]);
  });

  test("숫자 묶음과 글자가 섞이면 숫자 묶음이 제 간격으로 이어진다", () => {
    expect(next(["1", "2", "x"], 6)).toEqual(["3", "4", "x", "5", "6", "x"]);
  });

  test("앞부분이 다른 글자+숫자는 다른 묶음이다", () => {
    expect(next(["a1", "b1"], 4)).toEqual(["a2", "b2", "a3", "b3"]);
  });

  test("수식 칸은 원래 칸을 옮겨 쓰도록 알린다", () => {
    expect(next(["=A1", "1"], 4)).toEqual(["#0", "2", "#0", "3"]);
  });

  test("뒤로 이어가면 같은 직선을 거꾸로 따라간다", () => {
    expect(previous(["5", "7"], 3)).toEqual(["3", "1", "-1"]);
    expect(previous(["화"], 3)).toEqual(["월", "일", "토"]);
    expect(previous(["항목2"], 2)).toEqual(["항목1", "항목0"]);
  });

  test("뒤로 가다 글자의 숫자가 0 아래로 가면 빼기표 없이 쓴다", () => {
    expect(previous(["항목1"], 3)).toEqual(["항목0", "항목1", "항목2"]);
  });
});

describe("채우기 변경", () => {
  test("아래로 채우면 열마다 따로 이어간다", () => {
    const sheet = createSheet({ A1: "1", A2: "2", B1: "월", B2: "x" });
    expect(asRecord(fillChanges(sheet, range("A1:B2"), "down", 2))).toEqual({
      A3: "3",
      A4: "4",
      B3: "화",
      B4: "x",
    });
  });

  test("오른쪽으로 채우면 행마다 따로 이어간다", () => {
    const sheet = createSheet({ A1: "1월", A2: "Q1" });
    expect(asRecord(fillChanges(sheet, range("A1:A2"), "right", 2))).toEqual({
      B1: "2월",
      C1: "3월",
      B2: "Q2",
      C2: "Q3",
    });
  });

  test("위·왼쪽으로 채우면 값이 거꾸로 줄어든다", () => {
    const sheet = createSheet({ C5: "10", C6: "20" });
    expect(asRecord(fillChanges(sheet, range("C5:C6"), "up", 2))).toEqual({ C4: "0", C3: "-10" });
    expect(asRecord(fillChanges(sheet, range("C5:C5"), "left", 2))).toEqual({ B5: "10", A5: "10" });
  });

  test("수식은 옮긴 만큼 `$`가 없는 참조만 따라간다", () => {
    const sheet = createSheet({ B2: "=A2+$A$1", C2: "=sum(a$1:a2)" });
    expect(asRecord(fillChanges(sheet, range("B2:C2"), "down", 2))).toEqual({
      B3: "=A3+$A$1",
      B4: "=A4+$A$1",
      C3: "=sum(A$1:A3)",
      C4: "=sum(A$1:A4)",
    });
  });

  test("수식을 위로 채우다 시트 밖으로 나가면 #REF!가 된다", () => {
    const sheet = createSheet({ A2: "=A1" });
    expect(asRecord(fillChanges(sheet, range("A2"), "up", 1))).toEqual({ A1: "=#REF!" });
  });

  test("여러 칸 패턴 안의 수식은 그 칸에서 떨어진 만큼 옮긴다", () => {
    const sheet = createSheet({ B1: "=A1", B2: "합" });
    expect(asRecord(fillChanges(sheet, range("B1:B2"), "down", 2))).toEqual({ B3: "=A3", B4: "합" });
  });

  test("채운 것은 undo 한 번에 되돌아간다", () => {
    const sheet = createSheet({ A1: "1", A2: "2" });
    const history = new History();
    history.execute(new SetCellsCommand(sheet, fillChanges(sheet, range("A1:A2"), "down", 3)));
    expect(sheet.get(at("A5"))).toBe("5");
    history.undo();
    expect(["A3", "A4", "A5"].map((a1) => sheet.get(at(a1)))).toEqual(["", "", ""]);
  });

  test("줄이면 값이 있는 칸만 지운다", () => {
    const sheet = createSheet({ A1: "1", A2: "", A3: "3", B3: "x" });
    expect(asRecord(clearChanges(sheet, range("A2:B3")))).toEqual({ A3: "", B3: "" });
  });
});

describe("핸들을 끈 곳 → 할 일", () => {
  const source = range("B2:C3");
  const drag = (a1: string) => fillDrag(source, at(a1));

  test.each<[string, Direction, number, string]>([
    ["B6", "down", 3, "B2:C6"],
    ["C1", "up", 1, "B1:C3"],
    ["F3", "right", 3, "B2:F3"],
    ["A2", "left", 1, "A2:C3"],
  ])("%s까지 끌면 %s로 %i칸", (cell, direction, count, target) => {
    expect(drag(cell)).toEqual({ kind: "fill", direction, count, range: range(target) });
  });

  test("대각선으로 끌면 더 멀리 나간 방향 하나로만 채운다", () => {
    expect(drag("D8")).toMatchObject({ direction: "down", count: 5 });
    expect(drag("F5")).toMatchObject({ direction: "right", count: 3 });
  });

  test("가로·세로가 같으면 세로로 채운다", () => {
    expect(drag("D4")).toMatchObject({ direction: "down", count: 1 });
  });

  test("원래 오른쪽 아래 칸이면 아무것도 하지 않는다", () => {
    expect(drag("C3")).toBeNull();
  });

  test("범위 안으로 끌면 뒤쪽 줄을 지운다", () => {
    expect(drag("C2")).toEqual({ kind: "shrink", range: range("B2:C2"), cleared: range("B3:C3") });
    expect(drag("B3")).toEqual({ kind: "shrink", range: range("B2:B3"), cleared: range("C2:C3") });
    expect(drag("B2")).toEqual({ kind: "shrink", range: range("B2:C2"), cleared: range("B3:C3") });
  });
});

describe("핸들 두 번 클릭: 어디까지 채울지", () => {
  test("왼쪽 열에 값이 이어진 곳까지", () => {
    const sheet = createSheet({ A1: "a", A2: "a", A3: "a", A4: "a", A6: "a", B1: "=A1" });
    expect(autoFillEnd(sheet, range("B1"))).toBe(at("B4").row);
  });

  test("왼쪽 열 바로 아래가 비었으면 오른쪽 열을 본다", () => {
    const sheet = createSheet({ B1: "1", C1: "x", C2: "x", C3: "x" });
    expect(autoFillEnd(sheet, range("B1"))).toBe(at("B3").row);
  });

  test("양옆이 비었으면 채우지 않는다", () => {
    const sheet = createSheet({ B1: "1", A5: "x" });
    expect(autoFillEnd(sheet, range("B1"))).toBeNull();
  });

  test("채울 열에 이미 값이 있으면 그 앞에서 멈춘다", () => {
    const sheet = createSheet({ A1: "a", A2: "a", A3: "a", A4: "a", B1: "1", B4: "keep" });
    expect(autoFillEnd(sheet, range("B1"))).toBe(at("B3").row);
  });

  test("바로 아래 칸에 값이 있으면 채우지 않는다", () => {
    const sheet = createSheet({ A1: "a", A2: "a", B1: "1", B2: "keep" });
    expect(autoFillEnd(sheet, range("B1"))).toBeNull();
  });

  test("여러 열을 골랐으면 범위 바로 바깥 열을 본다", () => {
    const sheet = createSheet({ A1: "a", A2: "a", A3: "a", B1: "1", C1: "2" });
    expect(autoFillEnd(sheet, range("B1:C1"))).toBe(at("B3").row);
  });

  test("시트 끝 행에서는 채우지 않는다", () => {
    const sheet = createSheet({ A3: "a", B3: "1" }, 3);
    expect(autoFillEnd(sheet, range("B3"))).toBeNull();
  });
});

describe("Ctrl+D·Ctrl+R", () => {
  test("Ctrl+D: 여러 행을 골랐으면 첫 행을 아래 칸에 복사한다 (이어가지 않음)", () => {
    const sheet = createSheet({ A1: "1", B1: "=A1" });
    expect(asRecord(copyFillChanges(sheet, range("A1:B3"), "down"))).toEqual({
      A2: "1",
      A3: "1",
      B2: "=A2",
      B3: "=A3",
    });
  });

  test("Ctrl+D: 한 행만 골랐으면 바로 위 행을 복사해 온다", () => {
    const sheet = createSheet({ A1: "항목1", B1: "=A1" });
    expect(asRecord(copyFillChanges(sheet, range("A2:B2"), "down"))).toEqual({ A2: "항목1", B2: "=A2" });
  });

  test("Ctrl+D: 첫 행 하나만 골랐으면 아무것도 하지 않는다", () => {
    expect(copyFillChanges(createSheet({ A1: "1" }), range("A1"), "down")).toEqual([]);
  });

  test("Ctrl+R: 첫 열을 오른쪽 칸에, 한 열이면 왼쪽 열을 복사한다", () => {
    const sheet = createSheet({ A1: "x", A2: "=A1" });
    expect(asRecord(copyFillChanges(sheet, range("A1:C2"), "right"))).toEqual({
      B1: "x",
      C1: "x",
      B2: "=B1",
      C2: "=C1",
    });
    expect(asRecord(copyFillChanges(sheet, range("B1"), "right"))).toEqual({ B1: "x" });
    expect(copyFillChanges(sheet, range("A1:A2"), "right")).toEqual([]);
  });
});

describe("Ctrl+Enter", () => {
  test("입력한 값을 범위의 모든 칸에 넣는다", () => {
    expect(asRecord(fillEntryChanges("안녕", at("A1"), range("A1:B2")))).toEqual({
      A1: "안녕",
      B1: "안녕",
      A2: "안녕",
      B2: "안녕",
    });
  });

  test("수식은 활성 셀에서 떨어진 만큼 `$`가 없는 참조만 옮긴다", () => {
    expect(asRecord(fillEntryChanges("=A1*$C$1", at("B2"), range("B1:B3")))).toEqual({
      B1: "=#REF!*$C$1",
      B2: "=A1*$C$1",
      B3: "=A2*$C$1",
    });
  });
});
