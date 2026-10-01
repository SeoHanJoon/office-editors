"use client";

import {
  DEFAULT_FONT_SIZE,
  numberFormatOf,
  type BorderKind,
  type CellFormat,
  type GridView,
  type NumberFormatKind,
} from "@office/excel";
import type { ReactNode } from "react";
import { ColorPicker, Toolbar, ToolbarButton, ToolbarMenu, ToolbarSelect, ToolbarSeparator } from "@office/ui/react";
import {
  AlignIcon,
  BorderAllIcon,
  BorderNoneIcon,
  BorderOuterIcon,
  BorderSideIcon,
  ClearFormatIcon,
  FillIcon,
  LetterIcon,
  RedoIcon,
  UndoIcon,
  VerticalAlignIcon,
  WrapIcon,
} from "./icons";

/** Mac이면 단축키를 ⌘로 보여준다. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const shortcut = (letter: string) => (MAC ? `⌘${letter}` : `Ctrl+${letter}`);

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((size) => ({ value: String(size), label: String(size) }));

const NUMBER_FORMATS: { value: NumberFormatKind; label: string }[] = [
  { value: "general", label: "일반" },
  { value: "number", label: "숫자" },
  { value: "currency", label: "통화 (₩)" },
  { value: "percent", label: "백분율" },
];

const BORDERS: { value: BorderKind; label: string; icon: ReactNode }[] = [
  { value: "all", label: "모든 테두리", icon: <BorderAllIcon /> },
  { value: "outer", label: "바깥쪽 테두리", icon: <BorderOuterIcon /> },
  { value: "top", label: "위쪽 테두리", icon: <BorderSideIcon side="top" /> },
  { value: "bottom", label: "아래쪽 테두리", icon: <BorderSideIcon side="bottom" /> },
  { value: "left", label: "왼쪽 테두리", icon: <BorderSideIcon side="left" /> },
  { value: "right", label: "오른쪽 테두리", icon: <BorderSideIcon side="right" /> },
  { value: "none", label: "테두리 없음", icon: <BorderNoneIcon /> },
];

/** Office 색 판과 비슷한 색 (진한 색 8개 + 옅은 색 8개 + 회색 8개) */
const PALETTE = [
  "#000000", "#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050", "#00b050", "#0070c0",
  "#7030a0", "#44546a", "#4472c4", "#ed7d31", "#a5a5a5", "#5b9bd5", "#70ad47", "#002060",
  "#ffffff", "#f2f2f2", "#d9d9d9", "#bfbfbf", "#a6a6a6", "#808080", "#595959", "#262626",
];

