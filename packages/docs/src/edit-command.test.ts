import { History } from "@office/command-core";
import { getSchema } from "@tiptap/core";
import { splitBlock } from "@tiptap/pm/commands";
import type { Node } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, test } from "vitest";
import { createEditCommand, FilteredTransactionError, TypingGrouper, type DocTarget } from "./edit-command";
import { baseExtensions } from "./extensions";

const schema = getSchema(baseExtensions());

function doc(...paragraphs: string[]): Node {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, text ? schema.text(text) : [])),
  );
}

/** EditorState 하나를 들고 트랜잭션을 적용하는 테스트용 DocTarget */
function stateTarget(start: Node, plugins: Plugin[] = []): DocTarget & { state: EditorState } {
  let state = EditorState.create({ schema, doc: start, plugins });
  return {
    get state() {
      return state;
    },
    apply(tr: Transaction) {
      const result = state.applyTransaction(tr);
      if (!result.transactions.includes(tr)) return [];
      state = result.state;
      return result.transactions;
    },
  };
}

/** 사람이 편집기에서 하는 것처럼: 트랜잭션을 만들어 mergeKey를 정하고 History로 실행한다. */
function edit(target: DocTarget, history: History, make: (state: EditorState) => Transaction, grouper?: TypingGrouper) {
  const tr = make(target.state);
  history.execute(createEditCommand(target, tr, grouper?.mergeKey(tr)));
}

function type(target: DocTarget, history: History, grouper: TypingGrouper, text: string) {
  for (const char of text) edit(target, history, (state) => state.tr.insertText(char), grouper);
}

function moveCursor(target: DocTarget & { state: EditorState }, pos: number) {
  target.apply(target.state.tr.setSelection(TextSelection.create(target.state.doc, pos)));
}

function enter(state: EditorState): Transaction {
  let result: Transaction | null = null;
  splitBlock(state, (tr) => (result = tr));
  return result!;
}

describe("createEditCommand", () => {
  test("execute로 적용하고 undo로 처음 문서와 커서 위치로, redo로 다시 편집 뒤로 돌아간다", () => {
    const target = stateTarget(doc("hello"));
    moveCursor(target, 6);
    const history = new History();
    const before = target.state;

    edit(target, history, (state) => state.tr.insertText(" world"));
    const after = target.state;
    expect(after.doc.textContent).toBe("hello world");

    history.undo();
    expect(target.state.doc.eq(before.doc)).toBe(true);
    expect(target.state.selection.eq(before.selection)).toBe(true);

    history.redo();
    expect(target.state.doc.eq(after.doc)).toBe(true);
    expect(target.state.selection.eq(after.selection)).toBe(true);
  });

  test("서식(굵게)과 문단 나누기도 되돌린다", () => {
    const target = stateTarget(doc("hello"));
    const history = new History();
    const start = target.state.doc;

    edit(target, history, (state) => state.tr.addMark(1, 6, schema.marks.bold!.create()));
    moveCursor(target, 3);
    edit(target, history, enter);
    expect(target.state.doc.childCount).toBe(2);

    history.undo();
    history.undo();
    expect(target.state.doc.eq(start)).toBe(true);
  });

  test("플러그인이 덧붙인 변경도 함께 되돌린다", () => {
    // 첫 문단이 비면 "(빈 문서)"를 써 넣는 플러그인
    const fillEmpty = new Plugin({
      appendTransaction: (_trs, _old, state) =>
        state.doc.firstChild!.content.size === 0 ? state.tr.insertText("(빈 문서)", 1) : null,
    });
    const target = stateTarget(doc("ab"), [fillEmpty]);
    const history = new History();

    edit(target, history, (state) => state.tr.delete(1, 3));
    expect(target.state.doc.textContent).toBe("(빈 문서)");

    history.undo();
    expect(target.state.doc.textContent).toBe("ab");
    history.redo();
    expect(target.state.doc.textContent).toBe("(빈 문서)");
  });

  test("플러그인이 걸러낸 트랜잭션은 기록하지 않는다", () => {
    const rejectAll = new Plugin({ filterTransaction: (tr) => !tr.docChanged });
    const target = stateTarget(doc("ab"), [rejectAll]);
    const history = new History();

    expect(() => edit(target, history, (state) => state.tr.insertText("x", 1))).toThrow(FilteredTransactionError);
    expect(history.canUndo).toBe(false);
    expect(target.state.doc.textContent).toBe("ab");
  });

  test("여러 편집을 batch로 묶으면 undo 한 번에 모두 되돌린다", () => {
    const target = stateTarget(doc("a"));
    const history = new History();

    history.batch(() => {
      edit(target, history, (state) => state.tr.insertText("1", 2));
      edit(target, history, (state) => state.tr.insertText("2", 3));
    });
    expect(target.state.doc.textContent).toBe("a12");
    history.undo();
    expect(target.state.doc.textContent).toBe("a");
  });
});

