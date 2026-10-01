import type { Command } from "@office/command-core";
import type { EditorState, SelectionBookmark, Transaction } from "@tiptap/pm/state";
import { ReplaceStep, type Step } from "@tiptap/pm/transform";

/**
 * 문서 편집(ProseMirror 트랜잭션)을 공통 undo 기록(History)에 넣는 Command로 바꾼다.
 * Tiptap 자체 undo는 끄고, 문서를 바꾸는 트랜잭션은 모두 여기를 거친다.
 */

/** undo·redo가 만든 트랜잭션에 붙이는 표시. 이 표시가 있으면 다시 기록하지 않는다. */
export const HISTORY_META = "officeDocsHistory";

/** Command가 문서를 읽고 바꾸는 곳. 실제로는 Tiptap 에디터, 테스트에서는 EditorState 하나. */
export interface DocTarget {
  /** 지금 문서 상태 */
  readonly state: EditorState;
  /**
   * 트랜잭션을 적용하고, 실제로 적용된 트랜잭션들을 돌려준다.
   * 처음 것은 넘긴 트랜잭션이고, 그 뒤는 플러그인이 덧붙인 것이다. (예: 문서 끝에 빈 문단 붙이기)
   * 플러그인이 트랜잭션을 걸러내 적용하지 않았으면 빈 배열이다.
   */
  apply(tr: Transaction): readonly Transaction[];
}

/** 플러그인이 트랜잭션을 걸러내 아무것도 바뀌지 않았다. History는 이 편집을 기록하지 않는다. */
export class FilteredTransactionError extends Error {
  constructor() {
    super("트랜잭션이 걸러져 적용되지 않았다");
  }
}

/**
 * 트랜잭션 하나를 Command로 만든다. History.execute에 넘기면 처음 execute에서 그 트랜잭션을 그대로 적용한다.
 * (한글 조합 중인 입력도 브라우저가 만든 트랜잭션 그대로 적용해야 하므로 다시 만들지 않는다)
 * redo는 기록한 변경(step)을 다시 적용하고, undo는 반대 변경을 적용한 뒤 편집 전 커서 위치로 돌린다.
 */
export function createEditCommand(target: DocTarget, tr: Transaction, mergeKey?: string): Command {
  const selectionBefore = target.state.selection.getBookmark();
  let recorded: { steps: Step[]; inverted: Step[]; selectionAfter: SelectionBookmark } | null = null;

  const replay = (steps: readonly Step[], selection: SelectionBookmark) => {
    const replayTr = target.state.tr;
    // 실패하면 step()이 던진다. 아직 적용하기 전이라 문서는 그대로다.
    for (const step of steps) replayTr.step(step);
    replayTr.setSelection(selection.resolve(replayTr.doc));
    replayTr.setMeta(HISTORY_META, true).setMeta("addToHistory", false).scrollIntoView();
    target.apply(replayTr);
  };

  return {
    mergeKey,
    execute() {
      if (recorded) {
        replay(recorded.steps, recorded.selectionAfter);
        return;
      }
      const applied = target.apply(tr);
      if (applied.length === 0) throw new FilteredTransactionError();
      const steps = applied.flatMap((t) => t.steps);
      const inverted = applied.flatMap((t) => t.steps.map((step, i) => step.invert(t.docs[i]!))).reverse();
      recorded = { steps, inverted, selectionAfter: target.state.selection.getBookmark() };
    },
    undo() {
      if (!recorded) throw new Error("실행하지 않은 편집은 되돌릴 수 없다");
      replay(recorded.inverted, selectionBefore);
    },
  };
}

/**
 * 이어서 친 글자를 undo 한 번에 되돌릴 묶음으로 나눈다. (ADR 0037)
 * History는 mergeKey가 같고 0.5초 안에 이어진 편집을 합친다. 여기서는 mergeKey를 바꿔서 묶음을 끊는다.
 * - 같은 자리에서 이어 치거나 지우는 것만 묶는다. 커서를 옮겨 다른 곳을 고치면 새 묶음이다.
 * - 띄어쓰기 뒤에 새 단어를 치기 시작하면 새 묶음이다. ("hello world"는 "world", "hello " 순서로 되돌린다)
 * - 줄 바꾸기, 서식, 붙여넣기처럼 글자 입력·지우기가 아닌 편집은 묶지 않고, 다음 입력도 새 묶음이 된다.
 */
export class TypingGrouper {
  private group = 0;
  private last: { kind: "insert" | "delete"; end: number; afterSpace: boolean } | null = null;

  /** 트랜잭션을 기록하기 전에 불러 mergeKey를 받는다. 묶지 않는 편집이면 undefined */
  mergeKey(tr: Transaction): string | undefined {
    const typing = classifyTyping(tr);
    if (!typing) {
      this.last = null;
      this.group++;
      return undefined;
    }
    const last = this.last;
    const continues =
      last !== null &&
      last.kind === typing.kind &&
      (typing.from === last.end || typing.to === last.end) &&
      !(typing.kind === "insert" && last.afterSpace && !startsWithSpace(typing.text));
    if (!continues) this.group++;
    this.last = {
      kind: typing.kind,
      end: typing.kind === "insert" ? typing.from + typing.text.length : typing.from,
      afterSpace: typing.kind === "insert" ? endsWithSpace(typing.text) : false,
    };
    return `${typing.kind}:${this.group}`;
  }
}

interface Typing {
  kind: "insert" | "delete";
  from: number;
  to: number;
  /** 넣은 글자. 지우기면 "" */
  text: string;
}

/** 한 문단 안에서 글자만 넣거나(한글 조합처럼 앞 글자를 바꾸는 것 포함) 지우는 편집이면 그 내용, 아니면 null */
function classifyTyping(tr: Transaction): Typing | null {
  const step = tr.steps[0];
  if (tr.steps.length !== 1 || !(step instanceof ReplaceStep) || tr.getMeta("uiEvent")) return null;
  const { from, to, slice } = step;
  if (slice.openStart !== 0 || slice.openEnd !== 0) return null;
  let textOnly = true;
  slice.content.forEach((node) => {
    if (!node.isText) textOnly = false;
  });
  if (!textOnly) return null;
  const doc = tr.docs[0]!;
  if (!doc.resolve(from).sameParent(doc.resolve(to))) return null;
  const text = slice.content.textBetween(0, slice.content.size);
  if (text === "" && from === to) return null;
  return { kind: text === "" ? "delete" : "insert", from, to, text };
}

function startsWithSpace(text: string): boolean {
  return /^\s/.test(text);
}

function endsWithSpace(text: string): boolean {
  return /\s$/.test(text);
}
