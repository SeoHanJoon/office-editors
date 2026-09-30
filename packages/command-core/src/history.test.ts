import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Command } from "./command";
import { History } from "./history";

/** 테스트용 편집 대상: 셀 주소 → 값 */
type Sheet = Map<string, string>;

/** 셀 값을 바꾸는 Command. 에디터가 Command를 만드는 방식과 같다. */
function setCell(sheet: Sheet, addr: string, value: string, mergeKey?: string): Command {
  let prev: string | undefined;
  return {
    mergeKey,
    execute() {
      prev = sheet.get(addr);
      sheet.set(addr, value);
    },
    undo() {
      if (prev === undefined) sheet.delete(addr);
      else sheet.set(addr, prev);
    },
  };
}

/** 문서 끝에 글자 하나를 치는 Command */
function typeChar(doc: { text: string }, char: string): Command {
  return {
    mergeKey: "typing",
    execute() {
      doc.text += char;
    },
    undo() {
      doc.text = doc.text.slice(0, -char.length);
    },
  };
}

/** execute가 항상 실패하는 Command */
function failing(): Command {
  return {
    execute() {
      throw new Error("실패");
    },
    undo() {},
  };
}

describe("undo / redo", () => {
  test("실행하면 편집이 적용된다", () => {
    const sheet: Sheet = new Map();
    const history = new History();

    history.execute(setCell(sheet, "A1", "10"));

    expect(sheet.get("A1")).toBe("10");
  });

  test("undo하면 편집 전 상태로 돌아간다", () => {
    const sheet: Sheet = new Map([["A1", "10"]]);
    const history = new History();
    history.execute(setCell(sheet, "A1", "20"));

    expect(history.undo()).toBe(true);

    expect(sheet.get("A1")).toBe("10");
  });

  test("redo하면 되돌린 편집을 다시 적용한다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "10"));
    history.undo();

    expect(history.redo()).toBe(true);

    expect(sheet.get("A1")).toBe("10");
  });

  test("여러 편집을 undo·redo하면 한 단계씩 순서대로 오간다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "10"));
    history.execute(setCell(sheet, "A1", "20"));
    history.execute(setCell(sheet, "B1", "x"));

    history.undo();
    expect(Object.fromEntries(sheet)).toEqual({ A1: "20" });
    history.undo();
    expect(Object.fromEntries(sheet)).toEqual({ A1: "10" });
    history.undo();
    expect(Object.fromEntries(sheet)).toEqual({});
    history.redo();
    expect(Object.fromEntries(sheet)).toEqual({ A1: "10" });
    history.redo();
    history.redo();
    expect(Object.fromEntries(sheet)).toEqual({ A1: "20", B1: "x" });
  });

  test("되돌릴 편집이 없으면 undo는 아무것도 하지 않고 false를 돌려준다", () => {
    const history = new History();

    expect(history.undo()).toBe(false);
  });

  test("다시 할 편집이 없으면 redo는 아무것도 하지 않고 false를 돌려준다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "10"));

    expect(history.redo()).toBe(false);
    expect(sheet.get("A1")).toBe("10");
  });

  test("canUndo와 canRedo는 되돌릴 편집과 다시 할 편집이 있는지 알려준다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);

    history.execute(setCell(sheet, "A1", "10"));
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);

    history.undo();
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);
  });

  test("undo 뒤에 새 편집을 하면 redo 기록은 사라진다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "10"));
    history.undo();

    history.execute(setCell(sheet, "B1", "x"));

    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false);
    expect(Object.fromEntries(sheet)).toEqual({ B1: "x" });
  });

  test("execute가 에러를 던지면 기록하지 않고 에러를 그대로 전달한다", () => {
    const history = new History();

    expect(() => history.execute(failing())).toThrow("실패");

    expect(history.canUndo).toBe(false);
  });

  test("execute가 실패하면 아무것도 바뀌지 않았으므로 redo 기록을 남겨 둔다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "10"));
    history.undo();

    expect(() => history.execute(failing())).toThrow("실패");

    expect(history.redo()).toBe(true);
    expect(sheet.get("A1")).toBe("10");
  });
});

describe("개수 제한", () => {
  test("기본으로 최근 100개까지만 되돌릴 수 있다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    for (let i = 1; i <= 101; i++) history.execute(setCell(sheet, "A1", String(i)));

    let undone = 0;
    while (history.undo()) undone++;

    expect(undone).toBe(100);
    expect(sheet.get("A1")).toBe("1");
  });

  test("limit 옵션으로 개수를 바꿀 수 있다", () => {
    const sheet: Sheet = new Map();
    const history = new History({ limit: 2 });
    history.execute(setCell(sheet, "A1", "1"));
    history.execute(setCell(sheet, "A1", "2"));
    history.execute(setCell(sheet, "A1", "3"));

    history.undo();
    history.undo();

    expect(history.canUndo).toBe(false);
    expect(sheet.get("A1")).toBe("1");
  });

  test("limit이 1 이상의 정수가 아니면 에러를 던진다", () => {
    expect(() => new History({ limit: 0 })).toThrow(RangeError);
    expect(() => new History({ limit: 1.5 })).toThrow(RangeError);
    expect(() => new History({ limit: Number.NaN })).toThrow(RangeError);
  });
});

