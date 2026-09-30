import { MAX_COLS, cellKey, keyToAddress, type CellAddress, type CellRange } from "./address";
import { evaluateFormula, rangeOf, type EvalContext } from "./formula-evaluate";
import { lookupFunction } from "./formula-functions";
import { FormulaSyntaxError, parseFormula, type Expr } from "./formula-parser";
import { FormulaError, isFormula, parseLiteral, type CellValue } from "./formula-value";
import { RangeIndex } from "./range-index";
import type { Sheet } from "./sheet";

/** 계산값이 다시 정해진 셀 주소를 받는다. */
export type FormulaChangeListener = (addresses: readonly CellAddress[]) => void;

export interface FormulaEngineOptions {
  /**
   * true면 시트를 처음 읽고 계산하는 일을 짧게(약 8ms씩) 나눠 하고, 사이사이 브라우저가 화면을 그리게 한다. (ADR 0024)
   * 그동안 `calculating`이 true이고, 계산된 셀은 `onChange`로 알린다. 계산 중에 시트가 바뀌면 남은 계산을 바로 끝내고 반영한다.
   * false(기본)면 만들 때 한 번에 모두 계산한다.
   */
  background?: boolean;
}

interface FormulaCell {
  /** 문법이 틀린 수식이면 null. 계산하면 #NAME? */
  readonly expr: Expr | null;
  /** 직접 참조하는 셀 키 (`A1`) */
  readonly refs: readonly number[];
  /** 참조하는 범위 (`A1:A10`). 셀로 풀지 않고 범위 그대로 둔다. */
  readonly ranges: readonly CellRange[];
}

/** 남은 계산 (제너레이터). next()를 부를 때마다 조금씩 진행한다. */
type Steps<T = void> = Generator<void, T, void>;

const CYCLE = new FormulaError("#CYCLE!");
const NAME = new FormulaError("#NAME?");
/** 아직 계산할 수 없는 수식 셀 */
const PENDING = Symbol("pending");
/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const STRIDE = MAX_COLS;
/** 이만큼 일할 때마다 한 번 멈출 자리를 둔다. */
const STEP = 256;
/** 나눠서 계산할 때 한 번에 쓰는 시간 (ms). 한 프레임(16.7ms)의 절반쯤이다. */
const SLICE_MS = 8;

/** 남은 계산을 끝까지 한 번에 한다. */
function finish<T>(steps: Steps<T>): T {
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}

/**
 * 시트의 입력 글자를 읽어 셀마다 계산값을 갖고 있는다. 시트가 바뀌면 필요한 수식만 다시 계산한다.
 *
 * 의존성 그래프: 수식 셀마다 참조하는 셀과 범위를 적어 두고, 거꾸로 "이 셀을 참조하는 수식" 목록도 둔다.
 * 범위는 구간 트리(RangeIndex)에 넣어, 셀이 바뀌면 그 셀을 포함하는 범위만 바로 찾는다. (ADR 0021)
 * 셀이 바뀌면 그 셀을 참조하는 수식을 따라가며 다시 계산할 셀을 모으고, 참조되는 쪽부터 순서대로 계산한다.
 * 서로를 참조하는 수식(순환 참조)은 #CYCLE!이다. 순환에 걸린 셀을 참조만 하는 셀은 그 에러를 받아 계산한다.
 *
 * 처음 읽기·다시 계산은 제너레이터(Steps)로 써서, 한 번에 끝낼 수도(finish) 나눠서 할 수도(background) 있다.
 * 나눠서 계산하는 동안 화면이 셀 값을 물으면, 그 수식이 참조하는 셀이 모두 정해져 있을 때만 그 자리에서 계산한다.
 * (보이는 행의 `=SUM(D2:F2)`는 바로, 다른 수식 10만 개를 기다려야 하는 `=SUM(G2:G100000)`은 계산이 끝난 뒤)
 *
 * 시트는 Command로만 바뀌므로(ADR 0015) 엔진은 sheet.onChange만 듣는다. undo/redo도 같은 길로 다시 계산된다.
 */
