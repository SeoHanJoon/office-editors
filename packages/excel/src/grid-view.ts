import type { History } from "@office/command-core";
import type { CellAddress, CellRange } from "./address";
import { CellEditor } from "./cell-editor";
import {
  copyText,
  fitsSheet,
  moveChanges,
  parseClipboardText,
  pasteArea,
  pasteCopyChanges,
  pasteTextChanges,
} from "./clipboard";
import { editAction, type EditMode } from "./edit-keys";
import type { FormulaEngine } from "./formula-engine";
import { findFormulaProblem } from "./formula-parser";
import { navigate } from "./keyboard";
import {
  DEFAULT_LAYOUT,
  contentSize,
  isInHeader,
  pageRows,
  pointToCell,
  pointToHeader,
  scrollToReveal,
  visibleRange,
  type GridLayout,
  type Viewport,
} from "./layout";
import { drawGrid } from "./render";
import {
  clampSelection,
  extendTo,
  sameSelection,
  selectCell,
  selectColumns,
  selectRange,
  selectRows,
  selectionRange,
  wholeLines,
  type Selection,
} from "./selection";
import { SetCellsCommand } from "./set-cells-command";
import type { CellChange, Sheet } from "./sheet";
import type { StructureChange } from "./structure";
import { StructureCommand } from "./structure-command";

export interface GridViewOptions {
  /** 셀에 보여줄 계산값. 앱이 같은 sheet로 만들어 넘긴다. (ADR 0016의 History와 같은 방식) */
  engine: FormulaEngine;
  layout?: GridLayout;
  /** 표 영역의 접근성 이름 (aria-label) */
  label?: string;
}

type SelectionListener = (selection: Selection) => void;

/** 이 화면에서 복사하거나 잘라낸 범위. 클립보드에 넣은 글자와 함께 기억한다. */
interface Copied {
  readonly range: CellRange;
  readonly text: string;
  readonly cut: boolean;
}

/** 클립보드를 거치며 줄바꿈 모양이나 끝 줄바꿈이 바뀌어도 같은 글자로 본다. */
function sameClipboardText(a: string, b: string): boolean {
  const normalize = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return normalize(a) === normalize(b);
}

/**
 * 시트를 container 안에 Canvas로 그리고, 마우스·키보드로 셀을 고르고 값을 입력하게 한다. React 없이 동작한다.
 *
 * 구조: Canvas는 화면 크기만 하고 보이는 칸만 그린다. 그 위에 투명한 스크롤 영역을 덮고,
 * 안에 표 전체 크기의 빈 div를 넣어 브라우저가 스크롤바·휠·관성 스크롤을 처리하게 한다.
 * 키보드 입력은 활성 셀 위에 늘 떠 있는 입력창(CellEditor)이 받는다.
 *
 * 셀 값은 모두 SetCellsCommand로 history에 넣어 바꾼다. undo/redo로 값이 바뀌면 그 셀들을 선택한다.
 * 셀에는 engine의 계산값을 그리고(계산 중인 칸은 회색 "…"), 입력창에는 입력한 글자(수식)를 그대로 보여준다.
 *
 * 행·열 머리글을 누르면 줄 전체를 고르고, Ctrl+Shift+= / Ctrl+-로 고른 행·열을 넣고 지운다. (StructureCommand)
 *
 * 복사/잘라내기/붙여넣기는 입력창의 copy·cut·paste 이벤트로 받는다. 클립보드에는 Excel과 같은 text/plain(보이는 값)을 넣고,
 * 복사한 범위를 기억해 두었다가 붙여넣을 글자가 그때 넣은 글자와 같으면 수식째 붙인다. (Excel과 같은 방식)
 */