describe("연속 입력 합치기", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("mergeKey가 같은 편집이 0.5초 안에 이어지면 undo 한 번에 함께 되돌린다", () => {
    const doc = { text: "" };
    const history = new History();
    history.execute(typeChar(doc, "a"));
    vi.setSystemTime(200);
    history.execute(typeChar(doc, "b"));
    vi.setSystemTime(400);
    history.execute(typeChar(doc, "c"));

    history.undo();

    expect(doc.text).toBe("");
    expect(history.canUndo).toBe(false);
  });

  test("합친 편집은 나중 것부터 역순으로 되돌린다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "a", "typing"));
    history.execute(setCell(sheet, "A1", "ab", "typing"));
    history.execute(setCell(sheet, "A1", "abc", "typing"));

    history.undo();

    expect(sheet.has("A1")).toBe(false);
  });

  test("합친 편집을 redo하면 처음 순서대로 모두 다시 적용한다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "a", "typing"));
    history.execute(setCell(sheet, "A1", "ab", "typing"));
    history.execute(setCell(sheet, "A1", "abc", "typing"));
    history.undo();

    history.redo();

    expect(sheet.get("A1")).toBe("abc");
  });

  test("정확히 0.5초 간격이면 합치고, 0.5초를 넘으면 새 묶음이 된다", () => {
    const doc = { text: "" };
    const history = new History();
    history.execute(typeChar(doc, "a"));
    vi.setSystemTime(500);
    history.execute(typeChar(doc, "b"));
    vi.setSystemTime(1001);
    history.execute(typeChar(doc, "c"));

    history.undo();
    expect(doc.text).toBe("ab");
    history.undo();
    expect(doc.text).toBe("");
  });

  test("간격은 직전 편집 기준이라 쉬지 않고 치면 계속 합쳐진다", () => {
    const doc = { text: "" };
    const history = new History();
    for (const [time, char] of [[0, "a"], [400, "b"], [800, "c"], [1200, "d"]] as const) {
      vi.setSystemTime(time);
      history.execute(typeChar(doc, char));
    }

    history.undo();

    expect(doc.text).toBe("");
  });

  test("mergeKey가 다르면 합치지 않는다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "a", "typing"));
    history.execute(setCell(sheet, "B1", "b", "other"));

    history.undo();

    expect(Object.fromEntries(sheet)).toEqual({ A1: "a" });
  });

  test("mergeKey가 없는 편집은 합치지 않는다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "a"));
    history.execute(setCell(sheet, "A1", "b"));

    history.undo();

    expect(sheet.get("A1")).toBe("a");
  });

  test("undo한 뒤의 편집은 그 아래 남은 편집과 합치지 않는다", () => {
    const doc = { text: "" };
    const history = new History();
    history.execute(typeChar(doc, "a"));
    vi.setSystemTime(1000);
    history.execute(typeChar(doc, "b"));
    vi.setSystemTime(1100);
    history.undo();

    vi.setSystemTime(1200);
    history.execute(typeChar(doc, "c"));
    history.undo();

    expect(doc.text).toBe("a");
  });

  test("redo한 뒤의 편집은 redo한 편집과 합치지 않는다", () => {
    const doc = { text: "" };
    const history = new History();
    history.execute(typeChar(doc, "a"));
    vi.setSystemTime(100);
    history.undo();
    vi.setSystemTime(200);
    history.redo();

    vi.setSystemTime(300);
    history.execute(typeChar(doc, "b"));
    history.undo();

    expect(doc.text).toBe("a");
  });

  test("mergeWindowMs 옵션으로 합치는 간격을 바꿀 수 있다", () => {
    const doc = { text: "" };
    const history = new History({ mergeWindowMs: 1000 });
    history.execute(typeChar(doc, "a"));
    vi.setSystemTime(900);
    history.execute(typeChar(doc, "b"));

    history.undo();

    expect(doc.text).toBe("");
  });

  test("mergeWindowMs가 0 이상의 숫자가 아니면 에러를 던진다", () => {
    expect(() => new History({ mergeWindowMs: -1 })).toThrow(RangeError);
    expect(() => new History({ mergeWindowMs: Number.NaN })).toThrow(RangeError);
  });
});