export class FormulaEngine {
  private readonly sheet: Sheet;
  /**
   * 정해진 계산값. 빈 셀은 없다.
   * 값 셀(수식이 아닌 셀)은 처음 읽힐 때 입력을 해석해 넣는다. 10만 행 시트를 열 때 값 셀 수십만 개를 미리 해석하지 않기 위해서다.
   * 나눠서 계산하는 중에는 아직 계산 안 된 수식 셀도 없다.
   */
  private readonly values = new Map<number, CellValue>();
  private readonly formulas = new Map<number, FormulaCell>();
  /** 셀 키 → 그 셀을 직접 참조하는 수식 셀 키 */
  private readonly refDependents = new Map<number, Set<number>>();
  /** 범위 → 그 범위를 참조하는 수식 셀 키 */
  private readonly rangeDependents = new RangeIndex();
  private readonly listeners = new Set<FormulaChangeListener>();
  private readonly context: EvalContext;
  private readonly unsubscribe: () => void;
  /** 나눠서 하는 처음 계산의 남은 일. 끝났으면 null */
  private loading: Steps | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 처음 계산 중 이번에 계산값이 정해진 수식 셀. 알림에 쓴다. */
  private computed: number[] | null = null;

  constructor(sheet: Sheet, { background = false }: FormulaEngineOptions = {}) {
    this.sheet = sheet;
    this.context = {
      value: (address) => this.getValue(address),
      rangeValues: (range) => this.rangeValues(range),
    };
    this.unsubscribe = sheet.onChange(this.onSheetChange);
    if (background) {
      this.loading = this.load();
      this.schedule();
    } else {
      finish(this.load());
    }
  }

  /** 나눠서 하는 처음 계산이 아직 안 끝났는지 */
  get calculating(): boolean {
    return this.loading !== null;
  }

  /** 셀의 계산값. 빈 셀이면 null. 계산 중이라 아직 알 수 없는 수식 셀도 null이다. (isPending으로 구분) */
  getValue(address: CellAddress): CellValue {
    const key = cellKey(address);
    const value = this.values.get(key);
    if (value !== undefined) return value;
    const peeked = this.peek(key, address);
    return peeked === PENDING ? null : peeked;
  }

  /** 계산 중이라 아직 값을 알 수 없는 수식 셀인지. 계산 중이 아니면 늘 false */
  isPending(address: CellAddress): boolean {
    if (!this.loading) return false;
    const key = cellKey(address);
    return !this.values.has(key) && this.peek(key, address) === PENDING;
  }

  /**
   * 계산값이 다시 정해질 때마다 listener를 부른다. (시트 변경으로 바뀐 셀과 다시 계산한 수식 셀, 나눠서 계산하는 중 정해진 수식 셀)
   * 돌려준 함수를 부르면 그만 부른다.
   */
  onChange(listener: FormulaChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 시트 변경을 그만 듣고, 남은 계산을 멈춘다. */
  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.loading = null;
    this.unsubscribe();
    this.listeners.clear();
  }

  private notify(keys: Iterable<number>): void {
    if (this.listeners.size === 0) return;
    const addresses = Array.from(keys, keyToAddress);
    for (const listener of this.listeners) listener(addresses);
  }

  private readonly onSheetChange = (addresses: readonly CellAddress[]): void => {
    const recalculated = new Set(this.finishLoading());
    for (const key of this.update(addresses.map(cellKey))) recalculated.add(key);
    this.notify(recalculated);
  };

  private schedule(): void {
    this.timer = setTimeout(this.runSlice, 0);
  }

  /** 처음 계산을 SLICE_MS 동안 하고, 남았으면 다음 차례를 잡는다. 이번에 정해진 수식 셀을 알린다. */
  private readonly runSlice = (): void => {
    this.timer = null;
    if (!this.loading) return;
    const computed: number[] = [];
    this.computed = computed;
    const start = performance.now();
    let done = false;
    while (!done && performance.now() - start < SLICE_MS) done = !!this.loading.next().done;
    this.computed = null;
    if (done) this.loading = null;
    else this.schedule();
    // 다 끝났으면 정해진 셀이 없어도 알려서, 화면이 계산 중 표시를 지우게 한다.
    if (computed.length > 0 || done) this.notify(computed);
  };

