import type { CellRange } from "./address";
import { navigate } from "./keyboard";
import {
  DEFAULT_LAYOUT,
  contentSize,
  isInHeader,
  pageRows,
  pointToCell,
  scrollToReveal,
  visibleRange,
  type GridLayout,
  type Viewport,
} from "./layout";
import { drawGrid } from "./render";
import { extendTo, sameSelection, selectCell, type Selection } from "./selection";
import type { Sheet } from "./sheet";

export interface GridViewOptions {
  layout?: GridLayout;
  /** 표 영역의 접근성 이름 (aria-label) */
  label?: string;
}

type SelectionListener = (selection: Selection) => void;

/**
 * 시트를 container 안에 Canvas로 그리고, 마우스·키보드로 셀을 선택하게 한다. React 없이 동작한다.
 *
 * 구조: Canvas는 화면 크기만 하고 보이는 칸만 그린다. 그 위에 투명한 스크롤 영역을 덮고,
 * 안에 표 전체 크기의 빈 div를 넣어 브라우저가 스크롤바·휠·관성 스크롤을 처리하게 한다.
 */
export class GridView {
  private readonly sheet: Sheet;
  private readonly layout: GridLayout;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly listeners = new Set<SelectionListener>();
  private currentSelection: Selection = selectCell({ row: 0, col: 0 });
  private frame = 0;
  /** 드래그로 범위를 고르는 중이면 그 포인터 id */
  private dragPointer: number | null = null;

  constructor(container: HTMLElement, sheet: Sheet, { layout = DEFAULT_LAYOUT, label = "시트" }: GridViewOptions = {}) {
    this.sheet = sheet;
    this.layout = layout;

    this.root = document.createElement("div");
    this.root.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";

    this.scroller = document.createElement("div");
    this.scroller.style.cssText = "position:absolute;inset:0;overflow:auto;outline:none;touch-action:pan-x pan-y";
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute("aria-label", label);

    const spacer = document.createElement("div");
    const size = contentSize(layout, sheet);
    spacer.style.cssText = `width:${size.width}px;height:${size.height}px`;

    this.scroller.append(spacer);
    this.root.append(this.canvas, this.scroller);
    container.append(this.root);

    this.scroller.addEventListener("scroll", this.requestRender);
    this.scroller.addEventListener("keydown", this.onKeyDown);
    this.scroller.addEventListener("pointerdown", this.onPointerDown);
    this.scroller.addEventListener("pointermove", this.onPointerMove);
    this.scroller.addEventListener("pointerup", this.onPointerUp);
    this.scroller.addEventListener("pointercancel", this.onPointerUp);
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

  /** 선택이 바뀔 때마다 listener를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onSelectionChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 키보드 입력을 받도록 표에 포커스를 준다. */
  focus(): void {
    this.scroller.focus({ preventScroll: true });
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
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

  /** 선택을 바꾸고, moved 셀이 보이게 스크롤한 뒤 다시 그린다. */
  private select(selection: Selection, moved: "anchor" | "focus"): void {
    const next = scrollToReveal(this.layout, this.viewport(), selection[moved]);
    this.scroller.scrollLeft = next.scrollLeft;
    this.scroller.scrollTop = next.scrollTop;
    if (sameSelection(selection, this.currentSelection)) return;
    this.currentSelection = selection;
    this.requestRender();
    for (const listener of this.listeners) listener(selection);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    const viewport = this.viewport();
    const result = navigate(this.currentSelection, event, {
      sheet: this.sheet,
      pageRows: pageRows(this.layout, viewport),
    });
    if (!result) return;
    event.preventDefault();
    // PageUp/PageDown은 활성 셀과 함께 화면도 한 페이지 넘긴다.
    this.scroller.scrollTop += result.scrollRows * this.layout.rowHeight;
    this.select(result.selection, event.shiftKey ? "focus" : "anchor");
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = this.localPoint(event);
    // 스크롤바를 누른 것은 브라우저에 맡긴다.
    if (point.x >= this.scroller.clientWidth || point.y >= this.scroller.clientHeight) return;
    event.preventDefault(); // 글자 선택이 끌려가지 않게
    this.focus();
    // 머리글 클릭(행·열 전체 선택)은 아직 없다.
    if (isInHeader(this.layout, point.x, point.y)) return;

    const cell = pointToCell(this.layout, this.viewport(), this.sheet, point.x, point.y);
    if (event.shiftKey) this.select(extendTo(this.currentSelection, cell), "focus");
    else this.select(selectCell(cell), "anchor");
    this.dragPointer = event.pointerId;
    this.scroller.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    const point = this.localPoint(event);
    const cell = pointToCell(this.layout, this.viewport(), this.sheet, point.x, point.y);
    this.select(extendTo(this.currentSelection, cell), "focus");
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.scroller.releasePointerCapture(event.pointerId);
  };

  /** 이벤트 좌표를 표 왼쪽 위 기준으로 바꾼다. */
  private localPoint(event: PointerEvent): { x: number; y: number } {
    const box = this.scroller.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
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
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawGrid(ctx, { sheet: this.sheet, selection: this.currentSelection, layout: this.layout, viewport });
  }
}