export class GridView {
  private readonly sheet: Sheet;
  private readonly engine: FormulaEngine;
  private readonly history: History;
  private readonly layout: GridLayout;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLDivElement;
  /** 표 전체 크기의 빈 div. 브라우저가 이 크기로 스크롤바를 만든다. 행·열을 넣고 빼면 크기를 바꾼다. */
  private readonly spacer: HTMLDivElement;
  private readonly editor: CellEditor;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeSheet: () => void;
  private readonly unsubscribeStructure: () => void;
  private readonly unsubscribeEngine: () => void;
  private readonly listeners = new Set<SelectionListener>();
  private currentSelection: Selection = selectCell({ row: 0, col: 0 });
  private frame = 0;
  /** 드래그로 범위를 고르는 중이면 그 포인터 id */
  private dragPointer: number | null = null;
  /** 드래그로 고르는 것: 셀 범위, 또는 머리글을 눌러 시작한 행·열 전체 */
  private dragKind: "cell" | "row" | "col" = "cell";
  /** 이 화면이 직접 편집을 실행하는 중인지. 그동안 온 시트 변경은 선택을 옮기지 않는다. */
  private applying = false;
  /** 복사하거나 잘라낸 범위. 다른 편집을 하거나 Esc를 누르면 지운다. */
  private copied: Copied | null = null;

  constructor(
    container: HTMLElement,
    sheet: Sheet,
    history: History,
    { engine, layout = DEFAULT_LAYOUT, label = "시트" }: GridViewOptions,
  ) {
    this.sheet = sheet;
    this.engine = engine;
    this.history = history;
    this.layout = layout;

    this.root = document.createElement("div");
    // clip은 스크롤 영역을 만들지 않아서 브라우저가 입력창을 보이게 하려고 root를 스크롤하지 않는다.
    this.root.style.cssText = "position:relative;width:100%;height:100%;overflow:clip";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";

    this.scroller = document.createElement("div");
    this.scroller.style.cssText = "position:absolute;inset:0;overflow:auto;outline:none;touch-action:pan-x pan-y";
    // 스크롤바를 눌러도 포커스가 문서로 빠지지 않게 포커스를 받을 수 있게 하고, 받으면 입력창으로 돌려준다.
    this.scroller.tabIndex = -1;
    this.scroller.setAttribute("aria-label", label);

    this.spacer = document.createElement("div");
    this.resizeSpacer();

    this.scroller.append(this.spacer);
    this.root.append(this.canvas, this.scroller);
    this.editor = new CellEditor(this.root, layout);
    container.append(this.root);

    this.scroller.addEventListener("scroll", this.requestRender);
    this.scroller.addEventListener("focus", () => this.focus());
    this.scroller.addEventListener("pointerdown", this.onPointerDown);
    this.scroller.addEventListener("pointermove", this.onPointerMove);
    this.scroller.addEventListener("pointerup", this.onPointerUp);
    this.scroller.addEventListener("pointercancel", this.onPointerUp);
    this.scroller.addEventListener("dblclick", this.onDoubleClick);
    const input = this.editor.element;
    input.addEventListener("keydown", this.onKeyDown);
    input.addEventListener("beforeinput", this.onBeforeInput);
    input.addEventListener("input", this.onInput);
    input.addEventListener("compositionstart", this.onCompositionStart);
    input.addEventListener("copy", this.onCopy);
    input.addEventListener("cut", this.onCut);
    input.addEventListener("paste", this.onPaste);
    this.unsubscribeSheet = sheet.onChange(this.onSheetChange);
    this.unsubscribeStructure = sheet.onStructureChange(this.onStructureChange);
    // 나눠서 계산하는 엔진(ADR 0024)은 시트가 그대로여도 계산값이 채워지므로 엔진 변경도 듣는다.
    this.unsubscribeEngine = engine.onChange(this.requestRender);
    this.resizeObserver = new ResizeObserver(this.requestRender);
    this.resizeObserver.observe(this.scroller);
    this.render();
  }

  get selection(): Selection {
    return this.currentSelection;
  }

  /** 지금 화면에 조금이라도 보이는 셀 범위 */
  get visibleRange(): CellRange {
    return visibleRange(this.layout, this.viewport(), this.sheet);
  }

  /** 셀에 값을 입력하는 중이면 그 상태, 아니면 null */
  get editMode(): EditMode | null {
    return this.editor.mode;
  }

  /** 확정하지 못한 입력(틀린 수식)을 알리는 중이면 그 글자, 아니면 null */
  get problem(): string | null {
    return this.editor.problemMessage;
  }

