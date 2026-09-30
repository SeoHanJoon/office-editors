/** 메뉴 항목 하나. 고르면 value를 돌려준다. */
export interface ContextMenuItem<T> {
  readonly label: string;
  /** 항목 오른쪽에 흐리게 보여줄 단축키 ("Ctrl+C", "⌘C") */
  readonly shortcut?: string;
  /** 할 수 없는 항목. 흐리게 보이고 고를 수 없다. */
  readonly disabled?: boolean;
  readonly value: T;
}

/** 메뉴 한 줄: 항목 또는 구분선 */
export type ContextMenuEntry<T> = ContextMenuItem<T> | "separator";

export interface ContextMenuOptions<T> {
  readonly items: readonly ContextMenuEntry<T>[];
  /** 메뉴 왼쪽 위를 놓을 화면 좌표 (clientX, clientY). 화면 밖으로 넘치면 반대쪽으로 편다. */
  readonly x: number;
  readonly y: number;
  /** 항목을 고르면 메뉴를 닫은 뒤 부른다. */
  readonly onSelect: (value: T) => void;
  /** 어떻게든 닫히면 부른다. (고르기, Esc, 바깥 클릭, 스크롤) 포커스를 돌려줄 때 쓴다. */
  readonly onClose?: () => void;
  /** 키보드로 열었으면 true. 첫 항목을 미리 가리킨다. */
  readonly highlightFirst?: boolean;
  /** 접근성 이름 (aria-label) */
  readonly label?: string;
}

/** 화면 크기 안에 메뉴를 놓을 자리. 오른쪽·아래로 넘치면 점의 왼쪽·위로 펴고, 그래도 넘치면 화면 끝에 붙인다. */
export function placeMenu(
  point: { x: number; y: number },
  size: { width: number; height: number },
  screen: { width: number; height: number },
): { x: number; y: number } {
  const fit = (start: number, length: number, limit: number) => {
    if (start + length <= limit) return start;
    if (start - length >= 0) return start - length;
    return Math.max(0, limit - length);
  };
  return { x: fit(point.x, size.width, screen.width), y: fit(point.y, size.height, screen.height) };
}

/**
 * from에서 step(1: 아래, -1: 위)쪽으로 다음에 고를 수 있는 항목 번호. 끝에서는 반대쪽 끝으로 돈다.
 * from이 -1이면 아무것도 가리키지 않은 상태다. 고를 수 있는 항목이 없으면 -1
 */
export function nextEnabled<T>(entries: readonly ContextMenuEntry<T>[], from: number, step: 1 | -1): number {
  const count = entries.length;
  let index = from === -1 && step === -1 ? count : from;
  for (let tries = 0; tries < count; tries++) {
    index = (index + step + count) % count;
    const entry = entries[index]!;
    if (entry !== "separator" && !entry.disabled) return index;
  }
  return -1;
}

const COLORS = {
  background: "#ffffff",
  border: "#c8c8c8",
  text: "#1f1f1f",
  disabledText: "#a0a0a0",
  shortcut: "#707070",
  highlight: "#e8f3ec",
  separator: "#e1e1e1",
};

/**
 * 오른쪽 클릭 메뉴. React 없이 document.body에 붙는 DOM이다. (ADR 0029)
 * 열면 메뉴가 키보드 포커스를 가져간다. ↑↓·Home·End로 옮기고 Enter·Space로 고른다. 흐린 항목과 구분선은 건너뛴다.
 * Esc, Tab, 바깥 클릭, 스크롤, 창 크기 바꾸기, 창에서 포커스가 빠지면 닫힌다.
 */
export class ContextMenu<T> {
  readonly element: HTMLDivElement;
  private readonly options: ContextMenuOptions<T>;
  private readonly rows: HTMLElement[] = [];
  private highlighted = -1;
  private closed = false;