  /** 처음 계산이 남았으면 한 번에 끝낸다. 이때 정해진 수식 셀 키를 돌려준다. */
  private finishLoading(): number[] {
    if (!this.loading) return [];
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const computed: number[] = [];
    this.computed = computed;
    finish(this.loading);
    this.computed = null;
    this.loading = null;
    return computed;
  }

  /**
   * 시트 전체를 읽고 모든 수식을 계산한다.
   * 값 셀은 읽힐 때 해석하므로 건너뛴다. 모든 수식이 다시 계산 대상이라 값 셀에서 "나를 참조하는 수식"을 찾을 필요도 없다.
   */
  private *load(): Steps {
    const formulaKeys: number[] = [];
    let count = 0;
    for (const [address, input] of this.sheet.entries()) {
      if (++count % STEP === 0) yield;
      if (!isFormula(input)) continue;
      const key = cellKey(address);
      this.addFormula(key, input);
      formulaKeys.push(key);
    }
    yield* this.recalculateFrom(formulaKeys);
  }

  /** 바뀐 셀을 반영하고 다시 계산한다. 계산값이 다시 정해진 셀 키를 돌려준다. */
  private update(keys: readonly number[]): number[] {
    for (const key of keys) this.setInput(key, this.sheet.get(keyToAddress(key)));
    const changed = new Set(keys);
    for (const key of finish(this.recalculateFrom(keys))) changed.add(key);
    return [...changed];
  }

  /** 입력이 이미 반영된 changed 셀에서 이어지는 수식을 다시 계산한다. 다시 계산한 수식 셀 키를 돌려준다. */
  private *recalculateFrom(changed: readonly number[]): Steps<ReadonlySet<number>> {
    const { dirty, dependents } = yield* this.collectDirty(changed);
    yield* this.recalculate(dirty, dependents);
    return dirty;
  }

  /** 셀 하나의 입력이 바뀌었다. 예전 값을 지우고, 수식이면 수식과 참조 목록을 새로 둔다. (값 셀은 읽힐 때 해석한다) */
  private setInput(key: number, input: string): void {
    this.removeFormula(key);
    this.values.delete(key);
    if (isFormula(input)) this.addFormula(key, input);
  }

  private addFormula(key: number, input: string): void {
    const formula = parseCell(input);
    this.formulas.set(key, formula);
    for (const ref of formula.refs) {
      let dependents = this.refDependents.get(ref);
      if (!dependents) this.refDependents.set(ref, (dependents = new Set()));
      dependents.add(key);
    }
    if (formula.ranges.length > 0) this.rangeDependents.add(key, formula.ranges);
  }

  private removeFormula(key: number): void {
    const formula = this.formulas.get(key);
    if (!formula) return;
    this.formulas.delete(key);
    for (const ref of formula.refs) {
      const dependents = this.refDependents.get(ref);
      dependents?.delete(key);
      if (dependents?.size === 0) this.refDependents.delete(ref);
    }
    if (formula.ranges.length > 0) this.rangeDependents.remove(key);
  }

  /** key 셀을 참조하는 수식 셀 키 (중복 없음) */
  private dependentsOf(key: number): number[] {
    const direct = this.refDependents.get(key);
    const result = direct ? [...direct] : [];
    const row = Math.floor(key / STRIDE);
    this.rangeDependents.forEachContaining(row, key - row * STRIDE, (formula) => result.push(formula));
    // 같은 수식이 셀과 범위로 함께 참조하거나(=A1+SUM(A1:A3)) 겹치는 범위로 두 번 참조할 수 있다.
    return result.length > 1 ? [...new Set(result)] : result;
  }