  /** 선택이 바뀔 때마다 listener를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onSelectionChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 키보드 입력을 받도록 표에 포커스를 준다. */
  focus(): void {
    this.editor.focus();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.unsubscribeSheet();
    this.unsubscribeStructure();
    this.unsubscribeEngine();
    this.listeners.clear();
    this.root.remove();
  }

  private viewport(): Viewport {
    return {
      scrollLeft: this.scroller.scrollLeft,
      scrollTop: this.scroller.scrollTop,
      // 스크롤바를 뺀 크기
      width: this.scroller.clientWidth,
      height: this.scroller.clientHeight,
    };
  }

  /** 선택을 바꾸고, reveal 셀이 보이게 스크롤한 뒤 다시 그린다. ("none"이면 스크롤하지 않는다) */
  private select(selection: Selection, reveal: "active" | "focus" | "none"): void {
    if (reveal !== "none") this.reveal(selection[reveal]);
    if (sameSelection(selection, this.currentSelection)) return;
    this.currentSelection = selection;
    // 한글 조합 창이 새 활성 셀 옆에 뜨도록 입력창은 다음 프레임을 기다리지 않고 옮긴다.
    this.placeEditor();
    this.requestRender();
    for (const listener of this.listeners) listener(selection);
  }

  private reveal(address: CellAddress): void {
    const next = scrollToReveal(this.layout, this.viewport(), address);
    this.scroller.scrollLeft = next.scrollLeft;
    this.scroller.scrollTop = next.scrollTop;
  }

  /** 복사한 범위가 있으면 그 범위("A1:B3"), 없으면 null */
  get copiedRange(): CellRange | null {
    return this.copied?.range ?? null;
  }

  /**
   * 편집 한 번을 실행하고 기록한다.
   * 복사한 범위 표시는 지운다. (Excel처럼 다른 편집을 하면 복사 상태가 풀린다) 복사한 것을 붙여넣을 때만 keepCopied로 남긴다.
   */
  private apply(changes: readonly CellChange[], keepCopied = false): void {
    if (!keepCopied) this.clearCopied();
    if (changes.length === 0) return;
    this.applying = true;
    try {
      this.history.execute(new SetCellsCommand(this.sheet, changes));
    } finally {
      this.applying = false;
    }
  }

  /** 활성 셀 입력을 시작한다. text를 안 주면 입력창에 이미 들어간 글자(조합 중인 글자 포함)를 그대로 쓴다. */
  private startEditing(mode: EditMode, text?: string): void {
    const address = this.currentSelection.active;
    this.reveal(address);
    this.editor.start(address, mode, text);
    this.placeEditor();
    this.requestRender();
  }

  /**
   * 입력을 확정한다. 값이 그대로면 기록하지 않는다.
   * 문법이 틀린 수식이면 Excel처럼 확정하지 않고 입력을 이어가게 한 뒤 false를 돌려준다.
   */
  private commit(): boolean {
    if (this.editor.mode) {
      this.editor.finishComposition();
      const problem = findFormulaProblem(this.editor.text);
      if (problem) {
        this.editor.showProblem(`수식에 문제가 있습니다. ${problem.message}`, problem.position);
        return false;
      }
    }
    const edit = this.editor.stop();
    if (edit && edit.text !== this.sheet.get(edit.address)) {
      this.apply([{ address: edit.address, value: edit.text }]);
    }
    return true;
  }

