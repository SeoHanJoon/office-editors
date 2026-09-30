import { MAX_COLS, cellKey, keyToAddress, type CellAddress, type CellRange } from "./address";
import { evaluateFormula, rangeOf, type EvalContext } from "./formula-evaluate";
import { lookupFunction } from "./formula-functions";
import { FormulaSyntaxError, parseFormula, type Expr } from "./formula-parser";
import { FormulaError, isFormula, parseLiteral, type CellValue } from "./formula-value";
import { RangeIndex } from "./range-index";
import type { Sheet } from "./sheet";

/** 계산값이 다시 정해진 셀 주소를 받는다. */
export type FormulaChangeListener = (addresses: readonly CellAddress[]) => void;

interface FormulaCell {
  /** 문법이 틀린 수식이면 null. 계산하면 #NAME? */
  readonly expr: Expr | null;
  /** 직접 참조하는 셀 키 (`A1`) */
  readonly refs: readonly number[];
  /** 참조하는 범위 (`A1:A10`). 셀로 풀지 않고 범위 그대로 둔다. */
  readonly ranges: readonly CellRange[];
}

const CYCLE = new FormulaError("#CYCLE!");
const NAME = new FormulaError("#NAME?");

/**
 * 시트의 입력 글자를 읽어 셀마다 계산값을 갖고 있는다. 시트가 바뀌면 필요한 수식만 다시 계산한다.
 *
 * 의존성 그래프: 수식 셀마다 참조하는 셀과 범위를 적어 두고, 거꾸로 "이 셀을 참조하는 수식" 목록도 둔다.
 * 범위는 구간 트리(RangeIndex)에 넣어, 셀이 바뀌면 그 셀을 포함하는 범위만 바로 찾는다. (ADR 0021)
 * 셀이 바뀌면 그 셀을 참조하는 수식을 따라가며 다시 계산할 셀을 모으고, 참조되는 쪽부터 순서대로 계산한다.
 * 서로를 참조하는 수식(순환 참조)은 #CYCLE!이다. 순환에 걸린 셀을 참조만 하는 셀은 그 에러를 받아 계산한다.
 *
 * 시트는 Command로만 바뀌므로(ADR 0015) 엔진은 sheet.onChange만 듣는다. undo/redo도 같은 길로 다시 계산된다.
 */
export class FormulaEngine {
  private readonly sheet: Sheet;
  /** 값이 있는 셀의 계산값. 빈 셀은 없다. */
  private readonly values = new Map<number, CellValue>();
  private readonly formulas = new Map<number, FormulaCell>();
  /** 셀 키 → 그 셀을 직접 참조하는 수식 셀 키 */
  private readonly refDependents = new Map<number, Set<number>>();
  /** 범위 → 그 범위를 참조하는 수식 셀 키 */
  private readonly rangeDependents = new RangeIndex();
  private readonly listeners = new Set<FormulaChangeListener>();
  private readonly context: EvalContext;
  private readonly unsubscribe: () => void;

  constructor(sheet: Sheet) {
    this.sheet = sheet;
    this.context = {
      value: (address) => this.getValue(address),
      rangeValues: (range) => this.rangeValues(range),
    };
    const keys: number[] = [];
    for (const [address, input] of sheet.entries()) {
      const key = cellKey(address);
      this.setInput(key, input);
      keys.push(key);
    }
    this.recalculateFrom(keys);
    this.unsubscribe = sheet.onChange((addresses) => {
      const recalculated = this.update(addresses.map(cellKey));
      const changed = recalculated.map(keyToAddress);
      for (const listener of this.listeners) listener(changed);
    });
  }

  /** 셀의 계산값. 빈 셀이면 null */
  getValue(address: CellAddress): CellValue {
    return this.values.get(cellKey(address)) ?? null;
  }