  /**
   * 다시 계산할 수식 셀(dirty)을 모은다: 바뀐 수식 셀과, 바뀐 셀을 따라 참조하는 수식 셀 모두.
   * dependents에는 dirty 셀마다 그 셀을 참조하는 수식 셀을 담는다. (이것도 모두 dirty)
   *
   * 바뀐 수식 셀부터 따라간 뒤 바뀐 값 셀을 따라간다. 수식이 모두 dirty가 되면 남은 값 셀은 더 볼 필요가 없다.
   */
  private *collectDirty(
    changed: readonly number[],
  ): Steps<{ dirty: Set<number>; dependents: Map<number, number[]> }> {
    const dirty = new Set<number>();
    const dependents = new Map<number, number[]>();
    const queue: number[] = [];
    const visit = (key: number) => {
      const next = this.dependentsOf(key);
      dependents.set(key, next);
      for (const formula of next) {
        if (dirty.has(formula)) continue;
        dirty.add(formula);
        queue.push(formula);
      }
    };
    let next = 0;
    for (const key of changed) {
      if (this.formulas.has(key) && !dirty.has(key)) {
        dirty.add(key);
        queue.push(key);
      }
    }
    for (; next < queue.length; next++) {
      visit(queue[next]!);
      if (next % STEP === 0) yield;
    }
    for (const key of changed) {
      if (dirty.size === this.formulas.size) break;
      if (this.formulas.has(key)) continue;
      visit(key);
      for (; next < queue.length; next++) visit(queue[next]!);
    }
    return { dirty, dependents };
  }

  /**
   * dirty 셀을 참조되는 쪽부터 계산한다. (위상 정렬: 아직 계산 안 된 dirty 셀을 참조하지 않는 셀부터)
   * 끝까지 순서가 안 정해지는 셀이 남으면 그중 서로를 참조하는 묶음(순환)을 #CYCLE!로 두고 나머지를 이어서 계산한다.
   */
  private *recalculate(dirty: ReadonlySet<number>, dependents: ReadonlyMap<number, readonly number[]>): Steps {
    /** 아직 계산 안 된 dirty 셀 중 이 셀이 참조하는 셀 수 */
    const waiting = new Map<number, number>();
    for (const key of dirty) waiting.set(key, 0);
    for (const key of dirty) for (const next of dependents.get(key)!) waiting.set(next, waiting.get(next)! + 1);
    yield;

    const done = new Set<number>();
    const ready = [...dirty].filter((key) => waiting.get(key) === 0);
    const release = (key: number) => {
      for (const next of dependents.get(key)!) {
        if (done.has(next)) continue;
        const count = waiting.get(next)! - 1;
        waiting.set(next, count);
        if (count === 0) ready.push(next);
      }
    };
    const settle = (key: number, value: CellValue) => {
      this.values.set(key, value);
      this.computed?.push(key);
      done.add(key);
    };
    const evaluate = (key: number) => this.evaluate(key);
    function* run(): Steps {
      let count = 0;
      while (ready.length > 0) {
        const key = ready.pop()!;
        settle(key, evaluate(key));
        release(key);
        if (++count % STEP === 0) yield;
      }
    }

    yield* run();
    if (done.size === dirty.size) return;
    const cycle = cycleMembers(
      [...dirty].filter((key) => !done.has(key)),
      dependents,
    );
    for (const key of cycle) settle(key, CYCLE);
    for (const key of cycle) release(key);
    yield* run();
  }

  private evaluate(key: number): CellValue {
    return evaluateCell(this.formulas.get(key)!, this.context);
  }

  /**
   * values에 아직 없는 셀의 값을 알아본다.
   * 값 셀은 입력을 해석해 values에 넣어 둔다. 빈 셀은 null이다.
   * 수식 셀은 처음 계산 중에만 여기 온다. 참조하는 셀이 모두 정해져 있으면 지금 계산해 두고, 아니면 PENDING이다.
   * 참조하는 수식을 따라 더 들어가지 않으므로 오래 걸리지 않고, 순환에 걸린 셀은 늘 PENDING이다.
   */
  private peek(key: number, address: CellAddress): CellValue | typeof PENDING {
    const input = this.sheet.get(address);
    if (input === "") return null;
    if (!isFormula(input)) {
      const value = parseLiteral(input);
      this.values.set(key, value);
      return value;
    }
    const formula = this.formulas.get(key) ?? parseCell(input);
    if (!formula.refs.every((ref) => this.settled(ref)) || !formula.ranges.every((range) => this.rangeSettled(range))) {
      return PENDING;
    }
    const value = evaluateCell(formula, this.context);
    this.values.set(key, value);
    return value;
  }

