import type { CellAddress, CellRange } from "./address";
import type { BinaryOperator, CellRef, Expr } from "./formula-parser";
import { FormulaError, formatNumber, parseNumber, type CellValue } from "./formula-value";

/** 계산기가 셀 값을 읽는 창구. 수식 엔진이 만든다. */
export interface EvalContext {
  /** 셀 하나의 값. 빈 셀이나 시트 밖이면 null */
  value(address: CellAddress): CellValue;
  /** 범위 안 셀 값을 위 행부터 왼쪽→오른쪽으로 */
  rangeValues(range: CellRange): Iterable<CellValue>;
}

/**
 * 함수에 넘기는 인자 하나. Excel은 직접 쓴 값과 셀 참조를 다르게 다룬다.
 * 예: `SUM("3")`은 3을 더하지만, A1에 글자 "3"이 있으면 `SUM(A1)`은 무시한다.
 */
export type FunctionArg =
  /** 직접 쓴 값이나 계산 결과 (`1`, `"3"`, `A1+1`) */
  | { readonly kind: "value"; readonly value: CellValue }
  /** 셀·범위 참조 (`A1`, `A1:B3`). 셀 하나도 여기에 든다. */
  | { readonly kind: "reference"; readonly values: Iterable<CellValue> }
  /** 빈 인자 자리 (`SUM(1,)`) */
  | { readonly kind: "missing" };

export type FormulaFunction = (args: readonly FunctionArg[]) => CellValue;

/** 함수 이름(대문자)으로 구현을 찾는다. 없으면 #NAME? */
export type FunctionLookup = (name: string) => FormulaFunction | undefined;

/**
 * 수식 하나를 계산한다. 결과가 빈 셀이면 0이다. (`=A1`에서 A1이 비었을 때, Excel과 같음)
 * 범위 하나가 결과면 #VALUE!다. (여러 칸으로 넘치는 동적 배열은 없다)
 */
export function evaluateFormula(expr: Expr, context: EvalContext, functions: FunctionLookup): CellValue {
  const value = new Evaluator(context, functions).scalar(expr);
  return value === null ? 0 : value;
}

const VALUE_ERROR = new FormulaError("#VALUE!");
const DIV0_ERROR = new FormulaError("#DIV/0!");
const NUM_ERROR = new FormulaError("#NUM!");
const NAME_ERROR = new FormulaError("#NAME?");

/**
 * 연산에 쓰려고 값을 숫자로 바꾼다. (Excel과 같음)
 * 빈 셀은 0, TRUE는 1, 숫자 모양 글자(" 3", "50%")는 숫자, 나머지 글자는 #VALUE!, 에러는 그대로.
 */
export function toNumber(value: CellValue): number | FormulaError {
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return textToNumber(value) ?? VALUE_ERROR;
  return value;
}

/** 숫자 모양 글자를 숫자로. 앞뒤 빈 칸과 끝의 %를 허용한다. 아니면 null */
export function textToNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.endsWith("%")) {
    const number = parseNumber(trimmed.slice(0, -1).trim());
    return number === null ? null : number / 100;
  }
  return parseNumber(trimmed);
}

/** 연결(&)에 쓰려고 값을 글자로 바꾼다. 빈 셀은 "", 에러는 그대로 */
function toText(value: CellValue): string | FormulaError {
  if (value === null) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value;
}

class Evaluator {
  private readonly context: EvalContext;
  private readonly functions: FunctionLookup;

  constructor(context: EvalContext, functions: FunctionLookup) {
    this.context = context;
    this.functions = functions;
  }

