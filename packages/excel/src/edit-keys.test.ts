import { describe, expect, test } from "vitest";
import { editAction, type EditMode } from "./edit-keys";
import type { KeyInput } from "./keyboard";

/** "Shift+Control+z" 같은 글자를 키 입력으로 바꾼다. code는 영문 자판 기준 */
function key(combo: string, code?: string): KeyInput {
  const parts = combo.split("+");
  const name = parts.at(-1)!;
  return {
    key: name,
    code: code ?? (/^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : name),
    shiftKey: parts.includes("Shift"),
    ctrlKey: parts.includes("Control"),
    metaKey: parts.includes("Meta"),
    altKey: parts.includes("Alt"),
  };
}

const action = (combo: string, mode: EditMode | null, code?: string) => editAction(key(combo, code), mode);

describe("입력 중이 아닐 때", () => {
  test("Ctrl+Z는 되돌리기, Ctrl+Y와 Ctrl+Shift+Z는 다시 하기다", () => {
    expect(action("Control+z", null)).toBe("undo");
    expect(action("Control+y", null)).toBe("redo");
    expect(action("Shift+Control+Z", null)).toBe("redo");
  });

  test("macOS의 Cmd+Z, Cmd+Shift+Z, Cmd+Y도 같다", () => {
    expect(action("Meta+z", null)).toBe("undo");
    expect(action("Shift+Meta+Z", null)).toBe("redo");
    expect(action("Meta+y", null)).toBe("redo");
  });

  test("한글 자판에서 Ctrl+Z의 key가 'ㅋ'로 와도 되돌리기다", () => {
    expect(action("Control+ㅋ", null, "KeyZ")).toBe("undo");
    expect(action("Control+ㅛ", null, "KeyY")).toBe("redo");
  });

  test("다른 자판 배열에서는 자판 위치가 아니라 글자로 판단한다", () => {
    // Dvorak 자판에서 Z 자리(KeyZ)에는 ";"가 있고, "z"는 다른 자리에 있다.
    expect(action("Control+z", null, "Slash")).toBe("undo");
  });

  test("Delete는 범위 지우기, Backspace는 비우고 입력 시작, F2는 고치기 시작이다", () => {
    expect(action("Delete", null)).toBe("clear");
    expect(action("Backspace", null)).toBe("clearAndEnter");
    expect(action("F2", null)).toBe("edit");
    expect(action("Escape", null)).toBe("cancel");
  });

  test("나머지 키는 이동 키인지 navigate에 묻는다", () => {
    for (const combo of ["ArrowDown", "Enter", "Tab", "a", "ㅎ", "Control+c", "Alt+z"]) {
      expect(action(combo, null)).toBe("navigate");
    }
  });
});

describe("입력 중일 때", () => {
  test("Enter와 Tab은 확정하고 옮긴다", () => {
    for (const mode of ["enter", "edit"] as const) {
      for (const combo of ["Enter", "Shift+Enter", "Tab", "Shift+Tab"]) {
        expect(action(combo, mode)).toBe("commit");
      }
    }
  });

  test("Esc는 입력을 취소한다", () => {
    expect(action("Escape", "enter")).toBe("cancel");
    expect(action("Escape", "edit")).toBe("cancel");
  });

  test("글자를 쳐서 시작했으면 방향키가 확정하고 옮긴다", () => {
    for (const combo of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift+ArrowRight"]) {
      expect(action(combo, "enter")).toBe("commit");
    }
  });

  test("F2나 더블클릭으로 시작했으면 방향키는 입력창 안에서 커서를 옮긴다", () => {
    for (const combo of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"]) {
      expect(action(combo, "edit")).toBeNull();
    }
  });

  test("F2는 두 입력 상태를 바꾼다", () => {
    expect(action("F2", "enter")).toBe("toggleMode");
    expect(action("F2", "edit")).toBe("toggleMode");
  });

  test("Alt+Enter와 Ctrl+Enter는 아직 없어서 줄바꿈만 막는다", () => {
    expect(action("Alt+Enter", "enter")).toBe("block");
    expect(action("Control+Enter", "edit")).toBe("block");
  });

  test("Ctrl+Z, 글자, Delete, Backspace는 입력창에 맡긴다", () => {
    for (const combo of ["Control+z", "a", "ㅎ", "Delete", "Backspace", "Home", "End"]) {
      expect(action(combo, "enter")).toBeNull();
    }
  });
});
