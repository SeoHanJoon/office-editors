"use client";

import type { BlockType, DocsEditor, DocsFormat, MarkType } from "@office/docs";
import { Toolbar, ToolbarButton, ToolbarSelect, ToolbarSeparator } from "@office/ui/react";
import type { CSSProperties } from "react";
import { LetterIcon, RedoIcon, UndoIcon } from "../excel/icons";
import { BlockquoteIcon, BulletListIcon, OrderedListIcon } from "./icons";

/** Mac이면 단축키를 ⌘로 보여준다. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const shortcut = (keys: string) => (MAC ? `⌘${keys}` : `Ctrl+${keys}`);

const BLOCKS: { value: BlockType; label: string }[] = [
  { value: "paragraph", label: "본문" },
  { value: "heading1", label: "제목 1" },
  { value: "heading2", label: "제목 2" },
  { value: "heading3", label: "제목 3" },
];

const MARKS: { mark: MarkType; label: string; key?: string; style: CSSProperties; letter: string }[] = [
  { mark: "bold", label: "굵게", key: "B", letter: "B", style: { fontWeight: 700 } },
  { mark: "italic", label: "기울임꼴", key: "I", letter: "I", style: { fontStyle: "italic", fontFamily: "serif" } },
  { mark: "underline", label: "밑줄", key: "U", letter: "U", style: { textDecoration: "underline" } },
  { mark: "strike", label: "취소선", key: "Shift+S", letter: "S", style: { textDecoration: "line-through" } },
];

export interface DocsToolbarProps {
  editor: DocsEditor | null;
  /** 지금 커서 위치의 서식. 버튼 상태에 보인다. */
  format: DocsFormat | null;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * 문서 위의 툴바. 버튼은 DocsEditor의 서식 메서드를 부른다. (ADR 0038)
 * 버튼은 포커스를 가져가지 않으므로 누른 뒤에도 문서에서 계속 칠 수 있다.
 */
export function DocsToolbar({ editor, format, canUndo, canRedo }: DocsToolbarProps) {
  const run = (action: (editor: DocsEditor) => void) => {
    if (!editor) return;
    action(editor);
    editor.focus();
  };

  return (
    <Toolbar label="서식 도구">
      <ToolbarButton label="실행 취소" title={`실행 취소 (${shortcut("Z")})`} disabled={!canUndo} onClick={() => run((e) => e.undo())}>
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton label="다시 실행" title={`다시 실행 (${shortcut("Y")})`} disabled={!canRedo} onClick={() => run((e) => e.redo())}>
        <RedoIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarSelect
        label="문단 모양"
        value={format?.block ?? "paragraph"}
        options={BLOCKS}
        width={80}
        onChange={(block) => run((e) => e.setBlock(block))}
      />
      {MARKS.map(({ mark, label, key, letter, style }) => (
        <ToolbarButton
          key={mark}
          label={label}
          title={key ? `${label} (${shortcut(key)})` : label}
          pressed={format?.[mark] === true}
          onClick={() => run((e) => e.toggleMark(mark))}
        >
          <LetterIcon letter={letter} style={style} />
        </ToolbarButton>
      ))}
      <ToolbarSeparator />

      <ToolbarButton label="글머리 기호 목록" pressed={format?.bulletList === true} onClick={() => run((e) => e.toggleBulletList())}>
        <BulletListIcon />
      </ToolbarButton>
      <ToolbarButton label="번호 매기기 목록" pressed={format?.orderedList === true} onClick={() => run((e) => e.toggleOrderedList())}>
        <OrderedListIcon />
      </ToolbarButton>
      <ToolbarButton label="인용" pressed={format?.blockquote === true} onClick={() => run((e) => e.toggleBlockquote())}>
        <BlockquoteIcon />
      </ToolbarButton>
    </Toolbar>
  );
}
