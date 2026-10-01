import type { History } from "@office/command-core";
import { ContextMenu } from "@office/ui";
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
import { formatValue } from "./formula-value";
import { gridMenu, type GridMenuCommand, type GridMenuTarget } from "./grid-menu";
import { navigate } from "./keyboard";
import {
  DEFAULT_LAYOUT,
  cellRect,
  contentSize,
  gridGeometry,
  isInHeader,
  pageRows,
  pointToCell,
  pointToHeader,
  scrollToReveal,
  visibleRange,
  type GridGeometry,
  type GridLayout,
  type Viewport,
} from "./layout";
import { CELL_FONT, CELL_PADDING, THEME, drawGrid } from "./render";
import { draggedSize, fitColumnWidth, pointToResizeHandle, resizeLines, type ResizeHandle } from "./resize";
import {
  clampSelection,
  expandToLines,
  extendTo,
  focusToReveal,
  sameAddress,
  sameSelection,
  selectAll,
  selectCell,
  selectColumns,
  selectRange,
  selectRows,
  selectionRange,
  wholeLines,
  type Selection,
} from "./selection";
import { SetCellsCommand } from "./set-cells-command";
import { SetLineSizesCommand } from "./set-line-sizes-command";
import type { Axis, CellChange, LineSizeChange, Sheet } from "./sheet";
import { canChangeStructure, type StructureChange } from "./structure";
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

/** 머리글 경계선을 끌어 줄 크기를 바꾸는 중인 상태 */
interface Resizing {
  readonly pointer: number;
  readonly handle: ResizeHandle;
  /** 함께 바꿀 줄 [first, last] */
  readonly first: number;
  readonly last: number;
  /** 누른 자리 (열은 clientX, 행은 clientY) */
  readonly origin: number;
  readonly startSize: number;
  size: number;
}

/** Mac이면 단축키를 ⌘로 보여주고, Ctrl+클릭을 오른쪽 클릭으로 본다. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

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
 * 행·열 머리글을 누르면 줄 전체를, 왼쪽 위 모서리를 누르면 시트 전체를 고른다. Ctrl+Shift+= / Ctrl+-로 고른 행·열을 넣고 지운다. (StructureCommand)
 *
 * 복사/잘라내기/붙여넣기는 입력창의 copy·cut·paste 이벤트로 받는다. 클립보드에는 Excel과 같은 text/plain(보이는 값)을 넣고,
 * 복사한 범위를 기억해 두었다가 붙여넣을 글자가 그때 넣은 글자와 같으면 수식째 붙인다. (Excel과 같은 방식)
 *
 * 오른쪽 클릭, Shift+F10, 메뉴 키로 메뉴(@office/ui의 ContextMenu)를 연다. 메뉴의 복사·붙여넣기는 Clipboard API를 쓴다. (ADR 0029)
 *
 * 머리글 경계선을 끌면 줄 크기를, 두 번 누르면 내용에 맞춘 크기를 SetLineSizesCommand로 바꾼다. 줄 크기는 Sheet에 있다. (ADR 0031)
 */
export class GridView {
  private readonly sheet: Sheet;
  private readonly engine: FormulaEngine;
  private readonly history: History;
  private readonly layout: GridLayout;
  /** 머리글과 줄마다의 크기. 행·열 수나 줄 크기가 바뀌면 새로 만든다. */
  private geometry: GridGeometry;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLDivElement;
  /** 표 전체 크기의 빈 div. 브라우저가 이 크기로 스크롤바를 만든다. 행·열을 넣고 빼면 크기를 바꾼다. */
  private readonly spacer: HTMLDivElement;
  private readonly editor: CellEditor;
  /** 클립보드 읽기가 막혔을 때 등 잠깐 띄우는 알림 */
  private readonly notice: HTMLDivElement;
  private noticeTimer = 0;
  /** 열려 있는 오른쪽 클릭 메뉴 */
  private menu: ContextMenu<GridMenuCommand> | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeSheet: () => void;
  private readonly unsubscribeStructure: () => void;
  private readonly unsubscribeSizes: () => void;
  private readonly unsubscribeEngine: () => void;
  private readonly listeners = new Set<SelectionListener>();
  private currentSelection: Selection = selectCell({ row: 0, col: 0 });
  private frame = 0;
  /** 드래그로 범위를 고르는 중이면 그 포인터 id */
  private dragPointer: number | null = null;
  /** 경계선을 끌어 크기를 바꾸는 중이면 그 상태 */
  private resizing: Resizing | null = null;
  /** 글자 너비를 재는 데 쓰는 캔버스 (열 너비 자동 맞춤) */
  private measureContext: CanvasRenderingContext2D | null = null;
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
    this.geometry = gridGeometry(layout, sheet, sheet.lineSizes("row"), sheet.lineSizes("col"));

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
    this.updateGeometry();

