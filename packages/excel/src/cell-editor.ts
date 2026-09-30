import type { CellAddress } from "./address";
import type { EditMode } from "./edit-keys";
import { cellRect, type GridLayout, type Viewport } from "./layout";
import { CELL_FONT, CELL_PADDING, THEME } from "./render";

/** 입력창 테두리 두께 (px). 선택 테두리와 같다. */
const BORDER = 2;

/**
 * 셀 위에 띄우는 입력창(textarea) 하나.
 *
 * 한글 첫 글자가 사라지지 않도록 입력창은 입력 중이 아닐 때도 활성 셀 위에 투명하게 떠서 키보드 포커스를 갖는다.
 * 글자 키를 누르면 브라우저가 한글 조합을 처음부터 이 입력창에서 시작하고, 부르는 쪽은 그때 입력창을 보이게만 한다.
 * 조합 중에는 value를 건드리지 않는다. (건드리면 조합 중인 글자가 사라지거나 두 번 들어간다)
 */
export class CellEditor {
  readonly element: HTMLTextAreaElement;
  /** 확정할 수 없는 입력(틀린 수식)일 때 입력창 아래에 띄우는 알림 */
  private readonly problem: HTMLDivElement;
  /** 셀 영역(머리글 제외)만큼의 틀. 입력창이 머리글 위로 넘치지 않게 잘라낸다. */
  private readonly frame: HTMLDivElement;
  private readonly layout: GridLayout;
  private currentMode: EditMode | null = null;
  private currentAddress: CellAddress | null = null;
  private isComposing = false;
  /** 입력창이 늘어날 수 있는 최소·최대 너비 (px) */
  private minWidth = 0;
  private maxWidth = 0;

  constructor(parent: HTMLElement, layout: GridLayout) {
    this.layout = layout;

    this.frame = document.createElement("div");
    // overflow:clip은 스크롤 영역을 만들지 않아서, 입력할 때 브라우저가 커서를 보이게 하려고 틀을 스크롤하는 일이 없다.
    this.frame.style.cssText = `position:absolute;left:${layout.headerWidth}px;top:${layout.headerHeight}px;overflow:clip;pointer-events:none`;

    this.element = document.createElement("textarea");
    this.element.setAttribute("aria-label", "셀 입력");
    this.element.spellcheck = false;
    this.element.autocomplete = "off";
    this.element.setAttribute("autocapitalize", "off");
    this.element.setAttribute("autocorrect", "off");
    this.element.wrap = "off";
    this.element.style.cssText = [
      "position:absolute;left:0;top:0;margin:0;resize:none;overflow:hidden;outline:none;box-sizing:border-box",
      `border:${BORDER}px solid ${THEME.selectionBorder};background:${THEME.background};color:${THEME.text}`,
      `font:${CELL_FONT};line-height:${layout.rowHeight - BORDER}px;white-space:pre`,
      `padding:0 ${CELL_PADDING - BORDER / 2}px`,
    ].join(";");
    this.hide();

    this.problem = document.createElement("div");
    this.problem.setAttribute("role", "alert");
    this.problem.style.cssText = [
      "position:absolute;left:0;top:0;padding:4px 8px;white-space:nowrap;pointer-events:none",
      `font:${CELL_FONT};color:${THEME.problemText};background:${THEME.problemBackground}`,
      `border:1px solid ${THEME.problemBorder};box-shadow:0 2px 6px rgba(0,0,0,0.15)`,
    ].join(";");
    this.problem.hidden = true;

    this.element.addEventListener("compositionstart", () => (this.isComposing = true));
    this.element.addEventListener("compositionend", () => (this.isComposing = false));
    this.element.addEventListener("input", () => {
      this.problem.hidden = true;
      this.fit();
    });

    this.frame.append(this.element, this.problem);
    parent.append(this.frame);
  }

  /** 입력 중이면 그 상태, 아니면 null */
  get mode(): EditMode | null {
    return this.currentMode;
  }

  set mode(mode: EditMode) {
    if (this.currentMode) this.currentMode = mode;
  }

  /** 입력 중인 셀. 입력 중이 아니면 null */
  get address(): CellAddress | null {
    return this.currentAddress;
  }

  /** 입력창에 들어 있는 글자 */
  get text(): string {
    return this.element.value;
  }

