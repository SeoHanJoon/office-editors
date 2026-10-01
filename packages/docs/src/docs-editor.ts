import type { History } from "@office/command-core";
import { Editor, Extension } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { baseExtensions } from "./extensions";
import { createEditCommand, FilteredTransactionError, HISTORY_META, TypingGrouper, type DocTarget } from "./edit-command";

/** 툴바에서 고르는 문단 모양 */
export type BlockType = "paragraph" | "heading1" | "heading2" | "heading3";

/** 글자에 주는 서식 */
export type MarkType = "bold" | "italic" | "underline" | "strike";

/** 지금 커서 위치(또는 선택)의 서식. 툴바 버튼 상태에 쓴다. */
export interface DocsFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** 문단 모양. 선택이 여러 모양에 걸쳐 있으면 null */
  block: BlockType | null;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
}

export interface DocsEditorOptions {
  /** 처음 문서 내용 (HTML). 없으면 빈 문서 */
  content?: string;
}

/** 서식이나 커서 위치가 바뀐 뒤 불린다. activeFormat을 다시 읽으면 된다. */
export type DocsChangeListener = () => void;

/**
 * Tiptap으로 만든 문서 편집기. React를 모르고 container 안에 편집 영역만 만든다. (ADR 0038)
 * undo 기록은 앱이 넘긴 History를 쓴다. (ADR 0016, 0037) Tiptap 자체 undo는 끈다.
 */
export class DocsEditor {
  private readonly editor: Editor;
  private readonly history: History;
  private readonly grouper = new TypingGrouper();
  private readonly listeners = new Set<DocsChangeListener>();
  /** Command가 적용 중인 트랜잭션. 이것은 다시 기록하지 않고 그대로 통과시킨다. */
  private applying: Transaction | null = null;
  /** 적용 중인 트랜잭션과 플러그인이 덧붙인 트랜잭션. Tiptap의 transaction 알림에서 받는다. */
  private applied: Transaction[] = [];

  constructor(container: HTMLElement, history: History, options: DocsEditorOptions = {}) {
    this.history = history;
    const target: DocTarget = {
      get state() {
        return editor.state;
      },
      apply: (tr) => this.apply(tr),
    };
    const self = this;
    // 문서를 바꾸는 트랜잭션을 모두 Command로 바꿔 History로 실행한다.
    const officeHistory = Extension.create({
      name: "officeHistory",
      dispatchTransaction({ transaction, next }) {
        if (transaction === self.applying || transaction.getMeta(HISTORY_META) || !transaction.docChanged) {
          next(transaction);
          return;
        }
        const command = createEditCommand(target, transaction, self.grouper.mergeKey(transaction));
        try {
          self.history.execute(command);
        } catch (error) {
          if (!(error instanceof FilteredTransactionError)) throw error;
        }
      },
      addKeyboardShortcuts() {
        return {
          "Mod-z": () => self.undo(),
          "Shift-Mod-z": () => self.redo(),
          "Mod-y": () => self.redo(),
        };
      },
    });

    const editor = new Editor({
      element: container,
      content: options.content ?? "",
      extensions: [
        ...baseExtensions(),
        officeHistory,
      ],
      editorProps: {
        attributes: { "aria-label": "문서", spellcheck: "false" },
        handleDOMEvents: {
          // 브라우저 메뉴의 실행 취소·다시 실행도 공통 기록으로 보낸다.
          beforeinput: (_view, event) => {
            if (event.inputType === "historyUndo") self.undo();
            else if (event.inputType === "historyRedo") self.redo();
            else return false;
            event.preventDefault();
            return true;
          },
        },
      },
      onTransaction: ({ transaction, appendedTransactions }) => {
        if (transaction === this.applying) this.applied = [transaction, ...appendedTransactions];
        this.notify();
      },
    });
    this.editor = editor;
  }

  /** 지금 커서 위치(또는 선택)의 서식 */
  get activeFormat(): DocsFormat {
    const { editor } = this;
    const blocks: [BlockType, boolean][] = [
      ["paragraph", editor.isActive("paragraph")],
      ["heading1", editor.isActive("heading", { level: 1 })],
      ["heading2", editor.isActive("heading", { level: 2 })],
      ["heading3", editor.isActive("heading", { level: 3 })],
    ];
    return {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      block: blocks.find(([, active]) => active)?.[0] ?? null,
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
    };
  }

  /** 글자 서식을 켜고 끈다. 선택이 없으면 다음에 칠 글자에 적용된다. */
  toggleMark(mark: MarkType): void {
    this.editor.chain().focus().toggleMark(mark).run();
  }

  /** 커서가 있는 문단(들)의 모양을 바꾼다. */
  setBlock(block: BlockType): void {
    const chain = this.editor.chain().focus();
    if (block === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: HEADING_LEVEL[block] }).run();
  }

  toggleBulletList(): void {
    this.editor.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor.chain().focus().toggleOrderedList().run();
  }

  toggleBlockquote(): void {
    this.editor.chain().focus().toggleBlockquote().run();
  }

  /** 한글 조합 중이면 막는다. 조합 중인 글자가 엉키지 않게 하기 위해서다. */
  undo(): boolean {
    if (this.editor.view.composing) return true;
    this.history.undo();
    return true;
  }

  redo(): boolean {
    if (this.editor.view.composing) return true;
    this.history.redo();
    return true;
  }

  /** 서식, 커서 위치, 문서 내용이 바뀔 때마다 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: DocsChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  focus(): void {
    this.editor.commands.focus();
  }

  /** 문서 내용 (HTML) */
  getHTML(): string {
    return this.editor.getHTML();
  }

  destroy(): void {
    this.listeners.clear();
    this.editor.destroy();
  }

  private apply(tr: Transaction): readonly Transaction[] {
    this.applying = tr;
    this.applied = [];
    try {
      this.editor.view.dispatch(tr);
      return this.applied;
    } finally {
      this.applying = null;
      this.applied = [];
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

const HEADING_LEVEL = { heading1: 1, heading2: 2, heading3: 3 } as const;