  /** 값 하나로 계산한다. 셀 참조가 빈 셀이면 null이다. */
  scalar(expr: Expr): CellValue {
    switch (expr.kind) {
      case "number":
      case "string":
      case "boolean":
        return expr.value;
      case "error":
        return new FormulaError(expr.code);
      case "name":
        return NAME_ERROR;
      case "missing":
        return null;
      case "ref":
        return this.context.value(expr.ref);
      case "range":
        return VALUE_ERROR;
      case "unary": {
        const operand = this.scalar(expr.operand);
        if (expr.operator === "+") return operand;
        const number = toNumber(operand);
        return typeof number === "number" ? -number : number;
      }
      case "percent": {
        const number = toNumber(this.scalar(expr.operand));
        return typeof number === "number" ? number / 100 : number;
      }
      case "binary":
        return this.binary(expr.operator, this.scalar(expr.left), this.scalar(expr.right));
      case "call": {
        const fn = this.functions(expr.name);
        if (!fn) return NAME_ERROR;
        return fn(expr.args.map((arg) => this.argument(arg)));
      }
    }
  }

  private argument(expr: Expr): FunctionArg {
    if (expr.kind === "missing") return { kind: "missing" };
    if (expr.kind === "ref") return { kind: "reference", values: [this.context.value(expr.ref)] };
    if (expr.kind === "range") return { kind: "reference", values: this.context.rangeValues(rangeOf(expr.start, expr.end)) };
    return { kind: "value", value: this.scalar(expr) };
  }

  private binary(operator: BinaryOperator, left: CellValue, right: CellValue): CellValue {
    switch (operator) {
      case "&": {
        const a = toText(left);
        if (a instanceof FormulaError) return a;
        const b = toText(right);
        if (b instanceof FormulaError) return b;
        return a + b;
      }
      case "=":
      case "<>":
      case "<":
      case ">":
      case "<=":
      case ">=": {
        if (left instanceof FormulaError) return left;
        if (right instanceof FormulaError) return right;
        return compareWith(operator, compare(left, right));
      }
      default: {
        const a = toNumber(left);
        if (a instanceof FormulaError) return a;
        const b = toNumber(right);
        if (b instanceof FormulaError) return b;
        return arithmetic(operator, a, b);
      }
    }
  }
}

function arithmetic(operator: "+" | "-" | "*" | "/" | "^", a: number, b: number): number | FormulaError {
  let result: number;
  switch (operator) {
    case "+":
      result = a + b;
      break;
    case "-":
      result = a - b;
      break;
    case "*":
      result = a * b;
      break;
    case "/":
      if (b === 0) return DIV0_ERROR;
      result = a / b;
      break;
    case "^":
      if (a === 0 && b === 0) return NUM_ERROR;
      if (a === 0 && b < 0) return DIV0_ERROR;
      result = a ** b;
      break;
  }
  // 음수의 소수 거듭제곱(NaN)과 넘침(Infinity)은 #NUM!
  return Number.isFinite(result) ? result : NUM_ERROR;
}

/** 두 값 비교: 음수면 left가 작다. 종류가 다르면 숫자 < 글자 < 논리값 순이다. 글자는 대소문자를 가리지 않는다. */
function compare(left: Exclude<CellValue, FormulaError>, right: Exclude<CellValue, FormulaError>): number {
  // 빈 셀은 상대 종류의 기본값(0, "", FALSE)으로 본다.
  const a = left ?? emptyLike(right);
  const b = right ?? emptyLike(left);
  const rankA = typeRank(a);
  const rankB = typeRank(b);
  if (rankA !== rankB) return rankA - rankB;
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function emptyLike(value: Exclude<CellValue, FormulaError>): number | string | boolean {
  if (typeof value === "string") return "";
  if (typeof value === "boolean") return false;
  return 0;
}

function typeRank(value: number | string | boolean): number {
  if (typeof value === "number") return 0;
  if (typeof value === "string") return 1;
  return 2;
}

function compareWith(operator: "=" | "<>" | "<" | ">" | "<=" | ">=", order: number): boolean {
  switch (operator) {
    case "=":
      return order === 0;
    case "<>":
      return order !== 0;
    case "<":
      return order < 0;
    case ">":
      return order > 0;
    case "<=":
      return order <= 0;
    case ">=":
      return order >= 0;
  }
}

/** 두 모서리로 범위를 만든다. `B3:A1`처럼 거꾸로 써도 된다. */
export function rangeOf(start: CellRef, end: CellRef): CellRange {
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.col, end.col),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.col, end.col),
  };
}
