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
  /** 입력을 취소한다. 입력 중이 아니면 복사한 범위 표시(점선)를 지운다. (Esc) */
  | "cancel"
  /** 입력 중에 "enter"와 "edit"를 바꾼다. (F2) */
  | "toggleMode"
  /** 고른 행·열 전체 앞에 같은 수만큼 새 행·열을 넣는다. (Ctrl+Shift+=, Ctrl+숫자패드 +) */
  | "insertLines"
  /** 고른 행·열 전체를 지운다. (Ctrl+-) */
  | "deleteLines"
  /** 시트 전체를 고른다. (Ctrl/Cmd+A) */
  | "selectAll"
  /** 고른 범위가 걸친 행 전체를 고른다. (Shift+Space) */
  | "selectRows"
  /** 고른 범위가 걸친 열 전체를 고른다. (Ctrl+Space, Mac에서 한/영 전환과 겹칠 때 쓰는 ⌥Space) */
  | "selectColumns"
  /** 활성 셀 옆에 오른쪽 클릭 메뉴를 연다. (Shift+F10, 메뉴 키) */
  | "openMenu"
  /** 입력 중에 커서 자리에 셀 안 줄바꿈을 넣는다. (Alt+Enter, Mac은 Option+Enter) */
  | "newline"
  /** 고른 범위의 첫 행을 아래 칸에 복사한다. 한 행만 골랐으면 위 행을 복사해 온다. (Ctrl+D) */
  | "fillDown"
  /** 고른 범위의 첫 열을 오른쪽 칸에 복사한다. 한 열만 골랐으면 왼쪽 열을 복사해 온다. (Ctrl+R) */
  | "fillRight"
  /** 입력을 확정하며 고른 범위 전체에 넣는다. 선택은 그대로 둔다. (Ctrl+Enter) */
  | "fillEntry"
  /** 고른 범위의 굵게·기울임·밑줄을 켜고 끈다. (Ctrl+B, Ctrl+I, Ctrl+U) 입력 중에는 없다. */
  | "bold"
  | "italic"
  | "underline"
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
      if (isLetter(input, "a") && !input.shiftKey) return "selectAll";
      // Ctrl+U는 브라우저의 소스 보기 단축키와 겹친다. 부르는 쪽이 기본 동작을 막는다.
      if (isLetter(input, "b") && !input.shiftKey) return "bold";
      if (isLetter(input, "i") && !input.shiftKey) return "italic";
      if (isLetter(input, "u") && !input.shiftKey) return "underline";
      // 브라우저의 북마크(Ctrl/Cmd+D)·새로고침(Ctrl/Cmd+R) 단축키와 겹친다. 부르는 쪽이 기본 동작을 막는다.
      if (isLetter(input, "d") && !input.shiftKey) return "fillDown";
      if (isLetter(input, "r") && !input.shiftKey) return "fillRight";
      // 자판마다 Shift+=의 key가 다를 수 있어서 자판 위치(code)도 본다.
      if (input.key === "+" || (input.shiftKey && input.code === "Equal") || input.code === "NumpadAdd") return "insertLines";
      if (!input.shiftKey && (input.key === "-" || input.code === "Minus" || input.code === "NumpadSubtract")) return "deleteLines";
    }
    if (isSpace(input)) {
      // Cmd+Space는 Spotlight라 받지 않는다. Mac의 ⌥Space는 key가 줄바꿈 없는 공백(U+00A0)으로 온다.
      const { shiftKey, ctrlKey, metaKey, altKey } = input;
      if (shiftKey && !ctrlKey && !metaKey && !altKey) return "selectRows";
      if (!shiftKey && !metaKey && ctrlKey !== altKey) return "selectColumns";
    }
    if (input.key === "ContextMenu" || (input.key === "F10" && input.shiftKey && !mod && !input.altKey)) return "openMenu";
    if (plain && input.key === "Delete") return "clear";
    if (plain && input.key === "Backspace") return "clearAndEnter";
    if (plain && input.key === "F2") return "edit";
    if (plain && input.key === "Escape") return "cancel";
    return "navigate";
  }

  switch (input.key) {
    case "Escape":
      return "cancel";
    case "Enter":
      if (plain) return "commit";
      if (input.altKey) return mod ? "block" : "newline";
      // Ctrl+Shift+Enter(Excel의 배열 수식)는 없다. 입력창에 줄바꿈이 들어가지 않게 막는다.
      return input.shiftKey ? "block" : "fillEntry";
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

function isSpace(input: KeyInput): boolean {
  return input.code === "Space" || input.key === " " || input.key === "\u00a0";
}