  /** 셀 값이 정해졌는지 (계산된 셀, 값 셀, 빈 셀) */
  private settled(key: number): boolean {
    if (this.values.has(key)) return true;
    const row = Math.floor(key / STRIDE);
    return !isFormula(this.sheet.get({ row, col: key - row * STRIDE }));
  }

  private rangeSettled(range: CellRange): boolean {
    const bottom = Math.min(range.bottom, this.sheet.rowCount - 1);
    const right = Math.min(range.right, this.sheet.colCount - 1);
    for (let row = range.top; row <= bottom; row++) {
      for (let col = range.left; col <= right; col++) if (!this.settled(row * STRIDE + col)) return false;
    }
    return true;
  }

  /**
   * 범위 안 셀 값. 시트 밖 부분은 건너뛴다.
   * 큰 범위(10만 칸)를 빨리 읽도록 제너레이터 대신 배열로 한 번에 만들고, 이미 정해진 칸은 주소 객체 없이 키로 바로 읽는다.
   */
  private rangeValues(range: CellRange): CellValue[] {
    const bottom = Math.min(range.bottom, this.sheet.rowCount - 1);
    const right = Math.min(range.right, this.sheet.colCount - 1);
    const values = this.values;
    const result: CellValue[] = [];
    for (let row = range.top; row <= bottom; row++) {
      const rowKey = row * STRIDE;
      for (let col = range.left; col <= right; col++) {
        const value = values.get(rowKey + col);
        result.push(value !== undefined ? value : this.getValue({ row, col }));
      }
    }
    return result;
  }
}

/** 수식 글자를 읽어 구문 나무와 참조 목록을 만든다. */
function parseCell(input: string): FormulaCell {
  let expr: Expr | null = null;
  try {
    expr = parseFormula(input);
  } catch (error) {
    // 화면은 틀린 수식을 확정하지 못하게 막지만, 처음 데이터나 코드로 넣은 틀린 수식도 멈추지 않고 #NAME?으로 둔다.
    if (!(error instanceof FormulaSyntaxError)) throw error;
  }
  const refs: number[] = [];
  const ranges: CellRange[] = [];
  if (expr) collectReferences(expr, refs, ranges);
  return { expr, refs, ranges };
}

function evaluateCell({ expr }: FormulaCell, context: EvalContext): CellValue {
  return expr ? evaluateFormula(expr, context, lookupFunction) : NAME;
}

/** 수식이 참조하는 셀과 범위를 모은다. */
function collectReferences(expr: Expr, refs: number[], ranges: CellRange[]): void {
  switch (expr.kind) {
    case "ref":
      refs.push(cellKey(expr.ref));
      return;
    case "range":
      ranges.push(rangeOf(expr.start, expr.end));
      return;
    case "unary":
    case "percent":
      collectReferences(expr.operand, refs, ranges);
      return;
    case "binary":
      collectReferences(expr.left, refs, ranges);
      collectReferences(expr.right, refs, ranges);
      return;
    case "call":
      for (const arg of expr.args) collectReferences(arg, refs, ranges);
      return;
    default:
      return;
  }
}

/**
 * nodes 안에서 순환(서로를 참조하는 묶음, 또는 자기 자신 참조)에 든 셀을 찾는다.
 * Tarjan의 강한 연결 요소 찾기. 셀 1만 개가 이어진 수식에서도 스택이 넘치지 않도록 재귀 없이 쓴다.
 */
function cycleMembers(nodes: readonly number[], dependents: ReadonlyMap<number, readonly number[]>): number[] {
  const inside = new Set(nodes);
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const result: number[] = [];
  let counter = 0;

  const open = (node: number) => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
  };

  for (const root of nodes) {
    if (index.has(root)) continue;
    open(root);
    const work = [{ node: root, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const edges = dependents.get(frame.node)!;
      if (frame.next < edges.length) {
        const next = edges[frame.next++]!;
        if (!inside.has(next)) continue;
        if (!index.has(next)) {
          open(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const component: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== frame.node);
      if (component.length > 1 || edges.includes(frame.node)) result.push(...component);
    }
  }
  return result;
}
