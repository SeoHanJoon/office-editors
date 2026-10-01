"use client";

import type { GridView } from "@office/excel";
import { useEffect, useState, type KeyboardEvent } from "react";

export interface FormulaBarProps {
  view: GridView | null;
  /** 활성 셀 주소 ("B3") */
  active: string;
  /** 입력 중이면 입력 중인 글자, 아니면 활성 셀에 입력된 글자(수식이면 수식) */
  text: string;
}

const boxStyle = { height: 24, padding: "2px 6px", border: "1px solid #c8c8c8", fontSize: 13, boxSizing: "border-box" } as const;

/**
 * 표 위의 수식 입력줄. 왼쪽은 이름 상자, 오른쪽은 셀 글자다. (ADR 0035)
 * - 이름 상자: 주소("B3", "B3:D5")를 치고 Enter를 누르면 그 셀로 간다. 틀린 주소면 그대로 머문다.
 * - 셀 글자: 여기서 치면 셀 입력창에도 같은 글자가 보인다. Enter·Tab은 확정하고 옮기며, Esc는 취소한다. Alt+Enter는 줄바꿈이다.
 */
export function FormulaBar({ view, active, text }: FormulaBarProps) {
  const [name, setName] = useState(active);
  const [nameFocused, setNameFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!nameFocused) setName(active);
  }, [active, nameFocused]);

  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !view) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (view.goTo(name)) {
        setInvalid(false);
        view.focus();
      } else {
        setInvalid(true);
        event.currentTarget.select();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setInvalid(false);
      setName(active);
      view.focus();
    }
  };

  const onTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중인 키(조합을 끝내는 Enter 포함)는 입력기에 맡긴다.
    if (event.nativeEvent.isComposing || !view) return;
    if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      const target = event.currentTarget;
      target.setRangeText("\n", target.selectionStart, target.selectionEnd, "end");
      view.setEditText(target.value);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      view.commitEdit(event.key, event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      view.cancelEdit();
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderBottom: "1px solid #d0d0d0" }}>
      <input
        aria-label="이름 상자"
        aria-invalid={invalid}
        value={name}
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => {
          setNameFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setNameFocused(false);
          setInvalid(false);
        }}
        onKeyDown={onNameKeyDown}
        style={{ ...boxStyle, width: 96, borderColor: invalid ? "#a4262c" : "#c8c8c8" }}
      />
      <span aria-hidden style={{ color: "#808080", fontStyle: "italic", fontFamily: "serif" }}>
        fx
      </span>
      <textarea
        aria-label="수식 입력줄"
        value={text}
        rows={1}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => view?.setEditText(event.target.value)}
        onKeyDown={onTextKeyDown}
        style={{ ...boxStyle, flex: 1, resize: "none", overflow: "hidden", whiteSpace: "pre", fontFamily: "inherit", lineHeight: "18px" }}
      />
    </div>
  );
}