  /**
   * 시트 변경을 반영해 계산값이 다시 정해질 때마다 listener를 부른다. (바뀐 셀과 다시 계산한 수식 셀)
   * 돌려준 함수를 부르면 그만 부른다.
   */
  onChange(listener: FormulaChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 시트 변경을 그만 듣는다. */
  destroy(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  /** 바뀐 셀을 반영하고 다시 계산한다. 계산값이 다시 정해진 셀 키를 돌려준다. */
  private update(keys: readonly number[]): number[] {
    for (const key of keys) this.setInput(key, this.sheet.get(keyToAddress(key)));
    return this.recalculateFrom(keys);
  }

  /** 입력이 이미 반영된 changed 셀에서 이어지는 수식을 다시 계산한다. 계산값이 다시 정해진 셀 키를 돌려준다. */
  private recalculateFrom(keys: readonly number[]): number[] {
    const changed = new Set(keys);
    const { dirty, dependents } = this.collectDirty(changed);
    this.recalculate(dirty, dependents);
    for (const key of dirty) changed.add(key);
    return [...changed];
  }

  /** 셀 하나의 입력을 읽어 값(수식이 아니면)이나 수식과 참조 목록(수식이면)을 새로 둔다. */
  private setInput(key: number, input: string): void {
    this.removeFormula(key);
    if (input === "") {
      this.values.delete(key);
    } else if (isFormula(input)) {
      this.addFormula(key, input);
    } else {
      this.values.set(key, parseLiteral(input));
    }
  }

  private addFormula(key: number, input: string): void {
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
    this.formulas.set(key, { expr, refs, ranges });
    for (const ref of refs) {
      let dependents = this.refDependents.get(ref);
      if (!dependents) this.refDependents.set(ref, (dependents = new Set()));
      dependents.add(key);
    }
    if (ranges.length > 0) this.rangeDependents.add(key, ranges);
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
    const { row, col } = keyToAddress(key);
    this.rangeDependents.forEachContaining(row, col, (formula) => result.push(formula));
    // 같은 수식이 셀과 범위로 함께 참조하거나(=A1+SUM(A1:A3)) 겹치는 범위로 두 번 참조할 수 있다.
    return result.length > 1 ? [...new Set(result)] : result;
  }

  /**
   * 다시 계산할 수식 셀(dirty)을 모은다: 바뀐 수식 셀과, 바뀐 셀을 따라 참조하는 수식 셀 모두.
   * dependents에는 dirty 셀마다 그 셀을 참조하는 수식 셀을 담는다. (이것도 모두 dirty)
   *
   * 바뀐 수식 셀부터 따라간 뒤 바뀐 값 셀을 따라간다. 수식이 모두 dirty가 되면 남은 값 셀은 더 볼 필요가 없다.
   * 시트를 처음 읽을 때는 모든 수식이 바뀐 셀이라 값 셀 수십만 개를 하나도 따라가지 않는다.
   */
  private collectDirty(changed: ReadonlySet<number>): { dirty: Set<number>; dependents: Map<number, number[]> } {
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
    const drain = () => {
      while (next < queue.length) visit(queue[next++]!);
    };
    for (const key of changed) {
      if (this.formulas.has(key) && !dirty.has(key)) {
        dirty.add(key);
        queue.push(key);
      }
    }
    drain();
    for (const key of changed) {
      if (dirty.size === this.formulas.size) break;
      if (this.formulas.has(key)) continue;
      visit(key);
      drain();
    }
    return { dirty, dependents };
  }

  /**
   * dirty 셀을 참조되는 쪽부터 계산한다. (위상 정렬: 아직 계산 안 된 dirty 셀을 참조하지 않는 셀부터)
   * 끝까지 순서가 안 정해지는 셀이 남으면 그중 서로를 참조하는 묶음(순환)을 #CYCLE!로 두고 나머지를 이어서 계산한다.
   */
  private recalculate(dirty: ReadonlySet<number>, dependents: ReadonlyMap<number, readonly number[]>): void {
    /** 아직 계산 안 된 dirty 셀 중 이 셀이 참조하는 셀 수 */
    const waiting = new Map<number, number>();
    for (const key of dirty) waiting.set(key, 0);
    for (const key of dirty) for (const next of dependents.get(key)!) waiting.set(next, waiting.get(next)! + 1);

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
    const run = () => {
      while (ready.length > 0) {
        const key = ready.pop()!;
        this.values.set(key, this.evaluate(key));
        done.add(key);
        release(key);
      }
    };

    run();
    if (done.size === dirty.size) return;
    const cycle = cycleMembers(
      [...dirty].filter((key) => !done.has(key)),
      dependents,
    );
    for (const key of cycle) {
      this.values.set(key, CYCLE);
      done.add(key);
    }
    for (const key of cycle) release(key);
    run();
  }

  private evaluate(key: number): CellValue {
    const { expr } = this.formulas.get(key)!;
    return expr ? evaluateFormula(expr, this.context, lookupFunction) : NAME;
  }

  /**
   * 범위 안 셀 값. 시트 밖 부분은 건너뛴다.
   * 큰 범위(10만 칸)를 빨리 읽도록 제너레이터 대신 배열로 한 번에 만들고, 칸마다 주소 객체를 만들지 않게 키를 바로 셈한다.
   */
  private rangeValues(range: CellRange): CellValue[] {
    const bottom = Math.min(range.bottom, this.sheet.rowCount - 1);
    const right = Math.min(range.right, this.sheet.colCount - 1);
    const values = this.values;
    const stride = MAX_COLS;
    const result: CellValue[] = [];
    for (let row = range.top; row <= bottom; row++) {
      const rowKey = row * stride;
      for (let col = range.left; col <= right; col++) result.push(values.get(rowKey + col) ?? null);
    }
    return result;
  }
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