    this.scroller.append(this.spacer);
    this.root.append(this.canvas, this.scroller);
    this.editor = new CellEditor(this.root, layout);
    this.notice = document.createElement("div");
    this.notice.setAttribute("role", "status");
    this.notice.style.cssText = [
      `position:absolute;left:50%;top:${layout.headerHeight + 8}px;transform:translateX(-50%);max-width:90%`,
      "padding:6px 12px;border-radius:4px;background:#323232;color:#ffffff;pointer-events:none",
      `font:${CELL_FONT};box-shadow:0 2px 6px rgba(0,0,0,0.2)`,
    ].join(";");
    this.notice.hidden = true;
    this.root.append(this.notice);
    container.append(this.root);

    this.scroller.addEventListener("scroll", this.requestRender);
    this.scroller.addEventListener("focus", () => this.focus());
    this.scroller.addEventListener("pointerdown", this.onPointerDown);
    this.scroller.addEventListener("pointermove", this.onPointerMove);
    this.scroller.addEventListener("pointerup", this.onPointerUp);
    this.scroller.addEventListener("pointercancel", this.onPointerUp);
    this.scroller.addEventListener("dblclick", this.onDoubleClick);
    this.scroller.addEventListener("contextmenu", this.onContextMenu);
    const input = this.editor.element;
    input.addEventListener("keydown", this.onKeyDown);
    input.addEventListener("beforeinput", this.onBeforeInput);
    input.addEventListener("input", this.onInput);
    input.addEventListener("compositionstart", this.onCompositionStart);
    input.addEventListener("copy", this.onCopy);
    input.addEventListener("cut", this.onCut);
    input.addEventListener("paste", this.onPaste);
    input.addEventListener("contextmenu", this.onKeyboardContextMenu);
    this.unsubscribeSheet = sheet.onChange(this.onSheetChange);
    this.unsubscribeStructure = sheet.onStructureChange(this.onStructureChange);
    this.unsubscribeSizes = sheet.onLineSizeChange(this.onLineSizeChange);
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
    return visibleRange(this.geometry, this.viewport());
  }

  /** 화면에 그리는 줄 크기 (CSS px). 직접 바꾸지 않은 줄은 기본(행은 자동) 크기다. */
  lineSize(axis: Axis, index: number): number {
    return (axis === "row" ? this.geometry.rows : this.geometry.cols).size(index);
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
    clearTimeout(this.noticeTimer);
    this.menu?.close();
    this.resizeObserver.disconnect();
    this.unsubscribeSheet();
    this.unsubscribeStructure();
    this.unsubscribeSizes();
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

  /**
   * 선택을 바꾸고, reveal 셀이 보이게 스크롤한 뒤 다시 그린다. ("none"이면 스크롤하지 않는다)
   * "focus"는 줄 전체를 고른 채 늘릴 때 그 줄 방향으로는 스크롤하지 않는다. (focusToReveal)
   */
  private select(selection: Selection, reveal: "active" | "focus" | "none"): void {
    if (reveal === "active") this.reveal(selection.active);
    else if (reveal === "focus") this.reveal(focusToReveal(selection, this.sheet));
    if (sameSelection(selection, this.currentSelection)) return;
    this.currentSelection = selection;
    // 한글 조합 창이 새 활성 셀 옆에 뜨도록 입력창은 다음 프레임을 기다리지 않고 옮긴다.
    this.placeEditor();
    this.requestRender();
    for (const listener of this.listeners) listener(selection);
  }

  private reveal(address: CellAddress): void {
    const next = scrollToReveal(this.geometry, this.viewport(), address);
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

  /** 행·열 수나 줄 크기가 바뀌면 위치 계산을 새로 하고 스크롤 크기를 맞춘다. */
  private updateGeometry(): void {
    const { sheet } = this;
    this.geometry = gridGeometry(this.layout, sheet, sheet.lineSizes("row"), sheet.lineSizes("col"));
    const size = contentSize(this.geometry);
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
    this.changeStructure({ kind, axis, index, count });
  }

  /** 행·열을 넣거나 지운다. 시트가 비거나 최대 크기(1,048,576행 × 16,384열)를 넘게 되면 하지 않는다. 선택은 같은 자리에 둔다. */
  private changeStructure(change: StructureChange): void {
    if (!canChangeStructure(change, this.sheet)) return;
    this.clearCopied();
    this.applying = true;
    try {
      this.history.execute(new StructureCommand(this.sheet, change));
    } finally {
      this.applying = false;
    }
  }

  /**
   * 행·열이 들어가거나 빠지면 스크롤 크기를 바꾸고 다시 그린다. 복사 표시는 지운다.
   * 이 화면이 한 변경이면 선택을 시트 안으로만 줄이고, undo/redo면 들어가거나 빠진 줄을 고른다.
   */
  private readonly onStructureChange = (change: StructureChange): void => {
    this.updateGeometry();
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

  /** 경계선 위에서는 마우스 모양을 크기 조절 모양으로 바꾼다. */
  private updateCursor(event: PointerEvent): void {
    const point = this.localPoint(event);
    const handle = pointToResizeHandle(this.geometry, this.viewport(), point.x, point.y);
    const cursor = handle ? (handle.axis === "col" ? "col-resize" : "row-resize") : "";
    if (this.scroller.style.cursor !== cursor) this.scroller.style.cursor = cursor;
  }

  /** 경계선을 누르면 끌기를 시작한다. 선택은 그대로 두고, 끄는 동안은 안내선만 그린다. */
  private startResize(event: PointerEvent, handle: ResizeHandle): void {
    const { first, last } = resizeLines(handle, selectionRange(this.currentSelection), this.sheet);
    const startSize = this.lineSize(handle.axis, handle.index);
    this.resizing = {
      pointer: event.pointerId,
      handle,
      first,
      last,
      origin: handle.axis === "col" ? event.clientX : event.clientY,
      startSize,
      size: startSize,
    };
    this.scroller.setPointerCapture(event.pointerId);
    this.requestRender();
  }

  private moveResize(event: PointerEvent): void {
    const resizing = this.resizing!;
    const delta = (resizing.handle.axis === "col" ? event.clientX : event.clientY) - resizing.origin;
    const size = draggedSize(resizing.startSize, delta);
    if (size === resizing.size) return;
    resizing.size = size;
    this.requestRender();
  }

  /** 손을 떼면 함께 바꿀 줄을 모두 끈 크기로 한 번에 바꾼다. (undo 한 번) 움직이지 않았거나 취소되면 그대로 둔다. */
  private finishResize(apply: boolean): void {
    const { handle, first, last, size, startSize } = this.resizing!;
    this.resizing = null;
    this.requestRender();
    if (!apply || size === startSize) return;
    const changes: LineSizeChange[] = [];
    for (let index = first; index <= last; index++) changes.push({ index, size });
    this.history.execute(new SetLineSizesCommand(this.sheet, handle.axis, changes));
  }

  /**
   * 경계선을 더블클릭하면 함께 바꿀 줄마다 내용에 맞춘다. (undo 한 번)
   * 열은 그 열의 모든 행에서 가장 넓은 글자에 맞추고(비어 있으면 기본 너비), 행은 직접 바꾼 높이를 지워 자동 높이로 돌린다. (ADR 0031)
   */
  private autoFit(handle: ResizeHandle): void {
    const { first, last } = resizeLines(handle, selectionRange(this.currentSelection), this.sheet);
    const changes: LineSizeChange[] = [];
    for (let index = first; index <= last; index++) {
      const size = handle.axis === "col" ? this.fitColumn(index) : null;
      if (size !== this.sheet.lineSize(handle.axis, index)) changes.push({ index, size });
    }
    if (changes.length > 0) this.history.execute(new SetLineSizesCommand(this.sheet, handle.axis, changes));
  }

  /** 열의 모든 행에 보이는 글자 중 가장 넓은 것에 맞춘 너비. 비어 있으면 null */
  private fitColumn(col: number): number | null {
    const { sheet, engine } = this;
    if (!this.measureContext) {
      this.measureContext = document.createElement("canvas").getContext("2d");
      if (!this.measureContext) return null;
    }
    const ctx = this.measureContext;
    ctx.font = THEME.font;
    return fitColumnWidth(
      sheet.rowCount,
      (row) => {
        const address = { row, col };
        const input = sheet.get(address);
        return input === "" ? null : [input, formatValue(engine.getValue(address))];
      },
      (text) => ctx.measureText(text).width,
      CELL_PADDING,
    );
  }

  /** 줄 크기가 바뀌면(undo/redo 포함) 위치를 다시 계산하고 다시 그린다. 선택은 그대로 둔다. */
  private readonly onLineSizeChange = (): void => {
    this.updateGeometry();
    this.placeEditor();
    this.requestRender();
  };

  private clearCopied(): void {
    if (!this.copied) return;
    this.copied = null;
    this.requestRender();
  }

  /** 선택 범위의 보이는 값을 클립보드에 넣을 글자로 만들고, 범위를 기억해 점선을 그린다. */
  private copySelection(cut: boolean): string {
    const range = selectionRange(this.currentSelection);
    const text = copyText(this.sheet, this.engine, range);
    this.copied = { range, text, cut };
    this.requestRender();
    return text;
  }

  /** 입력 중이 아니면 선택 범위의 보이는 값을 클립보드에 넣고 범위를 기억한다. 입력 중이면 입력창 글자 복사(브라우저 기본) */
  private copy(event: ClipboardEvent, cut: boolean): void {
    if (this.editor.mode || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", this.copySelection(cut));
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
      case "selectAll":
        event.preventDefault();
        this.select(selectAll(this.currentSelection, this.sheet), "none");
        return;
      case "selectRows":
      case "selectColumns":
        event.preventDefault(); // 입력창에 공백이 들어가 입력이 시작되지 않게
        this.select(expandToLines(this.currentSelection, action === "selectRows" ? "row" : "col", this.sheet), "none");
        return;
      case "openMenu":
        event.preventDefault();
        this.openMenuAtActive();
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
      pageRows: pageRows(this.geometry, this.viewport()),
    });
    if (!result) return;
    event.preventDefault();
    // PageUp/PageDown은 활성 셀과 함께 화면도 한 페이지 넘긴다. 맨 위에 걸친 행부터 그 행 수만큼의 높이다.
    if (result.scrollRows !== 0) {
      const { rows } = this.geometry;
      const top = rows.lineAt(this.scroller.scrollTop);
      const target = Math.min(Math.max(top + result.scrollRows, 0), rows.count);
      this.scroller.scrollTop += rows.offset(target) - rows.offset(top);
    }
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
    // Mac의 Ctrl+클릭은 오른쪽 클릭이다. contextmenu 이벤트에서 처리한다.
    if (event.button !== 0 || (MAC && event.ctrlKey)) return;
    const point = this.localPoint(event);
    // 스크롤바를 누른 것은 브라우저에 맡긴다.
    if (point.x >= this.scroller.clientWidth || point.y >= this.scroller.clientHeight) return;
    event.preventDefault(); // 글자 선택이 끌려가거나 포커스가 입력창에서 빠지지 않게
    // 다른 셀을 누르면 입력을 확정한다. 확정할 수 없으면 선택을 옮기지 않는다. (Excel과 같음)
    const committed = this.commit();
    this.focus();
    if (!committed) return;

    const handle = pointToResizeHandle(this.geometry, this.viewport(), point.x, point.y);
    if (handle) {
      this.startResize(event, handle);
      return;
    }
    const header = pointToHeader(this.geometry, this.viewport(), point.x, point.y);
    if (header) {
      // 행 번호·열 이름을 누르면 줄 전체를 고른다. Shift를 누르면 고른 줄(anchor)부터 누른 줄까지다.
      const { anchor } = this.currentSelection;
      const from = event.shiftKey ? (header.axis === "row" ? anchor.row : anchor.col) : header.index;
      this.dragKind = header.axis;
      this.selectLines(from, header.index);
    } else {
      if (isInHeader(this.geometry, point.x, point.y)) {
        // 왼쪽 위 모서리를 누르면 시트 전체를 고른다.
        this.select(selectAll(this.currentSelection, this.sheet), "none");
        return;
      }
      const cell = pointToCell(this.geometry, this.viewport(), point.x, point.y);
      this.dragKind = "cell";
      if (event.shiftKey) this.select(extendTo(this.currentSelection, cell), "focus");
      else this.select(selectCell(cell), "active");
    }
    this.dragPointer = event.pointerId;
    this.scroller.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.resizing) {
      if (event.pointerId === this.resizing.pointer) this.moveResize(event);
      return;
    }
    if (this.dragPointer === null) {
      this.updateCursor(event);
      return;
    }
    if (event.pointerId !== this.dragPointer) return;
    const point = this.localPoint(event);
    const cell = pointToCell(this.geometry, this.viewport(), point.x, point.y);
    const { anchor } = this.currentSelection;
    if (this.dragKind === "cell") this.select(extendTo(this.currentSelection, cell), "focus");
    else if (this.dragKind === "row") this.selectLines(anchor.row, cell.row);
    else this.selectLines(anchor.col, cell.col);
  };

  /** dragKind 축으로 from줄부터 to줄까지 전체를 고른다. to줄이 보이게 그 축으로만 스크롤한다. (가로로 스크롤한 채 행 번호를 눌러도 A열로 가지 않게) */
  private selectLines(from: number, to: number): void {
    const next = scrollToReveal(this.geometry, this.viewport(), { row: to, col: to });
    if (this.dragKind === "row") {
      this.scroller.scrollTop = next.scrollTop;
      this.select(selectRows(from, to, this.sheet), "none");
    } else {
      this.scroller.scrollLeft = next.scrollLeft;
      this.select(selectColumns(from, to, this.sheet), "none");
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.resizing?.pointer === event.pointerId) {
      this.finishResize(event.type === "pointerup");
      this.scroller.releasePointerCapture(event.pointerId);
      return;
    }
    if (event.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.scroller.releasePointerCapture(event.pointerId);
  };

  /** 셀을 더블클릭하면 기존 값을 고치는 "edit" 입력을 시작한다. 머리글 경계선을 더블클릭하면 내용에 맞게 크기를 맞춘다. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const point = this.localPoint(event);
    const handle = pointToResizeHandle(this.geometry, this.viewport(), point.x, point.y);
    if (handle) {
      this.autoFit(handle);
      return;
    }
    if (isInHeader(this.geometry, point.x, point.y)) return;
    this.startEditing("edit", this.sheet.get(this.currentSelection.active));
  };

  /**
   * 오른쪽 클릭하면 메뉴를 연다. 누른 곳이 선택 안이면 선택을 두고, 밖이면 그 셀·줄을 고른다. (Excel과 같음)
   * 입력 중인 셀을 누르면 브라우저 기본 메뉴를 쓰고, 다른 곳을 누르면 왼쪽 클릭처럼 먼저 입력을 확정한다.
   */
  private readonly onContextMenu = (event: MouseEvent): void => {
    const point = this.localPoint(event);
    // 스크롤바는 브라우저에 맡긴다.
    if (point.x >= this.scroller.clientWidth || point.y >= this.scroller.clientHeight) return;
    const viewport = this.viewport();
    const header = pointToHeader(this.geometry, viewport, point.x, point.y);
    const corner = !header && isInHeader(this.geometry, point.x, point.y);
    const cell = pointToCell(this.geometry, viewport, point.x, point.y);
    const editing = this.editor.address;
    if (editing && !header && !corner && sameAddress(cell, editing)) return;
    event.preventDefault();
    const committed = this.commit();
    this.focus();
    if (!committed) return;

    const range = selectionRange(this.currentSelection);
    let target: GridMenuTarget = "cell";
    if (header) {
      const { axis, index } = header;
      const inside =
        axis === "row"
          ? range.left === 0 && range.right === this.sheet.colCount - 1 && index >= range.top && index <= range.bottom
          : range.top === 0 && range.bottom === this.sheet.rowCount - 1 && index >= range.left && index <= range.right;
      if (!inside) this.select(axis === "row" ? selectRows(index, index, this.sheet) : selectColumns(index, index, this.sheet), "none");
      target = axis;
    } else if (corner) {
      this.select(selectAll(this.currentSelection, this.sheet), "none");
    } else {
      const inside = cell.row >= range.top && cell.row <= range.bottom && cell.col >= range.left && cell.col <= range.right;
      if (!inside) this.select(selectCell(cell), "none");
    }
    this.openMenu(target, event.clientX, event.clientY, false);
  };

  /**
   * 입력창에 온 contextmenu 이벤트. 입력창은 마우스를 받지 않으므로 키보드(메뉴 키, Windows의 Shift+F10)로 연 것이다.
   * keydown에서 이미 메뉴를 열었으면 브라우저 메뉴만 막는다. 입력 중이면 브라우저 기본 메뉴를 쓴다.
   */
  private readonly onKeyboardContextMenu = (event: MouseEvent): void => {
    if (this.editor.mode) return;
    event.preventDefault();
    if (!this.menu) this.openMenuAtActive();
  };

  /** 활성 셀 아래에 메뉴를 연다. 줄 전체를 골랐으면 그 줄의 메뉴다. 첫 항목을 가리킨 채 연다. */
  private openMenuAtActive(): void {
    const { active } = this.currentSelection;
    const target = wholeLines(selectionRange(this.currentSelection), this.sheet) ?? "cell";
    const { scrollLeft, scrollTop } = this.scroller;
    this.reveal(active);
    const open = () => {
      const rect = cellRect(this.geometry, this.viewport(), active);
      const box = this.scroller.getBoundingClientRect();
      this.openMenu(target, box.left + rect.x, box.top + rect.y + rect.height, true);
    };
    // 스크롤했으면 스크롤 이벤트가 지나간 뒤 연다. 메뉴는 스크롤하면 닫히기 때문이다.
    if (scrollLeft !== this.scroller.scrollLeft || scrollTop !== this.scroller.scrollTop) requestAnimationFrame(open);
    else open();
  }

  private openMenu(target: GridMenuTarget, x: number, y: number, keyboard: boolean): void {
    this.menu?.close();
    this.menu = new ContextMenu({
      items: gridMenu(target, selectionRange(this.currentSelection), this.sheet, { mac: MAC }),
      x,
      y,
      highlightFirst: keyboard,
      label: "셀 메뉴",
      onSelect: this.runMenuCommand,
      onClose: () => {
        this.menu = null;
        this.focus();
      },
    });
  }

  /** 메뉴에서 고른 동작을 한다. 동작마다 history에 한 번 들어가 undo 한 번에 되돌아간다. */
  private readonly runMenuCommand = (command: GridMenuCommand): void => {
    switch (command.type) {
      case "copy":
      case "cut":
        this.writeClipboard(command.type === "cut");
        return;
      case "paste":
        void this.pasteFromClipboard();
        return;
      case "clear":
        this.clearSelection();
        return;
      case "structure":
        this.changeStructure(command.change);
        return;
    }
  };

  /** 메뉴의 복사·잘라내기. 단축키와 같은 글자를 Clipboard API로 넣는다. 막히면 점선을 지우고 단축키를 쓰라고 알린다. */
  private writeClipboard(cut: boolean): void {
    const text = this.copySelection(cut);
    const fail = () => {
      this.clearCopied();
      this.showNotice(`브라우저가 클립보드 쓰기를 막았습니다. ${shortcut(cut ? "X" : "C")}를 쓰세요.`);
    };
    try {
      // Safari는 사용자가 누른 그 순간에 불러야 하므로 기다리지 않고 바로 부른다.
      navigator.clipboard.writeText(text).catch(fail);
    } catch {
      fail();
    }
  }

  /** 메뉴의 붙여넣기. Clipboard API로 읽어 단축키 붙여넣기와 같은 방법으로 붙인다. 막히면 아무것도 바꾸지 않고 알린다. */
  private async pasteFromClipboard(): Promise<void> {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      this.showNotice(`브라우저가 클립보드 읽기를 막았습니다. ${shortcut("V")}를 쓰세요.`);
      return;
    }
    // 권한을 묻는 동안 입력을 시작했으면 붙이지 않는다.
    if (this.editor.mode) return;
    this.paste(text);
  }

  /** 표 위쪽에 알림을 잠깐 띄운다. */
  private showNotice(message: string): void {
    this.notice.textContent = message;
    this.notice.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice.hidden = true), 5000);
  }

  /** 이벤트 좌표를 표 왼쪽 위 기준으로 바꾼다. */
  private localPoint(event: MouseEvent): { x: number; y: number } {
    const box = this.scroller.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** 입력 중이면 그 셀 위에, 아니면 활성 셀 위에 입력창을 놓는다. */
  private placeEditor(viewport = this.viewport()): void {
    this.editor.place(this.geometry, viewport, this.editor.address ?? this.currentSelection.active);
  }

  private readonly requestRender = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  /** 끄는 중인 경계선의 새 자리 (캔버스 좌표) */
  private resizeGuide(): { axis: Axis; position: number } | null {
    if (!this.resizing) return null;
    const { handle, size } = this.resizing;
    const { geometry } = this;
    const position =
      handle.axis === "col"
        ? geometry.headerWidth + geometry.cols.offset(handle.index) - this.scroller.scrollLeft + size
        : geometry.headerHeight + geometry.rows.offset(handle.index) - this.scroller.scrollTop + size;
    return { axis: handle.axis, position };
  }

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
      guide: this.resizeGuide(),
      geometry: this.geometry,
      viewport,
    });
  }
}

/** 글자 단축키를 이 기기에 맞게 쓴다. ("⌘V", "Ctrl+V") */
function shortcut(letter: string): string {
  return MAC ? `⌘${letter}` : `Ctrl+${letter}`;
}
