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

  test("Ctrl+Shift+=와 Ctrl+숫자패드 +는 행·열 삽입, Ctrl+-는 행·열 삭제다", () => {
    const plus = { key: "+", code: "Equal", shiftKey: true, ctrlKey: true, metaKey: false, altKey: false };
    expect(editAction(plus, null)).toBe("insertLines");
    // 자판에 따라 Shift+=의 key가 "="로 올 수 있다.
    expect(action("Shift+Meta+=", null, "Equal")).toBe("insertLines");
    expect(editAction({ ...plus, shiftKey: false, code: "NumpadAdd" }, null)).toBe("insertLines");
    expect(action("Control+-", null, "Minus")).toBe("deleteLines");
    expect(action("Meta+-", null, "NumpadSubtract")).toBe("deleteLines");
    // 입력 중에는 입력창에 맡긴다.
    expect(editAction(plus, "enter")).toBeNull();
    expect(action("Control+-", "edit", "Minus")).toBeNull();
  });

  test("Ctrl/Cmd+A는 시트 전체 선택이다. 한글 자판에서 'ㅁ'로 와도 같다", () => {
    expect(action("Control+a", null)).toBe("selectAll");
    expect(action("Meta+a", null)).toBe("selectAll");
    expect(action("Control+ㅁ", null, "KeyA")).toBe("selectAll");
    // 입력 중에는 입력창 글자 전체 선택
    expect(action("Control+a", "edit")).toBeNull();
  });

  test("Shift+Space는 행 선택, Ctrl+Space와 ⌥Space는 열 선택이다", () => {
    const space = (combo: string, key = " ") => action(`${combo}+${key}`, null, "Space");
    expect(space("Shift")).toBe("selectRows");
    expect(space("Control")).toBe("selectColumns");
    // Mac의 ⌥Space는 key가 줄바꿈 없는 공백으로 온다.
    expect(space("Alt", "\u00a0")).toBe("selectColumns");
    // Cmd+Space(Spotlight)와 다른 조합은 받지 않는다.
    for (const combo of ["Meta", "Shift+Control", "Control+Alt", "Shift+Alt"]) expect(space(combo)).toBe("navigate");
    // 입력 중에는 공백 입력
    expect(action("Shift+ ", "enter", "Space")).toBeNull();
  });

  test("Shift+F10과 메뉴 키는 오른쪽 클릭 메뉴를 연다", () => {
    expect(action("Shift+F10", null)).toBe("openMenu");
    expect(action("ContextMenu", null)).toBe("openMenu");
    expect(action("F10", null)).toBe("navigate");
    // 입력 중에는 브라우저에 맡긴다.
    expect(action("Shift+F10", "edit")).toBeNull();
  });

  test("Ctrl+D는 아래로, Ctrl+R은 오른쪽으로 채우기다 (Mac은 Cmd도)", () => {
    expect(action("Control+d", null)).toBe("fillDown");
    expect(action("Meta+d", null)).toBe("fillDown");
    expect(action("Control+r", null)).toBe("fillRight");
    expect(action("Meta+r", null)).toBe("fillRight");
    // 한글 자판
    expect(action("Control+ㅇ", null, "KeyD")).toBe("fillDown");
    expect(action("Control+ㄱ", null, "KeyR")).toBe("fillRight");
  });

  test("입력 중 Ctrl+D·Ctrl+R은 채우지 않는다", () => {
    expect(action("Control+d", "edit")).toBeNull();
    expect(action("Control+r", "enter")).toBeNull();
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

  test("입력 중 Alt+Enter(Mac은 Option+Enter)는 셀 안 줄바꿈이다", () => {
    expect(action("Alt+Enter", "enter")).toBe("newline");
    expect(action("Alt+Enter", "edit")).toBe("newline");
    expect(action("Alt+Shift+Enter", "edit")).toBe("newline");
  });

  test("Ctrl+Enter(Mac은 Cmd+Enter도)는 고른 범위 전체에 넣는다", () => {
    expect(action("Control+Enter", "edit")).toBe("fillEntry");
    expect(action("Control+Enter", "enter")).toBe("fillEntry");
    expect(action("Meta+Enter", "enter")).toBe("fillEntry");
  });

  test("Ctrl+Alt+Enter와 Ctrl+Shift+Enter는 줄바꿈만 막는다", () => {
    expect(action("Control+Alt+Enter", "enter")).toBe("block");
    expect(action("Shift+Control+Enter", "edit")).toBe("block");
  });

  test("Ctrl+Z, 글자, Delete, Backspace는 입력창에 맡긴다", () => {
    for (const combo of ["Control+z", "a", "ㅎ", "Delete", "Backspace", "Home", "End"]) {
      expect(action(combo, "enter")).toBeNull();
    }
  });
});
