"use client";

import { History } from "@office/command-core";
import {
  FormulaEngine,
  GridView,
  formatValue,
  parseA1,
  rangeToA1,
  selectionRange,
  toA1,
  type CellAddress,
  type EditMode,
} from "@office/excel";
import { useEffect, useRef, useState } from "react";
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
  };
  /** 셀("B3")에 입력된 글자. 수식이면 "=A1+1"처럼 수식 그대로. 빈 셀이면 "" */
  cell(a1: string): string;
  /** 셀("B3")에 보이는 계산값 글자. 빈 셀이면 "" */
  value(a1: string): string;
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

export function Spreadsheet() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState("A1");

  useEffect(() => {
    const sheet = createSampleSheet();
    const engine = new FormulaEngine(sheet);
    const view = new GridView(gridRef.current!, sheet, new History(), { engine });
    const unsubscribe = view.onSelectionChange((selection) => setActive(toA1(selection.active)));
    view.focus();
    if (process.env.NODE_ENV !== "production") {
      window.__excel = {
        state: () => ({
          active: toA1(view.selection.active),
          selection: rangeToA1(selectionRange(view.selection)),
          visible: rangeToA1(view.visibleRange),
          editing: view.editMode,
        }),
        cell: (a1) => sheet.get(address(a1)),
        value: (a1) => formatValue(engine.getValue(address(a1))),
      };
    }
    return () => {
      unsubscribe();
      view.destroy();
      engine.destroy();
      delete window.__excel;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid #d0d0d0" }}>
        <input
          aria-label="이름 상자"
          readOnly
          value={active}
          style={{ width: 96, padding: "2px 6px", border: "1px solid #c8c8c8", fontSize: 13 }}
        />
      </div>
      <div ref={gridRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