describe("TypingGrouper: 이어서 친 글자 묶기", () => {
  function setup(text = "") {
    const target = stateTarget(doc(text));
    moveCursor(target, 1 + text.length);
    // 시간 간격은 테스트에서 보지 않는다. 묶음을 끊는 것은 mergeKey뿐이다.
    const history = new History({ mergeWindowMs: Number.POSITIVE_INFINITY });
    return { target, history, grouper: new TypingGrouper() };
  }

  test("띄어쓰기 뒤에 새 단어를 시작하면 새 묶음이 된다", () => {
    const { target, history, grouper } = setup();
    type(target, history, grouper, "hello world");

    history.undo();
    expect(target.state.doc.textContent).toBe("hello ");
    history.undo();
    expect(target.state.doc.textContent).toBe("");
  });

  test("줄 바꾸기는 따로 되돌리고, 그 뒤 입력은 새 묶음이다", () => {
    const { target, history, grouper } = setup();
    type(target, history, grouper, "ab");
    edit(target, history, enter, grouper);
    type(target, history, grouper, "cd");

    history.undo();
    expect(target.state.doc.childCount).toBe(2);
    expect(target.state.doc.textContent).toBe("ab");
    history.undo();
    expect(target.state.doc.childCount).toBe(1);
    history.undo();
    expect(target.state.doc.textContent).toBe("");
  });

  test("커서를 옮겨 다른 곳에 치면 새 묶음이다", () => {
    const { target, history, grouper } = setup();
    type(target, history, grouper, "abc");
    moveCursor(target, 1);
    type(target, history, grouper, "xy");
    expect(target.state.doc.textContent).toBe("xyabc");

    history.undo();
    expect(target.state.doc.textContent).toBe("abc");
  });

  test("이어서 지운 글자는 한 묶음이고, 지운 뒤 입력은 새 묶음이다", () => {
    const { target, history, grouper } = setup("abcd");
    const backspace = (state: EditorState) => state.tr.delete(state.selection.from - 1, state.selection.from);
    edit(target, history, backspace, grouper);
    edit(target, history, backspace, grouper);
    type(target, history, grouper, "Z");
    expect(target.state.doc.textContent).toBe("abZ");

    history.undo();
    expect(target.state.doc.textContent).toBe("ab");
    history.undo();
    expect(target.state.doc.textContent).toBe("abcd");
  });

  test("한글 조합처럼 방금 친 글자를 바꾸는 입력도 같은 묶음이다", () => {
    const { target, history, grouper } = setup();
    // "ㅎ" → "하" → "한", 이어서 "ㄱ" → "글"
    const compose = (text: string, replace: boolean) =>
      edit(
        target,
        history,
        (state) => {
          const to = state.selection.from;
          return state.tr.insertText(text, replace ? to - 1 : to, to);
        },
        grouper,
      );
    compose("ㅎ", false);
    compose("하", true);
    compose("한", true);
    compose("ㄱ", false);
    compose("글", true);
    expect(target.state.doc.textContent).toBe("한글");

    history.undo();
    expect(target.state.doc.textContent).toBe("");
  });
});
