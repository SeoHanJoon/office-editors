/**
 * Excel 에러 값. `#CYCLE!`은 Excel에는 없고, 순환 참조에 걸린 셀에 쓴다. (HyperFormula와 같음)
 */
export type ErrorCode = "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A" | "#CYCLE!";

/** 사용자가 수식이나 셀에 직접 쓸 수 있는 에러 값. (`#CYCLE!`은 Excel에 없으므로 뺀다) */
export const TYPED_ERROR_CODES: readonly ErrorCode[] = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"];

/** 계산 결과로 나온 에러 값. 같은 종류끼리는 code로 비교한다. */
export class FormulaError {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    this.code = code;
  }

  toString(): string {
    return this.code;
  }
}

/** 셀의 계산값. null은 빈 셀이다. */
export type CellValue = number | string | boolean | null | FormulaError;

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** 글자가 숫자 모양이면 그 숫자, 아니면 null. ("12", "-1.5", "1e3") */
export function parseNumber(text: string): number | null {
  return NUMBER.test(text) ? Number(text) : null;
}

/**
 * 수식이 아닌 셀 입력을 값으로 바꾼다. (Excel과 같음)
 * 숫자 모양이면 숫자, TRUE/FALSE(대소문자 무관)는 논리값, 에러 이름은 에러, 나머지는 글자 그대로.
 * 앞에 작은따옴표(')를 붙이면 뒤의 글자를 그대로 글자로 둔다. ("'5"는 글자 "5")
 */
export function parseLiteral(input: string): CellValue {
  if (input === "") return null;
  if (input.startsWith("'")) return input.slice(1);
  const number = parseNumber(input);
  if (number !== null) return number;
  const upper = input.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  const code = TYPED_ERROR_CODES.find((c) => c === upper);
  return code ? new FormulaError(code) : input;
}

/** 셀 입력이 수식인지. "="로 시작하면 수식이다. */
export function isFormula(input: string): boolean {
  return input.startsWith("=");
}

/** 계산값을 셀에 보이는 글자로 바꾼다. 빈 셀은 "" */
export function formatValue(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value.toString();
}

/**
 * 숫자를 Excel처럼 유효 숫자 15자리까지만 보여준다. (0.1+0.2 → "0.3")
 * 열 너비에 맞춰 줄이는 Excel "일반" 서식은 아직 없다.
 */
export function formatNumber(value: number): string {
  if (value === 0) return "0"; // -0 포함
  return String(Number(value.toPrecision(15))).replace("e", "E");
}
