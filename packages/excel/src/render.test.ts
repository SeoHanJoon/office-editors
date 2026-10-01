import { describe, expect, test } from "vitest";
import { parseA1 } from "./address";
import { gridGeometry, uniformGeometry, type GridLayout, type Viewport } from "./layout";
import { FormulaEngine } from "./formula-engine";
import { THEME, autoRowHeight, drawGrid } from "./render";
import { selectCell, selectRange } from "./selection";
import { Sheet } from "./sheet";

interface DrawnText {
  text: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
}

/** 글자를 그린 기록만 남기고 나머지 그리기 호출은 무시하는 가짜 Canvas */
function recordingContext(): { ctx: CanvasRenderingContext2D; texts: DrawnText[] } {
  const texts: DrawnText[] = [];
  const state: Record<string | symbol, unknown> = { textAlign: "start" };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === "fillText") {
        return (text: string, x: number, y: number) =>
          texts.push({ text, x, y, align: target.textAlign as CanvasTextAlign });
      }
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const layout: GridLayout = { rowHeight: 10, colWidth: 20, headerHeight: 10, headerWidth: 30 };
// 셀 영역 100×50 → 5열 × 5행
const viewport = (scrollLeft = 0, scrollTop = 0): Viewport => ({ scrollLeft, scrollTop, width: 130, height: 60 });

function cellTexts(sheet: Sheet, view: Viewport) {
  const { ctx, texts } = recordingContext();
  drawGrid(ctx, { sheet, engine: new FormulaEngine(sheet), selection: selectCell(parseA1("A1")!), geometry: uniformGeometry(layout, sheet), viewport: view });
  // 머리글 글자는 빼고 셀 영역 글자만 본다.
  return texts.filter((t) => t.x > layout.headerWidth && t.y > layout.headerHeight);
}

describe("셀 글자 그리기", () => {
  test("화면에 보이는 셀의 글자만 그린다", () => {
    const data = Array.from({ length: 100 }, (_, row) => Array.from({ length: 10 }, (_, col) => `${row}-${col}`));
    const sheet = new Sheet({ rowCount: 100, colCount: 10, data });

    const texts = cellTexts(sheet, viewport(40, 100));

    expect(texts).toHaveLength(25);
    expect(texts.map((t) => t.text)).toContain("10-2");
    expect(texts.map((t) => t.text)).toContain("14-6");
    expect(texts.map((t) => t.text)).not.toContain("9-2");
  });

  test("빈 셀은 그리지 않는다", () => {
    const sheet = new Sheet({ rowCount: 100, colCount: 10, data: [["a", "", "b"]] });

    expect(cellTexts(sheet, viewport()).map((t) => t.text)).toEqual(["a", "b"]);
  });

  test("숫자는 오른쪽, 글자는 왼쪽, 논리값과 에러는 가운데에 그린다", () => {
    const sheet = new Sheet({ rowCount: 10, colCount: 10, data: [["이름", "12", "true", "=1/0"]] });

    const [name, score, flag, error] = cellTexts(sheet, viewport());

    expect(name).toMatchObject({ text: "이름", align: "left", x: 30 + 4 });
    expect(score).toMatchObject({ text: "12", align: "right", x: 30 + 20 + 20 - 4 });
    expect(flag).toMatchObject({ text: "TRUE", align: "center", x: 30 + 40 + 10 });
    expect(error).toMatchObject({ text: "#DIV/0!", align: "center", x: 30 + 60 + 10 });
  });

  test("수식 셀은 입력한 글자 대신 계산값을 그린다", () => {
    const sheet = new Sheet({ rowCount: 10, colCount: 10, data: [["1", "2", "=A1+B1", "=SUM(A1:B1)&\"개\""]] });

    expect(cellTexts(sheet, viewport()).map((t) => t.text)).toEqual(["1", "2", "3", "3개"]);
  });

  test("작은따옴표로 시작한 숫자는 글자로 왼쪽에 그린다", () => {
    const sheet = new Sheet({ rowCount: 10, colCount: 10, data: [["'007"]] });

    expect(cellTexts(sheet, viewport())[0]).toMatchObject({ text: "007", align: "left" });
  });

  test("머리글에 보이는 열 이름과 행 번호를 그린다", () => {
    const { ctx, texts } = recordingContext();
    const sheet = new Sheet({ rowCount: 100, colCount: 10 });

    drawGrid(ctx, { sheet, engine: new FormulaEngine(sheet), selection: selectCell(parseA1("A1")!), geometry: uniformGeometry(layout, sheet), viewport: viewport(40, 100) });

    const headers = texts.filter((t) => t.align === "center").map((t) => t.text);
    expect(headers).toEqual(["C", "D", "E", "F", "G", "11", "12", "13", "14", "15"]);
  });
});

