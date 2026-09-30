import { describe, expect, test } from "vitest";
import { parseA1 } from "./address";
import type { GridLayout, Viewport } from "./layout";
import { drawGrid, looksLikeNumber } from "./render";
import { selectCell } from "./selection";
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
  drawGrid(ctx, { sheet, selection: selectCell(parseA1("A1")!), layout, viewport: view });
  // 머리글 글자는 가운데 정렬이므로 빼고 셀 글자만 본다.
  return texts.filter((t) => t.align !== "center");
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

  test("숫자는 오른쪽, 글자는 왼쪽에 붙여 그린다", () => {
    const sheet = new Sheet({ rowCount: 10, colCount: 10, data: [["이름", "12"]] });

    const [name, score] = cellTexts(sheet, viewport());

    expect(name).toMatchObject({ text: "이름", align: "left", x: 30 + 4 });
    expect(score).toMatchObject({ text: "12", align: "right", x: 30 + 20 + 20 - 4 });
  });

  test("머리글에 보이는 열 이름과 행 번호를 그린다", () => {
    const { ctx, texts } = recordingContext();
    const sheet = new Sheet({ rowCount: 100, colCount: 10 });

    drawGrid(ctx, { sheet, selection: selectCell(parseA1("A1")!), layout, viewport: viewport(40, 100) });

    const headers = texts.filter((t) => t.align === "center").map((t) => t.text);
    expect(headers).toEqual(["C", "D", "E", "F", "G", "11", "12", "13", "14", "15"]);
  });
});

describe("숫자처럼 보이는 입력", () => {
  test("정수, 소수, 부호, 지수 표기는 숫자로 본다", () => {
    for (const input of ["0", "12", "-3", "+4", "1.5", ".5", "5.", "1e3", "2.5E-2"]) {
      expect(looksLikeNumber(input), input).toBe(true);
    }
  });

  test("글자, 빈 칸이 섞인 입력, 수식은 숫자로 보지 않는다", () => {
    for (const input of ["", "abc", "12a", " 12", "1 2", "=1+2", "-", ".", "1e"]) {
      expect(looksLikeNumber(input), input).toBe(false);
    }
  });
});