  /** 한글 등 조합 중인 글자가 있는지 */
  get composing(): boolean {
    return this.isComposing;
  }

  focus(): void {
    this.element.focus({ preventScroll: true });
  }

  /**
   * address 셀 입력을 시작하고 입력창을 보이게 한다.
   * text를 주면 그 글자로 바꾸고 커서를 끝에 둔다. 안 주면 이미 친 글자(조합 중인 글자 포함)를 그대로 둔다.
   */
  start(address: CellAddress, mode: EditMode, text?: string): void {
    this.currentAddress = address;
    this.currentMode = mode;
    if (text !== undefined && !this.isComposing) {
      this.element.value = text;
      this.element.setSelectionRange(text.length, text.length);
    }
    this.element.style.opacity = "1";
    this.element.style.pointerEvents = "auto";
    this.fit();
  }

  /** 입력창 아래에 문제를 알리고 커서를 문제 위치에 둔다. 글자를 고치거나 입력을 끝내면 사라진다. */
  showProblem(message: string, position: number): void {
    this.problem.textContent = message;
    this.problem.hidden = false;
    const caret = Math.min(position, this.element.value.length);
    this.element.setSelectionRange(caret, caret);
  }

  /** 문제 알림이 떠 있으면 그 글자, 아니면 null */
  get problemMessage(): string | null {
    return this.problem.hidden ? null : this.problem.textContent;
  }

  /** 입력을 끝내고 입력창을 비운다. 입력 중이었으면 셀 주소와 입력한 글자를 돌려준다. */
  stop(): { address: CellAddress; text: string } | null {
    this.finishComposition();
    const address = this.currentAddress;
    const text = this.element.value;
    this.currentAddress = null;
    this.currentMode = null;
    this.element.value = "";
    this.problem.hidden = true;
    this.hide();
    this.fit();
    return address ? { address, text } : null;
  }

  /**
   * 조합 중인 글자를 확정한다. 마우스로 다른 셀을 누르면 포커스가 옮겨지지 않아 조합이 끝나지 않으므로,
   * 포커스를 잠깐 뺐다가 돌려서 브라우저가 조합을 확정하게 한다.
   */
  finishComposition(): void {
    if (!this.isComposing) return;
    const hadFocus = document.activeElement === this.element;
    this.element.blur();
    this.isComposing = false;
    if (hadFocus) this.focus();
  }

  /** 입력창을 address 셀 위에 놓는다. 화면 크기나 스크롤이 바뀔 때마다 부른다. */
  place(viewport: Viewport, address: CellAddress): void {
    const { layout } = this;
    const areaWidth = Math.max(viewport.width - layout.headerWidth, 0);
    const areaHeight = Math.max(viewport.height - layout.headerHeight, 0);
    this.frame.style.width = `${areaWidth}px`;
    this.frame.style.height = `${areaHeight}px`;

    // 테두리가 선택 테두리(셀 경계선 양쪽 1px)와 겹치도록 1px 바깥에 놓는다.
    const rect = cellRect(layout, viewport, address);
    const x = rect.x - layout.headerWidth - BORDER / 2;
    const y = rect.y - layout.headerHeight - BORDER / 2;
    this.element.style.transform = `translate(${x}px, ${y}px)`;
    this.problem.style.transform = `translate(${x}px, ${y + rect.height + BORDER + 2}px)`;
    this.element.style.height = `${rect.height + BORDER}px`;
    this.minWidth = rect.width + BORDER;
    this.maxWidth = Math.max(areaWidth - x, this.minWidth);
    this.fit();
  }

  /** 글자가 칸을 넘치면 화면 오른쪽 끝까지 입력창을 늘린다. (Excel과 같음) */
  private fit(): void {
    this.element.style.width = `${this.minWidth}px`;
    if (!this.currentMode) return;
    const overflow = this.element.scrollWidth - this.element.clientWidth;
    if (overflow > 0) {
      // 커서가 끝에서 잘리지 않게 한 칸 더 준다.
      this.element.style.width = `${Math.min(this.minWidth + overflow + CELL_PADDING, this.maxWidth)}px`;
    }
  }

  private hide(): void {
    // 투명하게만 두고 포커스와 위치는 그대로 둔다. 마우스는 아래 표로 지나가게 한다.
    this.element.style.opacity = "0";
    this.element.style.pointerEvents = "none";
  }
}
