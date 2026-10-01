import type { Command } from "./command";

export interface HistoryOptions {
  /** 되돌릴 수 있는 최대 개수. 넘으면 가장 오래된 것부터 버린다. 기본 100 (Excel과 같음) */
  limit?: number;
  /** mergeKey가 같은 편집을 합치는 최대 간격(ms). 직전 편집 시각부터 잰다. 기본 500 */
  mergeWindowMs?: number;
}

/** undo 한 번에 함께 되돌리는 편집 묶음. 실행한 순서대로 들어 있다. */
type Entry = Command[];

/** History의 기록이 바뀐 뒤 불린다. canUndo·canRedo를 다시 읽으면 된다. */
export type HistoryListener = () => void;

/** 편집(Command)을 실행하고 기록해서 undo/redo를 제공한다. */
export class History {
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly undoStack: Entry[] = [];
  private readonly redoStack: Entry[] = [];
  /** 진행 중인 batch가 모은 편집. batch 밖이면 null */
  private pending: Entry | null = null;
  /** 다음 편집을 이어 붙일 수 있는 직전 편집. undo·redo·batch 뒤에는 null */
  private lastMerge: { key: string; time: number } | null = null;
  private readonly listeners = new Set<HistoryListener>();

  constructor({ limit = 100, mergeWindowMs = 500 }: HistoryOptions = {}) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit은 1 이상의 정수여야 한다: ${limit}`);
    }
    if (!(mergeWindowMs >= 0)) {
      throw new RangeError(`mergeWindowMs는 0 이상이어야 한다: ${mergeWindowMs}`);
    }
    this.limit = limit;
    this.mergeWindowMs = mergeWindowMs;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 편집을 실행하고 기록한다. execute가 에러를 던지면 기록하지 않고 그대로 던진다. */
  execute(command: Command): void {
    command.execute();

    if (this.pending) {
      this.pending.push(command);
      return;
    }

    const now = Date.now();
    const key = command.mergeKey;
    const last = this.undoStack.at(-1);
    if (
      last &&
      key !== undefined &&
      this.lastMerge?.key === key &&
      now - this.lastMerge.time <= this.mergeWindowMs
    ) {
      last.push(command);
    } else {
      this.record([command]);
    }
    this.lastMerge = key === undefined ? null : { key, time: now };
    this.notify();
  }

  /**
   * fn 안에서 실행한 편집을 undo 한 번에 되돌리도록 묶는다. fn이 돌려준 값을 그대로 돌려준다.
   * fn이 에러를 던지면 fn 안에서 실행한 편집을 되돌리고 에러를 다시 던진다.
   * batch 안의 batch는 바깥 batch에 합쳐진다. fn은 동기 함수여야 한다.
   */
  batch<T>(fn: () => T): T {
    const outer = this.pending;
    const pending = outer ?? [];
    const start = pending.length;
    this.pending = pending;
    try {
      const result = fn();
      if (!outer && pending.length > 0) {
        this.record(pending);
        this.lastMerge = null;
        this.notify();
      }
      return result;
    } catch (error) {
      undoAll(pending.splice(start));
      throw error;
    } finally {
      this.pending = outer;
    }
  }

  /** 가장 최근 편집 묶음을 되돌린다. 되돌릴 것이 없으면 false */
  undo(): boolean {
    this.assertNotInBatch("undo");
    const entry = this.undoStack.at(-1);
    if (!entry) return false;
    undoAll(entry);
    this.undoStack.pop();
    this.redoStack.push(entry);
    this.lastMerge = null;
    this.notify();
    return true;
  }

  /** 가장 최근에 되돌린 편집 묶음을 다시 실행한다. 다시 할 것이 없으면 false */
  redo(): boolean {
    this.assertNotInBatch("redo");
    const entry = this.redoStack.at(-1);
    if (!entry) return false;
    for (const command of entry) command.execute();
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.lastMerge = null;
    this.notify();
    return true;
  }

  /**
   * 기록이 바뀔 때마다(편집 실행, batch 끝, undo, redo) listener를 부른다. 툴바 버튼 상태를 맞출 때 쓴다.
   * batch 안의 편집은 batch가 끝날 때 한 번만 알린다. 돌려준 함수를 부르면 그만 부른다.
   */
  onChange(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private record(entry: Entry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private assertNotInBatch(action: string): void {
    if (this.pending) throw new Error(`batch 안에서는 ${action}를 부를 수 없다`);
  }
}

/** 묶음 안의 편집을 나중 것부터 되돌린다. */
function undoAll(entry: Entry): void {
  for (let i = entry.length - 1; i >= 0; i--) entry[i]!.undo();
}