export interface ExcelToolbarProps {
  view: GridView | null;
  /** 활성 셀에 보이는 서식. 버튼 상태에 보인다. */
  format: CellFormat;
  canUndo: boolean;
  canRedo: boolean;
  /** 셀 입력 중이면 실행 취소·다시 실행을 막는다. (Excel과 같음) */
  editing: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * 표 위의 툴바. 버튼은 GridView의 서식 메서드를 부른다. (ADR 0035)
 * 버튼은 포커스를 가져가지 않고, 고르기(글자 크기, 숫자 형식)·색 고르기는 고른 뒤 표로 포커스를 돌려준다.
 */
export function ExcelToolbar({ view, format, canUndo, canRedo, editing, onUndo, onRedo }: ExcelToolbarProps) {
  const run = (action: (view: GridView) => void) => {
    if (!view) return;
    action(view);
    view.focus();
  };
  const align = format.align;
  const verticalAlign = format.verticalAlign ?? "bottom";

  return (
    <Toolbar label="서식 도구">
      <ToolbarButton label="실행 취소" title={`실행 취소 (${shortcut("Z")})`} disabled={!canUndo || editing} onClick={onUndo}>
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton label="다시 실행" title={`다시 실행 (${shortcut("Y")})`} disabled={!canRedo || editing} onClick={onRedo}>
        <RedoIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarSelect
        label="글자 크기"
        value={String(format.fontSize ?? DEFAULT_FONT_SIZE)}
        options={FONT_SIZES}
        width={56}
        onChange={(size) => run((v) => v.applyFormat({ fontSize: Number(size) }))}
      />
      <ToolbarButton label="굵게" title={`굵게 (${shortcut("B")})`} pressed={format.bold === true} onClick={() => run((v) => v.toggleFormat("bold"))}>
        <LetterIcon letter="B" style={{ fontWeight: 700 }} />
      </ToolbarButton>
      <ToolbarButton
        label="기울임꼴"
        title={`기울임꼴 (${shortcut("I")})`}
        pressed={format.italic === true}
        onClick={() => run((v) => v.toggleFormat("italic"))}
      >
        <LetterIcon letter="I" style={{ fontStyle: "italic", fontFamily: "serif" }} />
      </ToolbarButton>
      <ToolbarButton
        label="밑줄"
        title={`밑줄 (${shortcut("U")})`}
        pressed={format.underline === true}
        onClick={() => run((v) => v.toggleFormat("underline"))}
      >
        <LetterIcon letter="U" style={{ textDecoration: "underline" }} />
      </ToolbarButton>
      <ToolbarButton label="취소선" pressed={format.strike === true} onClick={() => run((v) => v.toggleFormat("strike"))}>
        <LetterIcon letter="S" style={{ textDecoration: "line-through" }} />
      </ToolbarButton>
      <ColorPicker
        label="글자색"
        value={format.color ?? null}
        colors={PALETTE}
        noneLabel="자동"
        onChange={(color) => run((v) => v.applyFormat({ color }))}
      >
        <LetterIcon letter="A" style={{ fontWeight: 600, lineHeight: "13px" }} />
      </ColorPicker>
      <ColorPicker
        label="채우기 색"
        value={format.fill ?? null}
        colors={PALETTE}
        noneLabel="채우기 없음"
        onChange={(fill) => run((v) => v.applyFormat({ fill }))}
      >
        <FillIcon />
      </ColorPicker>
      <ToolbarMenu label="테두리" items={BORDERS} onSelect={(kind) => run((v) => v.applyBorders(kind))}>
        <BorderAllIcon />
      </ToolbarMenu>
      <ToolbarSeparator />

      {(["left", "center", "right"] as const).map((value) => (
        <ToolbarButton
          key={value}
          label={{ left: "왼쪽 맞춤", center: "가운데 맞춤", right: "오른쪽 맞춤" }[value]}
          pressed={align === value}
          // 켜진 정렬을 다시 누르면 일반(값 종류에 따른 정렬)으로 돌린다. (Excel과 같음)
          onClick={() => run((v) => v.applyFormat({ align: align === value ? null : value }))}
        >
          <AlignIcon align={value} />
        </ToolbarButton>
      ))}
      {(["top", "middle", "bottom"] as const).map((value) => (
        <ToolbarButton
          key={value}
          label={{ top: "위쪽 맞춤", middle: "세로 가운데 맞춤", bottom: "아래쪽 맞춤" }[value]}
          pressed={verticalAlign === value}
          onClick={() => run((v) => v.applyFormat({ verticalAlign: value === "bottom" ? null : value }))}
        >
          <VerticalAlignIcon align={value} />
        </ToolbarButton>
      ))}
      <ToolbarButton label="자동 줄바꿈" pressed={format.wrap === true} onClick={() => run((v) => v.applyFormat({ wrap: !format.wrap }))}>
        <WrapIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarSelect
        label="숫자 형식"
        value={format.numberFormat?.kind ?? "general"}
        options={NUMBER_FORMATS}
        width={92}
        onChange={(kind) => run((v) => v.applyFormat({ numberFormat: numberFormatOf(kind) }))}
      />
      <ToolbarButton label="자릿수 늘림" onClick={() => run((v) => v.changeDecimals(1))}>
        <LetterIcon letter=".0+" style={{ width: 22, fontSize: 11 }} />
      </ToolbarButton>
      <ToolbarButton label="자릿수 줄임" onClick={() => run((v) => v.changeDecimals(-1))}>
        <LetterIcon letter=".0−" style={{ width: 22, fontSize: 11 }} />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton label="서식 지우기" onClick={() => run((v) => v.clearFormat())}>
        <ClearFormatIcon />
      </ToolbarButton>
    </Toolbar>
  );
}
