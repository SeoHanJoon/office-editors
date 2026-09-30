import { textToNumber, type FormulaFunction, type FunctionArg } from "./formula-evaluate";
import { FormulaError, type CellValue } from "./formula-value";

export interface FunctionSpec {
  /** 인자 개수 범위. 벗어나면 Excel처럼 수식 입력을 막는다. */
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly call: FormulaFunction;
}

/** Excel 함수 인자 최대 개수 */
const MAX_ARGS = 255;

/**
 * 인자에서 숫자를 모은다. SUM·AVERAGE·MIN·MAX가 같은 규칙을 쓴다. (Excel과 같음)
 * - 직접 쓴 값: 숫자, 논리값(TRUE=1), 숫자 모양 글자는 숫자로. 다른 글자는 #VALUE!
 * - 셀·범위 참조: 숫자만 쓰고 글자·논리값·빈 셀은 무시한다.
 * - 빈 인자 자리는 0이다.
 * - 에러가 있으면 처음 만난 에러를 돌려준다.
 */
export function collectNumbers(args: readonly FunctionArg[]): number[] | FormulaError {
  const numbers: number[] = [];
  for (const arg of args) {
    if (arg.kind === "missing") {
      numbers.push(0);
    } else if (arg.kind === "reference") {
      // 큰 범위에서 칸마다 에러 확인을 하지 않도록 가장 흔한 숫자부터 본다.
      for (const value of arg.values) {
        if (typeof value === "number") numbers.push(value);
        else if (value instanceof FormulaError) return value;
      }
    } else {
      const number = directNumber(arg.value);
      if (number instanceof FormulaError) return number;
      numbers.push(number);
    }
  }
  return numbers;
}

/** 직접 쓴 인자 값을 숫자로 바꾼다. 수식 결과가 빈 값이면 0이다. */
function directNumber(value: CellValue): number | FormulaError {
  if (value instanceof FormulaError) return value;
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return textToNumber(value) ?? new FormulaError("#VALUE!");
}

/** 숫자를 모아 계산하는 함수를 만든다. 에러가 있으면 계산하지 않고 에러를 돌려준다. */
function numeric(compute: (numbers: number[]) => CellValue): FormulaFunction {
  return (args) => {
    const numbers = collectNumbers(args);
    return numbers instanceof FormulaError ? numbers : compute(numbers);
  };
}

const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);

/** 가장 작은(큰) 수. 숫자가 없으면 0이다. (Math.min(...numbers)는 큰 범위에서 스택이 넘친다) */
function extreme(numbers: number[], better: (a: number, b: number) => boolean): number {
  if (numbers.length === 0) return 0;
  let result = numbers[0]!;
  for (const n of numbers) if (better(n, result)) result = n;
  return result;
}

/**
 * COUNT: 숫자인 인자 수. (Excel과 같음)
 * - 직접 쓴 값: 숫자, 논리값, 숫자 모양 글자, 빈 인자 자리를 센다.
 * - 셀·범위 참조: 숫자만 센다.
 * - 에러는 세지 않고 전파하지도 않는다.
 */
const count: FormulaFunction = (args) => {
  let total = 0;
  for (const arg of args) {
    if (arg.kind === "missing") {
      total++;
    } else if (arg.kind === "reference") {
      for (const value of arg.values) if (typeof value === "number") total++;
    } else if (!(arg.value instanceof FormulaError) && typeof directNumber(arg.value) === "number") {
      total++;
    }
  }
  return total;
};

/** 이름(대문자) → 함수. 새 함수는 /excel-function으로 여기에 더한다. */
export const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = {
  SUM: { minArgs: 1, maxArgs: MAX_ARGS, call: numeric(sum) },
  AVERAGE: {
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: numeric((numbers) => (numbers.length === 0 ? new FormulaError("#DIV/0!") : sum(numbers) / numbers.length)),
  },
  MIN: { minArgs: 1, maxArgs: MAX_ARGS, call: numeric((numbers) => extreme(numbers, (a, b) => a < b)) },
  MAX: { minArgs: 1, maxArgs: MAX_ARGS, call: numeric((numbers) => extreme(numbers, (a, b) => a > b)) },
  COUNT: { minArgs: 1, maxArgs: MAX_ARGS, call: count },
};

/** 계산기가 쓰는 함수 찾기 */
export function lookupFunction(name: string): FormulaFunction | undefined {
  return Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name]!.call : undefined;
}
