"use client";

import { History } from "@office/command-core";
import { DocsEditor, type DocsFormat } from "@office/docs";
import { useEffect, useRef, useState } from "react";
import { DocsToolbar } from "./docs-toolbar";

/** 브라우저 테스트가 읽는 문서 상태. 개발 서버에서만 window.__docs로 노출한다. */
export interface DocsTestHandle {
  /** 문서 내용 (HTML) */
  html(): string;
}

declare global {
  interface Window {
    __docs?: DocsTestHandle;
  }
}

/** 툴바가 보여 줄 문서 상태 */
interface BarState {
  format: DocsFormat | null;
  canUndo: boolean;
  canRedo: boolean;
}

const PAGE_CSS = `
.docs-page .ProseMirror { min-height: 100%; outline: none; }
.docs-page .ProseMirror > :first-child { margin-top: 0; }
.docs-page blockquote { margin: 0 0 0 4px; padding-left: 12px; border-left: 3px solid #d0d0d0; color: #555; }
`;

export function DocumentEditor() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<DocsEditor | null>(null);
  const [bar, setBar] = useState<BarState>({ format: null, canUndo: false, canRedo: false });

  useEffect(() => {
    const history = new History();
    const editor = new DocsEditor(pageRef.current!, history);
    // 커서 위치, 서식, 내용, undo 기록 중 무엇이 바뀌든 툴바를 다시 읽는다.
    const refresh = () => setBar({ format: editor.activeFormat, canUndo: history.canUndo, canRedo: history.canRedo });
    const unsubscribes = [editor.onChange(refresh), history.onChange(refresh)];
    refresh();
    setEditor(editor);
    editor.focus();
    if (process.env.NODE_ENV !== "production") {
      window.__docs = { html: () => editor.getHTML() };
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      editor.destroy();
      setEditor(null);
      delete window.__docs;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", fontFamily: "sans-serif", fontSize: 13, background: "#f3f3f3" }}>
      <style>{PAGE_CSS}</style>
      <div style={{ background: "#ffffff" }}>
        <DocsToolbar editor={editor} format={bar.format} canUndo={bar.canUndo} canRedo={bar.canRedo} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 16px" }}>
        <div
          ref={pageRef}
          className="docs-page"
          style={{
            boxSizing: "border-box",
            maxWidth: 816,
            minHeight: "100%",
            margin: "0 auto",
            padding: "48px 64px",
            background: "#ffffff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            fontSize: 15,
            lineHeight: 1.6,
          }}
        />
      </div>
    </div>
  );
}