  constructor(options: ContextMenuOptions<T>) {
    this.options = options;
    const menu = document.createElement("div");
    this.element = menu;
    menu.setAttribute("role", "menu");
    if (options.label) menu.setAttribute("aria-label", options.label);
    menu.tabIndex = -1;
    menu.style.cssText = [
      "position:fixed;left:0;top:0;z-index:1000;min-width:200px;padding:4px 0;outline:none",
      `background:${COLORS.background};border:1px solid ${COLORS.border};border-radius:4px`,
      "box-shadow:0 4px 12px rgba(0,0,0,0.15)",
      `font:13px -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;color:${COLORS.text}`,
      "user-select:none;-webkit-user-select:none",
    ].join(";");

    options.items.forEach((entry, index) => {
      const row = entry === "separator" ? this.separator() : this.item(entry, index);
      this.rows.push(row);
      menu.append(row);
    });

    document.body.append(menu);
    const box = menu.getBoundingClientRect();
    const place = placeMenu(options, box, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${place.x}px`;
    menu.style.top = `${place.y}px`;
    menu.focus();
    if (options.highlightFirst) this.highlight(nextEnabled(options.items, -1, 1));

    menu.addEventListener("keydown", this.onKeyDown);
    // 메뉴 위에서 오른쪽 클릭하거나 메뉴 키를 눌러도 브라우저 메뉴가 겹쳐 뜨지 않게 한다.
    menu.addEventListener("contextmenu", (event) => event.preventDefault());
    // 메뉴를 연 오른쪽 클릭이 끝난 뒤부터 듣는다. 캡처 단계에서 들어서 다른 코드가 이벤트를 막아도 닫힌다.
    document.addEventListener("pointerdown", this.onOutsidePointer, true);
    document.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.close);
    window.addEventListener("blur", this.close);
  }

  /** 가리키고 있는 항목 번호. 없으면 -1 */
  get highlightedIndex(): number {
    return this.highlighted;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** 메뉴를 닫는다. 이미 닫혔으면 아무것도 하지 않는다. */
  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.close);
    window.removeEventListener("blur", this.close);
    this.element.remove();
    this.options.onClose?.();
  };

  private separator(): HTMLElement {
    const line = document.createElement("div");
    line.setAttribute("role", "separator");
    line.style.cssText = `height:1px;margin:4px 0;background:${COLORS.separator}`;
    return line;
  }

  private item(entry: ContextMenuItem<T>, index: number): HTMLElement {
    const row = document.createElement("div");
    row.setAttribute("role", "menuitem");
    row.setAttribute("aria-disabled", String(!!entry.disabled));
    if (entry.shortcut) row.setAttribute("aria-keyshortcuts", entry.shortcut);
    row.style.cssText = [
      "display:flex;justify-content:space-between;gap:24px;padding:4px 16px;white-space:nowrap",
      `cursor:${entry.disabled ? "default" : "pointer"}`,
      `color:${entry.disabled ? COLORS.disabledText : COLORS.text}`,
    ].join(";");
    const label = document.createElement("span");
    label.textContent = entry.label;
    row.append(label);
    if (entry.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.textContent = entry.shortcut;
      shortcut.setAttribute("aria-hidden", "true");
      shortcut.style.color = entry.disabled ? COLORS.disabledText : COLORS.shortcut;
      row.append(shortcut);
    }
    row.addEventListener("pointerenter", () => this.highlight(entry.disabled ? -1 : index));
    // 누르는 동안 포커스가 메뉴 밖으로 빠지지 않게 한다.
    row.addEventListener("pointerdown", (event) => event.preventDefault());
    row.addEventListener("click", () => this.choose(index));
    return row;
  }

  private highlight(index: number): void {
    if (index === this.highlighted) return;
    const previous = this.rows[this.highlighted];
    if (previous) previous.style.background = "";
    this.highlighted = index;
    const row = this.rows[index];
    if (row) {
      row.style.background = COLORS.highlight;
      row.scrollIntoView?.({ block: "nearest" });
    }
  }

  private choose(index: number): void {
    const entry = this.options.items[index];
    if (!entry || entry === "separator" || entry.disabled) return;
    this.close();
    this.options.onSelect(entry.value);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    const { items } = this.options;
    switch (event.key) {
      case "ArrowDown":
        this.highlight(nextEnabled(items, this.highlighted, 1));
        break;
      case "ArrowUp":
        this.highlight(nextEnabled(items, this.highlighted, -1));
        break;
      case "Home":
        this.highlight(nextEnabled(items, -1, 1));
        break;
      case "End":
        this.highlight(nextEnabled(items, -1, -1));
        break;
      case "Enter":
      case " ":
        this.choose(this.highlighted);
        break;
      case "Escape":
      case "Tab":
        this.close();
        break;
      default:
        // 메뉴가 열린 동안 다른 키는 표로 가지 않게 막는다.
        break;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (!this.element.contains(event.target as Node)) this.close();
  };

  private readonly onScroll = (event: Event): void => {
    if (!this.element.contains(event.target as Node)) this.close();
  };
}