describe("셀 안 줄바꿈 그리기", () => {
  // 기본 크기(행 20px)에 가까운 배치: 머리글 20, 행 20, 열 64
  const tall: GridLayout = { rowHeight: 20, colWidth: 64, headerHeight: 20, headerWidth: 46 };
  const view: Viewport = { scrollLeft: 0, scrollTop: 0, width: 600, height: 400 };

  function draw(sheet: Sheet, rowSizes: [number, number][] = []) {
    const { ctx, texts } = recordingContext();
    const geometry = gridGeometry(tall, sheet, rowSizes, []);
    drawGrid(ctx, { sheet, engine: new FormulaEngine(sheet), selection: selectCell(parseA1("Z1")!), geometry, viewport: view });
    return texts.filter((t) => t.x > tall.headerWidth && t.y > tall.headerHeight);
  }

  test("한 줄 글자는 기본 높이 행의 가운데에 온다", () => {
    const [text] = draw(new Sheet({ rowCount: 5, colCount: 3, data: [["가"]] }));

    expect(text).toMatchObject({ text: "가", y: 20 + 10 });
  });

  test("입력한 줄바꿈으로 나눠 그리고, 마지막 줄을 셀 아래쪽에 붙인다", () => {
    // 1행 높이 52 = 3줄(48) + 위아래 여백(4)
    const texts = draw(new Sheet({ rowCount: 5, colCount: 3, data: [["가\n나다\n라"]] }), [[0, autoRowHeight(3, 20)]]);

    expect(texts.map((t) => [t.text, t.y])).toEqual([
      ["가", 20 + 52 - 2 - 8 - 32],
      ["나다", 20 + 52 - 2 - 8 - 16],
      ["라", 20 + 52 - 2 - 8],
    ]);
  });

  test("높은 행의 한 줄 글자도 아래쪽에 붙인다 (Excel 기본 세로 정렬)", () => {
    const [text] = draw(new Sheet({ rowCount: 5, colCount: 3, data: [["가"]] }), [[0, 60]]);

    expect(text!.y).toBe(20 + 60 - 2 - 8);
  });

  test("수식 결과의 줄바꿈은 나누지 않고 한 줄로 그린다", () => {
    const texts = draw(new Sheet({ rowCount: 5, colCount: 3, data: [["가\n나", "=A1"]] }), [[0, 36]]);

    expect(texts.map((t) => t.text)).toEqual(["가", "나", "가\n나"]);
  });
});

describe("채우기 핸들 그리기", () => {
  interface DrawnRect {
    kind: "fill" | "stroke";
    style: string;
    dashed: boolean;
    rect: [number, number, number, number];
  }

  /** 사각형을 그린 기록만 남기는 가짜 Canvas */
  function rectContext(): { ctx: CanvasRenderingContext2D; rects: DrawnRect[] } {
    const rects: DrawnRect[] = [];
    let dash: number[] = [];
    const state: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop === "setLineDash") return (value: number[]) => (dash = value);
        if (prop === "fillRect" || prop === "strokeRect") {
          const kind = prop === "fillRect" ? "fill" : "stroke";
          return (...rect: [number, number, number, number]) =>
            rects.push({ kind, style: String(target[kind === "fill" ? "fillStyle" : "strokeStyle"]), dashed: dash.length > 0, rect });
        }
        if (prop in target) return target[prop];
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
  }

  const sheet = new Sheet({ rowCount: 10, colCount: 5 });
  // B2:C3 → 셀 영역 x 50~90, y 20~40
  const selection = selectRange({ top: 1, left: 1, bottom: 2, right: 2 });

  function draw(options: { fillHandle?: boolean; fillPreview?: { top: number; left: number; bottom: number; right: number } }) {
    const { ctx, rects } = rectContext();
    drawGrid(ctx, { sheet, engine: new FormulaEngine(sheet), selection, geometry: uniformGeometry(layout, sheet), viewport: viewport(), ...options });
    return rects;
  }

  test("선택 범위 오른쪽 아래 모서리에 흰 테두리를 두른 초록 네모를 그린다", () => {
    const handle = draw({ fillHandle: true }).filter((r) => r.kind === "fill" && r.rect[0] > layout.headerWidth && r.rect[2] < 10);
    expect(handle).toEqual([
      { kind: "fill", style: THEME.background, dashed: false, rect: [86, 36, 9, 9] },
      { kind: "fill", style: THEME.selectionBorder, dashed: false, rect: [87, 37, 7, 7] },
    ]);
  });

  test("핸들을 끄지 않으면 미리보기 테두리가 없고, 끄는 중이면 채울 범위에 회색 점선을 그린다", () => {
    expect(draw({ fillHandle: true }).filter((r) => r.dashed)).toEqual([]);
    const preview = draw({ fillPreview: { top: 1, left: 1, bottom: 4, right: 2 } }).filter((r) => r.dashed);
    expect(preview).toEqual([{ kind: "stroke", style: THEME.fillPreview, dashed: true, rect: [50, 20, 40, 40] }]);
  });
});

test("자동 행 높이는 줄 수 × 16 + 위아래 여백이고, 기본 높이보다 작지 않다", () => {
  expect(autoRowHeight(1, 20)).toBe(20);
  expect(autoRowHeight(3, 20)).toBe(52);
  expect(autoRowHeight(1, 30)).toBe(30);
});
