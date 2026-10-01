"use client";

import { History } from "@office/command-core";
import {
  DEFAULT_FORMAT,
  FormulaEngine,
  GridView,
  formatCellValue,
  parseA1,
  rangeToA1,
  selectionRange,
  toA1,
  type CellAddress,
  type CellFormat,
  type EditMode,
} from "@office/excel";
import { useEffect, useRef, useState } from "react";
import { ExcelToolbar } from "./excel-toolbar";
import { FormulaBar } from "./formula-bar";
import { createSampleSheet } from "./sample-data";

/** 브라우저 테스트가 Canvas 대신 읽는 표 상태. 개발 서버에서만 window.__excel로 노출한다. */
export interface ExcelTestHandle {
  state(): {
    /** 활성 셀 ("B3") */
    active: string;
    /** 선택 범위 ("B3:D5", 셀 하나면 "B3") */
    selection: string;
    /** 화면에 보이는 범위 ("A1:T40") */
    visible: string;
    /** 셀 입력 중이면 "enter"(글자를 쳐서 시작) 또는 "edit"(F2·더블클릭으로 시작), 아니면 null */
    editing: EditMode | null;
    /** 틀린 수식이라 확정하지 못했다는 알림이 떠 있으면 그 글자, 아니면 null */
    problem: string | null;
    /** 처음 열 때 수식을 나눠서 계산하는 중인지 (ADR 0024) */
    calculating: boolean;
    /** 복사하거나 잘라내서 점선이 그려진 범위 ("A1:C2"), 없으면 null */
    copied: string | null;
    /** 시트 크기 */
    rowCount: number;
    colCount: number;
  };
  /** 셀("B3")에 입력된 글자. 수식이면 "=A1+1"처럼 수식 그대로. 빈 셀이면 "" */
  cell(a1: string): string;
  /** 셀("B3")에 보이는 글자 (계산값에 숫자 형식을 적용한 것). 빈 셀이면 "" */
  value(a1: string): string;
  /** 셀("B3")에 보이는 서식. 기본 서식이면 {} */
  format(a1: string): CellFormat;
  /** 화면에 그리는 행 높이 (px). 행 번호는 화면과 같이 1부터 */
  rowHeight(row: number): number;
  /** 화면에 그리는 열 너비 (px). 열 이름("B")으로 */
  colWidth(column: string): number;
}

declare global {
  interface Window {
    __excel?: ExcelTestHandle;
  }
}

function address(a1: string): CellAddress {
  const result = parseA1(a1);
  if (!result) throw new Error(`셀 주소가 아니다: ${a1}`);
  return result;
}

/** 툴바·수식 입력줄이 보여 줄 표 상태 */
interface BarState {
  /** 활성 셀 주소 ("B3") */
  active: string;
  /** 수식 입력줄 글자: 입력 중이면 입력 중인 글자, 아니면 활성 셀에 입력된 글자 */
  text: string;
  editing: boolean;
  format: CellFormat;
  canUndo: boolean;
  canRedo: boolean;
}

const INITIAL_BAR: BarState = { active: "A1", text: "", editing: false, format: DEFAULT_FORMAT, canUndo: false, canRedo: false };

export function Spreadsheet() {
  const gridRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<History | null>(null);
  const [view, setView] = useState<GridView | null>(null);
  const [bar, setBar] = useState<BarState>(INITIAL_BAR);

  useEffect(() => {
    const sheet = createSampleSheet();
    // 10만 행의 수식을 한 번에 계산하면 화면이 1초 넘게 멈추므로, 표를 먼저 그리고 수식은 나눠서 계산한다.
    const engine = new FormulaEngine(sheet, { background: true });
    const history = new History();
    const view = new GridView(gridRef.current!, sheet, history, { engine });
    historyRef.current = history;
    // 선택, 입력, 값, 서식, undo 기록 중 무엇이 바뀌든 툴바와 수식 입력줄을 다시 읽는다.
    const refresh = () => {
      const { active } = view.selection;
      const edit = view.editState;
      setBar({
        active: toA1(active),
        text: edit ? edit.text : sheet.get(active),
        editing: edit !== null,
        format: view.activeFormat,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
      });
    };
    const unsubscribes = [
      view.onSelectionChange(refresh),
      view.onEditChange(refresh),
      sheet.onChange(refresh),
      sheet.onFormatChange(refresh),
      sheet.onStructureChange(refresh),
      history.onChange(refresh),
    ];
    refresh();
    setView(view);
    view.focus();
    if (process.env.NODE_ENV !== "production") {
      window.__excel = {
        state: () => ({
          active: toA1(view.selection.active),
          selection: rangeToA1(selectionRange(view.selection)),
          visible: rangeToA1(view.visibleRange),
          editing: view.editMode,
          problem: view.problem,
          calculating: engine.calculating,
          copied: view.copiedRange && rangeToA1(view.copiedRange),
          rowCount: sheet.rowCount,
          colCount: sheet.colCount,
        }),
        cell: (a1) => sheet.get(address(a1)),
        value: (a1) => formatCellValue(engine.getValue(address(a1)), sheet.format(address(a1))),
        format: (a1) => sheet.format(address(a1)),
        rowHeight: (row) => view.displayedSize("row", row - 1),
        colWidth: (column) => view.displayedSize("col", address(`${column}1`).col),
      };
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      view.destroy();
      engine.destroy();
      setView(null);
      historyRef.current = null;
      delete window.__excel;
    };
  }, []);

  const undoOrRedo = (redo: boolean) => {
    const history = historyRef.current;
    if (!history || !view) return;
    if (redo) history.redo();
    else history.undo();
    view.focus();
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", fontFamily: "sans-serif", fontSize: 13 }}>
      <ExcelToolbar
        view={view}
        format={bar.format}
        canUndo={bar.canUndo}
        canRedo={bar.canRedo}
        editing={bar.editing}
        onUndo={() => undoOrRedo(false)}
        onRedo={() => undoOrRedo(true)}
      />
      <FormulaBar view={view} active={bar.active} text={bar.text} />
      <div ref={gridRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