  /** 선택 범위에서 값이 있는 셀을 모두 비운다. (Delete) */
  private clearSelection(): void {
    const { top, left, bottom, right } = selectionRange(this.currentSelection);
    const changes: CellChange[] = [];
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        if (this.sheet.has({ row, col })) changes.push({ address: { row, col }, value: "" });
      }
    }
    this.apply(changes);
  }

  private resizeSpacer(): void {
    const size = contentSize(this.layout, this.sheet);
    this.spacer.style.cssText = `width:${size.width}px;height:${size.height}px`;
  }

  /**
   * 고른 행·열 전체 앞에 같은 수만큼 넣거나(insert) 고른 행·열을 지운다(delete).
   * 행 전체나 열 전체를 고르지 않았으면 아무것도 하지 않는다. (Excel은 셀을 밀지 묻는 대화상자를 띄운다)
   * 시트가 비거나 최대 크기를 넘게 되면 하지 않는다.
   * 선택은 같은 자리에 둔다. 넣었으면 새 빈 줄이, 지웠으면 당겨 올라온 줄이 선택된다. (Excel과 같음)
   */
  private changeLines(kind: StructureChange["kind"]): void {
    const range = selectionRange(this.currentSelection);
    const axis = wholeLines(range, this.sheet);
    if (!axis) return;
    const index = axis === "row" ? range.top : range.left;
    const count = axis === "row" ? range.bottom - range.top + 1 : range.right - range.left + 1;
    const size = axis === "row" ? this.sheet.rowCount : this.sheet.colCount;
    if (kind === "delete" && count >= size) return;
    this.clearCopied();
    this.applying = true;
    try {
      this.history.execute(new StructureCommand(this.sheet, { kind, axis, index, count }));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error; // 최대 크기(1,048,576행 × 16,384열)를 넘음
    } finally {
      this.applying = false;
    }
  }

  /**
   * 행·열이 들어가거나 빠지면 스크롤 크기를 바꾸고 다시 그린다. 복사 표시는 지운다.
   * 이 화면이 한 변경이면 선택을 시트 안으로만 줄이고, undo/redo면 들어가거나 빠진 줄을 고른다.
   */
  private readonly onStructureChange = (change: StructureChange): void => {
    this.resizeSpacer();
    this.clearCopied();
    let selection = clampSelection(this.currentSelection, this.sheet);
    if (!this.applying) {
      const size = change.axis === "row" ? this.sheet.rowCount : this.sheet.colCount;
      const first = Math.min(change.index, size - 1);
      const last = change.kind === "insert" ? change.index + change.count - 1 : first;
      selection = change.axis === "row" ? selectRows(first, last, this.sheet) : selectColumns(first, last, this.sheet);
    }
    this.select(selection, "active");
    this.requestRender();
  };

  private clearCopied(): void {
    if (!this.copied) return;
    this.copied = null;
    this.requestRender();
  }

  /** 입력 중이 아니면 선택 범위의 보이는 값을 클립보드에 넣고 범위를 기억한다. 입력 중이면 입력창 글자 복사(브라우저 기본) */
  private copy(event: ClipboardEvent, cut: boolean): void {
    if (this.editor.mode || !event.clipboardData) return;
    event.preventDefault();
    const range = selectionRange(this.currentSelection);
    const text = copyText(this.sheet, this.engine, range);
    event.clipboardData.setData("text/plain", text);
    this.copied = { range, text, cut };
    this.requestRender();
  }

  private readonly onCopy = (event: ClipboardEvent): void => this.copy(event, false);

  private readonly onCut = (event: ClipboardEvent): void => this.copy(event, true);

  /** 입력 중이 아니면 선택한 곳에 붙여넣는다. 입력 중이면 입력창에 글자로 붙인다. (브라우저 기본) */
  private readonly onPaste = (event: ClipboardEvent): void => {
    if (this.editor.mode || !event.clipboardData) return;
    event.preventDefault();
    this.paste(event.clipboardData.getData("text/plain"));
  };

  /**
   * 클립보드 글자를 선택한 곳에 붙여넣고, 붙인 범위를 선택한다. 붙일 범위가 시트 밖으로 넘치면 아무것도 하지 않는다. (Excel은 알림을 띄운다)
   * - 이 화면에서 복사한 글자면: 수식째 붙이고 상대 참조를 옮긴다. 복사 표시는 남아서 여러 번 붙일 수 있다.
   * - 이 화면에서 잘라낸 글자면: 셀을 옮기고 그 셀을 가리키던 참조를 고친다. 한 번만 붙일 수 있다.
   * - 아니면(다른 프로그램, 새로고침 전 복사): 칸마다 글자를 입력한 것처럼 넣는다. `=`로 시작하면 수식이다.
   */
  private paste(text: string): void {
    const selected = selectionRange(this.currentSelection);
    const copied = this.copied && sameClipboardText(text, this.copied.text) ? this.copied : null;
    let target: CellRange;
    if (copied?.cut) {
      const { range } = copied;
      target = {
        top: selected.top,
        left: selected.left,
        bottom: selected.top + range.bottom - range.top,
        right: selected.left + range.right - range.left,
      };
      if (!fitsSheet(this.sheet, target)) return;
      this.apply(moveChanges(this.sheet, range, target.top, target.left));
    } else if (copied) {
      const { range } = copied;
      target = pasteArea(selected, range.bottom - range.top + 1, range.right - range.left + 1);
      if (!fitsSheet(this.sheet, target)) return;
      this.apply(pasteCopyChanges(this.sheet, range, target), true);
    } else {
      if (text === "") return;
      const values = parseClipboardText(text);
      target = pasteArea(selected, values.length, values[0]!.length);
      if (!fitsSheet(this.sheet, target)) return;
      this.apply(pasteTextChanges(values, target));
    }
    this.select(selectRange(target), "active");
  }

  /** undo/redo 등 이 화면 밖에서 값이 바뀌면 바뀐 셀들을 선택한다. (Excel과 같음) */
  private readonly onSheetChange = (addresses: readonly CellAddress[]): void => {
    this.requestRender();
    if (this.applying || addresses.length === 0) return;
    this.clearCopied();
    let { row: top, col: left } = addresses[0]!;
    let bottom = top;
    let right = left;
    for (const { row, col } of addresses) {
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
      left = Math.min(left, col);
      right = Math.max(right, col);
    }
    this.select(selectRange({ top, left, bottom, right }), "active");
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // 한글 조합 중인 키(조합을 끝내는 Enter 포함)는 입력기에 맡긴다. 조합이 끝난 뒤 오는 키로 처리한다.
    if (event.isComposing || this.editor.composing) return;
    const action = editAction(event, this.editor.mode);
    if (!action) return;

    switch (action) {
      case "navigate":
        this.navigate(event);
        return;
      case "commit":
        event.preventDefault();
        if (this.commit()) this.navigate(event);
        return;
      case "undo":
        event.preventDefault();
        this.history.undo();
        return;
      case "redo":
        event.preventDefault();
        this.history.redo();
        return;
      case "clear":
        event.preventDefault();
        this.clearSelection();
        return;
      case "clearAndEnter":
        event.preventDefault();
        this.startEditing("enter", "");
        return;
      case "edit":
        event.preventDefault();
        this.startEditing("edit", this.sheet.get(this.currentSelection.active));
        return;
      case "toggleMode":
        event.preventDefault();
        this.editor.mode = this.editor.mode === "enter" ? "edit" : "enter";
        return;
      case "insertLines":
      case "deleteLines":
        event.preventDefault(); // 브라우저 확대·축소 단축키와 겹친다.
        this.changeLines(action === "insertLines" ? "insert" : "delete");
        return;
      case "cancel":
        event.preventDefault();
        if (this.editor.mode) this.editor.stop();
        else this.clearCopied();
        this.requestRender();
        return;
      case "block":
        event.preventDefault();
        return;
    }
  };

  /** 이동 키면 선택을 옮긴다. 아니면 그대로 두어 입력창에 글자가 들어가게 한다. */
  private navigate(event: KeyboardEvent): void {
    const result = navigate(this.currentSelection, event, {
      sheet: this.sheet,
      pageRows: pageRows(this.layout, this.viewport()),
    });
    if (!result) return;
    event.preventDefault();
    // PageUp/PageDown은 활성 셀과 함께 화면도 한 페이지 넘긴다.
    this.scroller.scrollTop += result.scrollRows * this.layout.rowHeight;
    const extendsRange = event.shiftKey && event.key !== "Tab" && event.key !== "Enter";
    this.select(result.selection, extendsRange ? "focus" : "active");
  }

  /** 입력 중이 아닐 때는 글자 입력만 받는다. (줄바꿈, 지우기 등은 막는다. 붙여넣기는 paste 이벤트에서 따로 처리한다) */
  private readonly onBeforeInput = (event: InputEvent): void => {
    if (this.editor.mode) return;
    if (event.inputType !== "insertText" && event.inputType !== "insertCompositionText") event.preventDefault();
  };

  /** 입력 중이 아닐 때 글자가 들어오면 "enter" 입력을 시작한다. */
  private readonly onInput = (): void => {
    if (!this.editor.mode && this.editor.text !== "") this.startEditing("enter");
  };

  /** 한글 조합이 시작되면 입력창을 보이게만 한다. 조합 중인 글자는 건드리지 않는다. */
  private readonly onCompositionStart = (): void => {
    if (!this.editor.mode) this.startEditing("enter");
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = this.localPoint(event);
    // 스크롤바를 누른 것은 브라우저에 맡긴다.
    if (point.x >= this.scroller.clientWidth || point.y >= this.scroller.clientHeight) return;
    event.preventDefault(); // 글자 선택이 끌려가거나 포커스가 입력창에서 빠지지 않게
    // 다른 셀을 누르면 입력을 확정한다. 확정할 수 없으면 선택을 옮기지 않는다. (Excel과 같음)
    const committed = this.commit();
    this.focus();
    if (!committed) return;

    const header = pointToHeader(this.layout, this.viewport(), this.sheet, point.x, point.y);
    if (header) {
      // 행 번호·열 이름을 누르면 줄 전체를 고른다. Shift를 누르면 고른 줄(anchor)부터 누른 줄까지다.
      const { anchor } = this.currentSelection;
      const from = event.shiftKey ? (header.axis === "row" ? anchor.row : anchor.col) : header.index;
      this.dragKind = header.axis;
      this.selectLines(from, header.index);
    } else {
      // 왼쪽 위 모서리(시트 전체 선택)는 아직 없다.
      if (isInHeader(this.layout, point.x, point.y)) return;
      const cell = pointToCell(this.layout, this.viewport(), this.sheet, point.x, point.y);
      this.dragKind = "cell";
      if (event.shiftKey) this.select(extendTo(this.currentSelection, cell), "focus");
      else this.select(selectCell(cell), "active");
    }
    this.dragPointer = event.pointerId;
    this.scroller.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    const point = this.localPoint(event);
    const cell = pointToCell(this.layout, this.viewport(), this.sheet, point.x, point.y);
    const { anchor } = this.currentSelection;
    if (this.dragKind === "cell") this.select(extendTo(this.currentSelection, cell), "focus");
    else if (this.dragKind === "row") this.selectLines(anchor.row, cell.row);
    else this.selectLines(anchor.col, cell.col);
  };

  /** dragKind 축으로 from줄부터 to줄까지 전체를 고른다. to줄이 보이게 그 축으로만 스크롤한다. (가로로 스크롤한 채 행 번호를 눌러도 A열로 가지 않게) */
  private selectLines(from: number, to: number): void {
    const next = scrollToReveal(this.layout, this.viewport(), { row: to, col: to });
    if (this.dragKind === "row") {
      this.scroller.scrollTop = next.scrollTop;
      this.select(selectRows(from, to, this.sheet), "none");
    } else {
      this.scroller.scrollLeft = next.scrollLeft;
      this.select(selectColumns(from, to, this.sheet), "none");
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.scroller.releasePointerCapture(event.pointerId);
  };

  /** 셀을 더블클릭하면 기존 값을 고치는 "edit" 입력을 시작한다. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const point = this.localPoint(event);
    if (isInHeader(this.layout, point.x, point.y)) return;
    this.startEditing("edit", this.sheet.get(this.currentSelection.active));
  };

  /** 이벤트 좌표를 표 왼쪽 위 기준으로 바꾼다. */
  private localPoint(event: MouseEvent): { x: number; y: number } {
    const box = this.scroller.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** 입력 중이면 그 셀 위에, 아니면 활성 셀 위에 입력창을 놓는다. */
  private placeEditor(viewport = this.viewport()): void {
    this.editor.place(viewport, this.editor.address ?? this.currentSelection.active);
  }

  private readonly requestRender = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  private render(): void {
    const viewport = this.viewport();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(viewport.width * ratio);
    const height = Math.round(viewport.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = `${viewport.width}px`;
      this.canvas.style.height = `${viewport.height}px`;
    }
    this.placeEditor(viewport);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawGrid(ctx, {
      sheet: this.sheet,
      engine: this.engine,
      selection: this.currentSelection,
      copied: this.copied?.range ?? null,
      layout: this.layout,
      viewport,
    });
  }
}