describe("batch", () => {
  test("batch 안의 편집은 undo 한 번에 모두 되돌린다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.batch(() => {
      history.execute(setCell(sheet, "A1", "1"));
      history.execute(setCell(sheet, "A2", "2"));
      history.execute(setCell(sheet, "A3", "3"));
    });

    history.undo();

    expect(Object.fromEntries(sheet)).toEqual({});
    expect(history.canUndo).toBe(false);
  });

  test("batch로 묶은 편집은 나중 것부터 역순으로 되돌린다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.batch(() => {
      history.execute(setCell(sheet, "A1", "1"));
      history.execute(setCell(sheet, "A1", "2"));
    });

    history.undo();

    expect(sheet.has("A1")).toBe(false);
  });

  test("batch로 묶은 편집을 redo하면 처음 순서대로 모두 다시 적용한다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.batch(() => {
      history.execute(setCell(sheet, "A1", "1"));
      history.execute(setCell(sheet, "A1", "2"));
      history.execute(setCell(sheet, "B1", "x"));
    });
    history.undo();

    history.redo();

    expect(Object.fromEntries(sheet)).toEqual({ A1: "2", B1: "x" });
  });

  test("batch는 콜백이 돌려준 값을 그대로 돌려준다", () => {
    const history = new History();

    expect(history.batch(() => 42)).toBe(42);
  });

  test("batch 안에서 에러가 나면 이미 실행한 편집을 되돌리고 에러를 다시 던진다", () => {
    const sheet: Sheet = new Map();
    const history = new History();

    expect(() =>
      history.batch(() => {
        history.execute(setCell(sheet, "A1", "1"));
        history.execute(setCell(sheet, "A2", "2"));
        throw new Error("중단");
      }),
    ).toThrow("중단");

    expect(Object.fromEntries(sheet)).toEqual({});
    expect(history.canUndo).toBe(false);
  });

  test("batch 안에서 Command의 execute가 실패해도 앞 편집을 되돌린다", () => {
    const sheet: Sheet = new Map();
    const history = new History();

    expect(() =>
      history.batch(() => {
        history.execute(setCell(sheet, "A1", "1"));
        history.execute(failing());
      }),
    ).toThrow("실패");

    expect(Object.fromEntries(sheet)).toEqual({});
    expect(history.canUndo).toBe(false);
  });

  test("아무 편집도 하지 않은 batch는 기록을 남기지 않고 redo 기록도 건드리지 않는다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "1"));
    history.undo();

    history.batch(() => {});

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  test("batch가 끝나면 redo 기록은 사라진다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "1"));
    history.undo();

    history.batch(() => {
      history.execute(setCell(sheet, "B1", "x"));
    });

    expect(history.canRedo).toBe(false);
  });

  test("batch 안의 batch는 바깥 batch 하나로 묶인다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.batch(() => {
      history.execute(setCell(sheet, "A1", "1"));
      history.batch(() => {
        history.execute(setCell(sheet, "A2", "2"));
        history.execute(setCell(sheet, "A3", "3"));
      });
      history.execute(setCell(sheet, "A4", "4"));
    });

    history.undo();

    expect(Object.fromEntries(sheet)).toEqual({});
    expect(history.canUndo).toBe(false);
  });

  test("안쪽 batch의 에러를 바깥에서 잡으면 안쪽 편집만 되돌린다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.batch(() => {
      history.execute(setCell(sheet, "A1", "1"));
      try {
        history.batch(() => {
          history.execute(setCell(sheet, "A2", "2"));
          throw new Error("중단");
        });
      } catch {
        // 안쪽 실패는 무시하고 계속한다
      }
      history.execute(setCell(sheet, "A3", "3"));
    });
    expect(Object.fromEntries(sheet)).toEqual({ A1: "1", A3: "3" });

    history.undo();

    expect(Object.fromEntries(sheet)).toEqual({});
  });

  test("batch 안에서는 undo와 redo를 부를 수 없다", () => {
    const sheet: Sheet = new Map();
    const history = new History();
    history.execute(setCell(sheet, "A1", "1"));

    expect(() => history.batch(() => history.undo())).toThrow();
    expect(() => history.batch(() => history.redo())).toThrow();
    expect(sheet.get("A1")).toBe("1");
  });

  test("batch는 앞뒤 편집과 합치지 않는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const doc = { text: "" };
      const history = new History();
      history.execute(typeChar(doc, "a"));
      vi.setSystemTime(100);
      history.batch(() => history.execute(typeChar(doc, "b")));
      vi.setSystemTime(200);
      history.execute(typeChar(doc, "c"));

      history.undo();
      expect(doc.text).toBe("ab");
      history.undo();
      expect(doc.text).toBe("a");
      history.undo();
      expect(doc.text).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
