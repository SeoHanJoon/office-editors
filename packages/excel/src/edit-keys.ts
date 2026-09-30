import type { KeyInput } from "./keyboard";

/**
 * 입력창 상태 (Excel의 상태 표시줄과 같은 이름)
 * - "enter": 셀을 고른 채 글자를 쳐서 시작. 기존 값을 지우고 새로 쓴다. 방향키를 누르면 확정하고 옮긴다.
 * - "edit": F2나 더블클릭으로 시작. 기존 값을 고친다. 방향키는 입력창 안에서 커서를 옮긴다.
 */
export type EditMode = "enter" | "edit";

/**
 * 키가 뜻하는 편집 동작. null이면 브라우저에 맡긴다. (입력창에 글자가 들어가거나 커서가 움직인다)
 * - navigate: navigate()로 선택을 옮긴다. (편집 중이 아닐 때만)
 * - commit: 입력을 확정하고 같은 키로 navigate()를 부른다.
 * - block: 아무것도 하지 않고 브라우저 기본 동작만 막는다.
 */
export type EditAction =
  | "navigate"
  | "undo"
  | "redo"
  /** 선택 범위의 값을 지운다. (Delete) */
  | "clear"
  /** 활성 셀을 비우고 "enter" 입력을 시작한다. (Backspace) */
  | "clearAndEnter"
  /** 기존 값으로 "edit" 입력을 시작한다. (F2) */
  | "edit"
  | "commit"
  | "cancel"
  /** 입력 중에 "enter"와 "edit"를 바꾼다. (F2) */
  | "toggleMode"
  | "block";

/**
 * 키 입력이 어떤 편집 동작인지 정한다. mode는 입력 중이면 그 상태, 아니면 null이다.
 * 한글 조합 중인 키(isComposing)는 부르는 쪽이 먼저 걸러야 한다.
 * Ctrl 대신 Cmd(macOS)를 눌러도 같다.
 */
export function editAction(input: KeyInput, mode: EditMode | null): EditAction | null {
  const mod = input.ctrlKey || input.metaKey;
  const plain = !mod && !input.altKey;

  if (mode === null) {
    if (mod && !input.altKey) {
      if (isLetter(input, "z")) return input.shiftKey ? "redo" : "undo";
      if (isLetter(input, "y") && !input.shiftKey) return "redo";
    }
    if (plain && input.key === "Delete") return "clear";
    if (plain && input.key === "Backspace") return "clearAndEnter";
    if (plain && input.key === "F2") return "edit";
    return "navigate";
  }

  switch (input.key) {
    case "Escape":
      return "cancel";
    case "Enter":
      // Alt+Enter(셀 안 줄바꿈), Ctrl+Enter(범위 채우기)는 아직 없다. 입력창에 줄바꿈이 들어가지 않게 막는다.
      return plain ? "commit" : "block";
    case "Tab":
      return mod ? null : "commit";
    case "F2":
      return plain ? "toggleMode" : null;
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      return mode === "enter" && !input.altKey ? "commit" : null;
    default:
      return null;
  }
}

/**
 * 글자 단축키인지. 한글 자판에서는 Ctrl+Z의 key가 "ㅋ"로 올 수 있어서,
 * key가 영문자가 아니면 자판 위치(code)로 판단한다.
 */
function isLetter(input: KeyInput, letter: string): boolean {
  const key = input.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key === letter;
  return input.code === `Key${letter.toUpperCase()}`;
}
