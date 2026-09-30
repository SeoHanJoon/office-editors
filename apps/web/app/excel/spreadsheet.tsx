"use client";

import { GridView, rangeToA1, selectionRange, toA1 } from "@office/excel";
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
  };
}

declare global {
  interface Window {
    __excel?: ExcelTestHandle;
  }
}

export function Spreadsheet() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState("A1");

  useEffect(() => {
    const view = new GridView(gridRef.current!, createSampleSheet());
    const unsubscribe = view.onSelectionChange((selection) => setActive(toA1(selection.anchor)));
    view.focus();
    if (process.env.NODE_ENV !== "production") {
      window.__excel = {
        state: () => ({
          active: toA1(view.selection.anchor),
          selection: rangeToA1(selectionRange(view.selection)),
          visible: rangeToA1(view.visibleRange),
        }),
      };
    }
    return () => {
      unsubscribe();
      view.destroy();
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
